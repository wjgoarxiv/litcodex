// Save the files a user added or changed inside LitCodex skill folders before an upgrade replaces them.
//
// Two copies of the previous payload hold skill folders: the managed marketplace this installer writes, and the
// Codex plugin cache that `codex plugin add` rebuilds from it. Both are replaced on an upgrade. A file there is
// LitCodex's own when its digest is in the frozen pre-1.0.39 list, in the record the previous install wrote, or in
// the new payload. Any other regular file is the user's: it is copied to
// <CODEX_HOME>/litcodex-backups/<date>/<copy>/<skill>/... before anything is removed. The plugin cache is only
// read; Codex itself deletes it during plugin add.

import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { walkDirectory } from "./file-walk.js";
import { LITCODEX_MARKETPLACE, LITCODEX_PLUGIN } from "./marketplace.js";
import { LEGACY_SHIPPED_SKILL_DIGESTS } from "./shipped-skill-digests.js";

const RECORD_SCHEMA_VERSION = 1;
const IGNORED_NAMES = new Set([".DS_Store"]);

export function skillFileDigest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export function installedSkillRecordPath(codexHome: string): string {
	return join(codexHome, "litcodex", "installed-skill-digests.json");
}

/** Codex keeps one folder per installed version here: <cache>/<version>/skills/<id>/... */
export function pluginCacheRoot(codexHome: string): string {
	return join(codexHome, "plugins", "cache", LITCODEX_MARKETPLACE, LITCODEX_PLUGIN);
}

/** Every digest LitCodex can vouch for: the frozen list, the previous install's record and the new payload. */
export function ownedSkillDigests(
	codexHome: string,
	newSkillsRoot: string,
	legacy: readonly string[] = LEGACY_SHIPPED_SKILL_DIGESTS,
): Set<string> {
	const owned = new Set(legacy);
	for (const digest of readRecord(codexHome)) owned.add(digest);
	for (const file of regularFiles(newSkillsRoot)) owned.add(skillFileDigest(readFileSync(file.absolutePath)));
	return owned;
}

/** Remember what this install put in the skill folders, so the next upgrade can tell user files apart. */
export function writeInstalledSkillRecord(codexHome: string, version: string, skillsRoot: string): void {
	const digests = [
		...new Set(regularFiles(skillsRoot).map((file) => skillFileDigest(readFileSync(file.absolutePath)))),
	];
	const path = installedSkillRecordPath(codexHome);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(
		temporary,
		`${JSON.stringify({ schemaVersion: RECORD_SCHEMA_VERSION, version, digests: digests.sort() })}\n`,
	);
	renameSync(temporary, path);
}

export interface SkillBackup {
	/** Copy every file under `skillsRoot` that LitCodex does not own into `<backup>/<label>/`. */
	save(skillsRoot: string, label: string, skip?: (relativePath: string) => boolean): void;
	/** The dated folder, or null when nothing needed saving. */
	readonly dir: string | null;
	readonly files: number;
}

/** The backup folder is created on the first saved file, so an upgrade with no user files leaves no trace. */
export function createSkillBackup(codexHome: string, owned: ReadonlySet<string>, now: number): SkillBackup {
	let dir: string | null = null;
	let files = 0;
	const allocate = (): string => {
		if (dir !== null) return dir;
		const base = join(codexHome, "litcodex-backups", new Date(now).toISOString().slice(0, 10));
		let candidate = base;
		for (let index = 2; existsSync(candidate); index += 1) candidate = `${base}-${index}`;
		mkdirSync(candidate, { recursive: true });
		dir = candidate;
		return candidate;
	};
	return {
		save(skillsRoot, label, skip) {
			for (const file of regularFiles(skillsRoot)) {
				if (skip?.(file.relativePath) === true) continue;
				if (owned.has(skillFileDigest(readFileSync(file.absolutePath)))) continue;
				const destination = join(allocate(), label, file.relativePath);
				mkdirSync(dirname(destination), { recursive: true });
				copyFileSync(file.absolutePath, destination);
				files += 1;
			}
		},
		get dir() {
			return dir;
		},
		get files() {
			return files;
		},
	};
}

/** Version folders in the Codex plugin cache; a symlink or stray file is never followed. */
export function cachedPluginVersions(codexHome: string): readonly string[] {
	const root = pluginCacheRoot(codexHome);
	if (!isRealDirectory(root)) return [];
	return readdirSync(root).filter((name) => isRealDirectory(join(root, name)));
}

function readRecord(codexHome: string): readonly string[] {
	try {
		const parsed = JSON.parse(readFileSync(installedSkillRecordPath(codexHome), "utf8")) as {
			schemaVersion?: unknown;
			digests?: unknown;
		};
		if (parsed.schemaVersion !== RECORD_SCHEMA_VERSION || !Array.isArray(parsed.digests)) return [];
		return parsed.digests.filter((digest): digest is string => typeof digest === "string");
	} catch {
		return [];
	}
}

function regularFiles(root: string): readonly { absolutePath: string; relativePath: string }[] {
	if (!isRealDirectory(root)) return [];
	return walkDirectory(root).filter(
		(entry) => entry.kind === "file" && !IGNORED_NAMES.has(entry.relativePath.split("/").at(-1) ?? ""),
	);
}

function isRealDirectory(path: string): boolean {
	try {
		const stat = lstatSync(path);
		return !stat.isSymbolicLink() && stat.isDirectory();
	} catch {
		return false;
	}
}
