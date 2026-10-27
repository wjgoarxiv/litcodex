// src/session-liveness.ts — whether each LIT session in a workspace is working, waiting or gone.
//
// One small record per session, `.litcodex/liveness/<session>.json`: `alive` from the PostToolUse live hook,
// `idle` from Stop once the turn has closed. Codex fires no hook when a session ends, so `ended` is never
// written; a reader derives it from a record left untouched for 15 minutes. A repeat of the same state within
// 30 seconds writes nothing, so a busy turn costs one write per half minute. The herdr pane id is kept only when
// `HERDR_PANE_ID` is a short plain token. Writes are atomic, refuse a symlinked folder and never throw.

import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { plainDirs, plainDirsOrMissing, readSmallJson, writeFileAtomic } from "./live-step.js";
import { normalizeSessionId } from "./state-paths.js";

export const LIVENESS_DIR = ".litcodex/liveness";
export const LIVENESS_THROTTLE_MS = 30_000;
export const LIVENESS_ENDED_MS = 15 * 60_000;
const PANE_ID = /^[A-Za-z0-9:_-]{1,32}$/u;
const MAX_RECORDS = 64;

export type LivenessState = "alive" | "idle" | "ended";

export interface LivenessRecord {
	readonly sessionId: string;
	readonly state: LivenessState;
	readonly at: number;
	readonly herdrPane: string | null;
}

function recordPath(repoRoot: string, sessionId: string): string | null {
	const id = normalizeSessionId(sessionId);
	if (id === null || typeof repoRoot !== "string" || !isAbsolute(repoRoot)) return null;
	return join(repoRoot, LIVENESS_DIR, `${id}.json`);
}

function parse(value: unknown, now: number): LivenessRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const { sessionId, state, at, herdrPane } = record;
	if (record["version"] !== 1 || typeof sessionId !== "string" || typeof at !== "number" || !Number.isFinite(at))
		return null;
	if (state !== "alive" && state !== "idle") return null;
	return {
		sessionId,
		state: now - at > LIVENESS_ENDED_MS ? "ended" : state,
		at,
		herdrPane: typeof herdrPane === "string" && PANE_ID.test(herdrPane) ? herdrPane : null,
	};
}

/** Note that `sessionId` is `alive` or `idle` now. Never throws; a failed write only leaves the old record. */
export function recordLiveness(
	repoRoot: string,
	sessionId: string,
	state: "alive" | "idle",
	env: NodeJS.ProcessEnv,
	now = Date.now(),
): void {
	const path = recordPath(repoRoot, sessionId);
	if (path === null) return;
	try {
		if (!plainDirsOrMissing(repoRoot, LIVENESS_DIR)) return;
		const last = parse(readSmallJson(path), now);
		if (last !== null && last.state === state && now - last.at >= 0 && now - last.at < LIVENESS_THROTTLE_MS) return;
		const pane = env["HERDR_PANE_ID"];
		mkdirSync(join(repoRoot, LIVENESS_DIR), { recursive: true });
		const herdrPane = typeof pane === "string" && PANE_ID.test(pane) ? pane : null;
		writeFileAtomic(path, `${JSON.stringify({ version: 1, sessionId, state, at: now, herdrPane })}\n`);
	} catch {
		// Liveness is a hint for other sessions' views; the hook's own answer never depends on it.
	}
}

/** This session's record with `ended` derived from its age, or null when there is none. */
export function readLiveness(repoRoot: string, sessionId: string, now = Date.now()): LivenessRecord | null {
	const path = recordPath(repoRoot, sessionId);
	if (path === null || !plainDirs(repoRoot, LIVENESS_DIR)) return null;
	return parse(readSmallJson(path), now);
}

/** Every session's record in this workspace (at most 64), `ended` derived from age. */
export function readSessionsLiveness(repoRoot: string, now = Date.now()): LivenessRecord[] {
	if (typeof repoRoot !== "string" || !isAbsolute(repoRoot) || !plainDirs(repoRoot, LIVENESS_DIR)) return [];
	const dir = join(repoRoot, LIVENESS_DIR);
	let names: string[];
	try {
		if (!lstatSync(dir).isDirectory()) return [];
		names = readdirSync(dir)
			.filter((name) => name.endsWith(".json"))
			.sort()
			.slice(0, MAX_RECORDS);
	} catch {
		return [];
	}
	const out: LivenessRecord[] = [];
	for (const name of names) {
		const record = parse(readSmallJson(join(dir, name)), now);
		if (record !== null) out.push(record);
	}
	return out;
}
