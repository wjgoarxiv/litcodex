// The numeric QA gate (Section C, D2 and the measurable HARD/CAP rows of Sections A and B). Every
// rule reads recorded data only: the manifest, the per-frame render log, the flash records the
// render logged on the exact encoder bytes, masks and frames kept for contrast, ffprobe output,
// export sizes, and the stored perf and determinism runs. Nothing here re-renders.
import { ACCENT, CHROME_COMMON_FLAGS, CHROME_GPU_FLAGS, CHROME_KEYCHAIN_FLAGS, CHROME_SOFTWARE_FLAGS, CONTRAST, EVENTS, FULL_FRAME_STEP, LINE_HEIGHT, MEASURE, NEAR_BLACK, OUTPUT, PASS_CAPS, PERF, POST_FIELDS, PROVISIONAL, REDUCED_MOTION, SAFE, SOFTWARE_GL, TIMING, TRACKING } from "./constants.mjs";
import { FONTS, STROKE_FONTS } from "./fonts.mjs";
import { countFlashes } from "./flash.mjs";
import { linearOf } from "./image.mjs";
import { PASS_IDS } from "./passes.mjs";
import { eojeols, readingFloor, countUnits } from "./type.mjs";
import { contrastRatio, hexToHsl, hueDistance, passSeed } from "./util.mjs";
import { soundRules } from "./sound.mjs";

const PASS = "PASS";
const FAIL = "FAIL";
const WARN = "WARN";

export const isSoftwareRenderer = (renderer) => SOFTWARE_GL.some((needle) => String(renderer ?? "").toLowerCase().includes(needle));

function rule(id, name, status, detail, extra = {}) {
	return { id, name, status, detail, provisional: PROVISIONAL.includes(id), ...extra };
}

const beatsOf = (manifest) => {
	if (Array.isArray(manifest.beatGrid)) return manifest.beatGrid;
	const beat = 60 / (manifest.bpm ?? TIMING.defaultBpm);
	const out = [];
	for (let t = 0; t <= (manifest.durationSec ?? 0) + beat; t += beat) out.push(Math.round(t * 1e6) / 1e6);
	return out;
};
const shotsOf = (manifest) => manifest.timeline.filter((entry) => entry.kind === "line" || entry.kind === "scene");

/** Timeline rules that run before any frame (pre-flight) and again in the full gate. */
export function timelineRules(manifest, { coverage = null } = {}) {
	const rules = [];
	const fps = manifest.fps;
	const units = manifest.timeline.map((entry) => ({ entry, floor: readingFloor(entry.text, entry.kind) }));
	const under = units.filter(({ entry, floor }) => entry.holdSec < floor - 1 / fps);
	const tightest = units.reduce((best, u) => (!best || u.entry.holdSec - u.floor < best.entry.holdSec - best.floor ? u : best), null);
	const cps = manifest.timeline.filter((e) => e.kind === "line" || e.kind === "scene").filter((e) => countUnits(e.text).C / e.holdSec > 17 + 1e-9);
	const hangul = under.filter(({ entry }) => /[가-힣]/u.test(entry.text));
	const latin = under.filter(({ entry }) => !/[가-힣]/u.test(entry.text));
	const describe = (u) => `"${u.entry.text}" (${u.entry.kind}) hold ${u.entry.holdSec.toFixed(3)} s vs floor ${u.floor.toFixed(3)} s`;
	rules.push(rule("MO-C-07", "EN reading time", latin.length || cps.length ? FAIL : PASS, latin.length ? `under floor: ${describe(latin[0])}` : cps.length ? `over 17 cps: "${cps[0].text}"` : `tightest unit ${tightest ? describe(tightest) : "none"}`, { tightest: tightest ? describe(tightest) : null }));
	rules.push(rule("MO-C-08", "KO reading time", hangul.length ? FAIL : PASS, hangul.length ? `under floor: ${describe(hangul[0])}` : "every Hangul unit at or above 0.2 s per syllable and the 1.0 s line floor"));
	const beats = beatsOf(manifest);
	const shots = shotsOf(manifest);
	const offBeat = shots.filter((shot) => shot.start > 0).map((shot) => ({ shot, gap: Math.min(...beats.map((b) => Math.abs(b - shot.start))) })).filter((x) => x.gap > 1 / fps + 1e-9);
	rules.push(rule("MO-A-15", "cut on the beat (<= 1 frame)", offBeat.length ? FAIL : PASS, offBeat.length ? `${offBeat[0].shot.id} starts ${(offBeat[0].gap * 1000).toFixed(1)} ms off the nearest beat` : `${shots.length} cuts within 1 frame of a beat`));
	const beatAt = (t) => {
		let k = 0;
		while (k + 1 < beats.length && beats[k + 1] <= t + 1e-9) k++;
		return (beats[k + 1] ?? beats[k] + 60 / (manifest.bpm ?? TIMING.defaultBpm)) - beats[k];
	};
	const short = shots.filter((shot) => shot.holdSec < TIMING.minSceneBeats * beatAt(shot.start) - 1 / fps);
	rules.push(rule("MO-A-16", "scene held >= 2 beats", short.length ? FAIL : PASS, short.length ? `${short[0].id} holds ${short[0].holdSec} s, under 2 beats` : "every scene holds at least 2 beats"));
	const split = manifest.timeline.filter((e) => e.kind === "reveal").filter((e) => {
		const parent = shots.find((s) => s.sceneId === e.sceneId && s.shotIndex === e.shotIndex);
		if (!parent) return true;
		const clean = (words) => words.map((w) => w.replace(/[,;·•|/]+$/u, "")).filter((w) => w && !/^[·•|/]+$/u.test(w));
		const tokens = clean(eojeols(parent.text));
		const reveal = clean(eojeols(e.text));
		return !tokens.some((_, i) => reveal.every((word, j) => tokens[i + j] === word));
	});
	rules.push(rule("MO-A-13", "no 어절 split in reveals", split.length ? FAIL : PASS, split.length ? `reveal "${split[0].text}" is not a run of whole 어절` : "every reveal step is whole 어절/words"));
	if (coverage) rules.push(rule("MO-D-04", "glyph coverage", coverage.length ? FAIL : PASS, coverage.length ? `missing ${coverage.map((m) => `${m.codepoint} "${m.char}" in ${m.fontKey}`).slice(0, 6).join(", ")}` : "every codepoint resolves in its face's cmap", { missing: coverage }));
	return rules;
}

function inside(box, margin, width = 1920, height = 1080) {
	return box[0] >= margin.x - 1e-6 && box[1] >= margin.y - 1e-6 && box[2] <= width - margin.x + 1e-6 && box[3] <= height - margin.y + 1e-6;
}
function overrun(box, margin, width = 1920, height = 1080) {
	return Math.max(margin.x - box[0], margin.y - box[1], box[2] - (width - margin.x), box[3] - (height - margin.y), 0);
}

/** Median and percentiles over a sorted array. */
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] : Number.NaN);

function morph(mask, width, height, box, radiusPx, grow) {
	const [x0, y0, x1, y1] = box;
	const radius = Math.max(0, Math.round(radiusPx));
	const out = new Uint8Array(mask.length);
	for (let y = y0; y < y1; y++)
		for (let x = x0; x < x1; x++) {
			let hit = grow ? 0 : 1;
			for (let dy = -radius; dy <= radius && (grow ? !hit : hit); dy++)
				for (let dx = -radius; dx <= radius; dx++) {
					const xx = x + dx;
					const yy = y + dy;
					const on = xx >= 0 && yy >= 0 && xx < width && yy < height && mask[yy * width + xx] >= 128;
					if (grow && on) {
						hit = 1;
						break;
					}
					if (!grow && !on) {
						hit = 0;
						break;
					}
				}
			out[y * width + x] = hit;
		}
	return out;
}

/** MO-C-06 contrast for one text box on one kept frame (CF-204 method, spec §C1). */
export function measureContrast(box, frame, { scale = frame.width / 1920, largeFontPx = null } = {}) {
	const { width, height, rgba, mask } = frame;
	const pad = CONTRAST.bboxExpandCap * box.capHeightPx;
	const inner = [Math.max(0, Math.floor(box.bbox[0] * scale)), Math.max(0, Math.floor(box.bbox[1] * scale)), Math.min(width, Math.ceil(box.bbox[2] * scale)), Math.min(height, Math.ceil(box.bbox[3] * scale))];
	const outer = [Math.max(0, Math.floor((box.bbox[0] - pad) * scale)), Math.max(0, Math.floor((box.bbox[1] - pad) * scale)), Math.min(width, Math.ceil((box.bbox[2] + pad) * scale)), Math.min(height, Math.ceil((box.bbox[3] + pad) * scale))];
	const eroded = morph(mask, width, height, inner, CONTRAST.erodePx * scale, false);
	const dilated = morph(mask, width, height, outer, CONTRAST.dilatePx * scale, true);
	const lum = (i) => 0.2126 * linearOf(rgba[i * 4]) + 0.7152 * linearOf(rgba[i * 4 + 1]) + 0.0722 * linearOf(rgba[i * 4 + 2]);
	const fg = [];
	for (let y = inner[1]; y < inner[3]; y++) for (let x = inner[0]; x < inner[2]; x++) if (eroded[y * width + x]) fg.push(lum(y * width + x));
	const bg = [];
	for (let y = outer[1]; y < outer[3]; y++) for (let x = outer[0]; x < outer[2]; x++) if (!dilated[y * width + x]) bg.push(lum(y * width + x));
	if (fg.length === 0 || bg.length === 0) return null;
	fg.sort((a, b) => a - b);
	bg.sort((a, b) => a - b);
	const fgValues = box.fill === "gradient" ? [pct(fg, 0.05), pct(fg, 0.95)] : [pct(fg, 0.5)];
	const bgValues = [pct(bg, 0.05), pct(bg, 0.95)];
	let worst = Number.POSITIVE_INFINITY;
	for (const f of fgValues) for (const b of bgValues) worst = Math.min(worst, contrastRatio(f, b));
	const large = largeFontPx !== null ? box.fontSizePx >= largeFontPx : box.fontSizePx >= CONTRAST.largeFontPx || (box.fontSizePx >= CONTRAST.largeBoldFontPx && box.weight >= CONTRAST.boldWeight);
	return { ratio: worst, floor: large ? CONTRAST.large : CONTRAST.body, large };
}

const LADDER = [...Object.values(CHROME_GPU_FLAGS), CHROME_SOFTWARE_FLAGS].map((rung) => [...rung, ...CHROME_COMMON_FLAGS, ...CHROME_KEYCHAIN_FLAGS].join(" "));

/**
 * Evaluate the full gate over loaded run data. Returns ordered rule results; the caller writes the
 * report. `data` fields: manifest, frames (frame lines), passLog (Map frame -> lines), preview
 * { records, fps }, exports { mp4, preview, poster, still }, probe, perf, determinism, contrast,
 * coverage, stillInk, round, framesViewed.
 */
export function evaluate(data) {
	const { manifest } = data;
	const rules = [];
	const frames = data.frames ?? [];
	const byFrame = new Map(frames.map((line) => [line.frame, line]));
	const total = Math.round(manifest.durationSec * manifest.fps);
	const shots = shotsOf(manifest);
	const software = isSoftwareRenderer(manifest.renderer);

	// MO-C-01 / MO-SH-00 / 00a / 00b: interval-union coverage by passes that drew.
	const ranges = Array.isArray(manifest.passRanges) ? manifest.passRanges : [];
	const covered = new Uint8Array(total);
	let gap = null;
	let continuity = null;
	for (const entry of ranges) {
		if (!PASS_IDS.includes(entry.pass)) continue;
		for (let f = entry.frameStart; f <= entry.frameEnd && f < total; f++) {
			const lines = data.passLog.get(f)?.filter((line) => line.pass === entry.pass) ?? [];
			if (lines.length === 0 && !continuity) continuity = `${entry.pass}@${entry.sceneId}#${entry.shotIndex} has no log line at frame ${f}`;
			if (lines.some((line) => line.draws >= 1)) covered[f] = 1;
		}
	}
	for (let f = 0; f < total && gap === null; f++) if (!covered[f]) gap = f;
	rules.push(rule("MO-C-01", "GLSL presence", ranges.length === 0 || gap !== null ? FAIL : PASS, ranges.length === 0 ? "manifest lists no look-library pass" : gap !== null ? `frame ${gap} has no look-library pass that issued a draw` : `${total} frames covered by passes with draws >= 1`));
	rules.push(rule("MO-SH-00", "passRanges record", ranges.length === 0 || ranges.some((e) => !PASS_IDS.includes(e.pass) || !Number.isInteger(e.frameStart) || !Number.isInteger(e.frameEnd)) ? FAIL : PASS, ranges.length === 0 ? "no passRanges entries" : `${ranges.length} entries`));
	rules.push(rule("MO-SH-00a", "render-log continuity", continuity ? FAIL : PASS, continuity ?? "every manifest range has a log line on every frame"));

	// MO-C-02 / MO-A-04 / MO-SH-09.
	const webgl2 = Boolean(manifest.renderer) && !String(manifest.renderer).startsWith("NO_WEBGL2");
	const unlabelled = software && manifest.softwareRenderer !== true;
	rules.push(rule("MO-C-02", "WebGL2 tier", !webgl2 || unlabelled ? FAIL : PASS, !webgl2 ? "WebGL2 unavailable" : unlabelled ? `software renderer "${manifest.renderer}" not labelled` : `${software ? "software" : "hardware"}: ${manifest.renderer}`));
	const downgradeFaults = [];
	if (software) {
		if (manifest.samples !== 1) downgradeFaults.push(`samples ${manifest.samples}, expected 1`);
		for (const entry of ranges) {
			if (entry.pass === "tidal-gradient" && (!entry.downgraded || entry.params.octaves !== Math.max(3, Math.floor((entry.params.octavesRequested ?? entry.params.octaves) / 2)))) downgradeFaults.push(`tidal-gradient@${entry.sceneId} not downgraded`);
			if (entry.pass === "crt" && (!entry.downgraded || entry.params.persistenceEnabled)) downgradeFaults.push(`crt@${entry.sceneId} persistence on under software GL`);
		}
	}
	rules.push(rule("MO-SH-09", "software-GL downgrade", downgradeFaults.length ? FAIL : PASS, downgradeFaults.length ? downgradeFaults[0] : software ? "samples 1, octaves halved, persistence off, entries marked downgraded" : "hardware renderer; no downgrade needed"));
	rules.push(rule("MO-A-04", "software GL reported", software && manifest.softwareRenderer !== true ? FAIL : software && manifest.samples !== 1 ? FAIL : PASS, software ? `software renderer labelled, samples ${manifest.samples}` : "hardware renderer"));

	// MO-C-03 / MO-SH-04 flash audit on the master (non-looping) and the exact preview frames (looping).
	const master = countFlashes(frames.map((line) => ({ f: line.frame, g: line.flash?.g ?? [0, 0], r: line.flash?.r ?? [0, 0] })), manifest.fps, false);
	const preview = data.preview?.records?.length ? countFlashes(data.preview.records, data.preview.fps, true) : null;
	const flashPass = master.pass && (preview === null || preview.pass);
	const worstG = Math.max(master.general.flashes, preview?.general.flashes ?? 0);
	const worstR = Math.max(master.red.flashes, preview?.red.flashes ?? 0);
	const worst = !master.pass || !preview ? master : preview;
	rules.push(rule("MO-C-03", "flash audit", flashPass && data.preview?.records?.length ? PASS : FAIL, `worst window ${worstG} general / ${worstR} red (limit 3 / 3)${preview ? "" : "; preview frames not audited"}${flashPass ? "" : `; worst at frame ${worst.general.startFrame} (${(worst.general.startFrame / manifest.fps).toFixed(2)} s): ${worst.general.transitions.slice(0, 8).join(" ")}`}`, { master, preview }));
	const step = frames.find((line) => (line.flash?.step ?? 0) > FULL_FRAME_STEP.areaFraction);
	rules.push(rule("MO-SH-04a", "no full-frame luminance step", step ? FAIL : PASS, step ? `frame ${step.frame}: ${(step.flash.step * 100).toFixed(1)}% of the frame stepped >= 0.1` : "no frame pair steps more than 25% of the frame"));

	// MO-C-04 / MO-C-05 safe areas; MO-A-33/35, MO-FT-04/08, MO-C-25..27 from textBoxes.
	let titleFault = null;
	let actionFault = null;
	let trackingFault = null;
	let hangulFault = null;
	let outlineFault = null;
	let strokeFault = null;
	let lineHeightFault = null;
	let measureFault = null;
	let measureAdvice = null;
	let breakFault = null;
	const allowedHangul = new Set(FONTS.filter((f) => f.family === "PretendardGOV" || f.family === "Galmuri9").map((f) => f.path));
	const strokeFiles = new Set(STROKE_FONTS.map((s) => s.file));
	for (const line of frames) {
		for (const box of line.textBoxes ?? []) {
			if (!titleFault && !inside(box.bbox, SAFE.title)) titleFault = `"${box.text}"@${line.frame}: ${overrun(box.bbox, SAFE.title).toFixed(1)} px outside title-safe`;
			const floor = box.voice === "display" ? TRACKING.displayMinEm : TRACKING.machineMinEm;
			if (!trackingFault && box.trackingEm < floor - 1e-9) trackingFault = `"${box.text}"@${line.frame} (${box.voice}) tracking ${box.trackingEm}em`;
			if (box.script === "hangul" && !hangulFault) {
				if (box.trackingEm !== 0 || (box.widthPct !== null && box.widthPct !== undefined)) hangulFault = `MO-FT-04 "${box.text}"@${line.frame}: tracking/width motion on a Hangul run`;
				else if (box.scaleX !== 1 || ![400, 700].includes(box.weight) || !allowedHangul.has(box.fontFile)) hangulFault = `MO-A-33 "${box.text}"@${line.frame}: ${box.fontFile} weight ${box.weight} scaleX ${box.scaleX}`;
			}
			if (!outlineFault && (box.outline || box.halo)) outlineFault = `"${box.text}"@${line.frame} is outlined or haloed`;
			if (!strokeFault && box.voice === "signature" && !strokeFiles.has(box.fontFile)) strokeFault = `"${box.text}"@${line.frame} uses ${box.fontFile}`;
			if (box.block && box.block.lines >= 2) {
				const need = box.block.lines >= LINE_HEIGHT.manyLinesFrom ? LINE_HEIGHT.manyLines : box.script === "latin" ? LINE_HEIGHT.latin : LINE_HEIGHT.cjk;
				if (!lineHeightFault && box.block.lineHeight < need - 1e-9) lineHeightFault = `"${box.text}"@${line.frame}: line-height ${box.block.lineHeight} under ${need}`;
			}
			if (box.block?.kind === "paragraph") {
				for (const text of box.block.lineTexts ?? []) {
					const chars = Array.from(text).length;
					if (box.script === "latin" && (chars < MEASURE.latinMin || chars > MEASURE.latinMax) && !measureFault) measureFault = `"${text.slice(0, 24)}…"@${line.frame}: ${chars}ch outside 60-75`;
					if (box.script !== "latin" && (chars < MEASURE.cjkMin || chars > MEASURE.cjkMax) && !measureAdvice) measureAdvice = `advisory: CJK line ${chars}ch outside 30-45`;
				}
			}
		}
		for (const block of line.blocks ?? []) {
			const joined = block.lines.join(" ").replace(/\s+/gu, " ").trim();
			if (!breakFault && joined !== block.sourceText.replace(/\s+/gu, " ").trim()) breakFault = `${block.elementId}@${line.frame}: line break inside a 어절`;
		}
		for (const element of line.elements ?? []) if (!actionFault && !inside(element.bbox, SAFE.action)) actionFault = `${element.elementId}@${line.frame}: ${overrun(element.bbox, SAFE.action).toFixed(1)} px outside action-safe`;
	}
	rules.push(rule("MO-C-04", "title-safe", titleFault ? FAIL : PASS, titleFault ?? "every glyph box inside [96,54]-[1824,1026]"));
	rules.push(rule("MO-C-05", "action-safe", actionFault ? FAIL : PASS, actionFault ?? "every non-glyph element inside [48,27]-[1872,1053]"));

	// MO-C-06 contrast on the kept settled frames.
	let minContrast = null;
	let contrastFault = null;
	let measured = 0;
	for (const frame of data.contrast ?? []) {
		const line = byFrame.get(frame.frame) ?? frame.line;
		for (const box of line?.textBoxes ?? []) {
			if ((box.alpha ?? 1) < 0.999) continue;
			const result = measureContrast(box, frame);
			if (!result) continue;
			measured++;
			if (!minContrast || result.ratio / result.floor < minContrast.ratio / minContrast.floor) minContrast = { ...result, frame: frame.frame, text: box.text };
			if (!contrastFault && result.ratio < result.floor) contrastFault = `"${box.text}"@${frame.frame}: ${result.ratio.toFixed(2)}:1 under ${result.floor}:1`;
		}
	}
	rules.push(rule("MO-C-06", "type contrast", contrastFault || measured === 0 ? FAIL : PASS, contrastFault ?? (measured === 0 ? "no settled text box was measurable" : `min ratio ${minContrast.ratio.toFixed(2)}:1 at frame ${minContrast.frame} (floor ${minContrast.floor}:1)`), { minContrast }));

	// MO-C-07/08, MO-A-13/15/16, MO-D-04 (timeline; coverage recorded at pre-flight).
	rules.push(...timelineRules(manifest, { coverage: data.coverage ?? [] }));

	// MO-C-09 / MO-A-24 / MO-A-25 determinism.
	const det = data.determinism;
	let detStatus = FAIL;
	let detDetail = "no determinism re-render recorded";
	if (det?.frames?.length) {
		const mismatched = det.frames.filter((f) => f.video !== f.rerender);
		if (mismatched.length === 0) {
			detStatus = PASS;
			detDetail = `rgbaSha256 match Y (frames re-rendered: ${det.frames.map((f) => f.frame).join(", ")})`;
		} else if (det.swiftshader && det.swiftshader.every((f) => f.a === f.b)) {
			detStatus = WARN;
			detDetail = `hardware-nondeterminism: ${mismatched.length} hardware pair(s) differed; SwiftShader pairs match (frames ${det.swiftshader.map((f) => f.frame).join(", ")})`;
		} else detDetail = `rgbaSha256 match N at frame ${mismatched[0].frame}: ${mismatched[0].video.slice(0, 12)} vs ${mismatched[0].rerender.slice(0, 12)}`;
	}
	rules.push(rule("MO-C-09", "determinism", detStatus, detDetail));
	rules.push(rule("MO-A-25", "seeked equals sequential", detStatus, det?.frames?.length ? `seeked still(t) at samples ${manifest.samples} vs sequential video line: ${detStatus === PASS ? "equal" : detDetail}` : "no seeked re-render recorded"));

	// MO-C-10/11/12 + MO-A-03 ffprobe.
	const probe = data.probe;
	const probeFaults = [];
	if (!probe) probeFaults.push("ffprobe result missing");
	else {
		if (probe.width < OUTPUT.minWidth || probe.height < OUTPUT.minHeight) probeFaults.push(`resolution ${probe.width}x${probe.height}`);
		if (probe.fps < OUTPUT.minFps) probeFaults.push(`fps ${probe.fps}`);
		if (probe.duration < OUTPUT.minDurationSec) probeFaults.push(`duration ${probe.duration} s`);
		if (probe.pixFmt !== OUTPUT.pixFmt || probe.colorSpace !== OUTPUT.colorSpace || probe.colorRange !== OUTPUT.colorRange) probeFaults.push(`tags ${probe.pixFmt}/${probe.colorSpace}/${probe.colorRange}`);
	}
	const tagsOk = probe && probe.pixFmt === OUTPUT.pixFmt && probe.colorSpace === OUTPUT.colorSpace && probe.colorRange === OUTPUT.colorRange;
	const target = manifest.targetDurationSec;
	const overTarget = probe && target > 0 && probe.duration > target * 1.1;
	rules.push(rule("MO-C-10/11/12", "duration/fps/resolution", probeFaults.length ? FAIL : probe.duration > OUTPUT.warnDurationSec || overTarget ? WARN : PASS, `${overTarget ? `the reading floors made the film ${probe.duration.toFixed(2)} s, over the treatment's ${target} s target; ` : ""}${probe ? `${probe.duration.toFixed(2)} s @ ${probe.fps} fps, ${probe.width}x${probe.height}` : "no probe"} (ffprobe yuv420p/bt709/tv ${tagsOk ? "Y" : "N"})${probe && (probe.colorTransfer !== "bt709" || probe.colorPrimaries !== "bt709") ? `; transfer/primaries reported ${probe.colorTransfer ?? "unknown"}/${probe.colorPrimaries ?? "unknown"} by this ffmpeg` : ""}${probeFaults.length ? `; ${probeFaults.join("; ")}` : ""}`));

	// MO-C-13 sizes; MO-A-37..41 presence.
	const ex = data.exports ?? {};
	const sizeFaults = [];
	if (ex.preview?.bytes > OUTPUT.previewMaxBytes) sizeFaults.push(`preview ${ex.preview.bytes} B over 3 MB`);
	if (ex.poster?.bytes > OUTPUT.posterMaxBytes) sizeFaults.push(`poster ${ex.poster.bytes} B over 1 MB`);
	const mp4Warn = ex.mp4 && manifest.durationSec > 0 && ex.mp4.bytes / (manifest.durationSec / 10) > OUTPUT.mp4WarnBytesPer10s;
	rules.push(rule("MO-C-13", "file sizes", sizeFaults.length ? FAIL : mp4Warn ? WARN : PASS, `mp4 ${ex.mp4?.bytes ?? "missing"}, ${manifest.previewEncoder === "gif" ? "gif" : "webp"} ${ex.preview?.bytes ?? "missing"} (cap 3 MB), poster ${ex.poster?.bytes ?? "missing"} (cap 1 MB)${sizeFaults.length ? `; ${sizeFaults.join("; ")}` : ""}`));
	const missing = ["mp4", "preview", "poster", "still"].filter((key) => !ex[key]?.present);
	rules.push(rule("MO-A-37..41", "four artifacts + manifest", missing.length || !manifest.schemaVersion ? FAIL : PASS, missing.length ? `missing ${missing.join(", ")}` : "film, preview, poster, reduced-motion still and manifest present"));

	// MO-C-14 reduced-motion still settled.
	const textShots = shots.filter((s) => s.text);
	const final = textShots[textShots.length - 1];
	const refFrame = final ? Math.round(final.end * manifest.fps) - 1 : null;
	const refInk = byFrame.get(refFrame)?.glyphInkPixels ?? null;
	const stillInk = data.stillInk ?? null;
	const settled = ex.still?.present && refInk !== null && stillInk !== null && stillInk >= REDUCED_MOTION.minInkRatio * refInk;
	rules.push(rule("MO-C-14", "reduced-motion still", settled ? PASS : FAIL, `present ${ex.still?.present ? "Y" : "N"}, ink-coverage check ${settled ? "PASS" : "FAIL"} (still ${stillInk ?? "?"} px vs ${refInk ?? "?"} px at frame ${refFrame})`));

	// MO-C-25 tracking, MO-C-26 line height, MO-C-27 measure.
	rules.push(rule("MO-C-25", "tracking by voice", trackingFault ? FAIL : PASS, trackingFault ?? "display voice >= -0.04em; machine and body voices >= 0"));
	rules.push(rule("MO-C-26", "multi-line line-height", lineHeightFault ? FAIL : PASS, lineHeightFault ?? "every multi-line block at or above its floor"));
	rules.push(rule("MO-C-27", "paragraph measure", measureFault ? FAIL : PASS, measureFault ?? (measureAdvice ? measureAdvice : "no Latin paragraph card outside 60-75ch")));

	// MO-C-29 one accent colour per film.
	const clusters = [];
	for (const line of frames) {
		for (const fill of line.fills ?? []) {
			if (fill.w < ACCENT.minFillPx || fill.h < ACCENT.minFillPx) continue;
			const hsl = hexToHsl(fill.color);
			if (hsl.s < ACCENT.saturationFloor) continue;
			let cluster = clusters.find((c) => hueDistance(c.hue, hsl.h) <= ACCENT.hueToleranceDeg);
			if (!cluster) {
				cluster = { hue: hsl.h, color: fill.color, frames: new Set(), shots: new Set() };
				clusters.push(cluster);
			}
			cluster.frames.add(line.frame);
			cluster.shots.add(line.shotId);
		}
	}
	clusters.sort((a, b) => b.frames.size - a.frames.size);
	const accentCluster = clusters[1];
	const accentFault = clusters.length > ACCENT.maxSaturatedClusters ? `third saturated cluster ${clusters[2].color}` : accentCluster && (accentCluster.shots.size > ACCENT.maxAccentEntries || accentCluster.frames.size > ACCENT.maxAccentFrameFraction * total) ? `accent ${accentCluster.color} in ${accentCluster.shots.size} entries, ${accentCluster.frames.size}/${total} frames` : null;
	rules.push(rule("MO-C-29", "one accent colour", accentFault ? FAIL : PASS, accentFault ?? `${clusters.length} saturated cluster(s)${accentCluster ? `; accent ${accentCluster.color} in ${accentCluster.shots.size} entry, ${accentCluster.frames.size} frames` : ""}`));

	// MO-D-02 frame-time p95, MO-D-03 near-black runs.
	const perf = data.perf;
	const ceiling = software ? PERF.p95SoftwareMs : PERF.p95HardwareMs;
	rules.push(rule("MO-D-02", "frame-time p95", !perf || perf.frames < PERF.minFrames || perf.p95 > ceiling ? FAIL : PASS, perf ? `p95 ${perf.p95.toFixed(1)} ms over ${perf.frames} frames (ceiling ${ceiling} ms${software ? ", software GL" : ""})${perf.p95 > ceiling ? "; fix: lower samples or tidal octaves" : ""}` : "no perf run recorded"));
	let blackFault = null;
	const beats = beatsOf(manifest);
	for (const shot of shots) {
		const k = Math.max(0, beats.findIndex((b) => b > shot.start + 1e-9) - 1);
		const beat = (beats[k + 1] ?? beats[k] + 60 / (manifest.bpm ?? TIMING.defaultBpm)) - beats[k];
		const limit = NEAR_BLACK.runFactor * TIMING.minSceneBeats * beat;
		const a = Math.round(shot.start * manifest.fps);
		const b = Math.min(total, Math.round(shot.end * manifest.fps));
		let runStart = null;
		for (let f = a; f <= b && !blackFault; f++) {
			const line = byFrame.get(f);
			const dark = f < b && line && line.glyphInkPixels === 0 && typeof line.p995 === "number" && line.p995 < NEAR_BLACK.luminance;
			if (dark && runStart === null) runStart = f;
			if (!dark && runStart !== null) {
				const length = (f - runStart) / manifest.fps;
				const edge = runStart === 0 || f === total ? NEAR_BLACK.edgeAllowanceSec : 0;
				if (length > limit + edge) blackFault = `${f - runStart} near-black frames from ${runStart} in ${shot.id} (limit ${(limit + edge).toFixed(2)} s)`;
				runStart = null;
			}
		}
	}
	rules.push(rule("MO-D-03", "near-black run cap", blackFault ? FAIL : PASS, blackFault ?? "no empty near-black run longer than 2x the scene hold floor"));

	// Section A rows measured from the manifest and log.
	const timelineFields = ["id", "sceneId", "shotIndex", "start", "end", "holdSec", "kind", "text", "script", "beatSec"];
	const badEntry = manifest.timeline.find((e) => timelineFields.some((k) => e[k] === undefined));
	rules.push(rule("MO-A-41a", "timeline ground truth", !Array.isArray(manifest.timeline) || badEntry ? FAIL : PASS, badEntry ? `entry ${badEntry.id} lacks a canonical field` : `${manifest.timeline.length} canonical entries`));
	rules.push(rule("MO-A-51", "Chrome flag rung recorded", LADDER.includes((manifest.chromeFlags ?? []).join(" ")) ? PASS : FAIL, `chromeFlags ${(manifest.chromeFlags ?? []).join(" ")}`));
	rules.push(rule("MO-A-33", "no fake Hangul weight or condensing", hangulFault?.startsWith("MO-A-33") ? FAIL : PASS, hangulFault?.startsWith("MO-A-33") ? hangulFault : "Hangul steps only between the lit-pptx Regular/Bold pair (or Galmuri9), scaleX 1"));
	rules.push(rule("MO-A-35", "no outlined or haloed type", outlineFault ? FAIL : PASS, outlineFault ?? "no outline or halo on any text box"));
	const postFault = postRangeFault(frames, shots, manifest);
	rules.push(rule("MO-A-58", "post override vocabulary", postFault ? FAIL : PASS, postFault ?? "every override within range; invert only on cuts, held >= 2 beats"));

	// Section B rows.
	const seedFault = seedCheck(ranges, manifest, data.passLog);
	rules.push(rule("MO-SH-01", "seed formula", seedFault ? FAIL : PASS, seedFault ?? "fnv1a32(runSeed:sceneId:shotIndex:pass) on every entry and log line"));
	const eventFault = eventCeiling(frames, manifest.fps);
	rules.push(rule("MO-SH-03", "<= 2 events per 1 s per shot", eventFault ? FAIL : PASS, eventFault ?? "every shot within the event ceiling"));
	const capFaults = [];
	for (const e of ranges) {
		if (e.pass === "glitch" && (e.params.hitRatePerSecRealized > PASS_CAPS.glitchHitRate || e.params.areaCapPct > PASS_CAPS.glitchAreaPct || e.params.hitRatePerSec > PASS_CAPS.glitchHitRate)) capFaults.push(["MO-SH-05", `glitch@${e.sceneId}#${e.shotIndex}: rate ${e.params.hitRatePerSecRealized}/s, area ${e.params.areaCapPct}%`]);
		if (e.pass === "tidal-gradient" && (e.params.surgeCapPerSec > PASS_CAPS.surgeRate || e.params.surgeAttackSec < PASS_CAPS.surgeMinAttackSec || e.params.surgeDecaySec < PASS_CAPS.surgeMinDecaySec || (e.params.surgeCountRealized ?? 0) / Math.max(1e-9, (e.frameEnd - e.frameStart + 1) / manifest.fps) > PASS_CAPS.surgeRate)) capFaults.push(["MO-SH-06", `tidal-gradient@${e.sceneId}#${e.shotIndex}: surge cap ${e.params.surgeCapPerSec}/s, attack ${e.params.surgeAttackSec} s, decay ${e.params.surgeDecaySec} s`]);
		if (e.pass === "crt" && (e.params.flickerAmpRealized > PASS_CAPS.crtFlickerAmp || e.params.flickerAmp > PASS_CAPS.crtFlickerAmp)) capFaults.push(["MO-SH-07", `crt@${e.sceneId}#${e.shotIndex}: flicker ${e.params.flickerAmpRealized}`]);
		if (e.pass === "crt" && e.params.persistenceEnabled && !e.params.sceneStateful) capFaults.push(["MO-SH-07", `crt@${e.sceneId}#${e.shotIndex}: persistence on a non-stateful scene`]);
		if (e.pass === "swiss-grid" && e.params.showGuides) capFaults.push(["MO-SH-10", `swiss-grid@${e.sceneId}#${e.shotIndex}: showGuides true`]);
		if (e.pass === "terminal-ui" && (e.params.layers ?? 1) > PASS_CAPS.terminalLayers) capFaults.push(["MO-SH-11", `terminal-ui@${e.sceneId}#${e.shotIndex}: ${e.params.layers} layers`]);
	}
	for (const [id, name] of [["MO-SH-05", "glitch caps"], ["MO-SH-06", "tidal surge caps"], ["MO-SH-07", "CRT flicker cap and persistence"]]) {
		const fault = capFaults.find(([rid]) => rid === id);
		rules.push(rule(id, name, fault ? FAIL : PASS, fault ? fault[1] : "within cap"));
	}
	const ditherFault = ditherSeedCheck(ranges, data.passLog);
	rules.push(rule("MO-SH-08", "dither reseeds once per shot", ditherFault ? FAIL : PASS, ditherFault ?? "one dither seed per shot"));
	for (const [id, name] of [["MO-SH-10", "swiss-grid guides off"], ["MO-SH-11", "terminal-ui layers <= 2"]]) {
		const fault = capFaults.find(([rid]) => rid === id);
		rules.push(rule(id, name, fault ? FAIL : PASS, fault ? fault[1] : "within contract"));
	}
	rules.push(rule("MO-FT-04", "no tracking/width motion on Hangul", hangulFault?.startsWith("MO-FT-04") ? FAIL : PASS, hangulFault?.startsWith("MO-FT-04") ? hangulFault : "Hangul runs keep tracking 0 and no width steps"));
	rules.push(rule("MO-FT-05", "Korean breaks at 어절", breakFault ? FAIL : PASS, breakFault ?? "every multi-line block breaks at whitespace"));
	rules.push(rule("MO-FT-08", "stroke fonts are the EMS five", strokeFault ? FAIL : PASS, strokeFault ?? "stroke type uses only the pinned EMS SVGs"));
	if (data.soundMode) rules.push(...soundRules(data.sound, { mode: data.soundMode, videoDuration: probe?.videoDuration ?? probe?.duration ?? manifest.durationSec }));
	return rules;
}

function postRangeFault(frames, shots, manifest) {
	let lastInvert = null;
	let lastChange = null;
	const cutFrames = new Set(shots.map((s) => Math.round(s.start * manifest.fps)));
	for (const line of frames) {
		const post = line.post ?? {};
		for (const [field, spec] of Object.entries(POST_FIELDS)) {
			const value = post[field];
			if (value === undefined) continue;
			if (typeof value !== "number" || Number.isNaN(value) || (spec.exclusiveMin ? value <= spec.min : value < spec.min) || (spec.max !== null && value > spec.max)) return `frame ${line.frame}: ${field} ${value} outside its range`;
		}
		if (post.invert !== undefined && typeof post.invert !== "boolean") return `frame ${line.frame}: invert must be boolean`;
		if (lastInvert !== null && post.invert !== lastInvert) {
			if (!cutFrames.has(line.frame)) return `frame ${line.frame}: invert changed off a cut`;
			if (lastChange !== null && (line.frame - lastChange) / manifest.fps < 2 * (60 / (manifest.bpm ?? TIMING.defaultBpm)) - 1e-9) return `frame ${line.frame}: invert held under 2 beats`;
			lastChange = line.frame;
		}
		lastInvert = post.invert ?? lastInvert;
	}
	return null;
}

function seedCheck(ranges, manifest, passLog) {
	for (const e of ranges) {
		const expected = e.pass === "swiss-grid" ? null : passSeed(manifest.seed, e.sceneId, e.shotIndex, e.pass);
		if (e.seed !== expected) return `${e.pass}@${e.sceneId}#${e.shotIndex}: seed ${e.seed}, expected ${expected}`;
		if (expected === null) continue;
		for (let f = e.frameStart; f <= e.frameEnd; f++) {
			const line = passLog.get(f)?.find((l) => l.pass === e.pass);
			const logged = line?.uniforms?.u_seed;
			if (logged !== undefined && logged >>> 0 !== expected) return `${e.pass}@frame ${f}: u_seed ${logged}, expected ${expected}`;
		}
	}
	return null;
}

function ditherSeedCheck(ranges, passLog) {
	for (const e of ranges.filter((r) => r.pass === "dither")) {
		const seeds = new Set();
		for (let f = e.frameStart; f <= e.frameEnd; f++) {
			const seed = passLog.get(f)?.find((l) => l.pass === "dither")?.uniforms?.u_seed;
			if (seed !== undefined) seeds.add(seed);
		}
		if (seeds.size > 1) return `dither@${e.sceneId}#${e.shotIndex} reseeded inside the shot (${seeds.size} seeds)`;
	}
	return null;
}

function eventCeiling(frames, fps) {
	const byShot = new Map();
	for (const line of frames) for (const source of line.events ?? []) {
		if (!byShot.has(line.shotId)) byShot.set(line.shotId, []);
		byShot.get(line.shotId).push({ frame: line.frame, source });
	}
	for (const [shotId, events] of byShot) {
		events.sort((a, b) => a.frame - b.frame);
		for (let i = 0; i < events.length; i++) {
			const inWindow = events.filter((e) => e.frame >= events[i].frame && e.frame < events[i].frame + EVENTS.windowSec * fps);
			if (inWindow.length > EVENTS.maxPerWindow) return `${shotId}: ${inWindow.length} events (${inWindow.map((e) => e.source).join(", ")}) within 1 s from frame ${events[i].frame}`;
		}
	}
	return null;
}

export const gatePassed = (rules) => rules.every((r) => r.status !== FAIL);
export const flashFailed = (rules) => rules.some((r) => r.id === "MO-C-03" && r.status === FAIL);
