#!/usr/bin/env node
// tools/assert-git-hygiene.mjs — M19 git-hygiene gate (the final repo-hygiene check of plan T28).
//
// Enumerates tracked files via `git ls-files -z` from the repo root and asserts NO tracked path
// matches the repo-wide `gitForbiddenSegments` denylist (.litcodex/, # REFERENCE, .tgz, HANDOFF,
// /evidence/, /.qa-tmp/) — proving no local artifact, read-only archive, tarball, or handoff file
// leaks into version control.
//
// Deliberately a DIFFERENT denylist from the tarball gate (`forbiddenSegments`): dist/**,
// tsconfig*, tests, fixtures, helpers, and Vitest configs are legitimately TRACKED in the tree yet
// MUST NOT be PUBLISHED. git-hygiene reads
// `gitForbiddenSegments`; the pack gate reads `forbiddenSegments` + `forbiddenSegmentRules`.
//
// Pure string reconciliation: paths come back FROM git via a fixed argv (shell:false) and are NEVER
// passed back into a shell, opened, stat'd, or executed.
//
// Exit codes (S19 §Exit-codes / §Failure-modes #7):
//   0 = clean: no tracked file matches any forbidden segment.
//   1 = one or more tracked local artifacts found (the "must fix the tree" code).
//   2 = git fault: not a git repo / git unavailable. NOT 0 — a non-checkout must never VACUOUSLY pass.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILTIN_FORBIDDEN_SEGMENTS, firstForbiddenSegment, normalizePath } from "./assert-pack-payload.mjs";

// --- Error type --------------------------------------------------------------------------------

/** Thrown for git environment faults (non-repo / missing binary). Tracked-artifact leaks are
 *  returned as offenders in the report, not thrown. */
export class GitHygieneError extends Error {
	/**
	 * @param {string} code
	 * @param {string} message
	 */
	constructor(code, message) {
		super(message);
		this.name = "GitHygieneError";
		this.code = code;
	}
}

// --- Manifest denylist loader ------------------------------------------------------------------

/**
 * Read `gitForbiddenSegments` from the pack-payload manifest (the dedicated tracked-file denylist,
 * separate from the tarball `forbiddenSegments`). Throws GitHygieneError if the key is missing or
 * malformed so the gate can never run against an empty denylist (a silent vacuous pass).
 * @param {string} manifestPath
 * @returns {string[]}
 */
export function loadGitForbiddenSegments(manifestPath) {
	return loadGitHygienePolicy(manifestPath).forbiddenSegments;
}

/** Load the tracked-file denylist and its exact/scoped exemption rules. */
export function loadGitHygienePolicy(manifestPath) {
	let raw;
	try {
		raw = readFileSync(manifestPath, "utf8");
	} catch (err) {
		throw new GitHygieneError(
			"LITCODEX_HYGIENE_MANIFEST_INVALID",
			`cannot read manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	let m;
	try {
		m = JSON.parse(raw);
	} catch (err) {
		throw new GitHygieneError(
			"LITCODEX_HYGIENE_MANIFEST_INVALID",
			`manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (
		m === null ||
		typeof m !== "object" ||
		!Array.isArray(m.gitForbiddenSegments) ||
		m.gitForbiddenSegments.length === 0
	) {
		throw new GitHygieneError(
			"LITCODEX_HYGIENE_MANIFEST_INVALID",
			"manifest.gitForbiddenSegments must be a non-empty string array",
		);
	}
	if (m.gitForbiddenSegmentRules !== undefined && !Array.isArray(m.gitForbiddenSegmentRules)) {
		throw new GitHygieneError(
			"LITCODEX_HYGIENE_MANIFEST_INVALID",
			"manifest.gitForbiddenSegmentRules must be an array when present",
		);
	}
	return {
		forbiddenSegments: [...new Set([...BUILTIN_FORBIDDEN_SEGMENTS, ...m.gitForbiddenSegments])],
		forbiddenSegmentRules: m.gitForbiddenSegmentRules ?? [],
	};
}

// --- Tracked-file enumeration (impure: spawns git) ---------------------------------------------

/**
 * Enumerate tracked files via `git ls-files -z` from repoRoot. Fixed argv, no shell. Throws
 * GitHygieneError(LITCODEX_HYGIENE_GIT_UNAVAILABLE) if git is missing, or
 * GitHygieneError(LITCODEX_HYGIENE_NOT_GIT_REPO) if the command fails (non-repo) — NEVER returns []
 * on failure, so the gate cannot vacuously pass outside a checkout (S19 §Failure-modes #7, R5).
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listTrackedFiles(repoRoot) {
	const res = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", shell: false });
	if (res.error) {
		if (res.error.code === "ENOENT") {
			throw new GitHygieneError("LITCODEX_HYGIENE_GIT_UNAVAILABLE", "git binary not found on PATH");
		}
		throw new GitHygieneError("LITCODEX_HYGIENE_NOT_GIT_REPO", `git ls-files failed: ${res.error.message}`);
	}
	if (res.status !== 0) {
		throw new GitHygieneError(
			"LITCODEX_HYGIENE_NOT_GIT_REPO",
			`git ls-files exited ${res.status} in ${repoRoot} (not a git repository?): ${(res.stderr ?? "").trim()}`,
		);
	}
	return (res.stdout ?? "").split("\0").filter((s) => s.length > 0);
}

// --- Pure reconciliation -----------------------------------------------------------------------

/**
 * Reconcile a tracked-file list against gitForbiddenSegments. Pure; never spawns. Each tracked path
 * is normalized (backslash→slash, collapse "./") then substring-matched against each forbidden
 * segment; the FIRST hit is recorded as an offender. Byte-exact (no case fold) so #/space/unicode
 * paths survive verbatim.
 * @param {readonly string[]} trackedFiles
 * @param {readonly string[]} forbiddenSegments
 * @param {ReadonlyArray<{segment:string,exemptUnderPrefixes?:string[],exemptPaths?:string[]}>} [forbiddenSegmentRules]
 * @returns {{ok:boolean, trackedCount:number, offenders:Array<{path:string, segment:string}>}}
 */
export function assertGitHygiene(trackedFiles, forbiddenSegments, forbiddenSegmentRules = []) {
	const offenders = [];
	for (const path of trackedFiles) {
		const normalized = normalizePath(path);
		const segment = firstForbiddenSegment(normalized, forbiddenSegments, forbiddenSegmentRules);
		if (segment !== null) offenders.push({ path, segment });
	}
	return { ok: offenders.length === 0, trackedCount: trackedFiles.length, offenders };
}

// --- CLI ---------------------------------------------------------------------------------------

const USAGE = `Usage: node tools/assert-git-hygiene.mjs [flags]

Asserts no tracked file (\`git ls-files\`) matches the manifest's gitForbiddenSegments denylist
(.litcodex/, # REFERENCE, .tgz, HANDOFF, /evidence/, /.qa-tmp/, plus built-in
fragment-assembled terms). The final repo-hygiene gate of plan T28. Repository tests, fixtures,
helpers, Vitest configs, dist/**, and tsconfig* remain trackable but are forbidden in packages.

Flags:
  --repo-root <path>    Repo root to run git ls-files in (default process.cwd()).
  --manifest <path>     Manifest providing gitForbiddenSegments (default <repo-root>/tools/pack-payload-manifest.json).
  --json                Emit a machine-readable GitHygieneReport to stdout.
  --help, -h            Print this usage and exit 0.

Exit 0 = clean, 1 = tracked local artifact(s), 2 = git/manifest fault (never a vacuous pass).`;

/** @param {string[]} argv */
function parseArgs(argv) {
	const opts = { repoRoot: process.cwd(), manifest: null, json: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") opts.help = true;
		else if (a === "--json") opts.json = true;
		else if (a === "--repo-root") opts.repoRoot = argv[++i];
		else if (a === "--manifest") opts.manifest = argv[++i];
		else throw new GitHygieneError("USAGE", `unknown argument: ${a}`);
	}
	return opts;
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`[assert-git-hygiene] ${err.message}\n${USAGE}\n`);
		process.exit(2);
	}
	if (opts.help) {
		process.stdout.write(`${USAGE}\n`);
		process.exit(0);
	}

	const manifestPath = opts.manifest ?? resolve(opts.repoRoot, "tools", "pack-payload-manifest.json");

	let policy;
	let tracked;
	try {
		policy = loadGitHygienePolicy(manifestPath);
		tracked = listTrackedFiles(opts.repoRoot);
	} catch (err) {
		process.stderr.write(`[assert-git-hygiene] ${err.message}\n`);
		process.exit(2);
	}

	const report = assertGitHygiene(tracked, policy.forbiddenSegments, policy.forbiddenSegmentRules);

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} else if (report.ok) {
		process.stdout.write(`git hygiene: OK (${report.trackedCount} tracked files, 0 forbidden)\n`);
	} else {
		for (const o of report.offenders) {
			process.stdout.write(`${o.path} [${o.segment}]\n`);
		}
		process.stdout.write(`git hygiene: FAIL (${report.offenders.length} tracked local artifacts)\n`);
	}

	process.exit(report.ok ? 0 : 1);
}

// Run as CLI only when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
	main();
}
