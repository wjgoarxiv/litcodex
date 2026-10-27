// src/workflow-stack.ts — the session's workflow stack: where each running discipline stands, so asking
// for something in the middle of a loop or a plan run pauses that work instead of erasing it.
//
// The bottom frame is the spine (the main line of work: interview, plan, work, review, or a research
// run); a discipline started on top of it is a side frame. A successor in the main chain (plan after
// interview, work after plan, review after work) finishes the frame below it instead of pausing it.
// Asking for a skill already in the stack resumes its frame with its stage and count; `lit continue`
// on a side frame closes it and resumes the paused spine at the stage and k/n it left. Read-only
// disciplines never touch the stack.
//
// `applyStackEvent` is pure. The store writes one small file per session under
// `.litcodex/workflow-stack/`, whole, through a temporary file; every read and write fails open, so a
// hook never fails because of it. Frames keep skills, stages and counts only: never a prompt, a command
// or a path other than a project-relative plan name.

import { closeSync, fstatSync, lstatSync, mkdirSync, readdirSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { openRegularFile, plainDirs, plainDirsOrMissing, writeFileAtomic } from "./live-step.js";
import { readSessionsLiveness } from "./session-liveness.js";
import { normalizeSessionId } from "./state-paths.js";

export const STACK_DIR = ".litcodex/workflow-stack";
export const MAX_FRAMES = 3;
export const MAX_HISTORY = 20;
export const MAX_STACK_BYTES = 64 * 1024;
/** A frame nobody touched for this long is dropped on the next event. */
export const STACK_DROP_MS = 24 * 60 * 60 * 1000;
/** Disciplines that only read: they neither pause the work under them nor appear as a frame. */
export const READ_ONLY_DISCIPLINES: readonly string[] = [
	"lit-recap",
	"lit-comprehend",
	"lit-handoff",
	"lit-adhd",
	"lit-rewind",
];

export const WORKFLOW_FAMILIES: Readonly<Record<string, readonly string[]>> = {
	main: ["interview", "plan", "work", "review", "done"],
	research: ["decompose", "wave", "expand", "verify", "synthesis"],
	loop: ["PIN", "RED", "GREEN", "VERIFY", "REVIEW", "RECORD"],
};
/** lit-loop writes eight steps; the map shows six, so SURFACE sits on VERIFY and CLEAN on RECORD. */
const STAGE_ALIASES: Readonly<Record<string, string>> = { SURFACE: "VERIFY", CLEAN: "RECORD" };
const STAGE_UNITS: readonly string[] = ["task", "criterion", "iteration", "wave", "round"];
const VERDICT_STATES: readonly string[] = ["pass", "fail", "pending", "running"];
const REVIEW_LANES: readonly string[] = ["goal", "quality", "security", "qa", "context"];
const MAX_VERDICTS = 8;

/** Where each discipline enters the map. A discipline not listed here is always a side frame. */
const DISCIPLINE_ENTRY: Readonly<Record<string, { readonly family: string; readonly stage: string }>> = {
	"deep-interview": { family: "main", stage: "interview" },
	"lit-brainstorm": { family: "main", stage: "interview" },
	"lit-crucible": { family: "main", stage: "plan" },
	"lit-plan": { family: "main", stage: "plan" },
	"start-work": { family: "main", stage: "work" },
	litwork: { family: "main", stage: "work" },
	litgoal: { family: "main", stage: "work" },
	"lit-loop": { family: "main", stage: "work" },
	"review-work": { family: "main", stage: "review" },
	litresearch: { family: "research", stage: "decompose" },
};

/** Order in the main chain; a newcomer of a higher rank succeeds the frame below it. */
const CHAIN_RANK: Readonly<Record<string, number>> = {
	"deep-interview": 0,
	"lit-brainstorm": 0,
	"lit-crucible": 1,
	"lit-plan": 1,
	"start-work": 2,
	litwork: 2,
	litgoal: 2,
	"lit-loop": 2,
	"review-work": 3,
};
const PLAN_REF = /^(?:\.litcodex\/)?plans\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.md$/u;

export type FrameStatus = "active" | "paused";
export type FrameRole = "spine" | "side";

export interface StackFrame {
	readonly skill: string | null;
	readonly family: string | null;
	readonly stage: string | null;
	readonly role: FrameRole;
	readonly status: FrameStatus;
	readonly n?: number;
	readonly total?: number;
	readonly unit?: string;
	readonly done?: boolean;
	readonly ref?: { readonly plan: string };
	readonly verdicts: Readonly<Record<string, string>>;
	readonly at: string;
	readonly pausedAt?: string;
}

export interface StackHistoryEntry {
	readonly event: string;
	readonly skill: string | null;
	readonly at: string;
}

export interface WorkflowStack {
	readonly version: 1;
	readonly sessionId: string | null;
	readonly frames: readonly StackFrame[];
	readonly history: readonly StackHistoryEntry[];
}

export type StackTransitionType = "started" | "paused" | "resumed" | "side.done" | "finished" | "dropped";

export interface StackTransition {
	readonly type: StackTransitionType;
	readonly skill: string | null;
	readonly stage: string | null;
	readonly n?: number;
	readonly total?: number;
}

interface StageFields {
	readonly family?: string;
	readonly stage?: string;
	readonly n?: number;
	readonly total?: number;
	readonly unit?: string;
	readonly done?: boolean;
	readonly verdicts?: Readonly<Record<string, string>>;
	readonly ref?: { readonly plan?: string };
	readonly scope?: string;
}

export type StackEvent =
	| {
			readonly type: "start";
			readonly skill: string;
			readonly ref?: { readonly plan?: string };
			readonly restart?: boolean;
	  }
	| { readonly type: "continue" }
	| ({ readonly type: "move" } & StageFields)
	| ({ readonly type: "record" } & StageFields);

type MutableFrame = { -readonly [K in keyof StackFrame]: StackFrame[K] };

export function emptyStack(sessionId?: string | null): WorkflowStack {
	return {
		version: 1,
		sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
		frames: [],
		history: [],
	};
}

function lastIndexWhere<T>(items: readonly T[], test: (item: T) => boolean): number {
	for (let index = items.length - 1; index >= 0; index -= 1) if (test(items[index] as T)) return index;
	return -1;
}

function countOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 9999 ? value : undefined;
}

function planRef(ref: { readonly plan?: string } | undefined): { plan: string } | undefined {
	return ref && typeof ref.plan === "string" && PLAN_REF.test(ref.plan) && !ref.plan.includes("..")
		? { plan: ref.plan }
		: undefined;
}

/** A known stage of a known family in its stored spelling, or null. */
export function normalizeStage(family: unknown, stage: unknown): string | null {
	if (typeof family !== "string" || !Object.hasOwn(WORKFLOW_FAMILIES, family)) return null;
	const stages = WORKFLOW_FAMILIES[family] ?? [];
	const raw = String(stage ?? "").trim();
	const named = family === "loop" ? (STAGE_ALIASES[raw.toUpperCase()] ?? raw.toUpperCase()) : raw.toLowerCase();
	return stages.includes(named) ? named : null;
}

function isSuccessor(skill: string, frame: StackFrame): boolean {
	const next = CHAIN_RANK[skill];
	const below = frame.skill === null ? undefined : CHAIN_RANK[frame.skill];
	return next !== undefined && below !== undefined && next > below;
}

function newFrame(
	skill: string,
	ref: { readonly plan?: string } | undefined,
	role: FrameRole,
	at: string,
): MutableFrame {
	const entry = DISCIPLINE_ENTRY[skill];
	const frame: MutableFrame = {
		skill,
		family: entry?.family ?? null,
		stage: entry?.stage ?? null,
		role,
		status: "active",
		verdicts: {},
		at,
	};
	const plan = planRef(ref);
	if (plan) frame.ref = plan;
	return frame;
}

/** A saved plan, or a review whose five lanes have all reported: what comes next replaces it. */
function isFinished(frame: StackFrame): boolean {
	return (
		frame.done === true ||
		(frame.family === "main" &&
			frame.stage === "review" &&
			REVIEW_LANES.every((id) => ["pass", "fail"].includes(frame.verdicts?.[id] ?? "")))
	);
}

function snapshot(frame: StackFrame): { stage: string | null; n?: number; total?: number } {
	return {
		stage: frame.stage,
		...(frame.n === undefined ? {} : { n: frame.n }),
		...(frame.total === undefined ? {} : { total: frame.total }),
	};
}

/**
 * Apply one event to the stack and return the next stack with the transitions it made (`started`,
 * `paused`, `resumed`, `side.done`, `finished`, `dropped`), which the caller may log.
 * Events: `start {skill, ref?, restart?}`, `continue`, `move {family, stage, n?, total?, unit?, done?,
 * verdicts?, ref?, scope?}` (the hooks' observations) and `record {...same fields}` (the model's
 * `loop stage` call, which updates the top frame or opens one).
 */
export function applyStackEvent(
	stack: WorkflowStack | null | undefined,
	event: StackEvent,
	now: Date = new Date(),
): { stack: WorkflowStack; transitions: StackTransition[] } {
	const at = now.toISOString();
	const transitions: StackTransition[] = [];
	const note = (type: StackTransitionType, frame: StackFrame): void => {
		transitions.push({ type, skill: frame.skill, ...snapshot(frame) });
	};
	let frames: MutableFrame[] = (Array.isArray(stack?.frames) ? stack.frames : [])
		.filter((frame) => now.getTime() - Date.parse(frame.at) <= STACK_DROP_MS)
		.map((frame) => ({ ...frame }));

	const pause = (frame: MutableFrame): void => {
		if (frame.status === "paused") return;
		frame.status = "paused";
		frame.pausedAt = at;
		note("paused", frame);
	};
	const activate = (frame: MutableFrame): void => {
		const wasPaused = frame.status === "paused";
		frame.status = "active";
		frame.at = at;
		delete frame.pausedAt;
		if (wasPaused) note("resumed", frame);
	};
	const closeAbove = (index: number, type: StackTransitionType): void => {
		for (const frame of frames.slice(index + 1).reverse()) note(type, frame);
		frames = frames.slice(0, index + 1);
	};
	const push = (frame: MutableFrame): void => {
		frames.push(frame);
		note("started", frame);
		while (frames.length > MAX_FRAMES) {
			const side = frames.findIndex((candidate, index) => index < frames.length - 1 && candidate.role === "side");
			const [dropped] = frames.splice(side === -1 ? 0 : side, 1);
			if (dropped) note("dropped", dropped);
		}
	};

	const start = (skill: string, ref: { readonly plan?: string } | undefined, restart: boolean): void => {
		if (READ_ONLY_DISCIPLINES.includes(skill)) return;
		const hasFamily = Object.hasOwn(DISCIPLINE_ENTRY, skill);
		if (restart) {
			closeAbove(-1, "finished");
			push(newFrame(skill, ref, hasFamily ? "spine" : "side", at));
			return;
		}
		const existing = lastIndexWhere(frames, (frame) => frame.skill === skill);
		const found = existing === -1 ? undefined : frames[existing];
		if (found) {
			const wanted = planRef(ref);
			const kept = found.ref?.plan;
			if (!isFinished(found) && (!wanted || !kept || wanted.plan === kept)) {
				closeAbove(existing, "side.done");
				activate(found);
				if (wanted) found.ref = wanted;
				return;
			}
			const role = found.role;
			closeAbove(existing - 1, "finished");
			const below = frames.at(-1);
			if (below) pause(below);
			push(newFrame(skill, ref, role, at));
			return;
		}
		let inherited: FrameRole | null = null;
		let handed: { readonly plan: string } | undefined;
		while (frames.length > 0 && isFinished(frames[frames.length - 1] as StackFrame)) {
			const done = frames.pop() as MutableFrame;
			note("finished", done);
			inherited = done.role;
			handed = handed ?? done.ref;
		}
		// Work that follows a plan in the main chain carries the plan's name on, so its count is the plan's.
		const carried = (from: { readonly plan?: string } | undefined): { readonly plan?: string } | undefined =>
			ref ?? ((CHAIN_RANK[skill] ?? -1) >= (CHAIN_RANK["start-work"] ?? 99) ? from : undefined);
		const top = frames.at(-1);
		if (!top) {
			push(newFrame(skill, carried(handed), hasFamily ? (inherited ?? "spine") : "side", at));
		} else if (!frames.some((frame) => frame.role === "spine")) {
			closeAbove(-1, "finished");
			push(newFrame(skill, ref, hasFamily ? "spine" : "side", at));
		} else if (hasFamily && isSuccessor(skill, top)) {
			frames.pop();
			note(top.role === "spine" ? "finished" : "side.done", top);
			push(newFrame(skill, carried(top.ref ?? handed), top.role, at));
		} else {
			pause(top);
			push(newFrame(skill, ref, "side", at));
		}
	};

	const update = (frame: MutableFrame, fields: StageFields): void => {
		const named = normalizeStage(fields.family, fields.stage);
		if (named === null || typeof fields.family !== "string") return;
		const sameStage = frame.family === fields.family && frame.stage === named;
		frame.family = fields.family;
		frame.stage = named;
		const n = countOf(fields.n);
		if (n !== undefined) frame.n = n;
		const total = countOf(fields.total);
		if (total !== undefined) frame.total = total;
		if (fields.unit !== undefined && STAGE_UNITS.includes(fields.unit)) frame.unit = fields.unit;
		if (typeof fields.done === "boolean") frame.done = fields.done;
		const plan = planRef(fields.ref);
		if (plan) frame.ref = plan;
		const given = Object.entries(fields.verdicts ?? {}).filter(
			([name, state]) => /^[a-z][a-z0-9-]{0,23}$/u.test(name) && VERDICT_STATES.includes(state),
		);
		frame.verdicts = Object.fromEntries(
			[...Object.entries(sameStage ? (frame.verdicts ?? {}) : {}), ...given].slice(-MAX_VERDICTS),
		);
		frame.at = at;
	};

	switch (event.type) {
		case "start":
			start(event.skill, event.ref, event.restart === true);
			break;
		case "continue": {
			const top = frames.at(-1);
			const spine = lastIndexWhere(frames, (frame) => frame.role === "spine");
			const spineFrame = spine === -1 ? undefined : frames[spine];
			if (top?.role === "side" && spineFrame) {
				closeAbove(spine, "side.done");
				activate(spineFrame);
			}
			break;
		}
		case "move": {
			const target =
				event.scope === "nearest"
					? frames[lastIndexWhere(frames, (frame) => frame.family === event.family && frame.stage === event.stage)]
					: frames.at(-1);
			if (target && target.family === event.family && (event.scope === "nearest" || target.status === "active"))
				update(target, event);
			break;
		}
		case "record": {
			const top = frames.at(-1);
			if (top) update(top, event);
			else if (normalizeStage(event.family, event.stage) !== null) {
				const frame: MutableFrame = {
					skill: null,
					family: event.family ?? null,
					stage: null,
					role: "spine",
					status: "active",
					verdicts: {},
					at,
				};
				update(frame, event);
				push(frame);
			}
			break;
		}
		default:
			break;
	}

	const last = frames.at(-1);
	if (last && last.status !== "active") activate(last);
	const history = [
		...(Array.isArray(stack?.history) ? stack.history : []),
		...transitions.map(({ type, skill }) => ({ event: type, skill, at })),
	].slice(-MAX_HISTORY);
	return { stack: { version: 1, sessionId: stack?.sessionId ?? null, frames, history }, transitions };
}

// ── Store ────────────────────────────────────────────────────────────────────

export function stackPath(cwd: string, sessionId: string): string | null {
	const id = normalizeSessionId(sessionId);
	if (id === null || !isAbsolute(cwd)) return null;
	return join(cwd, STACK_DIR, `${id}.json`);
}

function wellFormedFrame(value: unknown): value is StackFrame {
	if (typeof value !== "object" || value === null) return false;
	const frame = value as { skill?: unknown; role?: unknown; status?: unknown; at?: unknown; verdicts?: unknown };
	return (
		(frame.skill === null || typeof frame.skill === "string") &&
		(frame.role === "spine" || frame.role === "side") &&
		(frame.status === "active" || frame.status === "paused") &&
		typeof frame.at === "string" &&
		Number.isFinite(Date.parse(frame.at)) &&
		typeof frame.verdicts === "object" &&
		frame.verdicts !== null
	);
}

/** The session's stack; a link, a non-file, an oversized or malformed file reads as empty. */
export function readStack(cwd: string, sessionId: string): WorkflowStack {
	const empty = emptyStack(sessionId);
	const path = stackPath(cwd, sessionId);
	if (path === null) return empty;
	let fd: number | null = null;
	try {
		if (!plainDirsOrMissing(cwd, STACK_DIR)) return empty;
		fd = openRegularFile(path);
		if (fd === null) return empty;
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > MAX_STACK_BYTES) return empty;
		const buffer = Buffer.alloc(stat.size);
		const read = readSync(fd, buffer, 0, stat.size, 0);
		const parsed: unknown = JSON.parse(buffer.subarray(0, read).toString("utf8"));
		const record = parsed as { frames?: unknown; history?: unknown } | null;
		if (!record || !Array.isArray(record.frames) || record.frames.length > MAX_FRAMES) return empty;
		if (!record.frames.every(wellFormedFrame)) return empty;
		const history = Array.isArray(record.history) ? (record.history as StackHistoryEntry[]).slice(-MAX_HISTORY) : [];
		return { ...empty, frames: record.frames as StackFrame[], history };
	} catch {
		return empty;
	} finally {
		if (fd !== null) closeSync(fd);
	}
}

/** Write the whole stack through a temporary file; a link at the destination is replaced, never followed. */
export function writeStack(cwd: string, sessionId: string, stack: WorkflowStack): void {
	const path = stackPath(cwd, sessionId);
	if (path === null) return;
	try {
		if (!plainDirsOrMissing(cwd, STACK_DIR)) return;
		mkdirSync(join(cwd, STACK_DIR), { recursive: true });
		const stat = lstatSync(join(cwd, STACK_DIR));
		if (!stat.isDirectory()) return;
		writeFileAtomic(path, `${JSON.stringify(stack)}\n`);
	} catch {
		// The card shows the last good stack; a hook never fails because of it.
	}
}

/** Read, apply one event and write back; returns the transitions it made. Never throws. */
export function recordStackEvent(
	cwd: string,
	sessionId: string,
	event: StackEvent,
	now: Date = new Date(),
): { stack: WorkflowStack; transitions: StackTransition[] } {
	try {
		const result = applyStackEvent({ ...readStack(cwd, sessionId), sessionId }, event, now);
		writeStack(cwd, sessionId, result.stack);
		return result;
	} catch {
		return { stack: emptyStack(sessionId), transitions: [] };
	}
}

/** Another session of the project counts as live while its stack was written this recently. */
export const OTHER_SESSION_MS = 15 * 60 * 1000;
const MAX_OTHER_SESSIONS = 6;
const MAX_OTHER_FILES = 24;

/** A finished start-work run stays on other sessions' views this long, then leaves. */
export const FINISHED_WORK_MS = 60_000;

export interface OtherStack {
	readonly id: string;
	readonly frames: readonly StackFrame[];
	/** The newest time any of its frames moved. */
	readonly at: number;
	/** What the session's liveness record says now (`ended` records are left out), or null without one. */
	readonly liveness: "alive" | "idle" | null;
	readonly pane: string | null;
}

/** Running first, then idle, then the rest (paused, done, or silent). */
function otherRank(other: OtherStack): number {
	const top = other.frames.at(-1);
	if (other.liveness === "idle") return 1;
	if (top?.done === true || top?.status === "paused") return 2;
	return other.liveness === "alive" || other.liveness === null ? 0 : 2;
}

/**
 * The stacks of the project's other sessions that moved within OTHER_SESSION_MS, or whose liveness record is
 * still fresh, running first, then idle, then the rest, newest first within each. A start-work run that
 * finished leaves after FINISHED_WORK_MS. It only reads: a link, an oversized or malformed file reads as
 * empty, and an older session is simply dropped.
 */
export function readOtherStacks(cwd: string, selfId: string, now: number = Date.now()): OtherStack[] {
	try {
		const own = normalizeSessionId(selfId);
		if (!isAbsolute(cwd) || !plainDirs(cwd, STACK_DIR)) return [];
		const lives = new Map(
			readSessionsLiveness(cwd, now)
				.filter((record) => record.state !== "ended")
				.map((record) => [normalizeSessionId(record.sessionId), record] as const),
		);
		const found: OtherStack[] = [];
		const names = readdirSync(join(cwd, STACK_DIR))
			.filter((name) => name.endsWith(".json"))
			.sort()
			.slice(0, MAX_OTHER_FILES);
		for (const name of names) {
			const id = name.slice(0, -".json".length);
			if (normalizeSessionId(id) !== id || id === own) continue;
			const frames = readStack(cwd, id).frames;
			const at = Math.max(0, ...frames.map((frame) => Date.parse(frame.at)));
			const live = lives.get(id);
			const top = frames.at(-1);
			if (top === undefined || (now - at > OTHER_SESSION_MS && live === undefined)) continue;
			if (top.skill === "start-work" && top.done === true && now - at > FINISHED_WORK_MS) continue;
			found.push({
				id,
				frames,
				at: Math.max(at, live?.at ?? 0),
				liveness: live === undefined ? null : (live.state as "alive" | "idle"),
				pane: live?.herdrPane ?? null,
			});
		}
		return found
			.sort((a, b) => otherRank(a) - otherRank(b) || b.at - a.at || a.id.localeCompare(b.id))
			.slice(0, MAX_OTHER_SESSIONS);
	} catch {
		return [];
	}
}

// ── Reading a stack back ─────────────────────────────────────────────────────

/** The frame a bare `lit continue` should resume: the nearest spine below a side frame, else null. */
export function pausedSpine(stack: WorkflowStack): StackFrame | null {
	const top = stack.frames.at(-1);
	if (!top || top.role !== "side") return null;
	const spine = stack.frames[lastIndexWhere(stack.frames, (frame) => frame.role === "spine")];
	return spine && spine.status === "paused" ? spine : null;
}

/**
 * `[▉▉▉░░] 3/5` when both counts are real, otherwise null. A count with no total is never drawn as a
 * placeholder gauge: callers say what is known in words (`frameNote`) instead.
 */
export function stackGauge(frame: Pick<StackFrame, "n" | "total">): string | null {
	const { n, total } = frame;
	if (n === undefined || total === undefined || total <= 0) return null;
	return `${gaugeBar(Math.min(n, total), total)} ${n}/${total}`;
}

/** Up to ten cells; a larger total is scaled down so the bar never grows past ten. */
export function gaugeBar(done: number, total: number): string {
	const cells = Math.min(10, Math.max(1, total));
	const filled = total <= 0 ? 0 : Math.min(cells, Math.round((done / total) * cells));
	return `[${"▉".repeat(filled)}${"░".repeat(cells - filled)}]`;
}

/** What a frame knows when it has no real gauge, in words: `step 2`, or an empty string. */
export function frameNote(frame: Pick<StackFrame, "n" | "total">): string {
	return stackGauge(frame) === null && frame.n !== undefined ? `step ${frame.n}` : "";
}

/** One frame as a short label: `lit-loop WORK [▉▉░░░] 2/5`, or `lit-loop WORK step 2` without a total. */
export function frameLabel(frame: StackFrame): string {
	const name = frame.skill ?? frame.family ?? "work";
	const stage = frame.stage ? ` ${frame.stage}` : "";
	const counted = stackGauge(frame) ?? frameNote(frame);
	return `${name}${stage}${counted === "" ? "" : ` ${counted}`}`;
}

/** `lit-loop ‖ > lit-brainstorm`: paused frames, then the running one after `>`; null for one frame or none. */
export function breadcrumb(stack: WorkflowStack): string | null {
	const frames = stack.frames;
	if (frames.length < 2) return null;
	const names = frames.map((frame) => frame.skill ?? frame.family ?? "work");
	const head = names.slice(0, -1).join(" ‖ ");
	return `${head} ‖ > ${names.at(-1)}`;
}

/**
 * The stack as one card row: paused frames with their stage and gauge, then the running frame after `>`,
 * then the way back. Null while there is a single frame or none, since the map already shows that.
 */
export function stackRow(stack: WorkflowStack): string | null {
	if (stack.frames.length < 2) return null;
	const labels = stack.frames.map((frame) => frameLabel(frame));
	const running = labels.pop();
	const paused = labels.join(" ‖ ");
	return `⏸ ${paused} ‖ ▶ ${running} · back: lit continue`;
}
