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
import { basename } from "node:path";
import { WriteStream } from "node:tty";
import { type CardStatus, clock, limitLabel, readCardStatus } from "./card-status.js";
import { clean } from "./control-chars.js";
import { displayWidth, fit, tilde } from "./hud.js";
import { roundGlyphs } from "./hud-glyphs.js";
import { BLANK, brandPill, type Cell, type Color } from "./hud-paint.js";
import { AMBER, DUSK, layoutSunset, SUN_CLEAR, SUN_ROWS, SUN_WIDTH, sunLeft } from "./hud-sunset.js";
import { workflowMapText } from "./workflow-map.js";

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
	return typeof value === "string" && value !== "" ? clean(value).slice(0, 512) : null;
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
function itemWords(
	id: string,
	state: Record<string, unknown>,
	status: CardStatus | null,
	short: boolean,
): Words | null {
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
	const used = num(context["used_percentage"]);
	const left = used === null ? null : Math.max(0, Math.round(100 - used));
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
			return as(status?.branch ?? null, "status-branch");
		case "permissions":
			return as(str(record(thread["permissions"])["display_name"]), "status-mode");
		case "approval-mode":
			return as(str(record(thread["approval"])["policy"]), "status-mode");
		case "context-remaining":
			return as(left === null ? null : short ? `ctx ${left}%` : `context ${left}% left`, "status-usage");
		case "context-used":
			return as(used === null ? null : `context ${Math.round(used)}% used`, "status-usage");
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
			return as(str(thread["name"]), "status-thread");
		case "workspace-headline":
			return as(str(record(record(state["account"])["workspace"])["headline"]), "status-metadata");
		case "profile":
			return as(str(record(state["config"])["profile"]), "status-metadata");
		default:
			return null;
	}
}

/** The user's status line items in their order, in short words when the full ones do not all fit. */
function infoWords(state: Record<string, unknown>, status: CardStatus | null, width: number, brief = false): Words[] {
	const chosen = record(state["config"])["statusline_items"];
	const ids = Array.isArray(chosen) ? chosen.filter((id) => typeof id === "string") : [];
	const write = (short: boolean): { words: Words[]; whole: boolean } => {
		const join = short ? "  " : " · ";
		const words: Words[] = [];
		const seen = new Set<string>();
		let size = 0;
		let whole = true;
		for (const id of ids) {
			const item = itemWords(id, state, status, short);
			if (item === null || seen.has(item.text)) continue;
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
	readonly moving: boolean;
	readonly waiting: boolean;
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
	if (moving && lit !== null && lit.step !== null) {
		const step = `${lit.step.tool} ${clock(lit.now - lit.step.startedAt)}`;
		words.push({ text: ` · ${step}`, color: "status-metadata" });
	}
	return { words, moving, waiting };
}

export interface FooterOptions {
	readonly now: number;
	readonly size: TerminalSize | null;
	readonly caps: boolean;
	readonly status: CardStatus | null;
}

/** The footer as Codex's UI tree. */
export function footerTree(snapshot: unknown, options: FooterOptions): UiNode {
	const state = record(snapshot);
	const { status } = options;
	const open = options.size === null;
	const width = Math.min(MAX_WIDTH, Math.max(10, options.size === null ? MAX_WIDTH : options.size.columns - MARGIN));
	const { words: head, moving, waiting } = headline(state, status);
	const brand = brandPill(options.caps);
	const pill = runsOf(brand, 1).map(runNode);
	const gap: Words = { text: "  ", color: "primary" };
	const rows = options.size?.rows ?? MIN_SCENE_ROWS;

	if (width < MIN_SCENE_WIDTH || rows < MIN_SCENE_ROWS) {
		const room = width - brand.length - 1;
		const said = cutWords([{ text: " ", color: "primary" }, ...head], room);
		const info = infoWords(state, status, room - wordsWidth(said) - 2);
		const tail = info.length > 0 ? [gap, ...info] : [];
		return row([...pill, textLine(wordNodes([...said, ...tail]))]);
	}

	// The map is LIT's; a thread without LIT gets its folder and branch there.
	const cwd = str(record(record(state["thread"])["workspace"])["cwd"]);
	const place = [cwd === null ? null : basename(cwd), status?.branch ?? null].filter((part) => part !== null);
	const map = status !== null && status.state !== "ready" ? status.map : null;
	const second: Words[] =
		map !== null
			? [{ text: workflowMapText(map), color: "status-progress" }]
			: [{ text: place.join(" · "), color: "status-path" }];
	const at = open ? 2 * SUN_CLEAR + SUN_WIDTH : 0;
	const limit = open ? width - at : Math.max(20, sunLeft(width) - SUN_CLEAR);
	const lines: (readonly Words[])[] = [
		cutWords([{ text: " ", color: "primary" }, ...head], limit - brand.length),
		cutWords(second, limit),
		infoWords(state, status, limit, open),
	];
	// Codex breaks a line at a hyphen before it cuts it, so a line that may be cut has none to break at.
	const said: (readonly Words[])[] = open
		? lines.map((words) => words.map((word) => ({ ...word, text: word.text.replaceAll("-", "\u2011") })))
		: lines;
	const ends = said.map((words, index) => at + wordsWidth(words) + (index === 0 ? brand.length : 0));
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

	const build = (group: number): UiNode => {
		const drawn = said.map((words, y) => {
			// Scene cells sit inside one text, which carries no background.
			const sky = (from: number, to?: number): UiNode[] =>
				runsOf((grid[y] ?? []).slice(from, to), y === SUN_ROWS - 1 ? group : 1).map((run) =>
					runNode({ ...run, bg: undefined }),
				);
			const before = at > 0 ? [textLine(sky(0, at))] : [];
			const after = textLine([...wordNodes(words), ...sky(ends[y] ?? 0)]);
			return row([...before, ...(y === 0 ? pill : []), after]);
		});
		return { type: "row", props: { gap: LINE_GAP, wrap: "wrap" }, children: drawn };
	};
	let tree = build(1);
	for (let group = 2; countNodes(tree) > MAX_NODES && group < 12; group++) tree = build(group);
	return tree;
}

const row = (children: UiNode[]): UiNode => ({ type: "row", props: { gap: 0, wrap: "nowrap" }, children });

let caps: boolean | null = null;

/** The answer to one `resources/read` of the footer. */
export function readFooter(params: Record<string, unknown>, env: NodeJS.ProcessEnv, now: number): UiNode {
	const snapshot = record(params["_meta"])[FOOTER_STATE_KEY];
	const thread = str(record(record(snapshot)["thread"])["id"]);
	let status: CardStatus | null = null;
	try {
		// No rollout: the snapshot already has the usage, and this runs every second.
		status = thread === null ? null : readCardStatus(thread, env, now, { rollout: false });
	} catch {
		// The footer shows what the snapshot says.
	}
	caps ??= roundGlyphs(env);
	return footerTree(snapshot, { now, size: terminalSize(), caps, status });
}
