// The stage path's gate. It reads recorded data only (the frame log with the flash records taken on
// the exact encoder bytes, the preview records, ffprobe, export sizes and the determinism replay)
// and applies the Wave 1 rules that carry over to a captured page (director brief 6h): flash,
// format, duration against the treatment, sizes, the reduced-motion still, near-black runs and
// determinism. Rules that only make sense for the type engine are listed as not applicable.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FULL_FRAME_STEP, MAX_ROUNDS, NEAR_BLACK, OUTPUT, STAGE_FORMATS, TIMING } from "./constants.mjs";
import { exportPaths, ffprobeSafe, locate } from "./encode.mjs";
import { countFlashes } from "./flash.mjs";
import { isSoftwareRenderer } from "./gate.mjs";
import { stageFlags } from "./runtime.mjs";
import { measureMuxed, soundRules } from "./sound.mjs";

const PASS = "PASS";
const FAIL = "FAIL";
const WARN = "WARN";
const rule = (id, name, status, detail, extra = {}) => ({ id, name, status, detail, ...extra });
export const STAGE_NOT_APPLICABLE = Object.freeze(["MO-C-01 GLSL look pass", "MO-C-02 unless the page uses WebGL", "MO-C-14 glyph-mask method", "MO-D-02 frame-time p95"]);

const readJsonl = (path) =>
	existsSync(path)
		? readFileSync(path, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line))
		: [];

/** Everything the stage gate reads, from the run folder only. */
export function loadStageData(outDir) {
	const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
	const run = join(outDir, ".run");
	const log = readJsonl(existsSync(join(outDir, "render.jsonl")) ? join(outDir, "render.jsonl") : join(run, "render.jsonl"));
	const read = (name) => (existsSync(join(run, name)) ? JSON.parse(readFileSync(join(run, name), "utf8")) : null);
	const exportsInfo = {};
	for (const [key, name] of Object.entries(exportPaths(outDir, manifest))) {
		const path = locate(outDir, name);
		exportsInfo[key] = { present: Boolean(path), path, bytes: path ? statSync(path).size : null };
	}
	const exportsLog = read("exports.json");
	return {
		manifest,
		frames: log.filter((line) => line.previewFrame === undefined),
		preview: { records: log.filter((line) => line.previewFrame !== undefined).map((line) => ({ f: line.previewFrame, g: line.flash.g, r: line.flash.r })), fps: exportsLog?.preview?.fps ?? 30 },
		exports: exportsInfo,
		probe: exportsInfo.mp4.path ? ffprobeSafe(exportsInfo.mp4.path) : null,
		determinism: read("determinism.json"),
		sound: exportsInfo.mp4.path ? measureMuxed(exportsInfo.mp4.path) : null,
		qa: read("qa.json"),
		treatment: read("treatment.json")?.treatment ?? null,
		exportsLog,
	};
}

/** Evaluate the stage gate over loaded data; returns ordered rule results. */
export function evaluateStage(data) {
	const { manifest } = data;
	const rules = [];
	const frames = data.frames ?? [];
	const fps = manifest.fps;
	const [width, height] = [manifest.width, manifest.height];

	const master = countFlashes(frames.map((line) => ({ f: line.frame, g: line.flash?.g ?? [0, 0], r: line.flash?.r ?? [0, 0] })), fps, false);
	const preview = data.preview?.records?.length ? countFlashes(data.preview.records, data.preview.fps, true) : null;
	const flashPass = master.pass && preview?.pass === true;
	const worst = !master.pass || !preview ? master : preview;
	rules.push(rule("MO-C-03", "flash audit", flashPass ? PASS : FAIL, `worst window ${Math.max(master.general.flashes, preview?.general.flashes ?? 0)} general / ${Math.max(master.red.flashes, preview?.red.flashes ?? 0)} red (limit 3 / 3; ${width > height ? "320x180" : "180x320"} cells)${preview ? "" : "; preview frames not audited"}${flashPass ? "" : `; worst at frame ${worst.general.startFrame} (${(worst.general.startFrame / fps).toFixed(2)} s)`}`, { master, preview }));
	const step = frames.find((line) => (line.flash?.step ?? 0) > FULL_FRAME_STEP.areaFraction);
	rules.push(rule("MO-SH-04a", "no full-frame luminance step", step ? FAIL : PASS, step ? `frame ${step.frame}: ${(step.flash.step * 100).toFixed(1)}% of the frame stepped >= 0.1` : "no frame pair steps more than 25% of the frame"));

	const probe = data.probe;
	const want = STAGE_FORMATS[manifest.format];
	const target = manifest.targetDurationSec;
	const faults = [];
	if (!probe) faults.push("ffprobe result missing");
	else {
		if (!want || probe.width !== want.width || probe.height !== want.height) faults.push(`resolution ${probe.width}x${probe.height}, format ${manifest.format} needs ${want?.width}x${want?.height}`);
		if (probe.fps < OUTPUT.minFps || Math.abs(probe.fps - fps) > 0.01) faults.push(`fps ${probe.fps}, page declared ${fps}`);
		if (target > 0 && Math.abs(probe.videoDuration - target) > 0.1 * target + 1e-6) faults.push(`duration ${probe.videoDuration.toFixed(2)} s is outside ±10 % of the treatment's ${target} s`);
		if (probe.pixFmt !== OUTPUT.pixFmt || probe.colorSpace !== OUTPUT.colorSpace || probe.colorRange !== OUTPUT.colorRange) faults.push(`tags ${probe.pixFmt}/${probe.colorSpace}/${probe.colorRange}`);
	}
	rules.push(rule("MO-C-10/11/12", "format/fps/duration", faults.length ? FAIL : PASS, `${probe ? `${probe.videoDuration.toFixed(2)} s @ ${probe.fps} fps, ${probe.width}x${probe.height}` : "no probe"} (treatment ${target} s, ${manifest.format})${faults.length ? `; ${faults.join("; ")}` : ""}`));

	const ex = data.exports ?? {};
	const sizeFaults = [];
	if (ex.preview?.bytes > OUTPUT.previewMaxBytes) sizeFaults.push(`preview ${ex.preview.bytes} B over 3 MB`);
	if (ex.poster?.bytes > OUTPUT.posterMaxBytes) sizeFaults.push(`poster ${ex.poster.bytes} B over 1 MB`);
	const mp4Warn = ex.mp4?.bytes && manifest.durationSec > 0 && ex.mp4.bytes / (manifest.durationSec / 10) > OUTPUT.mp4WarnBytesPer10s;
	rules.push(rule("MO-C-13", "file sizes", sizeFaults.length ? FAIL : mp4Warn ? WARN : PASS, `mp4 ${ex.mp4?.bytes ?? "missing"}, preview ${ex.preview?.bytes ?? "missing"} (cap 3 MB), poster ${ex.poster?.bytes ?? "missing"} (cap 1 MB)${sizeFaults.length ? `; ${sizeFaults.join("; ")}` : ""}`));
	const missing = ["mp4", "preview", "poster", "still"].filter((key) => !ex[key]?.present);
	rules.push(rule("MO-A-37..41", "four artifacts + manifest", missing.length ? FAIL : PASS, missing.length ? `missing ${missing.join(", ")}` : "film, preview, poster, reduced-motion still and manifest present"));
	rules.push(rule("MO-C-14", "reduced-motion still", ex.still?.present ? PASS : FAIL, ex.still?.present ? `final beat midpoint, frame ${data.exportsLog?.still?.frame ?? "?"}` : "reduced-motion.png missing"));

	const det = data.determinism;
	let detStatus = FAIL;
	let detDetail = "no determinism replay recorded";
	if (det?.frames?.length) {
		const bad = det.frames.find((f) => f.master !== f.replay);
		detStatus = bad ? FAIL : PASS;
		detDetail = bad ? `decoded RGBA differs at frame ${bad.frame}${det.region ? ` in region ${det.region.join(",")}` : ""}; a clock-free source leaks into the page` : `rgbaSha256 match Y on ${det.frames.length} frames re-captured sequentially in a fresh Chrome (${det.frames.map((f) => f.frame).join(", ")})`;
	}
	rules.push(rule("MO-C-09", "determinism", detStatus, detDetail));

	if (manifest.webgl?.requested) rules.push(rule("MO-C-02", "WebGL tier", manifest.webgl.ok && isSoftwareRenderer(manifest.webgl.renderer) ? PASS : FAIL, `page requested WebGL: ${manifest.webgl.renderer ?? "no context"} (software rung, labelled)`));

	const beat = 60 / (data.treatment?.sound?.tempo ?? TIMING.defaultBpm);
	const limit = NEAR_BLACK.runFactor * TIMING.minSceneBeats * beat;
	let blackFault = null;
	let runStart = null;
	const total = frames.length;
	for (let i = 0; i <= total && !blackFault; i++) {
		const dark = i < total && typeof frames[i].p995 === "number" && frames[i].p995 < NEAR_BLACK.luminance;
		if (dark && runStart === null) runStart = i;
		if (!dark && runStart !== null) {
			const length = (i - runStart) / fps;
			const edge = runStart === 0 || i === total ? NEAR_BLACK.edgeAllowanceSec : 0;
			if (length > limit + edge) blackFault = `${i - runStart} near-black frames from ${runStart} (limit ${(limit + edge).toFixed(2)} s)`;
			runStart = null;
		}
	}
	rules.push(rule("MO-D-03", "near-black run cap", blackFault ? FAIL : PASS, blackFault ?? "no near-black run longer than 2x the 2-beat hold floor"));

	const flags = (manifest.chromeFlags ?? []).join(" ");
	rules.push(rule("MO-A-51", "stage flag set recorded", flags === stageFlags(width, height).join(" ") ? PASS : FAIL, `chromeFlags ${flags}`));
	if (data.qa?.rules) rules.push(...data.qa.rules);
	else rules.push(rule("QA-TEXT", "DOM text QA", FAIL, "no text QA replay recorded"));
	rules.push(...soundRules(data.sound, { mode: data.treatment?.sound?.mode ?? manifest.sound?.mode, videoDuration: probe?.videoDuration ?? manifest.durationSec }));
	const pageErrors = manifest.pageErrors ?? [];
	if (pageErrors.length) rules.push(rule("STAGE-ERRORS", "page script errors", WARN, `${pageErrors.length} error(s), first: ${pageErrors[0]}`));
	const missingFiles = manifest.missingFiles ?? [];
	if (missingFiles.length) rules.push(rule("STAGE-MISSING", "missing local files", WARN, `the page asked for ${missingFiles.join(", ")}`));
	return rules;
}

export const stagePassed = (rules) => rules.every((r) => r.status !== FAIL);

/** The stage render report. "QA gate: PASS|FAIL" is the line the done-check reads. */
export function renderStageReport({ manifest, rules, outputs, round, framesViewed = 0, withheld = false, notes = [], stage = "full" }) {
	const lines = ["lit-typographic-motion — stage render report"];
	lines.push(`outputs: ${outputs.mp4} · ${outputs.preview} (encoder: ${manifest.previewEncoder ?? "none"}) · ${outputs.poster} · ${outputs.still}`);
	lines.push(`path: stage · format ${manifest.format} ${manifest.width}x${manifest.height} @ ${manifest.fps} fps · ${manifest.durationSec} s (treatment ${manifest.targetDurationSec} s)`);
	lines.push(`capture: software rung ${manifest.renderer ?? "(no WebGL requested)"} · per frame p50 ${manifest.timing?.p50Ms ?? "?"} ms, p95 ${manifest.timing?.p95Ms ?? "?"} ms · master ${manifest.timing?.masterSec ?? "?"} s, determinism and text QA replays ${manifest.timing?.replaysSec ?? "?"} s, total ${manifest.timing?.totalSec ?? "?"} s`);
	lines.push("");
	const failed = rules.some((r) => r.status === "FAIL");
	lines.push(`QA gate: ${failed ? "FAIL" : "PASS"}${stage === "stills" ? "  (stills only; nothing encoded)" : ""}${withheld ? "  (render withheld: exports moved to withheld/ as diagnostics, not deliverables)" : ""}`);
	for (const r of rules) lines.push(`  ${`${r.id} ${r.name}:`.padEnd(40)}${r.status}  ${r.detail}`);
	lines.push(`  not applicable on the stage path: ${STAGE_NOT_APPLICABLE.join("; ")}`);
	lines.push("");
	lines.push(`craft rounds run: ${round} / ${MAX_ROUNDS} max`);
	lines.push(`frames actually viewed this run: ${framesViewed} (confirmed looked, not just rendered)`);
	lines.push("");
	lines.push("notes:");
	for (const note of notes) lines.push(`  ${note}`);
	return `${lines.join("\n")}\n`;
}
