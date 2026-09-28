// M13 — pre-write backup (S13 backup.ts).
//
// Copies an EXISTING config to <path>.litcodex-bak.<UTC-compact>.<pid> BEFORE
// any mutation. Returns the backup path, or null when the source does not exist
// (nothing to back up). Throws CodexConfigMigrationError(BACKUP_FAILED) on copy
// failure. The backup name components are all controlled/sanitized — never
// derived from file content (no backup-path injection).

import { copyFile } from "node:fs/promises";

import { CodexConfigMigrationError } from "./errors.js";

/** Back up an existing config before mutation. Returns the backup path or null. */
export async function backupConfigFile(configPath: string): Promise<string | null> {
	const backupPath = `${configPath}.litcodex-bak.${compactTimestamp()}.${process.pid}`;
	try {
		await copyFile(configPath, backupPath);
		return backupPath;
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) {
			return null;
		}
		throw new CodexConfigMigrationError(
			"BACKUP_FAILED",
			"Could not create a pre-write backup of the Codex config.",
			configPath,
			{
				errno: errnoOf(error),
			},
		);
	}
}

/** UTC ISO compact: YYYYMMDDTHHMMSSZ (sortable, no path-illegal chars). */
function compactTimestamp(): string {
	return new Date()
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/[:-]/g, "");
}

function isErrnoCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

function errnoOf(error: unknown): string | null {
	if (error instanceof Error && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : null;
	}
	return null;
}
