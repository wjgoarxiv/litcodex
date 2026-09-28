// scripts/path-robustness/path-robustness.test.mjs — M20 harness self-tests (node:test, plan T24).
//
// Runs under `node --test`. Covers: the static path-fragility scanner (flags a planted .pathname
// fixture / a planted reporoot-from-module-url, is clean on the real src, ignores test files + dist +
// `# REFERENCE/`, throws on a missing root); and the full harness on the real built artifacts (all
// cases pass, install dry-run asserts the SELF-CONTAINED M12 plan per A3 D1, directive loads from the
// hostile-path staged layout per G6). Requires `npm run build` to have produced dist/ first.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { PathRobustnessError } from "./errors.mjs";
import { expectedInstallPlan } from "./install-plan.mjs";
import { defaultScanRoots, scanForbiddenPathPatterns } from "./no-import-meta-pathname.mjs";
import { runPathRobustness } from "./runner.mjs";

const repoRoot = process.cwd();

describe("static path-fragility scanner", () => {
	let fixtureRoot;
	before(async () => {
		fixtureRoot = await mkdtemp(join(tmpdir(), "lit-scan-"));
	});
	after(async () => {
		await rm(fixtureRoot, { recursive: true, force: true });
	});

	it("flags a planted import.meta.url .pathname line (IMPORT_META_PATHNAME)", async () => {
		const file = join(fixtureRoot, "planted-pathname.ts");
		await writeFile(file, 'const p = new URL("..", import.meta.url).pathname;\nexport const x = p;\n', "utf8");
		const hits = await scanForbiddenPathPatterns([fixtureRoot], repoRoot);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].rule, "IMPORT_META_PATHNAME");
		await rm(file, { force: true });
	});

	it("flags a planted repoRoot-from-module-url line (REPOROOT_FROM_MODULE_URL)", async () => {
		const file = join(fixtureRoot, "planted-reporoot.ts");
		await writeFile(file, "const repoRoot = fileURLToPath(import.meta.url);\nexport const r = repoRoot;\n", "utf8");
		const hits = await scanForbiddenPathPatterns([fixtureRoot], repoRoot);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].rule, "REPOROOT_FROM_MODULE_URL");
		await rm(file, { force: true });
	});

	it("ignores *.test.ts files using fileURLToPath / .pathname", async () => {
		const file = join(fixtureRoot, "planted.test.ts");
		await writeFile(file, 'const p = new URL("..", import.meta.url).pathname;\nexport const x = p;\n', "utf8");
		const hits = await scanForbiddenPathPatterns([fixtureRoot], repoRoot);
		assert.equal(hits.length, 0);
		await rm(file, { force: true });
	});

	it("is clean on the real LitCodex src/bin roots", async () => {
		const hits = await scanForbiddenPathPatterns(defaultScanRoots(repoRoot), repoRoot);
		assert.deepEqual(hits, []);
	});

	it("throws LIT_PATHROBUST_SCAN_ROOT_MISSING for a missing root", async () => {
		await assert.rejects(
			() => scanForbiddenPathPatterns([join(repoRoot, "no-such-root-xyz")], repoRoot),
			(err) => err instanceof PathRobustnessError && err.code === "LIT_PATHROBUST_SCAN_ROOT_MISSING",
		);
	});
});

describe("install-plan expectation (A3 D1 self-contained, not forwarder)", () => {
	it("derives the M12 header + ordered titles from the built dist", () => {
		const plan = expectedInstallPlan(repoRoot);
		assert.equal(plan.header, "litcodex install plan (Codex)");
		assert.ok(plan.titles.length >= 5);
		assert.match(plan.titles[0], /^Add LitCodex marketplace:/);
		assert.equal(plan.titles[plan.titles.length - 1], "Verify: litcodex doctor");
		assert.ok(!plan.titles.some((t) => /\bnpx\b/.test(t)), "no npx forwarder token in any title");
	});
});

describe("full path-robustness suite on built artifacts", () => {
	it("runs every hostile-path case all-pass with scan clean (report.ok === true)", async () => {
		const report = await runPathRobustness({ keepWorkspaces: false });
		assert.equal(report.scan.ok, true, `scan hits: ${JSON.stringify(report.scan.hits)}`);
		const firstFail = report.cases.find((c) => !c.ok);
		assert.equal(
			report.ok,
			true,
			firstFail ? `case ${firstFail.label} failed: ${JSON.stringify(firstFail)}` : "report not ok",
		);
	});

	it("install dry-run is the SELF-CONTAINED M12 plan with no npx and no legacy tokens (A3 D1)", async () => {
		const report = await runPathRobustness({ only: "space-hash-hangul" });
		const c = report.cases.find((x) => x.label === "space-hash-hangul");
		assert.ok(c, "space-hash-hangul case present");
		const probe = c.probes.find((p) => p.probe === "install-dry-run");
		assert.equal(probe.ok, true, `install-dry-run failures: ${JSON.stringify(probe.failures)}`);
		assert.match(probe.stdout, /litcodex install plan \(Codex\)/);
		assert.ok(!/\bnpx\b/.test(probe.stdout), "no npx forwarder line");
	});

	it("hook-activate loads the directive from the hostile-path staged ../directive.md (G6)", async () => {
		const report = await runPathRobustness({ only: "hash" });
		const c = report.cases.find((x) => x.label === "hash");
		const probe = c.probes.find((p) => p.probe === "hook-activate");
		assert.equal(probe.ok, true, `hook-activate failures: ${JSON.stringify(probe.failures)}`);
		assert.match(probe.stdout, /<lit-loop-mode>/);
		assert.ok(probe.stdout.includes("🔥 **LIT IGNITED · lit-loop** 🔥"));
	});
});
