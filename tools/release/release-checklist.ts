// tools/release/release-checklist.ts — M17 non-shipping release preflight (`npm run release:check`).
//
// Runs the full preflight gate chain (clean worktree, version lockstep, legacy-token scan, docs
// audit, tracked marketplace distribution, full test suite, final package payload gate,
// stable-semver, manifest-is-shippable) and writes a JSON report under .litcodex/evidence/ only
// after the worktree guard passes.
// HARD INVARIANTS (enforced by release-checklist.test.ts self-scan):
//   - this source spawns NO registry-shipping command and reads NO registry credential env var;
//   - `publishAttempted` is the compile-time literal `false` — there is no code path that flips it;
//   - child processes are verification-only (local scanners/checks and npm pack dry-runs).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkVersionLockstep, ReleaseMetadataError } from "./check-version-lockstep.ts";
import { isStableSemver, VERSION } from "./version.ts";

export interface ReleaseCheckStep {
	readonly id: string;
	readonly ok: boolean;
	readonly summary: string;
	readonly evidencePath: string | null;
}

export interface ReleaseChecklistReport {
	readonly ok: boolean;
	readonly version: string;
	/** LITERAL false — invariant: this module never ships a build to a registry. */
	readonly publishAttempted: false;
	readonly steps: readonly ReleaseCheckStep[];
}

export interface ReleaseChecklistOptions {
	readonly evidenceDir?: string; // default ".litcodex/evidence"
}

interface NpmScriptExecution {
	readonly error: Error | null;
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

export interface ReleaseChecklistDependencies {
	readonly runTestSuite: (repoRoot: string) => NpmScriptExecution;
	readonly runFinalPackGate: (repoRoot: string) => FinalPackReport;
}

export function checkWorktreeClean(repoRoot: string): ReleaseCheckStep {
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
	for (const key of Object.keys(env)) {
		if (key === "GIT_CONFIG" || key === "GIT_CONFIG_PARAMETERS" || key.startsWith("GIT_CONFIG_")) {
			delete env[key];
		}
	}
	delete env["GIT_DIR"];
	delete env["GIT_WORK_TREE"];
	delete env["GIT_COMMON_DIR"];
	delete env["GIT_INDEX_FILE"];
	delete env["GIT_OBJECT_DIRECTORY"];
	delete env["GIT_ALTERNATE_OBJECT_DIRECTORIES"];
	delete env["GIT_QUARANTINE_PATH"];
	delete env["GIT_CEILING_DIRECTORIES"];
	delete env["GIT_DISCOVERY_ACROSS_FILESYSTEM"];
	try {
		const status = execFileSync(
			"git",
			["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
			{
				cwd: repoRoot,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const ok = status.length === 0;
		return {
			id: "worktree-clean",
			ok,
			summary: ok ? "worktree is clean" : "worktree has modified, staged, or untracked files",
			evidencePath: null,
		};
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return {
			id: "worktree-clean",
			ok: false,
			summary: `unable to verify worktree cleanliness${code ? ` (${code})` : ""}`,
			evidencePath: null,
		};
	}
}

function ensureEvidenceDir(repoRoot: string, evidenceDir: string): string {
	const abs = resolve(repoRoot, evidenceDir);
	try {
		mkdirSync(abs, { recursive: true });
	} catch (err) {
		throw new ReleaseMetadataError(
			"RELEASE_EVIDENCE_DIR_UNWRITABLE",
			`cannot create evidence dir: ${(err as Error).message}`,
			{
				path: evidenceDir,
			},
		);
	}
	return abs;
}

function stepVersionLockstep(repoRoot: string, evidenceAbs: string, evidenceDir: string): ReleaseCheckStep {
	const report = checkVersionLockstep(repoRoot);
	const evidencePath = `${evidenceDir}/task-22-version-lockstep.json`;
	writeFileSync(resolve(evidenceAbs, "task-22-version-lockstep.json"), `${JSON.stringify(report)}\n`);
	return {
		id: "version-lockstep",
		ok: report.ok,
		summary: report.ok
			? `${report.checked} manifests aligned at ${report.version}`
			: `${report.mismatches.length} version mismatch(es)`,
		evidencePath,
	};
}

function stepLegacyTokenScan(repoRoot: string, evidenceAbs: string, evidenceDir: string): ReleaseCheckStep {
	const evidencePath = `${evidenceDir}/task-22-legacy-scan.txt`;
	let ok = true;
	let summary = "no legacy tokens in tracked surfaces";
	let out = "";
	try {
		out = execFileSync("node", [resolve(repoRoot, "tools/scan-legacy-tokens.mjs")], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		ok = false;
		const e = err as { stdout?: string; stderr?: string };
		out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
		summary = "legacy-token scan reported offenders";
	}
	writeFileSync(resolve(evidenceAbs, "task-22-legacy-scan.txt"), out.endsWith("\n") ? out : `${out}\n`);
	return { id: "legacy-token-scan", ok, summary, evidencePath };
}

function stepDocsAudit(repoRoot: string, evidenceAbs: string, evidenceDir: string): ReleaseCheckStep {
	const evidencePath = `${evidenceDir}/task-22-docs-audit.txt`;
	let ok = true;
	let summary = "docs audit passed";
	let out = "";
	try {
		out = execFileSync("node", [resolve(repoRoot, "tools/docs-audit.mjs")], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		ok = false;
		const e = err as { stdout?: string; stderr?: string };
		out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
		summary = "docs audit reported offenders";
	}
	writeFileSync(resolve(evidenceAbs, "task-22-docs-audit.txt"), out.endsWith("\n") ? out : `${out}\n`);
	return { id: "docs-audit", ok, summary, evidencePath };
}

function runNpmScript(repoRoot: string, args: readonly string[]): NpmScriptExecution {
	const npmExecPath = process.env["npm_execpath"];
	const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
	const npmArgs = npmExecPath ? [npmExecPath, ...args] : [...args];
	const execution = spawnSync(command, npmArgs, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		error: execution.error ?? null,
		status: execution.status,
		stdout: execution.stdout,
		stderr: execution.stderr,
	};
}

function stepMarketplaceDistTracked(repoRoot: string, evidenceAbs: string, evidenceDir: string): ReleaseCheckStep {
	const evidencePath = `${evidenceDir}/task-22-marketplace-dist-tracked.txt`;
	const execution = runNpmScript(repoRoot, ["run", "check:marketplace-dist:tracked"]);
	const ok = execution.error === null && execution.status === 0;
	const out = [execution.stdout, execution.stderr, execution.error?.message ?? ""].filter(Boolean).join("\n");
	const summary = ok
		? "tracked marketplace distribution passed"
		: "tracked marketplace distribution rejected runtime drift";
	writeFileSync(resolve(evidenceAbs, "task-22-marketplace-dist-tracked.txt"), out.endsWith("\n") ? out : `${out}\n`);
	return { id: "marketplace-dist-tracked", ok, summary, evidencePath };
}

function stepTestSuite(
	repoRoot: string,
	evidenceAbs: string,
	evidenceDir: string,
	runTestSuite: ReleaseChecklistDependencies["runTestSuite"],
): ReleaseCheckStep {
	const evidencePath = `${evidenceDir}/task-22-test-suite.txt`;
	const execution = runTestSuite(repoRoot);
	const ok = execution.error === null && execution.status === 0;
	const summary = ok
		? "full npm test suite passed"
		: execution.error === null
			? `full npm test suite failed with exit ${execution.status ?? "unavailable"}`
			: `full npm test suite could not start: ${execution.error.message}`;
	const out = [
		"Command: npm test",
		`Exit status: ${execution.status ?? "unavailable"}`,
		execution.error === null ? "" : `Spawn error: ${execution.error.message}`,
		execution.stdout,
		execution.stderr,
	]
		.filter(Boolean)
		.join("\n");
	writeFileSync(resolve(evidenceAbs, "task-22-test-suite.txt"), out.endsWith("\n") ? out : `${out}\n`);
	return { id: "test-suite", ok, summary, evidencePath };
}

interface FinalPackReport {
	readonly ok: boolean;
	readonly checkedPackages: readonly string[];
	readonly filesChecked: number;
	readonly issues: readonly { readonly code: string; readonly package: string | null; readonly path: string | null }[];
}

function runFinalPackGate(repoRoot: string): FinalPackReport {
	const raw = execFileSync("node", [resolve(repoRoot, "tools/pack-all.mjs"), "--require-future", "--json"], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return JSON.parse(raw) as FinalPackReport;
}

function stepPackPayload(
	repoRoot: string,
	evidenceAbs: string,
	evidenceDir: string,
	packGate: ReleaseChecklistDependencies["runFinalPackGate"],
): ReleaseCheckStep {
	const evidencePath = `${evidenceDir}/task-22-pack.json`;
	let ok = false;
	let summary = "final package payload gate failed";
	let payload: FinalPackReport | Record<string, never> = {};
	try {
		payload = packGate(repoRoot);
		ok = payload.ok === true && payload.issues.length === 0;
		summary = ok
			? `final payload gate checked ${payload.checkedPackages.length} packages and ${payload.filesChecked} files`
			: `final payload gate reported ${payload.issues.length} issue(s)`;
	} catch (err) {
		summary = `final payload gate error: ${(err as Error).message}`;
	}
	writeFileSync(resolve(evidenceAbs, "task-22-pack.json"), `${JSON.stringify(payload)}\n`);
	return { id: "pack-payload", ok, summary, evidencePath };
}

function stepStableSemver(): ReleaseCheckStep {
	const ok = isStableSemver(VERSION);
	return {
		id: "stable-semver",
		ok,
		summary: ok ? `${VERSION} is stable semver` : `${VERSION} is not stable semver`,
		evidencePath: null,
	};
}

function readJsonField(repoRoot: string, relPath: string, field: string): unknown {
	const abs = resolve(repoRoot, relPath);
	if (!existsSync(abs)) return undefined;
	// Re-read via require-free JSON parse so a `private:true` is observed honestly.
	const raw = execFileSync(
		"node",
		["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(abs)}).${field} ?? null))`],
		{
			cwd: repoRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const parsed = JSON.parse(raw) as unknown;
	return parsed === null ? undefined : parsed;
}

function stepShippable(repoRoot: string): ReleaseCheckStep {
	// The installer is the sole public target; its bundled component must remain non-publishable.
	const installerPrivate = readJsonField(repoRoot, "packages/litcodex-ai/package.json", "private");
	const loopPrivate = readJsonField(repoRoot, "plugins/litcodex/components/lit-loop/package.json", "private");
	const installerPublic = installerPrivate === undefined || installerPrivate === false;
	const bundledPrivate = loopPrivate === true;
	const ok = installerPublic && bundledPrivate;
	return {
		id: "shippable",
		ok,
		summary: ok
			? "installer is public and bundled lit-loop component is private"
			: !installerPublic
				? "installer package has private:true"
				: "bundled lit-loop component must be private:true",
		evidencePath: null,
	};
}

/**
 * Runs the clean-worktree guard first (NO registry mutation), then orchestrates the remaining
 * sub-checks plus the local final package-payload gate. Writes evidence only after the guard
 * passes.
 */
export async function runReleaseChecklist(
	repoRoot: string,
	options?: ReleaseChecklistOptions,
	dependencies: ReleaseChecklistDependencies = {
		runTestSuite: (root) => runNpmScript(root, ["test"]),
		runFinalPackGate,
	},
): Promise<ReleaseChecklistReport> {
	const evidenceDir = options?.evidenceDir ?? ".litcodex/evidence";
	const worktreeStep = checkWorktreeClean(repoRoot);
	if (!worktreeStep.ok) {
		return Object.freeze({
			ok: false,
			version: VERSION,
			publishAttempted: false as const,
			steps: Object.freeze([worktreeStep]),
		});
	}
	const evidenceAbs = ensureEvidenceDir(repoRoot, evidenceDir);

	const steps: ReleaseCheckStep[] = [
		worktreeStep,
		stepVersionLockstep(repoRoot, evidenceAbs, evidenceDir),
		stepLegacyTokenScan(repoRoot, evidenceAbs, evidenceDir),
		stepDocsAudit(repoRoot, evidenceAbs, evidenceDir),
		stepMarketplaceDistTracked(repoRoot, evidenceAbs, evidenceDir),
		stepTestSuite(repoRoot, evidenceAbs, evidenceDir, dependencies.runTestSuite),
		stepPackPayload(repoRoot, evidenceAbs, evidenceDir, dependencies.runFinalPackGate),
		stepStableSemver(),
		stepShippable(repoRoot),
	];

	const ok = steps.every((s) => s.ok);
	const report: ReleaseChecklistReport = Object.freeze({
		ok,
		version: VERSION,
		publishAttempted: false as const,
		steps: Object.freeze(steps),
	});
	writeFileSync(resolve(evidenceAbs, "task-22-release-check.json"), `${JSON.stringify(report)}\n`);
	return report;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

function parseEvidenceDir(argv: readonly string[]): string | undefined {
	const idx = argv.indexOf("--evidence-dir");
	if (idx >= 0 && argv[idx + 1] !== undefined) return argv[idx + 1];
	return undefined;
}

async function runCli(argv: readonly string[]): Promise<number> {
	const json = argv.includes("--json");
	// npm invokes this compiled CLI from the repository root. Using cwd keeps the CLI independent
	// of the ignored runtime build directory while matching check-version-lockstep's sandboxable
	// command contract.
	const repoRoot = process.cwd();
	const evidenceDir = parseEvidenceDir(argv);
	let report: ReleaseChecklistReport;
	try {
		report = await runReleaseChecklist(repoRoot, evidenceDir ? { evidenceDir } : undefined);
	} catch (err) {
		if (err instanceof ReleaseMetadataError) {
			process.stderr.write(`[release] ${err.code}: ${err.message}\n`);
			return 2;
		}
		throw err;
	}
	if (json) {
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} else {
		for (const s of report.steps) {
			process.stdout.write(`[${s.ok ? "ok" : "FAIL"}] ${s.id} — ${s.summary}\n`);
		}
		process.stdout.write(`release:check: ${report.ok ? "READY" : "BLOCKED"} at ${report.version}\n`);
	}
	return report.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath !== "" && invokedPath === resolve(import.meta.filename)) {
	runCli(process.argv.slice(2)).then((code) => {
		if (code !== 0) process.exitCode = code;
	});
}
