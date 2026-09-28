// scripts/path-robustness/runner.mjs — M20 top-level orchestration (T24).
//
// Anchors on process.cwd() (NEVER import.meta.url — the harness eats its own dogfood), runs the static
// path-fragility scan, resolves built artifacts, builds a scrubbed isolated env, materializes each
// hostile-path workspace, runs the probe battery, aggregates the report, and writes evidence JSON.
//
// The CLI wrapper maps: forbidden-scan-hit → exit 2; any case fail → exit 1; else 0. Artifact/scan-root
// faults already exited 3/4. Skips do NOT fail the run.

import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { resolveArtifacts } from "./build-artifacts.mjs";
import { PathRobustnessError } from "./errors.mjs";
import { expectedInstallPlan } from "./install-plan.mjs";
import { defaultScanRoots, scanForbiddenPathPatterns } from "./no-import-meta-pathname.mjs";
import { runSmokeBattery } from "./smoke-battery.mjs";
import { materializeWorkspace, PATH_ROBUSTNESS_CASES } from "./workspace-matrix.mjs";

const HISTORICAL_ENV_PREFIX = ["O", "M", "O", "_"].join("");
const ENV_SCRUB_RE = /^(LIT_LOOP_|LITCODEX_|CODEX_|PLUGIN_)/;

/** Clone process.env minus ambient session/plugin leaks; point HOME/CODEX_HOME at throwaway dirs. */
function buildScrubbedEnv(homeDir, codexHome) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!ENV_SCRUB_RE.test(key) && !key.startsWith(HISTORICAL_ENV_PREFIX) && key !== "PLUGIN_ROOT") {
			env[key] = value;
		}
	}
	env.HOME = homeDir;
	env.CODEX_HOME = codexHome;
	return env;
}

/**
 * Run the full path-robustness suite. Returns the PathRobustnessReport. Throws PathRobustnessError for
 * structural faults (missing artifacts/roots) — the CLI wrapper maps those to exit 3/4.
 *
 * @param {{keepWorkspaces?:boolean, only?:string, baseTmp?:string, evidenceDir?:string}} [opts]
 */
export async function runPathRobustness(opts = {}) {
	const repoRoot = process.cwd();
	const keep = opts.keepWorkspaces || process.env.LIT_PATHROBUST_KEEP === "1";
	const only = opts.only ?? process.env.LIT_PATHROBUST_ONLY;
	const baseTmp = opts.baseTmp ?? process.env.LIT_PATHROBUST_BASE ?? tmpdir();
	const evidenceDir =
		opts.evidenceDir ?? process.env.LIT_PATHROBUST_EVIDENCE_DIR ?? join(repoRoot, ".litcodex/evidence");

	// 1. Static scan first (cheap, deterministic). Non-empty hits → final exit 2, but still run cases.
	const hits = await scanForbiddenPathPatterns(defaultScanRoots(repoRoot), repoRoot);
	const scan = { ok: hits.length === 0, hits };

	// 2. Resolve built artifacts (throws LIT_PATHROBUST_ARTIFACT_MISSING → exit 3 if build absent).
	const artifacts = await resolveArtifacts(repoRoot);

	// 3. Isolated home + scrubbed env so no probe can read/write the real user home or leak ambient ids.
	const sandboxBase = await mkdtemp(join(baseTmp, "lit-pr-home-"));
	const homeDir = join(sandboxBase, "home");
	const codexHome = join(sandboxBase, "codex-home");
	await mkdir(homeDir, { recursive: true });
	await mkdir(codexHome, { recursive: true });
	const env = buildScrubbedEnv(homeDir, codexHome);
	const plan = expectedInstallPlan(repoRoot, codexHome);
	const cfg = {
		nodeBin: artifacts.nodeBin,
		env,
		homeDir,
		codexHome,
		installPlanHeader: plan.header,
		installPlanTitles: plan.titles,
	};

	const cases = only ? PATH_ROBUSTNESS_CASES.filter((c) => c.label === only) : PATH_ROBUSTNESS_CASES;
	const results = [];
	const skipped = [];

	try {
		for (const caseDef of cases) {
			let ws;
			try {
				ws = await materializeWorkspace(caseDef, { baseTmp, artifacts });
			} catch (err) {
				if (err instanceof PathRobustnessError && err.code === "LIT_PATHROBUST_WORKSPACE_UNSUPPORTED") {
					skipped.push({ label: caseDef.label, reason: err.message });
					continue;
				}
				throw err;
			}
			results.push(runSmokeBattery(ws, cfg));
			if (!keep) {
				await rm(ws.cleanupRoot, { recursive: true, force: true });
			}
		}
	} finally {
		if (!keep) {
			await rm(sandboxBase, { recursive: true, force: true });
		}
	}

	const report = {
		ok: scan.ok && results.every((r) => r.ok),
		node: process.version,
		platform: process.platform,
		scan,
		cases: results,
		skipped,
	};

	await mkdir(evidenceDir, { recursive: true });
	const target = join(evidenceDir, "task-24-report.json");
	const tmp = `${target}.${process.pid}.tmp`;
	await writeFile(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await rm(target, { force: true });
	await rename(tmp, target);

	return report;
}
