// The LitFamily section on disk: the global `$CODEX_HOME/AGENTS.md` Codex reads on
// every session start. Writes go through a staging file and rename, keep the file's
// mode, and refuse a symlinked, non-regular or non-UTF-8 file rather than rewriting it.
// A filesystem failure comes back as `refused-io` instead of throwing. The user's
// original file is copied once, the first time a section goes in.

import { randomUUID } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import {
	AgentBlockError,
	inspectInstructionBlock,
	removeInstructionBlock,
	upsertInstructionBlock,
} from "./managed-block.js";

/** What `applyInstructionFile` can report about one install/uninstall attempt. */
export type InstructionFileStatus =
	| "created"
	| "updated"
	| "unchanged"
	| "removed"
	| "absent"
	| "dry-run"
	| "refused-symlink"
	| "refused-not-file"
	| "refused-not-utf8"
	| "refused-malformed"
	| "refused-io";

/** Outcome of one install/uninstall attempt against `path`. */
export interface InstructionFileResult {
	readonly status: InstructionFileStatus;
	readonly path: string;
	readonly backup?: string;
	readonly preview?: string;
	readonly error?: string;
}

// "missing", "file", "symlink" or "other", without following a link.
const entryKind = (path: string): "missing" | "file" | "symlink" | "other" => {
	try {
		const stats = lstatSync(path);
		return stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : "other";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
};

// The file's text, or null when it is not UTF-8: a UTF-16 file from Notepad or a
// Latin-1 file would be corrupted if rewritten outside the markers.
const readUtf8 = (path: string): string | null => {
	const bytes = readFileSync(path);
	if (bytes.includes(0) || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
		return null;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return null;
	}
};

// A unique staging name, so a leftover from a crashed run never blocks the next one.
const writeAtomic = (path: string, text: string, createParent: boolean): void => {
	if (createParent) mkdirSync(dirname(path), { recursive: true });
	const staging = `${path}.litfamily-${randomUUID()}.tmp`;
	let mode: number | null = null;
	try {
		mode = statSync(path).mode & 0o7777;
	} catch {
		// A new file takes the default mode.
	}
	try {
		writeFileSync(staging, text, { flag: "wx" });
		if (mode !== null) chmodSync(staging, mode);
		renameSync(staging, path);
	} finally {
		try {
			unlinkSync(staging);
		} catch {
			// Renamed into place, or never written.
		}
	}
};

/**
 * Installs or removes the section in `path`. `backup: false` skips the first-insert
 * copy (a repo's `AGENTS.md`, where a copy would sit beside tracked files);
 * `createParent: false` never makes the folder.
 */
export const applyInstructionFile = (options: {
	path: string;
	id: string;
	version: string;
	body: string;
	action: "install" | "uninstall";
	dryRun?: boolean;
	now?: Date;
	backup?: boolean;
	createParent?: boolean;
}): InstructionFileResult => {
	const { path, id, version, body, action } = options;
	const dryRun = options.dryRun ?? false;
	const now = options.now ?? new Date();
	const backup = options.backup ?? true;
	const createParent = options.createParent ?? true;
	try {
		const kind = entryKind(path);
		if (kind === "symlink") return { status: "refused-symlink", path };
		if (kind === "other") return { status: "refused-not-file", path };
		const text = kind === "file" ? readUtf8(path) : "";
		if (text === null) return { status: "refused-not-utf8", path };
		let next: { text: string; changed: boolean; created: boolean };
		try {
			next =
				action === "uninstall"
					? removeInstructionBlock(text, id)
					: {
							...upsertInstructionBlock(text, { id, version, body }, { created: kind === "missing" }),
							created: kind === "missing",
						};
		} catch (error) {
			if (error instanceof AgentBlockError) return { status: "refused-malformed", path };
			throw error;
		}
		if (!next.changed) return { status: action === "uninstall" ? "absent" : "unchanged", path };
		if (dryRun) return { status: "dry-run", path, preview: next.text };
		if (action === "uninstall") {
			if (next.text === "" && next.created) unlinkSync(path);
			else writeAtomic(path, next.text, false);
			return { status: "removed", path };
		}
		let copy: string | undefined;
		if (backup && kind === "file" && inspectInstructionBlock(text, id).state === "absent") {
			copy = `${path}.litfamily-backup-${now.toISOString().replace(/[:.]/gu, "-")}`;
			copyFileSync(path, copy);
		}
		writeAtomic(path, next.text, createParent);
		return { status: kind === "file" ? "updated" : "created", path, ...(copy ? { backup: copy } : {}) };
	} catch (error) {
		return { status: "refused-io", path, error: (error as NodeJS.ErrnoException)?.code ?? String(error) };
	}
};

/**
 * `present v=<x>` (current), `stale v=<x>` (an older install's section), `absent`,
 * `malformed`, or `symlink` / `not-file` / `not-utf8` for a file LitCodex will not write.
 */
export const instructionFileState = (options: { path: string; id: string; version: string }): string => {
	const { path, id, version } = options;
	const kind = entryKind(path);
	if (kind === "missing") return "absent";
	if (kind === "symlink") return "symlink";
	if (kind === "other") return "not-file";
	const text = readUtf8(path);
	if (text === null) return "not-utf8";
	const found = inspectInstructionBlock(text, id);
	if (found.state !== "present") return found.state;
	return `${found.version === version ? "present" : "stale"} v=${found.version}`;
};
