// Stage text QA, node side (director brief 6g). A separate Chrome replays the clock from 0; the
// master capture never has its styles touched. At each QA sample (every beat midpoint plus two
// settled frames per beat) it captures A, hides all text ink, captures B, and restores. The ink
// mask is where A and B differ inside a run's rects; contrast then uses the Wave 1 measurement.
// Copy runs are held to contrast, title-safe and reading time; decor runs only warn on contrast. A
// film that names a house style is also held to it: text over text (also across the cuts), copy off
// the style's colours, faces or type scale, copy outside its shot's type zone, and a rich film's
// regions left empty. `boardQA` runs the style rules alone at the beat midpoints and the cuts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureContrast } from "./gate.mjs";
import { SKILL_ROOT } from "./fonts.mjs";
import { linearOf, regionFill } from "./image.mjs";
import { capture, stepFrame } from "./stage.mjs";
import { LAYOUTS, ZONE_TOLERANCE, readStyle, scaleStep, styleAccents, styleFamilies, styleTextColors } from "./styles.mjs";
import { normalizeText, stripQuoted } from "./treatment.mjs";
import { readingFloor } from "./type.mjs";

const QA = Object.freeze({
	inkDelta: 2,
	minInk: 12,
	visibleOpacity: 0.6,
	settledOpacity: 0.95,
	settledMovePx: 2,
	probeFps: 10,
	readingTolerance: 0.1,
	decorShare: 0.25,
	decorShareRich: 0.6,
	presenceStd: 8 / 255,
	largeShare: 0.03,
	overlapShare: 0.08,
	colourDistance: 12,
	cutWindowSec: 0.4,
	cutStep: 2,
	emptyRegion: 0.15,
	emptyRegionsMax: 2,
});
// The rules boardQA returns: the ones the board round can judge from midpoints and cut frames alone.
export const BOARD_RULES = Object.freeze(["TEXT-OVERLAP", "TEXT-ON-STYLE", "TEXT-ZONE"]);
// Internal family names start with the product family (Archivo Condensed Black, Pretendard Bold,
// Galmuri9 Regular), so a face matches by normalized prefix.
const PRODUCT_PREFIXES = ["archivo", "pretendard", "vt323", "galmuri9", "meslolgsnf", "jetbrainsmono"];
export const isProductFamily = (name) => PRODUCT_PREFIXES.some((prefix) => normalizeText(name).startsWith(prefix));
const INTERNAL_TERM = /\b(?:path|preset|gate|beat|treatment)\b/iu;
const FILE_NAME = /\b[\w-]+\.(?:html|json|js|mjs|css|png|svg|jpe?g|webp|wav|mp4)\b/iu;

export const qaScript = () => readFileSync(join(SKILL_ROOT, "engine", "stage-qa.js"), "utf8");

/**
 * QA sample frames: each beat's midpoint (for fonts and presence) and two settled frames; with
 * `cuts`, also every second frame within 0.4 s of each cut (kind "cut"), where an outgoing and an
 * incoming line can cross. A board round (`board`) skips the settled frames: the midpoints and the
 * cut neighbours are what a stills-only look shows.
 */
export function qaSamples(treatment, fps, frameCount, { cuts = false, board = false } = {}) {
	const clamp = (f) => Math.max(0, Math.min(frameCount - 1, f));
	const samples = new Map();
	treatment.beats.forEach((beat, i) => {
		const span = beat.t1 - beat.t0;
		samples.set(clamp(Math.round(((beat.t0 + beat.t1) / 2) * fps)), { beat: i, kind: "mid" });
		if (board) return;
		for (const at of [0.75, 0.9]) {
			const f = clamp(Math.round((beat.t0 + at * span) * fps));
			if (!samples.has(f)) samples.set(f, { beat: i, kind: "settled" });
		}
	});
	if (cuts) {
		const reach = Math.round(QA.cutWindowSec * fps);
		treatment.beats.forEach((beat, i) => {
			if (i === 0) return;
			const at = Math.round(beat.t0 * fps);
			for (let f = clamp(at - reach); f <= clamp(at + reach); f += QA.cutStep) if (!samples.has(f)) samples.set(f, { beat: f < at ? i - 1 : i, kind: "cut" });
		});
	}
	return samples;
}

const bucket = (rect, width, height) => `${Math.min(2, Math.floor((((rect[0] + rect[2]) / 2) / width) * 3))}${Math.min(2, Math.floor((((rect[1] + rect[3]) / 2) / height) * 3))}`;
const union = (rects) => rects.reduce((b, r) => (b ? [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])] : [...r]), null);
const quote = (text) => `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;

/** Classify a run against the treatment's copy lines (normalized). */
function classify(run, lines) {
	const norm = normalizeText(run.text);
	const carries = lines.filter((line) => line && (norm.includes(line) || (norm.length >= 2 && line.includes(norm))));
	return { norm, carriesCopy: carries.length > 0, isCopy: !run.decor && carries.length > 0 };
}

/** Per-pixel ink map: 1 where A and B differ by more than 2 levels in any channel. */
function inkMap(a, b, width, height) {
	const map = new Uint8Array(width * height);
	for (let i = 0, p = 0; p < map.length; i += 4, p++) if (Math.abs(a[i] - b[i]) > QA.inkDelta || Math.abs(a[i + 1] - b[i + 1]) > QA.inkDelta || Math.abs(a[i + 2] - b[i + 2]) > QA.inkDelta) map[p] = 1;
	return map;
}

function inkIn(map, width, rect) {
	let count = 0;
	let box = null;
	const [x0, y0, x1, y1] = [Math.max(0, Math.floor(rect[0])), Math.max(0, Math.floor(rect[1])), Math.ceil(rect[2]), Math.ceil(rect[3])];
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < Math.min(x1, width); x++)
			if (map[y * width + x]) {
				count++;
				box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)] : [x, y, x + 1, y + 1];
			}
	return { count, box };
}

/**
 * Replay the clock in the QA session and collect everything the text rules need. Returns the raw
 * observations; `qaRules` turns them into gate rules.
 */
export async function collectQA({ session, treatment, fps, frameCount, width, height, pool, board = false }) {
	const samples = qaSamples(treatment, fps, frameCount, { cuts: Boolean(treatment.style), board });
	const probeEvery = Math.max(1, Math.round(fps / QA.probeFps));
	const neighbours = new Set();
	for (const f of samples.keys()) for (const d of [-2, 2]) neighbours.add(Math.max(0, Math.min(frameCount - 1, f + d)));
	const last = Math.max(...samples.keys(), ...neighbours);
	const track = new Map();
	const positions = new Map();
	const observed = [];
	await session.cdp.send("DOM.enable");
	await session.cdp.send("CSS.enable");
	for (let f = 0; f <= Math.min(frameCount - 1, last + probeEvery); f++) {
		const sample = samples.get(f);
		await stepFrame(session, f, Boolean(sample));
		const probe = f % probeEvery === 0;
		if (!sample && !probe && !neighbours.has(f)) continue;
		const state = await session.page.evaluate((mark) => window.__litQA.runs({ mark }), Boolean(sample && sample.kind === "mid"));
		const onScreen = (run) => run.opacity >= QA.visibleOpacity && run.rects.some((r) => r[2] > 0 && r[3] > 0 && r[0] < width && r[1] < height);
		if (probe) {
			for (const run of state.runs) {
				if (!run.rects.length) continue;
				const key = `${normalizeText(run.text)}|${bucket(union(run.rects), width, height)}`;
				if (!track.has(key)) track.set(key, { text: run.text, decor: run.decor, frames: [] });
				if (onScreen(run)) track.get(key).frames.push(f);
			}
		}
		if (neighbours.has(f)) positions.set(f, state.runs.map((run) => ({ text: normalizeText(run.text), box: run.rects.length ? union(run.rects) : null })));
		if (!sample) continue;
		const pngA = await capture(session, width, height);
		await session.page.evaluate(() => window.__litQA.hideText());
		const pngB = await capture(session, width, height);
		await session.page.evaluate(() => window.__litQA.showText());
		let fonts = null;
		if (sample.kind === "mid") {
			fonts = [];
			const { root } = await session.cdp.send("DOM.getDocument", { depth: -1 });
			const { nodeIds } = await session.cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-lit-qa-run]" });
			for (const nodeId of nodeIds) {
				const attrs = (await session.cdp.send("DOM.getAttributes", { nodeId })).attributes;
				const index = Number(attrs[attrs.indexOf("data-lit-qa-run") + 1]);
				const platform = await session.cdp.send("CSS.getPlatformFontsForNode", { nodeId }).catch(() => ({ fonts: [] }));
				fonts.push({ index, families: platform.fonts.map((font) => ({ name: font.familyName, custom: font.isCustomFont })) });
			}
		}
		const [a, b] = await Promise.all([pool.decode(pngA), pool.decode(pngB)]);
		if (sample.kind === "cut") {
			// Dozens of these per film: keep each run's ink count, not the two frames.
			const map = inkMap(a.rgba, b.rgba, width, height);
			observed.push({ frame: f, ...sample, state, inks: state.runs.map((run) => run.rects.reduce((sum, r) => sum + inkIn(map, width, r).count, 0)) });
			continue;
		}
		observed.push({ frame: f, ...sample, state, a: a.rgba, b: b.rgba, fonts });
	}
	return { samples, track, positions, observed, probeEvery };
}

const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const overlapArea = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const totalArea = (rects) => rects.reduce((sum, r) => sum + area(r), 0);

/** [r, g, b] of a CSS colour string (rgb(), rgba() or #hex), or null. */
export function parseCssColour(value) {
	const text = String(value ?? "").trim();
	const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/u.exec(text);
	if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
	const hex = /^#([0-9a-f]{6})$/iu.exec(text);
	return hex ? [0, 2, 4].map((i) => Number.parseInt(hex[1].slice(i, i + 2), 16)) : null;
}

/**
 * TEXT-OVERLAP: pairs of visible, non-decor text runs whose rects cover more than 8 % of the smaller
 * run. `visible` is [{ run, count }] (run with rects and text, count its ink pixels). A decor run and
 * a pseudo-element run (which reports its element's box) never count.
 */
export function overlapFaults(visible, frame, cut = false) {
	const real = visible.filter(({ run }) => !run.decor && !run.pseudo && run.rects.length);
	const faults = [];
	for (let i = 0; i < real.length; i++)
		for (let j = i + 1; j < real.length; j++) {
			const [a, b] = [real[i].run, real[j].run];
			let shared = 0;
			for (const ra of a.rects) for (const rb of b.rects) shared += overlapArea(ra, rb);
			if (shared > QA.overlapShare * Math.min(totalArea(a.rects), totalArea(b.rects))) faults.push(`${quote(a.text)} x ${quote(b.text)}@${frame}${cut ? " (cut)" : ""}`);
		}
	return faults;
}

/**
 * TEXT-ON-STYLE and TEXT-ZONE for one settled run against the film's house style. `isCopy` runs are
 * held to the style's colours and faces and to their shot's type zone; every run to the type scale.
 * Returns [{ kind: "colour" | "face" | "scale" | "scaleOther" | "zone", text }].
 */
export function styleFaults({ style, rich, format, width, height, layout, run, box, isCopy, frame }) {
	const faults = [];
	const where = `${quote(run.text)}@${frame}`;
	if (isCopy) {
		const rgb = parseCssColour(run.color);
		const allowed = [...styleTextColors(style), ...(rich ? styleAccents(style).map((a) => a.color.toLowerCase()) : [])].map(parseCssColour);
		if (!run.gradient && rgb && !allowed.some((c) => Math.hypot(c[0] - rgb[0], c[1] - rgb[1], c[2] - rgb[2]) <= QA.colourDistance)) faults.push({ kind: "colour", text: `${where} ${run.color}` });
		if (run.family && !styleFamilies(style).has(run.family)) faults.push({ kind: "face", text: `${where} ${run.family}` });
	}
	if (!scaleStep(style, format, run.fontSizePx)) faults.push({ kind: isCopy ? "scale" : "scaleOther", text: `${where} ${Math.round(run.fontSizePx * 10) / 10}px` });
	const zone = isCopy && layout ? LAYOUTS[format][layout]?.type : undefined;
	if (isCopy && layout && zone === null) faults.push({ kind: "zone", text: `${where} in a full shot (no copy zone)` });
	else if (zone) {
		const [zx, zy, zw, zh] = [zone[0] * width, zone[1] * height, zone[2] * width, zone[3] * height];
		const [tx, ty] = [width * ZONE_TOLERANCE, height * ZONE_TOLERANCE];
		if (box[0] < zx - tx || box[1] < zy - ty || box[2] > zx + zw + tx || box[3] > zy + zh + ty) faults.push({ kind: "zone", text: `${where} outside the ${layout} type zone` });
	}
	return faults;
}

/** The three house-style gate rules from the collected findings (see overlapFaults, styleFaults). */
export function styleRules({ style, format, found, crossed }) {
	const list = (items, n = 4) => [...new Set(items)].slice(0, n).join("; ");
	const steps = Object.entries(style.scale[format]).map(([k, v]) => `${k} ${v}`).join(", ");
	const fails = [
		found.colour.length ? `colour off the ${style.id} text roles (${style.textRoles.join(", ")}): ${list(found.colour, 3)}` : null,
		found.face.length ? `face outside the style (${[...styleFamilies(style)].join(", ")}): ${list(found.face, 3)}` : null,
		found.scale.length ? `size off the type scale (${steps} px, +-4 %): ${list(found.scale, 3)}` : null,
	].filter(Boolean);
	const rule = (id, name, status, detail) => ({ id, name, status, detail });
	return [
		found.overlap.length
			? rule("TEXT-OVERLAP", "no text over text", "FAIL", `text over text: ${list(found.overlap)}`)
			: rule("TEXT-OVERLAP", "no text over text", "PASS", `no two visible text runs overlap at the QA samples${crossed ? " or across the cuts" : ""}`),
		fails.length
			? rule("TEXT-ON-STYLE", "copy on the house style", "FAIL", fails.join("; "))
			: found.scaleOther.length
				? rule("TEXT-ON-STYLE", "copy on the house style", "WARN", `copy is on the ${style.id} style; other text off the scale: ${list(found.scaleOther, 3)}`)
				: rule("TEXT-ON-STYLE", "copy on the house style", "PASS", `copy uses the ${style.id} colours, faces and type scale`),
		found.zone.length ? rule("TEXT-ZONE", "copy inside its shot's type zone", "FAIL", list(found.zone)) : rule("TEXT-ZONE", "copy inside its shot's type zone", "PASS", "every settled copy run sits in its shot's type zone"),
	];
}

/**
 * RICH-FILL: a rich film fills its frame. At each beat midpoint at most two of the 12 regions may sit
 * empty (busy share under 0.15); the end card may breathe, so one beat may miss. A minimal film keeps
 * its negative space. `fills` is [{ beat, regions }].
 */
export function richFillRule(register, fills) {
	const rule = (status, detail) => ({ id: "RICH-FILL", name: "a rich film fills the frame", status, detail });
	if (register !== "rich") return rule("N/A", "minimal register: negative space is the point");
	if (!fills.length) return rule("N/A", "region fill not measured");
	const thin = fills.map(({ beat, regions }) => ({ beat, empty: regions.filter((v) => v < QA.emptyRegion).length })).filter((x) => x.empty > QA.emptyRegionsMax);
	if (thin.length <= 1) return rule("PASS", `${fills.length - thin.length} of ${fills.length} beat midpoints fill the frame (at most ${QA.emptyRegionsMax} of 12 regions empty)`);
	return rule("FAIL", `${thin.length} of ${fills.length} beat midpoints leave the frame empty: ${thin.map((x) => `beat ${x.beat + 1} has ${x.empty} of 12 regions empty`).join(", ")}; fill them with the world's parts: labelled panels, counters, a log, the product's own screens`);
}

/** Gate rules from the QA observations (director brief 6g checks and severities). */
export function qaRules({ treatment, width, height, fps, collected }) {
	const lines = treatment.copy.lines.map(normalizeText);
	const safe = [Math.round(width * 0.05), Math.round(height * 0.05), Math.round(width * 0.95), Math.round(height * 0.95)];
	const safeText = `[${safe[0]},${safe[1]}]-[${safe[2]},${safe[3]}]`;
	const largePx = QA.largeShare * Math.min(width, height);
	const faults = { contrast: [], contrastWarn: [], safe: [], decor: [], decorShare: [], meta: new Set(), unlisted: new Set(), fonts: [], fontsWarn: [], state: [], canvas: new Set() };
	const style = treatment.style ? readStyle(treatment.style) : null;
	const format = width >= height ? "16:9" : "9:16";
	const rich = treatment.register === "rich";
	const findings = { overlap: [], colour: [], face: [], scale: [], scaleOther: [], zone: [] };
	const perBeat = treatment.beats.map((beat, i) => ({ beat: i, layout: beat.layout ?? null, overlap: [], style: [], zone: [] }));
	const fills = [];
	const note = (beat, kind, text) => {
		findings[kind].push(text);
		perBeat[beat]?.[kind === "overlap" || kind === "zone" ? kind : "style"].push(text);
	};
	const found = new Set();
	const request = normalizeText(treatment.request);
	const requestBare = normalizeText(stripQuoted(treatment.request));
	const idea = normalizeText(treatment.idea);
	let measured = 0;
	let presence = 0;
	let mids = 0;
	// Cut samples carry only each run's ink count; they feed the text-over-text rule and nothing else.
	for (const sample of collected.observed.filter((o) => o.kind === "cut")) {
		const visible = sample.state.runs.map((run, i) => ({ run, count: sample.inks[i] })).filter(({ run, count }) => run.opacity >= QA.visibleOpacity && count >= QA.minInk);
		for (const text of overlapFaults(visible, sample.frame, true)) note(sample.beat, "overlap", text);
	}
	for (const sample of collected.observed.filter((o) => o.kind !== "cut")) {
		const { state, a, b, frame } = sample;
		const map = inkMap(a, b, width, height);
		const runs = state.runs.map((run) => ({ ...run, ...classify(run, lines) }));
		const textRects = runs.flatMap((run) => run.rects).concat(state.registered.map((t) => [t.x, t.y, t.x + t.w, t.y + t.h]));
		const inside = new Uint8Array(width * height);
		for (const r of textRects) for (let y = Math.max(0, Math.floor(r[1]) - 2); y < Math.min(height, Math.ceil(r[3]) + 2); y++) for (let x = Math.max(0, Math.floor(r[0]) - 2); x < Math.min(width, Math.ceil(r[2]) + 2); x++) inside[y * width + x] = 1;
		let stray = 0;
		for (let p = 0; p < map.length; p++) if (map[p] && !inside[p]) stray++;
		if (sample.kind === "mid") {
			mids++;
			let sum = 0;
			let sq = 0;
			let n = 0;
			for (let p = 0, i = 0; p < inside.length; p++, i += 4) {
				if (inside[p]) continue;
				const l = 0.2126 * linearOf(b[i]) + 0.7152 * linearOf(b[i + 1]) + 0.0722 * linearOf(b[i + 2]);
				sum += l;
				sq += l * l;
				n++;
			}
			if (n && Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) > QA.presenceStd) presence++;
			if (rich) fills.push({ beat: sample.beat, regions: regionFill(a, width, height) });
		}
		const visibleText = [];
		for (const run of runs) {
			const ink = run.rects.reduce((acc, r) => {
				const part = inkIn(map, width, r);
				return { count: acc.count + part.count, box: part.box ? union([acc.box ?? part.box, part.box]) : acc.box };
			}, { count: 0, box: null });
			if (run.opacity < QA.visibleOpacity || ink.count < QA.minInk) continue;
			visibleText.push({ run, ink });
			if (run.decor && run.carriesCopy) faults.decor.push(`${quote(run.text)}@${frame}`);
			if (!run.decor && ((request && run.norm.includes(request)) || (requestBare.length >= 6 && run.norm.includes(requestBare)) || (idea && run.norm.includes(idea)) || INTERNAL_TERM.test(run.text) || FILE_NAME.test(run.text))) faults.meta.add(quote(run.text));
			if (run.isCopy && ink.box && (ink.box[0] < safe[0] || ink.box[1] < safe[1] || ink.box[2] > safe[2] || ink.box[3] > safe[3])) faults.safe.push(`${quote(run.text)}@${frame}`);
			if (!run.decor && !run.isCopy) faults.unlisted.add(quote(run.text));
		}
		if (style) for (const text of overlapFaults(visibleText.map((v) => ({ run: v.run, count: v.ink.count })), frame)) note(sample.beat, "overlap", text);
		const textInk = visibleText.reduce((sum, v) => sum + v.ink.count, 0);
		const decorInk = visibleText.filter((v) => v.run.decor).reduce((sum, v) => sum + v.ink.count, 0);
		if (textInk > 0 && decorInk / textInk > (rich ? QA.decorShareRich : QA.decorShare)) faults.decorShare.push(`${Math.round((decorInk / textInk) * 100)}% decor at frame ${frame}`);
		const reading = [...runs.filter((r) => r.opacity >= QA.visibleOpacity && r.rects.length).map((r) => ({ y: r.rects[0][1], x: r.rects[0][0], text: r.norm })), ...state.registered.map((t) => ({ y: t.y, x: t.x, text: normalizeText(t.content) }))].sort((p, q) => p.y - q.y || p.x - q.x);
		const joined = reading.map((r) => r.text).join("");
		for (const line of lines) if (joined.includes(line) || reading.some((r) => r.text === line)) found.add(line);
		for (const entry of sample.fonts ?? []) {
			const run = runs.find((r) => r.index === entry.index);
			if (!run || !run.rects.length || run.opacity < QA.visibleOpacity) continue;
			const foreign = entry.families.filter((font) => !isProductFamily(font.name));
			if (foreign.length) (run.isCopy ? faults.fonts : faults.fontsWarn).push(`${quote(run.text)} uses ${foreign.map((font) => font.name).join(", ")}`);
		}
		if (state.canvases > 0) faults.canvas.add(state.registered.length ? "registered canvas text: its contrast is not measured" : "canvas text not measured (a canvas is on screen and no text was registered with LitStage.text)");
		if (stray > 0) {
			faults.state.push(`frame ${frame}: ${stray} px changed outside text when the text ink was hidden`);
			continue;
		}
		const neighbours = [frame - 2, frame + 2].map((f) => collected.positions.get(f)).filter(Boolean);
		for (const { run, ink } of visibleText) {
			if (run.opacity < QA.settledOpacity || !ink.box) continue;
			const moved = neighbours.some((list) => {
				const other = list.find((o) => o.text === run.norm && o.box);
				const own = union(run.rects);
				return !other || Math.max(...own.map((v, i) => Math.abs(v - other.box[i]))) >= QA.settledMovePx;
			});
			if (moved) continue;
			if (style && !run.pseudo) for (const fault of styleFaults({ style, rich, format, width, height, layout: treatment.beats[sample.beat]?.layout, run, box: ink.box, isCopy: run.isCopy, frame })) note(sample.beat, fault.kind, fault.text);
			const runMask = new Uint8Array(width * height);
			for (const r of run.rects) for (let y = Math.max(0, Math.floor(r[1])); y < Math.min(height, Math.ceil(r[3])); y++) for (let x = Math.max(0, Math.floor(r[0])); x < Math.min(width, Math.ceil(r[2])); x++) if (map[y * width + x]) runMask[y * width + x] = 255;
			const result = measureContrast({ bbox: ink.box, capHeightPx: run.fontSizePx, fill: run.gradient ? "gradient" : "solid", fontSizePx: run.fontSizePx, weight: run.weight }, { width, height, rgba: a, mask: runMask }, { scale: 1, largeFontPx: largePx });
			if (!result) continue;
			measured++;
			if (result.ratio < result.floor) (run.isCopy ? faults.contrast : faults.contrastWarn).push(`${quote(run.text)}@${frame} ${result.ratio.toFixed(2)}:1 under ${result.floor}:1`);
		}
	}
	const readingFaults = [];
	for (const entry of collected.track.values()) {
		if (entry.decor || !entry.frames.length || !classify({ text: entry.text, decor: false }, lines).isCopy) continue;
		let best = 0;
		let runLength = 0;
		let previous = null;
		for (const f of entry.frames) {
			runLength = previous !== null && f - previous === collected.probeEvery ? runLength + 1 : 1;
			best = Math.max(best, runLength);
			previous = f;
		}
		const seconds = (best * collected.probeEvery) / fps;
		const floor = readingFloor(entry.text, "line");
		if (seconds < floor - QA.readingTolerance - 1e-9) readingFaults.push(`${quote(entry.text)} on screen ${seconds.toFixed(1)} s, reading floor ${floor.toFixed(1)} s`);
	}
	const missing = treatment.copy.lines.filter((line) => !found.has(normalizeText(line)));
	const list = (items, n = 4) => [...new Set(items)].slice(0, n).join("; ");
	const rule = (id, name, status, detail) => ({ id, name, status, detail });
	return {
		missing,
		rules: [
			rule("QA-CONTRAST", "copy contrast (3.0 large, 4.5 body)", faults.contrast.length ? "FAIL" : faults.contrastWarn.length || measured === 0 ? "WARN" : "PASS", faults.contrast.length ? list(faults.contrast) : faults.contrastWarn.length ? `decor or unlisted text only: ${list(faults.contrastWarn)}` : measured === 0 ? "no settled run was measurable; the look must judge legibility" : `${measured} settled runs measured`),
			rule("QA-TITLE-SAFE", "copy inside title-safe", faults.safe.length ? "FAIL" : "PASS", `${faults.safe.length ? `${list(faults.safe)} outside ` : "every copy run inside "}${safeText}`),
			rule("QA-READING", "copy reading floor", readingFaults.length ? "FAIL" : "PASS", readingFaults.length ? list(readingFaults) : `every copy run holds its reading floor (measured at ${QA.probeFps} fps)`),
			rule("QA-COPY", "every copy line on screen", missing.length ? "FAIL" : "PASS", missing.length ? `never on screen: ${missing.map(quote).join(", ")}` : `${lines.length} copy line(s) found`),
			rule("QA-DECOR", `decor text carries no copy, at most ${rich ? 60 : 25}% of text`, faults.decor.length || faults.decorShare.length ? "FAIL" : "PASS", faults.decor.length ? `decor run carries copy: ${list(faults.decor)}` : faults.decorShare.length ? list(faults.decorShare) : "decor text stays decor"),
			rule("QA-META", "no request, idea, file name or internal term on screen", faults.meta.size ? "WARN" : "PASS", faults.meta.size ? `${list([...faults.meta])}; the look must answer it` : "no meta labels"),
			rule("QA-UNLISTED", "text on screen is copy or decor", faults.unlisted.size ? "WARN" : "PASS", faults.unlisted.size ? `neither in copy.lines nor marked decor: ${list([...faults.unlisted])}; list it as copy or mark it decor` : "every visible run is copy or decor"),
			rule("QA-FONTS", "only the product's faces", faults.fonts.length ? "FAIL" : faults.fontsWarn.length ? "WARN" : "PASS", faults.fonts.length ? list(faults.fonts) : faults.fontsWarn.length ? list(faults.fontsWarn) : "every sampled run renders in a product face"),
			rule("QA-CANVAS", "canvas text", faults.canvas.size ? "WARN" : "PASS", faults.canvas.size ? `${[...faults.canvas].join("; ")}; the look must answer it` : "no unmeasured canvas text"),
			rule("QA-STATE", "stable state while text is hidden", faults.state.length ? "WARN" : "PASS", faults.state.length ? `${list(faults.state, 2)} (samples discarded)` : "no state moved"),
			rule("QA-PRESENCE", "something besides text on screen", mids && presence * 2 >= mids ? "PASS" : "WARN", `${presence} of ${mids} beat midpoints show non-text detail`),
			...(style ? styleRules({ style, format, found: findings, crossed: collected.observed.some((o) => o.kind === "cut") }) : []),
			...(treatment.register ? [richFillRule(treatment.register, fills)] : []),
		],
		perBeat,
	};
}

/**
 * The board round's text check (stills only, before any encode): replays the clock in `session`,
 * samples the beat midpoints and the frames around every cut, and returns the three house-style rules
 * with the findings per shot. No dead-air or fill rule: those need the whole film.
 */
export async function boardQA({ session, treatment, fps, frameCount, width, height, pool }) {
	const collected = await collectQA({ session, treatment, fps, frameCount, width, height, pool, board: true });
	const { rules, perBeat } = qaRules({ treatment, width, height, fps, collected });
	return { rules: rules.filter((r) => BOARD_RULES.includes(r.id)), perBeat };
}
