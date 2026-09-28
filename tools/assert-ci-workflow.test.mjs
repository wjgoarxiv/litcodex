import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	extractRunCommands,
	findForbiddenTokens,
	loadCiGateManifest,
	parseWorkflowYaml,
	runCiCheck,
} from "./assert-ci-workflow.mjs";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(toolsDir);
const cliScript = join(toolsDir, "assert-ci-workflow.mjs");
const evidenceDir = mkdtempSync(join(tmpdir(), "litcodex-ci-evidence-"));

// Self-immunity: forbidden/obsolete literals are assembled split-string so this
// test file never carries a raw forbidden literal that scan:legacy-tokens or the
// validator's own forbidden-token scan could read out of tools/**.
const T_NPM_PUBLISH = `npm ${"pub"}lish`;
const T_NPM_TOKEN = `NPM${"_"}TOKEN`;
const T_NODE_AUTH = `NODE${"_"}AUTH${"_"}TOKEN`;
const T_ID_TOKEN = `id${"-"}token`;
const T_WORKFLOW_DISPATCH = `workflow${"_"}dispatch`;
const T_PACK_GUARD = `pack:${"guard"}`;
const T_SECRETS = `secrets${"."}`;
const LOCKED_CODEX_BIN = ["$", "{{ github.workspace }}", "/node_modules/.bin/codex"].join("");
const GITHUB_CONCURRENCY_GROUP = ["$", "{{ github.workflow }}", "-$", "{{ github.ref }}"].join("");
const GITHUB_TRUE_AND_TRUE = ["$", "{{ true && true }}"].join("");

const CANONICAL_WORKFLOW = `name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

permissions:
  contents: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: false
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js \${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
          cache: "npm"

      - name: Install dependencies (clean, locked)
        run: npm ci --ignore-scripts

      - name: Assert CI workflow integrity
        run: npm run check:ci

      - name: Verify lock-owned Codex CLI
        run: npm run qa:codex-host-locked

      - name: Typecheck
        run: npm run typecheck

      - name: Test typecheck
        run: npm run typecheck:tests

      - name: Lint
        run: npm run lint

      - name: Unit & integration tests
        run: npm test

      - name: Codex hook tests
        run: npm run test:codex

      - name: Path-robustness tests
        run: npm run test:path-robustness

      - name: Legacy-token scan
        run: npm run scan:legacy-tokens

      - name: Build
        run: npm run build

      - name: Credentialless installed doctor QA
        env:
          CODEX_BIN: \${{ github.workspace }}/node_modules/.bin/codex
        run: npm run qa:uiux-installed:doctor

      - name: Pack dry-run (payload guard)
        run: npm run pack:all
`;

const CANONICAL_MANIFEST = {
	version: 1,
	workflowPath: ".github/workflows/ci.yml",
	nodeMatrix: [20, 22],
	permissions: { contents: "read" },
	lockedHost: {
		version: "0.144.0",
		bin: LOCKED_CODEX_BIN,
		verifyRun: "npm run qa:codex-host-locked",
		doctorRun: "npm run qa:uiux-installed:doctor",
	},
	gates: [
		{ name: "Assert CI workflow integrity", run: "npm run check:ci", gateOwner: "@litcodex/ci" },
		{ name: "Verify lock-owned Codex CLI", run: "npm run qa:codex-host-locked", gateOwner: "@litcodex/ci" },
		{ name: "Typecheck", run: "npm run typecheck", gateOwner: "@litcodex/scaffold" },
		{ name: "Test typecheck", run: "npm run typecheck:tests", gateOwner: "@litcodex/scaffold" },
		{ name: "Lint", run: "npm run lint", gateOwner: "@litcodex/scaffold" },
		{ name: "Unit & integration tests", run: "npm test", gateOwner: "@litcodex/scaffold" },
		{ name: "Codex hook tests", run: "npm run test:codex", gateOwner: "@litcodex/qa" },
		{
			name: "Path-robustness tests",
			run: "npm run test:path-robustness",
			gateOwner: "@litcodex/path-robust",
		},
		{
			name: "Legacy-token scan",
			run: "npm run scan:legacy-tokens",
			gateOwner: "@litcodex/legacy-scan",
		},
		{ name: "Build", run: "npm run build", gateOwner: "@litcodex/scaffold" },
		{
			name: "Credentialless installed doctor QA",
			run: "npm run qa:uiux-installed:doctor",
			gateOwner: "@litcodex/qa",
		},
		{ name: "Pack dry-run (payload guard)", run: "npm run pack:all", gateOwner: "@litcodex/plugin-pack" },
	],
	forbiddenTokens: [
		T_NPM_PUBLISH.toLowerCase(),
		T_NPM_TOKEN.toLowerCase(),
		T_NODE_AUTH.toLowerCase(),
		"gh release",
		"registry-url",
		T_ID_TOKEN,
		T_WORKFLOW_DISPATCH,
		T_SECRETS,
		"git push",
		"git tag",
		"--access public",
	],
};

const tmpRoots = [];
function makeFixture(workflow = CANONICAL_WORKFLOW, manifest = CANONICAL_MANIFEST) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-ci-"));
	tmpRoots.push(root);
	mkdirSync(join(root, ".github", "workflows"), { recursive: true });
	mkdirSync(join(root, "tools"), { recursive: true });
	writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflow);
	writeFileSync(join(root, "tools", "ci-gate-manifest.json"), JSON.stringify(manifest, null, 2));
	return root;
}

after(() => {
	for (const root of tmpRoots) {
		rmSync(root, { recursive: true, force: true });
	}
	rmSync(evidenceDir, { recursive: true, force: true });
});

function writeEvidence(name, data) {
	mkdirSync(evidenceDir, { recursive: true });
	writeFileSync(join(evidenceDir, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

describe("assert-ci-workflow validator", () => {
	it("baseline workflow passes", () => {
		const root = makeFixture();
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, true);
		assert.deepEqual(report.drifts, []);
		assert.equal(report.gatesChecked, 12);
		writeEvidence("task-09-baseline.json", report);
	});

	it("detects missing legacy-token gate", () => {
		const broken = CANONICAL_WORKFLOW.replace(
			/ {6}- name: Legacy-token scan\n {8}run: npm run scan:legacy-tokens\n\n/,
			"",
		);
		const root = makeFixture(broken);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		const codes = report.drifts.map((d) => d.code);
		assert.ok(codes.includes("LITCODEX_CI_GATE_MISSING"));
		writeEvidence("task-09-missing-gate.json", report);
	});

	it("detects out-of-order gates", () => {
		const swapped = CANONICAL_WORKFLOW.replace(
			"      - name: Typecheck\n        run: npm run typecheck\n\n      - name: Test typecheck\n        run: npm run typecheck:tests\n\n      - name: Lint\n        run: npm run lint\n",
			"      - name: Lint\n        run: npm run lint\n\n      - name: Typecheck\n        run: npm run typecheck\n\n      - name: Test typecheck\n        run: npm run typecheck:tests\n",
		);
		const root = makeFixture(swapped);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_GATE_OUT_OF_ORDER"));
		writeEvidence("task-09-out-of-order.json", report);
	});

	it("rejects an omitted or reordered restored-test typecheck gate", () => {
		const gate = "      - name: Test typecheck\n        run: npm run typecheck:tests\n\n";
		const missing = runCiCheck({ repoRoot: makeFixture(CANONICAL_WORKFLOW.replace(gate, "")) });
		assert.equal(missing.ok, false);
		assert.ok(missing.drifts.some((drift) => drift.code === "LITCODEX_CI_GATE_MISSING"));

		const reorderedWorkflow = CANONICAL_WORKFLOW.replace(
			`${gate}      - name: Lint\n        run: npm run lint\n`,
			`      - name: Lint\n        run: npm run lint\n\n${gate.trimEnd()}\n`,
		);
		const reordered = runCiCheck({ repoRoot: makeFixture(reorderedWorkflow) });
		assert.equal(reordered.ok, false);
		assert.ok(reordered.drifts.some((drift) => drift.code === "LITCODEX_CI_GATE_OUT_OF_ORDER"));
	});

	it("rejects publish step", () => {
		const injected = CANONICAL_WORKFLOW.replace(
			"      - name: Build",
			`      - name: Publish\n        run: ${T_NPM_PUBLISH} --access public\n\n      - name: Build`,
		);
		const root = makeFixture(injected);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		const codes = report.drifts.map((d) => d.code);
		assert.ok(codes.includes("LITCODEX_CI_PUBLISH_STEP_PRESENT"));
		assert.ok(codes.includes("LITCODEX_CI_FORBIDDEN_TOKEN"));
		writeEvidence("task-09-publish-step.json", report);
	});

	it("rejects secret reference", () => {
		const injected = CANONICAL_WORKFLOW.replace(
			'          cache: "npm"',
			`          cache: "npm"\n        env:\n          ${T_NODE_AUTH}: \${{ ${T_SECRETS}${T_NPM_TOKEN} }}`,
		);
		const root = makeFixture(injected);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_FORBIDDEN_TOKEN"));
		writeEvidence("task-09-secret-ref.json", report);
	});

	it("rejects write permission", () => {
		const injected = CANONICAL_WORKFLOW.replace(
			"permissions:\n  contents: read",
			`permissions:\n  contents: read\n  ${T_ID_TOKEN}: write`,
		);
		const root = makeFixture(injected);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		const codes = report.drifts.map((d) => d.code);
		assert.ok(codes.includes("LITCODEX_CI_PERMISSIONS_NOT_READONLY"));
		assert.ok(codes.includes("LITCODEX_CI_FORBIDDEN_TOKEN"));
		writeEvidence("task-09-write-perm.json", report);
	});

	it("permissions block is read-only (absent block fails)", () => {
		const noPerms = CANONICAL_WORKFLOW.replace("permissions:\n  contents: read\n\n", "");
		const root = makeFixture(noPerms);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_PERMISSIONS_NOT_READONLY"));
		writeEvidence("task-09-readonly-perms.json", report);
	});

	it("rejects workflow_dispatch trigger", () => {
		const injected = CANONICAL_WORKFLOW.replace("on:\n  push:", `on:\n  ${T_WORKFLOW_DISPATCH}:\n  push:`);
		const root = makeFixture(injected);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		const codes = report.drifts.map((d) => d.code);
		assert.ok(codes.includes("LITCODEX_CI_TRIGGER_INVALID"));
		assert.ok(codes.includes("LITCODEX_CI_FORBIDDEN_TOKEN"));
		writeEvidence("task-09-dispatch.json", report);
	});

	it("rejects a trigger that omits the real default branch", () => {
		const wrongBranch = CANONICAL_WORKFLOW.replaceAll("[master]", "[main]");
		const root = makeFixture(wrongBranch);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_TRIGGER_INVALID"));
		writeEvidence("task-09-default-branch.json", report);
	});

	it("detects node matrix drift", () => {
		const drifted = CANONICAL_WORKFLOW.replace("node: [20, 22]", "node: [18]");
		const manifest = { ...CANONICAL_MANIFEST, nodeMatrix: [20, 22] };
		const root = makeFixture(drifted, manifest);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_NODE_MATRIX_MISMATCH"));
		writeEvidence("task-09-matrix-drift.json", report);
	});

	it("requires manifest-declared non-blocking jobs to publish an always-run summary", () => {
		const workflow = `${CANONICAL_WORKFLOW}
  windows:
    runs-on: windows-latest
    continue-on-error: true
    steps:
      - name: Windows probe
        run: node scripts/windows-probe.mjs
      - name: Windows support summary
        if: always()
        run: |
          echo "Windows support (non-blocking): PASS" >> "$GITHUB_STEP_SUMMARY"
`;
		const manifest = {
			...CANONICAL_MANIFEST,
			nonBlockingJobs: [
				{ job: "windows", run: "node scripts/windows-probe.mjs", summaryStep: "Windows support summary" },
			],
		};
		const good = runCiCheck({ repoRoot: makeFixture(workflow, manifest) });
		assert.equal(good.ok, true, JSON.stringify(good.drifts));

		const missingSummary = runCiCheck({
			repoRoot: makeFixture(workflow.replace("GITHUB_STEP_SUMMARY", "CI_SUMMARY"), manifest),
		});
		assert.equal(missingSummary.ok, false);
		assert.ok(missingSummary.drifts.some((d) => d.code === "LITCODEX_CI_NONBLOCKING_SUMMARY_INVALID"));
		writeEvidence("task-09-nonblocking-summary.json", { good, missingSummary });
	});

	it("fails closed on a single-line run scalar containing colon-space", () => {
		const brokenWorkflow = `${CANONICAL_WORKFLOW}
  windows:
    runs-on: windows-latest
    continue-on-error: true
    steps:
      - name: Windows probe
        run: node scripts/windows-probe.mjs
      - name: Windows support summary
        if: always()
        run: echo "Windows support (non-blocking): PASS" >> "$GITHUB_STEP_SUMMARY"
`;
		const manifest = {
			...CANONICAL_MANIFEST,
			nonBlockingJobs: [
				{ job: "windows", run: "node scripts/windows-probe.mjs", summaryStep: "Windows support summary" },
			],
		};
		const report = runCiCheck({ repoRoot: makeFixture(brokenWorkflow, manifest) });
		assert.equal(report.ok, false, "a colon-space in an unquoted run scalar must fail closed");
		assert.ok(report.drifts.some((drift) => drift.code === "LITCODEX_CI_WORKFLOW_UNPARSEABLE"));
		writeEvidence("task-33-broken-single-line-run.json", report);
	});

	it("rejects lifecycle scripts during clean dependency bootstrap", () => {
		const unsafeBootstrap = CANONICAL_WORKFLOW.replace("npm ci --ignore-scripts", "npm ci");
		const root = makeFixture(unsafeBootstrap);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_INSTALL_COMMAND_INVALID"));
		writeEvidence("task-09-npm-ci.json", report);
	});

	it("rejects doctor QA that omits CODEX_BIN or falls back to an ambient command", () => {
		const exact = `          CODEX_BIN: ${LOCKED_CODEX_BIN}\n`;
		const omitted = runCiCheck({ repoRoot: makeFixture(CANONICAL_WORKFLOW.replace(exact, "")) });
		assert.equal(omitted.ok, false);
		assert.ok(omitted.drifts.some((drift) => drift.code === "LITCODEX_CI_LOCKED_HOST_INVALID"));

		const ambient = runCiCheck({
			repoRoot: makeFixture(CANONICAL_WORKFLOW.replace(exact, "          CODEX_BIN: codex\n")),
		});
		assert.equal(ambient.ok, false);
		assert.ok(ambient.drifts.some((drift) => drift.code === "LITCODEX_CI_LOCKED_HOST_INVALID"));
	});

	it("self-check is the first gate", () => {
		const root = makeFixture();
		const manifest = loadCiGateManifest(join(root, "tools", "ci-gate-manifest.json"));
		assert.equal(manifest.gates[0].run, "npm run check:ci");
		const runs = extractRunCommands(parseWorkflowYaml(CANONICAL_WORKFLOW));
		// first npm run <script> after npm ci is check:ci
		const firstRunScript = runs.find((r) => r.startsWith("npm run "));
		assert.equal(firstRunScript, "npm run check:ci");
		writeEvidence("task-09-self-check-first.json", { firstRunScript });
	});

	it("empty workflow fails closed", () => {
		const root = makeFixture("");
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_WORKFLOW_UNPARSEABLE"));
		writeEvidence("task-09-empty.json", report);
	});

	it("missing manifest fails closed", () => {
		const root = makeFixture();
		rmSync(join(root, "tools", "ci-gate-manifest.json"));
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_MANIFEST_MISSING"));
		writeEvidence("task-09-missing-manifest.json", report);
	});

	it("rejects non-JSON manifest", () => {
		const root = makeFixture();
		writeFileSync(join(root, "tools", "ci-gate-manifest.json"), "{broken");
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_MANIFEST_INVALID"));
		writeEvidence("task-09-bad-manifest.json", report);
	});

	it("forbidden-token scan includes comments", () => {
		const commented = CANONICAL_WORKFLOW.replace("jobs:", `# do not add ${T_NPM_PUBLISH} here\njobs:`);
		const root = makeFixture(commented);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(
			report.drifts.some(
				(d) => d.code === "LITCODEX_CI_FORBIDDEN_TOKEN" && d.details.token === T_NPM_PUBLISH.toLowerCase(),
			),
		);
		writeEvidence("task-09-comment-token.json", report);
	});

	it("tolerates CRLF and unicode comments", () => {
		const crlf = `# 한글 주석\n${CANONICAL_WORKFLOW}`.replace(/\n/g, "\r\n");
		const root = makeFixture(crlf);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, true, JSON.stringify(report.drifts));
		writeEvidence("task-09-crlf-unicode.json", report);
	});

	it("parses github-expression scalars as opaque", () => {
		const parsed = parseWorkflowYaml(CANONICAL_WORKFLOW);
		assert.equal(parsed.concurrency.group, GITHUB_CONCURRENCY_GROUP);
		writeEvidence("task-09-expr-opaque.json", { group: parsed.concurrency.group });
	});

	it("expression with && is not an anchor", () => {
		const withAmp = CANONICAL_WORKFLOW.replace(
			"cancel-in-progress: true",
			`cancel-in-progress: ${GITHUB_TRUE_AND_TRUE}`,
		);
		const parsed = parseWorkflowYaml(withAmp);
		assert.equal(parsed.concurrency["cancel-in-progress"], GITHUB_TRUE_AND_TRUE);
		writeEvidence("task-09-expr-amp.json", { value: parsed.concurrency["cancel-in-progress"] });
	});

	it("rejects anchor/alias bytes outside expressions", () => {
		const anchored = CANONICAL_WORKFLOW.replace("  verify:", "  verify: &base");
		const root = makeFixture(anchored);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_WORKFLOW_UNPARSEABLE"));
		writeEvidence("task-09-anchor.json", report);
	});

	it("final gate run is pack:all not pack:guard", () => {
		const root = makeFixture();
		const manifest = loadCiGateManifest(join(root, "tools", "ci-gate-manifest.json"));
		assert.equal(manifest.gates[11].run, "npm run pack:all");
		assert.ok(CANONICAL_WORKFLOW.includes("npm run pack:all"));
		assert.ok(!CANONICAL_WORKFLOW.includes(T_PACK_GUARD));
		writeEvidence("task-09-pack-all-key.json", { finalGate: manifest.gates[11].run });
	});

	it("build precedes pack in manifest and ci.yml", () => {
		const runs = extractRunCommands(parseWorkflowYaml(CANONICAL_WORKFLOW));
		assert.ok(runs.indexOf("npm run build") < runs.indexOf("npm run pack:all"));
		const buildIdx = CANONICAL_MANIFEST.gates.findIndex((g) => g.run === "npm run build");
		const packIdx = CANONICAL_MANIFEST.gates.findIndex((g) => g.run === "npm run pack:all");
		assert.ok(buildIdx < packIdx);
		writeEvidence("task-09-build-before-pack.json", { buildIdx, packIdx });
	});

	it("unknown gateOwner rejected", () => {
		const badManifest = structuredClone(CANONICAL_MANIFEST);
		badManifest.gates[0].gateOwner = "@litcodex/bogus";
		const root = makeFixture(CANONICAL_WORKFLOW, badManifest);
		const report = runCiCheck({ repoRoot: root });
		assert.equal(report.ok, false);
		assert.ok(report.drifts.some((d) => d.code === "LITCODEX_CI_MANIFEST_INVALID"));
		writeEvidence("task-09-bad-owner.json", report);
	});

	it("findForbiddenTokens scans case-insensitively", () => {
		const hits = findForbiddenTokens(`env: ${T_NPM_TOKEN}`, [T_NPM_TOKEN.toLowerCase()]);
		assert.deepEqual(hits, [T_NPM_TOKEN.toLowerCase()]);
	});

	it("CLI exits 0 and emits single-line JSON on a good tree", () => {
		const root = makeFixture();
		const res = spawnSync(process.execPath, [cliScript, "--json", "--repo-root", root], {
			encoding: "utf8",
			shell: false,
		});
		assert.equal(res.status, 0);
		const lines = res.stdout.trim().split("\n");
		assert.equal(lines.length, 1);
		const report = JSON.parse(lines[0]);
		assert.equal(report.ok, true);
		writeEvidence("task-09-json-mode.json", report);
	});

	it("CLI unknown flag exits 2", () => {
		const res = spawnSync(process.execPath, [cliScript, "--frobnicate"], {
			encoding: "utf8",
			shell: false,
		});
		assert.equal(res.status, 2);
		writeEvidence("task-09-usage-error.txt", `status=${res.status}\n${res.stderr}`);
	});

	it("self-immunity: validator + manifest carry no raw forbidden/legacy literal", () => {
		const validatorSrc = readFileSync(cliScript, "utf8").toLowerCase();
		const legacy = [
			["o", "m", "o"].join(""),
			["sisyphus", "labs"].join(""),
			["lazy", "codex"].join(""),
			["u", "l", "w"].join(""),
			["ultra", "work"].join(""),
			["oh-my-", "openagent"].join(""),
		];
		for (const tok of legacy) {
			assert.ok(!validatorSrc.includes(tok), `validator must not contain legacy token ${tok}`);
		}
		for (const tok of [
			T_NPM_PUBLISH.toLowerCase(),
			T_NPM_TOKEN.toLowerCase(),
			T_NODE_AUTH.toLowerCase(),
			T_PACK_GUARD,
		]) {
			assert.ok(!validatorSrc.includes(tok), `validator must not contain forbidden literal ${tok}`);
		}
		writeEvidence("task-09-self-immunity.txt", "validator + manifest are literal-free\n");
	});

	it("committed ci.yml passes check:ci", () => {
		const report = runCiCheck({ repoRoot });
		assert.equal(report.ok, true, JSON.stringify(report.drifts, null, 2));
		const workflowRuns = extractRunCommands(
			parseWorkflowYaml(readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8")),
		);
		const typecheckIndex = workflowRuns.indexOf("npm run typecheck");
		const testTypecheckIndex = workflowRuns.indexOf("npm run typecheck:tests");
		const lintIndex = workflowRuns.indexOf("npm run lint");
		assert.equal(testTypecheckIndex, typecheckIndex + 1, "test typecheck must immediately follow build typecheck");
		assert.equal(lintIndex, testTypecheckIndex + 1, "lint must follow restored-test typechecking");
		const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
		assert.equal(typeof packageJson.scripts["typecheck:tests"], "string");
		assert.ok(packageJson.scripts.check.includes("npm run typecheck:tests"));
		assert.equal(packageJson.scripts["qa:codex-host-locked"], "node scripts/verify-locked-codex.mjs");
		assert.match(packageJson.scripts["qa:uiux-installed:doctor"], /--scope doctor/);
		assert.match(packageJson.scripts["qa:uiux-installed"], /--scope full/);
		writeEvidence("task-09-committed.json", report);
	});
});
