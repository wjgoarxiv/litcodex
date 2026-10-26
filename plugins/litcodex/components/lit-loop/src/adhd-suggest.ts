// src/adhd-suggest.ts — the quiet offer of `lit adhd` when a session opens in a folder with earlier work.
//
// A folder counts as having earlier work when another session left a saved record under `.litcodex` that was
// last touched between half an hour and a week ago: long enough to be a break, recent enough to matter. The
// offer is one line of context for the model to pass on, made at most once a day per folder, and it never
// starts the brief. Only file names and times under `.litcodex` are read; nothing of Codex's own records is opened.

import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { plainDirsOrMissing, readSmallJson, writeFileAtomic } from "./live-step.js";
import { normalizeSessionId } from "./state-paths.js";

export const SUGGEST_DIR = ".litcodex/adhd";
const SUGGEST_FILE = "suggested.json";
/** A record untouched for less than this belongs to a session that has not had a break. */
export const BREAK_MS = 30 * 60 * 1000;
/** A record older than this is no longer recent work. */
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
/** One offer per folder in this long. */
export const QUIET_MS = 24 * 60 * 60 * 1000;
/** Where a session leaves its saved records; any one of them is a sign of earlier work. */
const RECORD_DIRS = [".litcodex/workflow-stack", ".litcodex/lit-reentry", ".litcodex/live-step"];

export const SUGGESTION =
	"lit-adhd offer: this folder holds work from earlier sessions. Mention once, in one short line and only if it fits, " +
	"that `lit adhd` shows where things stand and `go` carries on. Do not run it unasked.";

function earlierWork(cwd: string, sessionId: string, now: number): boolean {
	const own = normalizeSessionId(sessionId);
	for (const rel of RECORD_DIRS) {
		if (!plainDirsOrMissing(cwd, rel)) continue;
		let names: string[];
		try {
			names = readdirSync(join(cwd, rel));
		} catch {
			continue;
		}
		for (const name of names.slice(0, 200)) {
			if (!name.endsWith(".json") || name.slice(0, -".json".length) === own) continue;
			try {
				const stat = lstatSync(join(cwd, rel, name));
				const age = now - stat.mtimeMs;
				if (stat.isFile() && age >= BREAK_MS && age <= RECENT_MS) return true;
			} catch {
				// A record that vanished is skipped.
			}
		}
	}
	return false;
}

/** The offer for a session that just opened, or null when it was made lately, there is nothing earlier, or state is unsafe. */
export function adhdSuggestion(cwd: string, sessionId: string, now = Date.now()): string | null {
	try {
		if (!plainDirsOrMissing(cwd, SUGGEST_DIR) || !earlierWork(cwd, sessionId, now)) return null;
		const last = readSmallJson(join(cwd, SUGGEST_DIR, SUGGEST_FILE), 1024);
		const at = typeof last === "object" && last !== null ? (last as Record<string, unknown>)["at"] : undefined;
		if (typeof at === "number" && now - at < QUIET_MS) return null;
		mkdirSync(join(cwd, SUGGEST_DIR), { recursive: true });
		writeFileAtomic(join(cwd, SUGGEST_DIR, SUGGEST_FILE), `${JSON.stringify({ version: 1, at: now })}\n`);
		return SUGGESTION;
	} catch {
		return null;
	}
}
