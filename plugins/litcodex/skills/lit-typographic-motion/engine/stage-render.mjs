// Stage path orchestration. One `stage` run validates the page, then either writes the stills set
// only (--stills-only) or captures every frame into the pinned encode while writing the same stills,
// the preview, the poster and the reduced-motion still, replays the clock in a fresh Chrome to prove
// determinism, and runs the stage gate. Frames are computed from the frame index, never accumulated.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, Exit, INSTALL_COMMAND, MAX_ROUNDS, STAGE_FORMATS } from "./constants.mjs";
import { buildPreview, encoderArgs, exportPaths, previewSize, promote, requireFfmpeg } from "./encode.mjs";
import { FlashDetector } from "./flash.mjs";
import { FONTS, verifyFonts } from "./fonts.mjs";
import { contactSheet, decodePng, downscale, encodePng } from "./image.mjs";
import { viewedFor } from "./look.mjs";
import { ffmpegProbe, firstLine, resolveRuntime, stageFlags } from "./runtime.mjs";
import { assertClean, capture, closeStage, DecodePool, fontRoutes, openStage, scanStage, stageFontFaults, stepFrame } from "./stage.mjs";
import { evaluateStage, loadStageData, renderStageReport, stagePassed } from "./stage-gate.mjs";
import { prepareTrack, soundFailed } from "./sound.mjs";
import { collectQA, qaRules, qaScript } from "./stage-qa.mjs";
import { fnv1a32 } from "./util.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pad = (n, width = 2) => String(n).padStart(width, "0");

/** Every frame the stills set, the poster, the still and the determinism replay need. */
export function framePlan(treatment, fps, frameCount) {
	const clampFrame = (f) => Math.max(0, Math.min(frameCount - 1, f));
	const toFrame = (t) => clampFrame(Math.round(t * fps));
	const beats = treatment.beats.map((beat, i) => ({ index: i, start: toFrame(beat.t0), mid: toFrame((beat.t0 + beat.t1) / 2) }));
	const cuts = beats.slice(1).map((beat) => ({ beat: beat.index, frames: [-6, 0, 6].map((d) => clampFrame(beat.start + d)) }));
	const sheet = Array.from({ length: 12 }, (_, i) => clampFrame(Math.round((i * (frameCount - 1)) / 11)));
	const poster = beats[Math.floor(beats.length / 2)].mid;
	const still = beats[beats.length - 1].mid;
	const samples = new Set([0, frameCount - 1, ...beats.map((b) => b.start)]);
	for (const beat of beats) if (samples.size < 8) samples.add(beat.mid);
	for (let k = 1; samples.size < 8 && k < 64; k++) samples.add(clampFrame(Math.round((k * (frameCount - 1)) / 9)));
	let determinism = [...samples].sort((a, b) => a - b);
	if (determinism.length > 16) {
		const inner = determinism.slice(1, -1);
		determinism = [determinism[0], ...Array.from({ length: 14 }, (_, i) => inner[Math.round((i * (inner.length - 1)) / 13)]), determinism[determinism.length - 1]];
		determinism = [...new Set(determinism)].sort((a, b) => a - b);
	}
	const needed = new Set([...beats.map((b) => b.mid), ...cuts.flatMap((c) => c.frames), ...sheet, poster, still]);
	return { beats, cuts, sheet, poster, still, determinism, needed };
}

/** Thumbnail sizes for the transition strips and the contact sheet, by orientation. */
const thumbSizes = (width, height) => (width >= height ? { strip: [960, 540], sheet: [480, 270], columns: 4 } : { strip: [540, 960], sheet: [270, 480], columns: 6 });

/**
 * Write stills/: beat midpoints and the poster at full size (the captured PNG bytes), one
 * transition strip per cut, the 12-frame contact sheet, and manifest.json with each file's hash.
 */
export function writeStills({ outDir, plan, frames, width, height, fps, round, kind }) {
	const dir = join(outDir, "stills");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const sizes = thumbSizes(width, height);
	const files = [];
	const put = (name, bytes, entry) => {
		writeFileSync(join(dir, name), bytes);
		files.push({ file: name, sha256: sha256(bytes), ...entry });
	};
	for (const beat of plan.beats) put(`beat-${pad(beat.index + 1)}.png`, frames.get(beat.mid).png, { kind: "beat", beat: beat.index, frames: [beat.mid], t: [beat.mid / fps] });
	for (const cut of plan.cuts) {
		const built = contactSheet(cut.frames.map((f) => frames.get(f).strip), sizes.strip[0], sizes.strip[1], 3, cut.frames.map((f) => `${(f / fps).toFixed(2)}s f${f}`));
		put(`cut-${pad(cut.beat)}-${pad(cut.beat + 1)}.png`, encodePng(built.width, built.height, built.pixels, 4, 6), { kind: "strip", beat: cut.beat, frames: cut.frames, t: cut.frames.map((f) => f / fps) });
	}
	const sheet = contactSheet(plan.sheet.map((f) => frames.get(f).sheet), sizes.sheet[0], sizes.sheet[1], sizes.columns, plan.sheet.map((f) => `${(f / fps).toFixed(2)}s f${f}`));
	put("contact-sheet.png", encodePng(sheet.width, sheet.height, sheet.pixels, 4, 6), { kind: "sheet", frames: plan.sheet, t: plan.sheet.map((f) => f / fps) });
	put("poster.png", frames.get(plan.poster).png, { kind: "poster", frames: [plan.poster], t: [plan.poster / fps] });
	const manifest = { schema: 1, kind, round, width, height, fps, files };
	const text = `${JSON.stringify(manifest, null, 2)}\n`;
	writeFileSync(join(dir, "manifest.json"), text);
	return { dir, files, manifestSha256: sha256(text) };
}

/** A kept frame for the stills set: the full-size PNG plus its strip and contact-sheet thumbnails. */
export function stillsEntry(png, rgba, width, height) {
	const sizes = thumbSizes(width, height);
	return { png, strip: downscale(rgba, width, height, sizes.strip[0], sizes.strip[1]), sheet: downscale(rgba, width, height, sizes.sheet[0], sizes.sheet[1]) };
}

function keepFrame(frames, plan, f, png, rgba, width, height) {
	if (!plan.needed.has(f) || frames.has(f)) return;
	frames.set(f, stillsEntry(png, rgba, width, height));
}

function percentile(sorted, p) {
	return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 10) / 10 : null;
}

/** Validate the page's declared contract against the treatment and the format. */
function checkContract(contract, treatment, format) {
	if (!contract.defined) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR: the page never called LitStage.define({width, height, fps, duration, render}) (or set window.litStage) while it loaded");
	if (contract.width !== format.width || contract.height !== format.height) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the page declares ${contract.width}x${contract.height}; format ${treatment.format} is exactly ${format.width}x${format.height}`);
	const fps = contract.fps ?? 60;
	if (fps !== 60 && !(fps === 30 && treatment.fps === 30)) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: fps ${fps}; the stage renders 60 fps, or 30 when the treatment sets "fps": 30`);
	if (typeof contract.duration !== "number" || !(contract.duration > 0) || contract.duration > 90.5) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR: duration must be the film's length in seconds (at most 90)");
	return { fps, frameCount: Math.round(contract.duration * fps) };
}

function progress(outDir, state) {
	writeFileSync(join(outDir, ".run", "progress.json"), `${JSON.stringify({ ...state, at: new Date().toISOString() })}\n`);
}

/** Step 0..last sequentially, capturing only `wanted` frames; used by stills-only and the replays. */
async function replay(session, { wanted, last, width, height, pool, onFrame, settleAll = true, outDir, phase }) {
	for (let f = 0; f <= last; f++) {
		const want = wanted.has(f);
		const state = await stepFrame(session, f, settleAll || want);
		if (state.violations || session.record.blocked.length || session.record.rejected.length) await assertClean(session);
		if (want) {
			const png = await capture(session, width, height);
			const decoded = await pool.decode(png);
			if (decoded.width !== width || decoded.height !== height) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: captured ${decoded.width}x${decoded.height}, the format is ${width}x${height}`);
			await onFrame(f, png, decoded);
		}
		if (outDir && f % 60 === 0) progress(outDir, { phase, frame: f, total: last + 1 });
	}
}

/**
 * The stage subcommand. Returns an exit code; throws Exit for blocked and contract states.
 * `treatment` is already validated for path: stage.
 */
export async function runStage({ outDir, treatment, round, stillsOnly, log = () => {} }) {
	const started = Date.now();
	if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) throw new Exit(EXIT.USAGE, `--round must be 1..${MAX_ROUNDS}`);
	const format = STAGE_FORMATS[treatment.format];
	const scan = scanStage(join(outDir, "stage"));
	const runtime = resolveRuntime();
	if (!runtime.deps.ready) throw new Exit(EXIT.BLOCKED_DEPS_NOT_PREWARMED, `BLOCKED_DEPS_NOT_PREWARMED: ${runtime.deps.missing.join("; ")}. Run \`${INSTALL_COMMAND}\` outside the sandboxed session, then rerun.`);
	stageFontFaults(verifyFonts(FONTS.map((f) => f.key), runtime.dir));
	const fonts = fontRoutes(runtime.dir);
	const hasFfmpeg = ffmpegProbe().ok;
	const seed = treatment.seed ?? fnv1a32(`${treatment.request}\u0000${treatment.idea}`);
	const fpsHint = treatment.fps === 30 ? 30 : 60;
	const { width, height } = format;
	const pool = new DecodePool();
	const runDir = join(outDir, ".run");
	mkdirSync(runDir, { recursive: true });
	for (const name of ["manifest.json", "gate-report.txt", "render.jsonl", ...Object.values(exportPaths(outDir, {})), "preview.gif"]) rmSync(join(outDir, name), { force: true });
	rmSync(join(outDir, "withheld"), { recursive: true, force: true });
	let session = null;
	try {
		session = await openStage({ runtime, outDir, scan, fonts, width, height, fps: fpsHint, seed });
		const { fps, frameCount } = checkContract(session.contract, treatment, format);
		const plan = framePlan(treatment, fps, frameCount);
		const kept = new Map();
		if (stillsOnly || !hasFfmpeg) {
			await replay(session, { wanted: plan.needed, last: Math.max(...plan.needed), width, height, pool, settleAll: false, outDir, phase: "stills", onFrame: (f, png, d) => keepFrame(kept, plan, f, png, d.rgba, width, height) });
			await assertClean(session);
			const stills = writeStills({ outDir, plan, frames: kept, width, height, fps, round, kind: "stills-only" });
			const track = prepareTrack({ outDir, treatment, frameCount, fps, cuts: treatment.beats.slice(1).map((b) => b.t0) });
			for (const note of track.notes) log(note);
			writeFileSync(join(runDir, "stills-run.json"), `${JSON.stringify({ round, manifestSha256: stills.manifestSha256, fps, frameCount, seconds: (Date.now() - started) / 1000 }, null, 2)}\n`);
			log(`stills: ${stills.files.map((f) => join(stills.dir, f.file)).join(" ")}`);
			log(`stills manifest: ${join(stills.dir, "manifest.json")} (sha256 ${stills.manifestSha256})`);
			if (!hasFfmpeg && !stillsOnly) requireFfmpeg();
			log("stills-only: view every still, then record the look round; this is not a finished film.");
			return EXIT.OK;
		}

		const ffmpeg = requireFfmpeg();
		const staging = join(runDir, "film.mp4");
		const previewDir = join(runDir, "preview-src");
		rmSync(previewDir, { recursive: true, force: true });
		mkdirSync(previewDir, { recursive: true });
		const detDir = join(runDir, "det-master");
		rmSync(detDir, { recursive: true, force: true });
		mkdirSync(detDir, { recursive: true });
		const previewDims = previewSize([width, height], 960);
		const previewEvery = Math.max(1, Math.round(fps / 30));
		const track = prepareTrack({ outDir, treatment, frameCount, fps, cuts: treatment.beats.slice(1).map((b) => b.t0) });
		const encoder = spawn(ffmpeg.path, encoderArgs([width, height], fps, staging, track.wav), { stdio: ["pipe", "ignore", "pipe"] });
		let encoderError = "";
		encoder.stderr.on("data", (chunk) => {
			encoderError += chunk;
		});
		const encoded = new Promise((done) => encoder.on("close", done));
		const frameLog = createWriteStream(join(runDir, "render.jsonl"));
		const detector = new FlashDetector(width, height);
		const detSet = new Set(plan.determinism);
		const masterSha = new Map();
		const times = [];
		let previewCount = 0;
		const inflight = [];
		const consume = async ({ f, png, d }) => {
			if (d.width !== width || d.height !== height) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: captured ${d.width}x${d.height}, the format is ${width}x${height}`);
			const flash = detector.ingestGrid(d.grid);
			frameLog.write(`${JSON.stringify({ frame: f, pass: null, rgbaSha256: d.sha, flash, p995: Math.round(d.p995 * 1e4) / 1e4 })}\n`);
			masterSha.set(f, d.sha);
			if (detSet.has(f)) writeFileSync(join(detDir, `${f}.png`), png);
			keepFrame(kept, plan, f, png, d.rgba, width, height);
			if (d.previewPng) writeFileSync(join(previewDir, `${pad(previewCount++, 5)}.png`), d.previewPng);
			if (!encoder.stdin.write(Buffer.from(d.rgba.buffer, d.rgba.byteOffset, d.rgba.byteLength))) await new Promise((done) => encoder.stdin.once("drain", done));
		};
		for (let f = 0; f < frameCount; f++) {
			const t0 = performance.now();
			const state = await stepFrame(session, f, true);
			if (state.violations || session.record.blocked.length || session.record.rejected.length) await assertClean(session);
			const png = await capture(session, width, height);
			times.push(performance.now() - t0);
			inflight.push(pool.decode(png, { analyze: true, preview: f % previewEvery === 0 ? previewDims : null }).then((d) => ({ f, png, d })));
			while (inflight.length > 6) await consume(await inflight.shift());
			if (f % 60 === 0) progress(outDir, { phase: "master", frame: f, total: frameCount });
		}
		while (inflight.length) await consume(await inflight.shift());
		encoder.stdin.end();
		const code = await encoded;
		await new Promise((done) => frameLog.end(done));
		if (code !== 0) throw new Error(`ffmpeg encode failed: ${firstLine(encoderError || `exit ${code}`)}`);
		const masterSec = (Date.now() - started) / 1000;
		const report = await assertClean(session);
		const record = session.record;
		await closeStage(session);
		session = null;

		const stills = writeStills({ outDir, plan, frames: kept, width, height, fps, round, kind: "render" });
		writeFileSync(join(runDir, "poster.png"), kept.get(plan.poster).png);
		writeFileSync(join(runDir, "reduced-motion.png"), kept.get(plan.still).png);

		progress(outDir, { phase: "determinism and text QA", frame: 0, total: frameCount });
		const determinism = { frames: [], region: null };
		const replayDeterminism = async () => {
			const replaySession = await openStage({ runtime, outDir, scan, fonts, width, height, fps: fpsHint, seed });
			try {
				await replay(replaySession, {
					wanted: detSet,
					last: Math.max(...plan.determinism),
					width,
					height,
					pool,
					onFrame: (f, png, d) => {
						determinism.frames.push({ frame: f, master: masterSha.get(f), replay: d.sha });
						if (!determinism.region && masterSha.get(f) !== d.sha) determinism.region = diffRegion(decodePng(readFileSync(join(detDir, `${f}.png`))).pixels, d.rgba, width, height);
					},
				});
			} finally {
				await closeStage(replaySession);
			}
		};
		const replayQA = async () => {
			const qaSession = await openStage({ runtime, outDir, scan, fonts, width, height, fps: fpsHint, seed, extraInit: qaScript() });
			try {
				const collected = await collectQA({ session: qaSession, treatment, fps, frameCount, width, height, pool });
				return qaRules({ treatment, width, height, fps, collected });
			} finally {
				await closeStage(qaSession);
			}
		};
		const replayStarted = Date.now();
		const [, qa] = await Promise.all([replayDeterminism(), replayQA()]);
		const replaySec = (Date.now() - replayStarted) / 1000;
		writeFileSync(join(runDir, "qa.json"), `${JSON.stringify(qa, null, 2)}\n`);
		writeFileSync(join(runDir, "determinism.json"), `${JSON.stringify(determinism, null, 2)}\n`);

		const pv = await buildPreview({ runDir, ffmpeg, previewCount, frame: [width, height], minGlyph: 28 });
		const previewLog = createWriteStream(join(runDir, "render.jsonl"), { flags: "a" });
		for (const r of pv.records) previewLog.write(`${JSON.stringify({ previewFrame: r.f, rung: `${pv.rung.width}x${pv.rung.height}@${pv.rung.fps}`, pass: null, flash: { g: r.g, r: r.r, step: r.step } })}\n`);
		await new Promise((done) => previewLog.end(done));
		writeFileSync(join(runDir, "exports.json"), `${JSON.stringify({ poster: { frame: plan.poster }, still: { frame: plan.still }, preview: { fps: pv.rung.fps, width: pv.rung.width, height: pv.rung.height, bytes: pv.bytes, encoder: pv.encoder } }, null, 2)}\n`);
		rmSync(detDir, { recursive: true, force: true });

		const sorted = [...times].sort((a, b) => a - b);
		const manifest = {
			schemaVersion: 1,
			path: "stage",
			format: treatment.format,
			width,
			height,
			fps,
			frameCount,
			durationSec: Math.round((frameCount / fps) * 1e6) / 1e6,
			targetDurationSec: treatment.durationSec,
			round,
			seed,
			chromeFlags: stageFlags(width, height),
			renderer: report.webgl?.renderer ?? null,
			webgl: report.webgl,
			previewEncoder: pv.encoder,
			stillsManifestSha256: stills.manifestSha256,
			determinismFrames: plan.determinism,
			sound: { mode: track.mode, notes: track.notes },
			pageErrors: [...record.pageErrors, ...report.errors].slice(0, 10),
			missingFiles: [...new Set(record.missing)],
			timing: { p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), captureSec: Math.round(sorted.reduce((a, b) => a + b, 0) / 100) / 10, masterSec: Math.round(masterSec * 10) / 10, replaysSec: Math.round(replaySec * 10) / 10, totalSec: Math.round((Date.now() - started) / 100) / 10 },
			generatedAt: new Date().toISOString(),
		};
		writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		const notes = [...track.notes, `preview rung: ${pv.rung.width}x${pv.rung.height} @ ${pv.rung.fps} fps, ${pv.bytes} B, encoder ${pv.encoder}`, `stills manifest sha256 ${stills.manifestSha256}`];
		const outcome = gateStage(outDir, { round, notes });
		log(`report: ${join(outDir, "gate-report.txt")}`);
		log(`stills manifest: ${join(stills.dir, "manifest.json")} (sha256 ${stills.manifestSha256})`);
		const badFrame = determinism.frames.find((d) => d.master !== d.replay);
		if (badFrame) throw new Exit(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: frame ${badFrame.frame} differs between the master and a fresh sequential replay${determinism.region ? ` (first differing region x ${determinism.region[0]}-${determinism.region[2]}, y ${determinism.region[1]}-${determinism.region[3]})` : ""}; something the clock does not cover (performance.timeOrigin, crypto randomness, an unseeded source) reaches the pixels. Report: ${join(outDir, "gate-report.txt")}`);
		if (qa.missing.length) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: copy line${qa.missing.length > 1 ? "s" : ""} never on screen: ${qa.missing.map((line) => `"${line}"`).join(", ")}; every copy line must appear in the film (as page text or registered canvas text). Report: ${join(outDir, "gate-report.txt")}`);
		if (outcome.soundInvalid) throw new Exit(EXIT.SOUND_INVALID, `SOUND_INVALID: ${outcome.rules.filter((r) => r.sound && r.status === "FAIL").map((r) => `${r.id} ${r.detail}`).join("; ")}. Report: ${join(outDir, "gate-report.txt")}`);
		if (outcome.passed) {
			log(`GATE PASS: ${join(outDir, "film.mp4")}`);
			return EXIT.OK;
		}
		const failed = outcome.rules.filter((r) => r.status === "FAIL").map((r) => r.id).join(", ");
		throw new Exit(EXIT.GATE_FAIL_QA, `GATE_FAIL_QA: ${failed}.${outcome.withheld ? ` MO-C-03 flash FAIL: the exports are withheld in ${join(outDir, "withheld")} as diagnostics, not deliverables.` : ""}${round >= MAX_ROUNDS ? " Round 3 of 3 reached: deliver with the failure stated." : ` Fix the cause and rerun with --round ${round + 1}; never shorten the film or drop a beat to pass.`}`);
	} finally {
		if (session) await closeStage(session);
		await pool.close();
	}
}

/** Bounding box [x0, y0, x1, y1] of the pixels that differ between two RGBA frames. */
export function diffRegion(a, b, width, height) {
	let box = null;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
		}
	return box;
}

/** Evaluate the stage gate, promote or withhold the exports, and write gate-report.txt. */
export function gateStage(outDir, { round, notes = [], framesViewed = 0 }) {
	const data = loadStageData(outDir);
	const rules = evaluateStage(data);
	const withheld = promote(outDir, data.manifest, rules);
	const names = exportPaths(outDir, data.manifest);
	const where = (name) => join(withheld ? join(outDir, "withheld") : outDir, name);
	const viewed = viewedFor(outDir, data.manifest.stillsManifestSha256) ?? framesViewed;
	writeFileSync(join(outDir, "gate-report.txt"), renderStageReport({ manifest: data.manifest, rules, outputs: { mp4: where(names.mp4), preview: where(names.preview), poster: where(names.poster), still: where(names.still) }, round: round ?? data.manifest.round ?? 1, framesViewed: viewed, withheld, notes }));
	const log = join(outDir, ".run", "render.jsonl");
	if (existsSync(log)) renameSync(log, join(outDir, "render.jsonl"));
	return { rules, withheld, passed: stagePassed(rules), soundInvalid: soundFailed(rules) };
}
