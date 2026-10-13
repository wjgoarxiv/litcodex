// src/workflow-map.ts — the plain-text LIT workflow map.
//
// Codex shows a hook `systemMessage` as plain text (escape codes appear literally), so the map uses
// emoji and block cells instead of colour. It is built from saved state only: the start-work record
// and its plan checkboxes, lit-loop goals, the lit-plan activation record and the litresearch
// journal. A stage with no saved signal is left out rather than guessed. Every read fails open.

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { LIT_LOOP_DIR, LIT_LOOP_GOALS, normalizeSessionId } from "./state-paths.js";

type Stage = "interview" | "plan" | "work" | "review" | "done";

const STAGES: readonly (readonly [Stage, string, string])[] = [
	["interview", "🧭", "INTERVIEW"],
	["plan", "📝", "PLAN"],
	["work", "🔨", "WORK"],
	["review", "🔍", "REVIEW"],
	["done", "🏁", "DONE"],
];

/** Where each LIT skill sits in the main chain; `research` is its own short family. */
const MODE_STAGE: Readonly<Record<string, Stage | "research">> = {
	"deep-interview": "interview",
	"lit-crucible": "interview",
	"lit-plan": "plan",
	litgoal: "plan",
	"start-work": "work",
	litwork: "work",
	"lit-loop": "work",
	"review-work": "review",
	litresearch: "research",
};

const MAX_STATE_BYTES = 1_000_000;
const MAX_TITLE = 48;
const BAR_CELLS = 10;
const TURN_DIR = ".litcodex/workflow-map";
const RESEARCH_DIR = `${LIT_LOOP_DIR}/litresearch`;
/** An unfinished journal older than this belongs to research the user has moved on from. */
const RESEARCH_STALE_MS = 24 * 60 * 60 * 1000;
/** The start-work continuation hook stops reading a transcript past this size and stays quiet. */
const MAX_TRANSCRIPT_BYTES = 2_000_000;
const CONTEXT_ERROR_CODES = new Set(["context_length_exceeded", "context_too_large"]);
const MIN_TITLE_WORDS = 3;

interface Progress {
	readonly done: number;
	readonly total: number;
	readonly next: string | null;
}

/** Where an unfinished research journal stands: the highest wave written and whether verification began. */
interface ResearchProgress {
	readonly wave: number | null;
	readonly verifying: boolean;
}

export interface WorkflowSignals {
	readonly work: (Progress & { readonly status: "active" | "paused" | "completed" }) | null;
	readonly goals: Progress | null;
	readonly plan: "drafting" | "published" | null;
	readonly research: ResearchProgress | null;
}

/** What the Stop event says about the host's own continuation state. */
export interface StopContext {
	readonly stopHookActive: boolean;
	readonly transcriptPath: string | null;
}

const NO_SIGNALS: WorkflowSignals = { work: null, goals: null, plan: null, research: null };
const NO_STOP_CONTEXT: StopContext = { stopHookActive: false, transcriptPath: null };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a small regular file (never a symlink); null on any failure. */
function readJson(path: string): unknown {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.size > MAX_STATE_BYTES) return null;
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function readText(path: string): string | null {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.size > MAX_STATE_BYTES) return null;
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/**
 * Checkbox rows the way start-work counts them: fenced blocks are skipped, and when the plan has a
 * `## Todos` or `## Final verification wave` section only rows inside those sections count.
 */
export function countPlanRows(markdown: string): Progress {
	const rows = planRows(markdown);
	return {
		done: rows.filter((row) => row.done).length,
		total: rows.length,
		next: rows.find((row) => !row.done)?.label ?? null,
	};
}

/** The counted checkbox rows in order, as start-work reads them. */
function planRows(markdown: string): { readonly done: boolean; readonly label: string }[] {
	const lines = markdown.split(/\r?\n/);
	const visible: string[] = [];
	let fence: { marker: string; length: number } | null = null;
	for (const line of lines) {
		if (fence !== null) {
			const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
			if (closing?.[1]?.[0] === fence.marker && closing[1].length >= fence.length) fence = null;
			continue;
		}
		const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
		if (opening?.[1] !== undefined) {
			fence = { marker: opening[1][0] ?? "`", length: opening[1].length };
			continue;
		}
		visible.push(line);
	}
	const section = (line: string): boolean | null => {
		if (!line.startsWith("## ") || line.startsWith("### ")) return null;
		const heading = line.slice(3).replace(/\s+/g, " ").trim().toLowerCase();
		return (
			heading === "todos" || heading === "final verification wave" || heading.startsWith("final verification wave ")
		);
	};
	const sectioned = visible.some((line) => section(line) === true);
	let inside = !sectioned;
	const rows: { done: boolean; label: string }[] = [];
	for (const line of visible) {
		const heading = section(line);
		if (heading !== null) inside = heading;
		if (!inside) continue;
		const match = line.match(/^- \[([ xX])\] (.*)$/s);
		const label = (match?.[2] ?? "").replace(/\s+/g, " ").trim();
		if (match === null || label.length === 0) continue;
		rows.push({ done: match[1] !== " ", label });
	}
	return rows;
}

/** One cell per task, at most ten; a partly done plan never draws as full or empty. */
export function progressBar(done: number, total: number): string {
	const cells = Math.min(total, BAR_CELLS);
	let filled = total === 0 ? 0 : Math.round((done / total) * cells);
	if (done > 0 && filled === 0) filled = 1;
	if (done < total && filled === cells) filled = cells - 1;
	return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

/** A path, code span, variable or flag: the first one ends a title, since nothing after it is shown. */
function isTechnical(word: string): boolean {
	return /[/\\`]/u.test(word) || /^--?[\p{L}\d]/u.test(word) || /^\$[\p{L}_{(]/u.test(word) || word.startsWith("~");
}

/**
 * A task title without its row number, cut at the first code span, path, variable or flag and marked
 * with `…`. Deleting those words mid-sentence reads oddly, so the title stops there instead; a title
 * with fewer than three words left before the cut is dropped.
 */
export function safeTitle(label: string): string | null {
	const words = label
		.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
		.replace(/^(?:F?\d+\.\s+)/iu, "")
		.split(/\s+/u)
		.filter((word) => word.length > 0);
	const cut = words.findIndex(isTechnical);
	if (cut === 0) return null;
	if (cut > 0 && cut < MIN_TITLE_WORDS) return null;
	const title = (cut < 0 ? words : words.slice(0, cut)).join(" ").replace(/[\s,:;(—–-]+$/u, "");
	if (title.length === 0) return null;
	if (title.length > MAX_TITLE) return `${title.slice(0, MAX_TITLE - 1)}…`;
	return cut < 0 ? title : `${title} …`;
}

function readWork(repoRoot: string, sessionId: string | null): WorkflowSignals["work"] {
	const state = readJson(join(repoRoot, ".litcodex/start-work/state.json"));
	if (!isRecord(state) || !isRecord(state["works"])) return null;
	const works = Object.values(state["works"]).filter(isRecord);
	const activeId = state["active_work_id"];
	let work = works.find(
		(entry) => entry["work_id"] === activeId && (entry["status"] === "active" || entry["status"] === "paused"),
	);
	if (work === undefined && sessionId !== null) {
		// A finished plan belongs to the session that ran it, so an old one never shows in a new session.
		const mine = works.filter(
			(entry) =>
				entry["status"] === "completed" &&
				Array.isArray(entry["session_ids"]) &&
				entry["session_ids"].includes(`codex:${sessionId}`),
		);
		const at = (entry: Record<string, unknown>): string => {
			const last = entry["last_transition"];
			return isRecord(last) && typeof last["at"] === "string" ? last["at"] : "";
		};
		work = mine.sort((a, b) => at(b).localeCompare(at(a)))[0];
	}
	if (work === undefined || typeof work["active_plan"] !== "string") return null;
	const file = basename(work["active_plan"]);
	if (!file.endsWith(".md")) return null;
	const text = readText(join(repoRoot, ".litcodex/plans", file));
	if (text === null) return null;
	const rows = countPlanRows(text);
	if (rows.total === 0) return null;
	return { ...rows, status: work["status"] as "active" | "paused" | "completed" };
}

function goalProgress(path: string): Progress | null {
	const plan = readJson(path);
	if (!isRecord(plan) || !Array.isArray(plan["goals"])) return null;
	const goals = plan["goals"].filter(isRecord);
	if (goals.length === 0) return null;
	const open =
		goals.find((goal) => goal["status"] === "in_progress") ?? goals.find((goal) => goal["status"] === "pending");
	return {
		done: goals.filter((goal) => goal["status"] === "complete").length,
		total: goals.length,
		next: typeof open?.["title"] === "string" ? open["title"] : null,
	};
}

function readGoals(repoRoot: string, sessionId: string | null): Progress | null {
	if (sessionId !== null) {
		const scoped = goalProgress(join(repoRoot, LIT_LOOP_DIR, sessionId, LIT_LOOP_GOALS));
		if (scoped !== null) return scoped;
	}
	const shared = goalProgress(join(repoRoot, LIT_LOOP_DIR, LIT_LOOP_GOALS));
	return shared !== null && shared.done < shared.total ? shared : null;
}

function readPlanRecord(repoRoot: string, sessionId: string | null): WorkflowSignals["plan"] {
	if (sessionId === null) return null;
	const record = readJson(join(repoRoot, ".litcodex/lit-plan", `${sessionId}.json`));
	if (!isRecord(record) || typeof record["satisfied"] !== "boolean") return null;
	return record["satisfied"] ? "published" : "drafting";
}

/** The newest research journal by its last write, with the names of the files in it. */
function newestJournal(repoRoot: string): { readonly files: readonly string[]; readonly mtime: number } | null {
	const root = join(repoRoot, RESEARCH_DIR);
	try {
		let newest: { files: string[]; mtime: number } | null = null;
		for (const name of readdirSync(root)) {
			if (name.startsWith(".")) continue;
			const dir = join(root, name);
			if (!lstatSync(dir).isDirectory()) continue;
			const files = readdirSync(dir);
			const mtime = Math.max(statSync(dir).mtimeMs, ...files.map((file) => lstatSync(join(dir, file)).mtimeMs));
			if (newest === null || mtime > newest.mtime) newest = { files, mtime };
		}
		return newest;
	} catch {
		return null;
	}
}

function highestWave(files: readonly string[]): number | null {
	const waves = files.map((name) => name.match(/^wave-(\d+)-/)?.[1]).filter((wave) => wave !== undefined);
	return waves.length === 0 ? null : Math.max(...waves.map(Number));
}

/**
 * Progress of research still under way: the newest journal, unless it already holds `SYNTHESIS.md` or
 * nothing was written to it for a day, in which case a new research starts at decomposition.
 */
function readResearch(repoRoot: string, now: number): ResearchProgress | null {
	const journal = newestJournal(repoRoot);
	if (journal === null || now - journal.mtime > RESEARCH_STALE_MS || journal.files.includes("SYNTHESIS.md")) {
		return null;
	}
	return {
		wave: highestWave(journal.files),
		verifying: journal.files.some((name) => /^verify-.+\.md$/u.test(name)),
	};
}

export function readWorkflowSignals(repoRoot: string, sessionId: string | null, now = Date.now()): WorkflowSignals {
	if (typeof repoRoot !== "string" || !isAbsolute(repoRoot)) return NO_SIGNALS;
	const id = normalizeSessionId(sessionId);
	return {
		work: readWork(repoRoot, id),
		goals: readGoals(repoRoot, id),
		plan: readPlanRecord(repoRoot, id),
		research: readResearch(repoRoot, now),
	};
}

function stageFromState(signals: WorkflowSignals): { index: number; active: boolean } | null {
	if (signals.work?.status === "completed") return { index: 4, active: true };
	if (signals.work !== null || signals.goals !== null) return { index: 2, active: true };
	if (signals.plan === "drafting") return { index: 1, active: true };
	if (signals.plan === "published") return { index: 2, active: false };
	return null;
}

/** The research family: decompose › waves (the first, then expansion) › verify › synthesis. */
function researchMap(research: ResearchProgress | null): string {
	if (research === null || (research.wave === null && !research.verifying)) return "🔎 DECOMPOSE › 🌊 · › 🔬 · › 🏁 ·";
	const { wave } = research;
	if (!research.verifying) {
		return `🔎 ✓ › 🌊 WAVE ${wave}${wave !== null && wave > 1 ? " EXPAND" : ""} › 🔬 · › 🏁 ·`;
	}
	const waves = wave === null ? "" : ` › 🌊 ✓ ${wave} wave${wave === 1 ? "" : "s"}`;
	return `🔎 ✓${waves} › 🔬 VERIFY › 🏁 ·`;
}

/** One map line, or null when there is nothing true to draw. Plain text: emoji and block cells only. */
export function renderWorkflowMap(mode: string | null, signals: WorkflowSignals): string | null {
	const fromMode = mode === null ? undefined : MODE_STAGE[mode];
	if (fromMode === "research") return researchMap(signals.research);
	const position =
		fromMode === undefined
			? stageFromState(signals)
			: { index: STAGES.findIndex(([stage]) => stage === fromMode), active: true };
	if (position === null) return null;
	const { work } = signals;
	const progress = work ?? signals.goals;
	const planKnown = work !== null || signals.plan === "published";
	const workFinished = work !== null && (work.status === "completed" || work.done === work.total);
	const cells: string[] = [];
	STAGES.forEach(([stage, icon, label], index) => {
		if (index > position.index || (index === position.index && !position.active)) {
			cells.push(`${icon} ·`);
			return;
		}
		if (index === position.index) {
			const name = stage === "work" && work?.status === "paused" ? "PAUSED" : label;
			const bar =
				stage === "work" && progress !== null
					? ` ${progressBar(progress.done, progress.total)} ${progress.done}/${progress.total}`
					: "";
			cells.push(`${icon} ${name}${bar}`);
			return;
		}
		if (stage === "interview" || stage === "plan") {
			if (planKnown) cells.push(`${icon} ✓`);
		} else if (stage === "work") {
			if (workFinished) cells.push(`${icon} ✓`);
			else if (work !== null) cells.push(`${icon} ${progressBar(work.done, work.total)} ${work.done}/${work.total}`);
		} else if (stage === "review" && work?.status === "completed") {
			cells.push(`${icon} ✓`);
		}
	});
	return cells.join(" › ");
}

export function workflowMapLine(repoRoot: string, sessionId: string | null, mode: string | null): string | null {
	return renderWorkflowMap(mode, readWorkflowSignals(repoRoot, sessionId));
}

// ── Turn record: lets the Stop hook tell a LIT turn apart and count what it finished ──

interface TurnRecord {
	readonly version: 1;
	readonly turnId: string;
	readonly mode: string;
	readonly startedAt: number;
	readonly workDone: number | null;
	readonly goalsDone: number | null;
}

function turnPath(repoRoot: string, sessionId: string): string | null {
	const id = normalizeSessionId(sessionId);
	if (id === null || typeof repoRoot !== "string" || !isAbsolute(repoRoot)) return null;
	return join(repoRoot, TURN_DIR, `${id}.json`);
}

/** Remember that this turn is a LIT activation and where its progress started. Never throws. */
export function recordWorkflowTurn(
	repoRoot: string,
	sessionId: string,
	turnId: string,
	mode: string,
	now = Date.now(),
): void {
	const path = turnPath(repoRoot, sessionId);
	if (path === null || turnId.length === 0) return;
	const signals = readWorkflowSignals(repoRoot, sessionId);
	const record: TurnRecord = {
		version: 1,
		turnId,
		mode,
		startedAt: now,
		workDone: signals.work?.done ?? null,
		goalsDone: signals.goals?.done ?? null,
	};
	try {
		mkdirSync(join(repoRoot, TURN_DIR), { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(record)}\n`);
		renameSync(tmp, path);
	} catch {
		// Without the record the Stop hook simply stays quiet for this turn.
	}
}

function readTurn(path: string): TurnRecord | null {
	const record = readJson(path);
	if (
		!isRecord(record) ||
		record["version"] !== 1 ||
		typeof record["turnId"] !== "string" ||
		typeof record["mode"] !== "string" ||
		typeof record["startedAt"] !== "number"
	)
		return null;
	const count = (value: unknown): number | null => (typeof value === "number" ? value : null);
	return {
		version: 1,
		turnId: record["turnId"],
		mode: record["mode"],
		startedAt: record["startedAt"],
		workDone: count(record["workDone"]),
		goalsDone: count(record["goalsDone"]),
	};
}

/** Highest wave number in the newest research journal written since `since`, or null. */
function researchWave(repoRoot: string, since: number): number | null {
	const journal = newestJournal(repoRoot);
	return journal === null || journal.mtime < since ? null : highestWave(journal.files);
}

function isContextError(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const error =
		value["type"] === "error"
			? value["error"]
			: value["type"] === "message" && isRecord(value["payload"]) && isRecord(value["payload"]["content"])
				? value["payload"]["content"]["error"]
				: null;
	return isRecord(error) && CONTEXT_ERROR_CODES.has(String(error["code"]));
}

/** The transcript check the continuation hook makes: a missing path is clear; oversized, unparsable or full context is not. */
function transcriptClear(path: string | null): boolean {
	if (path === null || path.length === 0) return true;
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES) return false;
		for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
			if (line.length > 0 && isContextError(JSON.parse(line))) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * The plan start-work will carry on with after this Stop, or null when its continuation hook stays
 * quiet. It repeats that hook's decision read-only (host continuation flag, transcript, the one active
 * work this session owns with authority and open rows, and the lease that nudges each plan state once
 * per turn), so the answer is the same whichever Stop hook the host runs first.
 */
function continuingWork(repoRoot: string, sessionId: string, turnId: string, stop: StopContext): Progress | null {
	if (stop.stopHookActive || !transcriptClear(stop.transcriptPath)) return null;
	const state = readJson(join(repoRoot, ".litcodex/start-work/state.json"));
	if (!isRecord(state) || !isRecord(state["works"]) || typeof state["active_work_id"] !== "string") return null;
	const owner = `codex:${sessionId}`;
	const owned = Object.entries(state["works"]).filter(
		([id, work]) =>
			isRecord(work) &&
			work["work_id"] === id &&
			work["status"] === "active" &&
			Array.isArray(work["session_ids"]) &&
			work["session_ids"].includes(owner),
	);
	const [entry] = owned;
	if (owned.length !== 1 || entry === undefined || entry[0] !== state["active_work_id"]) return null;
	const work = entry[1] as Record<string, unknown>;
	const plan = work["active_plan"];
	if (!isRecord(work["authority"]) || typeof plan !== "string" || !/^\.litcodex\/plans\/[^/\\]+\.md$/u.test(plan)) {
		return null;
	}
	const text = readText(join(repoRoot, plan));
	if (text === null) return null;
	const rows = planRows(text);
	const done = rows.filter((row) => row.done).length;
	if (rows.length === 0 || done === rows.length) return null;
	const token = createHash("sha256")
		.update(JSON.stringify(rows.map((row) => [row.done ? 1 : 0, row.label])))
		.digest("hex");
	const lease = work["continuation_lease"];
	if (isRecord(lease) && lease["progress_token"] === token && lease["turn_id"] !== turnId) return null;
	return { done, total: rows.length, next: rows.find((row) => !row.done)?.label ?? null };
}

function counted(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"} ✓`;
}

/**
 * The Stop line for a LIT turn, or null when this turn was not a LIT activation. At a start-work
 * checkpoint the continuation hook keeps the turn going, so the line says so instead of "turn done".
 * No commands or paths.
 */
export function workflowStopLine(
	repoRoot: string,
	sessionId: string,
	turnId: string,
	stop: StopContext = NO_STOP_CONTEXT,
): string | null {
	const path = turnPath(repoRoot, sessionId);
	if (path === null) return null;
	const turn = readTurn(path);
	if (turn === null || turn.turnId !== turnId) return null;
	const continuing = continuingWork(repoRoot, sessionId, turnId, stop);
	if (continuing !== null) {
		const next = continuing.next === null ? null : safeTitle(continuing.next);
		const status = `⏳ ${continuing.done}/${continuing.total} tasks ✓ · continuing`;
		return next === null ? status : `${status} ▸ ${next}`;
	}
	const signals = readWorkflowSignals(repoRoot, sessionId);
	const parts = ["✨ turn done"];
	const progress = signals.work ?? signals.goals;
	if (progress !== null) {
		const unit = signals.work !== null ? "task" : "goal";
		const before = signals.work !== null ? turn.workDone : turn.goalsDone;
		if (before !== null && progress.done > before) parts.push(counted(progress.done - before, unit));
		if (progress.done >= progress.total) parts.push(`all ${progress.total} ${unit}s ✓`);
		else {
			const next = progress.next === null ? null : safeTitle(progress.next);
			if (next !== null) parts.push(`next ▸ ${next}`);
		}
	}
	if (turn.mode === "litresearch") {
		const wave = researchWave(repoRoot, turn.startedAt);
		if (wave !== null) parts.push(`🌊 wave ${wave}`);
	}
	return parts.join(" · ");
}
