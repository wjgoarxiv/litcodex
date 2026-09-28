// Single-stroke plotter type from the five EMS SVG fonts (MO-FT-08), written progressively by a
// pen whose travel follows the timeline's own character timing. Method adapted from the credited
// engine's stroke module; the Hershey faces are excluded and never loaded.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL_ROOT, STROKE_FONTS } from "./fonts.mjs";

const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value) =>
	value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (_, name) =>
		name[0] === "#"
			? String.fromCodePoint(name[1].toLowerCase() === "x" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1)))
			: (ENTITY[name] ?? `&${name};`),
	);
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1];

/** Flatten an SVG path (absolute M, L, C) into polylines in font units, y up. */
export function flattenPath(d, curveSteps = 8) {
	const tokens = d.match(/[MLCmlc]|-?\d*\.?\d+(?:e[-+]?\d+)?/giu) ?? [];
	const strokes = [];
	let current = null;
	let command = "M";
	let x = 0;
	let y = 0;
	let i = 0;
	const num = () => Number.parseFloat(tokens[i++]);
	while (i < tokens.length) {
		if (/^[MLC]$/iu.test(tokens[i])) {
			command = tokens[i++].toUpperCase();
			continue;
		}
		if (command === "M") {
			x = num();
			y = num();
			current = [[x, y]];
			strokes.push(current);
			command = "L";
		} else if (command === "L") {
			x = num();
			y = num();
			current?.push([x, y]);
		} else {
			const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
			for (let s = 1; s <= curveSteps; s++) {
				const t = s / curveSteps;
				const u = 1 - t;
				current?.push([
					u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
					u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
				]);
			}
			x = x3;
			y = y3;
		}
	}
	return strokes.filter((stroke) => stroke.length > 0);
}

export function parseStrokeFont(svg) {
	const face = /<font-face[^>]*>/u.exec(svg)?.[0] ?? "";
	const fontTag = /<font\s[^>]*>/u.exec(svg)?.[0] ?? "";
	const defaultAdvance = Number(attr(fontTag, "horiz-adv-x") ?? 500);
	const glyphs = new Map();
	for (const match of svg.matchAll(/<glyph\b[^>]*>/gu)) {
		const tag = match[0];
		const unicode = attr(tag, "unicode");
		if (unicode === undefined) continue;
		glyphs.set(decode(unicode), {
			advance: Number(attr(tag, "horiz-adv-x") ?? defaultAdvance),
			strokes: flattenPath(attr(tag, "d") ?? ""),
		});
	}
	const font = { upm: Number(attr(face, "units-per-em") ?? 1000), defaultAdvance, glyphs, kern: new Map() };
	addTypographicGlyphs(font);
	const H = inkBox(glyphs.get("H")?.strokes ?? [[[0, 0], [0, 700]]]);
	const xg = inkBox(glyphs.get("x")?.strokes ?? [[[0, 0], [0, 450]]]);
	font.capTop = H[3];
	font.xTop = xg[3];
	font.baseline = H[1];
	return font;
}

function inkBox(strokes) {
	let box = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const stroke of strokes)
		for (const [x, y] of stroke) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
	return box;
}

/** Curly quotes and an ellipsis built from the face's own ' and . glyphs. */
function addTypographicGlyphs(font) {
	const quote = font.glyphs.get("'");
	const dot = font.glyphs.get(".");
	if (quote?.strokes.length) {
		const b = inkBox(quote.strokes);
		const cx = (b[0] + b[2]) / 2;
		const cy = (b[1] + b[3]) / 2;
		const turned = { advance: quote.advance, strokes: quote.strokes.map((s) => s.map(([x, y]) => [2 * cx - x, 2 * cy - y])) };
		const double = (g) => {
			const shift = b[2] - b[0] + 0.07 * font.upm;
			return { advance: g.advance + shift, strokes: [...g.strokes, ...g.strokes.map((s) => s.map(([x, y]) => [x + shift, y]))] };
		};
		if (!font.glyphs.has("’")) font.glyphs.set("’", quote);
		if (!font.glyphs.has("‘")) font.glyphs.set("‘", turned);
		if (!font.glyphs.has("”")) font.glyphs.set("”", double(quote));
		if (!font.glyphs.has("“")) font.glyphs.set("“", double(turned));
	}
	if (dot && !font.glyphs.has("…")) {
		const step = dot.advance * 0.72;
		font.glyphs.set("…", {
			advance: dot.advance + 2 * step,
			strokes: [0, 1, 2].flatMap((k) => dot.strokes.map((s) => s.map(([x, y]) => [x + k * step, y]))),
		});
	}
}

// Optical pair kerning for the disconnected faces: shapes that leave a hole (overhangs, diagonals)
// move in part of the way toward the face's own n/o spacing over the shared x-height or cap zone,
// never by more than 0.12 em. Connected scripts are never kerned.
const OPEN_RIGHT = new Set("AFLPTVWYKXfrvwyk7'\"’”");
const OPEN_LEFT = new Set("AJTVWYXvwyj.,'\"’”…");
const BANDS = 60;

function profile(font, char) {
	const glyph = font.glyphs.get(char);
	if (!glyph?.strokes.length) return null;
	const lo = -0.3 * font.upm;
	const dy = (1.3 * font.upm) / BANDS;
	const left = new Float64Array(BANDS).fill(Number.NaN);
	const right = new Float64Array(BANDS).fill(Number.NaN);
	const put = (x, y) => {
		const band = Math.floor((y - lo) / dy);
		if (band < 0 || band >= BANDS) return;
		if (!(left[band] <= x)) left[band] = x;
		if (!(right[band] >= x)) right[band] = x;
	};
	for (const stroke of glyph.strokes)
		for (let k = 0; k < stroke.length; k++) {
			put(stroke[k][0], stroke[k][1]);
			if (k === 0) continue;
			const [ax, ay] = stroke[k - 1];
			const [bx, by] = stroke[k];
			const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (dy * 0.4)));
			for (let j = 1; j < n; j++) put(ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n);
		}
	return { left, right, lo, dy };
}

function approach(font, a, b, top) {
	const pa = profile(font, a);
	const pb = profile(font, b);
	if (!pa || !pb) return null;
	const advance = font.glyphs.get(a).advance;
	let min = Number.POSITIVE_INFINITY;
	const from = Math.max(0, Math.floor((font.baseline - pa.lo) / pa.dy));
	const to = Math.min(BANDS - 1, Math.floor((top - pa.lo) / pa.dy));
	for (let band = from; band <= to; band++) {
		if (!Number.isNaN(pa.right[band]) && !Number.isNaN(pb.left[band])) min = Math.min(min, advance + pb.left[band] - pa.right[band]);
	}
	return Number.isFinite(min) ? min : null;
}

export function pairKern(font, a, b) {
	if (a === " " || b === " " || !(OPEN_RIGHT.has(a) || OPEN_LEFT.has(b))) return 0;
	const key = a + b;
	if (font.kern.has(key)) return font.kern.get(key);
	const lower = a !== a.toUpperCase() || b !== b.toUpperCase();
	const top = lower ? font.xTop : font.capTop;
	const reference = ["no", "on", "nn", "oo"].map((p) => approach(font, p[0], p[1], font.xTop) ?? 0);
	const target = reference.reduce((s, v) => s + v, 0) / reference.length;
	const gap = approach(font, a, b, top);
	const kern = gap === null ? 0 : Math.max(-0.12 * font.upm, Math.min(0, 0.6 * (target - gap)));
	font.kern.set(key, kern);
	return kern;
}

const cache = new Map();
export function loadStrokeFont(key) {
	if (!cache.has(key)) {
		const entry = STROKE_FONTS.find((item) => item.key === key);
		if (!entry) throw new Error(`unknown stroke font: ${key}`);
		cache.set(key, { ...parseStrokeFont(readFileSync(join(SKILL_ROOT, entry.file), "utf8")), key, connected: entry.connected, file: entry.file });
	}
	return cache.get(key);
}

/**
 * Lay out text in a stroke face at `sizePx` (em size). Returns polylines in px (origin left
 * baseline, y down), per-character length ranges for pen timing, and the ink box.
 */
export function strokeText(font, text, sizePx, trackingPx = 0) {
	const scale = sizePx / font.upm;
	const chars = Array.from(text);
	const strokes = [];
	const owner = [];
	let x = 0;
	for (let i = 0; i < chars.length; i++) {
		const glyph = font.glyphs.get(chars[i]);
		for (const stroke of glyph?.strokes ?? []) {
			strokes.push(stroke.map(([gx, gy]) => [x + gx * scale, -gy * scale]));
			owner.push(i);
		}
		x += (glyph?.advance ?? font.defaultAdvance) * scale + trackingPx;
		if (!font.connected && i + 1 < chars.length) x += pairKern(font, chars[i], chars[i + 1]) * scale;
	}
	const lengths = strokes.map((stroke) => {
		const acc = [0];
		for (let k = 1; k < stroke.length; k++) acc.push(acc[k - 1] + Math.hypot(stroke[k][0] - stroke[k - 1][0], stroke[k][1] - stroke[k - 1][1]));
		return acc;
	});
	const starts = [];
	let total = 0;
	for (const acc of lengths) {
		starts.push(total);
		total += acc[acc.length - 1];
	}
	const charRange = chars.map(() => [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
	strokes.forEach((_, k) => {
		const range = charRange[owner[k]];
		range[0] = Math.min(range[0], starts[k]);
		range[1] = Math.max(range[1], starts[k] + lengths[k][lengths[k].length - 1]);
	});
	let last = 0;
	for (const range of charRange) {
		if (!Number.isFinite(range[0])) range.splice(0, 2, last, last);
		last = range[1];
	}
	const box = strokes.length ? inkBox(strokes) : [0, 0, 0, 0];
	return { text, sizePx, strokes, starts, lengths, total, charRange, width: x - trackingPx, ink: box, capHeight: font.capTop * scale, missing: chars.filter((c) => c !== " " && !font.glyphs.has(c)) };
}

/** Pen travel at time t from per-character [start, end] times (MO-A-08 method, any timing tier). */
export function writtenLength(layout, charTimes, t) {
	let length = 0;
	for (let i = 0; i < layout.charRange.length; i++) {
		const [a, b] = layout.charRange[i];
		const [t0, t1] = charTimes[i] ?? [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
		if (t >= t1) length = b;
		else if (t > t0) return a + (b - a) * ((t - t0) / Math.max(1e-3, t1 - t0));
		else break;
	}
	return length;
}

/** The first `length` px of every stroke, as flat [x, y, x, y, ...] arrays offset by (ox, oy). */
export function partialStrokes(layout, length, ox, oy) {
	const out = [];
	for (let k = 0; k < layout.strokes.length; k++) {
		const start = layout.starts[k];
		if (start >= length) break;
		const stroke = layout.strokes[k];
		const acc = layout.lengths[k];
		const remain = length - start;
		const flat = [ox + stroke[0][0], oy + stroke[0][1]];
		let j = 1;
		for (; j < stroke.length && acc[j] <= remain; j++) flat.push(ox + stroke[j][0], oy + stroke[j][1]);
		if (j < stroke.length) {
			const u = (remain - acc[j - 1]) / Math.max(1e-6, acc[j] - acc[j - 1]);
			flat.push(ox + stroke[j - 1][0] + (stroke[j][0] - stroke[j - 1][0]) * u, oy + stroke[j - 1][1] + (stroke[j][1] - stroke[j - 1][1]) * u);
		}
		out.push(flat);
	}
	return out;
}
