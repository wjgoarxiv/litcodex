#!/usr/bin/env node
// tools/assert-pack-payload.mjs — M19 package-payload asserter (A3 D1-packaging, C2, C13).
//
// Parses `npm pack --dry-run --json` output and reconciles each validated package surface's tarball
// file list against tools/pack-payload-manifest.json. Pure string reconciliation only — it NEVER
// opens, stats, executes, or resolves any path it reads from the pack JSON.
//
// Two enforcement modes (wave-ordering, A3 Part E):
//   - "present" (DEFAULT, T08 gate): assert NO forbidden path leaks AND every present file matches
//     an allowedGlob (no UNEXPECTED leaks). Installer runtime and declared bins are required here;
//     only explicitly deferred requiredFuture content remains outside this mode.
//   - "final" (T28 gate, --require-future): additionally assert every requiredPaths AND requiredFuture
//     entry is present (LITCODEX_PACK_MISSING_REQUIRED). This is the hygiene gate the FINAL todo runs.
//
// requiredPaths are enforced in BOTH modes (they must always be present, including installer runtime
// and declared npm bins).
//
// Exit codes (S19 §Exit-codes):
//   0 = clean payload (no forbidden leaks, no unexpected paths, all enforced-required present).
//   1 = one or more payload issues (the single "build must fail" code).
//   2 = operator/environment fault (bad flag, unreadable/malformed manifest, bad pack JSON).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
	assertCanonicalCorpusSnapshotStable,
	CANONICAL_CORPUS_RELATIVE_ROOT,
	verifyCanonicalCorpus,
} from "../plugins/litcodex/skills/frontend-ui-ux/scripts/verify-canonical-corpus.mjs";
import { enrichPackResultsFromRepo } from "./enrich-pack-bin-paths.mjs";

/** Built-in no-trace path denylist segments that must never be stored raw in JSON fixtures. */
export const BUILTIN_FORBIDDEN_SEGMENTS = Object.freeze([[".o", "mo/"].join("")]);

// --- Error type --------------------------------------------------------------------------------

/** Thrown ONLY for operator/usage faults. Payload violations are returned as issues, not thrown. */
export class PackPayloadError extends Error {
	/**
	 * @param {string} code
	 * @param {string} message
	 * @param {Record<string, unknown>} [details]
	 */
	constructor(code, message, details = {}) {
		super(message);
		this.name = "PackPayloadError";
		this.code = code;
		this.details = details;
	}
}

// --- Path normalization (security: no FS touch, byte-exact match) ------------------------------

/**
 * Normalize a tarball-internal POSIX path for matching: backslash→slash, collapse leading "./"
 * and any "/./" segments. Does NOT resolve ".." against the filesystem (paths are never opened).
 * Preserves unicode / "#" / space bytes verbatim (no case folding).
 * @param {string} p
 * @returns {string}
 */
export function normalizePath(p) {
	let s = String(p).replace(/\\/g, "/");
	while (s.startsWith("./")) s = s.slice(2);
	s = s.replace(/\/\.\//g, "/");
	return s;
}

function isSafePackBinPath(path) {
	if (typeof path !== "string" || path.length === 0 || path.includes("\0")) return false;
	const normalized = normalizePath(path);
	return (
		normalized !== "." &&
		!normalized.startsWith("/") &&
		!normalized.split("/").includes("..") &&
		!/^[A-Za-z]:/.test(normalized)
	);
}

// --- Glob matcher (hand-rolled, segment-wise; no regex from user input → no ReDoS) -------------

/**
 * Match `path` against a glob supporting `**` (any depth, incl. zero segments), `*` (one segment,
 * any chars except `/`), and literal segments. Deterministic, linear. Used for allowedGlobs.
 * @param {string} path
 * @param {string} glob
 * @returns {boolean}
 */
export function pathMatchesGlob(path, glob) {
	const np = normalizePath(path);
	const ng = normalizePath(glob);
	return matchSegments(np.split("/"), ng.split("/"));
}

/**
 * @param {string[]} pathSegs
 * @param {string[]} globSegs
 * @returns {boolean}
 */
function matchSegments(pathSegs, globSegs) {
	let pi = 0;
	let gi = 0;
	while (gi < globSegs.length) {
		const g = globSegs[gi];
		if (g === "**") {
			// `**` matches zero or more path segments. Try every split, shortest first.
			if (gi === globSegs.length - 1) return true; // trailing ** swallows the rest
			for (let skip = 0; pi + skip <= pathSegs.length; skip++) {
				if (matchSegments(pathSegs.slice(pi + skip), globSegs.slice(gi + 1))) return true;
			}
			return false;
		}
		if (pi >= pathSegs.length) return false;
		if (!matchSegment(pathSegs[pi], g)) return false;
		pi++;
		gi++;
	}
	return pi === pathSegs.length;
}

/**
 * Match a single path segment against a single glob segment supporting `*` (any run of non-slash
 * chars). Literal otherwise; byte-exact (no case fold).
 * @param {string} seg
 * @param {string} glob
 * @returns {boolean}
 */
function matchSegment(seg, glob) {
	if (!glob.includes("*")) return seg === glob;
	// Split on `*`; every literal piece must appear in order, anchored at both ends.
	const parts = glob.split("*");
	let idx = 0;
	for (let k = 0; k < parts.length; k++) {
		const piece = parts[k];
		if (piece === "") continue;
		if (k === 0) {
			if (!seg.startsWith(piece)) return false;
			idx = piece.length;
		} else if (k === parts.length - 1) {
			if (!seg.slice(idx).endsWith(piece)) return false;
			idx = seg.length;
		} else {
			const found = seg.indexOf(piece, idx);
			if (found === -1) return false;
			idx = found + piece.length;
		}
	}
	return true;
}

// --- Parsing -----------------------------------------------------------------------------------

/**
 * Parse raw `npm pack --dry-run --json` text into PackResult[].
 * @param {string} raw
 * @returns {Array<{name:string,version:string,filename:string,files:Array<{path:string,size:number,mode:number}>,entryCount:number,bundled:string[]}>}
 */
export function parsePackJson(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new PackPayloadError(
			"LITCODEX_PACK_JSON_INVALID",
			`pack JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!Array.isArray(parsed)) {
		throw new PackPayloadError(
			"LITCODEX_PACK_SHAPE_INVALID",
			"pack JSON must be a top-level array of pack results (pass --json to npm pack)",
		);
	}
	for (const el of parsed) {
		if (
			el === null ||
			typeof el !== "object" ||
			typeof el.name !== "string" ||
			!Array.isArray(el.files) ||
			typeof el.entryCount !== "number" ||
			!Array.isArray(el.bundled)
		) {
			throw new PackPayloadError(
				"LITCODEX_PACK_SHAPE_INVALID",
				"each pack result must have {name:string, files:array, entryCount:number, bundled:array}",
			);
		}
		for (const f of el.files) {
			if (f === null || typeof f !== "object" || typeof f.path !== "string") {
				throw new PackPayloadError("LITCODEX_PACK_SHAPE_INVALID", "each file entry must have a string `path`");
			}
		}
	}
	return parsed;
}

/**
 * Load + validate the payload manifest.
 * @param {string} manifestPath
 * @returns {object}
 */
export function loadPayloadManifest(manifestPath) {
	let raw;
	try {
		raw = readFileSync(manifestPath, "utf8");
	} catch (err) {
		throw new PackPayloadError(
			"LITCODEX_PACK_MANIFEST_INVALID",
			`cannot read manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	let m;
	try {
		m = JSON.parse(raw);
	} catch (err) {
		throw new PackPayloadError(
			"LITCODEX_PACK_MANIFEST_INVALID",
			`manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (m === null || typeof m !== "object" || m.version !== 1) {
		throw new PackPayloadError("LITCODEX_PACK_MANIFEST_INVALID", "manifest.version must be the literal 1");
	}
	if (!Array.isArray(m.forbiddenSegments) || m.forbiddenSegments.length === 0) {
		throw new PackPayloadError(
			"LITCODEX_PACK_MANIFEST_INVALID",
			"manifest.forbiddenSegments must be a non-empty string array",
		);
	}
	if (!Array.isArray(m.packages) || m.packages.length === 0) {
		throw new PackPayloadError(
			"LITCODEX_PACK_MANIFEST_INVALID",
			"manifest.packages must be a non-empty array of rules",
		);
	}
	for (const rule of m.packages) {
		if (
			rule === null ||
			typeof rule !== "object" ||
			typeof rule.name !== "string" ||
			!Array.isArray(rule.requiredPaths) ||
			!Array.isArray(rule.allowedGlobs) ||
			rule.allowedGlobs.length === 0
		) {
			throw new PackPayloadError(
				"LITCODEX_PACK_MANIFEST_INVALID",
				`manifest rule for ${rule?.name} must have requiredPaths[] and non-empty allowedGlobs[]`,
			);
		}
		if (!Array.isArray(rule.exactFileSets ?? [])) {
			throw new PackPayloadError(
				"LITCODEX_PACK_MANIFEST_INVALID",
				`manifest rule for ${rule.name} must have exactFileSets[] when present`,
			);
		}
		if (rule.forbidHiddenPaths !== undefined && typeof rule.forbidHiddenPaths !== "boolean") {
			throw new PackPayloadError(
				"LITCODEX_PACK_MANIFEST_INVALID",
				`manifest rule for ${rule.name} must use a boolean forbidHiddenPaths`,
			);
		}
		if (!Array.isArray(rule.allowedHiddenPaths ?? [])) {
			throw new PackPayloadError(
				"LITCODEX_PACK_MANIFEST_INVALID",
				`manifest rule for ${rule.name} must have allowedHiddenPaths[] when present`,
			);
		}
		if (
			(rule.allowedHiddenPaths ?? []).some(
				(path) =>
					typeof path !== "string" ||
					path.length === 0 ||
					path.startsWith("/") ||
					path.includes("..") ||
					path.includes("\\") ||
					path.includes("\0"),
			)
		) {
			throw new PackPayloadError(
				"LITCODEX_PACK_MANIFEST_INVALID",
				`manifest rule for ${rule.name} has an unsafe allowedHiddenPaths[] entry`,
			);
		}
		if (!Array.isArray(rule.verifiedCorpusCopies ?? [])) {
			throw new PackPayloadError(
				"LITCODEX_PACK_MANIFEST_INVALID",
				`manifest rule for ${rule.name} must have verifiedCorpusCopies[] when present`,
			);
		}
		for (const copy of rule.verifiedCorpusCopies ?? []) {
			if (
				copy === null ||
				typeof copy !== "object" ||
				copy.sourceRoot !== CANONICAL_CORPUS_RELATIVE_ROOT ||
				!isSafeRelativeDirectory(copy.destinationPrefix)
			) {
				throw new PackPayloadError(
					"LITCODEX_PACK_MANIFEST_INVALID",
					`manifest verified corpus copy for ${rule.name} must use a safe destination and the pinned source root`,
				);
			}
		}
		for (const fileSet of rule.exactFileSets ?? []) {
			if (
				fileSet === null ||
				typeof fileSet !== "object" ||
				typeof fileSet.prefix !== "string" ||
				!fileSet.prefix.endsWith("/") ||
				!Array.isArray(fileSet.allowedPaths) ||
				fileSet.allowedPaths.length === 0 ||
				fileSet.allowedPaths.some((path) => typeof path !== "string" || path.startsWith("/") || path.includes(".."))
			) {
				throw new PackPayloadError(
					"LITCODEX_PACK_MANIFEST_INVALID",
					`manifest exactFileSets entry for ${rule.name} must have a slash-terminated prefix and safe allowedPaths[]`,
				);
			}
		}
	}
	const manifest = {
		...m,
		forbiddenSegments: uniqueStrings([...m.forbiddenSegments, ...BUILTIN_FORBIDDEN_SEGMENTS]),
		gitForbiddenSegments: Array.isArray(m.gitForbiddenSegments)
			? uniqueStrings([...m.gitForbiddenSegments, ...BUILTIN_FORBIDDEN_SEGMENTS])
			: m.gitForbiddenSegments,
	};
	expandVerifiedCorpusCopies(manifest, resolve(dirname(resolve(manifestPath)), ".."));
	return manifest;
}

function isSafeRelativeDirectory(value) {
	return (
		typeof value === "string" &&
		value.endsWith("/") &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!value.includes("\0") &&
		!value.split("/").includes("..")
	);
}

function expandVerifiedCorpusCopies(manifest, repoRoot) {
	for (const rule of manifest.packages) {
		for (const copy of rule.verifiedCorpusCopies ?? []) {
			const matchingSets = (rule.exactFileSets ?? []).filter(
				(fileSet) =>
					copy.destinationPrefix.startsWith(fileSet.prefix) &&
					copy.destinationPrefix.length > fileSet.prefix.length,
			);
			if (matchingSets.length !== 1) {
				throw new PackPayloadError(
					"LITCODEX_PACK_MANIFEST_INVALID",
					`manifest verified corpus copy for ${rule.name} must belong to one exact file set`,
				);
			}

			let paths;
			try {
				const report = verifyCanonicalCorpus(resolve(repoRoot, copy.sourceRoot));
				paths = [...report.verifiedFiles.keys()].sort();
				assertCanonicalCorpusSnapshotStable(report);
			} catch (error) {
				throw new PackPayloadError(
					"LITCODEX_PACK_CANONICAL_CORPUS_INVALID",
					"verified package corpus failed its integrity check",
					{ causeCode: typeof error?.code === "string" ? error.code : "UNKNOWN" },
				);
			}
			if (paths.length === 0 || paths.some((path) => !isSafeRelativeFile(path))) {
				throw new PackPayloadError(
					"LITCODEX_PACK_CANONICAL_CORPUS_INVALID",
					"verified package corpus returned an empty or unsafe path set",
				);
			}

			const destinationPaths = paths.map((path) => `${copy.destinationPrefix}${path}`);
			rule.requiredPaths = uniqueStrings([...rule.requiredPaths, ...destinationPaths]);
			const fileSet = matchingSets[0];
			const relativePrefix = copy.destinationPrefix.slice(fileSet.prefix.length);
			fileSet.allowedPaths = uniqueStrings([
				...fileSet.allowedPaths,
				...paths.map((path) => `${relativePrefix}${path}`),
			]);
		}
	}
}

function isSafeRelativeFile(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!value.includes("\0") &&
		!value.split("/").includes("..")
	);
}

function uniqueStrings(values) {
	return [...new Set(values)];
}

// --- Forbidden-segment evaluation --------------------------------------------------------------

/**
 * Return the first forbidden segment a normalized path hits, or null. Checks flat forbiddenSegments
 * (no exemption) then anchored forbiddenSegmentRules (exempt under a prefix). Forbidden wins over
 * allowed (S19 §6.3 / addendum G1).
 * @param {string} normalized
 * @param {readonly string[]} forbiddenSegments
 * @param {ReadonlyArray<{segment:string,exemptUnderPrefixes?:string[],exemptPaths?:string[]}>} forbiddenSegmentRules
 * @returns {string|null}
 */
export function firstForbiddenSegment(normalized, forbiddenSegments, forbiddenSegmentRules = []) {
	for (const seg of forbiddenSegments) {
		if (normalized.includes(seg)) return seg;
	}
	for (const rule of forbiddenSegmentRules) {
		if (
			normalized.includes(rule.segment) &&
			!(rule.exemptPaths ?? []).includes(normalized) &&
			!(rule.exemptUnderPrefixes ?? []).some((p) => normalized.startsWith(p))
		) {
			return rule.segment;
		}
	}
	return null;
}

// --- Per-package reconciliation (pure) ---------------------------------------------------------

/**
 * Reconcile one PackResult against its rule + repo-wide forbidden segments. Returns every issue;
 * never throws on violations. Order: bundled → entryCount → forbidden → unexpected → missing.
 * @param {object} result
 * @param {object} rule
 * @param {readonly string[]} forbiddenSegments
 * @param {ReadonlyArray<{segment:string,exemptUnderPrefixes?:string[],exemptPaths?:string[]}>} [forbiddenSegmentRules]
 * @param {{requireFuture?:boolean}} [opts]
 * @returns {Array<{code:string,package:string|null,path:string|null,message:string}>}
 */
export function assertPackage(result, rule, forbiddenSegments, forbiddenSegmentRules = [], opts = {}) {
	const issues = [];
	const pkg = result.name;

	// bundled[] must be a subset of the rule's allowedBundled (default: none). litcodex-ai bundles
	// `@litcodex/lit-loop` so a single `npm install -g` ships the loop/hook runtime (A3 D1 / G8); any
	// OTHER bundled dep is still a leak.
	const allowedBundled = new Set(rule.allowedBundled ?? []);
	const strayBundled = (Array.isArray(result.bundled) ? result.bundled : []).filter((b) => !allowedBundled.has(b));
	if (strayBundled.length !== 0) {
		issues.push({
			code: "LITCODEX_PACK_BUNDLED_DEP",
			package: pkg,
			path: null,
			message: `bundled[] may only contain [${[...allowedBundled].join(", ") || "(none)"}], got stray [${strayBundled.join(", ")}]`,
		});
	}

	if (typeof result.entryCount === "number" && result.entryCount !== result.files.length) {
		issues.push({
			code: "LITCODEX_PACK_ENTRYCOUNT_MISMATCH",
			package: pkg,
			path: null,
			message: `entryCount ${result.entryCount} !== files.length ${result.files.length}`,
		});
	}

	const forbiddenPaths = new Set();
	for (const file of result.files) {
		const normalized = normalizePath(file.path);
		const hit = firstForbiddenSegment(normalized, forbiddenSegments, forbiddenSegmentRules);
		if (hit !== null) {
			forbiddenPaths.add(file.path);
			issues.push({
				code: "LITCODEX_PACK_FORBIDDEN_PATH",
				package: pkg,
				path: file.path,
				message: `shipped path matches forbidden segment "${hit}"`,
			});
		}
	}

	if (rule.forbidHiddenPaths === true) {
		const allowedHiddenPaths = new Set((rule.allowedHiddenPaths ?? []).map(normalizePath));
		for (const file of result.files) {
			const normalized = normalizePath(file.path);
			const hasHiddenSegment = normalized
				.split("/")
				.some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");
			if (hasHiddenSegment && !allowedHiddenPaths.has(normalized)) {
				issues.push({
					code: "LITCODEX_PACK_HIDDEN_STATE_PATH",
					package: pkg,
					path: file.path,
					message: "shipped path contains an unapproved hidden segment",
				});
			}
		}
	}

	for (const file of result.files) {
		if (forbiddenPaths.has(file.path)) continue; // forbidden already reported; do not double-flag
		const allowed = rule.allowedGlobs.some((g) => pathMatchesGlob(file.path, g));
		if (!allowed) {
			issues.push({
				code: "LITCODEX_PACK_UNEXPECTED_PATH",
				package: pkg,
				path: file.path,
				message: "shipped path matches no allowedGlob",
			});
		}
	}

	const present = new Set(result.files.map((f) => normalizePath(f.path)));
	for (const fileSet of rule.exactFileSets ?? []) {
		const prefix = normalizePath(fileSet.prefix);
		const allowedPaths = new Set(fileSet.allowedPaths.map((path) => `${prefix}${normalizePath(path)}`));
		for (const file of result.files) {
			const normalized = normalizePath(file.path);
			if (normalized.startsWith(prefix) && !allowedPaths.has(normalized)) {
				issues.push({
					code: "LITCODEX_PACK_EXACT_SET_EXTRA",
					package: pkg,
					path: file.path,
					message: `shipped path is outside the exact file set rooted at ${prefix}`,
				});
			}
		}
	}

	// requiredPaths are enforced in every mode.
	for (const req of rule.requiredPaths) {
		if (!present.has(normalizePath(req))) {
			issues.push({
				code: "LITCODEX_PACK_MISSING_REQUIRED",
				package: pkg,
				path: req,
				message: "required path absent from tarball",
			});
		}
	}
	// requiredFuture are enforced only in the final (T28) hygiene gate.
	if (opts.requireFuture) {
		for (const req of rule.requiredFuture ?? []) {
			if (!present.has(normalizePath(req))) {
				issues.push({
					code: "LITCODEX_PACK_MISSING_REQUIRED",
					package: pkg,
					path: req,
					message: "required-future path absent from tarball (final hygiene gate)",
				});
			}
		}
	}

	// npm's pack JSON lists archive files with permission-only modes (for example 493/0755). Some
	// producers include the Unix file-type bits too; when present, require S_IFREG. Either way every
	// package.json bin target must carry explicit executable metadata in the final archive listing.
	if (!Array.isArray(result.binPaths) || result.binPaths.some((path) => !isSafePackBinPath(path))) {
		issues.push({
			code: "LITCODEX_PACK_BIN_DECLARATIONS_INVALID",
			package: pkg,
			path: null,
			message: "package-derived npm bin paths are missing or malformed",
		});
		return issues;
	}
	for (const executablePath of new Set(result.binPaths.map(normalizePath))) {
		const file = result.files.find((candidate) => normalizePath(candidate.path) === normalizePath(executablePath));
		if (!file) {
			issues.push({
				code: "LITCODEX_PACK_BIN_MISSING",
				package: pkg,
				path: executablePath,
				message: "declared npm bin is absent from pack metadata",
			});
			continue;
		}
		if (!Number.isInteger(file.mode) || file.mode < 0) {
			issues.push({
				code: "LITCODEX_PACK_BIN_METADATA_INVALID",
				package: pkg,
				path: executablePath,
				message: "declared npm bin has no valid numeric mode in pack metadata",
			});
			continue;
		}
		const explicitType = typeof file.type === "string" ? file.type.toLowerCase() : file.type;
		if (explicitType !== undefined && explicitType !== "file" && explicitType !== "regularfile") {
			issues.push({
				code: "LITCODEX_PACK_BIN_NOT_REGULAR",
				package: pkg,
				path: executablePath,
				message: "declared npm bin has explicit non-file pack metadata",
			});
			continue;
		}
		const fileType = file.mode & 0o170000;
		if (fileType !== 0 && fileType !== 0o100000) {
			issues.push({
				code: "LITCODEX_PACK_BIN_NOT_REGULAR",
				package: pkg,
				path: executablePath,
				message: "declared npm bin is not a regular file in pack metadata",
			});
			continue;
		}
		if ((file.mode & 0o111) === 0) {
			issues.push({
				code: "LITCODEX_PACK_BIN_NOT_EXECUTABLE",
				package: pkg,
				path: executablePath,
				message: `declared npm bin mode ${file.mode.toString(8)} has no executable bit`,
			});
		}
	}

	return issues;
}

/**
 * Pure top-level reconciliation across all packages. Never throws on violations.
 * @param {object[]} results
 * @param {object} manifest
 * @param {{requireFuture?:boolean}} [opts]
 * @returns {{ok:boolean, issues:Array<object>, checkedPackages:string[], filesChecked:number}}
 */
export function assertPayload(results, manifest, opts = {}) {
	const ruleByName = new Map(manifest.packages.map((r) => [r.name, r]));
	const usedRules = new Set();
	const issues = [];
	const checkedPackages = [];
	let filesChecked = 0;

	for (const result of results) {
		filesChecked += result.files.length;
		const rule = ruleByName.get(result.name);
		if (!rule) {
			issues.push({
				code: "LITCODEX_PACK_UNKNOWN_PACKAGE",
				package: result.name,
				path: null,
				message: "package has no rule in the manifest (should it be packed?)",
			});
			continue;
		}
		usedRules.add(result.name);
		checkedPackages.push(result.name);
		issues.push(
			...assertPackage(result, rule, manifest.forbiddenSegments, manifest.forbiddenSegmentRules ?? [], opts),
		);
	}

	for (const rule of manifest.packages) {
		if (!usedRules.has(rule.name)) {
			issues.push({
				code: "LITCODEX_PACK_NO_RULE_USED",
				package: rule.name,
				path: null,
				message: "manifest rule matched no package in the pack input (workspace dropped out?)",
			});
		}
	}

	return { ok: issues.length === 0, issues, checkedPackages, filesChecked };
}

// --- CLI ---------------------------------------------------------------------------------------

const USAGE = `Usage: node tools/assert-pack-payload.mjs [<pack-json-file>] [flags]

Reconciles \`npm pack --dry-run --json\` output against tools/pack-payload-manifest.json.

Flags:
  --manifest <path>     Allowlist manifest (default <repo-root>/tools/pack-payload-manifest.json).
  --repo-root <path>    Repo root for default manifest resolution (default process.cwd()).
  --require-future      Final hygiene gate (T28): also assert requiredFuture paths are present.
  --json                Emit a machine-readable PayloadReport to stdout.
  --help, -h            Print this usage and exit 0.

Reads the pack JSON from the positional file arg, or from stdin when omitted.
Exit 0 = clean, 1 = payload issue(s), 2 = operator/parse/manifest fault.`;

/** @param {string[]} argv */
function parseArgs(argv) {
	const opts = {
		file: null,
		manifest: null,
		repoRoot: process.cwd(),
		json: false,
		requireFuture: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") opts.help = true;
		else if (a === "--json") opts.json = true;
		else if (a === "--require-future") opts.requireFuture = true;
		else if (a === "--manifest") opts.manifest = argv[++i];
		else if (a === "--repo-root") opts.repoRoot = argv[++i];
		else if (a.startsWith("--")) {
			throw new PackPayloadError("USAGE", `unknown flag: ${a}`);
		} else if (opts.file === null) opts.file = a;
		else throw new PackPayloadError("USAGE", `unexpected positional: ${a}`);
	}
	return opts;
}

/** Read all of stdin synchronously to a UTF-8 string. */
function readStdin() {
	try {
		return readFileSync(0, "utf8");
	} catch {
		return "";
	}
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`[assert-pack-payload] ${err.message}\n${USAGE}\n`);
		process.exit(2);
	}
	if (opts.help) {
		process.stdout.write(`${USAGE}\n`);
		process.exit(0);
	}

	const manifestPath = opts.manifest ?? resolve(opts.repoRoot, "tools", "pack-payload-manifest.json");

	let raw;
	if (opts.file) {
		try {
			raw = readFileSync(opts.file, "utf8");
		} catch (err) {
			process.stderr.write(`[assert-pack-payload] cannot read ${opts.file}: ${err.message}\n`);
			process.exit(2);
		}
	} else {
		raw = readStdin();
	}

	let results;
	let manifest;
	try {
		results = enrichPackResultsFromRepo(parsePackJson(raw), opts.repoRoot);
		manifest = loadPayloadManifest(manifestPath);
	} catch (err) {
		process.stderr.write(`[assert-pack-payload] ${err.message}\n`);
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

// Run as CLI only when invoked directly (not when imported by tests / pack-all.mjs).
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
	main();
}
