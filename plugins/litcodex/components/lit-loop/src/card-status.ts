// src/card-status.ts — what the LIT card shows for one Codex thread.
//
// The desktop app names the thread in every card poll; the hooks recorded which workspace that thread
// runs in (live-step.ts). From there the card reads the same saved state the text map reads, plus the
// live step. The workspace comes from the owned pointer first; Codex's own rollout header is read only
// when no pointer exists yet, because its format is private. The rollout's last token count gives the
// context and quota use for the bottom row; when that format moves, the row simply stays empty. Thread ids are normalized before they
// touch a path, every file read is size-capped and refuses symlinks, and nothing here writes.

import { closeSync, fstatSync, readdirSync, readSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import {
	codexHomeFrom,
	type LiveStep,
	openRegularFile,
	plainDirs,
	readLiveStep,
	readThreadPointer,
} from "./live-step.js";
import { normalizeSessionId } from "./state-paths.js";
import {
	readWorkflowSignals,
	type WorkflowMap,
	workflowMapCells,
	workflowMapText,
	workflowTurn,
} from "./workflow-map.js";

/** The rollout header carries the base instructions, so it is read up to this many bytes. */
const MAX_ROLLOUT_HEADER_BYTES = 256 * 1024;
/** The newest token count sits near the end of the rollout; only this much of the tail is read. */
const MAX_ROLLOUT_TAIL_BYTES = 256 * 1024;
/** Day folders searched, newest first, for a rollout file when no pointer exists. */
const ROLLOUT_DAYS = 7;
/** A step that ended this recently still counts as work in progress, so the card keeps polling fast. */
const RECENT_STEP_MS = 20_000;
/** A step older than this never ended cleanly (a killed hook, a crash), so it is no longer shown. */
const STALE_STEP_MS = 30 * 60 * 1000;
/** An open turn with no tool and no step for this long lost its Stop (an interrupt, a crash); it is not working. */
const OPEN_TURN_IDLE_MS = 10 * 60 * 1000;
/** Stages a turn can finish the workflow from; a turn that stops while interviewing or planning waits for the user. */
const FINISHING_STAGES = new Set(["work", "review"]);

export interface CardStatus {
	readonly version: 1;
	/** The normalized thread id, so the card can name its thread when the host does not. */
	readonly thread: string | null;
	readonly state: "ready" | "ignited" | "complete";
	readonly mode: string | null;
	readonly ignitedAt: number | null;
	readonly map: WorkflowMap | null;
	readonly step: { readonly tool: string; readonly startedAt: number } | null;
	readonly lastStepAt: number | null;
	/** The tool that finished last in this turn, named the way the step is. */
	readonly lastTool: string | null;
	/** When the current turn began, so the card can count the turn's time while no tool runs. */
	readonly turnStartedAt: number | null;
	/** When the current turn ended, so a finished turn shows its own length. */
	readonly turnEndedAt: number | null;
	readonly working: boolean;
	/** Percent of the context window and of each quota window in use, from the thread's last token count. */
	readonly usage: Usage | null;
	/** The workspace's checked-out branch, or a short commit when detached. */
	readonly branch: string | null;
	/** Folder name of the workspace only; the full path stays out of the card. */
	readonly workspace: string | null;
	readonly now: number;
}

export interface Usage {
	readonly ctx: number | null;
	readonly fiveHour: number | null;
	readonly week: number | null;
}

/** Rollout files resolved during this server's life, with the workspace each one names. */
const rolloutCache = new Map<string, { readonly path: string; readonly cwd: string }>();
/** When a thread's rollout was last looked for and not found; the card polls often, the search waits. */
const rolloutMisses = new Map<string, number>();
const ROLLOUT_RETRY_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Names in `dir` that match `pattern`, newest-looking first; [] on any failure. */
function listDesc(dir: string, pattern: RegExp): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => pattern.test(name))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/** The first line of a regular, non-symlinked file, read through one bounded buffer; null when longer. */
function firstLine(path: string, maxBytes: number): string | null {
	let fd: number | null = null;
	try {
		fd = openRegularFile(path);
		if (fd === null) return null;
		if (!fstatSync(fd).isFile()) return null;
		const buffer = Buffer.alloc(maxBytes);
		const read = readSync(fd, buffer, 0, maxBytes, 0);
		const end = buffer.subarray(0, read).indexOf(0x0a);
		if (end < 0) return null;
		return buffer.subarray(0, end).toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

/** This thread's rollout file in the last week of day folders and the `session_meta.cwd` it names, or null. */
function findRollout(home: string, id: string): { path: string; cwd: string } | null {
	const key = `${home}\0${id}`;
	const cached = rolloutCache.get(key);
	if (cached !== undefined) return cached;
	const missed = rolloutMisses.get(key);
	if (missed !== undefined && Date.now() - missed < ROLLOUT_RETRY_MS) return null;
	rolloutMisses.set(key, Date.now());
	const sessions = join(home, "sessions");
	const days: string[] = [];
	for (const year of listDesc(sessions, /^\d{4}$/u)) {
		for (const month of listDesc(join(sessions, year), /^\d{2}$/u)) {
			for (const day of listDesc(join(sessions, year, month), /^\d{2}$/u)) {
				days.push(join(sessions, year, month, day));
				if (days.length >= ROLLOUT_DAYS) break;
			}
			if (days.length >= ROLLOUT_DAYS) break;
		}
		if (days.length >= ROLLOUT_DAYS) break;
	}
	const suffix = `-${id}.jsonl`;
	for (const day of days) {
		const file = listDesc(day, /^rollout-/u).find((name) => name.endsWith(suffix));
		if (file === undefined) continue;
		const line = firstLine(join(day, file), MAX_ROLLOUT_HEADER_BYTES);
		try {
			const record: unknown = line === null ? null : JSON.parse(line);
			if (!isRecord(record) || record["type"] !== "session_meta" || !isRecord(record["payload"])) return null;
			const { id: metaId, session_id: sessionId, cwd } = record["payload"];
			if ((metaId !== id && sessionId !== id) || typeof cwd !== "string" || !isAbsolute(cwd)) return null;
			const found = { path: join(day, file), cwd };
			rolloutCache.set(key, found);
			rolloutMisses.delete(key);
			return found;
		} catch {
			return null;
		}
	}
	return null;
}

/** The workspace a thread runs in: the hook pointer, else the rollout header; null when unknown. */
export function resolveThreadCwd(threadId: string | null, env: NodeJS.ProcessEnv): string | null {
	const id = normalizeSessionId(threadId);
	// A thread id that needed cleaning is not one Codex issued; it gets no workspace.
	if (id === null || id !== threadId) return null;
	const pointer = readThreadPointer(env, id);
	if (pointer !== null) return pointer.cwd;
	const home = codexHomeFrom(env);
	return home === null ? null : (findRollout(home, id)?.cwd ?? null);
}

/** The last `bytes` of a regular, non-symlinked file; null on any failure. */
function tail(path: string, bytes: number): string | null {
	let fd: number | null = null;
	try {
		fd = openRegularFile(path);
		if (fd === null) return null;
		const stat = fstatSync(fd);
		if (!stat.isFile()) return null;
		const length = Math.min(stat.size, bytes);
		const buffer = Buffer.alloc(length);
		const read = readSync(fd, buffer, 0, length, stat.size - length);
		return buffer.subarray(0, read).toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

function percent(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

/** Context and quota use from the newest token count in a rollout tail; null when there is none. */
export function usageFromRollout(text: string): Usage | null {
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index] ?? "";
		if (!line.includes('"token_count"')) continue;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		const payload = isRecord(record) && isRecord(record["payload"]) ? record["payload"] : null;
		if (payload === null || payload["type"] !== "token_count") continue;
		const info = isRecord(payload["info"]) ? payload["info"] : null;
		const last = info !== null && isRecord(info["last_token_usage"]) ? info["last_token_usage"] : null;
		const input = last?.["input_tokens"];
		const window = info?.["model_context_window"];
		const ctx =
			typeof input === "number" && typeof window === "number" && window > 0 ? percent((input / window) * 100) : null;
		let fiveHour: number | null = null;
		let week: number | null = null;
		const limits = isRecord(payload["rate_limits"]) ? payload["rate_limits"] : null;
		for (const key of ["primary", "secondary"]) {
			const limit = limits !== null && isRecord(limits[key]) ? limits[key] : null;
			const minutes = limit?.["window_minutes"];
			const used = percent(limit?.["used_percent"]);
			if (used === null || typeof minutes !== "number") continue;
			if (minutes <= 24 * 60) fiveHour = used;
			else week = used;
		}
		if (ctx === null && fiveHour === null && week === null) continue;
		return { ctx, fiveHour, week };
	}
	return null;
}

function readUsage(threadId: string, env: NodeJS.ProcessEnv): Usage | null {
	const home = codexHomeFrom(env);
	const rollout = home === null ? null : findRollout(home, threadId);
	const text = rollout === null ? null : tail(rollout.path, MAX_ROLLOUT_TAIL_BYTES);
	return text === null ? null : usageFromRollout(text);
}

/** A small regular file read without following a symlink at any moment; null on any failure. */
function readSmallText(path: string, maxBytes: number): string | null {
	let fd: number | null = null;
	try {
		fd = openRegularFile(path);
		if (fd === null) return null;
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > maxBytes) return null;
		const buffer = Buffer.alloc(stat.size);
		const read = readSync(fd, buffer, 0, stat.size, 0);
		return buffer.subarray(0, read).toString("utf8");
	} catch {
		return null;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

/**
 * The checked-out branch, or a short commit when detached, else null. A worktree or submodule keeps a
 * `.git` file that names its git folder (`gitdir: <path>`); HEAD is read from there.
 */
function readBranch(cwd: string): string | null {
	const pointer = readSmallText(join(cwd, ".git"), 1024)
		?.trim()
		.match(/^gitdir: (.+)$/u)?.[1];
	const gitDir = pointer === undefined ? join(cwd, ".git") : isAbsolute(pointer) ? pointer : join(cwd, pointer);
	const text = readSmallText(join(gitDir, "HEAD"), 512)?.trim();
	if (text === undefined) return null;
	const ref = text.match(/^ref: refs\/heads\/([\w./-]{1,80})$/u)?.[1];
	if (ref !== undefined) return ref;
	return /^[0-9a-f]{40,64}$/u.test(text) ? text.slice(0, 7) : null;
}

/** A tool name as the card shows it: an MCP tool reads `server · tool` rather than its joined id. */
export function toolDisplayName(tool: string): string {
	const parts = tool.split("__");
	if (parts[0] === "mcp" && parts.length >= 3 && parts[1] !== "") return `${parts[1]} · ${parts.slice(2).join("__")}`;
	return tool;
}

/** The map once the turn has ended with nothing left open: the running stage and the last stage are done. */
function finishedMap(map: WorkflowMap): WorkflowMap {
	const lastKey = map.cells.at(-1)?.key;
	return {
		...map,
		cells: map.cells.map((cell) =>
			cell.state === "current" || cell.key === lastKey ? { ...cell, state: "done", label: null } : cell,
		),
		next: null,
	};
}

function ready(thread: string | null, workspace: string | null, now: number): CardStatus {
	return {
		version: 1,
		thread,
		state: "ready",
		mode: null,
		ignitedAt: null,
		map: null,
		step: null,
		lastStepAt: null,
		lastTool: null,
		turnStartedAt: null,
		turnEndedAt: null,
		working: false,
		usage: null,
		branch: null,
		workspace,
		now,
	};
}

/**
 * Whether the model is still on the turn while no tool runs. A record that knows its turn says so
 * directly (open until Stop, unless it has gone quiet for the stale window); an older record without
 * turn marks falls back to "a step ended a moment ago".
 */
function turnWorking(live: LiveStep | null, lastStepAt: number | null, now: number): boolean {
	if (live !== null && (live.turnStartedAt !== null || live.turnEndedAt !== null)) {
		if (live.turnEndedAt !== null) return false;
		const last = Math.max(live.turnStartedAt ?? 0, live.startedAt ?? 0, live.endedAt ?? 0);
		return now - last < OPEN_TURN_IDLE_MS;
	}
	return lastStepAt !== null && now - lastStepAt < RECENT_STEP_MS;
}

export function readCardStatus(threadId: string | null, env: NodeJS.ProcessEnv, now = Date.now()): CardStatus {
	const cwd = resolveThreadCwd(threadId, env);
	const thread = cwd === null ? null : threadId;
	if (cwd === null || thread === null) return ready(null, null, now);
	const workspace = basename(cwd);
	// Every saved state lives under `.litcodex`; a symlink there would point the card at foreign files.
	if (!plainDirs(cwd, ".litcodex")) return ready(thread, workspace, now);
	const turn = workflowTurn(cwd, thread);
	if (turn === null) return ready(thread, workspace, now);
	const signals = readWorkflowSignals(cwd, thread, now);
	const drawn = workflowMapCells(turn.mode, signals);
	const live = readLiveStep(cwd, thread);
	const step =
		live !== null && live.tool !== null && live.startedAt !== null && now - live.startedAt < STALE_STEP_MS
			? { tool: toolDisplayName(live.tool), startedAt: live.startedAt }
			: null;
	const lastStepAt = live?.endedAt ?? live?.startedAt ?? null;
	const recorded =
		signals.work?.status === "completed" ||
		drawn?.cells.some((cell) => cell.key === "done" && cell.state === "current") === true;
	// A LIT turn that has ended with no task or goal still open is done, even though no stage record says so.
	const turnOver =
		live !== null &&
		live.turnEndedAt !== null &&
		live.turnEndedAt >= turn.startedAt &&
		(live.turnStartedAt === null || live.turnEndedAt >= live.turnStartedAt);
	const open =
		(signals.work !== null && signals.work.done < signals.work.total) ||
		(signals.goals !== null && signals.goals.done < signals.goals.total);
	const stage = drawn?.cells.find((cell) => cell.state === "current")?.key;
	const finished =
		!recorded && turnOver && !open && drawn?.family === "main" && stage !== undefined && FINISHING_STAGES.has(stage);
	const map = finished && drawn !== null ? finishedMap(drawn) : drawn;
	return {
		version: 1,
		thread,
		state: recorded || finished ? "complete" : "ignited",
		mode: turn.mode,
		ignitedAt: turn.startedAt,
		map,
		step,
		lastStepAt,
		lastTool: live?.lastTool ? toolDisplayName(live.lastTool) : null,
		turnStartedAt: live?.turnStartedAt ?? null,
		turnEndedAt: turnOver ? live.turnEndedAt : null,
		working: step !== null || turnWorking(live, lastStepAt, now),
		usage: readUsage(thread, env),
		branch: readBranch(cwd),
		workspace,
		now,
	};
}

function clock(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The card as plain text, for hosts that cannot draw it (the terminal `codex`). */
export function cardStatusText(status: CardStatus): string {
	if (status.state === "ready")
		return "🔥 LIT · ready — no LIT skill in this thread yet. Type `lit <task>` to start one.";
	const lines = [`🔥 LIT ${status.state === "complete" ? "COMPLETE ✓" : "IGNITED"} · ${status.mode ?? "lit"}`];
	if (status.map !== null) {
		lines.push(workflowMapText(status.map));
		if (status.map.next !== null) lines.push(`next ▸ ${status.map.next}`);
	}
	if (status.step !== null) lines.push(`⠹ ${status.step.tool} · ${clock(status.now - status.step.startedAt)}`);
	return lines.join("\n");
}
