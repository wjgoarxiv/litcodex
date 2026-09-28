// Composer: time t -> the display list and pass uniforms for one sample, and output frame n -> the
// full command the browser renders plus the frame line the gate reads (textBoxes, furniture boxes,
// fills, events, post values). Its only state is the glyph-definition cache (outlines the page
// already holds) and the previous frame's post values, used to detect flash rises and invert changes.
import { EVENTS, POST_NEUTRAL } from "./constants.mjs";
import { fontEntry } from "./fonts.mjs";
import { bootFlicker, passUniforms } from "./passes.mjs";
import { roleColor } from "./presets.mjs";
import { createScene } from "./scenes.mjs";
import { clamp, representativeSample, round6, subSampleTimes, transformBox, unionBox } from "./util.mjs";

const FONT_WEIGHT = (key) => fontEntry(key)?.weight ?? 400;
const FONT_FILE = (key) => fontEntry(key)?.path ?? key;
const WIDTH_PCT = (key) => fontEntry(key)?.width ?? null;

export class Composer {
	constructor({ book, preset, plan, passPlans, runSeed, fps, footer, showIndex = false, accentShotId, accentWindow, stateful }) {
		this.book = book;
		this.preset = preset;
		this.shots = plan.shots;
		this.totalFrames = plan.totalFrames;
		this.passPlans = passPlans;
		this.runSeed = runSeed;
		this.fps = fps;
		this.stateful = stateful;
		this.handles = new Map();
		this.sent = new Set();
		this.scenes = new Map();
		this.order = preset.passes.map((p) => p.pass);
		this.previousPost = null;
		this.shots.forEach((shot, order) => {
			this.scenes.set(shot.id, createScene({ shot, preset, book, runSeed, order, total: this.shots.length, footer, showIndex, accent: shot.id === accentShotId, accentWindow, stateful }));
		});
	}

	shotAt(t) {
		for (const shot of this.shots) if (t >= shot.start - 1e-9 && t < shot.end - 1e-9) return shot;
		return this.shots[this.shots.length - 1];
	}

	shotOfFrame(n) {
		return this.shots.find((shot) => n >= shot.frameStart && n <= shot.frameEnd) ?? this.shots[this.shots.length - 1];
	}

	handle(id) {
		if (!this.handles.has(id)) this.handles.set(id, this.handles.size + 1);
		return this.handles.get(id);
	}

	/** Display list, pass uniforms and overrides for one sample time. */
	sample(t, { still = false, frame = 0 } = {}) {
		const shot = this.shotAt(t);
		const scene = this.scenes.get(shot.id);
		const lt = t - shot.start;
		const f = { t, lt, p: clamp(lt / shot.holdSec), start: shot.start, end: shot.end, beat: shot.beat, beatPhase: (lt / shot.beat) % 1 };
		const { items, overrides = {} } = scene.render(f);
		const plans = this.passPlans.get(shot.id).passes;
		const terminalPlan = plans.find((p) => p.pass === "terminal-ui");
		const glyphs = [];
		const strokes = [];
		const lines = [];
		const terminal = [];
		const defs = [];
		for (const item of items) {
			if (item.type === "text") glyphs.push(this.glyphGroup(item, defs));
			else if (item.type === "stroke") strokes.push({ fill: item.fill, alpha: item.alpha, widthPx: item.widthPx, polylines: item.polylines });
			else if (item.type === "rule") lines.push(item);
			else if (item.type === "terminal" || item.type === "caret") terminal.push(item);
		}
		const passes = plans.map((plan) => {
			const firstFrameOfShot = frame === shot.frameStart;
			const uniforms = passUniforms(plan, t, this.fps, { still, firstFrameOfShot, bootOffset: bootFlicker(terminalPlan, t) });
			const step = { pass: plan.pass, uniforms };
			if (plan.pass === "tidal-gradient") step.colors = { bg: roleColor(this.preset, "background"), stopA: plan.params.paletteStopsHex[0], stopB: plan.params.paletteStopsHex[1] };
			if (plan.pass === "swiss-grid") step.lines = plan.params.showGuides ? [...lines, ...guideLines(plan.params, roleColor(this.preset, "rule"))] : lines;
			if (plan.pass === "terminal-ui") step.terminal = terminal;
			return step;
		});
		const hasGrid = this.order.includes("swiss-grid");
		if (!hasGrid && lines.length) {
			for (const rule of lines) terminal.push({ type: "caret", elementId: rule.elementId, x: Math.min(rule.x0, rule.x1), y: rule.y0 - rule.widthPx / 2, w: Math.abs(rule.x1 - rule.x0) || rule.widthPx, h: rule.widthPx, fill: rule.fill, alpha: rule.alpha });
		}
		return { shot, items, overrides, cmd: { background: roleColor(this.preset, "background"), glyphs, strokes, passes }, defs };
	}

	glyphGroup(item, defs) {
		const draws = [];
		const scale = item.scale ?? 1;
		const pivot = item.pivot ?? [0, 0];
		for (const line of item.lines) {
			for (let i = line.from; i < line.to; i++) {
				const g = line.layout.glyphs[i];
				const entry = this.book.glyphs.get(g.id);
				if (!entry || entry.empty) continue;
				const h = this.handle(g.id);
				if (!this.sent.has(h)) {
					this.sent.add(h);
					defs.push([h, entry.d]);
				}
				const x = pivot[0] + (line.x + g.x - pivot[0]) * scale;
				const y = pivot[1] + (line.y - pivot[1]) * scale;
				draws.push(h, round6(x), round6(y), g.s * scale);
			}
		}
		return { fill: item.fill, alpha: item.alpha, draws };
	}

	/** Geometry the gate reads: one textBox per (element, script run) actually drawn. */
	textBoxes(items, post) {
		const boxes = [];
		for (const item of items) {
			if (item.type === "stroke") {
				if (!item.polylines.length || item.alpha <= 0) continue;
				let box = null;
				for (const line of item.polylines) for (let i = 0; i < line.length; i += 2) box = unionBox(box, [line[i] - item.widthPx / 2, line[i + 1] - item.widthPx / 2, line[i] + item.widthPx / 2, line[i + 1] + item.widthPx / 2]);
				boxes.push({ elementId: item.elementId, text: item.text, voice: "signature", fontFile: item.fontFile, fontSizePx: item.fontSizePx, capHeightPx: round6(item.capHeightPx), weight: 400, fill: item.fill, bbox: roundBox(transformBox(box, post.zoom, post.shake)), script: "latin", trackingEm: 0, widthPct: null, scaleX: 1, outline: false, halo: false, block: null });
				continue;
			}
			if (item.type !== "text" || item.alpha <= 0) continue;
			const scale = item.scale ?? 1;
			const pivot = item.pivot ?? [0, 0];
			const runs = new Map();
			for (const line of item.lines) {
				for (let i = line.from; i < line.to; i++) {
					const g = line.layout.glyphs[i];
					const entry = this.book.glyphs.get(g.id);
					const run = line.layout.runs[g.run];
					const key = `${run.fontKey}:${run.script}`;
					if (!runs.has(key)) runs.set(key, { run, text: "", box: null, cap: line.layout.capHeight });
					const record = runs.get(key);
					record.text += g.char;
					if (!entry || entry.empty) continue;
					const b = entry.box;
					const x0 = line.x + g.x + b[0] * g.s;
					const x1 = line.x + g.x + b[2] * g.s;
					const y0 = line.y + b[1] * g.s;
					const y1 = line.y + b[3] * g.s;
					const scaled = [pivot[0] + (x0 - pivot[0]) * scale, pivot[1] + (y0 - pivot[1]) * scale, pivot[0] + (x1 - pivot[0]) * scale, pivot[1] + (y1 - pivot[1]) * scale];
					record.box = unionBox(record.box, scaled);
				}
			}
			for (const { run, text, box, cap } of runs.values()) {
				if (!box) continue;
				boxes.push({
					elementId: item.elementId,
					text: text.trim(),
					voice: item.voice,
					fontFile: FONT_FILE(run.fontKey),
					fontSizePx: round6(item.fontSizePx * scale),
					capHeightPx: round6(cap * scale),
					weight: FONT_WEIGHT(run.fontKey),
					fill: item.fill,
					bbox: roundBox(transformBox(box, post.zoom, post.shake)),
					script: run.script,
					trackingEm: run.trackingEm,
					widthPct: run.script === "hangul" ? null : WIDTH_PCT(run.fontKey),
					scaleX: 1,
					outline: false,
					halo: false,
					alpha: item.alpha,
					block: item.block,
				});
			}
		}
		return boxes;
	}

	/** Non-glyph furniture boxes for action-safe (MO-C-05) and fill samples for accent counting (MO-C-29). */
	furniture(items, post) {
		const elements = [];
		const fills = [{ source: "background", color: roleColor(this.preset, "background"), w: 1920, h: 1080 }];
		const tidal = this.preset.passes.some((p) => p.pass === "tidal-gradient");
		if (tidal) for (const stop of [this.preset.palette.teal, this.preset.palette.violet]) fills.push({ source: "tidal-gradient", color: stop, w: 1920, h: 1080 });
		for (const item of items) {
			if (item.type === "rule") {
				if (item.alpha <= 0 || item.x1 === item.x0) continue;
				const half = item.widthPx / 2;
				const box = transformBox([Math.min(item.x0, item.x1) - half, Math.min(item.y0, item.y1) - half, Math.max(item.x0, item.x1) + half, Math.max(item.y0, item.y1) + half], post.zoom, post.shake);
				elements.push({ elementId: item.elementId, kind: "rule", bbox: roundBox(box) });
				fills.push({ source: item.elementId, color: item.fill, w: box[2] - box[0], h: box[3] - box[1], accent: item.accent === true });
			} else if (item.type === "terminal") {
				elements.push({ elementId: item.elementId, kind: "window", bbox: roundBox(transformBox(item.box, post.zoom, post.shake)) });
				fills.push({ source: item.elementId, color: item.fill, w: item.box[2] - item.box[0], h: item.box[3] - item.box[1] });
				fills.push({ source: `${item.elementId}/meter`, color: item.meterColor, w: 220, h: 8 });
			} else if (item.type === "caret" && item.alpha > 0) {
				elements.push({ elementId: item.elementId, kind: "caret", bbox: roundBox(transformBox([item.x, item.y, item.x + item.w, item.y + item.h], post.zoom, post.shake)) });
				fills.push({ source: item.elementId, color: item.fill, w: item.w, h: item.h });
			} else if (item.type === "text" && item.alpha > 0) {
				fills.push({ source: item.elementId, color: item.fill, w: item.fontSizePx, h: item.fontSizePx, glyph: true });
			}
		}
		return { elements, fills };
	}

	/** Post values for a frame: preset defaults, then the representative sample's overrides (MO-A-28/58). */
	postFor(overrides, { still = false } = {}) {
		const post = { ...POST_NEUTRAL, ...this.preset.post, ...overrides };
		if (still) post.grain = 0;
		return post;
	}

	/**
	 * Everything for output frame n: the browser command and the frame line metadata. `still`
	 * renders with grain and random noise at 0 (poster and reduced-motion still).
	 */
	frame(n, { samples, shutter, still = false, countInk = true, mask = false }) {
		const times = subSampleTimes(n, this.fps, samples, shutter);
		const rep = representativeSample(samples);
		const built = times.map((t) => this.sample(t, { still, frame: n }));
		const defs = built.flatMap((b) => b.defs);
		const repSample = built[rep];
		const post = this.postFor(repSample.overrides, { still });
		const tn = n / this.fps;
		const shot = this.shotOfFrame(n);
		const events = this.passPlans.get(shot.id).events.filter((event) => event.frame === n).map((event) => event.source);
		const previous = this.previousPost;
		if (previous && post.flash > EVENTS.flashRise && previous.flash <= EVENTS.flashRise) events.push("flash-rise");
		if (previous && post.invert !== previous.invert) events.push("invert-change");
		this.previousPost = post;
		const { elements, fills } = this.furniture(repSample.items, post);
		const blocks = repSample.items.filter((item) => item.type === "text" && item.source && item.lines.length > 1).map((item) => ({ elementId: item.elementId, sourceText: item.source, lines: item.lines.map((line) => line.layout.text) }));
		return {
			cmd: { samples: built.map((b) => b.cmd), post, grainKey: n >>> 0, order: this.order, countInk, mask, defs, maskCurvature: built[rep].cmd.passes.find((p) => p.pass === "crt")?.uniforms.u_curvature ?? 0 },
			line: {
				frame: n,
				t: round6(tn),
				shotId: shot.id,
				textBoxes: this.textBoxes(repSample.items, post),
				elements,
				fills,
				blocks,
				events,
				post: { flash: post.flash, invert: post.invert, zoom: post.zoom, shake: post.shake, fade: post.fade, grain: post.grain },
				stateful: this.stateful,
			},
		};
	}

	resetPostTracking() {
		this.previousPost = null;
	}
}

const roundBox = (box) => box.map((v) => Math.round(v * 100) / 100);

function guideLines(params, color) {
	const lines = [];
	const inner = 1920 - 2 * params.marginPx;
	const col = (inner - (params.columns - 1) * params.gutterPx) / params.columns;
	for (let c = 0; c <= params.columns; c++) {
		const x = params.marginPx + c * (col + params.gutterPx) - (c === params.columns ? params.gutterPx : 0);
		lines.push({ elementId: `guide/c${c}`, x0: x, y0: 54, x1: x, y1: 1026, widthPx: params.hairlineWidthPx, fill: color, alpha: 0.5 });
	}
	return lines;
}
