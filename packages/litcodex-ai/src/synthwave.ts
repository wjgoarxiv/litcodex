// The Synthwave LIT mark for human-facing CLI screens (install, doctor, help, postinstall).
// Never put it in hook systemMessage, additionalContext, activation messages or any model-visible text.

import { MONO_ROWS, PIXEL_ROWS, SHARED_COLOURS } from "./synthwave-data.js";

export const HOST_LABEL = "codex cli";
export const FALLBACK_LINE = `LIT · ${HOST_LABEL}`;
/** LitCodex chrome: mint at the top of each letter, deep emerald at its base. */
export const CHROME_STOPS: readonly string[] = ["#eafff2", "#7cf5b0", "#10b981", "#ffffff", "#a7f3d0", "#047857"];
const TAGLINE_STOPS: readonly string[] = ["#8be9fd", "#ff2d95", "#ffd23f"];
const EDGE = "#ffffff";
const DEFAULT_COLUMNS = 80;

export type SynthwaveSize = keyof typeof PIXEL_ROWS;
export type SynthwaveMode = "truecolor" | "256" | "mono" | "plain";

/** Largest first; each size needs at least `minCols` terminal cells. */
export const SIZES: readonly { readonly name: SynthwaveSize; readonly minCols: number }[] = [
	{ name: "B-L", minCols: 76 },
	{ name: "B-M", minCols: 44 },
	{ name: "B-S", minCols: 24 },
];

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
	const channel = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16);
	return [channel(1), channel(3), channel(5)];
}

/** The colour at `t` (0..1) along evenly spaced stops, piecewise linear. */
export function sampleStops(stops: readonly string[], t: number): Rgb {
	const segments = stops.length - 1;
	const index = Math.min(segments - 1, Math.max(0, Math.floor(t * segments)));
	const local = t * segments - index;
	const start = hexToRgb(stops[index] ?? EDGE);
	const end = hexToRgb(stops[index + 1] ?? EDGE);
	const mix = (channel: 0 | 1 | 2): number => Math.round(start[channel] + (end[channel] - start[channel]) * local);
	return [mix(0), mix(1), mix(2)];
}

function pixelColour(symbol: string): Rgb | null {
	if (symbol === " ") return null;
	if (symbol >= "a" && symbol <= "l") return sampleStops(CHROME_STOPS, (symbol.charCodeAt(0) - 97) / 11);
	if (symbol === "m") return hexToRgb(EDGE);
	const shared = (SHARED_COLOURS as Readonly<Record<string, string>>)[symbol];
	return shared ? hexToRgb(shared) : null;
}

/** xterm 256-colour cube index (16 + 36r + 6g + b). */
function cubeIndex(colour: Rgb): number {
	const level = (channel: 0 | 1 | 2): number => Math.round((colour[channel] / 255) * 5);
	return 16 + 36 * level(0) + 6 * level(1) + level(2);
}

function sgr(colour: Rgb, layer: 38 | 48, mode: "truecolor" | "256"): string {
	return mode === "truecolor" ? `${layer};2;${colour.join(";")}` : `${layer};5;${cubeIndex(colour)}`;
}

function paint(glyph: string, fg: Rgb | null, bg: Rgb | null, mode: "truecolor" | "256"): string {
	const codes = [fg ? sgr(fg, 38, mode) : "", bg ? sgr(bg, 48, mode) : ""].filter((code) => code !== "");
	return codes.length === 0 ? glyph : `\x1b[${codes.join(";")}m${glyph}\x1b[0m`;
}

function sameColour(a: Rgb | null, b: Rgb | null): boolean {
	return a === b || (a !== null && b !== null && a.every((value, channel) => value === b[channel]));
}

/** The size that fits `columns`, or null below B-S. Unknown or invalid widths count as 80. */
export function pickSize(columns: number | undefined): SynthwaveSize | null {
	const width = columns !== undefined && Number.isFinite(columns) && columns > 0 ? columns : DEFAULT_COLUMNS;
	return SIZES.find((size) => width >= size.minCols)?.name ?? null;
}

function cellRows(size: SynthwaveSize, mode: "truecolor" | "256"): string[] {
	const pixels = PIXEL_ROWS[size];
	const rows: string[] = [];
	for (let y = 0; y + 1 < pixels.length; y += 2) {
		const upperRow = pixels[y] ?? "";
		const lowerRow = pixels[y + 1] ?? "";
		let line = "";
		for (let x = 0; x < upperRow.length; x++) {
			const upper = pixelColour(upperRow[x] ?? " ");
			const lower = pixelColour(lowerRow[x] ?? " ");
			if (sameColour(upper, lower)) line += upper ? paint(" ", null, upper, mode) : " ";
			else if (upper === null) line += paint("▄", lower, null, mode);
			else line += paint("▀", upper, lower, mode);
		}
		rows.push(line);
	}
	return rows;
}

function taglineRow(width: number, mode: "truecolor" | "256" | "mono"): string {
	const pad = " ".repeat(Math.max(0, Math.floor((width - FALLBACK_LINE.length) / 2)));
	if (mode === "mono") return `${pad}${FALLBACK_LINE}`;
	const glyphs = [...FALLBACK_LINE];
	const last = glyphs.length - 1;
	return (
		pad +
		glyphs
			.map((glyph, index) =>
				glyph === " " ? glyph : paint(glyph, sampleStops(TAGLINE_STOPS, last === 0 ? 0 : index / last), null, mode),
			)
			.join("")
	);
}

/**
 * The mark's rows for a terminal `columns` wide: the art plus one centred tagline, or the single plain
 * line below 24 columns or in `plain` mode. `mono` prints the spec's glyph scene with no escape bytes.
 */
export function synthwaveRows(opts: { readonly columns?: number | undefined; readonly mode: SynthwaveMode }): string[] {
	const size = pickSize(opts.columns);
	if (opts.mode === "plain" || size === null) return [FALLBACK_LINE];
	const art = opts.mode === "mono" ? [...MONO_ROWS[size]] : cellRows(size, opts.mode);
	return [...art, taglineRow((PIXEL_ROWS[size][0] ?? "").length, opts.mode)];
}
