// LitLoop kit, served to cover pages at /lit/loop-kit.js. A cover page draws every frame from one
// loop time t in [0, 1) through window.renderFrame(t); the renderer seeks t = i / N in any order and
// in fresh browsers. So every helper here is either pure or periodic in t: the value at t = 1 is the
// value at t = 0, and nothing remembers the frame drawn before. Layout randomness comes from rng(seed);
// per-frame variation comes only from t (the cover init script makes every clock throw).
(function litLoopKit(global) {
	"use strict";

	const TAU = Math.PI * 2;
	const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
	const fract = (x) => x - Math.floor(x);
	const mix = (a, b, k) => a + (b - a) * k;

	/** mulberry32: a seeded generator for layout only (positions, sizes, which copy is the accent). */
	function rng(seed) {
		let state = seed >>> 0;
		return () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let x = Math.imul(state ^ (state >>> 15), 1 | state);
			x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
			return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
		};
	}

	/**
	 * Seeded 3D value noise. loopNoise walks it around a circle, so one loop of t returns to its start;
	 * `offset` separates the elements that share the field and `radius` sets how far one loop wanders.
	 */
	function makeNoise(seed) {
		const next = rng(seed);
		const perm = new Uint8Array(512);
		const lattice = new Float32Array(256);
		for (let i = 0; i < 256; i++) {
			perm[i] = i;
			lattice[i] = next() * 2 - 1;
		}
		for (let i = 255; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			const swap = perm[i];
			perm[i] = perm[j];
			perm[j] = swap;
		}
		for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
		const fade = (x) => x * x * (3 - 2 * x);
		const corner = (x, y, z) => lattice[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
		return (x, y, z) => {
			const x0 = Math.floor(x);
			const y0 = Math.floor(y);
			const z0 = Math.floor(z);
			const u = fade(x - x0);
			const v = fade(y - y0);
			const w = fade(z - z0);
			const edge = (yy, zz) => mix(corner(x0, yy, zz), corner(x0 + 1, yy, zz), u);
			const face = (zz) => mix(edge(y0, zz), edge(y0 + 1, zz), v);
			return mix(face(z0), face(z0 + 1), w);
		};
	}
	const loopNoise = (noise, t, offset = 0, radius = 1.3) => noise(offset + radius * Math.cos(TAU * t), radius * Math.sin(TAU * t), offset * 0.37);

	// Shapes for events. Linear time is only for motion that never stops (drift, laps, rising motes).
	const ease = Object.freeze({
		smooth: (p) => p * p * (3 - 2 * p),
		outCubic: (p) => 1 - (1 - p) ** 3,
		inCubic: (p) => p ** 3,
		outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
		outBack: (p, s = 1.6) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
		gain: (p, k) => (p < 0.5 ? 0.5 * (2 * p) ** k : 1 - 0.5 * (2 * (1 - p)) ** k),
	});

	/**
	 * A symmetric bump of half-width w around c, 0 outside. Prefer it for micro events: an exponential
	 * tail is a slow fade, and a lossy animation encoder drops changes that small.
	 */
	function cubicPulse(c, w, x) {
		const d = Math.abs(x - c);
		if (d > w) return 0;
		const k = d / w;
		return 1 - k * k * (3 - 2 * k);
	}
	const expImpulse = (x, k) => k * x * Math.exp(1 - k * x);

	/** Loop position of one copy of a rule: the same rule at another offset is the whole system. */
	const phase = (t, offset = 0, cycles = 1) => fract(t * cycles - offset);
	/** Distance from p to c around the loop (0..0.5), for an event that straddles t = 0. */
	const cdist = (p, c) => {
		const d = fract(p - c);
		return Math.min(d, 1 - d);
	};
	/** A one-shot event inside the loop: 0..1 across [start, start + dur) (wrapping), -1 outside. */
	const span = (p, start, dur) => {
		const q = fract(p - start);
		return q < dur ? q / dur : -1;
	};
	/** Hold and move: dwell at `stops` poses per cycle, travelling during the last `travel` of each slot. */
	const steps = (p, stops, travel = 0.35, shape = ease.smooth) => {
		const x = p * stops;
		const slot = Math.floor(x);
		return (slot + shape(clamp((x - slot - (1 - travel)) / travel))) / stops;
	};
	/** A cosine swell 0..1..0 over one cycle that dwells at both ends. */
	const swell = (p) => 0.5 - 0.5 * Math.cos(TAU * p);

	global.LitLoop = Object.freeze({ TAU, clamp, fract, mix, rng, makeNoise, loopNoise, ease, cubicPulse, expImpulse, phase, cdist, window: span, steps, swell });
})(typeof window !== "undefined" ? window : globalThis);
