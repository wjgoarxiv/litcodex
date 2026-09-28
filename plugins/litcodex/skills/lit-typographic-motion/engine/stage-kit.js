// LitStage kit, served to stage pages at /lit/stage-kit.js. Motion primitives only: easing, springs,
// keyframes, sequencing, seeded randomness, text splitting, path drawing and morphing, masks, colour
// mixing and text registration. It ships no scene, layout, object or copy for any subject; the page
// draws whatever its treatment calls for. Every function is a pure function of its inputs (and of
// the time the renderer passes to render(t)), so a film stepped twice gives the same frames.
(function litStageKit(global) {
	"use strict";

	const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
	const lerp = (a, b, p) => a + (b - a) * p;
	const invLerp = (a, b, x) => (a === b ? 0 : (x - a) / (b - a));
	const remap = (x, a, b, c, d, easing) => lerp(c, d, (easing ?? ((v) => v))(clamp(invLerp(a, b, x))));

	/** CSS-style cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1. */
	function cubicBezier(x1, y1, x2, y2) {
		const cx = 3 * x1;
		const bx = 3 * (x2 - x1) - cx;
		const ax = 1 - cx - bx;
		const cy = 3 * y1;
		const by = 3 * (y2 - y1) - cy;
		const ay = 1 - cy - by;
		const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
		const sampleY = (t) => ((ay * t + by) * t + cy) * t;
		const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
		return (p) => {
			const x = clamp(p);
			let t = x;
			for (let i = 0; i < 8; i++) {
				const err = sampleX(t) - x;
				if (Math.abs(err) < 1e-7) return sampleY(t);
				const d = slopeX(t);
				if (Math.abs(d) < 1e-7) break;
				t -= err / d;
			}
			let lo = 0;
			let hi = 1;
			t = x;
			for (let i = 0; i < 40; i++) {
				const v = sampleX(t);
				if (Math.abs(v - x) < 1e-7) break;
				if (v < x) lo = t;
				else hi = t;
				t = (lo + hi) / 2;
			}
			return sampleY(t);
		};
	}

	const pow = (k) => ({ in: (p) => p ** k, out: (p) => 1 - (1 - p) ** k, inOut: (p) => (p < 0.5 ? 2 ** (k - 1) * p ** k : 1 - (-2 * p + 2) ** k / 2) });
	const quad = pow(2);
	const cubic = pow(3);
	const quart = pow(4);
	const quint = pow(5);
	const back = 1.70158;
	/** Named eases; every one maps 0 to 0 and 1 to 1. */
	const ease = Object.freeze({
		linear: (p) => p,
		inQuad: quad.in,
		outQuad: quad.out,
		inOutQuad: quad.inOut,
		inCubic: cubic.in,
		outCubic: cubic.out,
		inOutCubic: cubic.inOut,
		inQuart: quart.in,
		outQuart: quart.out,
		inOutQuart: quart.inOut,
		inQuint: quint.in,
		outQuint: quint.out,
		inOutQuint: quint.inOut,
		inSine: (p) => 1 - Math.cos((p * Math.PI) / 2),
		outSine: (p) => Math.sin((p * Math.PI) / 2),
		inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
		inExpo: (p) => (p === 0 ? 0 : 2 ** (10 * p - 10)),
		outExpo: (p) => (p === 1 ? 1 : 1 - 2 ** (-10 * p)),
		inOutExpo: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2),
		inBack: (p) => (back + 1) * p ** 3 - back * p ** 2,
		outBack: (p) => 1 + (back + 1) * (p - 1) ** 3 + back * (p - 1) ** 2,
		inOutBack: (p) => {
			const c = back * 1.525;
			return p < 0.5 ? ((2 * p) ** 2 * ((c + 1) * 2 * p - c)) / 2 : ((2 * p - 2) ** 2 * ((c + 1) * (p * 2 - 2) + c) + 2) / 2;
		},
		slam: cubicBezier(0.16, 1, 0.3, 1),
		drift: cubicBezier(0.37, 0, 0.63, 1),
		snap: cubicBezier(0.7, 0, 0.2, 1),
		anticipate: cubicBezier(0.5, -0.35, 0.3, 1.2),
	});
	const easeOf = (e) => (typeof e === "function" ? e : ease[e] ?? ease.linear);

	/**
	 * Analytic damped spring from `from` to `to` at time t (seconds). Under-, critically and
	 * over-damped cases are closed-form, so any t can be evaluated directly.
	 */
	function spring(t, { from = 0, to = 1, stiffness = 170, damping = 26, mass = 1, velocity = 0 } = {}) {
		if (t <= 0) return from;
		const w0 = Math.sqrt(stiffness / mass);
		const zeta = damping / (2 * Math.sqrt(stiffness * mass));
		const x0 = from - to;
		let x;
		if (zeta < 1) {
			const wd = w0 * Math.sqrt(1 - zeta * zeta);
			x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((velocity + zeta * w0 * x0) / wd) * Math.sin(wd * t));
		} else if (zeta === 1) {
			x = Math.exp(-w0 * t) * (x0 + (velocity + w0 * x0) * t);
		} else {
			const s = w0 * Math.sqrt(zeta * zeta - 1);
			const r1 = -zeta * w0 + s;
			const r2 = -zeta * w0 - s;
			const c2 = (velocity - r1 * x0) / (r2 - r1);
			const c1 = x0 - c2;
			x = c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
		}
		return to + x;
	}

	const mixValue = (a, b, p) => (Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], p)) : typeof a === "string" ? mix(a, b, p) : lerp(a, b, p));
	/**
	 * Keyframes: keys is [{t, v, ease?}, ...] sorted by t; v is a number, an array of numbers or a
	 * #RRGGBB colour. The ease on a key shapes the segment that ends at that key.
	 */
	function kf(t, keys) {
		if (!keys.length) return undefined;
		if (t <= keys[0].t) return keys[0].v;
		for (let i = 1; i < keys.length; i++) {
			if (t <= keys[i].t) {
				const a = keys[i - 1];
				const b = keys[i];
				return mixValue(a.v, b.v, easeOf(b.ease)(clamp(invLerp(a.t, b.t, t))));
			}
		}
		return keys[keys.length - 1].v;
	}

	/** Progress 0..1 of a window starting at `start` lasting `dur` seconds, eased. */
	const at = (t, start, dur, easing = "linear") => easeOf(easing)(clamp(dur <= 0 ? (t >= start ? 1 : 0) : (t - start) / dur));
	/** Delay for item i of n: `each` seconds apart, from the start, end, centre or a given index. */
	function stagger(i, { each = 0.05, from = "start", count = 1 } = {}) {
		const origin = from === "end" ? count - 1 : from === "center" ? (count - 1) / 2 : typeof from === "number" ? from : 0;
		return Math.abs(i - origin) * each;
	}
	/** Lay segments end to end: seq([{name, dur, gap?}]) -> {name: {start, end, dur}, total}. */
	function seq(segments, start = 0) {
		const out = {};
		let cursor = start;
		for (const segment of segments) {
			cursor += segment.gap ?? 0;
			out[segment.name] = { start: cursor, end: cursor + segment.dur, dur: segment.dur };
			cursor += segment.dur;
		}
		out.total = cursor;
		return out;
	}

	/** Seeded generator (mulberry32): rand(seed)() -> [0, 1). Same seed, same sequence. */
	function rand(seedValue) {
		let s = typeof seedValue === "string" ? [...seedValue].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0, 2166136261) : seedValue >>> 0;
		const next = () => {
			s = (s + 0x6d2b79f5) >>> 0;
			let t = s;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		next.range = (lo, hi) => lo + (hi - lo) * next();
		next.pick = (list) => list[Math.floor(next() * list.length)];
		return next;
	}

	/**
	 * Split text into graphemes, words or 어절 (whitespace-separated Korean units) with
	 * Intl.Segmenter. Given an element, its text is replaced by one span per unit (spaces kept as
	 * text nodes) and the spans are returned; given a string, the units are returned.
	 */
	function splitText(target, { by = "word", locale = "ko" } = {}) {
		const text = typeof target === "string" ? target : target.textContent;
		let units;
		if (by === "grapheme") units = [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
		else if (by === "eojeol") units = text.split(/(\s+)/u).filter((u) => u.length);
		else units = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)].map((s) => s.segment);
		if (typeof target === "string") return units.filter((u) => u.trim());
		target.textContent = "";
		const spans = [];
		for (const unit of units) {
			if (!unit.trim()) {
				target.appendChild(document.createTextNode(unit));
				continue;
			}
			const span = document.createElement("span");
			span.textContent = unit;
			span.style.display = "inline-block";
			span.style.whiteSpace = "pre";
			target.appendChild(span);
			spans.push(span);
		}
		return spans;
	}

	/** Draw an SVG path (or any geometry element) from 0 to p of its length. */
	function drawPath(el, p) {
		const length = el.__litLength ?? (el.__litLength = el.getTotalLength());
		el.style.strokeDasharray = `${length} ${length}`;
		el.style.strokeDashoffset = String(length * (1 - clamp(p)));
		return length;
	}

	// ---------------------------------------------------------------- path parsing and morphing

	function tokenize(d) {
		const out = [];
		const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/gu;
		for (let m = re.exec(d); m; m = re.exec(d)) out.push(m[1] ?? Number(m[2]));
		return out;
	}

	function arcToCubics(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
		if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
		const phi = (angle * Math.PI) / 180;
		const cos = Math.cos(phi);
		const sin = Math.sin(phi);
		const dx = (x1 - x2) / 2;
		const dy = (y1 - y2) / 2;
		const xp = cos * dx + sin * dy;
		const yp = -sin * dx + cos * dy;
		rx = Math.abs(rx);
		ry = Math.abs(ry);
		const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
		if (lambda > 1) {
			rx *= Math.sqrt(lambda);
			ry *= Math.sqrt(lambda);
		}
		const sign = large === sweep ? -1 : 1;
		const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
		const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
		const cxp = (coef * rx * yp) / ry;
		const cyp = (-coef * ry * xp) / rx;
		const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
		const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
		const angleOf = (ux, uy, vx, vy) => {
			const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
			return a;
		};
		const t1 = angleOf(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
		let dt = angleOf((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
		if (!sweep && dt > 0) dt -= 2 * Math.PI;
		if (sweep && dt < 0) dt += 2 * Math.PI;
		const parts = Math.ceil(Math.abs(dt) / (Math.PI / 2));
		const step = dt / parts;
		const k = (4 / 3) * Math.tan(step / 4);
		const point = (theta) => [cx + rx * Math.cos(theta) * cos - ry * Math.sin(theta) * sin, cy + rx * Math.cos(theta) * sin + ry * Math.sin(theta) * cos];
		const deriv = (theta) => [-rx * Math.sin(theta) * cos - ry * Math.cos(theta) * sin, -rx * Math.sin(theta) * sin + ry * Math.cos(theta) * cos];
		const out = [];
		for (let i = 0; i < parts; i++) {
			const a = t1 + i * step;
			const b = a + step;
			const [ax, ay] = point(a);
			const [bx, by] = point(b);
			const [dax, day] = deriv(a);
			const [dbx, dby] = deriv(b);
			out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
		}
		return out;
	}

	/** Parse one SVG path into absolute cubic segments. Multi-subpath paths are refused. */
	function toCubics(d) {
		const tokens = tokenize(d);
		const segments = [];
		let i = 0;
		let cmd = null;
		let x = 0;
		let y = 0;
		let sx = 0;
		let sy = 0;
		let lastCtrl = null;
		let lastQuad = null;
		let moves = 0;
		let closed = false;
		const num = () => {
			const v = tokens[i++];
			if (typeof v !== "number") throw new Error("LitStage.morph: malformed path data");
			return v;
		};
		while (i < tokens.length) {
			if (typeof tokens[i] === "string") cmd = tokens[i++];
			else if (cmd === null) throw new Error("LitStage.morph: path must start with M");
			const rel = cmd === cmd.toLowerCase();
			const C = cmd.toUpperCase();
			const ox = rel ? x : 0;
			const oy = rel ? y : 0;
			if (C === "M") {
				moves++;
				if (moves > 1 || closed) throw new Error("LitStage.morph: multi-subpath paths are not supported; morph one closed or open subpath");
				x = ox + num();
				y = oy + num();
				sx = x;
				sy = y;
				cmd = rel ? "l" : "L";
				lastCtrl = lastQuad = null;
				continue;
			}
			if (C === "Z") {
				if (x !== sx || y !== sy) segments.push([x, y, sx, sy, sx, sy, sx, sy]);
				x = sx;
				y = sy;
				closed = true;
				lastCtrl = lastQuad = null;
				continue;
			}
			if (closed) throw new Error("LitStage.morph: multi-subpath paths are not supported");
			if (C === "L" || C === "H" || C === "V") {
				const nx = C === "V" ? x : ox + num();
				const ny = C === "H" ? y : C === "V" ? oy + num() : oy + num();
				segments.push([x, y, x + (nx - x) / 3, y + (ny - y) / 3, x + (2 * (nx - x)) / 3, y + (2 * (ny - y)) / 3, nx, ny]);
				x = nx;
				y = ny;
				lastCtrl = lastQuad = null;
			} else if (C === "C" || C === "S") {
				let c1x;
				let c1y;
				if (C === "C") {
					c1x = ox + num();
					c1y = oy + num();
				} else {
					c1x = lastCtrl ? 2 * x - lastCtrl[0] : x;
					c1y = lastCtrl ? 2 * y - lastCtrl[1] : y;
				}
				const c2x = ox + num();
				const c2y = oy + num();
				const nx = ox + num();
				const ny = oy + num();
				segments.push([x, y, c1x, c1y, c2x, c2y, nx, ny]);
				lastCtrl = [c2x, c2y];
				lastQuad = null;
				x = nx;
				y = ny;
			} else if (C === "Q" || C === "T") {
				let qx;
				let qy;
				if (C === "Q") {
					qx = ox + num();
					qy = oy + num();
				} else {
					qx = lastQuad ? 2 * x - lastQuad[0] : x;
					qy = lastQuad ? 2 * y - lastQuad[1] : y;
				}
				const nx = ox + num();
				const ny = oy + num();
				segments.push([x, y, x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny]);
				lastQuad = [qx, qy];
				lastCtrl = null;
				x = nx;
				y = ny;
			} else if (C === "A") {
				const rx = num();
				const ry = num();
				const rot = num();
				const large = num();
				const sweep = num();
				const nx = ox + num();
				const ny = oy + num();
				for (const c of arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny)) {
					segments.push([x, y, ...c]);
					x = c[4];
					y = c[5];
				}
				x = nx;
				y = ny;
				lastCtrl = lastQuad = null;
			} else throw new Error(`LitStage.morph: unsupported command ${cmd}`);
		}
		if (!segments.length) throw new Error("LitStage.morph: empty path");
		return { segments, closed };
	}

	const bez = (s, t) => {
		const u = 1 - t;
		return [u * u * u * s[0] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6], u * u * u * s[1] + 3 * u * u * t * s[3] + 3 * u * t * t * s[5] + t * t * t * s[7]];
	};

	/** n points spaced evenly by arc length along the path. */
	function resample(d, n) {
		const { segments, closed } = toCubics(d);
		const dense = [];
		for (const s of segments) for (let k = 0; k < 48; k++) dense.push(bez(s, k / 48));
		const last = segments[segments.length - 1];
		dense.push([last[6], last[7]]);
		const acc = [0];
		for (let k = 1; k < dense.length; k++) acc.push(acc[k - 1] + Math.hypot(dense[k][0] - dense[k - 1][0], dense[k][1] - dense[k - 1][1]));
		const total = acc[acc.length - 1];
		const out = [];
		const count = closed ? n : n - 1;
		let j = 0;
		for (let k = 0; k < n; k++) {
			const target = (k / count) * total;
			while (j < acc.length - 2 && acc[j + 1] < target) j++;
			const span = acc[j + 1] - acc[j] || 1;
			const f = clamp((target - acc[j]) / span);
			out.push([lerp(dense[j][0], dense[j + 1][0], f), lerp(dense[j][1], dense[j + 1][1], f)]);
		}
		return { points: out, closed };
	}

	/**
	 * Single-subpath morph: both paths are normalized to cubics, resampled to the same number of
	 * points by arc length, and (for closed shapes) the start point of `to` is rotated to the best
	 * match. Returns p -> path data. Multi-subpath morphs are unsupported and throw.
	 */
	function morph(fromD, toD, { points = 96 } = {}) {
		const a = resample(fromD, points);
		const b = resample(toD, points);
		let shift = 0;
		if (a.closed && b.closed) {
			let best = Number.POSITIVE_INFINITY;
			for (let k = 0; k < points; k++) {
				let sum = 0;
				for (let i = 0; i < points; i++) {
					const q = b.points[(i + k) % points];
					sum += (a.points[i][0] - q[0]) ** 2 + (a.points[i][1] - q[1]) ** 2;
				}
				if (sum < best) {
					best = sum;
					shift = k;
				}
			}
		}
		const target = a.points.map((_, i) => b.points[(i + shift) % points]);
		const closed = a.closed && b.closed;
		return (p) => {
			const e = clamp(p);
			const pts = a.points.map((pt, i) => [lerp(pt[0], target[i][0], e), lerp(pt[1], target[i][1], e)]);
			return `M${pts.map((pt) => `${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`).join("L")}${closed ? "Z" : ""}`;
		};
	}

	// ---------------------------------------------------------------- masks, clips and colour

	/** clip-path helpers; each sets the style and returns the CSS value it wrote. */
	const clip = Object.freeze({
		circle(el, p, { x = "50%", y = "50%", max = 150 } = {}) {
			const value = `circle(${(clamp(p) * max).toFixed(3)}% at ${x} ${y})`;
			el.style.clipPath = value;
			return value;
		},
		inset(el, top = 0, right = 0, bottom = 0, left = 0, round = 0) {
			const value = `inset(${top}% ${right}% ${bottom}% ${left}%${round ? ` round ${round}px` : ""})`;
			el.style.clipPath = value;
			return value;
		},
		/** Reveal from one side: dir is "left", "right", "up" or "down". */
		wipe(el, p, dir = "right") {
			const hide = ((1 - clamp(p)) * 100).toFixed(3);
			const sides = { right: `0 ${hide}% 0 0`, left: `0 0 0 ${hide}%`, down: `0 0 ${hide}% 0`, up: `${hide}% 0 0 0` }[dir];
			const value = `inset(${sides})`;
			el.style.clipPath = value;
			return value;
		},
		polygon(el, points) {
			const value = `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(", ")})`;
			el.style.clipPath = value;
			return value;
		},
	});

	/** A soft linear mask edge travelling across the element; p 0..1, angle in degrees. */
	function maskSweep(el, p, { angle = 90, softness = 12 } = {}) {
		const edge = -softness + clamp(p) * (100 + 2 * softness);
		const value = `linear-gradient(${angle}deg, #000 ${(edge - softness).toFixed(3)}%, transparent ${(edge + softness).toFixed(3)}%)`;
		el.style.maskImage = value;
		el.style.webkitMaskImage = value;
		return value;
	}

	const toLinear = (c) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	const toSrgb = (l) => Math.round(255 * clamp(l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055));
	const parseHex = (hex) => {
		const h = hex.replace("#", "");
		const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
		return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
	};
	/** Mix two #RRGGBB colours in linear light; returns #rrggbb. */
	function mix(a, b, p) {
		const A = parseHex(a).map(toLinear);
		const B = parseHex(b).map(toLinear);
		return `#${A.map((v, i) => toSrgb(lerp(v, B[i], clamp(p))).toString(16).padStart(2, "0")).join("")}`;
	}
	/** #RRGGBB plus alpha as an rgba() string. */
	const alpha = (hex, a) => `rgba(${parseHex(hex).join(", ")}, ${clamp(a)})`;

	// ---------------------------------------------------------------- contract and text

	/**
	 * text(el, {decor}) marks a DOM element as copy (default) or as decor, illustrative text drawn
	 * inside the subject. text({content, x, y, w, h, decor}) registers text drawn on a canvas this
	 * frame, so the renderer's text QA can find it; call it inside render(t) for every canvas word.
	 */
	function text(target, options = {}) {
		if (target && typeof target === "object" && target.nodeType === 1) {
			target.dataset.litText = options.decor ? "decor" : "copy";
			return target;
		}
		const entry = { content: String(target.content ?? ""), x: Number(target.x), y: Number(target.y), w: Number(target.w), h: Number(target.h), decor: target.decor === true };
		global.__litClock?.registerText(entry);
		return entry;
	}

	/** Declare the film: { width, height, fps, duration, render(t) }. */
	function define(config) {
		global.litStage = config;
		return config;
	}

	global.LitStage = Object.freeze({ define, text, ease, cubicBezier, spring, kf, at, stagger, seq, rand, splitText, drawPath, morph, clip, maskSweep, mix, alpha, clamp, lerp, invLerp, remap });
})(window);
