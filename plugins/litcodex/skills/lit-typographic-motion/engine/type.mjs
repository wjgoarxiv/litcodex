// Type kit: typographic punctuation, Unicode script runs, 어절 breaks, the one reading-floor
// function, and kerned glyph layout from real outlines (opentype.js, injected so the pure parts of
// this module run without the runtime cache). Method adapted from the credited engine's type module:
// per-glyph positions come from the kerned run, never from measuring a slice (MO-A-32).
import { READING } from "./constants.mjs";

const HANGUL_SYLLABLE = /[가-힣]/u;
const HANGUL_ANY = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힣ힰ-퟿]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/** Typewriter punctuation to typographic (MO-A-34), over the brief's own text only. */
export function smart(text) {
	return String(text)
		.replace(/\.\.\./gu, "…")
		.replace(/(\p{L}|\p{N})'(?=\p{L})/gu, "$1’")
		.replace(/(^|[\s([{—–-])'(?=(?:\d0s|em|til|cause|round|tis|twas)\b)/giu, "$1’")
		.replace(/(^|[\s([{—–-])'/gu, "$1‘")
		.replace(/'/gu, "’")
		.replace(/(^|[\s([{—–-])"/gu, "$1“")
		.replace(/"/gu, "”");
}

/** Typographic punctuation back to typewriter form, for a typed-input mono voice. */
export const plain = (text) =>
	String(text).replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/…/gu, "...");

/** 'hangul' | 'latin' | 'neutral' (digits, punctuation, spaces and symbols belong to no run). */
export function charScript(char) {
	if (HANGUL_ANY.test(char)) return "hangul";
	if (LATIN_LETTER.test(char)) return "latin";
	return "neutral";
}

/**
 * Split text into script runs (MO-FT-04). A neutral character joins the run beside it; between two
 * different runs it falls back to the run on its left; with no left run it joins the right one.
 */
export function scriptRuns(text) {
	const chars = Array.from(String(text));
	const classes = chars.map(charScript);
	const resolved = classes.slice();
	for (let i = 0; i < chars.length; i++) {
		if (classes[i] !== "neutral") continue;
		let left = null;
		for (let j = i - 1; j >= 0; j--) if (resolved[j] !== "neutral") { left = resolved[j]; break; }
		let right = null;
		for (let j = i + 1; j < chars.length; j++) if (classes[j] !== "neutral") { right = classes[j]; break; }
		resolved[i] = left ?? right ?? "latin";
	}
	const runs = [];
	for (let i = 0; i < chars.length; i++) {
		const last = runs[runs.length - 1];
		if (last && last.script === resolved[i]) last.text += chars[i];
		else runs.push({ script: resolved[i], text: chars[i], start: i });
	}
	for (const run of runs) run.end = run.start + Array.from(run.text).length;
	return runs;
}

export function scriptOf(text) {
	const hasHangul = HANGUL_ANY.test(text);
	const hasLatin = LATIN_LETTER.test(text);
	return hasHangul && hasLatin ? "mixed" : hasHangul ? "hangul" : "latin";
}

/** Break candidates are whitespace only: a 어절 is never split (MO-A-13, MO-FT-05). */
export const eojeols = (text) => String(text).trim().split(/\s+/u).filter(Boolean);

/** H Hangul syllables, W Latin words, C Latin-run characters including spaces (MO-C-07/08). */
export function countUnits(text) {
	const value = String(text);
	const H = Array.from(value).filter((c) => HANGUL_SYLLABLE.test(c)).length;
	const W = (value.match(/[\p{Script=Latin}\p{Nd}'’-]+/gu) ?? []).filter((w) => /[\p{Script=Latin}\p{Nd}]/u.test(w)).length;
	const C = scriptRuns(value)
		.filter((run) => run.script === "latin")
		.reduce((sum, run) => sum + Array.from(run.text).length, 0);
	return { H, W, C };
}

/** The one reading-floor function (seconds) for a timeline unit of the given kind. */
export function readingFloor(text, kind) {
	if (kind === "reveal") return READING.revealFloor;
	const { H, W } = countUnits(text);
	const rate = READING.secondsPerHangulSyllable * H + W / READING.wordsPerSecond;
	if (kind === "word") return Math.max(READING.wordFloor, rate);
	return Math.max(H > 0 ? READING.lineFloorHangul : READING.lineFloorLatin, rate);
}

/** Loaded opentype.js faces plus a glyph registry the browser rasterizer consumes. */
export class FontBook {
	constructor(opentype, files) {
		this.opentype = opentype;
		this.files = files;
		this.fonts = new Map();
		this.glyphs = new Map();
	}

	font(key) {
		let font = this.fonts.get(key);
		if (!font) {
			const bytes = this.files[key]?.bytes;
			if (!bytes) throw new Error(`font not loaded: ${key}`);
			font = this.opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
			this.fonts.set(key, font);
		}
		return font;
	}

	metrics(key) {
		const font = this.font(key);
		const cap = font.tables.os2?.sCapHeight || font.charToGlyph("H").getBoundingBox().y2;
		return { upm: font.unitsPerEm, ascent: font.ascender, descent: font.descender, capHeight: cap };
	}

	/** Glyph for a character, or null when the face has no mapping (.notdef). */
	glyph(key, char) {
		const font = this.font(key);
		const glyph = font.charToGlyph(char);
		if (!glyph || glyph.index === 0) return null;
		const id = `${key}#${glyph.index}`;
		if (!this.glyphs.has(id)) {
			const box = glyph.getBoundingBox();
			const path = glyph.getPath(0, 0, font.unitsPerEm);
			this.glyphs.set(id, {
				id,
				d: path.commands.length ? path.toPathData(2) : "",
				box: [box.x1, -box.y2, box.x2, -box.y1],
				empty: path.commands.length === 0,
			});
		}
		return { id, index: glyph.index, advance: glyph.advanceWidth, glyph, entry: this.glyphs.get(id) };
	}

	kerning(key, left, right) {
		if (!left || !right) return 0;
		return this.font(key).getKerningValue(left.glyph, right.glyph) || 0;
	}
}

/**
 * Kerned layout of one line. `voice` maps a script to a font key; Hangul runs always get zero
 * tracking (MO-FT-04). Positions are in px from the left baseline origin.
 */
export function layoutLine(book, text, voice, sizePx, trackingEm = 0) {
	const glyphs = [];
	const runs = [];
	const missing = [];
	let x = 0;
	let ink = null;
	let capHeight = 0;
	let ascent = 0;
	let descent = 0;
	for (const run of scriptRuns(text)) {
		const key = voice[run.script] ?? voice.latin;
		const m = book.metrics(key);
		const scale = sizePx / m.upm;
		const tracking = run.script === "hangul" ? 0 : trackingEm * sizePx;
		capHeight = Math.max(capHeight, m.capHeight * scale);
		ascent = Math.max(ascent, m.ascent * scale);
		descent = Math.min(descent, m.descent * scale);
		runs.push({ script: run.script, fontKey: key, start: run.start, end: run.end, trackingEm: run.script === "hangul" ? 0 : trackingEm });
		let previous = null;
		const chars = Array.from(run.text);
		for (let i = 0; i < chars.length; i++) {
			const char = chars[i];
			const g = book.glyph(key, char);
			if (!g) {
				if (!/\s/u.test(char)) missing.push({ char, fontKey: key });
				x += (m.upm / 3) * scale;
				previous = null;
				continue;
			}
			x += book.kerning(key, previous, g) * scale;
			glyphs.push({ char, id: g.id, x, s: scale, run: runs.length - 1, advance: g.advance * scale });
			if (!g.entry.empty) {
				const b = g.entry.box;
				ink = ink ? [Math.min(ink[0], x + b[0] * scale), Math.min(ink[1], b[1] * scale), Math.max(ink[2], x + b[2] * scale), Math.max(ink[3], b[3] * scale)] : [x + b[0] * scale, b[1] * scale, x + b[2] * scale, b[3] * scale];
			}
			x += g.advance * scale + (i < chars.length - 1 ? tracking : 0);
			previous = g;
		}
	}
	return { text, sizePx, width: x, glyphs, runs, missing, ink: ink ?? [0, 0, 0, 0], capHeight, ascent, descent: -descent };
}

/** x of glyph `index` in a kerned run: where to start drawing text[index..] when a word is split. */
export function glyphX(layout, index) {
	if (index <= 0) return 0;
	if (index >= layout.glyphs.length) return layout.width;
	return layout.glyphs[index].x;
}

/**
 * Break text into lines no wider than maxWidth, only at whitespace, then shrink the size until the
 * widest 어절 fits. Returns { sizePx, lines: [layout...] }.
 */
export function fitBlock(book, text, voice, { maxWidth, sizePx, minSizePx = 28, maxLines = 3, trackingEm = 0 }) {
	for (let size = sizePx; size >= minSizePx; size = Math.floor(size * 0.94)) {
		const words = eojeols(text);
		const lines = [];
		let current = "";
		let overflow = false;
		for (const word of words) {
			const candidate = current ? `${current} ${word}` : word;
			if (layoutLine(book, candidate, voice, size, trackingEm).width <= maxWidth) current = candidate;
			else {
				if (!current) { overflow = true; break; }
				lines.push(current);
				current = word;
				if (layoutLine(book, current, voice, size, trackingEm).width > maxWidth) { overflow = true; break; }
			}
		}
		if (current && !overflow) lines.push(current);
		if (!overflow && lines.length <= maxLines) return { sizePx: size, lines: lines.map((line) => layoutLine(book, line, voice, size, trackingEm)) };
	}
	throw new Error(`text does not fit the title-safe width at ${minSizePx}px: ${text}`);
}

/** Pre-flight glyph coverage (MO-D-04): every codepoint must resolve in its script's face. */
export function missingGlyphs(book, text, voices) {
	const missing = [];
	const seen = new Set();
	for (const voice of voices) {
		for (const run of scriptRuns(smart(text))) {
			const key = voice[run.script] ?? voice.latin;
			for (const char of Array.from(run.text)) {
				if (/\s/u.test(char) || seen.has(`${key}:${char}`)) continue;
				seen.add(`${key}:${char}`);
				if (!book.glyph(key, char)) missing.push({ char, codepoint: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`, fontKey: key });
			}
		}
	}
	return missing;
}
