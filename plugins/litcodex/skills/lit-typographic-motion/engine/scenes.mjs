// The six starter scenes. Each is instantiated once per timeline entry and exposes a pure
// render(frame) that returns a display list plus post overrides for that instant only (MO-A-05).
// Beats inside a scene are anchored to local progress, never to literal frames (MO-A-06). All
// layouts stay inside title-safe; non-glyph furniture stays inside action-safe.
import { SAFE } from "./constants.mjs";
import { roleColor } from "./presets.mjs";
import { loadStrokeFont, partialStrokes, strokeText, writtenLength } from "./stroke.mjs";
import { eojeols, fitBlock, layoutLine } from "./type.mjs";
import { clamp, ease, hexToRgb8, lerp, noise1, progress } from "./util.mjs";

const W = 1920;
const H = 1080;
// Content columns: the terminal window sits inside action-safe, so its text starts further in.
const COLUMNS = Object.freeze({ default: Object.freeze([128, 1792]), terminalcore: Object.freeze([200, 1720]) });

export function mixHex(a, b, t) {
	const x = hexToRgb8(a);
	const y = hexToRgb8(b);
	const k = clamp(t);
	return `#${x.map((v, i) => Math.round(lerp(v, y[i], k)).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const lineHeightFor = (script, lines) => (lines >= 3 ? 1.6 : script === "latin" ? 1.5 : 1.6);

class Scene {
	constructor(ctx) {
		this.ctx = ctx;
		this.shot = ctx.shot;
		this.preset = ctx.preset;
		this.book = ctx.book;
		this.stateful = ctx.stateful;
		this.prerollMax = ctx.stateful ? this.shot.holdSec : 0;
		this.handlesTransition = false;
		[this.left, this.right] = COLUMNS[this.preset.id] ?? COLUMNS.default;
		this.maxWidth = this.right - this.left;
	}

	color(role) {
		return roleColor(this.preset, role) ?? roleColor(this.preset, "type");
	}

	voice(name) {
		return this.preset.voices[name];
	}

	/** Shared terminal furniture for terminalcore: one window, its label, two meters (MO-SH-11). */
	terminal(f, items) {
		if (this.preset.id !== "terminalcore") return;
		const pad = 72;
		const box = [SAFE.action.x + pad, SAFE.action.y + pad, W - SAFE.action.x - pad, H - SAFE.action.y - pad];
		const meters = [0, 1].map((k) => 0.35 + 0.3 * (0.5 + 0.5 * noise1(f.t * 1.3 + k * 7.1, this.ctx.runSeed % 997)));
		items.push({ type: "terminal", elementId: `${this.shot.id}/window`, box, fill: this.color("panel"), stroke: this.color("rule"), chromePx: 1.5, meters, meterColor: this.color("signal"), titleBarPx: 40 });
		if (!this.ctx.showIndex) return;
		const index = `${String(this.ctx.order + 1).padStart(2, "0")}/${String(this.ctx.total).padStart(2, "0")}`;
		items.push(this.textItem(`${this.shot.id}/label`, fitBlock(this.book, index, this.voice("machine"), { maxWidth: 400, sizePx: 32, minSizePx: 32 }), { x: box[0] + 20, y: box[1] + 31, fill: this.color("secondary"), voice: "machine" }));
	}

	textItem(elementId, block, { x, y, fill, alpha = 1, voice, lineHeight = null, scale = 1, pivot = null, limit = Number.POSITIVE_INFINITY, source = null }) {
		const lh = lineHeight ?? lineHeightFor(block.lines[0]?.runs[0]?.script ?? "latin", block.lines.length);
		const pitch = block.sizePx * lh;
		let remaining = limit;
		const lines = block.lines.map((layout, i) => {
			const to = Math.max(0, Math.min(layout.glyphs.length, remaining));
			remaining -= layout.glyphs.length;
			return { layout, x, y: y + i * pitch, from: 0, to };
		});
		return { type: "text", elementId, voice, fill, alpha, fontSizePx: block.sizePx, lines, scale, pivot, source, block: block.lines.length > 1 ? { lines: block.lines.length, lineHeight: lh } : null };
	}

	blockHeight(block, lh = null) {
		const ratio = lh ?? lineHeightFor(block.lines[0]?.runs[0]?.script ?? "latin", block.lines.length);
		return block.sizePx * ratio * (block.lines.length - 1) + block.lines[0].capHeight;
	}
}

class TitleSlam extends Scene {
	constructor(ctx) {
		super(ctx);
		const text = this.shot.text;
		this.steps = this.preset.widthSteps.length ? this.preset.widthSteps : [this.voice("display").latin];
		const widest = fitBlock(this.book, text, { ...this.voice("display"), latin: this.steps[0] }, { maxWidth: this.maxWidth, sizePx: 176, minSizePx: 64, maxLines: 2, trackingEm: -0.02 });
		const breaks = widest.lines.map((line) => line.text);
		const block = (latin, hangul) => ({ sizePx: widest.sizePx, lines: breaks.map((line) => layoutLine(this.book, line, { ...this.voice("display"), latin, hangul }, widest.sizePx, -0.02)) });
		this.stepBlocks = this.steps.map((latin) => ({ regular: block(latin, this.voice("body").hangul), bold: block(latin, this.voice("display").hangul) }));
		this.final = this.stepBlocks[this.stepBlocks.length - 1].bold;
		this.baseline = Math.round(H * 0.47 - this.blockHeight(this.final) / 2 + this.final.lines[0].capHeight);
	}

	render(f) {
		const items = [];
		this.terminal(f, items);
		const fill = this.color("type");
		if (this.preset.id === "terminalcore") {
			const count = Math.floor(f.lt * this.preset.motion.typeInCharsPerSec);
			const item = this.textItem(`${this.shot.id}/title`, this.final, { x: this.left + 40, y: this.baseline, fill, voice: "display", limit: count, source: this.shot.text });
			items.push(item, this.caret(item, f));
			return { items };
		}
		if (this.preset.id === "tidal") {
			const drift = progress(f.lt, 0, 0.9, "drift");
			items.push(this.textItem(`${this.shot.id}/title`, this.final, { x: this.left + 12 * f.p, y: this.baseline + 24 * (1 - drift), fill, alpha: drift, voice: "display", source: this.shot.text }));
			items.push(this.rule(f, 0.25));
			return { items };
		}
		const slam = this.preset.motion.slamSec;
		const k = clamp(f.lt / slam);
		const stepIndex = Math.min(this.steps.length - 1, Math.floor(k * this.steps.length));
		const block = k >= 0.5 ? this.stepBlocks[stepIndex].bold : this.stepBlocks[stepIndex].regular;
		const scale = lerp(this.preset.motion.entranceScale, 1, ease.slam(k));
		items.push(this.textItem(`${this.shot.id}/title`, block, { x: this.left, y: this.baseline, fill, alpha: ease.slam(k), voice: "display", scale, pivot: [this.left, this.baseline], source: this.shot.text }));
		items.push(this.rule(f, 0.5));
		if (this.ctx.showIndex) {
			const index = `${String(this.ctx.order + 1).padStart(2, "0")} / ${String(this.ctx.total).padStart(2, "0")}`;
			items.push(this.textItem(`${this.shot.id}/index`, fitBlock(this.book, index, this.voice("machine"), { maxWidth: 300, sizePx: 28, minSizePx: 28 }), { x: this.left, y: 180, fill: this.color("secondary"), voice: "machine" }));
		}
		return { items };
	}

	rule(f, wipeSec) {
		const lh = lineHeightFor(this.final.lines[0].runs[0]?.script ?? "latin", this.final.lines.length);
		const y = this.baseline + Math.round(this.final.sizePx * 0.36) + (this.final.lines.length - 1) * this.final.sizePx * lh;
		const width = Math.max(...this.final.lines.map((l) => l.width));
		return { type: "rule", elementId: `${this.shot.id}/rule`, x0: this.left, y0: y, x1: this.left + width * progress(f.lt, 0.1, 0.1 + wipeSec, "slam"), y1: y, widthPx: 2, fill: this.color("rule"), alpha: 1 };
	}

	caret(item, f) {
		const last = item.lines.reduce((acc, line) => (line.to > 0 ? line : acc), item.lines[0]);
		const glyph = last.layout.glyphs[Math.max(0, last.to - 1)];
		const x = last.x + (last.to > 0 && glyph ? glyph.x + glyph.advance : 0) + 8;
		const on = Math.floor(f.lt * this.preset.passes.find((p) => p.pass === "terminal-ui").params.caretBlinkHz * 2) % 2 === 0;
		return { type: "caret", elementId: `${this.shot.id}/caret`, x, y: last.y - item.fontSizePx * 0.72, w: Math.round(item.fontSizePx * 0.45), h: Math.round(item.fontSizePx * 0.8), fill: this.color("signal"), alpha: on ? 1 : 0 };
	}
}

class WordLine extends Scene {
	constructor(ctx) {
		super(ctx);
		const voice = this.shot.script === "latin" ? this.voice("display") : { ...this.voice("display"), hangul: this.voice("body").hangul };
		this.voiceSet = this.preset.id === "terminalcore" ? this.voice("display") : voice;
		this.block = fitBlock(this.book, this.shot.text, this.voiceSet, { maxWidth: this.maxWidth, sizePx: 104, minSizePx: 48, maxLines: 3 });
		this.words = [];
		const units = this.shot.reveals;
		let unit = 0;
		this.block.lines.forEach((layout, lineIndex) => {
			let cursor = 0;
			for (const word of eojeols(layout.text)) {
				const start = layout.text.indexOf(word, cursor);
				const from = Array.from(layout.text.slice(0, start)).length;
				const glyphCount = Array.from(word).length;
				this.words.push({ lineIndex, from, to: from + glyphCount, reveal: units[unit] ?? units[units.length - 1] });
				cursor = start + word.length;
				unit++;
			}
		});
		const lh = lineHeightFor(this.shot.script === "latin" ? "latin" : "hangul", this.block.lines.length);
		this.lh = lh;
		this.top = Math.round(H * 0.5 - this.blockHeight(this.block, lh) / 2 + this.block.lines[0].capHeight);
	}

	render(f) {
		const items = [];
		this.terminal(f, items);
		const pending = this.color("pending");
		const lit = this.color("type");
		for (const [k, word] of this.words.entries()) {
			const a = progress(f.t, word.reveal.start, word.reveal.start + 0.18, "slam");
			const layout = this.block.lines[word.lineIndex];
			const drift = this.preset.id === "tidal" ? 10 * (1 - progress(f.t, word.reveal.start, word.reveal.start + 0.6, "drift")) : 0;
			const item = this.textItem(`${this.shot.id}/w${k}`, { sizePx: this.block.sizePx, lines: [layout] }, { x: this.left, y: this.top + word.lineIndex * this.block.sizePx * this.lh - drift * a, fill: mixHex(pending, lit, a), voice: "display" });
			item.lines[0].from = word.from;
			item.lines[0].to = word.to;
			item.block = this.block.lines.length > 1 ? { lines: this.block.lines.length, lineHeight: this.lh } : null;
			items.push(item);
		}
		return { items };
	}
}

class KineticList extends Scene {
	constructor(ctx) {
		super(ctx);
		this.items = this.shot.reveals.slice(0, 6).map((reveal) => ({ reveal, block: fitBlock(this.book, reveal.text, this.voice("display"), { maxWidth: this.maxWidth - 180, sizePx: 88, minSizePx: 40, maxLines: 1 }) }));
		const size = Math.min(...this.items.map((item) => item.block.sizePx));
		this.items = this.items.map((item) => ({ ...item, block: fitBlock(this.book, item.reveal.text, this.voice("display"), { maxWidth: this.maxWidth - 180, sizePx: size, minSizePx: 32, maxLines: 1 }) }));
		this.size = size;
		const script = this.shot.script === "latin" ? "latin" : "hangul";
		this.lh = lineHeightFor(script, this.items.length);
		this.pitch = Math.round(size * this.lh);
		this.top = Math.round(H * 0.5 - (this.pitch * (this.items.length - 1)) / 2 + size * 0.35);
	}

	render(f) {
		const out = [];
		this.terminal(f, out);
		this.items.forEach((item, k) => {
			const a = progress(f.t, item.reveal.start, item.reveal.start + 0.3, this.preset.id === "tidal" ? "drift" : "slam");
			const y = this.top + k * this.pitch;
			const x = this.left + 150 + 48 * (1 - a);
			const number = fitBlock(this.book, String(k + 1).padStart(2, "0"), this.voice("machine"), { maxWidth: 120, sizePx: 40, minSizePx: 40 });
			out.push(this.textItem(`${this.shot.id}/n${k}`, number, { x: this.left, y, fill: this.color("index"), alpha: a, voice: "machine" }));
			const text = this.textItem(`${this.shot.id}/i${k}`, item.block, { x, y, fill: this.color("type"), alpha: a, voice: "display" });
			text.block = { lines: this.items.length, lineHeight: this.lh, kind: "list" };
			out.push(text);
		});
		return { items: out };
	}
}

class NumberCounter extends Scene {
	constructor(ctx) {
		super(ctx);
		const match = /\d[\d,]*(?:\.\d+)?/u.exec(this.shot.text);
		this.target = match ? Number(match[0].replace(/,/gu, "")) : 0;
		this.decimals = match && match[0].includes(".") ? match[0].split(".")[1].length : 0;
		this.grouped = Boolean(match?.[0].includes(","));
		this.label = match ? this.shot.text.replace(match[0], "").replace(/\s{2,}/gu, " ").trim() : this.shot.text;
		const widest = this.format(this.target);
		this.numberBlock = fitBlock(this.book, widest, this.voice("display"), { maxWidth: this.maxWidth, sizePx: 240, minSizePx: 96, maxLines: 1 });
		this.labelBlock = this.label ? fitBlock(this.book, this.label, this.voice("body"), { maxWidth: this.maxWidth, sizePx: 60, minSizePx: 36, maxLines: 2 }) : null;
		this.baseline = Math.round(H * 0.5 + this.numberBlock.lines[0].capHeight * 0.3);
	}

	format(value) {
		const fixed = value.toFixed(this.decimals);
		if (!this.grouped) return fixed;
		const [whole, frac] = fixed.split(".");
		return whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",") + (frac ? `.${frac}` : "");
	}

	render(f) {
		const items = [];
		this.terminal(f, items);
		const k = progress(f.lt, 0, this.shot.holdSec * 0.6, "slam");
		const text = this.format(this.target * k);
		const layout = layoutLine(this.book, text, this.voice("display"), this.numberBlock.sizePx);
		const right = this.left + this.numberBlock.lines[0].width;
		items.push(this.textItem(`${this.shot.id}/number`, { sizePx: layout.sizePx, lines: [layout] }, { x: right - layout.width, y: this.baseline, fill: this.color("figure"), voice: "display" }));
		if (this.labelBlock) items.push(this.textItem(`${this.shot.id}/label`, this.labelBlock, { x: this.left, y: this.baseline + 120, fill: this.color("type"), alpha: progress(f.lt, 0.15, 0.5, "slam"), voice: "body", source: this.label }));
		return { items };
	}
}

class StrokeSignature extends Scene {
	constructor(ctx) {
		super(ctx);
		this.font = loadStrokeFont(this.shot.line.font && this.shot.line.font.startsWith("ems-") ? this.shot.line.font : "ems-allure");
		let size = 220;
		this.layout = strokeText(this.font, this.shot.text, size);
		while (this.layout.width > this.maxWidth && size > 60) {
			size = Math.floor(size * 0.92);
			this.layout = strokeText(this.font, this.shot.text, size);
		}
		const chars = Array.from(this.shot.text);
		const span = this.shot.holdSec * 0.72;
		const per = span / Math.max(1, chars.length);
		this.charTimes = chars.map((_, i) => [this.shot.start + 0.12 + i * per, this.shot.start + 0.12 + (i + 1) * per]);
		this.x = this.left;
		this.y = Math.round(H * 0.56);
	}

	render(f) {
		const items = [];
		this.terminal(f, items);
		const length = writtenLength(this.layout, this.charTimes, f.t);
		items.push({ type: "stroke", elementId: `${this.shot.id}/signature`, text: this.shot.text, fontKey: this.font.key, fontFile: this.font.file, fontSizePx: this.layout.sizePx, capHeightPx: this.layout.capHeight, polylines: partialStrokes(this.layout, length, this.x, this.y), widthPx: Math.max(3, Math.round(this.layout.sizePx / 40)), fill: this.color("type"), alpha: 1, voice: "signature" });
		return { items };
	}
}

class EndCard extends Scene {
	constructor(ctx) {
		super(ctx);
		this.main = fitBlock(this.book, this.shot.text, this.voice("display"), { maxWidth: this.maxWidth, sizePx: 120, minSizePx: 48, maxLines: 2, trackingEm: -0.01 });
		const footer = ctx.footer && ctx.footer !== this.shot.text ? ctx.footer : "";
		this.footer = footer ? fitBlock(this.book, footer, this.voice("machine"), { maxWidth: this.maxWidth - 60, sizePx: 30, minSizePx: 28, maxLines: 1 }) : null;
		this.baseline = Math.round(H * 0.46 - this.blockHeight(this.main) / 2 + this.main.lines[0].capHeight);
	}

	render(f) {
		const items = [];
		this.terminal(f, items);
		const a = progress(f.lt, 0, 0.5, this.preset.id === "tidal" ? "drift" : "slam");
		items.push(this.textItem(`${this.shot.id}/main`, this.main, { x: this.left, y: this.baseline, fill: this.color("type"), alpha: a, voice: "display", source: this.shot.text }));
		const footerY = this.baseline + this.blockHeight(this.main) + 110;
		if (this.footer) items.push(this.textItem(`${this.shot.id}/footer`, this.footer, { x: this.left + 60, y: footerY, fill: this.color("secondary"), alpha: progress(f.lt, 0.3, 0.8, "slam"), voice: "machine" }));
		const accent = roleColor(this.preset, "accent");
		const window = this.ctx.accentWindow;
		if (this.ctx.accent && accent && window && f.t >= window[0] && f.t < window[1]) {
			items.push({ type: "rule", elementId: `${this.shot.id}/accent`, x0: this.left, y0: footerY - 10, x1: this.left + 28, y1: footerY - 10, widthPx: 28, fill: accent, alpha: 1, accent: true });
		}
		return { items };
	}
}

export const SCENES = Object.freeze({
	"title-slam": TitleSlam,
	"word-line": WordLine,
	"kinetic-list": KineticList,
	"number-counter": NumberCounter,
	"stroke-signature": StrokeSignature,
	"end-card": EndCard,
});

export function createScene(ctx) {
	const Kind = SCENES[ctx.shot.sceneId];
	if (!Kind) throw new Error(`unknown scene: ${ctx.shot.sceneId}`);
	return new Kind(ctx);
}

