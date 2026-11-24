// src/hud-scene.ts — the sunset behind the `litcodex hud` card.
//
// A half-sunk sun, stars, a sea and a neon rule, drawn only in cells no text uses: under the card while the
// window has the rows, and slid up beside its short lines when it does not. The sun stays away while any of
// its cells, or the two either side, hold text. `composeScene` lays the text out once; `paint` then draws a
// moment of the scene from that alone, so a frame reads no record. What moves is the colour of a cell or an
// ASCII glyph (the sea, the stars); block glyphs keep their shape, which every terminal repaints cleanly.
// Truecolor only: the caller keeps today's frame everywhere else.

import type { CardStatus } from "./card-status.js";
import { clean } from "./control-chars.js";
import { BOLD, BRAND, cells, displayWidth, fit, type HudLine, type HudView, PILL_TEXT, RAINBOW, RESET } from "./hud.js";

/** `wait` is the card between turns; null draws no scene at all. */
export type SceneMood = "work" | "wait" | "turn" | "rewind" | null;

export interface SceneOptions {
	readonly width: number;
	readonly rows: number;
	/** The terminal draws U+E0B4 and U+E0B6 itself, so gauges and pills may end in round caps. */
	readonly caps: boolean;
}

export interface HudScene {
	/** Whether `paint` draws anything different from one moment to the next. */
	readonly moving: boolean;
	/** Every row of the frame, `seconds` into the motion. */
	paint(seconds: number): string[];
}

type Color = number;
/** One terminal cell; a wide character's second cell has an empty `text`. */
interface Cell {
	readonly text: string;
	readonly fg?: Color;
	readonly bg?: Color;
	readonly bold?: boolean;
	/** A ready-made SGR string, for text that keeps the card's own style. */
	readonly sgr?: string;
	readonly blank?: boolean;
}

/** Past this many cells the scene stops growing, so a wide window does not stretch it thin. */
const SCENE_MAX = 120;
/** Below this the sun has no sky around it. */
const SCENE_MIN = 60;
const SUN_WIDTH = 18;
const SUN_ROWS = 3;
/** Blank cells kept between the scene and any word. */
const CLEAR = 3;
const SUN_CLEAR = 2;
const CAP_LEFT = "";
const CAP_RIGHT = "";

const INK: Color = 0x0b0e14;
const FAINT: Color = 0x30363d;
const MUTED: Color = 0x2d333b;
const WHITE: Color = 0xffffff;
const TRACK: Color = 0x2a2340;
const PINK: Color = 0xff2d95;
const VIOLET: Color = 0xb48cff;
/** LitCodex mint. */
const ACCENT: Color = 0x7cf5b0;
const SUNSET: readonly Color[] = [0xffa033, 0xff6a55, 0xff3388];
const SLIT: Color = 0x1a1030;

interface Palette {
	/** Each sun row's resting colour and the colour the light lifts it to. */
	readonly sun: readonly (readonly [Color, Color])[];
	/** The sea from the sun outward. */
	readonly sea: readonly Color[];
	readonly rule: readonly Color[];
	readonly stage: readonly [Color, Color];
}
const DUSK: Palette = {
	sun: [
		[0xffd24a, 0xfff0a0],
		[0xff8f3c, 0xffc15a],
		[0xff2d8a, 0xff6b8f],
	],
	sea: [0xffdc73, 0xff9a4a, 0xff4f8b, 0xb457d6, 0x5a46a8],
	rule: [PINK, VIOLET, ACCENT],
	stage: [VIOLET, ACCENT],
};
const AMBER: Palette = {
	sun: [
		[0xffc95a, 0xfff0b8],
		[0xffaf3c, 0xffd98a],
		[0xe08a1e, 0xffb95a],
	],
	sea: [0xffd98a, 0xffaf3c, 0xe08a1e, 0x9a6420, 0x5a4020],
	rule: [0x9a6420, 0xffaf3c, 0xffd98a],
	stage: [0xffaf3c, 0xffd98a],
};
/** The rewind line's eight colours in truecolor, for a sun that matches it. */
const WHEEL: readonly Color[] = [0xff5f5f, 0xff875f, 0xffd75f, 0x87d787, 0x5fd7d7, 0x5fafff, 0xaf87ff, 0xff5faf];

/** Star places: rows above (-1) and beside (0, 1) the sun, cells from its left edge. */
const STARS: readonly (readonly [number, number])[] = [
	[-1, -44],
	[-1, -27],
	[-1, -6],
	[-1, 15],
	[-1, 31],
	[0, -36],
	[0, -30],
	[0, -18],
	[0, -9],
	[0, 22],
	[0, 29],
	[0, 35],
	[1, -40],
	[1, -24],
	[1, -13],
	[1, -5],
	[1, 25],
	[1, 32],
];
const DASH = "*--.";
const DASH_EVERY = 9;
const DASH_SECONDS = 1.1;

/** Colours come in eight steps, so neighbours often match and a frame stays short. */
function mix(from: Color, to: Color, share: number): Color {
	const step = Math.max(0, Math.min(8, Math.round(share * 8))) / 8;
	const channel = (shift: number): number => {
		const a = (from >> shift) & 255;
		return Math.round(a + (((to >> shift) & 255) - a) * step) << shift;
	};
	return channel(16) | channel(8) | channel(0);
}

function along(stops: readonly Color[], share: number): Color {
	const at = Math.max(0, Math.min(1, share)) * (stops.length - 1);
	const index = Math.min(stops.length - 2, Math.floor(at));
	return mix(stops[index] ?? WHITE, stops[index + 1] ?? WHITE, at - index);
}

/** The dome in eighth blocks, with a thin dark slit over the second row and a thicker one over the third. */
const SUN: readonly (readonly ({ readonly text: string; readonly bg?: Color } | null)[])[] = [0, 1, 2].map((row) =>
	Array.from({ length: SUN_WIDTH }, (_, x) => {
		const reach = (x - (SUN_WIDTH - 1) / 2) / (SUN_WIDTH / 2);
		const height = Math.round(Math.sqrt(1 - reach * reach) * 8 * SUN_ROWS);
		const fill = Math.max(0, Math.min(8, height - (SUN_ROWS - 1 - row) * 8));
		if (fill === 0) return null;
		if (fill < 8) return { text: "▁▂▃▄▅▆▇"[fill - 1] ?? "▇" };
		return row === 0 ? { text: "█" } : { text: row === 1 ? "▇" : "▆", bg: SLIT };
	}),
);

/** The sea `dx` cells from under the sun: waves that travel outward, brightest on the sun's path. */
function seaCell(dx: number, seconds: number, palette: Palette): Cell | null {
	const far = Math.abs(dx);
	const wave =
		Math.sin(far * 0.62 - seconds * 2.3) +
		0.8 * Math.sin(dx * 0.31 + seconds * 1.1) +
		0.6 * Math.sin(dx * 1.37 - seconds * 0.7);
	const level = wave * 0.62 + 1.05 - far / 34;
	if (level < 0.22) return null;
	const glyph = level > 1 ? "~" : level > 0.55 ? "-" : ".";
	const fg = mix(FAINT, along(palette.sea, far / 52), Math.min(1, 0.18 + level * 0.55));
	return { text: glyph, fg, ...(level > 1.5 ? { bold: true } : {}) };
}

/** What the scene does for this view; a notice or a finished plan draws none. */
export function sceneMood(view: HudView): SceneMood {
	const status: CardStatus | null = view.status;
	if (view.unreadable.length > 0 || (view.matches ?? 0) > 1) return null;
	if (view.session === null || status === null) return "wait";
	if (status.look === "done") return null;
	if (status.look === "turn" || status.look === "rewind") return status.look;
	return status.state === "ignited" && status.working ? "work" : "wait";
}

/** Terminals that draw the round caps themselves, whatever the font. */
export function drawsRoundCaps(env: NodeJS.ProcessEnv): boolean {
	return (env["WT_SESSION"] ?? "") !== "" || env["TERM_PROGRAM"] === "vscode";
}

/** A terminal that says its background is light (`COLORFGBG=0;15`). */
export function lightBackground(env: NodeJS.ProcessEnv): boolean {
	return /;(?:7|15)$/u.test(env["COLORFGBG"] ?? "");
}

const BLANK: Cell = { text: " ", blank: true };

function push(row: Cell[], text: string, width: number, style: Omit<Cell, "text">): void {
	if (width === 0) {
		const at = row.length - (row.at(-1)?.text === "" ? 2 : 1);
		const base = row[at];
		if (base !== undefined) row[at] = { ...base, text: base.text + text };
		return;
	}
	row.push({ ...style, text });
	if (width === 2) row.push({ text: "" });
}

/** The brand pill; round caps replace its two padding cells, so it is as wide either way. */
function brandPill(caps: boolean): Cell[] {
	const pieces = cells(PILL_TEXT);
	const row: Cell[] = [];
	pieces.forEach((piece, index) => {
		const fill = along(SUNSET, index / (pieces.length - 1));
		const edge = index === 0 ? CAP_LEFT : index === pieces.length - 1 ? CAP_RIGHT : null;
		if (caps && edge !== null) push(row, edge, 1, { fg: fill });
		else push(row, piece.text, piece.width, { fg: INK, bg: fill, bold: true });
	});
	return row;
}

/** Cells `from` up to `to` as a pill graded along `stops`, in dark ink; nothing moves. */
function gradePill(row: Cell[], from: number, to: number, stops: readonly Color[], caps: boolean): void {
	const left = row[from]?.text === " ";
	const right = row[to - 1]?.text === " ";
	for (let x = from; x < to; x++) {
		const cell = row[x];
		if (cell === undefined || cell.text === "") continue;
		const fill = along(stops, (x - from) / Math.max(1, to - from - 1));
		const cap = x === from && left ? CAP_LEFT : x === to - 1 && right ? CAP_RIGHT : null;
		row[x] = caps && cap !== null ? { text: cap, fg: fill } : { text: cell.text, fg: INK, bg: fill, bold: true };
	}
}

/** Each gauge (`▰▰▱▱▱`, `[▉▉░░░]`) as one rounded bar over exactly the cells it already has. */
function roundGauges(row: Cell[]): void {
	const plain = row.map((cell) => cell.text).map((text) => (text.length === 1 ? text : " "));
	for (const found of plain.join("").matchAll(/[▰▱]{3,}|\[[▉░]{2,}\]/gu)) {
		const [start, size] = [found.index, found[0].length];
		const bracketed = found[0].startsWith("[");
		const filled = (x: number): boolean => {
			const glyph = found[0][bracketed ? Math.max(1, Math.min(size - 2, x)) : x];
			return glyph === "▰" || glyph === "▉";
		};
		for (let x = 0; x < size; x++) {
			const color = filled(x) ? along(SUNSET, x / size) : TRACK;
			const cap = x === 0 ? CAP_LEFT : x === size - 1 ? CAP_RIGHT : null;
			row[start + x] = cap === null ? { text: " ", bg: color } : { text: cap, fg: color };
		}
	}
}

/** One line of the card as cells, cut to `width`, with its pills and gauges. */
function textRow(line: HudLine, index: number, mood: SceneMood, options: SceneOptions): Cell[] {
	const row: Cell[] = [];
	let text = clean(line.text);
	const room = options.width - displayWidth(PILL_TEXT);
	if (index === 0 && room >= 2) {
		row.push(...brandPill(options.caps));
		text = fit(text.startsWith(BRAND) ? text.slice(BRAND.length).trimStart() : text, room);
	} else {
		text = fit(text, options.width);
	}
	let tint = 0;
	let offset = 0;
	const [stageStart, stageEnd] = text.startsWith(line.text.slice(0, line.stage?.[1])) ? (line.stage ?? []) : [];
	let pill: [number, number] | null = null;
	for (const piece of cells(text)) {
		if (offset === stageStart) pill = [row.length, row.length];
		const rainbow = `${BOLD}\u001b[38;5;${RAINBOW[tint % RAINBOW.length]}m`;
		const sgr = line.rainbow !== true ? line.style : piece.text === " " ? BOLD : rainbow;
		if (line.rainbow === true && piece.text !== " ") tint++;
		push(row, piece.text, piece.width, { sgr });
		offset += piece.text.length;
		if (offset === stageEnd && pill !== null) pill[1] = row.length;
	}
	if (options.caps) roundGauges(row);
	if (pill !== null && pill[1] > pill[0] && mood !== "rewind") {
		const stage = (mood === "turn" ? AMBER : DUSK).stage;
		const stops = mood === "work" || mood === "turn" ? stage : stage.map((color) => mix(color, MUTED, 0.25));
		if (pill[0] > 0) pill[0]--;
		if (row[pill[1]]?.text === " ") pill[1]++;
		gradePill(row, pill[0], pill[1], stops, options.caps);
	}
	return row;
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

/** The row as text: cells that look alike share one escape, and trailing blanks are dropped. */
function rowText(row: readonly Cell[]): string {
	let end = row.length;
	while (end > 0 && row[end - 1]?.blank === true) end--;
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

/** The card and its scene, laid out once for this text and window. */
export function composeScene(lines: readonly HudLine[], mood: SceneMood, options: SceneOptions): HudScene {
	const width = Math.max(10, Math.floor(options.width));
	const span = Math.min(width, SCENE_MAX);
	const text = lines.map((line, index) => textRow(line, index, mood, { ...options, width }));
	const textRows = text.map(rowText);
	// The rule closes the scene one row under the sea, and never shares a row with text.
	const rule = Math.min(text.length + SUN_ROWS + 1, options.rows - 1);
	const ruled = rule >= text.length;
	const top = (ruled ? rule : text.length) - SUN_ROWS;
	const sunLeft = Math.round(span * 0.62);
	if (mood === null || span < SCENE_MIN || text.length > options.rows || top < 0) {
		return { moving: false, paint: () => textRows };
	}
	const taken = (y: number, x: number): boolean => {
		const cell = text[y]?.[x];
		return cell !== undefined && cell.blank !== true;
	};
	const clear = (y: number, from: number, to: number): boolean => {
		for (let x = from; x <= to; x++) if (taken(y, x)) return false;
		return true;
	};
	const open = Array.from({ length: SUN_ROWS + 1 }, (_, row) =>
		Array.from({ length: span }, (_, x) => clear(top - 1 + row, x - CLEAR, x + CLEAR)),
	);
	const free = (row: number, x: number): boolean => open[row + 1]?.[x] === true;
	const sun = [0, 1, 2].every((row) => clear(top + row, sunLeft - SUN_CLEAR, sunLeft + SUN_WIDTH + SUN_CLEAR - 1));
	const moving = mood === "work";
	const palette = mood === "turn" ? AMBER : DUSK;
	const wheel = (x: number): Color => along(WHEEL, (((x / span) % 1) + 1) % 1);
	const shade = (color: Color): Color => (mood === "wait" ? mix(color, FAINT, 0.6) : color);
	const middle = sunLeft + SUN_WIDTH / 2 - 0.5;

	const paint = (seconds: number): string[] => {
		const grid = Array.from({ length: SUN_ROWS + 2 }, (_, row) => {
			const cut = [...(text[top - 1 + row] ?? [])];
			while (cut.length < span) cut.push(BLANK);
			return cut;
		});
		const put = (row: number, x: number, cell: Cell): void => {
			const cut = grid[row + 1];
			if (cut !== undefined && x >= 0 && x < span) cut[x] = cell;
		};
		if (sun) {
			for (const [row, dx] of STARS) {
				const x = sunLeft + dx;
				if (!free(row, x) || (row < 0 && top - 1 < text.length)) continue;
				const twinkle = 0.5 + 0.5 * Math.sin(seconds * 1.7 + dx * 2.1);
				const glyph = twinkle > 0.85 ? "*" : twinkle > 0.45 ? "+" : ".";
				const color = mood === "rewind" ? wheel(x) : dx % 2 === 0 ? 0xff9ad5 : 0xa99bff;
				put(row, x, { text: glyph, fg: mix(FAINT, shade(color), 0.35 + 0.65 * twinkle) });
			}
			const dash = seconds % DASH_EVERY;
			if (moving && seconds >= DASH_EVERY && dash < DASH_SECONDS) {
				const head = Math.round(sunLeft + SUN_WIDTH + 22 - (dash / DASH_SECONDS) * 34);
				[...DASH].forEach((glyph, index) => {
					if (!free(0, head + index)) return;
					put(0, head + index, {
						text: glyph,
						fg: mix(0xfff4e0, 0xb457d6, index / 3),
						...(index === 0 ? { bold: true } : {}),
					});
				});
			}
		}
		if (sun || moving) {
			for (let x = 0; x < span; x++) {
				const cell = free(2, x) ? seaCell(x - middle, seconds, palette) : null;
				if (cell === null) continue;
				const color = mood === "rewind" ? mix(FAINT, wheel(x), 0.75) : shade(cell.fg ?? FAINT);
				put(2, x, { ...cell, fg: color });
			}
		}
		if (sun) {
			SUN.forEach((line, row) => {
				line.forEach((cell, x) => {
					if (cell === null) return;
					// Heat: light runs up the sun and ripples across it.
					const heat = 0.5 + 0.5 * Math.sin(seconds * 2.1 + row * 1.5 + 0.55 * Math.sin(x * 0.8 + seconds * 1.6));
					const [rest, lit] = palette.sun[row] ?? [WHITE, WHITE];
					const fg =
						mood === "rewind"
							? mix(along(WHEEL, x / SUN_WIDTH / 1.2 + row * 0.08), WHITE, 0.3)
							: shade(mix(rest, lit, moving ? heat : 0.25));
					put(row, sunLeft + x, { ...cell, fg });
				});
			});
		}
		if (ruled) {
			const breath = moving ? 0.1 + 0.1 * Math.sin(seconds * 1.4) : 0;
			for (let x = 0; x < span; x++) {
				const at = Math.floor(x / 4) * 4;
				let color = mood === "rewind" ? wheel(at) : along(palette.rule, at / span);
				color = mix(color, WHITE, breath);
				// Under the sun the rule is water: rings of its light run outward along it.
				const dx = at - middle;
				const near = Math.max(0, 1 - Math.abs(dx) / 26);
				if (sun && mood !== "rewind" && near > 0) {
					const ring = 0.5 + 0.5 * Math.sin(Math.abs(dx) * 0.55 - seconds * 2.6);
					color = mix(color, near > 0.6 ? 0xffd24a : 0xff8f3c, Math.min(1, near * (0.45 + 0.85 * ring)));
				}
				put(SUN_ROWS, x, { text: "─", fg: mood === "wait" ? mix(color, FAINT, 0.45) : color });
			}
		}
		const out = [...textRows];
		grid.forEach((row, index) => {
			const y = top - 1 + index;
			if (y >= 0 && (ruled || y < text.length)) out[y] = rowText(row);
		});
		for (let y = 0; y < out.length; y++) out[y] ??= "";
		return out;
	};
	return { moving, paint };
}
