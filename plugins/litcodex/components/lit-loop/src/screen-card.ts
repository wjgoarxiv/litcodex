// src/screen-card.ts — the LIT card the hooks print inside the Codex screen.
//
// A few rows in a hook `systemMessage`: the route and a short note (`🔥 LIT · lit-loop · turn started`), the stage
// path in words (`✓ plan ── ● work 3/7 ── ○ review`), then at most three checklist rows around the open task. The
// rows are plain text unless colour is asked for; the caller asks only when `screen-status` is on and NO_COLOR is
// unset, because only the terminal UI is known to draw the escapes. In colour the same words wear the sunset: the
// brand pill, the warm path, the current stage in a pill, and a horizon with a low sun under them. Record-derived
// text is stripped of control characters and every row is cut to the width given.

import { lookOf } from "./card-looks.js";
import { clean, fit } from "./hud.js";
import {
	ACCENT,
	along,
	BLANK,
	brandPill,
	type Cell,
	type Color,
	cut,
	pill,
	rowText,
	SUNSET,
	words,
} from "./hud-paint.js";
import { AMBER, DUSK } from "./hud-sunset.js";
import {
	type ChecklistRow,
	MAP_JOIN,
	mapCellText,
	readChecklist,
	readWorkflowSignals,
	type WorkflowMap,
	workflowMapCells,
	workflowMapText,
} from "./workflow-map.js";
import { readStack, stackRow } from "./workflow-stack.js";

const TEXT: Color = 0xe6edf3;
const DIM: Color = 0x8b949e;
const RAIL: Color = 0x46505c;
const GREEN: Color = 0x6bdb8f;
const AMBER_INK: Color = 0xffaf3c;

/** Codex indents hook rows by four cells; the card stays inside a common terminal width. */
export const DEFAULT_CARD_WIDTH = 96;
const MIN_CARD_WIDTH = 20;
const MAX_CHECKLIST = 3;
const HORIZON_WIDTH = 64;
const LOW_SUN = "▂▄▅▆▇▇▆▅▄▂";

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
}

const CHECK_MARK = { done: "✓", current: "▸", pending: "·" } as const;

function plainRows(input: ScreenCardInput, width: number): string[] {
	const note = clean(input.note ?? "");
	const rows = [`🔥 LIT · ${clean(input.mode)}${note === "" ? "" : ` · ${note}`}`];
	if (input.map !== null && input.map.cells.length > 0) rows.push(clean(workflowMapText(input.map)));
	if (input.stack) rows.push(clean(input.stack));
	for (const item of input.checklist.slice(0, MAX_CHECKLIST))
		rows.push(`${CHECK_MARK[item.state]} ${clean(item.label)}`);
	return rows.map((row) => fit(row, width));
}

/** The stage path in the sunset's colours: warm behind, a pill on the stage at work, dim ahead. */
function pathCells(map: WorkflowMap, turn: boolean): Cell[] {
	const last = Math.max(1, map.cells.length - 1);
	return map.cells.flatMap((item, index) => {
		const warm = (share: number): Color => along(turn ? AMBER.rule : SUNSET, share);
		const join = index === 0 ? [] : words(MAP_JOIN, item.state === "pending" ? RAIL : warm((index - 0.5) / last));
		const text = clean(mapCellText(item));
		if (item.state === "current") return [...join, ...pill(text, turn ? AMBER.stage : DUSK.stage, false)];
		return [...join, ...words(text, item.state === "pending" ? DIM : warm(index / last))];
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

function colouredRows(input: ScreenCardInput, width: number, sea: boolean): string[] {
	const turn = input.look === "turn";
	const note = clean(input.note ?? "");
	const rows: Cell[][] = [
		[
			...brandPill(false, turn ? [0xffaf3c, 0xffd98a] : SUNSET),
			BLANK,
			...words(clean(input.mode), ACCENT, { bold: true }),
			...(note === "" ? [] : [...words(" · ", DIM), ...words(note, turn ? AMBER_INK : TEXT)]),
		],
	];
	if (input.map !== null && input.map.cells.length > 0) rows.push(pathCells(input.map, turn));
	if (input.stack) rows.push(words(clean(input.stack), DIM));
	for (const item of input.checklist.slice(0, MAX_CHECKLIST)) {
		const mark = item.state === "done" ? GREEN : item.state === "current" ? ACCENT : DIM;
		rows.push([
			...words(`${CHECK_MARK[item.state]} `, mark),
			...words(clean(item.label), item.state === "current" ? TEXT : DIM),
		]);
	}
	if (sea) rows.push(horizon(width, turn));
	return rows.map((row) => rowText(cut(row, width)));
}

/** The card rows joined by newlines. */
export function renderScreenCard(input: ScreenCardInput, options: ScreenCardOptions): string {
	const width = Math.max(MIN_CARD_WIDTH, Math.floor(options.width ?? DEFAULT_CARD_WIDTH));
	return (options.color ? colouredRows(input, width, options.horizon !== false) : plainRows(input, width)).join("\n");
}

/**
 * The card for a session's saved state. With `quietWhenEmpty`, null when there is neither a map nor a
 * checklist, since the route row alone would repeat the activation banner above it.
 */
export function workflowCard(
	repoRoot: string,
	sessionId: string | null,
	mode: string,
	note: string | null,
	options: ScreenCardOptions & {
		readonly quietWhenEmpty?: boolean;
		/** Leave the path out while nothing on it is counted: the turn's own words say more than it. */
		readonly quietMap?: boolean;
		/** The activation banner above already names the skill, so the plain card leaves its first row out. */
		readonly underBanner?: boolean;
		/** The turn ended by asking the person something. */
		readonly waiting?: boolean;
	},
): string | null {
	const map = workflowMapCells(mode, readWorkflowSignals(repoRoot, sessionId));
	const checklist = readChecklist(repoRoot, sessionId);
	const stack = sessionId === null ? null : stackRow(readStack(repoRoot, sessionId));
	if (options.quietWhenEmpty === true && map === null && checklist.length === 0 && stack === null) return null;
	const counted = checklist.length > 0 || map?.cells.some((item) => item.progress !== null || item.state === "done");
	const shown = options.quietMap === true && counted !== true ? null : map;
	const look = options.waiting === true ? "turn" : lookOf(mode);
	const card = renderScreenCard({ mode, note, look, map: shown, checklist, stack }, options);
	return options.underBanner === true && !options.color ? card.slice(card.indexOf("\n") + 1) : card;
}
