// src/screen-card.ts — the LIT card the hooks print inside the Codex screen.
//
// A few rows in a hook `systemMessage`: the route and a short note (`🔥 LIT · lit-loop · turn started`), the stage
// path in words (`✓ plan ── ● work 3/7 ── ○ review`), then at most three checklist rows around the open task. The
// rows are plain text unless colour is asked for; the caller asks only when `screen-status` is on and NO_COLOR is
// unset, because only the terminal UI is known to draw the escapes. In colour the same words wear the sunset: the
// brand pill, the warm path, the current stage in a pill, and a horizon with a low sun under them. Record-derived
// text is stripped of control characters and every row is cut to the width given.

import { lookOf } from "./card-looks.js";
import { completion } from "./card-status.js";
import { clean, displayWidth, fit, wrapped } from "./hud.js";
import {
	ACCENT,
	along,
	BLANK,
	brandPill,
	type Cell,
	type Color,
	cut,
	in256,
	pill,
	rowText,
	SUNSET,
	words,
} from "./hud-paint.js";
import { AMBER, DUSK } from "./hud-sunset.js";
import { STATE_COLOURS, stateOfLook } from "./state-colours.js";
import {
	type ChecklistRow,
	MAP_JOIN,
	type MapCell,
	mapCellText,
	readChecklist,
	readWorkflowSignals,
	rememberShown,
	type WorkflowMap,
	workflowMapCells,
	workflowMapText,
} from "./workflow-map.js";
import { DISCIPLINE_ENTRY, readStack, stackRow } from "./workflow-stack.js";

const TEXT: Color = 0xe6edf3;
const DIM: Color = 0x8b949e;
const RAIL: Color = 0x46505c;
const GREEN: Color = 0x6bdb8f;
const AMBER_INK: Color = 0xffaf3c;

interface Inks {
	readonly text: Color | null;
	readonly dim: Color | null;
	readonly rail: Color | null;
	readonly name: Color | null;
	readonly turn: Color | null;
	readonly doneMark: Color;
	readonly openMark: Color;
	/** Stages that are behind wear the sunset. */
	readonly warm: boolean;
}
const DARK_INKS: Inks = {
	text: TEXT,
	dim: DIM,
	rail: RAIL,
	name: ACCENT,
	turn: AMBER_INK,
	doneMark: GREEN,
	openMark: ACCENT,
	warm: true,
};
/** Marks in tones that read on white; every word in the terminal's own ink. */
const LIGHT_INKS: Inks = {
	text: null,
	dim: null,
	rail: null,
	name: null,
	turn: null,
	doneMark: 0x14713d,
	openMark: 0xa8480f,
	warm: false,
};

/** The longest a row of words gets; the terminal wraps those between words. */
export const DEFAULT_CARD_WIDTH = 96;
/**
 * A hook has no terminal to measure, and Codex indents its rows by four cells. The path, the checklist and the lines
 * a hook adds under the card stay inside 44 cells; the horizon, which has no word to break at, inside a phone's 32.
 */
export const SAFE_WIDTH = 44;
/** Past this the note and the paused row go on in a row of their own, under the card's left edge. */
const NOTE_WIDTH = 72;
const MIN_CARD_WIDTH = 20;
const MAX_CHECKLIST = 3;
/** A pill is its text and one cell either side. */
const PILL_EDGES = 2;
const HORIZON_WIDTH = 32;
/** Codex drops the plain blanks a hook row ends in, a pill's end cell among them. */
const NBSP = "\xa0";
const LOW_SUN = "▂▄▅▆▇▇▆▅▄▂";
const JOIN = " · ";

export interface ScreenCardInput {
	readonly mode: string;
	readonly note: string | null;
	readonly look: string | null;
	readonly map: WorkflowMap | null;
	readonly checklist: readonly ChecklistRow[];
	/** The paused-work row from the workflow stack; null while one frame or none is on it. */
	readonly stack?: string | null;
}

export interface ScreenCardOptions {
	readonly color: boolean;
	readonly width?: number;
	/** False leaves the horizon row out of the coloured card. */
	readonly horizon?: boolean;
	/** The path stays one row, cut at the width, for a caller that counts rows. */
	readonly fixedRows?: boolean;
	/** The window is light: words in its own ink, colour on the pills, the marks and the horizon only. */
	readonly light?: boolean;
	/** 256 takes the colours to that palette. */
	readonly depth?: 256;
	/** The pills end in round caps, in the cells their square ends have. */
	readonly caps?: boolean;
}

const CHECK_MARK = { done: "✓", current: "▸", pending: "·" } as const;

/** The stages in order, broken between two of them where a row would pass `width`. */
function pathRows(map: WorkflowMap, width: number): WorkflowMap["cells"][] {
	const rows: MapCell[][] = [];
	let used = 0;
	for (const item of map.cells) {
		const size = displayWidth(clean(mapCellText(item))) + (item.state === "current" ? PILL_EDGES : 0);
		const row = rows.at(-1);
		if (row !== undefined && used + MAP_JOIN.length + size <= width) {
			row.push(item);
			used += MAP_JOIN.length + size;
		} else {
			rows.push([item]);
			used = size;
		}
	}
	return rows;
}

/** The note in the pieces of the card's rows, the first one beside a headline of `used` cells ("" when none fits). */
function noteRows(input: ScreenCardInput, used: number, limit: number): string[] {
	const note = clean(input.note ?? "");
	return note === "" ? [""] : wrapped(note, limit, limit - used - JOIN.length);
}

function plainRows(input: ScreenCardInput, width: number, safe: number, limit: number): string[] {
	const head = `🔥 LIT${JOIN}${clean(input.mode)}`;
	const [note = "", ...more] = noteRows(input, displayWidth(head), limit);
	const rows = [`${head}${note === "" ? "" : `${JOIN}${note}`}`, ...more];
	if (input.map !== null)
		for (const cells of pathRows(input.map, safe)) rows.push(clean(workflowMapText({ ...input.map, cells })));
	if (input.stack) rows.push(...wrapped(clean(input.stack), limit));
	for (const item of input.checklist.slice(0, MAX_CHECKLIST))
		rows.push(fit(`${CHECK_MARK[item.state]} ${clean(item.label)}`, safe));
	return rows.map((row) => fit(row, width));
}

/** The stage path in the sunset's colours: warm behind, a pill on the stage at work, dim ahead. */
function pathCells(map: WorkflowMap, turn: boolean, row: WorkflowMap["cells"], inks: Inks, caps: boolean): Cell[] {
	const last = Math.max(1, map.cells.length - 1);
	return row.flatMap((item, at) => {
		const index = map.cells.indexOf(item);
		const warm = (share: number): Color | null => (inks.warm ? along(turn ? AMBER.rule : SUNSET, share) : null);
		const join = at === 0 ? [] : words(MAP_JOIN, item.state === "pending" ? inks.rail : warm((index - 0.5) / last));
		const text = clean(mapCellText(item));
		if (item.state === "current") return [...join, ...pill(text, turn ? AMBER.stage : DUSK.stage, caps)];
		return [...join, ...words(text, item.state === "pending" ? inks.dim : warm(index / last))];
	});
}

/** The sea's edge with a low sun on it, the one row only the coloured card has. */
function horizon(width: number, turn: boolean): Cell[] {
	const palette = turn ? AMBER : DUSK;
	const size = Math.min(HORIZON_WIDTH, width);
	const left = Math.round(size * 0.62) - LOW_SUN.length / 2;
	return Array.from({ length: size }, (_, x): Cell => {
		const at = x - left;
		const sun = LOW_SUN[at];
		if (sun === undefined) return { text: "▁", fg: along(palette.rule, x / (size - 1)) };
		const edge = Math.abs(at - (LOW_SUN.length - 1) / 2) / (LOW_SUN.length / 2);
		return {
			text: sun,
			fg: along(
				palette.sun.map(([rest]) => rest),
				edge,
			),
		};
	});
}

/** The row as text, its last cell kept where it is the end of a pill. */
function endedRow(row: readonly Cell[]): string {
	const last = row.at(-1);
	const open = last?.text === " " && last.bg !== undefined;
	return rowText(open ? [...row.slice(0, -1), { ...last, text: NBSP }] : row);
}

function colouredRows(
	input: ScreenCardInput,
	width: number,
	safe: number,
	limit: number,
	options: ScreenCardOptions,
): string[] {
	const inks = options.light === true ? LIGHT_INKS : DARK_INKS;
	const turn = input.look === "turn";
	const state = stateOfLook(input.look);
	const said = turn ? inks.turn : inks.text;
	const caps = options.caps === true;
	const head = [
		...brandPill(caps, state === null ? SUNSET : STATE_COLOURS[state].pill),
		BLANK,
		...words(clean(input.mode), inks.name, { bold: true }),
	];
	const [note = "", ...more] = noteRows(input, head.length, limit);
	const rows: Cell[][] = [
		[...head, ...(note === "" ? [] : [...words(JOIN, inks.dim), ...words(note, said)])],
		...more.map((text) => words(text, said)),
	];
	if (input.map !== null)
		for (const cells of pathRows(input.map, safe)) rows.push(pathCells(input.map, turn, cells, inks, caps));
	if (input.stack) rows.push(...wrapped(clean(input.stack), limit).map((text) => words(text, inks.dim)));
	for (const item of input.checklist.slice(0, MAX_CHECKLIST)) {
		const mark = item.state === "done" ? inks.doneMark : item.state === "current" ? inks.openMark : inks.dim;
		rows.push(
			cut(
				[
					...words(`${CHECK_MARK[item.state]} `, mark),
					...words(clean(item.label), item.state === "current" ? inks.text : inks.dim),
				],
				safe,
			),
		);
	}
	if (options.horizon !== false) rows.push(horizon(safe, turn));
	const painted = rows.map((row) => endedRow(cut(row, width)));
	return options.depth === 256 ? painted.map(in256) : painted;
}

/** The card rows joined by newlines. */
export function renderScreenCard(input: ScreenCardInput, options: ScreenCardOptions): string {
	const width = Math.max(MIN_CARD_WIDTH, Math.floor(options.width ?? DEFAULT_CARD_WIDTH));
	const safe = options.width === undefined ? SAFE_WIDTH : options.fixedRows === true ? Infinity : width;
	const limit = options.width === undefined ? NOTE_WIDTH : Infinity;
	return (
		options.color ? colouredRows(input, width, safe, limit, options) : plainRows(input, width, safe, limit)
	).join("\n");
}

/**
 * The card for a session's saved state. With `quietWhenEmpty`, null when there is neither a map nor a
 * checklist, since the route row alone would repeat the activation banner above it.
 */
export function workflowCard(
	repoRoot: string,
	sessionId: string | null,
	mode: string,
	/** The note, or the two it can be: with the next task while the card names it nowhere else, and without. */
	note: string | null | ((next: boolean) => string | null),
	options: ScreenCardOptions & {
		readonly quietWhenEmpty?: boolean;
		/** Leave the path out while nothing on it is counted: the turn's own words say more than it. */
		readonly quietMap?: boolean;
		/** The activation banner above already names the skill, so the plain card leaves its first row out. */
		readonly underBanner?: boolean;
		/** The turn ended by asking the person something. */
		readonly waiting?: boolean;
		/** The turn is over, so work that has nothing open is done. */
		readonly ended?: boolean;
		/** `show` remembers the path and checklist this card prints; `omit` also leaves them out when the last card had them. */
		readonly repeats?: "show" | "omit";
	},
): string | null {
	const signals = readWorkflowSignals(repoRoot, sessionId);
	const map = workflowMapCells(mode, signals);
	const frames = sessionId === null ? null : readStack(repoRoot, sessionId);
	const stack = frames === null ? null : stackRow(frames);
	// A research run or a side run has no part in the plan paused under it.
	const top = frames?.frames.at(-1);
	const aside =
		map?.family === "research" ||
		(top?.role === "side" && top.skill !== null && DISCIPLINE_ENTRY[top.skill]?.stage !== "work");
	const checklist = aside ? [] : readChecklist(repoRoot, sessionId);
	if (options.quietWhenEmpty === true && map === null && checklist.length === 0 && stack === null) return null;
	const counted = checklist.length > 0 || map?.cells.some((item) => item.progress !== null || item.state === "done");
	const shown = options.quietMap === true && counted !== true ? null : map;
	const own = lookOf(mode);
	const done = options.ended === true && own !== "rewind" && completion(map, signals) !== null;
	const look = options.waiting === true ? "turn" : done ? "done" : own;
	const seen =
		options.repeats !== undefined &&
		sessionId !== null &&
		rememberShown(repoRoot, sessionId, JSON.stringify([map, checklist, stack, look])) &&
		options.repeats === "omit";
	const named = aside || (!seen && checklist.some((item) => item.state === "current"));
	const input: ScreenCardInput = {
		mode,
		note: typeof note === "function" ? note(!named) : note,
		look,
		map: seen ? null : shown,
		checklist: seen ? [] : checklist,
		stack,
	};
	const card = renderScreenCard(input, options);
	return options.underBanner === true && !options.color ? card.slice(card.indexOf("\n") + 1) : card;
}
