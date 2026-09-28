// tools/release/check-version-lockstep.ts — M17 version-lockstep guard (pure library + CLI).
//
// Reads VERSION and every entry in VERSIONED_MANIFESTS, asserts byte-equality, and returns a
// machine-readable mismatch report. Backs `npm run check:version`. It reads manifests DIRECTLY
// (not via `git ls-files`) so it works in any checkout, and fails closed (exit 1) when a required
// manifest is missing rather than passing vacuously. It never publishes, never reads a network,
// and never reads a publish token.

import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isStableSemver, VERSION, VERSIONED_MANIFESTS, type VersionedManifest } from "./version.ts";

export type VersionMismatchCode =
	| "VERSION_MISMATCH" // found a version that != VERSION
	| "VERSION_UNPARSEABLE" // locator found a value that is not semver
	| "VERSION_MISSING" // required (non-optional) manifest present but locator matched nothing
	| "VERSION_NOT_STABLE"; // VERSION itself is not a stable semver

export interface VersionMismatch {
	readonly code: VersionMismatchCode;
	readonly path: string; // repo-root-relative
	readonly label: string;
	readonly expected: string; // always VERSION
	readonly found: string | null;
	/** Present only for lockfile-pointer VERSION_MISSING: the remediation hint. */
	readonly hint?: string;
}

export interface VersionLockstepReport {
	readonly ok: boolean;
	readonly version: string; // VERSION
	readonly checked: number; // count of manifests inspected (present, matching ones)
	readonly skipped: readonly string[]; // optional manifests that were absent
	readonly mismatches: readonly VersionMismatch[];
}

export class ReleaseMetadataError extends Error {
	readonly code: string; // SCREAMING_SNAKE
	readonly details: Readonly<Record<string, unknown>>;
	constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
		super(message);
		this.name = "ReleaseMetadataError";
		this.code = code;
		this.details = details;
	}
}

const LOCKFILE_HINT =
	"root package.json /version is unset or npm has not regenerated the lockfile; " +
	"set the root version to VERSION and run `npm install`";

/** Resolve a registry-relative path under repoRoot, rejecting any traversal that escapes it. */
function safeResolve(repoRoot: string, relPath: string): string {
	const root = resolve(repoRoot);
	const full = resolve(root, relPath);
	if (full !== root && !full.startsWith(root + sep)) {
		throw new ReleaseMetadataError("RELEASE_MANIFEST_PATH_ESCAPE", `manifest path escapes repo root: ${relPath}`, {
			path: relPath,
		});
	}
	return full;
}

/** Read a file; return null on ENOENT, throw RELEASE_MANIFEST_UNREADABLE on any other error. */
function readOrNull(absPath: string, relPath: string): string | null {
	try {
		return readFileSync(absPath, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new ReleaseMetadataError(
			"RELEASE_MANIFEST_UNREADABLE",
			`cannot read ${relPath}: ${(err as Error).message}`,
			{
				path: relPath,
			},
		);
	}
}

/** Resolve an RFC6901 JSON pointer over a parsed value; undefined if any segment is absent. */
function resolveJsonPointer(doc: unknown, pointer: string): unknown {
	if (pointer === "") return doc;
	if (!pointer.startsWith("/")) return undefined;
	const tokens = pointer
		.slice(1)
		.split("/")
		.map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
	let cur: unknown = doc;
	for (const tok of tokens) {
		if (cur === null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[tok];
		if (cur === undefined) return undefined;
	}
	return cur;
}

interface Extracted {
	readonly value: string | null;
	readonly missing: boolean; // locator matched nothing
}

/** Pull the version string out of one manifest's text per its locator kind. */
function extractVersion(entry: VersionedManifest, text: string, relPath: string): Extracted {
	if (entry.kind === "json-pointer") {
		let doc: unknown;
		try {
			doc = JSON.parse(text);
		} catch (err) {
			throw new ReleaseMetadataError(
				"RELEASE_MANIFEST_UNREADABLE",
				`invalid JSON in ${relPath}: ${(err as Error).message}`,
				{
					path: relPath,
				},
			);
		}
		const resolved = resolveJsonPointer(doc, entry.locator);
		if (resolved === undefined) return { value: null, missing: true };
		return { value: typeof resolved === "string" ? resolved : String(resolved), missing: false };
	}
	// regex
	const re = new RegExp(entry.locator, "m");
	const m = re.exec(text);
	if (m === null || m[1] === undefined) return { value: null, missing: true };
	return { value: m[1], missing: false };
}

/**
 * Pure: read VERSIONED_MANIFESTS, return a report. Never throws on a missing optional manifest;
 * throws ReleaseMetadataError only on an unreadable/invalid *required* file. Idempotent, no writes.
 */
export function checkVersionLockstep(repoRoot: string): VersionLockstepReport {
	if (!isStableSemver(VERSION)) {
		return Object.freeze({
			ok: false,
			version: VERSION,
			checked: 0,
			skipped: Object.freeze([]),
			mismatches: Object.freeze([
				Object.freeze({
					code: "VERSION_NOT_STABLE" as const,
					path: "tools/release/version.ts",
					label: "version source",
					expected: VERSION,
					found: VERSION,
				}),
			]),
		});
	}

	const skipped: string[] = [];
	const mismatches: VersionMismatch[] = [];
	let checked = 0;

	for (const entry of VERSIONED_MANIFESTS) {
		const abs = safeResolve(repoRoot, entry.path);
		const text = readOrNull(abs, entry.path);
		if (text === null) {
			if (entry.optional) {
				skipped.push(entry.path);
				continue;
			}
			mismatches.push(missingMismatch(entry));
			continue;
		}
		const { value, missing } = extractVersion(entry, text, entry.path);
		if (missing) {
			mismatches.push(missingMismatch(entry));
			continue;
		}
		const found = value as string;
		if (!isStableSemver(found)) {
			mismatches.push(
				Object.freeze({
					code: "VERSION_UNPARSEABLE" as const,
					path: entry.path,
					label: entry.label,
					expected: VERSION,
					found,
				}),
			);
			continue;
		}
		if (found !== VERSION) {
			mismatches.push(
				Object.freeze({
					code: "VERSION_MISMATCH" as const,
					path: entry.path,
					label: entry.label,
					expected: VERSION,
					found,
				}),
			);
			continue;
		}
		checked += 1;
	}

	return Object.freeze({
		ok: mismatches.length === 0,
		version: VERSION,
		checked,
		skipped: Object.freeze(skipped),
		mismatches: Object.freeze(mismatches),
	});
}

/** Build a VERSION_MISSING mismatch, attaching the lockfile remediation hint where relevant. */
function missingMismatch(entry: VersionedManifest): VersionMismatch {
	const base = {
		code: "VERSION_MISSING" as const,
		path: entry.path,
		label: entry.label,
		expected: VERSION,
		found: null,
	};
	if (entry.path === "package-lock.json") {
		return Object.freeze({ ...base, hint: LOCKFILE_HINT });
	}
	return Object.freeze(base);
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

function renderText(report: VersionLockstepReport): string {
	if (report.ok) {
		return `version-lockstep: OK (${report.checked} manifests aligned at ${report.version})\n`;
	}
	return `${report.mismatches
		.map((m) => `MISMATCH ${m.path} (${m.label}): expected ${m.expected}, found ${m.found ?? "absent"}`)
		.join("\n")}\n`;
}

function runCli(argv: readonly string[]): number {
	const json = argv.includes("--json");
	// Repo root is the current working directory (npm runs scripts from the repo root); this also
	// makes the CLI testable against a sandbox repo via `cwd`.
	const repoRoot = process.cwd();
	let report: VersionLockstepReport;
	try {
		report = checkVersionLockstep(repoRoot);
	} catch (err) {
		if (err instanceof ReleaseMetadataError) {
			process.stderr.write(`[release] ${err.code}: ${err.message}\n`);
			return 2;
		}
		throw err;
	}
	process.stdout.write(json ? `${JSON.stringify(report)}\n` : renderText(report));
	return report.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath !== "" && invokedPath === resolve(fileURLToPath(import.meta.url))) {
	const code = runCli(process.argv.slice(2));
	if (code !== 0) process.exitCode = code;
}

export { VERSION, VERSIONED_MANIFESTS } from "./version.ts";
// Keep the type import referenced for consumers that re-export it.
export type { VersionedManifest };
