#!/usr/bin/env node
// tools/scan-legacy-tokens.mjs — M04 legacy-token scanner & allowlist (replaces the M02 stub).
//
// Brand-hygiene gate: enumerate every tracked or untracked-nonignored candidate text file in the
// litcodex/ repo, scan each for the seven legacy tokens, reconcile hits against
// tools/legacy-token-allowlist.json, and fail the build on any unallowlisted leak.
//
// Exit codes (S04 §Exit-code table; A3 C11):
//   0 = clean (no offenders, no dead entries, no errors)
//   1 = any substantive fault (leak / dead allowlist entry / allowlist fault / git fault) — fail-closed
//   2 = operator/usage error (unknown flag, stray positional, missing flag value)
//
// Match semantics (A3 C10, S04 addendum §A): the two short tokens (indices 0 and 3) match on
// ASCII word-boundary (bounded); the five long tokens match on case-insensitive substring.
// `codex`/`litcodex`/`lit-loop`/`lit` are NEVER guarded.
//
// Self-immunity: LEGACY_TOKENS are assembled from fragments so this source contains no literal
// legacy token and never flags itself.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	assertCanonicalCorpusSnapshotStable,
	CANONICAL_CORPUS_RELATIVE_ROOT,
	CanonicalCorpusError,
	verifyCanonicalCorpus,
} from "../plugins/litcodex/skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs";

// --- Legacy token set (assembled from fragments; self-immunity) -------------------------------

/** The seven guarded legacy tokens, lowercase, deterministic order. */
export const LEGACY_TOKENS = Object.freeze([
	["o", "m", "o"].join(""),
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["u", "l", "w"].join(""),
	["ultra", "work"].join(""),
	["oh-my-", "openagent"].join(""),
	["open", "code"].join(""),
]);

/** Per-token match mode (S04 addendum §A.1). Bounded for the two short, collision-prone
 *  tokens (indices 0 and 3); substring for the five long, collision-free tokens. Keyed by
 *  assembled token strings so this source stays token-literal-free. */
export const DEFAULT_MATCH_MODES = Object.freeze({
	[LEGACY_TOKENS[0]]: "bounded",
	[LEGACY_TOKENS[1]]: "substring",
	[LEGACY_TOKENS[2]]: "substring",
	[LEGACY_TOKENS[3]]: "bounded",
	[LEGACY_TOKENS[4]]: "substring",
	[LEGACY_TOKENS[5]]: "substring",
	[LEGACY_TOKENS[6]]: "substring",
});

const SELF_PATH = fileURLToPath(import.meta.url);

// --- Error type --------------------------------------------------------------------------------

export class LegacyScanError extends Error {
	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {Record<string, unknown>} [details]
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "LegacyScanError";
		this.code = code;
		this.details = details;
	}
}

export class ExternalTermScanError extends Error {
	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {Record<string, unknown>} [details]
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "ExternalTermScanError";
		this.code = code;
		this.details = details;
	}
}

// --- Pure matcher (S04 addendum §A.3) ----------------------------------------------------------

function isWordChar(c) {
	return c !== "" && c >= "0" && c <= "z" && /[a-z0-9]/.test(c);
}

/**
 * Return ALL ascending match start offsets of `token` in `haystack` under `mode`,
 * case-insensitive. Pure. Reused by the per-module guards (M03/M14/M15/M16).
 * @param {string} haystack
 * @param {string} token  lowercase
 * @param {"substring"|"bounded"} mode
 * @returns {number[]}
 */
export function matchToken(haystack, token, mode) {
	const lc = haystack.toLowerCase();
	const t = token;
	const out = [];
	if (t.length === 0) return out;
	let from = 0;
	for (;;) {
		const i = lc.indexOf(t, from);
		if (i === -1) break;
		if (mode === "bounded") {
			const before = i === 0 ? "" : lc[i - 1];
			const after = i + t.length >= lc.length ? "" : lc[i + t.length];
			if (!isWordChar(before) && !isWordChar(after)) {
				out.push(i);
				from = i + t.length;
			} else {
				from = i + 1; // reject; advance one so overlapping bounded hits are still found
			}
		} else {
			out.push(i);
			from = i + t.length;
		}
	}
	return out;
}

// --- Binary detection --------------------------------------------------------------------------

/** True when the buffer looks binary (contains a NUL byte). Pure. */
export function isBinary(buffer) {
	return buffer.includes(0);
}

// --- Per-file scan -----------------------------------------------------------------------------

// Control-char class (C0 range NUL..US plus DEL), assembled from char codes so this source
// carries no literal control character and biome's noControlCharactersInRegex rule does not fire.
const CONTROL_CHAR_RE = new RegExp(
	`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
	"g",
);

function sanitizeContext(line) {
	// Replace control chars with a space, then truncate to 200 chars.
	const cleaned = line.replace(CONTROL_CHAR_RE, " ");
	return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}

/**
 * All token hits in a single file's text. Pure, deterministic, multi-hit per line.
 * @param {string} path
 * @param {string} text
 * @param {readonly string[]} [tokens]
 * @param {Readonly<Record<string,"substring"|"bounded">>} [modes]
 * @returns {Array<{path:string,token:string,line:number,column:number,context:string,mode:string}>}
 */
export function scanText(path, text, tokens = LEGACY_TOKENS, modes = DEFAULT_MATCH_MODES) {
	const hits = [];
	const lines = text.split(/\r\n|\r|\n/);
	for (let li = 0; li < lines.length; li++) {
		const line = lines[li];
		for (const token of tokens) {
			const mode = modes[token] ?? "substring";
			const offsets = matchToken(line, token, mode);
			for (const off of offsets) {
				hits.push({
					path,
					token,
					line: li + 1,
					column: off + 1,
					context: sanitizeContext(line),
					mode,
				});
			}
		}
	}
	return hits;
}

// --- Scanner-owned paths (informational; A3 §isScannerOwnedPath) -------------------------------

const SCANNER_OWNED = new Set([
	"tools/scan-legacy-tokens.mjs",
	"tools/scan-legacy-tokens.test.mjs",
	"tools/legacy-token-allowlist.json",
	"tools/legacy-token-allowlist.schema.json",
]);

/** True when this path is one of the scanner's own machinery files. Informational only. */
export function isScannerOwnedPath(repoRelPath) {
	return SCANNER_OWNED.has(repoRelPath);
}

// --- Allowlist load + validate -----------------------------------------------------------------

const ALLOWED_KEYS = ["path", "token", "reason", "removalCondition"];

/**
 * Load + validate the allowlist. Throws LegacyScanError on any structural fault.
 * @param {string} allowlistPath
 * @returns {{version:1, entries:Array<{path:string,token:string,reason:string,removalCondition:string}>}}
 */
export function loadAllowlist(allowlistPath) {
	let raw;
	try {
		raw = readFileSync(allowlistPath, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") {
			throw new LegacyScanError("LITCODEX_SCAN_ALLOWLIST_MISSING", `allowlist not found: ${allowlistPath}`, {
				path: allowlistPath,
			});
		}
		throw new LegacyScanError("LITCODEX_SCAN_ALLOWLIST_MISSING", `allowlist unreadable: ${allowlistPath}`, {
			path: allowlistPath,
		});
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new LegacyScanError("LITCODEX_SCAN_ALLOWLIST_INVALID_JSON", `allowlist is not valid JSON: ${err.message}`, {
			path: allowlistPath,
		});
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new LegacyScanError("LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID", "allowlist root must be an object", {});
	}
	if (parsed.version !== 1) {
		throw new LegacyScanError(
			"LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID",
			`allowlist version must be 1 (got ${JSON.stringify(parsed.version)})`,
			{ field: "version" },
		);
	}
	if (!Array.isArray(parsed.entries)) {
		throw new LegacyScanError("LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID", "allowlist.entries must be an array", {
			field: "entries",
		});
	}
	const legacySet = new Set(LEGACY_TOKENS);
	parsed.entries.forEach((entry, index) => {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			throw new LegacyScanError("LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID", `entry ${index} must be an object`, {
				index,
			});
		}
		// Legacy M02 field name → hard, self-explaining failure (addendum §B clause 1).
		if (Object.hasOwn(entry, "removeWhen")) {
			throw new LegacyScanError(
				"LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID",
				`entry ${index} uses the superseded key "removeWhen"`,
				{ index, field: "removeWhen", hint: "renamed to removalCondition" },
			);
		}
		// Strict no-extra-keys (addendum §B clause 2).
		for (const key of Object.keys(entry)) {
			if (!ALLOWED_KEYS.includes(key)) {
				throw new LegacyScanError(
					"LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID",
					`entry ${index} has unexpected key "${key}"`,
					{ index, field: key },
				);
			}
		}
		// Required, non-empty-after-trim string fields.
		for (const field of ALLOWED_KEYS) {
			const value = entry[field];
			if (typeof value !== "string" || value.trim() === "") {
				throw new LegacyScanError(
					"LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID",
					`entry ${index} field "${field}" must be a non-empty string`,
					{ index, field },
				);
			}
		}
		// Path safety: no traversal, no leading slash, no backslash.
		const p = entry.path;
		if (p.includes("..") || p.startsWith("/") || p.includes("\\")) {
			throw new LegacyScanError(
				"LITCODEX_SCAN_ALLOWLIST_SCHEMA_INVALID",
				`entry ${index} has an unsafe path "${p}"`,
				{ index, field: "path" },
			);
		}
		// Token must be a guarded legacy token.
		if (!legacySet.has(entry.token)) {
			throw new LegacyScanError(
				"LITCODEX_SCAN_ALLOWLIST_UNKNOWN_TOKEN",
				`entry ${index} token "${entry.token}" is not a guarded legacy token`,
				{ index, token: entry.token },
			);
		}
	});
	if (parsed.entries.length > 0) {
		throw new LegacyScanError(
			"LITCODEX_SCAN_ALLOWLIST_NONEMPTY",
			"allowlist entries are not permitted; tracked files must be zero-trace clean",
			{ field: "entries", count: parsed.entries.length },
		);
	}

	return { version: 1, entries: parsed.entries };
}

/**
 * Load external terms from an untracked, caller-supplied JSON file. The returned values are for
 * in-memory matching only; reports use opaque ids so raw values do not leak into logs.
 * @param {string} termsPath
 * @returns {Array<{id:string,value:string,matchMode:"substring"|"bounded"}>}
 */
export function loadExternalTerms(termsPath) {
	let raw;
	try {
		raw = readFileSync(termsPath, "utf8");
	} catch (err) {
		if (err && err.code === "ENOENT") {
			throw new ExternalTermScanError(
				"LITCODEX_EXTERNAL_TERMS_MISSING",
				`external terms file not found: ${termsPath}`,
				{
					path: termsPath,
				},
			);
		}
		throw new ExternalTermScanError(
			"LITCODEX_EXTERNAL_TERMS_MISSING",
			`external terms file unreadable: ${termsPath}`,
			{
				path: termsPath,
			},
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ExternalTermScanError(
			"LITCODEX_EXTERNAL_TERMS_INVALID_JSON",
			`external terms file is not valid JSON: ${err.message}`,
		);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ExternalTermScanError(
			"LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID",
			"external terms root must be an object",
		);
	}
	if (parsed.version !== 1) {
		throw new ExternalTermScanError("LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID", "external terms version must be 1", {
			field: "version",
		});
	}
	if (!Array.isArray(parsed.terms)) {
		throw new ExternalTermScanError("LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID", "external terms must be an array", {
			field: "terms",
		});
	}
	const ids = new Set();
	return parsed.terms.map((entry, index) => {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			throw new ExternalTermScanError("LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} must be an object`, {
				index,
			});
		}
		for (const field of ["id", "value", "matchMode"]) {
			if (typeof entry[field] !== "string" || entry[field].trim() === "") {
				throw new ExternalTermScanError(
					"LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID",
					`term ${index} field ${field} must be a non-empty string`,
					{ index, field },
				);
			}
		}
		if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(entry.id)) {
			throw new ExternalTermScanError("LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} id is invalid`, {
				index,
				field: "id",
			});
		}
		if (ids.has(entry.id)) {
			throw new ExternalTermScanError("LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID", `term ${index} id is duplicated`, {
				index,
				field: "id",
			});
		}
		ids.add(entry.id);
		if (entry.matchMode !== "substring" && entry.matchMode !== "bounded") {
			throw new ExternalTermScanError(
				"LITCODEX_EXTERNAL_TERMS_SCHEMA_INVALID",
				`term ${index} matchMode is invalid`,
				{
					index,
					field: "matchMode",
				},
			);
		}
		return { id: entry.id, value: entry.value.toLowerCase(), matchMode: entry.matchMode };
	});
}

// --- git ls-files ------------------------------------------------------------------------------

const GIT_REDIRECTION_ENV = Object.freeze([
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_QUARANTINE_PATH",
	"GIT_CEILING_DIRECTORIES",
	"GIT_DISCOVERY_ACROSS_FILESYSTEM",
	"GIT_NAMESPACE",
	"GIT_REPLACE_REF_BASE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_SHALLOW_FILE",
]);

function gitEnvironment() {
	const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
	for (const key of Object.keys(env)) {
		if (key === "GIT_CONFIG" || key === "GIT_CONFIG_PARAMETERS" || key.startsWith("GIT_CONFIG_")) {
			delete env[key];
		}
	}
	for (const key of GIT_REDIRECTION_ENV) delete env[key];
	return env;
}

function boundedDiagnostic(value, maxLength = 2_000) {
	const cleaned = String(value ?? "").replace(CONTROL_CHAR_RE, " ");
	return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function gitFailure(err, operation, repoRoot) {
	const stderr = err?.stderr ? boundedDiagnostic(err.stderr.toString("utf8")) : "";
	if (err?.code === "ENOENT") {
		return new LegacyScanError("LITCODEX_SCAN_GIT_FAILED", "git not found on PATH", { stderr });
	}
	if (/not a git repository/i.test(stderr)) {
		return new LegacyScanError("LITCODEX_SCAN_NOT_A_GIT_REPO", `not a git repository: ${repoRoot}`, {
			stderr,
			repoRoot,
		});
	}
	return new LegacyScanError("LITCODEX_SCAN_GIT_FAILED", `${operation} failed`, {
		status: err?.status,
		stderr,
	});
}

function canonicalPath(path, label) {
	try {
		return realpathSync.native(resolve(path));
	} catch (err) {
		throw new LegacyScanError("LITCODEX_SCAN_GIT_FAILED", `${label} could not be canonicalized`, {
			path: boundedDiagnostic(resolve(path), 500),
			causeCode: typeof err?.code === "string" ? boundedDiagnostic(err.code, 64) : "UNKNOWN",
		});
	}
}

function discoverGitTopLevel(cwd, env) {
	let out;
	try {
		out = execFileSync("git", ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], {
			cwd,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		throw gitFailure(err, "git rev-parse", cwd);
	}
	const topLevel = out.trim();
	if (topLevel === "") {
		throw new LegacyScanError("LITCODEX_SCAN_GIT_FAILED", "git rev-parse returned an empty top-level", {});
	}
	return canonicalPath(topLevel, "git top-level");
}

/**
 * Enumerate tracked files via `git ls-files -z`. Throws LegacyScanError.
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function listTrackedFiles(repoRoot) {
	return enumerateTrackedFiles(repoRoot).files;
}

/** Enumerate the exact worktree candidate: tracked plus untracked nonignored files. */
export function listCandidateFiles(repoRoot) {
	return enumerateCandidateFiles(repoRoot).files;
}

function enumerateTrackedFiles(repoRoot) {
	const context = verifiedGitContext(repoRoot);
	return { context, files: runGitLsFiles(context, ["-z"]) };
}

function enumerateCandidateFiles(repoRoot, beforeCandidateEnumeration) {
	const context = verifiedGitContext(repoRoot);
	beforeCandidateEnumeration?.();
	return {
		context,
		files: runGitLsFiles(context, ["--cached", "--others", "--exclude-standard", "-z"]),
	};
}

function verifiedGitContext(repoRoot) {
	const readRoot = resolve(repoRoot);
	const requestedRoot = canonicalPath(readRoot, "requested repository root");
	const env = gitEnvironment();
	const discoveredRoot = discoverGitTopLevel(requestedRoot, env);
	if (discoveredRoot !== requestedRoot) {
		throw new LegacyScanError(
			"LITCODEX_SCAN_REPO_ROOT_MISMATCH",
			"git top-level does not match the requested repository root",
			{
				requestedRepoRoot: boundedDiagnostic(requestedRoot, 500),
				discoveredRepoRoot: boundedDiagnostic(discoveredRoot, 500),
			},
		);
	}
	return { root: requestedRoot, readRoot, env };
}

function runGitLsFiles(context, args) {
	let out;
	try {
		out = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", ...args], {
			cwd: context.root,
			env: context.env,
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		throw gitFailure(err, "git ls-files", context.root);
	}
	return out
		.toString("utf8")
		.split("\0")
		.filter((p) => p.length > 0);
}

// --- Reconcile (S04 addendum §C: dead vs pending) ----------------------------------------------

/**
 * Reconcile hits against the allowlist using the enumerated-file set for pending detection.
 * @param {Array<{path:string,token:string}>} hits
 * @param {{entries:Array<{path:string,token:string}>}} allowlist
 * @param {ReadonlySet<string>} trackedPaths
 */
export function reconcile(hits, allowlist, trackedPaths) {
	const keyOf = (path, token) => `${path} ${token}`;
	const allowedKeys = new Set(allowlist.entries.map((e) => keyOf(e.path, e.token)));

	const offenders = hits.filter((h) => !allowedKeys.has(keyOf(h.path, h.token)));

	const hitKeys = new Set(hits.map((h) => keyOf(h.path, h.token)));
	const usedEntries = new Set();
	const deadEntries = [];
	const pendingEntries = [];
	for (const entry of allowlist.entries) {
		if (!trackedPaths.has(entry.path)) {
			pendingEntries.push(entry);
			continue;
		}
		const key = keyOf(entry.path, entry.token);
		if (hitKeys.has(key)) {
			usedEntries.add(key);
		} else {
			deadEntries.push(entry);
		}
	}
	return { offenders, usedEntries, deadEntries, pendingEntries };
}

// --- Orchestration (never throws) --------------------------------------------------------------

function candidateReadError(rel, err) {
	const path = boundedDiagnostic(rel, 500);
	const causeCode = typeof err?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(err.code) ? err.code : "UNKNOWN";
	return {
		code: "LITCODEX_SCAN_CANDIDATE_READ_FAILED",
		message: `candidate file could not be read: ${path}`,
		details: { path, causeCode },
	};
}

function candidateUnstableError(rel, attempts) {
	const path = boundedDiagnostic(rel, 500);
	return {
		code: "LITCODEX_SCAN_CANDIDATE_UNSTABLE",
		message: `candidate file state did not stabilize: ${path}`,
		details: { path, attempts },
	};
}

function reportLegacyError(errors, err) {
	errors.push({ code: err.code, message: err.message, details: err.details });
}

/**
 * Return the exact candidate paths protected from the built-in legacy-token scan by the immutable
 * canonical frontend corpus.
 * The set is available only after the complete path/size/hash/legal verifier succeeds.
 * Repositories without that optional corpus retain the ordinary zero-exemption scanner behavior.
 */
function captureCanonicalCorpusProtection(repoRoot, verifierFs) {
	const corpusRoot = join(repoRoot, CANONICAL_CORPUS_RELATIVE_ROOT);
	const enrolledSkillPath = join(repoRoot, "plugins/litcodex/skills/frontend-ui-ux/SKILL.md");
	let stat;
	try {
		stat = statSync(corpusRoot, { throwIfNoEntry: false });
	} catch (error) {
		throw new LegacyScanError("LITCODEX_CANONICAL_CORPUS_UNREADABLE", "canonical corpus root is unreadable", {
			causeCode: typeof error?.code === "string" ? boundedDiagnostic(error.code, 64) : "UNKNOWN",
		});
	}
	if (stat === undefined) {
		let enrolled;
		try {
			enrolled = statSync(enrolledSkillPath, { throwIfNoEntry: false });
		} catch (error) {
			throw new LegacyScanError("LITCODEX_CANONICAL_CORPUS_UNREADABLE", "frontend skill enrollment is unreadable", {
				causeCode: typeof error?.code === "string" ? boundedDiagnostic(error.code, 64) : "UNKNOWN",
			});
		}
		if (enrolled !== undefined) {
			throw new LegacyScanError("LITCODEX_CANONICAL_CORPUS_MISSING", "enrolled canonical corpus root is missing", {
				corpus: CANONICAL_CORPUS_RELATIVE_ROOT,
			});
		}
		return { paths: new Set(), report: null };
	}
	try {
		const report = verifyCanonicalCorpus(corpusRoot, verifierFs);
		return {
			paths: new Set([
				...report.protectedRelativePaths.map((path) => `${CANONICAL_CORPUS_RELATIVE_ROOT}/${path}`),
				`${CANONICAL_CORPUS_RELATIVE_ROOT}/MANIFEST.json`,
			]),
			report,
		};
	} catch (error) {
		if (!(error instanceof CanonicalCorpusError)) throw error;
		throw new LegacyScanError(error.code, error.message, { corpus: CANONICAL_CORPUS_RELATIVE_ROOT });
	}
}

export function loadCanonicalCorpusProtection(repoRoot, verifierFs) {
	return captureCanonicalCorpusProtection(repoRoot, verifierFs).paths;
}

function confirmMissingCandidate(context, rel, beforeDeletionConfirmation, errors) {
	beforeDeletionConfirmation?.(rel);
	let deleted;
	try {
		deleted = runGitLsFiles(context, ["--deleted", "-z", "--", rel]).includes(rel);
	} catch (err) {
		if (!(err instanceof LegacyScanError)) throw err;
		reportLegacyError(errors, err);
		return { kind: "error" };
	}
	try {
		const stat = statSync(resolve(context.root, rel), { throwIfNoEntry: false });
		return stat === undefined ? { kind: deleted ? "deleted" : "missing" } : { kind: "reappeared" };
	} catch (err) {
		errors.push(candidateReadError(rel, err));
		return { kind: "error" };
	}
}

const MAX_CANDIDATE_READ_ATTEMPTS = 3;

function readCandidateText(context, rel, readFile, beforeDeletionConfirmation, errors) {
	const absPath = resolve(context.readRoot, rel);
	let observedExisting = false;
	for (let attempt = 1; attempt <= MAX_CANDIDATE_READ_ATTEMPTS; attempt++) {
		let st;
		try {
			st = statSync(absPath, { throwIfNoEntry: false });
		} catch (err) {
			errors.push(candidateReadError(rel, err));
			return null;
		}
		if (st === undefined) {
			const confirmation = confirmMissingCandidate(context, rel, beforeDeletionConfirmation, errors);
			if (confirmation.kind === "reappeared") {
				observedExisting = true;
				continue;
			}
			if (confirmation.kind === "deleted" && !observedExisting) return null;
			if (confirmation.kind !== "error") errors.push(candidateReadError(rel, { code: "ENOENT" }));
			return null;
		}
		if (!st.isFile()) return null; // gitlink or directory
		observedExisting = true;
		let buf;
		try {
			buf = readFile(absPath);
		} catch (err) {
			if (err?.code !== "ENOENT") {
				errors.push(candidateReadError(rel, err));
				return null;
			}
			const confirmation = confirmMissingCandidate(context, rel, beforeDeletionConfirmation, errors);
			if (confirmation.kind === "reappeared") continue;
			if (confirmation.kind !== "error") errors.push(candidateReadError(rel, err));
			return null;
		}
		if (isBinary(buf)) return null;
		return buf.toString("utf8");
	}
	errors.push(candidateUnstableError(rel, MAX_CANDIDATE_READ_ATTEMPTS));
	return null;
}

/**
 * Top-level scan. Never throws; converts LegacyScanError into report.errors.
 * @param {{repoRoot:string, allowlistPath:string, tokens?:readonly string[], modes?:Record<string,string>, readFile?:(path:string)=>Buffer, canonicalFs?:object, afterCanonicalCapture?:()=>void, beforeCandidateEnumeration?:()=>void, beforeDeletionConfirmation?:(path:string)=>void}} opts
 */
export function runScan(opts) {
	const tokens = opts.tokens ?? LEGACY_TOKENS;
	const modes = opts.modes ?? DEFAULT_MATCH_MODES;
	const readFile = opts.readFile ?? readFileSync;
	const errors = [];
	const emptyReport = (extra = {}) => ({
		ok: false,
		scannedFiles: 0,
		totalHits: 0,
		allowlistedHits: 0,
		offenders: [],
		deadEntries: [],
		pendingEntries: [],
		errors,
		...extra,
	});

	let allowlist;
	try {
		allowlist = loadAllowlist(opts.allowlistPath);
	} catch (err) {
		if (!(err instanceof LegacyScanError)) throw err;
		errors.push({ code: err.code, message: err.message, details: err.details });
		return emptyReport();
	}

	let candidate;
	let canonicalCapture;
	try {
		canonicalCapture = captureCanonicalCorpusProtection(opts.repoRoot, opts.canonicalFs);
		opts.afterCanonicalCapture?.();
	} catch (err) {
		if (!(err instanceof LegacyScanError)) throw err;
		reportLegacyError(errors, err);
		return emptyReport();
	}
	try {
		candidate = enumerateCandidateFiles(opts.repoRoot, opts.beforeCandidateEnumeration);
	} catch (err) {
		if (!(err instanceof LegacyScanError)) throw err;
		reportLegacyError(errors, err);
		return emptyReport();
	}
	let files = candidate.files;
	files = [...files].sort();
	const candidatePaths = new Set(files);

	const allHits = [];
	let scannedFiles = 0;
	let protectedHits = 0;
	for (const rel of files) {
		if (canonicalCapture.paths.has(rel)) {
			const corpusRelativePath = rel.slice(CANONICAL_CORPUS_RELATIVE_ROOT.length + 1);
			const captured = canonicalCapture.report?.verifiedFiles?.get(corpusRelativePath)?.bytes;
			if (!Buffer.isBuffer(captured)) {
				errors.push({
					code: "LITCODEX_CANONICAL_CORPUS_UNSTABLE",
					message: "canonical corpus protected bytes are unavailable",
					details: { corpus: CANONICAL_CORPUS_RELATIVE_ROOT },
				});
				continue;
			}
			if (!isBinary(captured)) {
				scannedFiles += 1;
				protectedHits += scanText(rel, captured.toString("utf8"), tokens, modes).length;
			}
			continue;
		}
		const text = readCandidateText(candidate.context, rel, readFile, opts.beforeDeletionConfirmation, errors);
		if (text === null) continue;
		scannedFiles += 1;
		const hits = scanText(rel, text, tokens, modes);
		for (const h of hits) allHits.push(h);
	}
	if (canonicalCapture.report !== null) {
		try {
			assertCanonicalCorpusSnapshotStable(canonicalCapture.report, opts.canonicalFs);
		} catch (err) {
			if (!(err instanceof CanonicalCorpusError)) throw err;
			errors.push({
				code: "LITCODEX_CANONICAL_CORPUS_UNSTABLE",
				message: "canonical corpus changed after verified byte capture",
				details: { corpus: CANONICAL_CORPUS_RELATIVE_ROOT },
			});
		}
	}

	const { offenders, deadEntries, pendingEntries } = reconcile(allHits, allowlist, candidatePaths);

	offenders.sort((a, b) => {
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		if (a.line !== b.line) return a.line - b.line;
		if (a.token !== b.token) return a.token < b.token ? -1 : 1;
		return a.column - b.column;
	});
	const sortEntries = (arr) =>
		[...arr].sort((a, b) => {
			if (a.path !== b.path) return a.path < b.path ? -1 : 1;
			return a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
		});

	const ok = offenders.length === 0 && deadEntries.length === 0 && errors.length === 0;
	return {
		ok,
		scannedFiles,
		totalHits: allHits.length + protectedHits,
		allowlistedHits: allHits.length - offenders.length + protectedHits,
		offenders,
		deadEntries: sortEntries(deadEntries),
		pendingEntries: sortEntries(pendingEntries),
		errors,
	};
}

/**
 * Scan every tracked file for externally supplied terms. Report text offenders by id only. Unlike
 * the built-in legacy-token scan, this path has no canonical-corpus exemption.
 * @param {{repoRoot:string, termsPath:string, readFile?:(path:string)=>Buffer}} opts
 */
export function runExternalTermScan(opts) {
	const errors = [];
	const readFile = opts.readFile ?? readFileSync;
	const emptyReport = (extra = {}) => ({ ok: false, scannedFiles: 0, offenders: [], errors, ...extra });
	let terms;
	try {
		terms = loadExternalTerms(opts.termsPath);
	} catch (err) {
		if (!(err instanceof ExternalTermScanError)) throw err;
		errors.push({ code: err.code, message: err.message, details: err.details });
		return emptyReport();
	}
	let candidate;
	try {
		candidate = enumerateTrackedFiles(opts.repoRoot);
	} catch (err) {
		if (!(err instanceof LegacyScanError)) throw err;
		reportLegacyError(errors, err);
		return emptyReport();
	}
	let files = candidate.files;
	files = [...files].sort();
	const byValue = new Map(terms.map((term) => [term.value, term]));
	const values = terms.map((term) => term.value);
	const modes = Object.fromEntries(terms.map((term) => [term.value, term.matchMode]));
	const offenders = [];
	let scannedFiles = 0;
	for (const rel of files) {
		const text = readCandidateText(candidate.context, rel, readFile, undefined, errors);
		if (text === null) continue;
		scannedFiles += 1;
		for (const hit of scanText(rel, text, values, modes)) {
			const term = byValue.get(hit.token);
			if (term === undefined) continue;
			offenders.push({ path: hit.path, termId: term.id, line: hit.line, column: hit.column, mode: hit.mode });
		}
	}
	offenders.sort((a, b) => {
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		if (a.line !== b.line) return a.line - b.line;
		return a.termId < b.termId ? -1 : a.termId > b.termId ? 1 : a.column - b.column;
	});
	return { ok: offenders.length === 0 && errors.length === 0, scannedFiles, offenders, errors };
}

// --- CLI ---------------------------------------------------------------------------------------

const USAGE = `Usage: node tools/scan-legacy-tokens.mjs [flags]

Flags:
  --json                  Emit the ScanReport as a single JSON line to stdout.
  --repo-root <path>      Repo root to scan (default: git toplevel, else cwd).
  --allowlist <path>      Allowlist file (default: <repo-root>/tools/legacy-token-allowlist.json).
  --external-terms <path> Scan all tracked files, including the canonical corpus; report opaque ids.
  --quiet                 Suppress the success summary line (ignored with --json).
  --help, -h              Print this usage and exit 0.`;

function parseArgs(argv) {
	const flags = { json: false, quiet: false, repoRoot: null, allowlist: null, externalTerms: null, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") flags.json = true;
		else if (arg === "--quiet") flags.quiet = true;
		else if (arg === "--help" || arg === "-h") flags.help = true;
		else if (arg === "--repo-root" || arg === "--allowlist" || arg === "--external-terms") {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("--")) {
				return { error: `missing value for ${arg}` };
			}
			if (arg === "--repo-root") flags.repoRoot = value;
			else if (arg === "--allowlist") flags.allowlist = value;
			else flags.externalTerms = value;
			i += 1;
		} else {
			return { error: `unexpected argument: ${arg}` };
		}
	}
	return { flags };
}

function resolveRepoRoot(explicit) {
	if (explicit) return resolve(explicit);
	try {
		return discoverGitTopLevel(process.cwd(), gitEnvironment());
	} catch {
		// fall through
	}
	return process.cwd();
}

function main() {
	const { flags, error } = parseArgs(process.argv.slice(2));
	if (error) {
		process.stderr.write(`[scan-legacy-tokens] ${error}\n${USAGE}\n`);
		process.exit(2);
	}
	if (flags.help) {
		process.stdout.write(`${USAGE}\n`);
		process.exit(0);
	}

	const repoRoot = resolveRepoRoot(flags.repoRoot);
	const allowlistPath = flags.allowlist
		? resolve(flags.allowlist)
		: resolve(repoRoot, "tools/legacy-token-allowlist.json");

	const report = flags.externalTerms
		? runExternalTermScan({ repoRoot, termsPath: resolve(flags.externalTerms) })
		: runScan({ repoRoot, allowlistPath });

	if (flags.json) {
		process.stdout.write(`${JSON.stringify(report)}\n`);
		process.exit(report.ok ? 0 : 1);
	}

	for (const err of report.errors) {
		process.stderr.write(`[scan-legacy-tokens] ${err.code}: ${err.message}\n`);
	}
	for (const o of report.offenders) {
		if ("termId" in o) {
			process.stdout.write(`${o.path}:${o.line}:${o.column} [${o.termId}]\n`);
		} else {
			process.stdout.write(`${o.path}:${o.line}:${o.column} [${o.token}] ${o.context}\n`);
		}
	}
	for (const e of report.deadEntries ?? []) {
		process.stderr.write(`[scan-legacy-tokens] LITCODEX_SCAN_ALLOWLIST_DEAD_ENTRY: ${e.path} [${e.token}]\n`);
	}
	for (const e of report.pendingEntries ?? []) {
		process.stderr.write(
			`[scan-legacy-tokens] pending allowlist entry (carrier not yet tracked): ${e.path} [${e.token}]\n`,
		);
	}

	if (report.ok) {
		if (!flags.quiet) {
			process.stdout.write(
				flags.externalTerms
					? `external-term scan: OK (${report.scannedFiles} files)\n`
					: `legacy-token scan: OK (${report.scannedFiles} files, ${report.allowlistedHits} allowlisted)\n`,
			);
		}
		process.exit(0);
	}
	process.stdout.write(
		flags.externalTerms
			? `external-term scan: FAIL (${report.offenders.length} offenders, ${report.scannedFiles} files)\n`
			: `legacy-token scan: FAIL (${report.offenders.length} offenders, ${report.deadEntries.length} dead allowlist entries)\n`,
	);
	process.exit(1);
}

// Run the CLI only when invoked directly (not when imported by the test suite).
if (process.argv[1] && resolve(process.argv[1]) === SELF_PATH) {
	main();
}
