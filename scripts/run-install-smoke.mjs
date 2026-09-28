#!/usr/bin/env node
// Packed, isolated install-smoke orchestrator. Each phase owns one runtime responsibility.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { isMain } from "../plugins/litcodex/skills/visual-qa/scripts/strict-input.mjs";
import { runCliPhase } from "./install-smoke-cli-phase.mjs";
import { runInstallPhase } from "./install-smoke-install-phase.mjs";
import { runPackagePhase } from "./install-smoke-package-phase.mjs";
import {
	createRecorder,
	diffSnapshots,
	isAmbientCodexNoise,
	run,
	sandboxEnv,
	snapshotTree,
} from "./install-smoke-runtime.mjs";

const repoRoot = process.cwd();
const evidenceDir = join(repoRoot, ".litcodex/evidence");
const litcodexBin = join(repoRoot, "packages/litcodex-ai/bin/litcodex.js");
const modelCatalogSrc = join(repoRoot, "packages/litcodex-ai/model-catalog.json");
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "packages/litcodex-ai/package.json"), "utf8")).version;
const fakeCodexVersion = process.env.LIT_QA_CODEX_VERSION ?? "0.144.0";
const expectedConcurrencyStatus = ["0.144.0", "0.144.1"].includes(fakeCodexVersion) ? "hard" : "advisory";

export { run, sandboxEnv } from "./install-smoke-runtime.mjs";

function fakeCodexSource(logPath) {
	return `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, args.join(" ") + "\\n");
if (args.includes("--version")) {
  process.stdout.write(${JSON.stringify(`codex-cli ${fakeCodexVersion}\n`)});
} else if (args[0] === "debug" && args[1] === "models") {
  process.stdout.write(JSON.stringify({ models: [
    { slug: "gpt-5.6", context_window: 372000 },
    { slug: "gpt-5.6-sol", context_window: 372000 },
    { slug: "gpt-5.6-terra", context_window: 372000 },
    { slug: "gpt-5.6-luna", context_window: 372000 }
  ] }));
} else if (args.includes("doctor") && args.includes("--json")) {
  process.stdout.write(JSON.stringify({ checks: { "config.load": { status: "ok" } } }));
}
process.exit(0);
`;
}

function recordRealHomeProtection(context, realState) {
	const realCodexAfter = snapshotTree(realState.codexHome);
	const realConfigAfter = existsSync(realState.config) ? readFileSync(realState.config, "utf8") : null;
	const allTreeDelta = diffSnapshots(realState.treeBefore, realCodexAfter);
	const ambientRuntimeDelta = allTreeDelta.filter(isAmbientCodexNoise);
	const treeDelta = allTreeDelta.filter((relativePath) => !isAmbientCodexNoise(relativePath));
	const configChanged = realState.configBefore !== realConfigAfter;
	const breaches = [];
	if (treeDelta.length > 0) breaches.push(`real CODEX_HOME tree changed: ${treeDelta.join(", ")}`);
	if (configChanged) breaches.push("real ~/.codex/config.toml content changed");
	context.writeEvidence(
		"task-26-home-untouched.txt",
		[
			`realHome=${realState.home}`,
			`realCodexHome=${realState.codexHome}`,
			`realCodexConfigExists=${realState.configBefore !== null}`,
			`ambientRuntimeDelta=[${ambientRuntimeDelta.join(", ")}]`,
			`treeDelta=[${treeDelta.join(", ")}]`,
			`configChanged=${configChanged}`,
			breaches.length === 0
				? "RESULT: no unexpected home/config changes; known Codex runtime deltas are listed separately"
				: `RESULT: HERMETICITY BREACH — ${breaches.join("; ")}`,
			"",
		].join("\n"),
	);
	if (breaches.length > 0) context.recordBreach("real-home-untouched", breaches);
	else context.record("real-home-untouched", []);
}

function finishReport(context) {
	const fakeArgv = existsSync(context.fakeCodexLog)
		? readFileSync(context.fakeCodexLog, "utf8").trim()
		: "(not invoked)";
	context.writeEvidence("task-26-stub-codex.txt", `fakeCodex=${context.fakeCodex}\ninvocations=\n${fakeArgv}\n`);
	context.record("sandbox-containment", []);
	const lines = [];
	let passed = 0;
	const breach = context.probes.some((probe) => probe.hermeticBreach);
	for (const probe of context.probes) {
		if (probe.ok) {
			passed += 1;
			lines.push(`PASS ${probe.name}`);
		} else {
			lines.push(`FAIL ${probe.name}: ${(probe.failures ?? []).join("; ")}`);
		}
	}
	lines.push(`litcodex install-smoke: ${passed}/${context.probes.length} passed`);
	const report = `${lines.join("\n")}\n`;
	process.stdout.write(report);
	context.writeEvidence("task-26-install-smoke.txt", report);
	const exitCode = breach ? 5 : passed === context.probes.length ? 0 : 1;
	context.writeEvidence(
		"task-26-install-smoke.json",
		`${JSON.stringify(
			{
				runner: "install-smoke",
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				ok: exitCode === 0,
				exitCode,
				probes: context.probes.map((probe) => ({
					name: probe.name,
					ok: probe.ok,
					...(typeof probe.exitCode === "number" ? { exitCode: probe.exitCode } : {}),
					failures: probe.failures ?? [],
				})),
				sandbox: { home: context.home, codexHome: context.codexHome, npmPrefix: context.npmPrefix },
				hermetic: {
					ok: !breach,
					strayWrites: breach
						? context.probes.filter((probe) => probe.hermeticBreach).flatMap((probe) => probe.failures)
						: [],
				},
			},
			null,
			2,
		)}\n`,
	);
	return exitCode;
}

export function main() {
	mkdirSync(evidenceDir, { recursive: true });
	for (const artifact of [litcodexBin, modelCatalogSrc]) {
		if (!existsSync(artifact)) {
			process.stderr.write(
				`${JSON.stringify({ ok: false, error: { code: "LIT_QA_ARTIFACT_MISSING", artifact } })}\n`,
			);
			process.exit(3);
		}
	}
	const realHome = homedir();
	const realCodexHome = process.env.CODEX_HOME?.trim() ? process.env.CODEX_HOME : join(realHome, ".codex");
	const realConfig = join(realCodexHome, "config.toml");
	const realState = {
		home: realHome,
		codexHome: realCodexHome,
		config: realConfig,
		treeBefore: snapshotTree(realCodexHome),
		configBefore: existsSync(realConfig) ? readFileSync(realConfig, "utf8") : null,
	};
	let sbRoot;
	try {
		sbRoot = mkdtempSync(join(tmpdir(), "lit-install-smoke-"));
	} catch (error) {
		process.stderr.write(
			`${JSON.stringify({ ok: false, error: { code: "LIT_QA_SANDBOX_FAILED", message: String(error?.message ?? error) } })}\n`,
		);
		process.exit(4);
	}
	let exitCode = 1;
	try {
		const home = join(sbRoot, "home");
		const codexHome = join(home, ".codex");
		const npmPrefix = join(sbRoot, "npm-prefix");
		const packDest = process.env.LIT_QA_PACK_DEST ?? join(sbRoot, "pack");
		const fakeBinDir = join(sbRoot, "fake-bin");
		const projectDir = join(home, "project");
		for (const dir of [home, codexHome, npmPrefix, packDest, fakeBinDir, projectDir])
			mkdirSync(dir, { recursive: true });
		const fakeCodexLog = join(sbRoot, "fake-codex-argv.log");
		const fakeCodex = join(fakeBinDir, "codex");
		writeFileSync(fakeCodex, fakeCodexSource(fakeCodexLog));
		chmodSync(fakeCodex, 0o755);
		const env = sandboxEnv(home, codexHome, npmPrefix, fakeBinDir);
		const sandboxBin = join(npmPrefix, "bin");
		const recorder = createRecorder(evidenceDir);
		const context = {
			...recorder,
			repoRoot,
			evidenceDir,
			sbRoot,
			home,
			codexHome,
			npmPrefix,
			packDest,
			projectDir,
			fakeCodex,
			fakeCodexLog,
			env,
			sandboxBin,
			installedPkg: join(npmPrefix, "lib", "node_modules", "@litfamily", "litcodex"),
			packageVersion,
			fakeCodexVersion,
			expectedConcurrencyStatus,
			run,
			runLitcodex(args, extraEnv) {
				const commandEnv = { ...env, PATH: `${sandboxBin}:${env.PATH}`, ...(extraEnv ?? {}) };
				const argv = args.map((arg) => `'${String(arg).replace(/'/g, "'\\''")}'`).join(" ");
				return run("sh", ["-c", `litcodex ${argv}`], { cwd: projectDir, env: commandEnv });
			},
		};
		runPackagePhase(context);
		runCliPhase(context);
		runInstallPhase(context);
		recordRealHomeProtection(context, realState);
		exitCode = finishReport(context);
	} finally {
		rmSync(sbRoot, { recursive: true, force: true });
		const removed = !existsSync(sbRoot);
		writeFileSync(
			join(evidenceDir, "task-26-cleanup.txt"),
			`tempRoot=${sbRoot}\nremoved=${removed}\ntarball + npm-prefix + home + codexHome + packDest all under tempRoot\n`,
		);
		if (!removed) process.stderr.write(`[install-smoke] WARNING: temp root not removed: ${sbRoot}\n`);
	}
	process.exit(exitCode);
}

if (isMain(import.meta.url)) main();
