// src/card-status.ts — what the LIT card shows for one Codex thread.
//
// The desktop app names the thread in every card poll; the hooks recorded which workspace that thread
// runs in (live-step.ts). From there the card reads the same saved state the text map reads, plus the
// live step. The workspace comes from the owned pointer first; Codex's own rollout header is read only
// when no pointer exists yet, because its format is private. The rollout's last token count gives the
// context and quota use for the bottom row; when that format moves, the row simply stays empty. Thread ids are normalized before they
// touch a path, every file read is size-capped and refuses symlinks, and nothing here writes; the one
// write of the card server, the time a card opened, lives in live-step.ts.

import { closeSync, fstatSync, readdirSync, readSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { type LaneState, lookOf, REVIEW_LANE_IDS } from "./card-looks.js";
import { cleanDeep, cleanLines } from "./control-chars.js";
import {
	codexHomeFrom,
	type LiveStep,
	openRegularFile,
	plainDirs,
	readLiveStep,
	readThreadPointer,
} from "./live-step.js";
import { installedPluginVersion, loadedPluginVersion, restartChip } from "./restart-chip.js";
import { normalizeSessionId } from "./state-paths.js";
import { readThreads, type ThreadView, threadLines } from "./threads.js";
import {
	readWorkflowSignals,
	type WorkflowMap,
	workflowMapCells,
	workflowMapText,
	workflowTurn,
} from "./workflow-map.js";
import { breadcrumb, frameNote, readStack, type StackFrame, stackGauge, stackRow } from "./workflow-stack.js";

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
	/** The card's look: "rewind", "review", "turn" (waiting on the user), "done" (just finished), or null. */
	readonly look: string | null;
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
	/** Work paused under a side discipline, or null while the thread has a single line of work. */
	readonly stack?: CardStack | null;
	/** Frames, child agents and other live sessions as rows; null while the stack row says all there is to say. */
	readonly threads?: ThreadView | null;
	/** The five review-work lane states, in border-draw order; null when the mode is not review-work. */
	readonly reviewLanes?: readonly LaneState[] | null;
	/** The workspace's checked-out branch, or a short commit when detached. */
	readonly branch: string | null;
	/** Folder name of the workspace only; the full path stays out of the card. */
	readonly workspace: string | null;
	/** When the newest card of this thread opened; an older card that sees a later time folds itself. */
	readonly cardOpenedAt: number | null;
	/** `restart to <v>` while a newer LitCodex is installed than the one this process loaded, else null. */
	readonly restart?: string | null;
	readonly now: number;
}

/**
 * One frame of the session's workflow stack as the card names it: the skill and its stage, and a gauge only when
 * both counts are real. A frame without a total carries a short `note` in words instead (`step 2`, or empty).
 */
export interface CardFrame {
	readonly name: string;
	readonly stage: string | null;
	readonly gauge: string | null;
	readonly note: string;
}

/** A side discipline running over paused work: what is paused, what runs, and the way back. */
export interface CardStack {
	readonly breadcrumb: string;
	readonly row: string;
	readonly paused: readonly CardFrame[];
	readonly running: CardFrame;
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

/** The workspace a thread runs in: the hook pointer, else (when `rollout` allows) the rollout header; null when unknown. */
export function resolveThreadCwd(threadId: string | null, env: NodeJS.ProcessEnv, rollout = true): string | null {
	const id = normalizeSessionId(threadId);
	// A thread id that needed cleaning is not one Codex issued; it gets no workspace.
	if (id === null || id !== threadId) return null;
	const pointer = readThreadPointer(env, id);
	if (pointer !== null) return pointer.cwd;
	if (!rollout) return null;
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

function ready(thread: string | null, workspace: string | null, cardOpenedAt: number | null, now: number): CardStatus {
	return {
		version: 1,
		thread,
		state: "ready",
		mode: null,
		look: null,
		ignitedAt: null,
		map: null,
		step: null,
		lastStepAt: null,
		lastTool: null,
		turnStartedAt: null,
		turnEndedAt: null,
		working: false,
		usage: null,
		stack: null,
		threads: null,
		reviewLanes: null,
		branch: null,
		workspace,
		cardOpenedAt,
		now,
	};
}

/** The paused frames under the running one, read from the thread's own stack; null when nothing is paused. */
function readCardStack(cwd: string, thread: string): CardStack | null {
	try {
		const stack = readStack(cwd, thread);
		const row = stackRow(stack);
		const crumb = breadcrumb(stack);
		const top = stack.frames.at(-1);
		if (row === null || crumb === null || top === undefined || !stack.frames.some((f) => f.status === "paused"))
			return null;
		const framed = (f: (typeof stack.frames)[number]): CardFrame => ({
			name: f.skill ?? f.family ?? "work",
			stage: f.stage,
			gauge: stackGauge(f),
			note: frameNote(f),
		});
		return { breadcrumb: crumb, row, paused: stack.frames.slice(0, -1).map(framed), running: framed(top) };
	} catch {
		return null;
	}
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

/** The card for one thread. `rollout: false` keeps every Codex rollout file unread; the usage row then stays empty. */
export function readCardStatus(
	threadId: string | null,
	env: NodeJS.ProcessEnv,
	now = Date.now(),
	options: { readonly rollout?: boolean; readonly loadedVersion?: string | null } = {},
): CardStatus {
	const rollout = options.rollout !== false;
	const cwd = resolveThreadCwd(threadId, env, rollout);
	const thread = cwd === null ? null : threadId;
	if (cwd === null || thread === null) return ready(null, null, null, now);
	const workspace = basename(cwd);
	const cardOpenedAt = readThreadPointer(env, thread)?.cardOpenedAt ?? null;
	// Every saved state lives under `.litcodex`; a symlink there would point the card at foreign files.
	if (!plainDirs(cwd, ".litcodex")) return ready(thread, workspace, cardOpenedAt, now);
	const turn = workflowTurn(cwd, thread);
	if (turn === null) return ready(thread, workspace, cardOpenedAt, now);
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
	const state: CardStatus["state"] = recorded || finished ? "complete" : "ignited";
	const working = step !== null || turnWorking(live, lastStepAt, now);
	const cardStack = readCardStack(cwd, thread);

	// The look: a completion first, then the session waiting on the user, then the skill's own look.
	// When the mode has no look (a scoped or implicit skill load that the hook never routed), the
	// stack's active top frame can carry it: family "main" + stage "review" → "review".
	// The "turn" look fires only when the last assistant message asked something (question mark,
	// approval phrase) or reported BLOCKED — not on every finished turn.
	let skillLook = lookOf(turn.mode);
	let reviewFrame: StackFrame | undefined;
	try {
		const stack = readStack(cwd, thread);
		reviewFrame = stack.frames.find((f) => f.family === "main" && f.stage === "review" && f.status === "active");
		if (skillLook === null && reviewFrame !== undefined) {
			skillLook = "review";
		}
	} catch {
		// The card shows what it can; a missing stack does not break the read.
	}
	const waitReason = live?.waitReason ?? null;
	const waitingOnUser = !working && state === "ignited" && turnOver && waitReason !== null;
	// The done look fires only for an explicit plan/goal completion (recorded signal), not for a
	// routine turn that implicitly finishes at a finishing stage.
	const doneLook = state === "complete" && recorded;
	const look: string | null = doneLook ? "done" : waitingOnUser ? "turn" : skillLook;

	// Review lane states from the workflow stack's verdicts.
	let reviewLanes: readonly LaneState[] | null = null;
	if (skillLook === "review" && reviewFrame !== undefined) {
		reviewLanes = REVIEW_LANE_IDS.map((id): LaneState => {
			const v = (reviewFrame as StackFrame).verdicts[id];
			if (v === "pass") return "pass";
			if (v === "fail") return "fail";
			if (v === "running") return "running";
			return "dim";
		});
	}

	// Every string here came from a record; none of it may carry a terminal control.
	return cleanDeep({
		version: 1,
		thread,
		state,
		mode: turn.mode,
		look,
		ignitedAt: turn.startedAt,
		map,
		step,
		lastStepAt,
		lastTool: live?.lastTool ? toolDisplayName(live.lastTool) : null,
		turnStartedAt: live?.turnStartedAt ?? null,
		turnEndedAt: turnOver ? live.turnEndedAt : null,
		working,
		usage: rollout ? readUsage(thread, env) : null,
		stack: cardStack,
		threads: readThreads(cwd, thread, now, signals),
		reviewLanes,
		branch: readBranch(cwd),
		workspace,
		cardOpenedAt,
		restart: restartChip(
			options.loadedVersion === undefined ? loadedPluginVersion() : options.loadedVersion,
			installedPluginVersion(env),
		),
		now,
	});
}

/** Minutes and seconds, `m:ss`. */
export function clock(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The card as plain text, for hosts that cannot draw it (the terminal `codex`). */
export function cardStatusText(status: CardStatus): string {
	if (status.state === "ready")
		return "🔥 LIT · ready — no LIT skill in this thread yet. Type `lit <task>` to start one, or `lit adhd` after a break.";
	const lookLabel =
		status.look === "turn"
			? "  YOUR TURN"
			: status.look === "rewind"
				? "  REWIND <<"
				: status.look === "review"
					? "  REVIEW"
					: "";
	const chip = status.restart ? `  ↻ ${status.restart}` : "";
	const lines = [
		`🔥 LIT ${status.state === "complete" ? "COMPLETE ✓" : "IGNITED"} · ${status.mode ?? "lit"}${lookLabel}${chip}`,
	];
	if (status.map !== null) {
		lines.push(workflowMapText(status.map));
		if (status.map.next !== null) lines.push(`next ▸ ${status.map.next}`);
	}
	if (status.threads) lines.push(...threadLines(status.threads));
	else if (status.stack) lines.push(status.stack.row);
	if (status.step !== null) lines.push(`⠹ ${status.step.tool} · ${clock(status.now - status.step.startedAt)}`);
	return cleanLines(lines.join("\n"));
}
