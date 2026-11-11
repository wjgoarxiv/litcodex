#!/usr/bin/env node
// tools/pack-all.mjs — M19 CI pack gate (A3 C13 #8; the script `npm run pack:all` invokes).
//
// Per-workspace capture + merge + single assert (S19 addendum G3): runs
// `npm pack --dry-run --json --workspace <ws>` ONCE per validated package surface with a fixed argv
// (shell:false), merges the parsed PackResult arrays in deterministic order, then reconciles the
// merged array against tools/pack-payload-manifest.json via the assert-pack-payload library.
//
// This is npm-version-agnostic: it never depends on how npm concatenates multiple --workspace
// results into one array vs. several documents.
//
// Default mode is "present" (T08 gate): assert NO forbidden leaks AND every present file is an
// allowed/intended one. Installer runtime and npm bins are always required; only explicitly deferred
// requiredFuture content is omitted here. The FINAL hygiene gate (T28) passes --require-future to
// additionally enforce requiredFuture presence.
//
// Exit codes: 0 clean, 1 payload issue(s), 2 operator/npm fault.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkspaceBinError } from "../scripts/mark-cli-executable.mjs";
import { resolveNpmInvocation } from "../scripts/npm-command.mjs";
import { assertPayload, loadPayloadManifest, PackPayloadError, parsePackJson } from "./assert-pack-payload.mjs";
import {
	enrichPackResultsWithWorkspaceBins,
	loadPackBinContext,
	PackBinEnrichmentError,
} from "./enrich-pack-bin-paths.mjs";

/** The public installer and its shipped runtime workspaces, in deterministic order. */
export const PACK_VALIDATION_WORKSPACES = Object.freeze([
	"packages/litcodex-ai",
	"plugins/litcodex/components/lit-loop",
	"plugins/litcodex/components/wikify-knowledge",
]);

/**
 * Run `npm pack --dry-run --json --workspace <workspace>` once and return its parsed PackResult[].
 * `runNpm` is injectable so unit tests can stub npm without a real pack.
 * @param {string} workspace
 * @param {string} repoRoot
 * @param {(args:string[], cwd:string)=>{status:number|null, stdout:string, stderr:string, error?:Error}} [runNpm]
 * @returns {object[]}
 */
export function packWorkspace(workspace, repoRoot, runNpm = defaultRunNpm) {
	let declaration;
	let binContext;
	try {
		const workspaceRoot = resolve(repoRoot, workspace);
		binContext = loadPackBinContext(repoRoot);
		declaration = binContext.byWorkspaceRoot.get(workspaceRoot);
	} catch (error) {
		if (error instanceof WorkspaceBinError || error instanceof PackBinEnrichmentError) {
			throw new PackPayloadError(error.code, error.message, error.details);
		}
		throw error;
	}
	if (!declaration) {
		throw new PackPayloadError(
			"LITCODEX_PACK_WORKSPACE_INVALID",
			`pack workspace is not declared by the root package: ${workspace}`,
			{ workspace },
		);
	}
	const res = runNpm(["pack", "--dry-run", "--json", "--workspace", workspace], repoRoot);
	if (res.error || res.status !== 0) {
		throw new PackPayloadError(
			"LITCODEX_PACK_NPM_FAILED",
			`npm pack failed for workspace ${workspace} (status ${res.status}): ${res.stderr || res.error?.message || ""}`.trim(),
			{ workspace },
		);
	}
	const results = parsePackJson(res.stdout);
	for (const result of results) {
		if (result.name !== declaration.name) {
			throw new PackPayloadError(
				"LITCODEX_PACK_WORKSPACE_MISMATCH",
				`npm pack returned ${result.name} for workspace ${workspace}, expected ${declaration.name}`,
				{ workspace },
			);
		}
	}
	return enrichPackResultsWithWorkspaceBins(results, binContext);
}

/**
 * Run packWorkspace for every PACK_VALIDATION_WORKSPACES entry, concat the arrays IN ORDER, and return
 * the merged PackResult[]. Deterministic: same repo state → byte-identical array.
 * @param {string} repoRoot
 * @param {(args:string[], cwd:string)=>{status:number|null, stdout:string, stderr:string, error?:Error}} [runNpm]
 * @returns {object[]}
 */
export function packAll(repoRoot, runNpm = defaultRunNpm) {
	const merged = [];
	for (const ws of PACK_VALIDATION_WORKSPACES) {
		merged.push(...packWorkspace(ws, repoRoot, runNpm));
	}
	return merged;
}

/** Default npm runner: fixed argv, no shell. */
function defaultRunNpm(args, cwd) {
	const npm = resolveNpmInvocation(args);
	const res = spawnSync(npm.command, npm.args, { cwd, encoding: "utf8", shell: false });
	return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error };
}

// --- CLI ---------------------------------------------------------------------------------------

const USAGE = `Usage: node tools/pack-all.mjs [flags]

Packs the public installer and its private bundled component with \`npm pack --dry-run --json\`, merges the results,
and asserts the merged payload against tools/pack-payload-manifest.json.

Flags:
  --manifest <path>     Allowlist manifest (default <repo-root>/tools/pack-payload-manifest.json).
  --repo-root <path>    Repo root (default process.cwd()).
  --require-future      Final hygiene gate (T28): also assert requiredFuture paths are present.
  --json                Emit a machine-readable PayloadReport to stdout.
  --help, -h            Print this usage and exit 0.

Exit 0 = clean, 1 = payload issue(s), 2 = operator/npm fault.`;

/** @param {string[]} argv */
function parseArgs(argv) {
	const opts = { manifest: null, repoRoot: process.cwd(), json: false, requireFuture: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") opts.help = true;
		else if (a === "--json") opts.json = true;
		else if (a === "--require-future") opts.requireFuture = true;
		else if (a === "--manifest") opts.manifest = argv[++i];
		else if (a === "--repo-root") opts.repoRoot = argv[++i];
		else throw new PackPayloadError("USAGE", `unknown argument: ${a}`);
	}
	return opts;
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`[pack-all] ${err.message}\n${USAGE}\n`);
		process.exit(2);
	}
	if (opts.help) {
		process.stdout.write(`${USAGE}\n`);
		process.exit(0);
	}

	const manifestPath = opts.manifest ?? resolve(opts.repoRoot, "tools", "pack-payload-manifest.json");

	let results;
	let manifest;
	try {
		results = packAll(opts.repoRoot);
		manifest = loadPayloadManifest(manifestPath);
	} catch (err) {
		process.stderr.write(`[pack-all] ${err.message}\n`);
		process.exit(2);
	}

	const report = assertPayload(results, manifest, { requireFuture: opts.requireFuture });

	if (opts.json) {
		process.stdout.write(
			`${JSON.stringify({
				ok: report.ok,
				checkedPackages: report.checkedPackages,
				filesChecked: report.filesChecked,
				issues: report.issues,
			})}\n`,
		);
	} else if (report.ok) {
		process.stdout.write(
			`pack payload: OK (${report.checkedPackages.length} packages, ${report.filesChecked} files checked)\n`,
		);
	} else {
		for (const issue of report.issues) {
			process.stdout.write(`${issue.package ?? "—"}: [${issue.code}] ${issue.path ?? "—"} ${issue.message}\n`);
		}
		process.stdout.write(`pack payload: FAIL (${report.issues.length} issues)\n`);
	}

	process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	main();
}
