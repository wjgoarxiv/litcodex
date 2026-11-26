// src/sunset-footer.ts — the LIT sunset in Codex's own footer, drawn by the LIT card server.
//
// Codex 0.172 lets one MCP tool draw its status line (`tui.status_line_provider`, behind the experimental
// `tui_extensions_statusline` feature): about once a second it reads a `ui://` resource with a snapshot of the
// thread and draws the tree that comes back. This module answers with the sunset of `litcodex hud` beside the
// thread's LIT state and the user's own status line items. Codex draws three lines and cuts the rest. `litcodex sunset on` selects it.
//
// A read draws from the snapshot and from LIT's own records (card-status.ts) and writes nothing. The snapshot
// does not say how wide the terminal is, so the size comes from the controlling terminal. A server under Codex's
// background daemon has none; the sun then stands first and the words after it, so a window of any width shows
// the sun and Codex cuts only the end of a line. A tree stays under Codex's limit of 256 nodes by giving neighbouring cells one colour.

import { closeSync, openSync } from "node:fs";
import { hostname } from "node:os";
import { basename, isAbsolute } from "node:path";
import { WriteStream } from "node:tty";
import { type CardStatus, clock, limitLabel, readBranch, readCardStatus, spokenMap } from "./card-status.js";
import { clean, clipped, graphemes } from "./control-chars.js";
import { chosenGlyphs } from "./glyph-choice.js";
import { displayWidth, fit, tilde } from "./hud.js";
import { roundGlyphs } from "./hud-glyphs.js";
import { BLANK, brandPill, type Cell, type Color, SUNSET } from "./hud-paint.js";
import { AMBER, DUSK, layoutSunset, SUN_CLEAR, SUN_ROWS, SUN_WIDTH, sunLeft } from "./hud-sunset.js";
import { type LitState, STATE_COLOURS, stateOf } from "./state-colours.js";
import { type WorkflowMap, workflowMapText } from "./workflow-map.js";

export const FOOTER_TOOL = "lit_statusline";
export const FOOTER_URI = "ui://litcodex/sunset-footer";
export const FOOTER_MIME = "application/json";
export const FOOTER_STATE_KEY = "com.openai/codex-statusline-state";

/** Codex draws the footer this many columns short of the terminal. */
const MARGIN = 4;
/** How far the sky reaches when nobody knows the width. */
const OPEN_WIDTH = 72;
const MAX_WIDTH = 110;
/** Narrower footers, and terminals with fewer rows, get one line. */
const MIN_SCENE_WIDTH = 60;
const MIN_SCENE_ROWS = 24;
/** Codex accepts 256 nodes. */
const MAX_NODES = 240;
/** The least a tool's name is cut to, and the most it takes where nobody knows the width. */
const TOOL_MIN = 4;
const TOOL_OPEN = 24;
/** The least a first item is cut to. */
const ITEM_MIN = 12;
/** A gap wider than any terminal, so every line of the footer starts its own row. */
const LINE_GAP = 400;
/** Codex drops a plain space at the edge of an element. */
const NBSP = " ";

export interface TerminalSize {
	readonly columns: number;
	readonly rows: number;
}

/** The part of Codex's UI tree this footer uses. */
export type UiNode =
	| string
	| { type: "text"; props?: { color?: string; weight?: "bold" }; children: UiNode[] }
	| { type: "row"; props: { gap: number; wrap: "wrap" | "nowrap"; background?: string }; children: UiNode[] };

interface Words {
	readonly text: string;
	readonly color: string;
	readonly bold?: boolean;
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function str(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? clipped(clean(value), 512) : null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The size of the terminal Codex runs in, read afresh because it may be resized; null where there is none. */
export function terminalSize(): TerminalSize | null {
	let fd: number | null = null;
	try {
		fd = openSync(process.platform === "win32" ? "\\\\.\\CONOUT$" : "/dev/tty", "r+");
		const stream = new WriteStream(fd);
		fd = null;
		const { columns, rows } = stream;
		stream.destroy();
		return columns > 0 && rows > 0 ? { columns, rows } : null;
	} catch {
		if (fd !== null) closeSync(fd);
		return null;
	}
}

/** Codex's own words for its approval policies, where they are known. */
const APPROVALS: ReadonlyMap<string, string> = new Map([["on-request", "Ask for approval"]]);

const thousands = (value: number): string => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value));

/** One usage window, as `5h 78% left`; `short` leaves the last word out. */
function limitWords(
	state: Record<string, unknown>,
	which: "primary_limit" | "secondary_limit",
	short: boolean,
): string | null {
	const limits = record(state["account"])["rate_limits"];
	const window = record(record(Array.isArray(limits) ? limits[0] : null)[which]);
	const used = num(window["used_percent"]);
	if (used === null) return null;
	const label = limitLabel(num(window["window_minutes"]) ?? (which === "primary_limit" ? 300 : 10_080));
	return `${label} ${Math.max(0, Math.round(100 - used))}%${short ? "" : " left"}`;
}

/** One item of the user's own status line, or null when the snapshot has nothing for it. */
function itemWords(id: string, state: Record<string, unknown>, branch: string | null, short: boolean): Words | null {
	const thread = record(state["thread"]);
	const model = record(thread["model"]);
	const usage = record(thread["usage"]);
	const context = record(usage["context"]);
	const total = record(usage["total"]);
	const cost = record(usage["cost"]);
	const cwd = str(record(thread["workspace"])["cwd"]);
	const as = (text: string | null, color: string): Words | null => (text === null ? null : { text, color });
	const count = (value: unknown, unit: string): string | null => {
		const amount = num(value);
		return amount === null ? null : `${thousands(amount)} ${unit}`;
	};
	// A thread that has not sent anything has no figure yet; Codex shows it as an empty window.
	const used = num(context["used_percentage"]) ?? 0;
	const left = Math.max(0, Math.round(100 - used));
	const reasoning = str(model["reasoning_level"]);
	switch (id) {
		case "model":
			return as(str(model["display_name"]), "status-model");
		case "model-with-reasoning": {
			const name = str(model["display_name"]);
			return as(name === null || reasoning === null ? name : `${name} ${reasoning}`, "status-model");
		}
		case "reasoning":
			return as(reasoning, "status-model");
		case "provider":
			return as(str(model["provider"]), "status-model");
		case "fast-mode":
			return as(str(model["service_tier_display_name"]), "status-mode");
		case "current-dir":
			return as(cwd === null ? null : tilde(cwd, process.env["HOME"]), "status-path");
		case "project-name":
			return as(cwd === null ? null : basename(cwd), "status-path");
		case "hostname":
			return as(str(hostname()), "status-path");
		case "git-branch":
			return as(branch, "status-branch");
		case "permissions":
			return as(str(record(thread["permissions"])["display_name"]), "status-mode");
		case "approval-mode": {
			const policy = str(record(thread["approval"])["policy"]);
			return as(policy === null ? null : (APPROVALS.get(policy) ?? policy), "status-mode");
		}
		case "context-remaining":
			return as(short ? `ctx ${left}%` : `context ${left}% left`, "status-usage");
		case "context-used":
			return as(`context ${Math.round(used)}% used`, "status-usage");
		case "context-window-size":
			return as(count(context["context_window_size"], "window"), "status-usage");
		case "used-tokens":
			return as(count(context["used_tokens"], "used"), "status-usage");
		case "total-input-tokens":
			return as(count(total["total_input_tokens"], "in"), "status-usage");
		case "total-output-tokens":
			return as(count(total["output_tokens"], "out"), "status-usage");
		case "thread-credits":
			return as(count(cost["total_credits"], "credits"), "status-usage");
		case "estimated-thread-cost": {
			const usd = num(cost["total_cost_usd"]);
			return as(usd === null ? null : `$${usd.toFixed(2)}`, "status-usage");
		}
		case "five-hour-limit":
			return as(limitWords(state, "primary_limit", short), "status-limit");
		case "weekly-limit":
			return as(limitWords(state, "secondary_limit", short), "status-limit");
		case "codex-version":
			return as(str(record(state["app"])["cli_version"]), "status-metadata");
		case "thread-id":
			return as(str(thread["id"]), "status-thread");
		case "thread-name":
		case "thread-title":
			return as(str(thread["name"]) ?? str(thread["id"]), "status-thread");
		case "workspace-headline":
			return as(str(record(record(state["account"])["workspace"])["headline"]), "status-metadata");
		case "profile":
			return as(str(record(state["config"])["profile"]), "status-metadata");
		default:
			return null;
	}
}

/** The ids of the user's own status line items. */
function itemIds(state: Record<string, unknown>): string[] {
	const chosen = record(state["config"])["statusline_items"];
	return Array.isArray(chosen) ? chosen.filter((id) => typeof id === "string") : [];
}

/** The items in their order, in short words when the full ones do not all fit. */
function infoWords(
	state: Record<string, unknown>,
	branch: string | null,
	ids: readonly string[],
	width: number,
	brief = false,
): Words[] {
	const write = (short: boolean): { words: Words[]; whole: boolean } => {
		const join = short ? "  " : " · ";
		const words: Words[] = [];
		const seen = new Set<string>();
		let size = 0;
		let whole = true;
		for (const id of ids) {
			let item = itemWords(id, state, branch, short);
			if (item === null || seen.has(item.text)) continue;
			const half = Math.floor(width / 2);
			if (words.length === 0 && displayWidth(item.text) > width && half >= ITEM_MIN) {
				whole = false;
				item = { ...item, text: fit(item.text, half) };
			}
			const need = displayWidth(item.text) + (words.length > 0 ? join.length : 0);
			if (size + need > width) {
				whole = false;
				continue;
			}
			seen.add(item.text);
			if (words.length > 0) words.push({ text: join, color: "status-metadata" });
			words.push(item);
			size += need;
		}
		return { words, whole };
	};
	const full = write(brief);
	return brief || full.whole ? full.words : write(true).words;
}

function wordsWidth(words: readonly Words[]): number {
	return words.reduce((sum, word) => sum + displayWidth(word.text), 0);
}

/** Words cut to `width` cells. */
function cutWords(words: readonly Words[], width: number): Words[] {
	const out: Words[] = [];
	let left = width;
	for (const word of words) {
		if (left <= 0) break;
		const text = fit(word.text, left);
		out.push({ ...word, text });
		left -= displayWidth(text);
	}
	return out;
}

/** Text Codex cannot break inside a word of any script; Codex leaves the joiners out of what it prints. */
function joined(text: string): string {
	return Array.from(graphemes.segment(text.normalize("NFC")), ({ segment }) => segment).join("\u2060");
}

interface Run {
	text: string;
	readonly fg: Color | undefined;
	readonly bg: Color | undefined;
	readonly bold: boolean;
}

/** Cells as runs of one look; every `group` cells share the first one's colour, and a blank joins any run. */
function runsOf(cells: readonly Cell[], group: number): Run[] {
	const runs: Run[] = [];
	let held = 0;
	for (const cell of cells) {
		if (cell.text === "") continue;
		const last = runs.at(-1);
		const bold = cell.bold === true;
		const same =
			last !== undefined &&
			(cell.blank === true
				? last.bg === undefined
				: last.bg === cell.bg && ((last.fg === cell.fg && last.bold === bold) || held < group));
		if (same && last !== undefined) {
			last.text += cell.text;
			held++;
		} else {
			runs.push({ text: cell.text, fg: cell.fg, bg: cell.bg, bold });
			held = 1;
		}
	}
	return runs;
}

const hex = (color: Color): string => `#${color.toString(16).padStart(6, "0").toUpperCase()}`;
const hard = (text: string): string => text.replaceAll(" ", NBSP);

function textNode(text: string, color: string | undefined, bold: boolean): UiNode {
	const props = { ...(color === undefined ? {} : { color }), ...(bold ? { weight: "bold" as const } : {}) };
	return { type: "text", ...(Object.keys(props).length > 0 ? { props } : {}), children: [hard(text)] };
}

function runNode(run: Run): UiNode {
	const text = textNode(run.text, run.fg === undefined ? undefined : hex(run.fg), run.bold);
	if (run.bg === undefined) return text;
	return { type: "row", props: { gap: 0, wrap: "nowrap", background: hex(run.bg) }, children: [text] };
}

const wordNodes = (words: readonly Words[]): UiNode[] =>
	words.map((word) => textNode(word.text, word.color, word.bold === true));
/** Text only: spans of one text element keep their spaces and never break apart. */
const textLine = (children: UiNode[]): UiNode => ({ type: "text", children });

export function countNodes(node: UiNode): number {
	if (typeof node === "string") return 1;
	return node.children.reduce((sum, child) => sum + countNodes(child), 1);
}

interface Headline {
	readonly words: readonly Words[];
	/** The tool that runs now and its clock. */
	readonly step: { readonly tool: string; readonly clock: string } | null;
	readonly moving: boolean;
	readonly waiting: boolean;
	readonly look: LitState | null;
}

/** What LIT and Codex are doing, in words. */
function headline(state: Record<string, unknown>, status: CardStatus | null): Headline {
	const agent = record(record(state["thread"])["agent"])["state"];
	const moving = agent === "working" || agent === "thinking";
	const lit = status !== null && status.state !== "ready" ? status : null;
	const waiting = agent === "waiting" || (!moving && lit?.look === "turn");
	const done = !moving && !waiting && (lit?.look === "done" || lit?.state === "complete");
	const word = waiting ? "your turn" : moving ? "working" : done ? "done ✓" : "ready";
	const tint = waiting ? "yellow" : moving ? "accent" : done ? "green" : "status-metadata";
	const words: Words[] = [];
	if (lit !== null) words.push({ text: `${lit.mode ?? "lit"} `, color: "primary", bold: true });
	words.push({ text: word, color: tint });
	const running = moving ? (lit?.step ?? null) : null;
	const step =
		lit === null || running === null ? null : { tool: running.tool, clock: clock(lit.now - running.startedAt) };
	const look = waiting ? "turn" : done ? stateOf(lit) : null;
	return { words, step, moving, waiting, look };
}

/** The step in `room` cells: its name may be cut, its clock is whole, and without room for both it is left out. */
function stepWords(step: Headline["step"], room: number): Words[] {
	if (step === null) return [];
	const [before, after] = [" · ", ` ${step.clock}`];
	const tool = fit(step.tool, Math.max(0, room - before.length - after.length));
	if (tool !== step.tool && displayWidth(tool) < TOOL_MIN) return [];
	return [{ text: `${before}${tool}${after}`, color: "status-metadata" }];
}

/** The words of a one-line footer after its pill. A step keeps clear of the context figure that stands without it. */
function oneLine(state: Record<string, unknown>, branch: string | null, head: Headline, room: number): Words[] {
	const base = cutWords([{ text: " ", color: "primary" }, ...head.words], room);
	const left = room - wordsWidth(base);
	const ids = itemIds(state);
	const idle = infoWords(state, branch, ids, left - 2);
	const context = ids.find((id) => id === "context-remaining" || id === "context-used");
	const forms = [true, false].map((short) =>
		context === undefined ? undefined : itemWords(context, state, branch, short)?.text,
	);
	const shows = (words: readonly Words[]): boolean => words.some((word) => forms.includes(word.text));
	const figure = displayWidth(forms[0] ?? "") + 2;
	const kept = context !== undefined && (shows(idle) || (head.moving && figure <= left));
	const step = stepWords(head.step, left - (kept ? figure : 0));
	const after = left - wordsWidth(step) - 2;
	let items = infoWords(state, branch, ids, after);
	if (kept && !shows(items)) items = infoWords(state, branch, [context, ...ids.filter((id) => id !== context)], after);
	return [...base, ...step, ...(items.length > 0 ? [{ text: "  ", color: "primary" }, ...items] : [])];
}

export interface FooterOptions {
	readonly now: number;
	readonly size: TerminalSize | null;
	readonly caps: boolean;
	readonly status: CardStatus | null;
	/** The branch of the thread's folder, where the LIT records have none. */
	readonly branch?: string | null;
}

/** The footer as Codex's UI tree. */
export function footerTree(snapshot: unknown, options: FooterOptions): UiNode {
	const state = record(snapshot);
	const { status } = options;
	const open = options.size === null;
	const width = Math.min(MAX_WIDTH, Math.max(10, options.size === null ? MAX_WIDTH : options.size.columns - MARGIN));
	const said = headline(state, status);
	const { words: head, moving, waiting, look } = said;
	const branch = status?.branch ?? options.branch ?? null;
	const brand = brandPill(options.caps, look === null ? SUNSET : STATE_COLOURS[look].pill);
	const pill = runsOf(brand, 1).map(runNode);
	const rows = options.size?.rows ?? MIN_SCENE_ROWS;

	if (width < MIN_SCENE_WIDTH || rows < MIN_SCENE_ROWS) {
		return row([...pill, textLine(wordNodes(oneLine(state, branch, said, width - brand.length - 1)))]);
	}

	// The map is LIT's; a thread without LIT gets its folder and branch there.
	const cwd = str(record(record(state["thread"])["workspace"])["cwd"]);
	const place = [cwd === null ? null : basename(cwd), branch].filter((part) => part !== null);
	const map = status !== null && status.state !== "ready" ? spokenMap(status) : null;
	const at = open ? 2 * SUN_CLEAR + SUN_WIDTH : 0;
	const limit = open ? width - at : Math.max(20, sunLeft(width) - SUN_CLEAR);
	const cut = open || (map !== null && displayWidth(workflowMapText(map)) > limit);
	const second: Words[] =
		map !== null
			? [{ text: workflowMapText(cut ? fromCurrent(map) : map), color: "status-progress" }]
			: [{ text: place.join(" · "), color: "status-path" }];
	const first = cutWords([{ text: " ", color: "primary" }, ...head], limit - brand.length);
	const step = limit - brand.length - wordsWidth(first);
	const info = infoWords(state, branch, itemIds(state), limit, open);
	// Codex draws fewer lines in a low window, so the items stand above the folder where its height is not known.
	const below = open && map === null ? [info, cutWords(second, limit)] : [cutWords(second, limit), info];
	const lines: (readonly Words[])[] = [
		[...first, ...stepWords(said.step, open ? Math.min(step, stepOpen(said.step)) : step)],
		...below,
	];
	// Codex breaks a line at a hyphen before it cuts it, so a line that may be cut has none to break at.
	const shown: (readonly Words[])[] = open
		? lines.map((words) => words.map((word) => ({ ...word, text: word.text.replaceAll("-", "\u2011") })))
		: lines;
	const ends = shown.map((words, index) => at + wordsWidth(words) + (index === 0 ? brand.length : 0));
	const reach = open ? Math.max(OPEN_WIDTH, ...ends) : width;
	const grid = ends.map((end) =>
		Array.from({ length: reach }, (_, x): Cell => (x >= at && x < end ? { text: "x" } : BLANK)),
	);
	const scene = layoutSunset(grid, 0, reach, {
		palette: waiting ? AMBER : DUSK,
		moving,
		dim: false,
		wheel: null,
		...(open ? { left: SUN_CLEAR } : {}),
	});
	// A still scene stands at one moment; a moving one keeps small numbers, which the sine waves need.
	scene.paint(grid, moving ? (options.now / 1000) % 3600 : 0, null);

	const spoken = open ? shown.map((words) => words.map((word) => ({ ...word, text: joined(word.text) }))) : shown;
	// Blanks past the last lit cell would only make Codex end the line in "…", and the sea has hyphens to break a line at.
	const last = grid.map((cells, y) => {
		if (!open) return reach;
		const end = ends[y] ?? 0;
		if (map === null && y === SUN_ROWS - 1) return end;
		return cells.reduce((lit, cell, x) => (cell.text.trim() === "" ? lit : x + 1), end);
	});
	const build = (group: number): UiNode => {
		const drawn = spoken.map((words, y) => {
			// Scene cells sit inside one text, which carries no background.
			const sky = (from: number, to?: number): UiNode[] =>
				runsOf((grid[y] ?? []).slice(from, to), y === SUN_ROWS - 1 ? group : 1).map((run) =>
					runNode({
						...run,
						text: open && from > 0 ? run.text.replaceAll("-", "\u2011") : run.text,
						bg: undefined,
					}),
				);
			const before = at > 0 ? [textLine(sky(0, at))] : [];
			const after = textLine([...wordNodes(words), ...sky(ends[y] ?? 0, last[y])]);
			return row([...before, ...(y === 0 ? pill : []), after]);
		});
		return { type: "row", props: { gap: LINE_GAP, wrap: "wrap" }, children: drawn };
	};
	let tree = build(1);
	for (let group = 2; countNodes(tree) > MAX_NODES && group < 12; group++) tree = build(group);
	return tree;
}

/** The path from the stage at work on, so a line that may be cut keeps the stage's name. */
function fromCurrent(map: WorkflowMap): WorkflowMap {
	const at = map.cells.findIndex((item) => item.state === "current");
	return at > 0 ? { ...map, cells: map.cells.slice(at) } : map;
}

/** The room of a step whose name is cut to the most it may take on an open line. */
function stepOpen(step: Headline["step"]): number {
	return step === null ? 0 : " · ".length + TOOL_OPEN + 1 + step.clock.length;
}

const row = (children: UiNode[]): UiNode => ({ type: "row", props: { gap: 0, wrap: "nowrap" }, children });

/**
 * Whether the footer's pill ends in round caps. Codex drops the pill's fill where the terminal has no colours for it,
 * and the caps alone would stay as solid discs. Codex hands the server little more than TERM, so TERM decides until
 * the person has chosen.
 */
export function roundFooter(env: NodeJS.ProcessEnv): boolean {
	const chosen = chosenGlyphs(env);
	return chosen === "auto" ? fillsPills(env) && roundGlyphs(env) : chosen === "round";
}

/** Whether the terminal has colours for a pill, as far as TERM says. */
export function fillsPills(env: NodeJS.ProcessEnv): boolean {
	const term = env["TERM"] ?? "";
	return term === "" || /256color|direct|kitty|ghostty|alacritty|wezterm|foot|contour/iu.test(term);
}

const FONT_ANSWER_MS = 60_000;
let guessed: { readonly at: number; readonly round: boolean } | null = null;

/** `roundFooter` once a second: the saved choice at every read, the look through the fonts once a minute. */
function footerCaps(env: NodeJS.ProcessEnv, now: number): boolean {
	const chosen = chosenGlyphs(env);
	if (chosen !== "auto") return chosen === "round";
	if (guessed === null || Math.abs(now - guessed.at) > FONT_ANSWER_MS) guessed = { at: now, round: roundFooter(env) };
	return guessed.round;
}

/** The answer to one `resources/read` of the footer. */
export function readFooter(params: Record<string, unknown>, env: NodeJS.ProcessEnv, now: number): UiNode {
	const snapshot = record(params["_meta"])[FOOTER_STATE_KEY];
	const { id, workspace } = record(record(snapshot)["thread"]);
	const thread = str(id);
	const cwd = record(workspace)["cwd"];
	let status: CardStatus | null = null;
	let branch: string | null = null;
	try {
		// No rollout: the snapshot already has the usage, and this runs every second.
		status = thread === null ? null : readCardStatus(thread, env, now, { rollout: false });
		if (status?.branch == null && typeof cwd === "string" && isAbsolute(cwd)) branch = readBranch(cwd);
	} catch {
		// The footer shows what the snapshot says.
	}
	return footerTree(snapshot, { now, size: terminalSize(), caps: footerCaps(env, now), status, branch });
}
