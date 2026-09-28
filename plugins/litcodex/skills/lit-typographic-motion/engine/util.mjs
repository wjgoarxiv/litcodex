// Pure helpers shared by timeline, scenes, passes and gate. Every function here is a deterministic
// function of its arguments: no clock, no unseeded randomness (MO-A-23). Shape adapted from the
// credited engine's util module; see NOTICE.

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (a === b ? 0 : (x - a) / (b - a));
export const smoothstep = (a, b, x) => {
	const t = clamp((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};
export const fract = (x) => x - Math.floor(x);
export const round6 = (x) => Math.round(x * 1e6) / 1e6;

// Solve a CSS cubic-bezier(x1, y1, x2, y2) timing curve for y at progress x.
export function cubicBezier(x1, y1, x2, y2) {
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
	const sampleY = (t) => ((ay * t + by) * t + cy) * t;
	const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
	return (x) => {
		const p = clamp(x);
		let t = p;
		for (let i = 0; i < 8; i++) {
			const error = sampleX(t) - p;
			const slope = slopeX(t);
			if (Math.abs(error) < 1e-7 || Math.abs(slope) < 1e-6) break;
			t -= error / slope;
		}
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 30 && Math.abs(sampleX(t) - p) > 1e-7; i++) {
			if (sampleX(t) < p) lo = t;
			else hi = t;
			t = (lo + hi) / 2;
		}
		return sampleY(clamp(t));
	};
}

// The film's one named easing set (MO-A-08). `slam` and `surge` reuse the family's proven
// deceleration curve; `drift` is the tidal preset's sine in-out.
export const ease = Object.freeze({
	linear: (t) => clamp(t),
	slam: cubicBezier(0.16, 1, 0.3, 1),
	drift: cubicBezier(0.37, 0, 0.63, 1),
	surge: cubicBezier(0.16, 1, 0.3, 1),
	exit: (t) => clamp(t) ** 3,
	inOut: (t) => {
		const x = clamp(t);
		return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
	},
});

/** Eased progress of x through [a, b]. */
export const progress = (x, a, b, curve = "linear") => ease[curve](clamp((x - a) / (b - a)));

/** Piecewise keyframes: [[time, value, curveName?], ...]; the curve on key i shapes the segment ending at i. */
export function keys(t, points) {
	if (points.length === 0) return 0;
	if (t <= points[0][0]) return points[0][1];
	for (let i = 1; i < points.length; i++) {
		const [at, value, curve = "inOut"] = points[i];
		if (t <= at) {
			const [before, from] = points[i - 1];
			return lerp(from, value, ease[curve]((t - before) / (at - before)));
		}
	}
	return points[points.length - 1][1];
}

/** Damped spring response to a step at time 0 (rare, deliberate overshoot only). */
export function springStep(t, frequency = 4, damping = 0.35) {
	if (t <= 0) return 0;
	const w = 2 * Math.PI * frequency;
	return 1 - Math.exp(-damping * w * t) * Math.cos(w * Math.sqrt(1 - damping * damping) * t);
}

/** Smooth rise-then-fall envelope with explicit attack and decay seconds (never an instant edge). */
export function envelope(t, start, attack, hold, decay) {
	if (t <= start) return 0;
	const a = t - start;
	if (a < attack) return ease.inOut(a / attack);
	if (a < attack + hold) return 1;
	const d = a - attack - hold;
	return d < decay ? 1 - ease.inOut(d / decay) : 0;
}

// FNV-1a over UTF-8 bytes, 32-bit (MO-SH-01): offset basis 0x811c9dc5, prime 0x01000193.
export function fnv1a32(text) {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(String(text))) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
	return hash >>> 0;
}

/** The one pass-seed formula (MO-SH-01). */
export const passSeed = (runSeed, sceneId, shotIndex, pass) => fnv1a32(`${runSeed}:${sceneId}:${shotIndex}:${pass}`);

/** mulberry32 in unsigned 32-bit arithmetic; returns a generator of floats in [0, 1). */
export function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Stateless integer hash of any numbers to [0, 1). */
export function hash01(...values) {
	let h = 0x811c9dc5;
	for (const value of values) {
		h ^= Math.floor(value * 1000003) | 0;
		h = Math.imul(h, 0x01000193);
		h ^= h >>> 13;
		h = Math.imul(h, 0x5bd1e995);
		h ^= h >>> 15;
	}
	return (h >>> 0) / 4294967296;
}

/** 1D value noise in [-1, 1]. */
export function noise1(x, seed = 0) {
	const i = Math.floor(x);
	const f = x - i;
	const s = f * f * f * (f * (f * 6 - 15) + 10);
	return lerp(hash01(i, seed) * 2 - 1, hash01(i + 1, seed) * 2 - 1, s);
}

/**
 * Sub-sample times for output frame n (MO-A-28): t = max(0, n/fps + (shutter/fps)((i+0.5)/N - 0.5)).
 * Sample floor(N/2) carries the frame's post overrides.
 */
export function subSampleTimes(frame, fps, samples, shutter) {
	const tn = frame / fps;
	return Array.from({ length: samples }, (_, i) => Math.max(0, tn + (shutter / fps) * ((i + 0.5) / samples - 0.5)));
}
export const representativeSample = (samples) => Math.floor(samples / 2);

// Colour: sRGB hex helpers, WCAG relative luminance, contrast, HSL.
export function hexToRgb8(hex) {
	const value = Number.parseInt(String(hex).replace("#", ""), 16);
	return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}
export const srgbToLinear = (s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
export const hexToLinear = (hex) => hexToRgb8(hex).map((v) => srgbToLinear(v / 255));
export function relativeLuminance(hex) {
	const [r, g, b] = hexToLinear(hex);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
	const la = typeof a === "number" ? a : relativeLuminance(a);
	const lb = typeof b === "number" ? b : relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export function hexToHsl(hex) {
	const [r, g, b] = hexToRgb8(hex).map((v) => v / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
	return { h, s, l };
}
export const hueDistance = (a, b) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

/** Axis-aligned box helpers ([x0, y0, x1, y1] in logical px). */
export const unionBox = (a, b) =>
	a ? (b ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : a) : b;
export const roundBox = (box) => box.map((v) => Math.round(v * 100) / 100);

/**
 * Post-chain shake/zoom as it moves a logical point (the final pass samples the pre-transform frame
 * at (p - c)/zoom + c - shake, so a source point q lands at (q - c + shake) * zoom + c).
 */
export function transformPoint(x, y, zoom, shake, width = 1920, height = 1080) {
	const cx = width / 2;
	const cy = height / 2;
	return [(x - cx + shake[0]) * zoom + cx, (y - cy + shake[1]) * zoom + cy];
}
export function transformBox(box, zoom, shake) {
	const [x0, y0] = transformPoint(box[0], box[1], zoom, shake);
	const [x1, y1] = transformPoint(box[2], box[3], zoom, shake);
	return [x0, y0, x1, y1];
}
