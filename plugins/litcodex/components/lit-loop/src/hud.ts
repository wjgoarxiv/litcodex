// src/hud.ts — the LIT card for a second terminal window (`litcodex hud`).
//
// Every LIT session leaves a thread pointer in the Codex home (live-step.ts) naming its project folder, so
// the HUD can run from any directory. A pointer is written once per session, so the session to follow is
// the one with the newest LIT activity: the pointer time or the times its live step and workflow record
// carry, which the hooks rewrite on every prompt and tool. Files are re-parsed only after their `lstat`
// identity (inode, size, times) changes, so an idle HUD costs a few `lstat` calls a tick. The card itself is
// the one `cardStatusText` prints, read with `rollout: false` so no Codex rollout file is ever opened.
// Nothing here writes. A record that exists but cannot be read becomes one "cannot read" line instead
// of a quiet "ready". Record text is data: control characters and escapes are stripped before printing.

import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type CardStatus, cardStatusText, readCardStatus } from "./card-status.js";
import { clean, cleanDeep } from "./control-chars.js";
import {
	codexHomeFrom,
	liveStepPath,
	plainDirsOrMissing,
	readLiveStep,
	readSmallJson,
	readThreadPointer,
	threadPointerPath,
} from "./live-step.js";
import { LIT_LOOP_DIR, LIT_LOOP_GOALS, normalizeSessionId } from "./state-paths.js";
import { mapCellText, workflowMapText, workflowTurn } from "./workflow-map.js";

export { clean } from "./control-chars.js";

const POINTER_DIR = "litcodex/lit-loop/threads";
const MAX_LIVE_STEP_BYTES = 4_096;
/** The cap the workflow map itself reads its state files under. */
const MAX_STATE_BYTES = 1_000_000;
const SHORT_ID = 8;
/** Past this, the session is likely gone; the header says when it was last seen instead. */
const LAST_SEEN_MS = 10 * 60 * 1000;

export interface HudSession {
	readonly id: string;
	readonly cwd: string;
	readonly updatedAt: number;
	/** The newest LIT activity: the pointer time or a time the live step or workflow record carries. */
	readonly activeAt: number;
}

export interface HudView {
	/** What `--session` asked for, or null to follow the newest session. */
	readonly wanted: string | null;
	readonly session: { readonly id: string; readonly folder: string; readonly lastSeen: number } | null;
	readonly status: CardStatus | null;
	/** Records that exist but could not be read, named for the user. */
	readonly unreadable: readonly string[];
	/** How many sessions `wanted` matched when it named more than one. */
	readonly matches?: number;
}

export interface HudRenderOptions {
	readonly width: number;
	readonly color: boolean;
	/** The terminal takes 24-bit colour; only then does the first line carry the LIT pill. */
	readonly truecolor?: boolean;
	readonly now: number;
}

/** Parsed files keyed by reader and path, kept while the file's `lstat` identity stays the same. */
const parsed = new Map<string, { readonly key: string; readonly value: unknown }>();

/** `read()` for `path`, re-run only when the file's inode, size or times changed since `reader` last read it. */
function cachedRead<T>(reader: string, path: string, read: () => T): T {
	let key: string;
	try {
		const stat = lstatSync(path, { throwIfNoEntry: false });
		key = stat === undefined ? "missing" : `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
	} catch {
		return read();
	}
	const slot = `${reader}\0${path}`;
	const hit = parsed.get(slot);
	if (hit !== undefined && hit.key === key) return hit.value as T;
	const value = read();
	parsed.set(slot, { key, value });
	return value;
}

function mtimeOf(path: string): number {
	try {
		return lstatSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
	} catch {
		return 0;
	}
}

/** The newest time the session's live step or workflow record carries; null when neither has one. */
function activityAt(cwd: string, id: string): number | null {
	const stepPath = liveStepPath(cwd, id);
	const step = stepPath === null ? null : cachedRead("live step", stepPath, () => readLiveStep(cwd, id));
	const turn = cachedRead("turn", join(cwd, ".litcodex/workflow-map", `${id}.json`), () => workflowTurn(cwd, id));
	const times = [step?.turnStartedAt, step?.turnEndedAt, step?.startedAt, step?.endedAt, turn?.startedAt];
	const known = times.filter((time): time is number => typeof time === "number");
	return known.length === 0 ? null : Math.max(...known);
}

interface Scan {
	readonly sessions: (HudSession & { readonly pointerMtime: number })[];
	/** The newest file time among pointers that could not be read; null when every pointer read. */
	readonly brokenAt: number | null;
}

function scanPointers(env: NodeJS.ProcessEnv): Scan {
	const home = codexHomeFrom(env);
	if (home === null) return { sessions: [], brokenAt: null };
	if (!plainDirsOrMissing(home, POINTER_DIR)) return { sessions: [], brokenAt: Number.POSITIVE_INFINITY };
	let names: string[];
	try {
		names = readdirSync(join(home, POINTER_DIR)).filter((name) => name.endsWith(".json"));
	} catch (error) {
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		return { sessions: [], brokenAt: missing ? null : Number.POSITIVE_INFINITY };
	}
	const sessions: Scan["sessions"] = [];
	let brokenAt: number | null = null;
	for (const name of names) {
		const id = name.slice(0, -".json".length);
		const path = threadPointerPath(env, id);
		if (path === null || normalizeSessionId(id) !== id) continue;
		const pointer = cachedRead("pointer", path, () => readThreadPointer(env, id));
		const pointerMtime = mtimeOf(path);
		if (pointer === null) {
			brokenAt = Math.max(brokenAt ?? 0, pointerMtime);
			continue;
		}
		const activity = activityAt(pointer.cwd, id);
		const activeAt = Math.max(pointer.updatedAt, activity ?? pointer.updatedAt);
		sessions.push({ id, cwd: pointer.cwd, updatedAt: pointer.updatedAt, activeAt, pointerMtime });
	}
	sessions.sort((a, b) => b.activeAt - a.activeAt || a.id.localeCompare(b.id));
	return { sessions, brokenAt };
}

/** Every session with a readable pointer, newest LIT activity first. */
export function listSessions(env: NodeJS.ProcessEnv): HudSession[] {
	return scanPointers(env).sessions.map(({ id, cwd, updatedAt, activeAt }) => ({ id, cwd, updatedAt, activeAt }));
}

function choose<T extends HudSession>(
	sessions: readonly T[],
	wanted: string | null | undefined,
): { session: T | null; matches: number } {
	if (wanted === null || wanted === undefined || wanted === "") {
		const newest = sessions[0] ?? null;
		return { session: newest, matches: newest === null ? 0 : 1 };
	}
	const exact = sessions.find((session) => session.id === wanted);
	if (exact !== undefined) return { session: exact, matches: 1 };
	const found = sessions.filter((session) => session.id.startsWith(wanted));
	return { session: found.length === 1 ? (found[0] ?? null) : null, matches: found.length };
}

/** The most recently active session, or the one `wanted` names by exact id or unique prefix; else null. */
export function pickSession(env: NodeJS.ProcessEnv, wanted?: string | null): HudSession | null {
	return choose(listSessions(env), wanted).session;
}

/** True when a record exists at `base/rel/name` but is not a small, regular, parseable file. */
function unreadableRecord(base: string, rel: string, name: string, maxBytes: number): boolean {
	if (!plainDirsOrMissing(base, rel)) return true;
	const path = join(base, rel, name);
	try {
		const stat = lstatSync(path, { throwIfNoEntry: false });
		if (stat === undefined) return false;
		if (!stat.isFile() || stat.size > maxBytes) return true;
	} catch {
		return true;
	}
	return cachedRead(`unreadable ${maxBytes}`, path, () => readSmallJson(path, maxBytes) === null);
}

/** Every record the card reads, with the name the "cannot read" line gives it. */
function recordsOf(id: string): readonly (readonly [string, string, string, number])[] {
	return [
		["live step", ".litcodex/live-step", `${id}.json`, MAX_LIVE_STEP_BYTES],
		["workflow record", ".litcodex/workflow-map", `${id}.json`, MAX_STATE_BYTES],
		["start-work state", ".litcodex/start-work", "state.json", MAX_STATE_BYTES],
		["session goals", `${LIT_LOOP_DIR}/${id}`, LIT_LOOP_GOALS, MAX_STATE_BYTES],
		["shared goals", LIT_LOOP_DIR, LIT_LOOP_GOALS, MAX_STATE_BYTES],
		["lit-plan record", ".litcodex/lit-plan", `${id}.json`, MAX_STATE_BYTES],
	];
}

function unreadableRecords(cwd: string, id: string): string[] {
	if (!plainDirsOrMissing(cwd, ".litcodex")) return ["project records (.litcodex)"];
	return recordsOf(id)
		.filter(([, rel, name, maxBytes]) => unreadableRecord(cwd, rel, name, maxBytes))
		.map(([label]) => label);
}

function tilde(path: string, home: string | undefined): string {
	if (home === undefined || home === "" || home === "/") return path;
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
	// Windows paths use `\`; the HUD shows the shortened path with `/`.
	return path.startsWith(`${home}\\`) ? `~${path.slice(home.length).replace(/\\/gu, "/")}` : path;
}

/** Everything one frame needs, read once. Never throws and never writes. */
export function readHud(env: NodeJS.ProcessEnv, wanted: string | null, now: number): HudView {
	try {
		const { sessions, brokenAt } = scanPointers(env);
		const { session, matches } = choose(sessions, wanted);
		if (session === null) {
			return {
				wanted,
				session: null,
				status: null,
				unreadable: brokenAt !== null ? ["session pointer"] : [],
				matches,
			};
		}
		const status = readCardStatus(session.id, env, now, { rollout: false });
		const lastSeen = Math.min(now, session.activeAt);
		// A broken pointer written after the chosen one may be the session the user is actually in.
		const pointer = brokenAt !== null && brokenAt > session.pointerMtime ? ["session pointer"] : [];
		const unreadable = [...pointer, ...unreadableRecords(session.cwd, session.id)];
		return {
			wanted,
			session: { id: session.id, folder: tilde(session.cwd, env["HOME"]), lastSeen },
			status,
			unreadable,
		};
	} catch {
		return { wanted, session: null, status: null, unreadable: ["LIT records"] };
	}
}

/** The card with every record-derived string stripped of control characters. */
export function cleanStatus(status: CardStatus): CardStatus {
	return cleanDeep(status);
}

const MARK = /^\p{M}$/u;
const WIDE_EMOJI = /^\p{Emoji_Presentation}$/u;

function charWidth(char: string): number {
	const code = char.codePointAt(0) ?? 0;
	if (MARK.test(char) || (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f)) return 0;
	if (WIDE_EMOJI.test(char)) return 2;
	if (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x20000 && code <= 0x3fffd)
	)
		return 2;
	return 1;
}

/** The string as terminal cells; a narrow character followed by U+FE0F (emoji presentation) takes two. */
export function cells(text: string): { text: string; width: number }[] {
	const out: { text: string; width: number }[] = [];
	for (const char of text) {
		const previous = out.at(-1);
		if (char === "\ufe0f" && previous !== undefined) {
			previous.text += char;
			previous.width = Math.max(previous.width, 2);
			continue;
		}
		out.push({ text: char, width: charWidth(char) });
	}
	return out;
}

/** Terminal cells a plain string takes: CJK and emoji take two, combining marks none. */
export function displayWidth(text: string): number {
	return cells(text).reduce((sum, cell) => sum + cell.width, 0);
}

/** The line cut to `width` terminal cells, ending in `…` when anything was cut. */
export function fit(line: string, width: number): string {
	if (displayWidth(line) <= width) return line;
	let out = "";
	let used = 0;
	for (const cell of cells(line)) {
		if (used + cell.width > width - 1) break;
		out += cell.text;
		used += cell.width;
	}
	return `${out}…`;
}

function age(lastSeen: number, now: number): string {
	const seconds = Math.max(0, Math.floor((now - lastSeen) / 1000));
	if (now - lastSeen > LAST_SEEN_MS) return `last seen ${Math.floor(seconds / 60)} min ago`;
	return seconds < 60 ? `updated ${seconds}s ago` : `updated ${Math.floor(seconds / 60)} min ago`;
}

export const BOLD = "\u001b[1m";
export const DIM = "\u001b[2m";
export const RESET = "\u001b[0m";
const AMBER_FG = "\u001b[38;2;255;175;60m";
const GREEN_FG = "\u001b[38;2;107;219;143m";
/** 256-colour codes, one per cell: red, orange, yellow, green, cyan, blue, violet, pink. */
export const RAINBOW = [203, 209, 221, 114, 80, 75, 141, 205];

/** One line tinted cell by cell through the rainbow; still, never animated. */
function rainbowLine(line: string): string {
	let index = 0;
	let out = BOLD;
	for (const cell of cells(line)) {
		if (cell.text === " ") out += cell.text;
		else out += `\u001b[38;5;${RAINBOW[index++ % RAINBOW.length]}m${cell.text}`;
	}
	return `${out}${RESET}`;
}

export const BRAND = "🔥 LIT";
export const PILL_TEXT = ` ${BRAND} `;
/** Chrome stops 1 and 4 of the LitCodex palette in the LitFamily synthwave spec. */
export const PILL_STOPS: readonly [readonly [number, number, number], readonly [number, number, number]] = [
	[0x7c, 0xf5, 0xb0],
	[0xa7, 0xf3, 0xd0],
];
export const PILL_INK = "\u001b[1m\u001b[38;2;11;14;20m";

/** The LIT pill: dark bold ink on a mint gradient background, one colour step per cell. Truecolor only. */
export function litPill(): string {
	const pieces = cells(PILL_TEXT);
	const [start, end] = PILL_STOPS;
	let out = `${RESET}${PILL_INK}`;
	pieces.forEach((cell, index) => {
		const t = pieces.length === 1 ? 0 : index / (pieces.length - 1);
		const channel = (k: 0 | 1 | 2): number => Math.round(start[k] + (end[k] - start[k]) * t);
		out += `\u001b[48;2;${channel(0)};${channel(1)};${channel(2)}m${cell.text}`;
	});
	return `${out}${RESET}`;
}

/** The first line with the pill in front, or null when pill plus a cut line cannot fit `width`. */
function withPill(line: string, style: string, width: number): string | null {
	const pillWidth = displayWidth(PILL_TEXT);
	const rest = line.startsWith(BRAND) ? line.slice(BRAND.length).trimStart() : line;
	const room = width - pillWidth;
	if (room < 2) return null;
	const tail = fit(rest, room);
	return `${litPill()}${style}${tail}${RESET}`;
}

/** One line of the card before it is cut to a width. */
export interface HudLine {
	readonly text: string;
	readonly style: string;
	readonly rainbow?: boolean;
	/** Where the current stage's name stands in `text`, as a string slice. */
	readonly stage?: readonly [start: number, end: number];
}

/** The map line and the current stage's place in it. */
function mapLine(status: CardStatus): { text: string; stage: readonly [number, number] } | null {
	const current = status.map?.cells.findIndex((cell) => cell.state === "current") ?? -1;
	const cell = status.map?.cells[current];
	if (status.map === null || cell === undefined) return null;
	const before = status.map.cells.slice(0, current).map((item) => `${mapCellText(item)} › `);
	const start = before.join("").length;
	return {
		text: workflowMapText(status.map),
		stage: [start, start + `${cell.icon} ${cell.label ?? cell.word.toUpperCase()}`.length],
	};
}

/** The header, the card, and at most one "cannot read" line, uncut and in plain text. Pure. */
export function hudLines(view: HudView, now: number): HudLine[] {
	const lines: HudLine[] = [];
	if ((view.session === null || view.status === null) && view.wanted !== null && (view.matches ?? 0) > 1) {
		lines.push({ text: "🔥 LIT · which session?", style: BOLD });
		lines.push({
			text: `--session ${clean(view.wanted)} matches ${view.matches} sessions; give more of the id`,
			style: DIM,
		});
	} else if (view.session === null || view.status === null) {
		lines.push({ text: "🔥 LIT · waiting for a LIT session", style: BOLD });
		lines.push({
			text:
				view.wanted === null
					? "Start `codex` in a project and type `lit <task>`."
					: `waiting for session ${clean(view.wanted)}`,
			style: DIM,
		});
	} else {
		const { id, folder, lastSeen } = view.session;
		lines.push({ text: `${id.slice(0, SHORT_ID)} · ${clean(folder)} · ${age(lastSeen, now)}`, style: DIM });
		const look = view.status?.look ?? null;
		const tint = look === "turn" ? AMBER_FG : look === "done" ? GREEN_FG : "";
		const status = cleanStatus(view.status);
		const map = mapLine(status);
		cardStatusText(status)
			.split("\n")
			.forEach((text, index) => {
				lines.push({
					text,
					style: index === 0 ? `${BOLD}${tint}` : tint || "",
					rainbow: index === 0 && look === "rewind",
					...(index === 1 && map?.text === text ? { stage: map.stage } : {}),
				});
			});
	}
	if (view.unreadable.length > 0) lines.push({ text: `cannot read ${view.unreadable.join(", ")}`, style: DIM });
	return lines;
}

/** One frame as text: a header, the card, and at most one "cannot read" line. Pure. */
export function renderHud(view: HudView, options: HudRenderOptions): string {
	const width = Math.max(10, Math.floor(options.width));
	return hudLines(view, options.now)
		.map(({ text, style, rainbow }, index) => {
			if (index === 0 && options.color && options.truecolor === true) {
				const pilled = withPill(clean(text), style, width);
				if (pilled !== null) return pilled;
			}
			const line = fit(clean(text), width);
			if (options.color && rainbow === true) return rainbowLine(line);
			return options.color && style !== "" ? `${style}${line}${RESET}` : line;
		})
		.join("\n");
}
