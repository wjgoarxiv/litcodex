// The cover gate, measured on the DECODED cover (the animated WebP a browser will show, or the GIF
// fallback), never only on the frames that went into the encoder: G0 determinism, G1 budget and loop,
// G2 motion energy, G3 anti-slide, G4 seam, G5 title contrast and G6 title cap height. The encoder
// merges identical frames into one long frame, so every motion number runs on a fixed time grid and
// a slide film cannot look busy by frame count. Two tiers: FLOOR fails a cover; TARGET is what cover
// mode delivers, and the strict verdict needs it, the 2 MiB size included. Thresholds: COVER in
// constants.mjs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { COVER } from "./constants.mjs";
import { lumaGrid } from "./cover-image.mjs";
import { decodePng } from "./image.mjs";
import { which } from "./runtime.mjs";
import { decodeWebp } from "./webp.mjs";

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, p) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const meanStep = (a, b) => {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / a.length / 255;
};

/** A PNG on disk as { width, height, rgba } (grey PNGs expand to RGBA). */
export function readPngRgba(file) {
	const png = decodePng(readFileSync(file));
	if (png.channels === 4) return { width: png.width, height: png.height, rgba: png.pixels };
	const rgba = Buffer.alloc(png.width * png.height * 4, 255);
	for (let i = 0; i < png.width * png.height; i++) rgba.fill(png.pixels[i], i * 4, i * 4 + 3);
	return { width: png.width, height: png.height, rgba };
}

/** The `<prefix>NNNN.png` frames of a folder, in order. */
export const frameFiles = (dir, prefix = "f") => (dir && existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith(".png")).sort().map((n) => join(dir, n)) : []);

/** What a GIF's container says that a decoder pipe drops: per-frame delays (ms) and the loop count. */
export function gifTiming(bytes) {
	if (bytes.toString("latin1", 0, 3) !== "GIF") throw new Error("not a GIF file");
	const delays = [];
	let loop = null;
	let delay = 100;
	const table = (flags) => (flags & 0x80 ? 3 * (1 << ((flags & 0x07) + 1)) : 0);
	const skipSubBlocks = (p) => {
		while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1;
		return p + 1;
	};
	let o = 13 + table(bytes[10]);
	while (o < bytes.length && bytes[o] !== 0x3b) {
		if (bytes[o] === 0x21) {
			if (bytes[o + 1] === 0xf9) delay = 10 * bytes.readUInt16LE(o + 4);
			if (bytes[o + 1] === 0xff && bytes.toString("latin1", o + 3, o + 14) === "NETSCAPE2.0") loop = bytes.readUInt16LE(o + 16);
			o = skipSubBlocks(o + 2);
		} else if (bytes[o] === 0x2c) {
			o = skipSubBlocks(o + 10 + table(bytes[o + 9]) + 1);
			delays.push(delay > 0 ? delay : 100);
			delay = 100;
		} else break;
	}
	return { delays, loop, width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

/**
 * Read a cover for the gate: { lumas, delays, width, height, loop, bytes, format, kept }. `keep(i, ms)`
 * runs once per decoded frame, in order, and picks the frames kept whole (RGBA) for the stills and the
 * frame-0 checks. A folder of PNG frames is read at `fps` (no container, so no G1).
 */
export function loadCover(input, { fps = 16, keep = () => false, env = process.env } = {}) {
	const lumas = [];
	const kept = new Map();
	const take = (i, rgba, ms, width, height) => {
		lumas.push(lumaGrid(rgba, width, height).luma);
		if (keep(i, ms)) kept.set(i, Buffer.from(rgba));
	};
	if (statSync(input).isDirectory()) {
		const files = frameFiles(input);
		let size = [0, 0];
		files.forEach((file, i) => {
			const img = readPngRgba(file);
			size = [img.width, img.height];
			take(i, img.rgba, 1000 / fps, img.width, img.height);
		});
		return { lumas, delays: files.map(() => 1000 / fps), width: size[0], height: size[1], loop: 0, bytes: null, format: "png", kept };
	}
	if (input.toLowerCase().endsWith(".gif")) {
		const bytes = readFileSync(input);
		const timing = gifTiming(bytes);
		const ffmpeg = which("ffmpeg", env);
		if (!ffmpeg) throw new Error("ffmpeg is needed to decode a GIF cover");
		const raw = spawnSync(ffmpeg, ["-v", "error", "-i", input, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 2 ** 31, env });
		if (raw.status !== 0) throw new Error(`ffmpeg could not decode ${input}: ${String(raw.stderr).trim().split("\n")[0]}`);
		const size = timing.width * timing.height * 4;
		for (let i = 0; (i + 1) * size <= raw.stdout.length; i++) take(i, raw.stdout.subarray(i * size, (i + 1) * size), timing.delays[i] ?? 100, timing.width, timing.height);
		return { lumas, delays: timing.delays.slice(0, lumas.length), width: timing.width, height: timing.height, loop: timing.loop, bytes: bytes.length, format: "gif", kept };
	}
	const info = decodeWebp(input, { env, onFrame: (i, rgba, ms, width, height) => take(i, rgba, ms > 0 ? ms : 100, width, height) });
	return { lumas, delays: info.durations.map((d) => (d > 0 ? d : 100)), width: info.width, height: info.height, loop: info.loop, bytes: info.bytes, format: "webp", kept };
}

/** The frame on screen at each multiple of `step` ms, given per-frame durations. */
export function resample(frames, delays, step) {
	const total = delays.reduce((a, b) => a + b, 0);
	const out = [];
	let i = 0;
	let end = delays[0];
	for (let ms = 0; ms < total - 1e-6; ms += step) {
		while (ms >= end && i < frames.length - 1) end += delays[++i];
		out.push(frames[i]);
	}
	return out;
}

/** Motion numbers on the fixed grid. The loop is a ring: the seam (last to first) is one more step. */
export function motionMetrics({ lumas, delays }) {
	const step = Math.max(COVER.gridMs, Math.min(...delays));
	const grid = resample(lumas, delays, step);
	const n = grid.length;
	const steps = [];
	for (let i = 1; i < n; i++) steps.push(meanStep(grid[i], grid[i - 1]));
	const seam = meanStep(grid[0], grid[n - 1]);
	const ring = [...steps, seam];
	const medianD = median(ring);
	const still = ring.map((d) => d < COVER.stillEps);
	let longest = 0;
	if (still.every(Boolean)) longest = n * step;
	else {
		const start = still.findIndex((s) => !s);
		let run = 0;
		for (let j = 1; j <= n; j++) {
			run = still[(start + j - 1) % n] ? run + step : step;
			longest = Math.max(longest, run);
		}
	}
	const neighbours = n >= 4 ? (ring[n - 3] + ring[n - 2] + ring[0] + ring[1]) / 4 : medianD;
	return {
		gridFrames: n,
		stepMs: step,
		durationSec: (n * step) / 1000,
		sourceDurationSec: delays.reduce((a, b) => a + b, 0) / 1000,
		medianD,
		p10D: quantile(ring, 0.1),
		p90D: quantile(ring, 0.9),
		movingFrac: ring.filter((d) => d >= COVER.stillEps).length / ring.length,
		longestStillSec: longest / 1000,
		spike: Math.max(...ring) / Math.max(medianD, COVER.stillEps),
		seam,
		seamLocal: seam / Math.max(COVER.stillEps, neighbours),
		diffs: ring,
	};
}

const linear = (c) => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const relativeLuminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const boxPx = (box, width, height) => box.map((v, k) => Math.round(v * (k % 2 ? height : width)));

/**
 * G5 per frame: the median title pixel against the 90th-percentile background in the title box (or
 * the 10th when the title is darker), where background is every box pixel at least 3 px from a title
 * pixel. The title pixels come from the mask frame of the same time (white = title).
 */
export function titleContrast({ framesDir, masksDir, box }) {
	const frames = frameFiles(framesDir, "f");
	const masks = frameFiles(masksDir, "m");
	if (!frames.length || masks.length !== frames.length) return { measured: false, reason: `needs one mask per frame (${frames.length} frames, ${masks.length} masks)` };
	const ratios = [];
	for (let i = 0; i < frames.length; i++) {
		const { width, height, rgba } = readPngRgba(frames[i]);
		const mask = readPngRgba(masks[i]);
		if (mask.width !== width || mask.height !== height) return { measured: false, reason: `mask ${i} is ${mask.width}x${mask.height}, the frame ${width}x${height}` };
		const [bx, by, bw, bh] = boxPx(box, width, height);
		const kind = new Uint8Array(width * height);
		for (let p = 0; p < width * height; p++) if (mask.rgba[p * 4] > 127) kind[p] = 2;
		for (let y = by; y < by + bh; y++)
			for (let x = bx; x < bx + bw; x++) {
				if (kind[y * width + x] !== 2) continue;
				for (let dy = -3; dy <= 3; dy++)
					for (let dx = -3; dx <= 3; dx++) {
						const yy = y + dy;
						const xx = x + dx;
						if (yy >= 0 && yy < height && xx >= 0 && xx < width && kind[yy * width + xx] === 0) kind[yy * width + xx] = 1;
					}
			}
		const title = [];
		const ground = [];
		for (let y = by; y < by + bh; y++)
			for (let x = bx; x < bx + bw; x++) {
				const p = (y * width + x) * 4;
				const l = relativeLuminance(rgba[p], rgba[p + 1], rgba[p + 2]);
				if (kind[y * width + x] === 2) title.push(l);
				else if (kind[y * width + x] === 0) ground.push(l);
			}
		if (!title.length || !ground.length) return { measured: false, reason: `frame ${i}: the title box holds ${title.length} title and ${ground.length} background pixels` };
		const t = median(title);
		const g = t > median(ground) ? quantile(ground, 0.9) : quantile(ground, 0.1);
		ratios.push((Math.max(t, g) + 0.05) / (Math.min(t, g) + 0.05));
	}
	return { measured: true, min: Math.min(...ratios), median: median(ratios), frames: ratios.length };
}

/**
 * G6: the title's cap height at the README display width. In up to 12 mask frames, the white pixels
 * inside the title box split into 4-connected glyphs; specks (under 1 % of the largest glyph's area)
 * and dots or accents (under 30 % of the tallest) are dropped, and the median height of the rest is
 * that frame's cap height. The smallest, scaled from the cover width to `displayWidth`, must reach
 * COVER.minCapPx. A title painted into declared base art is `exempt`: still measured, reported as INFO.
 */
export function glyphHeights({ masksDir, box, displayWidth = COVER.displayWidth, exempt = null, samples = 12 }) {
	const masks = frameFiles(masksDir, "m");
	if (!masks.length) return { pass: false, reason: "no mask frames to measure the title on" };
	const count = Math.min(samples, masks.length);
	const picks = [...new Set(Array.from({ length: count }, (_, k) => Math.floor((k * masks.length) / count)))];
	let cap = Number.POSITIVE_INFINITY;
	let glyphs = 0;
	let coverWidth = 0;
	for (const i of picks) {
		const mask = readPngRgba(masks[i]);
		coverWidth = mask.width;
		const [bx, by, bw, bh] = boxPx(box, mask.width, mask.height);
		const on = new Uint8Array(bw * bh);
		for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) on[y * bw + x] = mask.rgba[((by + y) * mask.width + bx + x) * 4] > 127 ? 1 : 0;
		const parts = [];
		for (let seed = 0; seed < on.length; seed++) {
			if (on[seed] !== 1) continue;
			on[seed] = 2;
			const stack = [seed];
			let area = 0;
			let top = bh;
			let bottom = -1;
			while (stack.length) {
				const q = stack.pop();
				const y = Math.floor(q / bw);
				const x = q - y * bw;
				area++;
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
				for (const next of [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, y > 0 ? q - bw : -1, y < bh - 1 ? q + bw : -1])
					if (next >= 0 && on[next] === 1) {
						on[next] = 2;
						stack.push(next);
					}
			}
			parts.push({ area, height: bottom - top + 1 });
		}
		if (!parts.length) return { pass: false, reason: `mask ${i}: no title pixels in the title box` };
		const biggest = Math.max(...parts.map((p) => p.area));
		const tallest = Math.max(...parts.map((p) => p.height));
		const letters = parts.filter((p) => p.area >= 0.01 * biggest && p.height >= 0.3 * tallest);
		glyphs = Math.max(glyphs, letters.length);
		cap = Math.min(cap, median(letters.map((p) => p.height)));
	}
	const capPx = Math.round(((cap * displayWidth) / coverWidth) * 10) / 10;
	const result = { capPx, coverPx: cap, displayWidth, glyphs, sampled: picks.length };
	if (exempt) return { pass: null, ...result, reason: exempt };
	return { pass: capPx >= COVER.minCapPx, ...result };
}

/** G0: SHA-256 of every frame of two independent captures. */
export function determinism(dirA, dirB) {
	const a = frameFiles(dirA, "f");
	const b = frameFiles(dirB, "f");
	const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
	const n = Math.min(a.length, b.length);
	let identical = 0;
	let firstDiffering = null;
	for (let i = 0; i < n; i++) {
		if (hash(a[i]) === hash(b[i])) identical++;
		else firstDiffering ??= i;
	}
	return { compared: n, identical, countsMatch: a.length === b.length, firstDiffering };
}

/**
 * Gate one cover file (or PNG folder). Options: frames + frames2 (two captures, G0), masks + title
 * (G5, and G6 when `glyph` is given), fps (a PNG folder), keep (frames kept whole). Returns the metrics,
 * the per-gate verdicts, `pass` (FLOOR) and `target` (TARGET).
 */
export function coverGate(input, { frames = null, frames2 = null, masks = null, title = null, glyph = null, fps = 16, keep, env = process.env } = {}) {
	const cover = loadCover(input, { fps, keep, env });
	const m = motionMetrics(cover);
	const F = COVER.floor;
	const T = COVER.target;
	const gates = {};
	if (frames && frames2) {
		const det = determinism(frames, frames2);
		gates.G0 = { pass: det.countsMatch && det.compared > 0 && det.identical === det.compared, ...det };
	}
	if (cover.format !== "png")
		gates.G1 = { pass: cover.bytes <= COVER.maxBytes && m.sourceDurationSec >= COVER.minSec && m.sourceDurationSec <= COVER.maxSec && cover.loop === 0, target: cover.bytes <= COVER.targetBytes, bytes: cover.bytes, durationSec: m.sourceDurationSec, loop: cover.loop, size: `${cover.width}x${cover.height}` };
	gates.G2 = { pass: m.medianD >= F.medianD && m.movingFrac >= F.movingFrac, target: m.medianD >= T.medianD && m.movingFrac >= T.movingFrac, medianD: m.medianD, movingFrac: m.movingFrac };
	gates.G3 = { pass: m.longestStillSec <= F.stillSec, target: m.longestStillSec <= T.stillSec && m.spike <= T.spike, longestStillSec: m.longestStillSec, spike: m.spike };
	gates.G4 = { pass: m.seamLocal <= F.seamLocal, target: m.seamLocal >= T.seamLow && m.seamLocal <= T.seamHigh, seam: m.seam, seamLocal: m.seamLocal };
	if (title && frames) {
		const c = titleContrast({ framesDir: frames, masksDir: masks, box: title });
		gates.G5 = c.measured ? { pass: c.min >= COVER.minContrast, min: c.min, median: c.median, frames: c.frames } : { pass: false, reason: c.reason };
	}
	if (title && masks && glyph) gates.G6 = glyphHeights({ masksDir: masks, box: title, displayWidth: glyph.displayWidth ?? COVER.displayWidth, exempt: glyph.exempt ?? null });
	const pass = Object.values(gates).every((g) => g.pass !== false);
	const target = pass && Object.values(gates).every((g) => g.target !== false);
	return { input, format: cover.format, width: cover.width, height: cover.height, bytes: cover.bytes, loop: cover.loop, sourceFrames: cover.lumas.length, durations: cover.delays, ...m, gates, pass, target, kept: cover.kept };
}

const show = (x) => (typeof x === "number" && !Number.isInteger(x) ? Number(x.toPrecision(4)) : x);

/** The verdict word for a gate result. */
export const verdictOf = (r) => (r.pass ? (r.target ? "PASS+TARGET" : "PASS(floor)") : "FAIL");

/** The report: the verdict line, the size line and one line per gate. */
export function formatCoverReport(r, { strict = false } = {}) {
	const lines = [`COVER gate${strict ? " --strict" : ""}: ${verdictOf(r)}`, `  ${r.width}x${r.height} ${r.format} frames=${r.sourceFrames} dur=${show(r.sourceDurationSec)}s bytes=${r.bytes ?? "-"} loop=${r.loop} grid=${r.stepMs}ms`];
	for (const [name, gate] of Object.entries(r.gates)) {
		const { pass, target, ...detail } = gate;
		const word = pass === null ? "INFO" : pass === false ? "FAIL" : target === false ? "pass(floor)" : "pass";
		lines.push(`  ${name} ${word} ${Object.entries(detail).map(([k, v]) => `${k}=${show(v)}`).join(" ")}`);
	}
	return `${lines.join("\n")}\n`;
}
