// Stage text QA, node side (director brief 6g). A separate Chrome replays the clock from 0; the
// master capture never has its styles touched. At each QA sample (every beat midpoint plus two
// settled frames per beat) it captures A, hides all text ink, captures B, and restores. The ink
// mask is where A and B differ inside a run's rects; contrast then uses the Wave 1 measurement.
// Copy runs are held to contrast, title-safe and reading time; decor runs only warn on contrast.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureContrast } from "./gate.mjs";
import { SKILL_ROOT } from "./fonts.mjs";
import { linearOf } from "./image.mjs";
import { capture, stepFrame } from "./stage.mjs";
import { normalizeText, stripQuoted } from "./treatment.mjs";
import { readingFloor } from "./type.mjs";

const QA = Object.freeze({ inkDelta: 2, minInk: 12, visibleOpacity: 0.6, settledOpacity: 0.95, settledMovePx: 2, probeFps: 10, readingTolerance: 0.1, decorShare: 0.25, presenceStd: 8 / 255, largeShare: 0.03 });
// Internal family names start with the product family (Archivo Condensed Black, Pretendard GOV,
// Galmuri9 Regular), so a face matches by normalized prefix.
const PRODUCT_PREFIXES = ["archivo", "pretendardgov", "vt323", "galmuri9", "meslolgsnf"];
export const isProductFamily = (name) => PRODUCT_PREFIXES.some((prefix) => normalizeText(name).startsWith(prefix));
const INTERNAL_TERM = /\b(?:path|preset|gate|beat|treatment)\b/iu;
const FILE_NAME = /\b[\w-]+\.(?:html|json|js|mjs|css|png|svg|jpe?g|webp|wav|mp4)\b/iu;

export const qaScript = () => readFileSync(join(SKILL_ROOT, "engine", "stage-qa.js"), "utf8");

/** QA sample frames: each beat's midpoint (for fonts and presence) and two settled frames. */
export function qaSamples(treatment, fps, frameCount) {
	const clamp = (f) => Math.max(0, Math.min(frameCount - 1, f));
	const samples = new Map();
	treatment.beats.forEach((beat, i) => {
		const span = beat.t1 - beat.t0;
		samples.set(clamp(Math.round(((beat.t0 + beat.t1) / 2) * fps)), { beat: i, kind: "mid" });
		for (const at of [0.75, 0.9]) {
			const f = clamp(Math.round((beat.t0 + at * span) * fps));
			if (!samples.has(f)) samples.set(f, { beat: i, kind: "settled" });
		}
	});
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
export async function collectQA({ session, treatment, fps, frameCount, width, height, pool }) {
	const samples = qaSamples(treatment, fps, frameCount);
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
		observed.push({ frame: f, ...sample, state, a: a.rgba, b: b.rgba, fonts });
	}
	return { samples, track, positions, observed, probeEvery };
}

/** Gate rules from the QA observations (director brief 6g checks and severities). */
export function qaRules({ treatment, width, height, fps, collected }) {
	const lines = treatment.copy.lines.map(normalizeText);
	const safe = [Math.round(width * 0.05), Math.round(height * 0.05), Math.round(width * 0.95), Math.round(height * 0.95)];
	const safeText = `[${safe[0]},${safe[1]}]-[${safe[2]},${safe[3]}]`;
	const largePx = QA.largeShare * Math.min(width, height);
	const faults = { contrast: [], contrastWarn: [], safe: [], decor: [], decorShare: [], meta: new Set(), unlisted: new Set(), fonts: [], fontsWarn: [], state: [], canvas: new Set() };
	const found = new Set();
	const request = normalizeText(treatment.request);
	const requestBare = normalizeText(stripQuoted(treatment.request));
	const idea = normalizeText(treatment.idea);
	let measured = 0;
	let presence = 0;
	let mids = 0;
	for (const sample of collected.observed) {
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
		const textInk = visibleText.reduce((sum, v) => sum + v.ink.count, 0);
		const decorInk = visibleText.filter((v) => v.run.decor).reduce((sum, v) => sum + v.ink.count, 0);
		if (textInk > 0 && decorInk / textInk > QA.decorShare) faults.decorShare.push(`${Math.round((decorInk / textInk) * 100)}% decor at frame ${frame}`);
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
			rule("QA-DECOR", "decor text carries no copy, at most 25% of text", faults.decor.length || faults.decorShare.length ? "FAIL" : "PASS", faults.decor.length ? `decor run carries copy: ${list(faults.decor)}` : faults.decorShare.length ? list(faults.decorShare) : "decor text stays decor"),
			rule("QA-META", "no request, idea, file name or internal term on screen", faults.meta.size ? "WARN" : "PASS", faults.meta.size ? `${list([...faults.meta])}; the look must answer it` : "no meta labels"),
			rule("QA-UNLISTED", "text on screen is copy or decor", faults.unlisted.size ? "WARN" : "PASS", faults.unlisted.size ? `neither in copy.lines nor marked decor: ${list([...faults.unlisted])}; list it as copy or mark it decor` : "every visible run is copy or decor"),
			rule("QA-FONTS", "only the product's faces", faults.fonts.length ? "FAIL" : faults.fontsWarn.length ? "WARN" : "PASS", faults.fonts.length ? list(faults.fonts) : faults.fontsWarn.length ? list(faults.fontsWarn) : "every sampled run renders in a product face"),
			rule("QA-CANVAS", "canvas text", faults.canvas.size ? "WARN" : "PASS", faults.canvas.size ? `${[...faults.canvas].join("; ")}; the look must answer it` : "no unmeasured canvas text"),
			rule("QA-STATE", "stable state while text is hidden", faults.state.length ? "WARN" : "PASS", faults.state.length ? `${list(faults.state, 2)} (samples discarded)` : "no state moved"),
			rule("QA-PRESENCE", "something besides text on screen", mids && presence * 2 >= mids ? "PASS" : "WARN", `${presence} of ${mids} beat midpoints show non-text detail`),
		],
	};
}
