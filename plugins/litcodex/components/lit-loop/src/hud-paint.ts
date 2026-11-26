// src/hud-paint.ts — terminal cells in truecolor: colours, pills and the escapes between them.
//
// The HUD draws a frame as rows of cells, so every part knows which cells hold words, and only cells that
// changed are written again. Colours move in eight steps, so neighbours share one escape.

import { cells, PILL_TEXT, RESET } from "./hud.js";

export type Color = number;
/** One terminal cell; a wide character's further cells have an empty `text`. */
export interface Cell {
	readonly text: string;
	readonly fg?: Color;
	readonly bg?: Color;
	readonly bold?: boolean;
	/** A ready-made SGR string, for text that keeps the card's own style. */
	readonly sgr?: string;
	/** No word or drawing uses this cell. */
	readonly blank?: boolean;
}

const CAP_LEFT = "\ue0b6";
const CAP_RIGHT = "\ue0b4";

export const INK: Color = 0x0b0e14;
export const FAINT: Color = 0x30363d;
export const MUTED: Color = 0x2d333b;
export const WHITE: Color = 0xffffff;
export const TRACK: Color = 0x2a2340;
export const PINK: Color = 0xff2d95;
export const VIOLET: Color = 0xb48cff;
/** LitCodex mint. */
export const ACCENT: Color = 0x7cf5b0;
export const SUNSET: readonly Color[] = [0xffa033, 0xff6a55, 0xff3388];
/** Unchanged cells cheaper to write again than to jump over. */
const RUN_GAP = 3;
export const BLANK: Cell = { text: " ", blank: true };

/** Colours come in eight steps, so neighbours often match and a frame stays short. */
export function mix(from: Color, to: Color, share: number): Color {
	const step = Math.max(0, Math.min(8, Math.round(share * 8))) / 8;
	const channel = (shift: number): number => {
		const a = (from >> shift) & 255;
		return Math.round(a + (((to >> shift) & 255) - a) * step) << shift;
	};
	return channel(16) | channel(8) | channel(0);
}

export function along(stops: readonly Color[], share: number): Color {
	const at = Math.max(0, Math.min(1, share)) * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(at));
	return mix(stops[index] ?? WHITE, stops[index + 1] ?? WHITE, at - index);
}

export function push(row: Cell[], text: string, width: number, style: Omit<Cell, "text">): void {
	if (width === 0) {
		let at = row.length - 1;
		while (row[at]?.text === "") at--;
		const base = row[at];
		if (base !== undefined) row[at] = { ...base, text: base.text + text };
		return;
	}
	row.push({ ...style, text });
	for (let taken = 1; taken < width; taken++) row.push({ text: "" });
}

/** The brand pill; round caps replace its two padding cells, so it is as wide either way. */
export function brandPill(caps: boolean, stops: readonly Color[] = SUNSET): Cell[] {
	const pieces = cells(PILL_TEXT);
	const row: Cell[] = [];
	pieces.forEach((piece, index) => {
		const fill = along(stops, index / (pieces.length - 1));
		const edge = index === 0 ? CAP_LEFT : index === pieces.length - 1 ? CAP_RIGHT : null;
		if (caps && edge !== null) push(row, edge, 1, { fg: fill });
		else push(row, piece.text, piece.width, { fg: INK, bg: fill, bold: true });
	});
	return row;
}

/** Cells `from` up to `to` as a pill graded along `stops`, in dark ink; nothing moves. */
export function gradePill(
	row: Cell[],
	from: number,
	to: number,
	stops: readonly Color[],
	caps: boolean,
	ink: Color = INK,
	bold = true,
): void {
	const left = row[from]?.text === " ";
	const right = row[to - 1]?.text === " ";
	for (let x = from; x < to; x++) {
		const cell = row[x];
		if (cell === undefined || cell.text === "") continue;
		const fill = along(stops, (x - from) / Math.max(1, to - from - 1));
		const cap = x === from && left ? CAP_LEFT : x === to - 1 && right ? CAP_RIGHT : null;
		row[x] =
			caps && cap !== null
				? { text: cap, fg: fill }
				: { text: cell.text, fg: ink, bg: fill, ...(bold ? { bold: true } : {}) };
	}
}

/** A bar over `size` cells, `filled` of them lit along `stops`; round ends where the terminal draws them. */
export function bar(size: number, filled: number, stops: readonly Color[], caps: boolean): Cell[] {
	return Array.from({ length: size }, (_, x): Cell => {
		const lit = x < filled;
		const color = lit ? along(stops, size < 2 ? 0 : x / (size - 1)) : TRACK;
		if (!caps) return { text: lit ? "▰" : "▱", fg: lit ? color : 0x6a5f8f };
		if (size > 1 && x === 0) return { text: CAP_LEFT, fg: color };
		if (size > 1 && x === size - 1) return { text: CAP_RIGHT, fg: color };
		return { text: " ", bg: color };
	});
}

/** `text` as cells in one style; null is the terminal's own ink. */
export function words(
	text: string,
	fg: Color | null,
	style: { readonly bold?: boolean; readonly bg?: Color } = {},
): Cell[] {
	const row: Cell[] = [];
	const look = fg === null ? style : { fg, ...style };
	for (const piece of cells(text)) push(row, piece.text, piece.width, look);
	return row;
}

/** The row cut to `width` cells, ending in `…` when anything was cut; a wide character is never split. */
export function cut(row: readonly Cell[], width: number): Cell[] {
	if (row.length <= width) return [...row];
	if (width <= 0) return [];
	// The cut may fall inside a wide character, which then goes whole.
	let end = width - 1;
	while (end > 0 && row[end]?.text === "") end--;
	const style = row[width - 2] ?? row[0];
	const { blank: _blank, sgr: _sgr, ...look } = style ?? BLANK;
	return [...row.slice(0, end), { ...look, text: "…" }, ...Array<Cell>(width - 1 - end).fill(BLANK)];
}

/** A filled pill around `text`, graded along `stops`, with its two end cells. */
export function pill(text: string, stops: readonly Color[], caps: boolean, ink: Color = INK, bold = true): Cell[] {
	const row = words(` ${text} `, ink, bold ? { bold } : {});
	gradePill(row, 0, row.length, stops, caps, ink, bold);
	return row;
}

/** The escapes that turn `before` into `after` on screen row `y`: only the runs of cells that changed. */
export function changedRuns(before: readonly Cell[], after: readonly Cell[], y: number): string {
	const same = (x: number): boolean => {
		const a = before[x];
		const b = after[x];
		return (
			a !== undefined && b !== undefined && a.text === b.text && a.fg === b.fg && a.bg === b.bg && a.bold === b.bold
		);
	};
	let out = "";
	let x = 0;
	const last = after.length - 1;
	while (x < after.length) {
		if (same(x)) {
			x++;
			continue;
		}
		let start = x;
		while (start > 0 && after[start]?.text === "") start--;
		let end = x + 1;
		// The frame's right edge is always placed by itself, whatever the terminal made of the text before it.
		const stop = x < last ? last : after.length;
		for (let next = end; next < stop && next - end <= RUN_GAP; next++) if (!same(next)) end = next + 1;
		while (end < stop && after[end]?.text === "") end++;
		out += `\u001b[${y + 1};${start + 1}H${rowText(after.slice(start, end), true)}`;
		x = end;
	}
	return out;
}

/** The escape that takes the terminal from one cell's look to the next, naming only what changed. */
function turnTo(from: Cell, to: Cell): string {
	if (to.blank === true && from.bg === undefined && from.sgr === undefined) return "";
	const dropped =
		from.sgr !== to.sgr ||
		(from.bg !== undefined && to.bg === undefined) ||
		(from.fg !== undefined && to.fg === undefined) ||
		(from.bold === true && to.bold !== true);
	const base: Cell = dropped ? BLANK : from;
	const codes: string[] = [];
	const rgb = (color: Color): string => `${color >> 16};${(color >> 8) & 255};${color & 255}`;
	if (to.bold === true && base.bold !== true) codes.push("1");
	if (to.fg !== undefined && to.fg !== base.fg) codes.push(`38;2;${rgb(to.fg)}`);
	if (to.bg !== undefined && to.bg !== base.bg) codes.push(`48;2;${rgb(to.bg)}`);
	const plain = from.sgr === undefined && from.fg === undefined && from.bg === undefined && from.bold !== true;
	const own = codes.length === 0 ? "" : `\u001b[${codes.join(";")}m`;
	return (dropped && !plain ? RESET : "") + (dropped ? (to.sgr ?? "") : "") + own;
}

/** The entry of the 256-colour palette nearest to a colour; the 16 a theme owns are left out. */
function nearest(red: number, green: number, blue: number): number {
	const level = (value: number): number => (value < 48 ? 0 : value < 115 ? 1 : Math.floor((value - 35) / 40));
	const value = (at: number): number => (at === 0 ? 0 : 55 + at * 40);
	const cube = [red, green, blue].map(level) as [number, number, number];
	const step = Math.max(0, Math.min(23, Math.round(((red + green + blue) / 3 - 8) / 10)));
	const far = (r: number, g: number, b: number): number => (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;
	const grey = 8 + step * 10;
	return far(grey, grey, grey) < far(value(cube[0]), value(cube[1]), value(cube[2]))
		? 232 + step
		: 16 + 36 * cube[0] + 6 * cube[1] + cube[2];
}

/** Painted text with its 24-bit colours taken to the 256-colour palette. */
export function in256(text: string): string {
	return text.replace(
		/([34]8);2;(\d+);(\d+);(\d+)/gu,
		(_all, layer, red, green, blue) => `${layer};5;${nearest(Number(red), Number(green), Number(blue))}`,
	);
}

/** The row as text: cells that look alike share one escape, and (unless `whole`) trailing blanks are dropped. */
export function rowText(row: readonly Cell[], whole = false): string {
	let end = row.length;
	while (!whole && end > 0 && row[end - 1]?.blank === true) end--;
	let out = "";
	let look: Cell = BLANK;
	for (const cell of row.slice(0, end)) {
		if (cell.text === "") continue;
		const turn = turnTo(look, cell);
		if (turn !== "" || cell.blank !== true) look = cell;
		out += turn + cell.text;
	}
	return out.includes("\u001b") ? out + RESET : out;
}
