// tools/assert-git-hygiene.test.mjs — node:test suite for the M19 git-hygiene asserter (T28).
//
// The git-hygiene gate (S19 §Operation-C, §Failure-modes #7/#8/#11) proves no LOCAL artifact
// (.litcodex/, # REFERENCE/, *.tgz, HANDOFF, /evidence/, /.qa-tmp/, plus built-in assembled terms) is ever tracked by git,
// while STILL allowing legitimately-committed build/config artifacts (dist/**, tsconfig*,
// vitest.config*) that the PACKAGING gate forbids in the tarball but git tolerates in the tree.
//
// `assertGitHygiene` is pure and exercised directly with stubbed tracked-file lists. `listTrackedFiles`
// is exercised against a throwaway git repo and a non-git dir (must throw, never vacuously pass).
//
// Legacy denylist substrings used in fixtures are assembled from fragments so this test file never
// trips scan:legacy-tokens (S19 §Test-plan).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertGitHygiene,
	GitHygieneError,
	listTrackedFiles,
	loadGitForbiddenSegments,
	loadGitHygienePolicy,
} from "./assert-git-hygiene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "pack-payload-manifest.json");
const HISTORICAL_SEGMENT = [".o", "mo", "/"].join(""); // assembled historical state path segment

const GIT_FORBIDDEN = loadGitForbiddenSegments(MANIFEST_PATH);
const GIT_POLICY = loadGitHygienePolicy(MANIFEST_PATH);

// --- manifest gitForbiddenSegments is the dedicated tracked-file denylist (NOT the tarball one) ---

test("loadGitForbiddenSegments returns the dedicated tracked-file denylist (no dist/tsconfig)", () => {
	const set = new Set(GIT_FORBIDDEN);
	for (const seg of [HISTORICAL_SEGMENT, ".litcodex/", "# REFERENCE", ".tgz", "/evidence/"]) {
		assert.ok(set.has(seg), `gitForbiddenSegments must contain ${seg}`);
	}
	assert.ok(!set.has("HANDOFF"), "HANDOFF must be governed by a scoped rule");
	// dist/tsconfig/vitest.config are forbidden in the TARBALL but legitimately tracked in git.
	assert.ok(!set.has("dist/**"), "git gate must NOT forbid tracked dist/**");
	assert.ok(!GIT_FORBIDDEN.some((s) => s.includes("tsconfig")), "git gate must NOT forbid tracked tsconfig");
	assert.ok(!GIT_FORBIDDEN.some((s) => s.includes("vitest.config")), "git gate must NOT forbid tracked vitest.config");
});

// --- pure reconciliation: clean tree, offenders, dist allowed -----------------------------------

test("repository coverage paths are tracked product-development inputs, not git-hygiene leaks", () => {
	const tracked = [
		"package.json",
		"tools/assert-git-hygiene.mjs",
		"tools/assert-git-hygiene.test.mjs",
		"packages/litcodex-ai/test/fixtures/sample-config.toml",
		"plugins/litcodex/skills/visual-qa/test/browser-contract.ts",
		"plugins/litcodex/vendor/scientific-visualization/tests/test_style_presets.py",
		"packages/litcodex-ai/src/install/install-test-helpers.ts",
		"plugins/litcodex/components/lit-loop/dist/cli.js",
		"packages/litcodex-ai/tsconfig.json",
		"vitest.config.ts",
		"README.md",
	];
	const report = assertGitHygiene(tracked, GIT_FORBIDDEN);
	assert.equal(report.ok, true, JSON.stringify(report.offenders));
	assert.equal(report.trackedCount, tracked.length);
	assert.equal(report.offenders.length, 0);
});

test("tracked historical state artifact rejected (assembled fixture)", () => {
	const tracked = ["package.json", `${HISTORICAL_SEGMENT}evidence/task-28-pack-final.json`];
	const report = assertGitHygiene(tracked, GIT_FORBIDDEN);
	assert.equal(report.ok, false);
	const offender = report.offenders.find((o) => o.path === `${HISTORICAL_SEGMENT}evidence/task-28-pack-final.json`);
	assert.ok(offender, "expected the assembled artifact to be an offender");
	assert.equal(offender.segment, HISTORICAL_SEGMENT);
});

test("tracked .litcodex runtime/evidence artifact rejected", () => {
	const tracked = ["package.json", ".litcodex/evidence/task-28.txt", ".litcodex/lit-loop/goals.json"];
	const report = assertGitHygiene(tracked, GIT_FORBIDDEN);
	assert.equal(report.ok, false);
	assert.equal(report.offenders.length, 2);
	assert.ok(report.offenders.every((o) => o.segment === ".litcodex/"));
});

test("tracked # REFERENCE archive rejected (hash + space byte-exact)", () => {
	const p = `# REFERENCE/${["lazy", "codex"].join("")}-main/package.json`;
	const report = assertGitHygiene(["package.json", p], GIT_FORBIDDEN);
	assert.equal(report.ok, false);
	const offender = report.offenders.find((o) => o.path === p);
	assert.equal(offender.segment, "# REFERENCE", "path preserved byte-exact, # + space survive");
});

test("tracked .tgz and HANDOFF rejected", () => {
	const report = assertGitHygiene(
		["litcodex-ai-0.1.0.tgz", "HANDOFF.md", "package.json"],
		GIT_POLICY.forbiddenSegments,
		GIT_POLICY.forbiddenSegmentRules,
	);
	const paths = report.offenders.map((o) => o.path);
	assert.ok(paths.includes("litcodex-ai-0.1.0.tgz"));
	assert.ok(paths.includes("HANDOFF.md"));
});

test("only the two canonical authored handoff files bypass git hygiene", () => {
	const canonical = [
		"plugins/litcodex/vendor/handoff/templates/HANDOFF.md",
		"plugins/litcodex/vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
	];
	const clean = assertGitHygiene(
		["package.json", ...canonical],
		GIT_POLICY.forbiddenSegments,
		GIT_POLICY.forbiddenSegmentRules,
	);
	assert.equal(clean.ok, true, JSON.stringify(clean.offenders));

	for (const path of [
		"HANDOFF.md",
		"plugins/litcodex/skills/lit-handoff/HANDOFF.md",
		"docs/HANDOFF.md",
		`${canonical[0]}.bak`,
	]) {
		const report = assertGitHygiene([path], GIT_POLICY.forbiddenSegments, GIT_POLICY.forbiddenSegmentRules);
		assert.equal(report.ok, false, path);
	}
});

test("tracked dist/** is ALLOWED (committed build artifact, not in gitForbidden)", () => {
	const report = assertGitHygiene(["plugins/litcodex/components/lit-loop/dist/cli.js"], GIT_FORBIDDEN);
	assert.equal(report.ok, true, "committed component dist must NOT be a git-hygiene offender");
});

// --- listTrackedFiles: real git repo (clean) + non-git dir (must throw, never vacuous) ----------

function gitInit(dir) {
	spawnSync("git", ["init", "-q"], { cwd: dir });
	spawnSync("git", ["config", "user.email", "t@t"], { cwd: dir });
	spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
}

test("listTrackedFiles enumerates tracked paths in a real git repo (z-delimited, no trailing empty)", () => {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-hygiene-"));
	try {
		gitInit(dir);
		writeFileSync(join(dir, "a.txt"), "a");
		writeFileSync(join(dir, "b with space.txt"), "b");
		spawnSync("git", ["add", "-A"], { cwd: dir });
		const files = listTrackedFiles(dir);
		assert.deepEqual([...files].sort(), ["a.txt", "b with space.txt"]);
		assert.ok(!files.includes(""), "must drop the trailing empty token from -z output");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("listTrackedFiles throws LITCODEX_HYGIENE_NOT_GIT_REPO outside a checkout (never vacuous pass)", () => {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-nongit-"));
	try {
		assert.throws(
			() => listTrackedFiles(dir),
			(e) => e instanceof GitHygieneError && e.code === "LITCODEX_HYGIENE_NOT_GIT_REPO",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
