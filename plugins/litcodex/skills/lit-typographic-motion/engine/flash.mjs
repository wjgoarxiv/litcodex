// WCAG 2.3.1 flash audit by the excursion method (MO-C-03), run on the exact 8-bit bytes handed to
// an encoder. The detector (per-cell extremum tracking, 10-degree-field windows by summed-area
// table) runs while frames stream; it emits per-frame transition-start records for the render log.
// The counter (opposing pairs in every 1 s window) runs later from those records only. The master
// is counted non-looping with both wrap sites removed; the preview is counted looping.
import { FLASH, FULL_FRAME_STEP } from "./constants.mjs";
import { linearOf } from "./image.mjs";

/**
 * Audit grid for a frame: 320x180 cells with a 107x60 window for landscape, transposed (180x320
 * cells, 60x107 window) for a portrait frame, so the window keeps its share of the visual field.
 */
export function gridFor(width, height) {
	const portrait = height > width;
	const gridW = portrait ? FLASH.gridH : FLASH.gridW;
	const gridH = portrait ? FLASH.gridW : FLASH.gridH;
	const windowW = portrait ? FLASH.windowH : FLASH.windowW;
	const windowH = portrait ? FLASH.windowW : FLASH.windowH;
	return { gridW, gridH, windowW, windowH, cells: gridW * gridH, limit: windowW * windowH * FLASH.windowAreaFraction };
}
const LANDSCAPE = gridFor(FLASH.gridW, FLASH.gridH);

/** Largest count of flagged cells inside any windowW x windowH window (summed-area table). */
export function maxWindowCount(flags, grid = LANDSCAPE) {
	const stride = grid.gridW + 1;
	const sat = new Uint32Array(stride * (grid.gridH + 1));
	for (let y = 0; y < grid.gridH; y++) {
		let row = 0;
		for (let x = 0; x < grid.gridW; x++) {
			row += flags[y * grid.gridW + x];
			sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1] + row;
		}
	}
	let max = 0;
	for (let y = grid.windowH; y <= grid.gridH; y++)
		for (let x = grid.windowW; x <= grid.gridW; x++) {
			const n = sat[y * stride + x] - sat[(y - grid.windowH) * stride + x] - sat[y * stride + x - grid.windowW] + sat[(y - grid.windowH) * stride + x - grid.windowW];
			if (n > max) max = n;
		}
	return max;
}

/** Area-average an RGBA frame onto its audit grid: luminance, red term, and saturated-red flag. */
export function cellGrid(bytes, width, height, grid = gridFor(width, height)) {
	const lum = new Float32Array(grid.cells);
	const redValue = new Float32Array(grid.cells);
	const saturated = new Uint8Array(grid.cells);
	const cw = width / grid.gridW;
	const ch = height / grid.gridH;
	for (let gy = 0; gy < grid.gridH; gy++) {
		const y0 = Math.round(gy * ch);
		const y1 = Math.round((gy + 1) * ch);
		for (let gx = 0; gx < grid.gridW; gx++) {
			const x0 = Math.round(gx * cw);
			const x1 = Math.round((gx + 1) * cw);
			let r = 0;
			let g = 0;
			let b = 0;
			let n = 0;
			for (let y = y0; y < y1; y++) {
				let i = (y * width + x0) * 4;
				for (let x = x0; x < x1; x++, i += 4) {
					r += linearOf(bytes[i]);
					g += linearOf(bytes[i + 1]);
					b += linearOf(bytes[i + 2]);
					n++;
				}
			}
			const k = gy * grid.gridW + gx;
			r /= n;
			g /= n;
			b /= n;
			lum[k] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			const sum = r + g + b;
			saturated[k] = sum > 0 && r / sum >= FLASH.redRatio ? 1 : 0;
			redValue[k] = Math.max(0, (r - g - b) * FLASH.redScale);
		}
	}
	return { lum, redValue, saturated };
}

/** Streaming detector. ingest() returns this frame's record for the render log. */
export class FlashDetector {
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.grid = gridFor(width, height);
		this.frames = 0;
		this.lo = null;
		this.hi = null;
		this.rlo = null;
		this.rhi = null;
		this.history = [];
		this.previousLum = null;
		this.active = { up: false, down: false, redUp: false, redDown: false };
	}

	ingest(bytes) {
		return this.ingestGrid(cellGrid(bytes, this.width, this.height, this.grid));
	}

	/** Ingest a grid computed elsewhere (the stage renderer computes grids in worker threads). */
	ingestGrid({ lum, redValue, saturated }) {
		const CELLS = this.grid.cells;
		const up = new Uint8Array(CELLS);
		const down = new Uint8Array(CELLS);
		const redUp = new Uint8Array(CELLS);
		const redDown = new Uint8Array(CELLS);
		let stepCells = 0;
		if (!this.lo) {
			this.lo = lum.slice();
			this.hi = lum.slice();
			this.rlo = redValue.slice();
			this.rhi = redValue.slice();
			this.satLo = saturated.slice();
			this.satHi = saturated.slice();
		} else {
			for (let k = 0; k < CELLS; k++) {
				const v = lum[k];
				if (v - this.lo[k] >= FLASH.deltaL && this.lo[k] < FLASH.maxL) {
					up[k] = 1;
					this.lo[k] = v;
					this.hi[k] = v;
				} else if (this.hi[k] - v >= FLASH.deltaL && v < FLASH.maxL) {
					down[k] = 1;
					this.lo[k] = v;
					this.hi[k] = v;
				} else {
					if (v < this.lo[k]) this.lo[k] = v;
					if (v > this.hi[k]) this.hi[k] = v;
				}
				const rv = redValue[k];
				if (rv - this.rlo[k] > FLASH.redDelta && (saturated[k] || this.satLo[k])) {
					redUp[k] = 1;
					this.rlo[k] = rv;
					this.rhi[k] = rv;
					this.satLo[k] = saturated[k];
					this.satHi[k] = saturated[k];
				} else if (this.rhi[k] - rv > FLASH.redDelta && (saturated[k] || this.satHi[k])) {
					redDown[k] = 1;
					this.rlo[k] = rv;
					this.rhi[k] = rv;
					this.satLo[k] = saturated[k];
					this.satHi[k] = saturated[k];
				} else {
					if (rv < this.rlo[k]) {
						this.rlo[k] = rv;
						this.satLo[k] = saturated[k];
					}
					if (rv > this.rhi[k]) {
						this.rhi[k] = rv;
						this.satHi[k] = saturated[k];
					}
				}
				const previous = this.previousLum[k];
				if (Math.abs(v - previous) >= FULL_FRAME_STEP.deltaL && Math.min(v, previous) < FLASH.maxL) stepCells++;
			}
		}
		this.previousLum = lum;
		this.history.push({ up, down, redUp, redDown });
		if (this.history.length > FLASH.cellSpanFrames) this.history.shift();
		const union = (key) => {
			const out = new Uint8Array(CELLS);
			for (const record of this.history) {
				const flags = record[key];
				for (let k = 0; k < CELLS; k++) out[k] |= flags[k];
			}
			return out;
		};
		const area = {};
		const record = { f: this.frames, g: [0, 0], r: [0, 0], step: Math.round((stepCells / CELLS) * 1e4) / 1e4 };
		for (const [key, slot, kind] of [["up", 0, "g"], ["down", 1, "g"], ["redUp", 0, "r"], ["redDown", 1, "r"]]) {
			area[key] = maxWindowCount(union(key), this.grid);
			const on = area[key] > this.grid.limit;
			if (on && !this.active[key]) record[kind][slot] = 1;
			this.active[key] = on;
		}
		this.frames++;
		return record;
	}
}

/** Transition events from per-frame records: [{frame, direction: +1|-1}] for "g" or "r". */
export function eventsFrom(records, kind) {
	const events = [];
	for (const record of records) {
		const [up, down] = record[kind];
		if (up) events.push({ frame: record.f, direction: 1 });
		if (down) events.push({ frame: record.f, direction: -1 });
	}
	return events;
}

/** Flashes among ordered events: adjacent opposing transitions pair into one flash. */
export function pairFlashes(ordered) {
	let flashes = 0;
	for (let i = 0; i + 1 < ordered.length; i++) {
		if (ordered[i].direction !== ordered[i + 1].direction) {
			flashes++;
			i++;
		}
	}
	return flashes;
}

/**
 * Worst 1 s window. Non-looping (master): window starts s in [0, count - fps], frames [s, s + fps),
 * no modulo anywhere. Looping (preview): every start, windows wrap across the seam.
 */
export function worstWindow(events, count, fps, loop) {
	let worst = { flashes: 0, startFrame: 0, transitions: [] };
	const starts = loop ? count : Math.max(1, count - fps + 1);
	for (let s = 0; s < starts; s++) {
		const inside = loop
			? events.map((e) => ({ ...e, k: (e.frame - s + count) % count })).filter((e) => e.k < fps)
			: events.filter((e) => e.frame >= s && e.frame < Math.min(s + fps, count)).map((e) => ({ ...e, k: e.frame - s }));
		inside.sort((a, b) => a.k - b.k || a.direction - b.direction);
		const flashes = pairFlashes(inside);
		if (flashes > worst.flashes) worst = { flashes, startFrame: s, transitions: inside.map((e) => `${e.frame}:${e.direction > 0 ? "up" : "down"}`) };
	}
	return worst;
}

/** Full count from logged records for one artifact. */
export function countFlashes(records, fps, loop) {
	const count = records.length;
	const general = worstWindow(eventsFrom(records, "g"), count, fps, loop);
	const red = worstWindow(eventsFrom(records, "r"), count, fps, loop);
	return { general, red, pass: general.flashes <= FLASH.maxGeneral && red.flashes <= FLASH.maxRed };
}

/**
 * Looping detector for the preview: the sequence is ingested twice and only the second pass is
 * kept, so the seam transition (last frame to first) has real history.
 */
export function detectLooping(frames, width, height) {
	const detector = new FlashDetector(width, height);
	for (const frame of frames) detector.ingest(frame);
	const records = [];
	for (let i = 0; i < frames.length; i++) records.push({ ...detector.ingest(frames[i]), f: i });
	return records;
}

/** Streaming form of the looping detector for preview frames read one by one from disk. */
export async function detectLoopingStream(count, width, height, read) {
	const detector = new FlashDetector(width, height);
	for (let i = 0; i < count; i++) detector.ingest(await read(i));
	const records = [];
	for (let i = 0; i < count; i++) records.push({ ...detector.ingest(await read(i)), f: i });
	return records;
}
