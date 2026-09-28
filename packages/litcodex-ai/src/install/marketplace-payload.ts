import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { InstallError } from "./errors.js";
import { readRegularFileBuffer, walkDirectory } from "./file-walk.js";
import { isSafeManagedMarketplaceRoot, managedMarketplaceRoot } from "./marketplace.js";

export interface MaterializeMarketplaceOptions {
	readonly sourceRoot: string;
	readonly targetRoot: string;
}

export interface MaterializeMarketplaceResult {
	readonly changed: boolean;
	readonly version: string;
	readonly warnings?: readonly string[];
}

const MARKETPLACE_MANIFEST = join(".agents", "plugins", "marketplace.json");
const PLUGIN_MANIFEST = join("plugins", "litcodex", ".codex-plugin", "plugin.json");
const LEGACY_VENDOR_PATHS = [
	{ legacy: "022_handoff", canonical: "handoff" },
	{ legacy: "045_scientific-visualization", canonical: "scientific-visualization" },
] as const;
const LEGACY_SKILL_RELATIVE = "plugins/litcodex/skills/lit-korean";
const LEGACY_SKILL_FILES = {
	"SKILL.md": "70abba94d0a8d5d1f18ccbb38ab8acbb60c3948d41f6bf34fc271747f18cd570",
	"references/prompt-injection-handling.md": "1088db6548b15d19078a3ee24f05e636392e5f441c26d298ba780096131d43f7",
	"references/quick-rules.md": "20adb2ba0326f78cb9af2ca3e2d5806144f8b6e4e3dfefaa83650217e6a53c9a",
	"references/safety-checklist.md": "d352bf175dc286f8f18e4e3817e6b101e70e318931661380a1052ae74758a722",
} as const;
const LEGACY_SKILL_WARNING =
	"LitCodex kept a modified lit-korean skill copy; review or remove it from the managed marketplace.";

/** Validate and atomically install the package-bundled marketplace into CODEX_HOME. */
export function materializeManagedMarketplace(opts: MaterializeMarketplaceOptions): MaterializeMarketplaceResult {
	const codexHome = dirname(dirname(opts.targetRoot));
	if (managedMarketplaceRoot(codexHome) !== opts.targetRoot || !isSafeManagedMarketplaceRoot(codexHome)) {
		throw payloadError("Unsafe marketplace path or unrecognized cache ownership.", opts.targetRoot);
	}
	reconcileLegacyVendorPaths(opts.sourceRoot, opts.targetRoot);
	const version = readVersion(opts.sourceRoot);
	if (!existsSync(join(opts.sourceRoot, MARKETPLACE_MANIFEST))) {
		throw payloadError("Bundled LitCodex marketplace manifest is missing.", opts.sourceRoot);
	}
	if (
		readVersionIfPresent(opts.targetRoot) === version &&
		existsSync(join(opts.targetRoot, MARKETPLACE_MANIFEST)) &&
		legacySkillState(opts.targetRoot) !== "unmodified" &&
		payloadTreesMatch(opts.sourceRoot, opts.targetRoot)
	) {
		return { changed: false, version };
	}

	const parent = dirname(opts.targetRoot);
	mkdirSync(parent, { recursive: true });
	const stage = mkdtempSync(join(parent, ".litcodex-stage-"));
	const backup = `${stage}-backup`;
	const preservedLegacy = `${stage}-legacy-skill`;
	let backedUp = false;
	let preserved = false;
	try {
		cpSync(opts.sourceRoot, stage, { recursive: true, force: true });
		readVersion(stage);
		if (legacySkillState(opts.targetRoot) === "modified") {
			renameSync(join(opts.targetRoot, LEGACY_SKILL_RELATIVE), preservedLegacy);
			preserved = true;
		}
		if (existsSync(opts.targetRoot)) {
			renameSync(opts.targetRoot, backup);
			backedUp = true;
		}
		renameSync(stage, opts.targetRoot);
		if (preserved) {
			const newLegacyPath = join(opts.targetRoot, LEGACY_SKILL_RELATIVE);
			mkdirSync(dirname(newLegacyPath), { recursive: true });
			renameSync(preservedLegacy, newLegacyPath);
		}
		if (backedUp) rmSync(backup, { recursive: true, force: true });
		return preserved ? { changed: true, version, warnings: [LEGACY_SKILL_WARNING] } : { changed: true, version };
	} catch (error) {
		rmSync(stage, { recursive: true, force: true });
		if (backedUp) {
			if (existsSync(opts.targetRoot)) rmSync(opts.targetRoot, { recursive: true, force: true });
			renameSync(backup, opts.targetRoot);
		}
		if (preserved && existsSync(preservedLegacy)) {
			const oldLegacyPath = join(opts.targetRoot, LEGACY_SKILL_RELATIVE);
			if (!existsSync(oldLegacyPath)) renameSync(preservedLegacy, oldLegacyPath);
		}
		throw payloadError("Failed to install the bundled LitCodex marketplace atomically.", opts.targetRoot, error);
	}
}

/** Move only byte/mode-exact, regular legacy vendor roots inside an owned marketplace. */
function reconcileLegacyVendorPaths(sourceRoot: string, targetRoot: string): void {
	const sourceVendorRoot = join(sourceRoot, "plugins", "litcodex", "vendor");
	const targetVendorRoot = join(targetRoot, "plugins", "litcodex", "vendor");
	const moves: Array<readonly [string, string]> = [];
	for (const { legacy, canonical } of LEGACY_VENDOR_PATHS) {
		const legacyPath = join(targetVendorRoot, legacy);
		const canonicalPath = join(targetVendorRoot, canonical);
		const legacyStat = lstatIfPresent(legacyPath);
		if (!legacyStat) continue;
		if (legacyStat.isSymbolicLink() || !legacyStat.isDirectory()) {
			throw payloadError("Unsafe legacy vendor path; refusing migration.", legacyPath);
		}
		if (lstatIfPresent(canonicalPath)) {
			throw payloadError("Legacy and canonical vendor paths coexist; refusing migration.", canonicalPath);
		}
		const expected = vendorTreeSignature(join(sourceVendorRoot, canonical));
		const actual = vendorTreeSignature(legacyPath);
		if (!sameSignature(expected, actual)) {
			throw payloadError("Legacy vendor path is modified, foreign, or incomplete; refusing migration.", legacyPath);
		}
		moves.push([legacyPath, canonicalPath]);
	}
	for (const [legacyPath, canonicalPath] of moves) renameSync(legacyPath, canonicalPath);
}

function lstatIfPresent(path: string): Stats | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function vendorTreeSignature(root: string): readonly string[] {
	const entries: string[] = [];
	const visit = (directory: string, relativePath: string): void => {
		const directoryStat = lstatSync(directory);
		if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
			throw new Error("legacy vendor path is not a real directory");
		}
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			const child = join(directory, entry.name);
			const childRelativePath = relativePath.length === 0 ? entry.name : `${relativePath}/${entry.name}`;
			const childStat = lstatSync(child);
			if (childStat.isSymbolicLink()) throw new Error("legacy vendor path contains a symbolic link");
			if (childStat.isDirectory()) {
				entries.push(`directory\0${childRelativePath}`);
				visit(child, childRelativePath);
			} else if (childStat.isFile()) {
				const digest = createHash("sha256").update(readRegularFileBuffer(child)).digest("hex");
				entries.push(`file\0${childRelativePath}\0${digest}\0${childStat.mode & 0o7777}`);
			} else {
				throw new Error("legacy vendor path contains an unsupported entry");
			}
		}
	};
	visit(root, "");
	return entries.sort();
}

function sameSignature(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function legacySkillState(marketplaceRoot: string): "absent" | "unmodified" | "modified" {
	const root = join(marketplaceRoot, LEGACY_SKILL_RELATIVE);
	const stat = lstatIfPresent(root);
	if (!stat) return "absent";
	if (stat.isSymbolicLink() || !stat.isDirectory()) return "modified";
	const expectedFiles = new Set(Object.keys(LEGACY_SKILL_FILES));
	const seenFiles = new Set<string>();
	const seenDirectories = new Set<string>();
	const visit = (directory: string, prefix: string): boolean => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
			const child = lstatSync(path);
			if (child.isSymbolicLink()) return false;
			if (child.isDirectory()) {
				seenDirectories.add(relativePath);
				if (!visit(path, relativePath)) return false;
			} else if (child.isFile()) {
				const expected = LEGACY_SKILL_FILES[relativePath as keyof typeof LEGACY_SKILL_FILES];
				if (!expected || createHash("sha256").update(readRegularFileBuffer(path)).digest("hex") !== expected)
					return false;
				seenFiles.add(relativePath);
			} else return false;
		}
		return true;
	};
	if (
		!visit(root, "") ||
		seenFiles.size !== expectedFiles.size ||
		seenDirectories.size !== 1 ||
		!seenDirectories.has("references")
	) {
		return "modified";
	}
	return "unmodified";
}

function readVersion(root: string): string {
	const path = join(root, PLUGIN_MANIFEST);
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
		if (typeof value.version === "string" && value.version.length > 0) return value.version;
	} catch (error) {
		throw payloadError("Bundled LitCodex plugin manifest is missing or malformed.", path, error);
	}
	throw payloadError("Bundled LitCodex plugin manifest has no version.", path);
}

function readVersionIfPresent(root: string): string | null {
	if (!existsSync(join(root, PLUGIN_MANIFEST))) return null;
	try {
		return readVersion(root);
	} catch {
		return null;
	}
}

function payloadTreesMatch(sourceRoot: string, targetRoot: string): boolean {
	try {
		const sourceEntries = treeSignature(sourceRoot);
		const targetEntries = treeSignature(targetRoot);
		return (
			sourceEntries !== null &&
			targetEntries !== null &&
			sourceEntries.length === targetEntries.length &&
			sourceEntries.every((entry, index) => entry === targetEntries[index])
		);
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function treeSignature(root: string): readonly string[] | null {
	const entries: string[] = [];
	for (const entry of walkDirectory(root)) {
		if (entry.relativePath === LEGACY_SKILL_RELATIVE || entry.relativePath.startsWith(`${LEGACY_SKILL_RELATIVE}/`))
			continue;
		if (entry.kind === "unexpected") return null;
		if (entry.kind === "directory") entries.push(`directory\0${entry.relativePath}`);
		else {
			const digest = createHash("sha256").update(readFileSync(entry.absolutePath)).digest("hex");
			entries.push(`file\0${entry.relativePath}\0${digest}`);
		}
	}
	return entries.sort();
}

function payloadError(message: string, path: string, cause?: unknown): InstallError {
	return new InstallError("LITCODEX_INSTALL_CONFIG_WRITE_FAILED", message, {
		path,
		...(cause === undefined ? {} : { cause: cause instanceof Error ? cause.message : String(cause) }),
	});
}
