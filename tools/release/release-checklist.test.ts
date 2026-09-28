// tools/release/release-checklist.test.ts — M17 release preflight + metadata suite (Vitest).
//
// RED -> GREEN gate for plan T22. Proves: the checklist aggregates its sub-steps; it NEVER
// references `npm publish` or a registry token in its own source (self-scan); published metadata,
// LICENSE, and CHANGELOG carry no legacy token; CHANGELOG has [Unreleased] + a matching top
// release; the installer package is shippable (no private); the bundled lit-loop component is
// explicitly private; and the provenance/checklist docs encode the guarded human publish path.
// Evidence under .litcodex/evidence/.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveNpmInvocation } from "../../scripts/npm-command.mjs";
import { checkWorktreeClean, runReleaseChecklist } from "./release-checklist.ts";
import { VERSION } from "./version.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../");
const EVIDENCE_DIR = join(REPO_ROOT, ".litcodex", "evidence");

// Legacy tokens assembled from fragments so this source carries no standalone literal and the M04
// scanner never flags it (self-immunity, matching the repo's other token-aware tests).
const LEGACY = [
	["o", "m", "o"].join(""),
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["u", "l", "w"].join(""),
	["ultra", "work"].join(""),
	["oh-my-", "openagent"].join(""),
];
const LEGACY_HOLDER = ["Yeongyu", " ", "Kim"].join("");

function writeEvidence(name: string, body: string): void {
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	writeFileSync(join(EVIDENCE_DIR, name), body.endsWith("\n") ? body : `${body}\n`);
}

function read(rel: string): string {
	return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("#given deterministic Git fixtures #when release worktree cleanliness is checked #then it fails closed", () => {
	it("passes only a clean committed fixture and ignores ignored files", () => {
		const root = makeGitFixture();

		expect(checkWorktreeClean(root)).toMatchObject({ id: "worktree-clean", ok: true, evidencePath: null });
		writeFileSync(join(root, "ignored.log"), "ignored\n");
		expect(checkWorktreeClean(root)).toMatchObject({ id: "worktree-clean", ok: true, evidencePath: null });
	});

	it.each([
		["modified tracked runtime source", (root: string) => writeFileSync(join(root, "src/runtime.ts"), "modified\n")],
		[
			"staged runtime source",
			(root: string) => {
				writeFileSync(join(root, "src/runtime.ts"), "staged\n");
				execFileSync("git", ["add", "src/runtime.ts"], { cwd: root, stdio: "pipe" });
			},
		],
		[
			"untracked runtime source",
			(root: string) => writeFileSync(join(root, "src/untracked-runtime.ts"), "untracked\n"),
		],
	])("rejects %s files before creating evidence", async (_label, mutate) => {
		const root = makeGitFixture();
		mutate(root);

		expect(checkWorktreeClean(root)).toMatchObject({ id: "worktree-clean", ok: false, evidencePath: null });
		const evidenceDir = join(root, "release-evidence");
		const report = await runReleaseChecklist(root, { evidenceDir });
		expect(report).toMatchObject({ ok: false, publishAttempted: false });
		expect(report.steps).toEqual([expect.objectContaining({ id: "worktree-clean", ok: false })]);
		expect(existsSync(evidenceDir)).toBe(false);
	});

	it("removes inherited Git repository/index/object overrides and uses the fixed read-only status invocation", () => {
		const root = makeGitFixture();
		const previousIndex = process.env["GIT_INDEX_FILE"];
		process.env["GIT_INDEX_FILE"] = join(root, "missing-inherited-index");
		try {
			expect(checkWorktreeClean(root).ok).toBe(true);
		} finally {
			if (previousIndex === undefined) delete process.env["GIT_INDEX_FILE"];
			else process.env["GIT_INDEX_FILE"] = previousIndex;
		}

		const src = read("tools/release/release-checklist.ts");
		expect(src).toContain(
			'["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]',
		);
		expect(src).toContain('GIT_OPTIONAL_LOCKS: "0"');
		for (const key of [
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_COMMON_DIR",
			"GIT_INDEX_FILE",
			"GIT_OBJECT_DIRECTORY",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
			"GIT_QUARANTINE_PATH",
			"GIT_CEILING_DIRECTORIES",
			"GIT_DISCOVERY_ACROSS_FILESYSTEM",
		]) {
			expect(src).toContain(`delete env["${key}"]`);
		}
	});

	it("cannot redirect a dirty requested root to a different clean repository", () => {
		const dirtyRoot = makeGitFixture();
		const cleanRoot = makeGitFixture();
		writeFileSync(join(dirtyRoot, "tracked.txt"), "dirty\n");
		const previousDir = process.env["GIT_DIR"];
		const previousWorkTree = process.env["GIT_WORK_TREE"];
		process.env["GIT_DIR"] = join(cleanRoot, ".git");
		process.env["GIT_WORK_TREE"] = cleanRoot;
		try {
			expect(checkWorktreeClean(dirtyRoot)).toMatchObject({ id: "worktree-clean", ok: false });
		} finally {
			if (previousDir === undefined) delete process.env["GIT_DIR"];
			else process.env["GIT_DIR"] = previousDir;
			if (previousWorkTree === undefined) delete process.env["GIT_WORK_TREE"];
			else process.env["GIT_WORK_TREE"] = previousWorkTree;
		}
	});

	it("ignores inherited Git config and disables an injected fsmonitor while still detecting dirt", () => {
		const root = makeGitFixture();
		const injectionDir = join(root, "release-evidence");
		mkdirSync(injectionDir);
		const sentinel = join(injectionDir, "inherited-fsmonitor");
		const marker = join(injectionDir, "fsmonitor-executed.log");
		const injectedConfig = join(injectionDir, "injected.gitconfig");
		writeFileSync(sentinel, `#!/bin/sh\nprintf invoked > '${marker}'\n`);
		chmodSync(sentinel, 0o755);
		writeFileSync(injectedConfig, `[core]\n\tfsmonitor = ${sentinel}\n`);
		writeFileSync(join(root, "src/runtime.ts"), "dirty\n");

		const injected = {
			GIT_CONFIG: injectedConfig,
			GIT_CONFIG_PARAMETERS: `'core.fsmonitor'='${sentinel}'`,
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "core.fsmonitor",
			GIT_CONFIG_VALUE_0: sentinel,
			GIT_CONFIG_SYSTEM: injectedConfig,
			GIT_CONFIG_GLOBAL: injectedConfig,
			GIT_CONFIG_NOSYSTEM: "0",
		};
		const previous = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
		Object.assign(process.env, injected);
		try {
			expect(checkWorktreeClean(root)).toMatchObject({ id: "worktree-clean", ok: false });
			expect(existsSync(marker)).toBe(false);
		} finally {
			for (const [key, value] of Object.entries(previous)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}

		const src = read("tools/release/release-checklist.ts");
		expect(src).toContain('key === "GIT_CONFIG" || key === "GIT_CONFIG_PARAMETERS" || key.startsWith("GIT_CONFIG_")');
		expect(src).toContain(
			'["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]',
		);
	});

	it("returns a normal blocked report for non-Git roots and Git invocation failure", async () => {
		const nonGitRoot = mkdtempSync(join(tmpdir(), "lc-release-non-git-"));
		sandboxes.push(nonGitRoot);
		expect(checkWorktreeClean(nonGitRoot)).toMatchObject({ id: "worktree-clean", ok: false });
		const nonGitEvidence = join(nonGitRoot, "release-evidence");
		const nonGitReport = await runReleaseChecklist(nonGitRoot, { evidenceDir: nonGitEvidence });
		expect(nonGitReport).toMatchObject({ ok: false, publishAttempted: false });
		expect(nonGitReport.steps).toEqual([expect.objectContaining({ id: "worktree-clean", ok: false })]);
		expect(existsSync(nonGitEvidence)).toBe(false);

		const root = makeGitFixture();
		const evidenceDir = join(root, "release-evidence");
		const previousPath = process.env["PATH"];
		process.env["PATH"] = "";
		try {
			expect(checkWorktreeClean(root)).toMatchObject({ id: "worktree-clean", ok: false });
			const report = await runReleaseChecklist(root, { evidenceDir });
			expect(report).toMatchObject({ ok: false, publishAttempted: false });
			expect(report.steps).toEqual([expect.objectContaining({ id: "worktree-clean", ok: false })]);
			expect(existsSync(evidenceDir)).toBe(false);
		} finally {
			if (previousPath === undefined) delete process.env["PATH"];
			else process.env["PATH"] = previousPath;
		}
	});
});

describe("#given the release checklist #when run on the aligned repo #then it aggregates ok steps and never ships", () => {
	it("uses an injected final pack runner without invoking the source-tree pack lifecycle", async () => {
		const root = makeSandbox();
		let packCalls = 0;
		const report = await runReleaseChecklist(
			root,
			{ evidenceDir: ".litcodex/evidence" },
			{
				runTestSuite(requestedRoot) {
					expect(requestedRoot).toBe(root);
					return { error: null, status: 0, stdout: "fixture npm test passed\n", stderr: "" };
				},
				runFinalPackGate(requestedRoot) {
					packCalls += 1;
					expect(requestedRoot).toBe(root);
					return { ok: true, checkedPackages: ["fixture"], filesChecked: 1, issues: [] };
				},
			},
		);

		expect(packCalls).toBe(1);
		expect(report.steps.find((step) => step.id === "pack-payload")).toMatchObject({
			ok: true,
			summary: "final payload gate checked 1 packages and 1 files",
		});
	});

	it("release-check blocks a dirty tree or aggregates all steps after a clean-tree pass", async () => {
		const report = await runReleaseChecklist(REPO_ROOT, undefined, {
			runTestSuite(requestedRoot) {
				expect(requestedRoot).toBe(REPO_ROOT);
				return { error: null, status: 0, stdout: "fixture npm test passed\n", stderr: "" };
			},
			runFinalPackGate(requestedRoot) {
				expect(requestedRoot).toBe(REPO_ROOT);
				return {
					ok: true,
					checkedPackages: ["@litfamily/litcodex", "@litcodex/lit-loop", "@litcodex/wikify-knowledge"],
					filesChecked: 1,
					issues: [],
				};
			},
		});
		expect(report.publishAttempted).toBe(false);
		expect(report.version).toBe(VERSION);
		const ids = report.steps.map((s) => s.id);
		expect(ids[0]).toBe("worktree-clean");
		if (report.steps[0]?.ok) {
			expect(ids).toEqual([
				"worktree-clean",
				"version-lockstep",
				"legacy-token-scan",
				"docs-audit",
				"marketplace-dist-tracked",
				"test-suite",
				"pack-payload",
				"stable-semver",
				"shippable",
			]);
			expect(report.steps.find((step) => step.id === "test-suite")).toMatchObject({
				ok: true,
				summary: "full npm test suite passed",
			});
			expect(report.ok).toBe(true);
			expect(report.steps.every((s) => s.ok)).toBe(true);
		} else {
			expect(ids).toEqual(["worktree-clean"]);
			expect(report.ok).toBe(false);
		}
	}, 30_000);

	it("release-checklist source never references npm publish or a registry token", () => {
		const src = readFileSync(join(HERE, "release-checklist.ts"), "utf8");
		const lockSrc = readFileSync(join(HERE, "check-version-lockstep.ts"), "utf8");
		const versionSrc = readFileSync(join(HERE, "version.ts"), "utf8");
		for (const blob of [src, lockSrc, versionSrc]) {
			expect(/npm\s+publish/i.test(blob)).toBe(false);
			expect(/NPM_TOKEN/.test(blob)).toBe(false);
			expect(/NODE_AUTH_TOKEN/.test(blob)).toBe(false);
		}
		// the literal false invariant is encoded in the source
		expect(src.includes("publishAttempted: false")).toBe(true);
		writeEvidence(
			"task-22-no-publish.txt",
			"tools/release sources: no `npm publish`, no NPM_TOKEN/NODE_AUTH_TOKEN; publishAttempted is literal false\n",
		);
	});
});

describe("#given a failing test suite #when the release checklist runs #then it blocks and records the failure", () => {
	it("rejects a nonzero npm test result", async () => {
		const root = makeSandbox();
		const failureOutput = "fixture npm test failed\n";
		const report = await runReleaseChecklist(
			root,
			{ evidenceDir: "release-evidence" },
			{
				runTestSuite() {
					return { error: null, status: 1, stdout: failureOutput, stderr: "" };
				},
				runFinalPackGate() {
					return { ok: true, checkedPackages: ["fixture"], filesChecked: 1, issues: [] };
				},
			},
		);

		const step = report.steps.find((candidate) => candidate.id === "test-suite");
		expect(step).toMatchObject({
			id: "test-suite",
			ok: false,
			evidencePath: "release-evidence/task-22-test-suite.txt",
		});
		expect(report.ok).toBe(false);
		expect(readFileSync(join(root, "release-evidence", "task-22-test-suite.txt"), "utf8")).toContain(
			failureOutput.trim(),
		);
	});
});

describe("#given local and release command surfaces #when marketplace mode is selected #then only shipping paths require tracked state", () => {
	it("wires ordinary check to candidate mode and keeps only @litfamily/litcodex as the literal publish target", () => {
		const rootPackage = JSON.parse(read("package.json")) as {
			scripts: Record<string, string>;
			workspaces: string[];
		};
		const installerPackage = JSON.parse(read("packages/litcodex-ai/package.json")) as {
			scripts: Record<string, string>;
		};
		const loopPackage = JSON.parse(read("plugins/litcodex/components/lit-loop/package.json")) as {
			private?: boolean;
			scripts: Record<string, string>;
		};

		expect(rootPackage.scripts["check:marketplace-dist"]).toBe("node tools/assert-marketplace-dist.mjs --candidate");
		expect(rootPackage.scripts["check:marketplace-dist:tracked"]).toBe(
			"node tools/assert-marketplace-dist.mjs --tracked",
		);
		expect(rootPackage.scripts["check"]).toMatch(/npm run check:marketplace-dist$/);
		expect(rootPackage.scripts["build:release-tools"]).toBe("tsc -p tools/release/tsconfig.runtime.json");
		// Hooked to test:vitest, not test: tools/release/**/*.test.ts runs the built runtime CLI, and
		// `npm run test:vitest` on a fresh checkout skips a bare `pretest`, leaving those specs red.
		expect(rootPackage.scripts["pretest:vitest"]).toBe("npm run build:release-tools");
		expect(rootPackage.scripts["pretest"]).toBeUndefined();
		expect(rootPackage.scripts["check:version"]).toBe(
			"npm run build:release-tools --silent && node .litcodex/runtime/release-tools/check-version-lockstep.js",
		);
		expect(rootPackage.scripts["release:check"]).toBe(
			"npm run build:release-tools --silent && node .litcodex/runtime/release-tools/release-checklist.js",
		);
		expect(rootPackage.scripts["release"]).toBe("npm publish -w @litfamily/litcodex");
		expect(rootPackage.scripts["release:dry"]).toBe("npm publish -w @litfamily/litcodex --dry-run");
		expect(installerPackage.scripts["prepublishOnly"]).toBe("npm --prefix ../.. run release:check");
		expect(installerPackage.scripts["prepack"]).toBe("node ../../scripts/prepack-bundle-component.mjs");
		expect(read("scripts/prepack-bundle-component.mjs")).toContain(
			'resolveNpmInvocation(["--prefix", REPO_ROOT, "run", "build"])',
		);
		expect(loopPackage.private).toBe(true);
		expect(Object.values(loopPackage.scripts).join("\n")).not.toMatch(/npm\s+publish/i);
		const manifestScripts = ["package.json", ...rootPackage.workspaces.map((path) => `${path}/package.json`)]
			.map((path) => [path, JSON.parse(read(path)) as { scripts?: Record<string, string> }] as const)
			.flatMap(([path, manifest]) =>
				Object.entries(manifest.scripts ?? {}).flatMap(([name, command]) =>
					/npm\s+publish/i.test(command) ? [{ path, name, command }] : [],
				),
			);
		expect(manifestScripts).toEqual([
			{ path: "package.json", name: "release", command: "npm publish -w @litfamily/litcodex" },
			{ path: "package.json", name: "release:dry", command: "npm publish -w @litfamily/litcodex --dry-run" },
		]);

		const checklistSource = read("tools/release/release-checklist.ts");
		expect(checklistSource).toContain('"check:marketplace-dist:tracked"');
		expect(checklistSource).toContain('"tools/pack-all.mjs"');
		expect(checklistSource).toContain('"--require-future"');
		expect(checklistSource).not.toContain('["pack", "--dry-run", "--json", "-w", "packages/litcodex-ai"]');
	});

	it("lets candidate verification inspect dirty runtime but rejects it through the tracked release script", () => {
		const rootPackage = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
		const root = makeMarketplaceSandbox({
			candidate: rootPackage.scripts["check:marketplace-dist"],
			tracked: rootPackage.scripts["check:marketplace-dist:tracked"],
		});
		writeFileSync(join(root, "plugins/litcodex/hooks/hooks.json"), hooksFor("candidate.js"));
		writeFileSync(join(root, "plugins/litcodex/components/probe/dist/candidate.js"), "process.stdin.resume();\n");

		const candidateNpm = resolveNpmInvocation(["run", "candidate"]);
		const candidate = spawnSync(candidateNpm.command, candidateNpm.args, { cwd: root, encoding: "utf8" });
		const trackedNpm = resolveNpmInvocation(["run", "tracked"]);
		const tracked = spawnSync(trackedNpm.command, trackedNpm.args, { cwd: root, encoding: "utf8" });

		expect(candidate.status).toBe(0);
		expect(candidate.stdout).toMatch(/mode=candidate/);
		expect(tracked.status).toBe(1);
		expect(tracked.stderr).toMatch(/mode=tracked/);
		expect(tracked.stderr).toMatch(/untracked|unstaged\/stale|not in the tracked index/i);
	});
});

describe("#given published surfaces #when scanned #then they are LitCodex-native and shippable", () => {
	it("metadata carries no legacy token and is shippable", () => {
		const pkg = JSON.parse(read("packages/litcodex-ai/package.json")) as Record<string, unknown>;
		expect(pkg["name"]).toBe("@litfamily/litcodex");
		expect(pkg["version"]).toBe(VERSION);
		expect(pkg["private"]).toBeUndefined();
		expect(pkg["license"]).toBe("MIT");
		expect(pkg["files"]).toContain("marketplace");
		const blob = JSON.stringify(pkg).toLowerCase();
		for (const t of LEGACY) expect(blob.includes(t)).toBe(false);
		const keywords = pkg["keywords"] as string[];
		expect(keywords).toContain("codex");
		expect(keywords).toContain("litcodex");
		writeEvidence(
			"task-22-package-meta.txt",
			`${JSON.stringify({ name: pkg["name"], version: pkg["version"], private: pkg["private"] ?? null })}\n`,
		);
	});

	it("license carries no legacy holder or token", () => {
		const lic = read("LICENSE");
		expect(lic).toMatch(/MIT License/);
		expect(lic).toContain("LitCodex Authors");
		expect(lic.includes(LEGACY_HOLDER)).toBe(false);
		const lc = lic.toLowerCase();
		for (const t of LEGACY) expect(lc.includes(t)).toBe(false);
		writeEvidence("task-22-legacy-scan.txt", "LICENSE + installer metadata: no legacy token, no legacy holder\n");
	});

	it("changelog has [Unreleased] and a top release equal to VERSION", () => {
		const cl = read("CHANGELOG.md");
		expect(cl).toMatch(/^## \[Unreleased\]/m);
		const top = /^## \[(\d+\.\d+\.\d+)\]/m.exec(cl);
		expect(top?.[1]).toBe(VERSION);
		const lc = cl.toLowerCase();
		for (const t of LEGACY) expect(lc.includes(t)).toBe(false);
		writeEvidence(
			"task-22-changelog.txt",
			`changelog top release = ${top?.[1]} (== VERSION ${VERSION}); [Unreleased] present\n`,
		);
	});

	it("repository metadata matches the verified origin owner, URL, and default branch without placeholders", () => {
		const metadata = read(".github/REPO_METADATA.md");
		expect(metadata).toContain("https://github.com/wjgoarxiv/litcodex");
		expect(metadata).toContain("**Owner**: `wjgoarxiv`");
		expect(metadata).toContain("**Default branch**: `master`");
		expect(metadata).not.toMatch(/<[^>]*PLACEHOLDER[^>]*>/i);
	});
});

describe("#given a publish-intent surface #when audited #then docs match the guarded manual release script", () => {
	it.each([
		"docs/release/provenance.md",
		"docs/release/publish-checklist.md",
	])("%s derives the current release version from the installer manifest", (path) => {
		const doc = read(path);
		expect(doc).toContain(`VERSION="$(node -p 'require("./packages/litcodex-ai/package.json").version')"`);
		expect(doc).not.toMatch(/VERSION=\d+\.\d+\.\d+/);
	});

	const versionExpression = ["$", "{VERSION}"].join("");
	const requiredBootstrapOrder = [
		"npm ci --ignore-scripts",
		"npm run build",
		"git status --short",
		"npm run release:check",
		`npm view "@litfamily/litcodex@${versionExpression}" version --json`,
		"npm whoami",
		"npm run release:dry",
	];

	function freshBootstrapSection(doc: string): string {
		const heading = "## Fresh release bootstrap order";
		const start = doc.indexOf(heading);
		expect(start).toBeGreaterThanOrEqual(0);
		const end = doc.indexOf("\n## ", start + heading.length);
		return doc.slice(start, end === -1 ? undefined : end);
	}

	it("provenance doc names the sole target and keeps trusted publishing conditional on verified availability", () => {
		const doc = read("docs/release/provenance.md");
		expect(doc).toMatch(/trusted publishing/i);
		expect(doc).toMatch(/when.*configured|if.*available/is);
		expect(doc).toMatch(/only.*@litfamily\/litcodex/is);
		expect(doc).toContain("npm run release:dry");
		expect(doc).toContain('npm run release -- --access public --otp="$NPM_OTP"');
		expect(doc).toContain("npm whoami");
		expect(doc).toContain("final user approval");
		expect(doc).toMatch(/--access public/);
		expect(doc.toUpperCase()).toMatch(/DO NOT/);
		expect(doc).not.toContain("nothing in this repository runs `npm publish`");
		writeEvidence(
			"task-22-provenance.txt",
			"provenance.md matches the sole-target release script and guarded manual OTP fallback\n",
		);
	});

	it("publish-checklist mirrors clean-tree, target-absence, authentication, dry-run, and final approval gates", () => {
		const doc = read("docs/release/publish-checklist.md");
		expect(doc).toMatch(/HUMAN-ONLY/);
		expect(doc).toContain("git status --short");
		expect(doc).toContain(`npm view "@litfamily/litcodex@${versionExpression}" version --json`);
		expect(doc).toContain("npm whoami");
		expect(doc).toContain('test -n "$NPM_OTP"');
		expect(doc).toContain("npm run release:dry");
		expect(doc).toContain('npm run release -- --access public --otp="$NPM_OTP"');
		expect(doc).toContain("final user approval");
		expect(doc).toMatch(/check:version/);
		expect(doc).toMatch(/check:marketplace-dist:tracked/);
		expect(doc).toMatch(/marketplace-dist-tracked/);
		expect(doc).toMatch(/docs:audit/);
		expect(doc).toMatch(/release:check/);
		expect(doc).toMatch(/worktree-clean/);
	});

	it.each([
		"docs/release/publish-checklist.md",
		"docs/release/provenance.md",
	])("keeps the fresh bootstrap and release gates ordered in %s", (rel) => {
		const section = freshBootstrapSection(read(rel));
		let cursor = -1;
		for (const command of requiredBootstrapOrder) {
			const next = section.indexOf(command, cursor + 1);
			expect(next, `${command} must appear after the preceding gate in ${rel}`).toBeGreaterThan(cursor);
			cursor = next;
		}
		expect(section).toMatch(/must print nothing|must be empty/i);
		expect(section).toMatch(/removes.*tracked.*picomatch/is);
		expect(section).toMatch(/build.*restores.*deterministically/is);
		expect(section).toMatch(/release:check.*does not.*build.*before.*worktree/is);
	});

	it("documents the unreleased schema-3 lifecycle, CLI hooks, resume grammar, and payload", () => {
		const docs = [
			read("README.md"),
			read("CHANGELOG.md"),
			read("packages/litcodex-ai/README.md"),
			read("plugins/litcodex/components/lit-loop/CHANGELOG.md"),
		].join("\n");
		expect(docs).toMatch(/schema 3/i);
		expect(docs).toMatch(/authority/i);
		expect(docs).toMatch(/init.*transition.*doctor/is);
		expect(docs).toMatch(/UserPromptSubmit/);
		expect(docs).toMatch(/--resume.*--grant/is);
		expect(docs).toMatch(/marketplace payload/i);
	});
});

describe("#given injected drift #when the checklist runs in a sandbox #then the affected step fails", () => {
	it("release-check fails when private is true (shippable step)", async () => {
		const root = makeSandbox();
		patchInstaller(root, (o) => {
			o["private"] = true;
		});
		commitFixture(root, "private installer drift");
		const report = await runReleaseChecklist(root, { evidenceDir: ".litcodex/evidence" });
		const step = report.steps.find((s) => s.id === "shippable");
		expect(step?.ok).toBe(false);
		expect(report.ok).toBe(false);
		writeEvidence(
			"task-22-release-check-negative.txt",
			`private:true => shippable ok=${step?.ok}, report ok=${report.ok}\n`,
		);
	});

	it("release-check fails when the bundled component is not private", async () => {
		const root = makeSandbox();
		patchLoop(root, (o) => {
			o["private"] = false;
		});
		commitFixture(root, "private component drift");
		const report = await runReleaseChecklist(root, { evidenceDir: ".litcodex/evidence" });
		const step = report.steps.find((s) => s.id === "shippable");
		expect(step?.ok).toBe(false);
		expect(step?.summary).toMatch(/bundled.*private/i);
	});
});

// ── sandbox helpers (no node_modules; only the lockstep + metadata-bearing steps exercised) ────

const sandboxes: string[] = [];

function makeGitFixture(): string {
	const root = mkdtempSync(join(tmpdir(), "lc-release-git-"));
	sandboxes.push(root);
	writeFileSync(join(root, ".gitignore"), "*.log\nrelease-evidence/\n");
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src/runtime.ts"), "committed\n");
	execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
	execFileSync("git", ["add", "."], { cwd: root, stdio: "pipe" });
	execFileSync(
		"git",
		["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"],
		{ cwd: root, stdio: "pipe" },
	);
	return root;
}

function makeMarketplaceSandbox(scripts: Record<string, string | undefined>): string {
	const root = mkdtempSync(join(tmpdir(), "lc-release-marketplace-"));
	sandboxes.push(root);
	mkdirSync(join(root, "tools"));
	mkdirSync(join(root, ".agents", "plugins"), { recursive: true });
	mkdirSync(join(root, "plugins", "litcodex", "hooks"), { recursive: true });
	mkdirSync(join(root, "plugins", "litcodex", "components", "probe", "dist"), { recursive: true });
	cpSync(join(REPO_ROOT, "tools", "assert-marketplace-dist.mjs"), join(root, "tools", "assert-marketplace-dist.mjs"));
	writeFileSync(join(root, "package.json"), `${JSON.stringify({ private: true, scripts }, null, "\t")}\n`);
	writeFileSync(join(root, ".agents", "plugins", "marketplace.json"), "{}\n");
	writeFileSync(join(root, "plugins", "litcodex", "hooks", "hooks.json"), hooksFor("tracked.js"));
	writeFileSync(
		join(root, "plugins", "litcodex", "components", "probe", "dist", "tracked.js"),
		"process.stdin.resume();\n",
	);
	execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
	execFileSync("git", ["add", "."], { cwd: root, stdio: "pipe" });
	execFileSync(
		"git",
		["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"],
		{ cwd: root, stdio: "pipe" },
	);
	return root;
}

function hooksFor(runtime: string): string {
	return `${JSON.stringify(
		{
			hooks: {
				UserPromptSubmit: [
					{
						hooks: [
							{
								type: "command",
								command: `node "\${PLUGIN_ROOT}/components/probe/dist/${runtime}" hook user-prompt-submit`,
							},
						],
					},
				],
			},
		},
		null,
		2,
	)}\n`;
}

function makeSandbox(): string {
	const root = mkdtempSync(join(tmpdir(), "lc-release-"));
	sandboxes.push(root);
	// Copy both package-policy manifests so the `shippable` step has real targets; the other
	// steps tolerate absence (pack/lockstep fail closed, which is fine for a negative test).
	mkdirSync(join(root, "packages", "litcodex-ai"), { recursive: true });
	cpSync(
		join(REPO_ROOT, "packages", "litcodex-ai", "package.json"),
		join(root, "packages", "litcodex-ai", "package.json"),
	);
	mkdirSync(join(root, "plugins", "litcodex", "components", "lit-loop"), { recursive: true });
	cpSync(
		join(REPO_ROOT, "plugins", "litcodex", "components", "lit-loop", "package.json"),
		join(root, "plugins", "litcodex", "components", "lit-loop", "package.json"),
	);
	mkdirSync(join(root, "tools"), { recursive: true });
	cpSync(join(REPO_ROOT, "tools", "scan-legacy-tokens.mjs"), join(root, "tools", "scan-legacy-tokens.mjs"));
	mkdirSync(join(root, ".litcodex", "evidence"), { recursive: true });
	execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
	commitFixture(root, "fixture");
	return root;
}

function commitFixture(root: string, message: string): void {
	execFileSync("git", ["add", "."], { cwd: root, stdio: "pipe" });
	execFileSync(
		"git",
		["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", message],
		{ cwd: root, stdio: "pipe" },
	);
}

function patchInstaller(root: string, mutate: (o: Record<string, unknown>) => void): void {
	const abs = join(root, "packages", "litcodex-ai", "package.json");
	const obj = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
	mutate(obj);
	writeFileSync(abs, `${JSON.stringify(obj, null, "\t")}\n`);
}

function patchLoop(root: string, mutate: (o: Record<string, unknown>) => void): void {
	const abs = join(root, "plugins", "litcodex", "components", "lit-loop", "package.json");
	const obj = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
	mutate(obj);
	writeFileSync(abs, `${JSON.stringify(obj, null, "\t")}\n`);
}

afterAll(() => {
	for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});
