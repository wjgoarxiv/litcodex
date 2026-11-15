// The "already shown" record: one line per notice text LitCodex itself has printed, kept in the data root beside
// the notice it guards (`<LITCODEX_DATA_ROOT or ~/.litcodex>/shown-notices.jsonl`).
//
// A line is `{"hash":"<16 hex>","at":<ms>}`: a hash of the whitespace-normalised text and the time it was shown,
// never the text. The file is append-only and capped, and every problem reads as "not shown yet", so a missing,
// corrupt, oversized, symlinked or unwritable record changes nothing: the notice appears exactly as it did before
// the record existed.

import { createHash } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

const LEDGER_FILE = "shown-notices.jsonl";
/** About 3,000 lines. Past this nothing is read or appended, which is the same as having no record. */
const MAX_LEDGER_BYTES = 64 * 1024;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export function noticeHash(text: string): string {
	return createHash("sha256").update(text.replace(/\s+/gu, " ").trim()).digest("hex").slice(0, 16);
}

export function shownNoticesPath(dataRoot: string): string {
	return join(dataRoot, LEDGER_FILE);
}

/** True only when a well-formed line of the record carries this hash. */
export function wasShown(dataRoot: string, hash: string): boolean {
	try {
		const path = shownNoticesPath(dataRoot);
		const stat = lstatSync(path, { throwIfNoEntry: false });
		if (stat === undefined || !stat.isFile() || stat.size > MAX_LEDGER_BYTES) return false;
		for (const line of readFileSync(path, "utf8").split("\n")) {
			try {
				const entry = JSON.parse(line) as { hash?: unknown } | null;
				if (typeof entry === "object" && entry !== null && entry.hash === hash) return true;
			} catch {
				// a corrupt line is skipped
			}
		}
		return false;
	} catch {
		return false;
	}
}

/** Append one line. Never throws and never writes through a symlink or past the cap. */
export function markShown(dataRoot: string, hash: string, now = Date.now()): void {
	try {
		const path = shownNoticesPath(dataRoot);
		mkdirSync(dataRoot, { recursive: true });
		const stat = lstatSync(path, { throwIfNoEntry: false });
		if (stat !== undefined && (!stat.isFile() || stat.size >= MAX_LEDGER_BYTES)) return;
		const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW, 0o600);
		try {
			writeSync(fd, `${JSON.stringify({ hash, at: now })}\n`);
		} finally {
			closeSync(fd);
		}
	} catch {
		// the notice was already shown; losing the record only means it may show again
	}
}
