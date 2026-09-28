// tools/assert-pack-payload.test.mjs — node:test suite for the M19 payload asserter (T08).
//
// Covers S19 + addendum payload assertions, with NEGATIVE rows proving a synthetic tarball entry
// carrying a forbidden path (.litcodex/evidence/x, test/foo.test.ts, # REFERENCE, .tgz, …) is
// rejected with LITCODEX_PACK_FORBIDDEN_PATH, and forbidden-beats-allowed precedence.
//
// Legacy denylist substrings used in fixtures are assembled from fragments so this test file never
// trips scan:legacy-tokens (S19 §Test-plan).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCanonicalCorpus } from "../plugins/litcodex/skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs";
import { readWorkspaceBinDeclarations } from "../scripts/mark-cli-executable.mjs";
import { resolveNpmInvocation } from "../scripts/npm-command.mjs";
import {
	assertPackage,
	assertPayload,
	firstForbiddenSegment,
	loadPayloadManifest,
	PackPayloadError,
	parsePackJson,
	pathMatchesGlob,
} from "./assert-pack-payload.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "pack-payload-manifest.json");
const HISTORICAL_SEGMENT = [".o", "mo", "/"].join(""); // assembled historical state path segment

const manifest = loadPayloadManifest(MANIFEST_PATH);
const binsByPackage = new Map(
	readWorkspaceBinDeclarations(resolve(HERE, "..")).map((workspace) => [workspace.name, workspace.binPaths]),
);

/** Per-package rule lookup, for single-package reconciliation via assertPackage. */
function ruleFor(name) {
	const r = manifest.packages.find((p) => p.name === name);
	if (!r) throw new Error(`no rule for ${name}`);
	return r;
}

/** Reconcile ONE result against its rule (no dead-rule logic — that lives in assertPayload). */
function checkOne(result, opts = {}) {
	const issues = assertPackage(
		result,
		ruleFor(result.name),
		manifest.forbiddenSegments,
		manifest.forbiddenSegmentRules ?? [],
		opts,
	);
	return { ok: issues.length === 0, issues };
}

/** Build a minimal PackResult with the given file paths. */
function packResult(name, paths, extra = {}) {
	const executablePaths = new Set(binsByPackage.get(name) ?? []);
	const files = paths.map((p) => ({ path: p, size: 1, mode: executablePaths.has(p) ? 493 : 420 }));
	return {
		name,
		version: "0.1.0",
		filename: `${name.replace("/", "-")}-0.1.0.tgz`,
		files,
		entryCount: files.length,
		bundled: [],
		binPaths: [...executablePaths],
		...extra,
	};
}

function requiredPackResult(name, extraPaths = [], extra = {}) {
	return packResult(name, [...new Set([...ruleFor(name).requiredPaths, ...extraPaths])], extra);
}

function componentPackResult(extraPaths = [], extra = {}) {
	return requiredPackResult("@litcodex/lit-loop", extraPaths, extra);
}

test("documentation artwork and release operations are forbidden even under a broad runtime glob", () => {
	for (const path of [
		"cover.png",
		"docs/assets/cover.svg",
		"docs/assets/cover.webp",
		"docs/assets/cover-motion.webp",
		"docs/assets/readme/ascii-readme.svg",
		"docs/assets/readme/badge-version.svg",
		"docs/assets/readme/badge-license.svg",
		"docs/assets/readme/lucide-book-open.svg",
		"docs/assets/readme/lucide-play.svg",
		"docs/assets/readme/lucide-shield-check.svg",
		"docs/assets/readme/Lucide-LICENSE.txt",
		"docs/assets/readme/JetBrainsMono-OFL.txt",
		"docs/assets/readme/ignition-poster.png",
		"docs/assets/readme/ignition-film.mp4",
		"docs/assets/readme/ignition-readme.gif",
		"docs/assets/readme/README.md",
		"generate_cover.py",
		"docs/release/publish-checklist.md",
		"RELEASE_CHECKLIST.md",
		"marketplace/plugins/litcodex/docs/assets/cover.svg",
		"marketplace/plugins/litcodex/docs/assets/cover.webp",
	]) {
		assert.ok(
			firstForbiddenSegment(path, manifest.forbiddenSegments, manifest.forbiddenSegmentRules),
			`forbidden pack asset: ${path}`,
		);
	}
	assert.equal(
		firstForbiddenSegment("readme-assets/cover.webp", manifest.forbiddenSegments, manifest.forbiddenSegmentRules),
		null,
		"published landing cover stays packable",
	);
	assert.equal(
		firstForbiddenSegment(
			"readme-assets/cover-motion.webp",
			manifest.forbiddenSegments,
			manifest.forbiddenSegmentRules,
		),
		null,
		"published moving cover stays packable",
	);
	const icon = "marketplace/plugins/litcodex/assets/logo.png";
	assert.equal(firstForbiddenSegment(icon, manifest.forbiddenSegments), null);
	assert.ok(ruleFor("@litfamily/litcodex").requiredPaths.includes(icon), "small native icon remains required");
});

test("real root dry pack excludes source artwork and release docs while retaining native runtime", () => {
	const root = resolve(HERE, "..");
	mkdirSync(resolve(root, ".litcodex"), { recursive: true });
	const scratch = mkdtempSync(resolve(root, ".litcodex/pack-artwork-test-"));
	try {
		const npm = resolveNpmInvocation(["pack", "--dry-run", "--json", "--ignore-scripts"]);
		const result = spawnSync(npm.command, npm.args, {
			cwd: root,
			env: { ...process.env, npm_config_cache: resolve(scratch, "npm-cache") },
			encoding: "utf8",
			timeout: 30_000,
			maxBuffer: 8 * 1024 * 1024,
		});
		assert.equal(result.status, 0, result.stderr || result.error?.message);
		const [packed] = parsePackJson(result.stdout);
		const files = packed.files.map(({ path }) => path);
		assert.deepEqual(
			files.filter(
				(path) =>
					[
						"cover.png",
						"cover.webp",
						"generate_cover.py",
						"docs/assets/",
						"docs/release/",
						"RELEASE_CHECKLIST.md",
					].some((segment) => path.includes(segment)) && path !== "packages/litcodex-ai/readme-assets/cover.webp",
			),
			[],
		);
		assert.ok(files.includes("packages/litcodex-ai/readme-assets/cover.webp"));
		assert.ok(files.includes("packages/litcodex-ai/readme-assets/cover-motion.webp"));
		for (const path of [
			"plugins/litcodex/assets/logo.png",
			"plugins/litcodex/components/lit-loop/dist/cli.js",
			"plugins/litcodex/components/rules/node_modules/picomatch/index.js",
			"plugins/litcodex/vendor/handoff/templates/HANDOFF.md",
		])
			assert.ok(files.includes(path), `required native payload: ${path}`);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});

// --- glob matcher -------------------------------------------------------------------------------

test("pathMatchesGlob: ** matches any depth including the bundled node_modules subtree", () => {
	assert.equal(pathMatchesGlob("dist/cli.js", "dist/**"), true);
	assert.equal(pathMatchesGlob("dist/a/b/c.js", "dist/**"), true);
	assert.equal(
		pathMatchesGlob("node_modules/@litcodex/lit-loop/dist/cli.js", "node_modules/@litcodex/lit-loop/**"),
		true,
	);
	assert.equal(pathMatchesGlob("bin/litcodex.js", "bin/**"), true);
	assert.equal(pathMatchesGlob("README.md", "README.md"), true);
	assert.equal(pathMatchesGlob("CHANGELOG.md", "README.md"), false);
	assert.equal(pathMatchesGlob("src/other/x.js", "dist/**"), false);
	// `**` matches zero segments → `dist/**` must NOT match a bare `dist` with no child, but DOES
	// match `dist/x`. The bundled glob must not leak to a different scope.
	assert.equal(pathMatchesGlob("node_modules/evil/index.js", "node_modules/@litcodex/lit-loop/**"), false);
});

// --- clean payloads (present mode = T08 gate) --------------------------------------------------

test("clean installer payload passes with runtime required and README/LICENSE deferred", () => {
	// A3 G7: model-catalog.json is a requiredPath (the catalog.js runtime import must ship).
	const r = requiredPackResult("@litfamily/litcodex", ["dist/cli.js", "README.md", "LICENSE"]);
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

test("installer payload with required runtime passes without enforcing unrelated requiredFuture content", () => {
	const r = requiredPackResult("@litfamily/litcodex", ["dist/cli.d.ts", "dist/cli.js"]);
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

test("installer with bundled node_modules/@litcodex/lit-loop passes (D1 bundledDependency)", () => {
	const r = requiredPackResult("@litfamily/litcodex", [
		"dist/cli.js",
		"node_modules/@litcodex/lit-loop/dist/cli.js",
		"node_modules/@litcodex/lit-loop/package.json",
	]);
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

test("exact file-set rules reject extras even when a broad package glob allows them", () => {
	const rule = {
		name: "@litfamily/litcodex",
		requiredPaths: ["package.json"],
		allowedGlobs: ["**"],
		exactFileSets: [{ prefix: "marketplace/skill/original/", allowedPaths: ["SKILL.md"] }],
	};
	const r = packResult("@litfamily/litcodex", [
		"package.json",
		"marketplace/skill/original/SKILL.md",
		"marketplace/skill/original/rogue.txt",
	]);
	const issues = assertPackage(r, rule, [], []);
	assert.ok(
		issues.some(
			(issue) =>
				issue.code === "LITCODEX_PACK_EXACT_SET_EXTRA" && issue.path === "marketplace/skill/original/rogue.txt",
		),
	);
});

test("@litfamily/litcodex allows bundled[@litcodex/lit-loop] (G8 bundledDependency)", () => {
	const r = requiredPackResult("@litfamily/litcodex", ["dist/cli.js"], {
		bundled: ["@litcodex/lit-loop"],
	});
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

test("@litfamily/litcodex still flags a STRAY bundled dep alongside the allowed one (G8)", () => {
	const r = packResult(
		"@litfamily/litcodex",
		["bin/litcodex.js", "dist/cli.js", "model-catalog.json", "package.json"],
		{
			bundled: ["@litcodex/lit-loop", "lodash"],
		},
	);
	const issues = checkOne(r).issues;
	const bundledIssue = issues.find((i) => i.code === "LITCODEX_PACK_BUNDLED_DEP");
	assert.ok(bundledIssue, "a stray bundled dep must be flagged");
	assert.ok(bundledIssue.message.includes("lodash"), "the message names the stray dep");
	assert.ok(!bundledIssue.message.includes("got stray [@litcodex/lit-loop"), "the allowed dep is not 'stray'");
});

test("seed manifest pins @litfamily/litcodex allowedBundled to exactly @litcodex/lit-loop (G8 tamper guard)", () => {
	const installer = manifest.packages.find((p) => p.name === "@litfamily/litcodex");
	assert.deepEqual(installer.allowedBundled, ["@litcodex/lit-loop"]);
	const component = manifest.packages.find((p) => p.name === "@litcodex/lit-loop");
	assert.ok(!component.allowedBundled || component.allowedBundled.length === 0, "the component bundles nothing");
});

test("clean component payload passes (present mode)", () => {
	const r = componentPackResult([
		"dist/cli.js",
		"dist/markers.js",
		"directive.md",
		"directives/litwork.md",
		"directives/lit-plan.md",
		"directives/litgoal.md",
		"directives/review-work.md",
		"directives/litresearch.md",
		"directives/start-work.md",
		"README.md",
		"LICENSE",
		"package.json",
	]);
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

test("seed manifest excludes removed observer and skill-loop payload paths", () => {
	const installer = ruleFor("@litfamily/litcodex");
	const component = ruleFor("@litcodex/lit-loop");
	const rulePaths = [installer, component]
		.flatMap((rule) => [
			...rule.requiredPaths,
			...(rule.requiredFuture ?? []),
			...(rule.exactFileSets ?? []).flatMap((set) => [set.prefix, ...set.allowedPaths]),
		])
		.join("\n");
	assert.doesNotMatch(rulePaths, /skill-observer|skill-loop-cli|skill-loop\//u);
	assert.ok(manifest.forbiddenSegments.includes("/skill-observer/"));
	assert.ok(manifest.forbiddenSegments.includes("skill-observer."));
	assert.ok(manifest.forbiddenSegments.includes("skill-observer-"));
	assert.ok(manifest.forbiddenSegments.includes("skill-loop-cli."));
	assert.ok(manifest.forbiddenSegments.includes("skill-loop/"));

	const removedPaths = [
		["@litcodex/lit-loop", "dist/skill-observer-cli.js"],
		["@litcodex/lit-loop", "dist/skill-observer-cli.d.ts"],
		["@litcodex/lit-loop", "dist/skill-observer-route.js"],
		["@litcodex/lit-loop", "dist/skill-observer.js"],
		["@litcodex/lit-loop", "dist/skill-loop-cli.js"],
		["@litcodex/lit-loop", "dist/skill-loop-cli.d.ts"],
		["@litcodex/lit-loop", "dist/skill-loop/apply.js"],
		["@litcodex/lit-loop", "dist/skill-loop/store.d.ts"],
		["@litcodex/lit-loop", "dist/skill-loop/review.js"],
		["@litcodex/lit-loop", "dist/skill-loop/review.d.ts"],
		["@litcodex/lit-loop", "skills/skill-observer/SKILL.md"],
		["@litcodex/lit-loop", "skills/skill-observer/references/review-contract.md"],
		["@litfamily/litcodex", "marketplace/plugins/litcodex/skills/skill-observer/SKILL.md"],
		["@litfamily/litcodex", "marketplace/plugins/litcodex/skills/skill-observer/agents/openai.yaml"],
		["@litfamily/litcodex", "marketplace/plugins/litcodex/skills/skill-observer/references/review-contract.md"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/dist/skill-observer-cli.js"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/dist/skill-observer-cli.d.ts"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/dist/skill-loop-cli.js"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/dist/skill-loop-cli.d.ts"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/dist/skill-loop/review.js"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/dist/skill-loop/review.d.ts"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/skills/skill-observer/SKILL.md"],
		["@litfamily/litcodex", "node_modules/@litcodex/lit-loop/skills/skill-observer/references/review-contract.md"],
	];
	for (const [packageName, path] of removedPaths) {
		const result = checkOne(requiredPackResult(packageName, [path]));
		assert.ok(
			result.issues.some((issue) => issue.code === "LITCODEX_PACK_FORBIDDEN_PATH" && issue.path === path),
			`${packageName}:${path} must be rejected from a packed payload`,
		);
	}
});

test("Wikify knowledge component requires its package and every compiled dist path", () => {
	const rule = ruleFor("@litcodex/wikify-knowledge");
	assert.deepEqual(rule.requiredPaths, [
		"package.json",
		"dist/cli.d.ts",
		"dist/cli.js",
		"dist/knowledge.d.ts",
		"dist/knowledge.js",
		"dist/strict-json.d.ts",
		"dist/strict-json.js",
	]);
	const clean = requiredPackResult("@litcodex/wikify-knowledge");
	assert.equal(checkOne(clean).ok, true, JSON.stringify(checkOne(clean).issues));
});

test("Wikify knowledge component rejects a missing or extra compiled dist path", () => {
	const missing = packResult("@litcodex/wikify-knowledge", ["package.json", "dist/cli.js"]);
	const missingIssues = checkOne(missing).issues;
	assert.ok(
		missingIssues.some(
			(issue) => issue.code === "LITCODEX_PACK_MISSING_REQUIRED" && issue.path === "dist/knowledge.js",
		),
	);

	const extra = requiredPackResult("@litcodex/wikify-knowledge", ["dist/extra.js"]);
	assert.ok(
		checkOne(extra).issues.some(
			(issue) => issue.code === "LITCODEX_PACK_EXACT_SET_EXTRA" && issue.path === "dist/extra.js",
		),
	);
});

test("all shipped runtime packages in one array pass", () => {
	const installer = requiredPackResult("@litfamily/litcodex", ["dist/cli.js"]);
	const component = componentPackResult();
	const knowledge = requiredPackResult("@litcodex/wikify-knowledge");
	const report = assertPayload([installer, component, knowledge], manifest);
	assert.equal(report.ok, true, JSON.stringify(report.issues));
	assert.equal(report.checkedPackages.length, 3);
});

// --- NEGATIVE: forbidden paths (the load-bearing rejections) -----------------------------------

test("forbidden .litcodex evidence path rejected", () => {
	const leak = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json", ".litcodex/evidence/x.txt"]);
	const report = assertPayload([leak], manifest);
	assert.equal(report.ok, false);
	const issue = report.issues.find((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH");
	assert.ok(issue, "expected a forbidden-path issue");
	assert.equal(issue.path, ".litcodex/evidence/x.txt");
	assert.match(issue.message, /\.litcodex\//);
});

test("forbidden .litcodex lit-loop state path rejected", () => {
	const leak = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json", ".litcodex/lit-loop/goals.json"]);
	const report = assertPayload([leak], manifest);
	assert.equal(report.ok, false);
	assert.ok(
		report.issues.some(
			(i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === ".litcodex/lit-loop/goals.json",
		),
	);
});

test("package guard rejects hidden state nested inside the marketplace payload", () => {
	const leak = requiredPackResult("@litfamily/litcodex", ["marketplace/plugins/litcodex/.runtime-state/claims.json"]);
	const report = assertPayload([leak], manifest);
	assert.ok(
		report.issues.some(
			(i) =>
				i.code === "LITCODEX_PACK_HIDDEN_STATE_PATH" &&
				i.path === "marketplace/plugins/litcodex/.runtime-state/claims.json",
		),
	);
});

test("package guard permits declared hidden marketplace metadata", () => {
	const result = requiredPackResult("@litfamily/litcodex", [
		"marketplace/.agents/plugins/marketplace.json",
		"marketplace/plugins/litcodex/.codex-plugin/plugin.json",
		"marketplace/plugins/litcodex/.mcp.json",
	]);
	assert.equal(checkOne(result).ok, true, JSON.stringify(checkOne(result).issues));
});

test("forbidden historical state path rejected (assembled fixture)", () => {
	const leak = packResult("@litfamily/litcodex", [
		"bin/litcodex.js",
		"package.json",
		`${HISTORICAL_SEGMENT}evidence/y.json`,
	]);
	const report = assertPayload([leak], manifest);
	assert.equal(report.ok, false);
	assert.ok(
		report.issues.some(
			(i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === `${HISTORICAL_SEGMENT}evidence/y.json`,
		),
	);
});

test("forbidden # REFERENCE path with hash and space rejected byte-exact", () => {
	const p = "# REFERENCE/lazy.txt";
	const leak = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json", p]);
	const report = assertPayload([leak], manifest);
	assert.equal(report.ok, false);
	const issue = report.issues.find((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH");
	assert.equal(issue.path, p, "path must survive byte-exact (# + space preserved)");
});

test("nested .tgz rejected", () => {
	const leak = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json", "litfamily-litcodex-0.1.0.tgz"]);
	const report = assertPayload([leak], manifest);
	assert.ok(
		report.issues.some((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === "litfamily-litcodex-0.1.0.tgz"),
	);
});

test("test files rejected: test/ dir and .test. infix", () => {
	const leak = componentPackResult(["test/foo.test.ts", "dist/b.test.js"]);
	const report = assertPayload([leak], manifest);
	const forbidden = report.issues.filter((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH").map((i) => i.path);
	assert.ok(forbidden.includes("test/foo.test.ts"));
	assert.ok(forbidden.includes("dist/b.test.js"));
});

test("package guard rejects plural tests, Python tests, helpers, Vitest configs, caches, and evidence", () => {
	const syntheticLeaks = [
		"dist/tests/helper.js",
		"dist/test_runtime.py",
		"dist/test-helpers.js",
		"dist/vitest.config.js",
		"dist/__pycache__/runtime.pyc",
		"dist/evidence/receipt.json",
	];
	const leak = componentPackResult(syntheticLeaks);
	const forbidden = checkOne(leak)
		.issues.filter((issue) => issue.code === "LITCODEX_PACK_FORBIDDEN_PATH")
		.map((issue) => issue.path);
	assert.deepEqual(forbidden.sort(), syntheticLeaks.sort());
});

test("forbidden /fixtures/ and .env rejected", () => {
	const leak = componentPackResult(["dist/fixtures/sample.json", ".env"]);
	const report = assertPayload([leak], manifest);
	const forbidden = report.issues.filter((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH").map((i) => i.path);
	assert.ok(forbidden.includes("dist/fixtures/sample.json"));
	assert.ok(forbidden.includes(".env"));
});

test("forbidden HANDOFF rejected", () => {
	const leak = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json", "HANDOFF.md"]);
	const report = assertPayload([leak], manifest);
	assert.ok(report.issues.some((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === "HANDOFF.md"));
});

test("only canonical vendored handoff filenames bypass the HANDOFF denylist", () => {
	const canonical = [
		"vendor/handoff/templates/HANDOFF.md",
		"vendor/handoff/examples/HANDOFF-example-generic-auth-refactor.md",
	];
	const allowed = componentPackResult(canonical);
	assert.equal(checkOne(allowed).ok, true, JSON.stringify(checkOne(allowed).issues));

	for (const path of [
		"skills/lit-handoff/HANDOFF.md",
		"skills/other/vendor/handoff/templates/HANDOFF.md",
		"vendor/handoff/examples/OTHER-HANDOFF.md",
	]) {
		const rejected = componentPackResult([path]);
		assert.ok(
			checkOne(rejected).issues.some(
				(issue) => issue.code === "LITCODEX_PACK_FORBIDDEN_PATH" && issue.path === path,
			),
			path,
		);
	}
});

// --- forbidden-beats-allowed precedence --------------------------------------------------------

test("forbidden beats allowed in dist (dist/test/h.js forbidden despite dist/** allow)", () => {
	const r = componentPackResult(["dist/test/h.js"]);
	const report = assertPayload([r], manifest);
	assert.equal(report.ok, false);
	const issue = report.issues.find((i) => i.path === "dist/test/h.js");
	assert.equal(issue.code, "LITCODEX_PACK_FORBIDDEN_PATH", "must be forbidden, not silently allowed or unexpected");
});

test("forbidden path is reported ONCE, not also as unexpected", () => {
	const r = componentPackResult(["dist/test/h.js"]);
	const report = assertPayload([r], manifest);
	const forH = report.issues.filter((i) => i.path === "dist/test/h.js");
	assert.equal(forH.length, 1);
});

// --- anchored forbidden rules (G1) -------------------------------------------------------------

test("root tsconfig rejected; dist-scoped tsconfig exempted", () => {
	const root = componentPackResult(["tsconfig.json"]);
	const rootReport = assertPayload([root], manifest);
	assert.ok(rootReport.issues.some((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === "tsconfig.json"));

	const distScoped = componentPackResult(["dist/x/tsconfig.json"]);
	assert.equal(checkOne(distScoped).ok, true, JSON.stringify(checkOne(distScoped).issues));
});

test("dist tsbuildinfo still rejected (flat, no exemption)", () => {
	const r = componentPackResult(["dist/cli.tsbuildinfo"]);
	const report = assertPayload([r], manifest);
	assert.ok(report.issues.some((i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === "dist/cli.tsbuildinfo"));
});

test("node_modules forbidden except bundled @litcodex/lit-loop subtree", () => {
	const evil = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json", "node_modules/chalk/index.js"]);
	const evilReport = assertPayload([evil], manifest);
	assert.ok(
		evilReport.issues.some(
			(i) => i.code === "LITCODEX_PACK_FORBIDDEN_PATH" && i.path === "node_modules/chalk/index.js",
		),
		"a non-bundled node_modules dep must be forbidden",
	);
});

// --- component MUST NOT ship hooks.json (A3 C2 / addendum G2) -----------------------------------

test("component hooks json rejected (no hooks/** glob)", () => {
	const r = componentPackResult(["hooks/hooks.json"]);
	const report = assertPayload([r], manifest);
	assert.equal(report.ok, false);
	const issue = report.issues.find((i) => i.path === "hooks/hooks.json");
	assert.equal(
		issue.code,
		"LITCODEX_PACK_UNEXPECTED_PATH",
		"stale component hooks.json must be an unexpected-path leak",
	);
});

test("component without any hooks/ path is fine (hooks not required)", () => {
	const r = componentPackResult([
		"directive.md",
		"directives/litwork.md",
		"directives/review-work.md",
		"README.md",
		"LICENSE",
		"package.json",
	]);
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

// --- installer MUST NOT ship CHANGELOG (A3 D1-packaging / addendum G4) --------------------------

test("installer CHANGELOG rejected (UNEXPECTED, not allowed)", () => {
	const r = packResult("@litfamily/litcodex", ["bin/litcodex.js", "dist/cli.js", "package.json", "CHANGELOG.md"]);
	const report = assertPayload([r], manifest);
	assert.equal(report.ok, false);
	const issue = report.issues.find((i) => i.path === "CHANGELOG.md");
	assert.equal(issue.code, "LITCODEX_PACK_UNEXPECTED_PATH");
});

// --- component plugin manifest rejected --------------------------------------------------------

test("component .codex-plugin/plugin.json rejected (UNEXPECTED, identity owned by aggregate)", () => {
	const r = componentPackResult([".codex-plugin/plugin.json"]);
	const report = assertPayload([r], manifest);
	const issue = report.issues.find((i) => i.path === ".codex-plugin/plugin.json");
	assert.equal(issue.code, "LITCODEX_PACK_UNEXPECTED_PATH");
});

// --- structural issues -------------------------------------------------------------------------

test("entrycount mismatch rejected", () => {
	const r = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json"]);
	r.entryCount = 5;
	const report = assertPayload([r], manifest);
	assert.ok(report.issues.some((i) => i.code === "LITCODEX_PACK_ENTRYCOUNT_MISMATCH"));
});

test("bundled dep rejected", () => {
	const r = packResult("@litfamily/litcodex", ["bin/litcodex.js", "package.json"], { bundled: ["lodash"] });
	const report = assertPayload([r], manifest);
	assert.ok(report.issues.some((i) => i.code === "LITCODEX_PACK_BUNDLED_DEP"));
});

test("dead rule rejected when component drops out of pack", () => {
	const installerOnly = packResult("@litfamily/litcodex", ["bin/litcodex.js", "dist/cli.js", "package.json"]);
	const report = assertPayload([installerOnly], manifest);
	assert.equal(report.ok, false);
	const issue = report.issues.find((i) => i.code === "LITCODEX_PACK_NO_RULE_USED");
	assert.equal(issue.package, "@litcodex/lit-loop");
});

test("unknown package (private aggregate) rejected", () => {
	const both = [
		packResult("@litfamily/litcodex", ["bin/litcodex.js", "dist/cli.js", "package.json"]),
		componentPackResult(),
		packResult("@litcodex/plugin", ["package.json"]),
	];
	const report = assertPayload(both, manifest);
	assert.ok(report.issues.some((i) => i.code === "LITCODEX_PACK_UNKNOWN_PACKAGE" && i.package === "@litcodex/plugin"));
});

// --- requiredPaths enforced in EVERY mode, requiredFuture only in final ------------------------

test("missing requiredPaths (package.json) rejected even in present mode", () => {
	const r = packResult("@litfamily/litcodex", ["bin/litcodex.js"]);
	const report = assertPayload([r], manifest);
	assert.ok(report.issues.some((i) => i.code === "LITCODEX_PACK_MISSING_REQUIRED" && i.path === "package.json"));
});

test("installer cli and postinstall plus component bin are required in every mode", () => {
	for (const path of ["dist/cli.js", "dist/postinstall.js"]) {
		const paths = ruleFor("@litfamily/litcodex").requiredPaths.filter((candidate) => candidate !== path);
		const result = packResult("@litfamily/litcodex", paths);
		const present = checkOne(result);
		assert.equal(present.ok, false, `${path} must not be deferred to final mode`);
		assert.ok(present.issues.some((issue) => issue.code === "LITCODEX_PACK_MISSING_REQUIRED" && issue.path === path));
	}

	const r = packResult("@litcodex/lit-loop", ["dist/_scaffold.js", "package.json"]);
	const present = checkOne(r);
	assert.equal(present.ok, false, "a declared component bin must be required in present mode");
	assert.ok(present.issues.some((i) => i.code === "LITCODEX_PACK_MISSING_REQUIRED" && i.path === "dist/cli.js"));
});

test("declared npm bins must have regular executable pack metadata", () => {
	for (const name of ["@litfamily/litcodex", "@litcodex/lit-loop"]) {
		const binPaths = binsByPackage.get(name);
		assert.ok(binPaths.length > 0, `${name} must declare package bins`);
		for (const path of binPaths) {
			const result = requiredPackResult(name);
			const entry = result.files.find((file) => file.path === path);
			assert.ok(entry, `${name} fixture missing ${path}`);

			entry.mode = 0o644;
			assert.ok(
				checkOne(result).issues.some(
					(issue) => issue.code === "LITCODEX_PACK_BIN_NOT_EXECUTABLE" && issue.path === path,
				),
				`${name}:${path} mode 0644 must fail`,
			);

			delete entry.mode;
			assert.ok(
				checkOne(result).issues.some(
					(issue) => issue.code === "LITCODEX_PACK_BIN_METADATA_INVALID" && issue.path === path,
				),
				`${name}:${path} missing mode must fail`,
			);

			entry.mode = 0o040755;
			assert.ok(
				checkOne(result).issues.some(
					(issue) => issue.code === "LITCODEX_PACK_BIN_NOT_REGULAR" && issue.path === path,
				),
				`${name}:${path} directory metadata must fail`,
			);

			entry.mode = 0o755;
			entry.type = "SymbolicLink";
			assert.ok(
				checkOne(result).issues.some(
					(issue) => issue.code === "LITCODEX_PACK_BIN_NOT_REGULAR" && issue.path === path,
				),
				`${name}:${path} explicit non-file metadata must fail`,
			);
		}
	}
});

test("package-derived bin paths reject missing, 0644, directory, and symlink pack metadata", () => {
	const rule = {
		name: "future-package",
		requiredPaths: ["package.json"],
		allowedGlobs: ["**"],
	};
	const base = {
		name: "future-package",
		files: [
			{ path: "package.json", size: 1, mode: 0o644 },
			{ path: "bin/cli.js", size: 1, mode: 0o755 },
		],
		entryCount: 2,
		bundled: [],
		binPaths: ["bin/cli.js"],
	};
	const issuesFor = (entry) =>
		assertPackage(
			{
				...base,
				files: entry === null ? [base.files[0]] : [base.files[0], entry],
				entryCount: entry === null ? 1 : 2,
			},
			rule,
			[],
		);

	assert.ok(issuesFor(null).some((issue) => issue.code === "LITCODEX_PACK_BIN_MISSING"));
	assert.ok(
		issuesFor({ path: "bin/cli.js", size: 1, mode: 0o644 }).some(
			(issue) => issue.code === "LITCODEX_PACK_BIN_NOT_EXECUTABLE",
		),
	);
	assert.ok(
		issuesFor({ path: "bin/cli.js", size: 1, mode: 0o040755 }).some(
			(issue) => issue.code === "LITCODEX_PACK_BIN_NOT_REGULAR",
		),
	);
	assert.ok(
		issuesFor({ path: "bin/cli.js", size: 1, mode: 0o755, type: "SymbolicLink" }).some(
			(issue) => issue.code === "LITCODEX_PACK_BIN_NOT_REGULAR",
		),
	);
	assert.ok(
		issuesFor({ path: "bin/cli.js", size: 1 }).some((issue) => issue.code === "LITCODEX_PACK_BIN_METADATA_INVALID"),
	);
});

test("package-derived bin validation permits non-traversal filenames containing two dots", () => {
	const result = {
		name: "future-package",
		files: [
			{ path: "package.json", size: 1, mode: 0o644 },
			{ path: "bin/tool..js", size: 1, mode: 0o755 },
		],
		entryCount: 2,
		bundled: [],
		binPaths: ["bin/tool..js"],
	};
	const rule = { name: "future-package", requiredPaths: ["package.json"], allowedGlobs: ["**"] };
	assert.deepEqual(assertPackage(result, rule, []), []);
});

// --- unicode / path normalization (security: byte-exact, no FS, no case fold) ------------------

test("unicode dist path allowed", () => {
	const r = componentPackResult(["dist/한글.js"]);
	assert.equal(checkOne(r).ok, true, JSON.stringify(checkOne(r).issues));
});

test("normalized ./ and backslash do not evade the forbidden match", () => {
	const r = packResult("@litfamily/litcodex", [
		"bin/litcodex.js",
		"package.json",
		`.\\${HISTORICAL_SEGMENT.replace("/", "")}\\evidence\\z`,
	]);
	const report = assertPayload([r], manifest);
	assert.equal(report.ok, false, "a backslash-disguised historical state path must still be caught");
});

test("firstForbiddenSegment: flat then anchored, returns the hit substring", () => {
	assert.equal(firstForbiddenSegment(".litcodex/x", [".litcodex/"], []), ".litcodex/");
	assert.equal(
		firstForbiddenSegment(
			"node_modules/chalk/i.js",
			[],
			[{ segment: "node_modules/", exemptUnderPrefixes: ["node_modules/@litcodex/lit-loop/"] }],
		),
		"node_modules/",
	);
	assert.equal(
		firstForbiddenSegment(
			"node_modules/@litcodex/lit-loop/dist/cli.js",
			[],
			[{ segment: "node_modules/", exemptUnderPrefixes: ["node_modules/@litcodex/lit-loop/"] }],
		),
		null,
	);
	assert.equal(firstForbiddenSegment("dist/cli.js", [HISTORICAL_SEGMENT], []), null);
});

// --- parser / manifest faults (exit-2 family) --------------------------------------------------

test("parsePackJson throws LITCODEX_PACK_JSON_INVALID on bad json", () => {
	assert.throws(
		() => parsePackJson("{not json"),
		(e) => e instanceof PackPayloadError && e.code === "LITCODEX_PACK_JSON_INVALID",
	);
});

test("parsePackJson throws LITCODEX_PACK_SHAPE_INVALID on non-array", () => {
	assert.throws(
		() => parsePackJson('{"name":"x"}'),
		(e) => e instanceof PackPayloadError && e.code === "LITCODEX_PACK_SHAPE_INVALID",
	);
});

test("parsePackJson throws SHAPE_INVALID when an element lacks files[]", () => {
	assert.throws(
		() => parsePackJson('[{"name":"x","entryCount":0,"bundled":[]}]'),
		(e) => e.code === "LITCODEX_PACK_SHAPE_INVALID",
	);
});

test("loadPayloadManifest throws MANIFEST_INVALID on version mismatch and on unreadable path", () => {
	// version!==1 → MANIFEST_INVALID (write a temp manifest, assert, then clean up).
	const tmp = resolve(tmpdir(), `litcodex-pack-manifest-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
	writeFileSync(tmp, JSON.stringify({ version: 2, forbiddenSegments: ["x"], packages: [] }));
	try {
		assert.throws(
			() => loadPayloadManifest(tmp),
			(e) => e instanceof PackPayloadError && e.code === "LITCODEX_PACK_MANIFEST_INVALID",
		);
	} finally {
		rmSync(tmp, { force: true });
	}
	// unreadable manifest path → MANIFEST_INVALID.
	assert.throws(
		() => loadPayloadManifest(resolve(HERE, "does-not-exist-manifest.json")),
		(e) => e instanceof PackPayloadError && e.code === "LITCODEX_PACK_MANIFEST_INVALID",
	);
});

// --- version-agnostic (G5): asserter never compares version to a constant -----------------------

test("pack manifest expands the verified corpus copy into required and exact payload paths", () => {
	const installer = manifest.packages.find((packageRule) => packageRule.name === "@litfamily/litcodex");
	const [copy] = installer.verifiedCorpusCopies;
	assert.ok(copy, "installer must declare its verified corpus copy");
	const source = verifyCanonicalCorpus(resolve(HERE, "..", copy.sourceRoot));
	const sourcePaths = [...source.verifiedFiles.keys()].sort();
	const exact = installer.exactFileSets.find((fileSet) => copy.destinationPrefix.startsWith(fileSet.prefix));
	const relativePrefix = copy.destinationPrefix.slice(exact.prefix.length);
	const expectedExact = sourcePaths.map((path) => `${relativePrefix}${path}`).sort();
	const actualExact = exact.allowedPaths.filter((path) => path.startsWith(relativePrefix)).sort();
	assert.deepEqual(actualExact, expectedExact);
	assert.deepEqual(
		installer.requiredPaths.filter((path) => path.startsWith(copy.destinationPrefix)).sort(),
		sourcePaths.map((path) => `${copy.destinationPrefix}${path}`).sort(),
	);
});

test("version literal is not asserted (0.1.0 and 1.0.0 both clean)", () => {
	const a = requiredPackResult("@litfamily/litcodex", ["dist/cli.js"]);
	a.version = "0.1.0";
	const b = requiredPackResult("@litfamily/litcodex", ["dist/cli.js"]);
	b.version = "1.0.0";
	assert.equal(checkOne(a).ok, true);
	assert.equal(checkOne(b).ok, true);
	assert.ok(!checkOne(b).issues.some((i) => /version/i.test(i.message)), "no issue may mention a version gate");
});

// --- seed manifest invariants (tamper guard) ---------------------------------------------------

test("seed manifest pins load-bearing forbidden segments and excludes hooks/CHANGELOG", () => {
	const forbidden = new Set(manifest.forbiddenSegments);
	for (const seg of [".litcodex/", "# REFERENCE", ".tgz", "/test/", "/evidence/", ".env", "__pycache__/", ".pyc"]) {
		assert.ok(forbidden.has(seg), `forbiddenSegments must contain ${seg}`);
	}
	assert.ok(forbidden.has(HISTORICAL_SEGMENT), "forbiddenSegments must contain the assembled state-path carrier");
	assert.ok(!forbidden.has("HANDOFF"), "HANDOFF must use an exact-path exception rule, not a flat allow");
	const handoffRule = manifest.forbiddenSegmentRules.find((rule) => rule.segment === "HANDOFF");
	assert.equal(handoffRule.exemptPaths.length, 6, "only six canonical package paths may be exempt");

	const installer = manifest.packages.find((p) => p.name === "@litfamily/litcodex");
	assert.ok(installer.requiredPaths.includes("dist/cli.js"), "installer dist/cli.js must always be required");
	assert.ok(
		installer.requiredPaths.includes("dist/postinstall.js"),
		"installer dist/postinstall.js must always be required",
	);
	assert.ok(!installer.requiredFuture.includes("dist/cli.js"), "installer CLI must not remain deferred-only");
	const installerPackage = JSON.parse(readFileSync(resolve(HERE, "../packages/litcodex-ai/package.json"), "utf8"));
	assert.deepEqual(
		binsByPackage.get(installerPackage.name),
		Object.values(installerPackage.bin).map((path) => path.replace(/^\.\//, "")),
	);
	assert.ok(installer.allowedGlobs.includes("dist/**"), "@litfamily/litcodex must allow dist/**");
	assert.ok(
		installer.requiredPaths.includes(
			"marketplace/plugins/litcodex/skills/visual-qa/schemas/evidence-manifest.v1beta1.json",
		),
		"@litfamily/litcodex must require the evidence-eligible visual QA schema",
	);
	assert.ok(
		installer.requiredPaths.includes(
			"marketplace/plugins/litcodex/skills/visual-qa/schemas/design-contract.v1beta2.json",
		),
		"@litfamily/litcodex must require the visual QA beta2 design schema",
	);
	for (const path of [
		"marketplace/plugins/litcodex/skills/lit-scientific-visualization/SKILL.md",
		"marketplace/plugins/litcodex/skills/lit-scientific-visualization/scripts/dependency-preflight.py",
		"marketplace/plugins/litcodex/vendor/scientific-visualization/SKILL.md",
		"marketplace/plugins/litcodex/vendor/scientific-visualization/scripts/style_presets.py",
		"marketplace/plugins/litcodex/vendor/scientific-visualization/tests/test_style_presets.py",
		"node_modules/@litcodex/lit-loop/skills/lit-scientific-visualization/SKILL.md",
		"node_modules/@litcodex/lit-loop/skills/lit-scientific-visualization/scripts/dependency-preflight.py",
		"node_modules/@litcodex/lit-loop/vendor/scientific-visualization/assets/color_palettes.py",
	]) {
		assert.ok(installer.requiredFuture.includes(path), `science payload manifest missing ${path}`);
	}
	assert.ok(installer.allowedGlobs.includes("marketplace/**"), "@litfamily/litcodex must allow its local marketplace");
	assert.ok(
		installer.requiredFuture.includes("marketplace/.agents/plugins/marketplace.json"),
		"@litfamily/litcodex must require the marketplace manifest",
	);
	assert.ok(
		installer.requiredFuture.includes("marketplace/plugins/litcodex/.codex-plugin/plugin.json"),
		"@litfamily/litcodex must require the plugin manifest",
	);
	assert.ok(
		installer.allowedGlobs.includes("node_modules/@litcodex/lit-loop/**"),
		"@litfamily/litcodex must allow the bundled dep",
	);
	assert.ok(!installer.allowedGlobs.includes("CHANGELOG.md"), "@litfamily/litcodex must NOT allow CHANGELOG.md");
	const installerExactSets = installer.exactFileSets.map((entry) => [entry.prefix, entry.allowedPaths.length]);
	const visualQaExactSet = installer.exactFileSets.find(
		(entry) => entry.prefix === "marketplace/plugins/litcodex/skills/visual-qa/",
	);
	assert.ok(
		visualQaExactSet.allowedPaths.includes("schemas/design-contract.v1beta2.json"),
		"visual QA exact payload must allow the beta2 design schema",
	);
	const frontendUiuxExactSet = installer.exactFileSets.find(
		(entry) => entry.prefix === "marketplace/plugins/litcodex/skills/frontend-ui-ux/",
	);
	assert.ok(
		frontendUiuxExactSet.allowedPaths.includes("schemas/design-contract.v1beta2.json"),
		"frontend exact payload must allow the beta2 design schema",
	);
	assert.ok(
		frontendUiuxExactSet.allowedPaths.includes("references/taste-direction.md"),
		"frontend exact payload must allow the taste direction reference",
	);
	assert.ok(frontendUiuxExactSet.allowedPaths.includes("references/motion-guide.md"));
	assert.ok(frontendUiuxExactSet.allowedPaths.includes("examples/readme-ab/README.md"));
	const humanizerExactSet = installer.exactFileSets.find(
		(entry) => entry.prefix === "marketplace/plugins/litcodex/skills/lit-humanizer/",
	);
	assert.ok(humanizerExactSet.allowedPaths.includes("rules.json"));
	assert.ok(humanizerExactSet.allowedPaths.includes("references/taxonomy.md"));
	assert.ok(
		installer.exactFileSets.some((entry) => entry.prefix === "node_modules/@litcodex/lit-loop/skills/lit-humanizer/"),
		"installer exact payload must include the hook-injected humanizer closure",
	);
	assert.deepEqual(installerExactSets, [
		["marketplace/plugins/litcodex/skills/autoconference/", 28],
		["marketplace/plugins/litcodex/skills/autoresearch/", 30],
		["marketplace/plugins/litcodex/skills/browser-drive/", 4],
		["marketplace/plugins/litcodex/skills/coding-session-audit/", 4],
		["marketplace/plugins/litcodex/skills/frontend-ui-ux/", 212],
		["marketplace/plugins/litcodex/skills/lit-diagram-drawer/", 328],
		["marketplace/plugins/litcodex/skills/lit-docx/", 37],
		["marketplace/plugins/litcodex/skills/lit-humanizer/", 68],
		["marketplace/plugins/litcodex/skills/lit-pptx/", 73],
		["marketplace/plugins/litcodex/skills/lit-typographic-motion/", 68],
		["marketplace/plugins/litcodex/skills/readme-studio/", 23],
		["marketplace/plugins/litcodex/skills/structural-search/", 4],
		["marketplace/plugins/litcodex/skills/visual-qa/", 23],
		["marketplace/plugins/litcodex/skills/wikify/", 14],
		["marketplace/plugins/litcodex/vendor/handoff/", 4],
		["marketplace/plugins/litcodex/vendor/scientific-visualization/", 16],
		["node_modules/@litcodex/lit-loop/skills/lit-humanizer/", 68],
		["node_modules/@litcodex/lit-loop/vendor/handoff/", 4],
		["node_modules/@litcodex/lit-loop/vendor/scientific-visualization/", 16],
	]);

	const component = manifest.packages.find((p) => p.name === "@litcodex/lit-loop");
	for (const path of ["dist/cli.js"]) {
		assert.ok(component.requiredPaths.includes(path), `component must always require ${path}`);
	}
	assert.ok(!component.requiredFuture.includes("dist/cli.js"), "component npm bin must not remain deferred-only");
	const componentPackage = JSON.parse(
		readFileSync(resolve(HERE, "../plugins/litcodex/components/lit-loop/package.json"), "utf8"),
	);
	assert.deepEqual(
		binsByPackage.get(componentPackage.name),
		Object.values(componentPackage.bin).map((path) => path.replace(/^\.\//, "")),
	);
	assert.ok(!component.allowedGlobs.includes("hooks/**"), "component must NOT allow hooks/**");
	assert.ok(!component.requiredPaths.includes("hooks/hooks.json"), "component must NOT require hooks.json");
	assert.ok(component.requiredPaths.includes("skills/lit-humanizer/SKILL.md"));
	assert.ok(!component.requiredPaths.includes("skills/lit-korean/SKILL.md"));
	for (const directive of ["review-work", "litresearch", "start-work", "lit-scientific-visualization"]) {
		assert.ok(
			component.requiredFuture.includes(`directives/${directive}.md`),
			`component must require directives/${directive}.md`,
		);
	}
	for (const skill of ["lit-loop", "litresearch", "review-work", "lit-scientific-visualization"]) {
		assert.ok(
			component.requiredFuture.includes(`skills/${skill}/SKILL.md`),
			`component must require bundled skill body ${skill}`,
		);
	}
	assert.ok(component.allowedGlobs.includes("skills/**"), "component must allow bundled skill bodies");
	const componentHumanizerExactSet = component.exactFileSets.find((entry) => entry.prefix === "skills/lit-humanizer/");
	assert.ok(componentHumanizerExactSet, "component exact payload must include the humanizer closure");
	assert.deepEqual(componentHumanizerExactSet.allowedPaths, humanizerExactSet.allowedPaths);
	assert.equal(componentHumanizerExactSet.allowedPaths.length, 68);
	assert.deepEqual(
		component.exactFileSets.filter((entry) => entry.prefix !== "skills/lit-humanizer/"),
		[
			{
				prefix: "vendor/handoff/",
				allowedPaths: [
					"SKILL.md",
					"evals/evals.json",
					"examples/HANDOFF-example-generic-auth-refactor.md",
					"templates/HANDOFF.md",
				],
			},
			{
				prefix: "vendor/scientific-visualization/",
				allowedPaths: [
					"SKILL.md",
					"assets/color_palettes.py",
					"assets/nature.mplstyle",
					"assets/presentation.mplstyle",
					"assets/publication.mplstyle",
					"evals/evals.json",
					"references/color_palettes.md",
					"references/journal_requirements.md",
					"references/matplotlib_examples.md",
					"references/mdanalysis_martini_visualization.md",
					"references/publication_guidelines.md",
					"references/seaborn_for_publications.md",
					"scripts/figure_export.py",
					"scripts/style_presets.py",
					"tests/test_figure_export.py",
					"tests/test_style_presets.py",
				],
			},
			{
				prefix: "skills/browser-drive/",
				allowedPaths: [
					"SKILL.md",
					"agents/openai.yaml",
					"references/snapshot-act-loop.md",
					"scripts/capability-probe.mjs",
				],
			},
		],
	);
});

// --- assertPackage direct (forbiddenSegmentRules param) -----------------------------------------

test("assertPackage honors anchored rules via its 4th param", () => {
	const rule = {
		name: "@litfamily/litcodex",
		requiredPaths: ["package.json"],
		allowedGlobs: ["package.json", "dist/**"],
	};
	const r = packResult("@litfamily/litcodex", ["package.json", "dist/x/tsconfig.json"]);
	r.binPaths = [];
	const issues = assertPackage(r, rule, [], [{ segment: "tsconfig", exemptUnderPrefixes: ["dist/"] }]);
	assert.equal(issues.length, 0, "dist-scoped tsconfig must be exempt");
});
