#!/usr/bin/env node
// lit-typographic-motion render CLI for LitCodex. One end-to-end command (`film`) runs a craft
// round: timeline -> pre-flight gate -> stills -> cut sheet -> (stop with --stills-only) -> master,
// preview, poster and reduced-motion still under .run/ -> full gate -> promote or withhold.
// Single modes: stills, sheet, video, perf, gate. Exit codes follow MO-A-45.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { evaluateCompletion } from "../engine/completion.mjs";
import { Composer } from "../engine/compose.mjs";
import { CREDIT_LINE, ENGINE_CREDIT, EXIT, Exit, FRAME, INSTALL_COMMAND, MAX_ROUNDS, NEAR_BLACK, PERF, PREVIEW, SAMPLING } from "../engine/constants.mjs";
import { buildPreview, encoderArgs, exportPaths, ffprobeSafe, locate, promote, requireFfmpeg } from "../engine/encode.mjs";

export { promote };
import { Blocked, close, launch, openEgress, perfFrame, renderFrame } from "../engine/driver.mjs";
import { FlashDetector } from "../engine/flash.mjs";
import { FONTS, fontEntry, fontPath, verifyFonts, verifyStrokeFonts } from "../engine/fonts.mjs";
import { evaluate, flashFailed, gatePassed, isSoftwareRenderer, timelineRules } from "../engine/gate.mjs";
import { contactSheet, decodePng, downscale, encodePng, luminancePercentile, rgbaSha256 } from "../engine/image.mjs";
import { passRanges, planPasses } from "../engine/passes.mjs";
import { PRESETS, pickPreset, presetFontKeys } from "../engine/presets.mjs";
import { renderReport } from "../engine/report.mjs";
import { audioState, ffmpegProbe, firstLine, resolveRuntime, venvPython, wordTimingState } from "../engine/runtime.mjs";
import { accentShot, buildTimeline, normalizeBrief } from "../engine/timeline.mjs";
import { loadTreatment, normalizeText, TreatmentError } from "../engine/treatment.mjs";
import { gateStage, runStage, stillsEntry, writeStills } from "../engine/stage-render.mjs";
import { recordLook, viewedFor } from "../engine/look.mjs";
import { measureMuxed, prepareTrack, soundFailed, trackPath } from "../engine/sound.mjs";
import { loadStrokeFont, strokeText } from "../engine/stroke.mjs";
import { FontBook, missingGlyphs } from "../engine/type.mjs";

const SELF = fileURLToPath(import.meta.url);
const MODES = ["stage", "sound", "look", "film", "stills", "sheet", "video", "perf", "gate", "completion", "determinism"];

export const USAGE = `lit-typographic-motion render CLI (LitCodex)
Every render reads <dir>/treatment.json first (or --treatment <file>); references/treatment.md.
Usage:
  node render.mjs stage  --out <dir> [--round N] [--stills-only] [--detach]
                         (renders <dir>/stage/index.html; references/stage.md)
  node render.mjs sound  --out <dir>   (builds <dir>/sound/bed.wav and sound-cues.json from the treatment)
  node render.mjs film   --out <dir> [--round N] [--stills-only] [--viewed N] [--brief <staging.json>]
                         [--preset swiss-signal|terminalcore|tidal] [--audio <file>] [--word-timing]
  node render.mjs stills --out <dir> [--t 1.2,3.4]
  node render.mjs sheet  --out <dir> --cuts
  node render.mjs video  --out <dir>
  node render.mjs perf   --out <dir>
  node render.mjs gate   --out <dir> [--viewed N]
  node render.mjs completion --out <dir>   (prints whether the film turn is complete)
Options (type path): --samples N (master 4), --shutter S (0.5), --scale 1..4, --seed N
Outputs in <dir>: film.mp4, preview.webp|preview.gif, poster.png, reduced-motion.png, manifest.json,
  render.jsonl, gate-report.txt, stills/ (with manifest.json), .run/ (staging), withheld/ (after a flash FAIL)
Exit: 0 OK, 10 BLOCKED_NO_CHROME, 11 BLOCKED_NO_WEBGL2, 12 BLOCKED_NO_FFMPEG_FOR_VIDEO,
  13 GATE_FAIL_QA, 14 BLOCKED_DEPS_NOT_PREWARMED, 15 BLOCKED_FONT_FETCH, 16 BLOCKED_TREATMENT_INVALID,
  17 STAGE_CONTRACT_ERROR, 18 STAGE_NONDETERMINISTIC, 19 STAGE_NETWORK_REQUEST, 20 SOUND_INVALID
Pre-warm outside any sandboxed session: ${INSTALL_COMMAND} [--audio] [--word-timing]
${CREDIT_LINE}`;

export function parseArgs(argv) {
	const [mode, ...rest] = argv;
	const args = { mode, flags: new Set() };
	for (let i = 0; i < rest.length; i++) {
		const token = rest[i];
		if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
		const key = token.slice(2);
		if (["stills-only", "cuts", "word-timing", "help", "detach"].includes(key)) args.flags.add(key);
		else {
			const value = rest[i + 1];
			if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
			args[key] = value;
			i++;
		}
	}
	return args;
}

const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);
const jsonl = (records) => `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;

// ------------------------------------------------------------------------------ preparation

/**
 * Resolve and validate the run's treatment (default `<out>/treatment.json`) before any render. The
 * first valid treatment is kept in .run/treatment-first.json for the done-check's downgrade test.
 */
export function resolveTreatment(args, expectPath) {
	if (!args.out) throw new Exit(EXIT.USAGE, "--out <dir> is required");
	const outDir = resolve(args.out);
	const file = resolve(args.treatment ?? join(outDir, "treatment.json"));
	let treatment;
	try {
		treatment = loadTreatment(file);
		if (expectPath && treatment.path !== expectPath) throw new TreatmentError("path", `this treatment takes the ${treatment.path} path; run \`${treatment.path === "stage" ? "stage" : "film"}\` for it`);
	} catch (error) {
		if (error instanceof TreatmentError) throw new Exit(EXIT.BLOCKED_TREATMENT_INVALID, `BLOCKED_TREATMENT_INVALID: ${error.message}`);
		throw error;
	}
	mkdirSync(join(outDir, ".run"), { recursive: true });
	const first = join(outDir, ".run", "treatment-first.json");
	if (!existsSync(first)) writeFileSync(first, `${JSON.stringify(treatment, null, 2)}\n`);
	writeFileSync(join(outDir, ".run", "treatment.json"), `${JSON.stringify({ file, treatment }, null, 2)}\n`);
	return { file, treatment };
}

/** The type engine's brief from the treatment; an explicit --brief may only add per-line staging. */
function typeBrief(args, treatment) {
	const plan = treatment.typePlan ?? {};
	const brief = {
		lines: treatment.copy.lines,
		durationSec: treatment.durationSec,
		...(plan.preset ? { preset: plan.preset, presetSource: plan.presetSource === "user" ? "user" : "agent" } : {}),
		...(plan.filmName ? { filmName: plan.filmName } : {}),
		showIndex: plan.showIndex === true,
		...(treatment.sound?.mode === "generated" ? { bpm: treatment.sound.tempo } : {}),
	};
	if (!args.brief) return brief;
	let extra;
	try {
		extra = JSON.parse(readFileSync(resolve(args.brief), "utf8"));
	} catch (error) {
		throw new Exit(EXIT.USAGE, `brief unreadable: ${error.message}`);
	}
	const texts = (Array.isArray(extra.lines) ? extra.lines : []).map((l) => normalizeText(typeof l === "string" ? l : (l?.text ?? "")));
	if (texts.length !== brief.lines.length || texts.some((text, i) => text !== normalizeText(brief.lines[i]))) throw new Exit(EXIT.BLOCKED_TREATMENT_INVALID, "BLOCKED_TREATMENT_INVALID: copy.lines: --brief lines must be the treatment's copy lines, in order; the brief only adds scene, accent and font per line");
	return { ...extra, ...brief, lines: extra.lines, ...(extra.preset ? { preset: extra.preset, presetSource: extra.presetSource === "user" ? "user" : "agent" } : {}) };
}

async function prepare(args, { record = true, rawBrief = null } = {}) {
	if (!args.out) throw new Exit(EXIT.USAGE, "--out <dir> is required");
	if (!rawBrief && !args.brief) throw new Exit(EXIT.USAGE, "--brief <brief.json> is required");
	const outDir = resolve(args.out);
	mkdirSync(join(outDir, ".run"), { recursive: true });
	let raw;
	try {
		raw = rawBrief ? structuredClone(rawBrief) : JSON.parse(readFileSync(resolve(args.brief), "utf8"));
	} catch (error) {
		throw new Exit(EXIT.USAGE, `brief unreadable: ${error.message}`);
	}
	if (args.preset) {
		raw.preset = args.preset;
		raw.presetSource = "agent";
	}
	if (args.seed) raw.seed = Number(args.seed);
	let brief;
	try {
		brief = normalizeBrief(raw);
	} catch (error) {
		throw new Exit(EXIT.USAGE, `brief invalid: ${error.message}`);
	}
	const pick = pickPreset(brief);
	const preset = PRESETS[pick.id];
	const runtime = resolveRuntime();
	if (!runtime.deps.ready) throw new Exit(EXIT.BLOCKED_DEPS_NOT_PREWARMED, `BLOCKED_DEPS_NOT_PREWARMED: ${runtime.deps.missing.join("; ")}. Run \`${INSTALL_COMMAND}\` outside the sandboxed session, then rerun.`);
	if (args.flags.has("word-timing")) {
		const words = wordTimingState(runtime.dir);
		if (!words.ready) throw new Exit(EXIT.BLOCKED_DEPS_NOT_PREWARMED, `BLOCKED_DEPS_NOT_PREWARMED: ${words.detail}. Run \`${INSTALL_COMMAND} --word-timing\` outside the sandboxed session.`);
	}
	const keys = presetFontKeys(preset);
	const faults = [...verifyFonts(keys, runtime.dir), ...(brief.lines.some((l) => l.scene === "stroke-signature") ? verifyStrokeFonts() : [])];
	if (faults.length) throw new Exit(EXIT.BLOCKED_FONT_FETCH, `BLOCKED_FONT_FETCH: ${faults.map((f) => `${f.key} ${f.fault}${f.path ? ` (${f.path})` : ""}`).join("; ")}. Run \`${INSTALL_COMMAND}\` outside the sandboxed session; a mismatched font is never re-fetched mid-render.`);
	const opentypeModule = await import(pathToFileURL(runtime.opentype).href);
	const opentype = opentypeModule.parse ? opentypeModule : opentypeModule.default;
	const files = Object.fromEntries(keys.map((key) => [key, { bytes: readFileSync(fontPath(fontEntry(key), runtime.dir)) }]));
	const book = new FontBook(opentype, files);
	const warnings = [];
	let beatGrid = null;
	let audioTier = "text-reading-time";
	if (args.audio) {
		const state = audioState(runtime.dir);
		if (!existsSync(resolve(args.audio))) throw new Exit(EXIT.USAGE, `audio file not found: ${args.audio}`);
		if (!state.ready) warnings.push(`${state.detail}; Tier 1 text reading-time timeline used instead`);
		else {
			const gridPath = join(outDir, ".run", "beat-grid.json");
			const result = spawnSync(venvPython(runtime.dir), [join(dirname(SELF), "beat-grid.py"), resolve(args.audio), gridPath], { encoding: "utf8", timeout: 300000 });
			if (result.status === 0 && existsSync(gridPath)) {
				const grid = JSON.parse(readFileSync(gridPath, "utf8"));
				if (grid.beats.length >= 4) {
					beatGrid = grid.beats;
					audioTier = "librosa-beat-grid";
				} else warnings.push("audio analysis found fewer than 4 beats; Tier 1 used instead");
			} else warnings.push(`audio analysis failed (${firstLine(result.stderr || result.error?.message || `exit ${result.status}`)}); Tier 1 used instead`);
		}
	}
	const plan = buildTimeline(brief, { beatGrid });
	if (brief.durationSec > 0 && plan.durationSec > brief.durationSec * 1.1) warnings.push(`the reading floors need ${plan.durationSec} s, longer than the treatment's ${brief.durationSec} s target`);
	const voices = Object.values(preset.voices);
	const coverageText = [...brief.lines.map((l) => l.text), ...(brief.lines.some((l) => l.scene === "number-counter") ? ["0123456789,."] : []), "0123456789/ "].join(" ");
	const coverage = missingGlyphs(book, coverageText, voices).concat(strokeCoverage(brief));
	const manifestBase = {
		schemaVersion: 1,
		engineCredit: ENGINE_CREDIT,
		presetId: preset.id,
		seed: brief.seed,
		fps: FRAME.fps,
		resolution: [FRAME.width, FRAME.height],
		scale: Number(args.scale ?? 1),
		samples: Number(args.samples ?? SAMPLING.masterSamples),
		shutter: Number(args.shutter ?? SAMPLING.masterShutter),
		renderer: null,
		softwareRenderer: false,
		chromeFlags: [],
		previewEncoder: null,
		audioTier,
		...(beatGrid ? { beatGrid } : { bpm: brief.bpm }),
		durationSec: plan.durationSec,
		targetDurationSec: brief.durationSec || null,
		path: "type",
		generatedAt: null,
		passRanges: [],
		timeline: plan.timeline,
		warnings,
		round: Number(args.round ?? 1),
	};
	if (!Number.isInteger(manifestBase.scale) || manifestBase.scale < 1 || manifestBase.scale > FRAME.maxScale) throw new Exit(EXIT.USAGE, "--scale must be an integer 1..4");
	if (!Number.isInteger(manifestBase.round) || manifestBase.round < 1 || manifestBase.round > MAX_ROUNDS) throw new Exit(EXIT.USAGE, `--round must be 1..${MAX_ROUNDS}`);
	if (record) writeFileSync(join(outDir, ".run", "brief.json"), `${JSON.stringify({ briefPath: args.brief ? resolve(args.brief) : null, brief: raw, normalized: brief, preset: preset.id, presetReason: pick.reason, audio: args.audio ? resolve(args.audio) : null }, null, 2)}\n`);
	return { args, outDir, brief, pick, preset, runtime, book, plan, coverage, manifestBase, warnings, audio: args.audio ? resolve(args.audio) : null };
}

function strokeCoverage(brief) {
	const missing = [];
	for (const line of brief.lines.filter((l) => l.scene === "stroke-signature")) {
		const key = line.font?.startsWith("ems-") ? line.font : "ems-allure";
		const layout = strokeText(loadStrokeFont(key), line.text, 100);
		for (const char of new Set(layout.missing)) missing.push({ char, codepoint: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`, fontKey: key });
	}
	return missing;
}

async function startSession(ctx, { samples, rung = null } = {}) {
	const session = await launch({ runtime: ctx.runtime, outDir: ctx.outDir, scale: ctx.manifestBase.scale, log: (line) => ctx.log?.push(line), rung });
	const software = isSoftwareRenderer(session.renderer);
	const effectiveSamples = software ? 1 : samples;
	const stateful = ctx.preset.passes.some((p) => p.pass === "crt") && !software;
	const accentId = accentShot(ctx.plan.shots);
	const accent = ctx.plan.shots.find((s) => s.id === accentId);
	const accentLength = Math.min(accent.holdSec - 0.35, 0.09 * ctx.plan.durationSec);
	const accentWindow = [accent.start + 0.3, accent.start + 0.3 + Math.max(0.2, accentLength)];
	const { plans, events } = planPasses({ preset: ctx.preset, shots: ctx.plan.shots, runSeed: ctx.brief.seed, softwareGL: software, fps: FRAME.fps, stateful });
	const composer = () => new Composer({ book: ctx.book, preset: ctx.preset, plan: ctx.plan, passPlans: plans, runSeed: ctx.brief.seed, fps: FRAME.fps, footer: ctx.brief.filmName ?? "", showIndex: ctx.brief.showIndex, accentShotId: accentId, accentWindow, stateful });
	const egress = await openEgress({ runtime: ctx.runtime, page: session.page });
	if (egress.kind !== "websocket") ctx.warnings.push(`frame egress: CDP pull of the readback buffer (listen refused: ${egress.listenError})`);
	return { session, egress, software, samples: effectiveSamples, plans, events, composer, stateful };
}

/** Render output frame n as a seek: stateful scenes replay their shot from its first frame (MO-A-05). */
async function renderSeeked(run, composer, n, options) {
	composer.resetPostTracking();
	if (run.stateful) {
		const shot = composer.shotOfFrame(n);
		for (let f = shot.frameStart; f < n; f++) {
			const { cmd } = composer.frame(f, { ...options, countInk: false, mask: false });
			await renderFrame(run.session, run.egress, { ...cmd, discard: true });
		}
	}
	const { cmd, line } = composer.frame(n, options);
	const { meta, bytes } = await renderFrame(run.session, run.egress, cmd);
	return { meta, bytes, line };
}

const settledFrame = (shot) => Math.min(shot.frameEnd, Math.round((shot.start + shot.holdSec * 0.85) * FRAME.fps));
const stillFrame = (shot) => Math.min(shot.frameEnd, Math.round((shot.start + shot.holdSec * 0.6) * FRAME.fps));

// ------------------------------------------------------------------------------ modes

async function stills(ctx, run, times = null) {
	const dir = join(ctx.outDir, "stills");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const frames = times ? times.map((t) => Math.min(ctx.plan.totalFrames - 1, Math.round(t * FRAME.fps))) : ctx.plan.shots.map(stillFrame);
	const composer = run.composer();
	const lines = [];
	const files = [];
	for (const n of frames) {
		const { meta, bytes, line } = await renderSeeked(run, composer, n, { samples: SAMPLING.stillSamples, shutter: ctx.manifestBase.shutter });
		const file = join(dir, `still-${String(n).padStart(5, "0")}.png`);
		writeFileSync(file, encodePng(FRAME.width * ctx.manifestBase.scale, FRAME.height * ctx.manifestBase.scale, bytes, 4, 6));
		lines.push({ ...line, pass: null, rgbaSha256: rgbaSha256(bytes), glyphInkPixels: meta.ink, mode: "stills" }, ...meta.log.map((l) => ({ frame: n, ...l })));
		files.push(file);
	}
	writeFileSync(join(dir, "render.jsonl"), jsonl(lines));
	return files;
}

function cutFrames(plan) {
	const frames = new Set();
	for (const shot of plan.shots.slice(1)) for (const d of [-6, -1, 0, 6]) frames.add(Math.max(0, Math.min(plan.totalFrames - 1, shot.frameStart + d)));
	return [...frames].sort((a, b) => a - b);
}

async function sheet(ctx, run) {
	const dir = join(ctx.outDir, "sheet");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const frames = cutFrames(ctx.plan);
	if (frames.length === 0) frames.push(0, Math.floor(ctx.plan.totalFrames / 2), ctx.plan.totalFrames - 1);
	const composer = run.composer();
	const thumbs = [];
	const labels = [];
	const lines = [];
	const w = FRAME.width * ctx.manifestBase.scale;
	const h = FRAME.height * ctx.manifestBase.scale;
	for (const n of frames) {
		const { meta, bytes, line } = await renderSeeked(run, composer, n, { samples: SAMPLING.stillSamples, shutter: ctx.manifestBase.shutter });
		thumbs.push(downscale(bytes, w, h, 480, 270));
		labels.push(`${(n / FRAME.fps).toFixed(2)}s f${n}`);
		lines.push({ ...line, pass: null, rgbaSha256: rgbaSha256(bytes), glyphInkPixels: meta.ink, mode: "sheet" }, ...meta.log.map((l) => ({ frame: n, ...l })));
	}
	const built = contactSheet(thumbs, 480, 270, 4, labels);
	const file = join(dir, "cuts.png");
	writeFileSync(file, encodePng(built.width, built.height, built.pixels, 4, 6));
	writeFileSync(join(dir, "render.jsonl"), jsonl(lines));
	return file;
}

/** Stream the master: every byte handed to ffmpeg is hashed, flash-audited and logged. */
async function master(ctx, run, ffmpeg, staging) {
	const w = FRAME.width * ctx.manifestBase.scale;
	const h = FRAME.height * ctx.manifestBase.scale;
	const previewDir = join(ctx.outDir, ".run", "preview-src");
	const maskDir = join(ctx.outDir, ".run", "masks");
	const contrastDir = join(ctx.outDir, ".run", "contrast");
	for (const dir of [previewDir, maskDir, contrastDir]) {
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
	}
	const encoder = spawn(ffmpeg.path, encoderArgs([w, h], FRAME.fps, staging, ctx.track?.wav ?? null), { stdio: ["pipe", "ignore", "pipe"] });
	let encoderError = "";
	encoder.stderr.on("data", (chunk) => {
		encoderError += chunk;
	});
	const exited = new Promise((done) => encoder.on("close", done));
	const log = createWriteStream(join(ctx.outDir, ".run", "render.jsonl"));
	const detector = new FlashDetector(w, h);
	const composer = run.composer();
	const contrastFrames = new Set(ctx.plan.shots.map(settledFrame));
	const cuts = new Set(ctx.plan.shots.map((s) => s.frameStart));
	const frames = [];
	let previewCount = 0;
	for (let n = 0; n < ctx.plan.totalFrames; n++) {
		const wantMask = contrastFrames.has(n) || cuts.has(n);
		const { cmd, line } = composer.frame(n, { samples: run.samples, shutter: ctx.manifestBase.shutter, countInk: true, mask: wantMask });
		const { meta, bytes } = await renderFrame(run.session, run.egress, cmd);
		line.pass = null;
		line.rgbaSha256 = rgbaSha256(bytes);
		line.glyphInkPixels = meta.ink;
		line.flash = detector.ingest(bytes);
		line.p995 = meta.ink === 0 ? Math.round(luminancePercentile(bytes, NEAR_BLACK.percentile) * 1e4) / 1e4 : null;
		for (const pass of meta.log) log.write(`${JSON.stringify({ frame: n, ...pass })}\n`);
		log.write(`${JSON.stringify(line)}\n`);
		frames.push({ frame: n, rgbaSha256: line.rgbaSha256, glyphInkPixels: meta.ink });
		if (meta.mask) {
			const mask = Buffer.from(meta.mask, "base64");
			writeFileSync(join(maskDir, `f${String(n).padStart(5, "0")}.png`), encodePng(w, h, mask, 1, 6));
			if (contrastFrames.has(n)) writeFileSync(join(contrastDir, `f${String(n).padStart(5, "0")}.png`), encodePng(w, h, bytes, 4, 3));
		}
		if (n % 2 === 0) {
			writeFileSync(join(previewDir, `${String(previewCount).padStart(5, "0")}.png`), encodePng(PREVIEW.widths[0], (PREVIEW.widths[0] * 9) / 16, downscale(bytes, w, h, PREVIEW.widths[0], (PREVIEW.widths[0] * 9) / 16), 4, 3));
			previewCount++;
		}
		if (!encoder.stdin.write(bytes)) await new Promise((done) => encoder.stdin.once("drain", done));
	}
	encoder.stdin.end();
	const code = await exited;
	await new Promise((done) => log.end(done));
	if (code !== 0) throw new Error(`ffmpeg encode failed: ${firstLine(encoderError || `exit ${code}`)}`);
	return { frames, previewCount };
}

/**
 * The stills set every render writes (director brief section 9), on the type path: one still at
 * each shot's midpoint, a -6/0/+6 strip around every cut, a 12-frame contact sheet and the poster,
 * with a hashed manifest the look rounds and the done-check read.
 */
async function stillsSet(ctx, run, kind) {
	const w = FRAME.width * ctx.manifestBase.scale;
	const h = FRAME.height * ctx.manifestBase.scale;
	const total = ctx.plan.totalFrames;
	const clampFrame = (f) => Math.max(0, Math.min(total - 1, f));
	const shots = ctx.plan.shots;
	const beats = shots.map((shot, i) => ({ index: i, start: shot.frameStart, mid: clampFrame(Math.round(((shot.start + shot.end) / 2) * FRAME.fps)) }));
	const plan = {
		beats,
		cuts: beats.slice(1).map((beat) => ({ beat: beat.index, frames: [-6, 0, 6].map((d) => clampFrame(beat.start + d)) })),
		sheet: Array.from({ length: 12 }, (_, i) => clampFrame(Math.round((i * (total - 1)) / 11))),
		poster: beats[Math.floor(beats.length / 2)].mid,
	};
	const needed = new Set([...beats.map((b) => b.mid), ...plan.cuts.flatMap((c) => c.frames), ...plan.sheet, plan.poster]);
	const composer = run.composer();
	const frames = new Map();
	for (const n of [...needed].sort((a, b) => a - b)) {
		const { bytes } = await renderSeeked(run, composer, n, { samples: SAMPLING.stillSamples, shutter: ctx.manifestBase.shutter });
		frames.set(n, stillsEntry(encodePng(w, h, bytes, 4, 6), bytes, w, h));
	}
	return writeStills({ outDir: ctx.outDir, plan, frames, width: w, height: h, fps: FRAME.fps, round: ctx.manifestBase.round, kind });
}

/** The type path's preview: the shared MO-A-38 ladder over the 960x540 preview-src frames. */
function preview(ctx, ffmpeg, previewCount) {
	return buildPreview({ runDir: join(ctx.outDir, ".run"), ffmpeg, previewCount, frame: [FRAME.width, FRAME.height], minGlyph: ctx.minFontPx ?? 28 });
}

async function renderStill(ctx, run, n, file) {
	const composer = run.composer();
	const { meta, bytes, line } = await renderSeeked(run, composer, n, { samples: run.samples, shutter: ctx.manifestBase.shutter, still: true });
	writeFileSync(file, encodePng(FRAME.width * ctx.manifestBase.scale, FRAME.height * ctx.manifestBase.scale, bytes, 4, 9));
	return { frame: n, rgbaSha256: rgbaSha256(bytes), glyphInkPixels: meta.ink, textBoxes: line.textBoxes };
}

async function perf(ctx, run) {
	const composer = run.composer();
	const count = Math.max(PERF.minFrames, 120);
	const frames = Array.from({ length: count }, (_, i) => Math.min(ctx.plan.totalFrames - 1, Math.round((i * (ctx.plan.totalFrames - 1)) / (count - 1))));
	const times = [];
	for (const n of frames) {
		const { cmd } = composer.frame(n, { samples: 1, shutter: ctx.manifestBase.shutter, countInk: false });
		times.push(await perfFrame(run.session, cmd));
	}
	const sorted = [...times].sort((a, b) => a - b);
	const result = { frames: times.length, p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1], samples: 1, renderer: run.session.renderer, software: run.software };
	writeFileSync(join(ctx.outDir, ".run", "perf.json"), `${JSON.stringify(result, null, 2)}\n`);
	return result;
}

/** MO-C-09 / MO-A-25: re-render the cut-sheet frames in fresh processes and compare hashes. */
function determinism(ctx, rungIndex, frames, videoLines) {
	const runChild = (rung, tag) => {
		const file = join(ctx.outDir, ".run", `determinism-${tag}.jsonl`);
		const result = spawnSync(process.execPath, [SELF, "determinism", "--brief", join(ctx.outDir, ".run", "brief.json"), "--out", ctx.outDir, "--frames", frames.join(","), "--rung", String(rung), "--samples", String(ctx.effectiveSamples), "--shutter", String(ctx.manifestBase.shutter), "--scale", String(ctx.manifestBase.scale), "--record", file], { encoding: "utf8", timeout: 900000 });
		if (result.status !== 0 || !existsSync(file)) return { error: firstLine(result.stderr || `exit ${result.status}`) };
		return { lines: readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
	};
	const hardware = runChild(rungIndex, "rerender");
	if (hardware.error) return { frames: [], error: hardware.error };
	const pairs = hardware.lines.map((l) => ({ frame: l.frame, video: videoLines.get(l.frame), rerender: l.rgbaSha256 }));
	const record = { frames: pairs, rung: rungIndex };
	if (pairs.some((p) => p.video !== p.rerender) && rungIndex === 0) {
		const a = runChild(1, "swiftshader-a");
		const b = runChild(1, "swiftshader-b");
		if (!a.error && !b.error) record.swiftshader = a.lines.map((l, i) => ({ frame: l.frame, a: l.rgbaSha256, b: b.lines[i]?.rgbaSha256 }));
	}
	writeFileSync(join(ctx.outDir, ".run", "determinism.json"), `${JSON.stringify(record, null, 2)}\n`);
	return record;
}

// ------------------------------------------------------------------------------ gate + promote

function loadRunData(outDir) {
	const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
	const logPath = existsSync(join(outDir, "render.jsonl")) ? join(outDir, "render.jsonl") : join(outDir, ".run", "render.jsonl");
	const frames = [];
	const passLog = new Map();
	const previewRecords = [];
	for (const text of readFileSync(logPath, "utf8").split("\n")) {
		if (!text) continue;
		const line = JSON.parse(text);
		if (line.previewFrame !== undefined) previewRecords.push({ f: line.previewFrame, g: line.flash.g, r: line.flash.r });
		else if (line.pass === null) frames.push(line);
		else {
			if (!passLog.has(line.frame)) passLog.set(line.frame, []);
			passLog.get(line.frame).push(line);
		}
	}
	const names = exportPaths(outDir, manifest);
	const exportsInfo = {};
	for (const [key, name] of Object.entries(names)) {
		const path = locate(outDir, name);
		exportsInfo[key] = { present: Boolean(path), path, bytes: path ? statSync(path).size : null };
	}
	const run = join(outDir, ".run");
	const read = (name) => (existsSync(join(run, name)) ? JSON.parse(readFileSync(join(run, name), "utf8")) : null);
	const exportsLog = read("exports.json");
	const contrastDir = join(run, "contrast");
	const contrast = existsSync(contrastDir)
		? readdirSync(contrastDir).filter((n) => n.endsWith(".png")).map((name) => {
				const frame = Number(name.slice(1, 6));
				const image = decodePng(readFileSync(join(contrastDir, name)));
				const mask = decodePng(readFileSync(join(run, "masks", name)));
				return { frame, width: image.width, height: image.height, rgba: image.pixels, mask: mask.pixels };
			})
		: [];
	return {
		manifest,
		frames,
		passLog,
		preview: { records: previewRecords, fps: exportsLog?.preview?.fps ?? 30 },
		exports: exportsInfo,
		probe: exportsInfo.mp4.path ? ffprobeSafe(exportsInfo.mp4.path) : null,
		sound: exportsInfo.mp4.path ? measureMuxed(exportsInfo.mp4.path) : null,
		soundMode: read("treatment.json")?.treatment?.sound?.mode ?? manifest.sound?.mode ?? null,
		perf: read("perf.json"),
		determinism: read("determinism.json"),
		coverage: read("preflight.json")?.coverage ?? [],
		stillInk: exportsLog?.still?.glyphInkPixels ?? null,
		contrast,
		presetReason: read("brief.json")?.presetReason ?? "recorded brief missing",
		exportsLog,
	};
}

function writeGate(outDir, data, rules, { framesViewed, round, notes = [], stage = "full" }) {
	const withheld = stage === "full" ? promote(outDir, data.manifest, rules) : false;
	const names = exportPaths(outDir, data.manifest);
	const where = (name) => (stage !== "full" ? `${name} (not rendered)` : join(withheld ? join(outDir, "withheld") : outDir, name));
	const report = renderReport({ manifest: data.manifest, rules, outputs: { mp4: where(names.mp4), preview: where(names.preview), poster: where(names.poster), still: where(names.still) }, presetReason: data.presetReason, round, framesViewed, withheld, notes, stage });
	writeFileSync(join(outDir, "gate-report.txt"), report);
	const log = join(outDir, ".run", "render.jsonl");
	if (stage === "full" && existsSync(log)) renameSync(log, join(outDir, "render.jsonl"));
	return { report, withheld, passed: gatePassed(rules) };
}

// ------------------------------------------------------------------------------ entry

/**
 * Frames viewed for the report. A render records its own count (0 until frames are looked at); a
 * gate re-run without --viewed keeps the recorded count instead of resetting it.
 */
export function framesViewed(outDir, args, { render = false } = {}) {
	const manifestPath = join(outDir, "manifest.json");
	const fromLook = !render && existsSync(manifestPath) ? viewedFor(outDir, JSON.parse(readFileSync(manifestPath, "utf8")).stillsManifestSha256) : null;
	if (fromLook !== null) return fromLook;
	const file = join(outDir, ".run", "viewed.json");
	if (args.viewed !== undefined || render) {
		const count = Number(args.viewed ?? 0);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify({ count })}\n`);
		return count;
	}
	return existsSync(file) ? Number(JSON.parse(readFileSync(file, "utf8")).count ?? 0) : 0;
}

function clearVerdict(outDir) {
	for (const name of ["manifest.json", "gate-report.txt", "render.jsonl", "film.mp4", "preview.webp", "preview.gif", "poster.png", "reduced-motion.png"]) rmSync(join(outDir, name), { force: true });
	rmSync(join(outDir, "withheld"), { recursive: true, force: true });
}

async function runFilm(args, ctx) {
	const notes = [];
	clearVerdict(ctx.outDir);
	const preflight = timelineRules(ctx.manifestBase, { coverage: ctx.coverage });
	writeFileSync(join(ctx.outDir, ".run", "preflight.json"), `${JSON.stringify({ rules: preflight, coverage: ctx.coverage }, null, 2)}\n`);
	if (!gatePassed(preflight)) {
		writeFileSync(join(ctx.outDir, "manifest.json"), `${JSON.stringify({ ...ctx.manifestBase, generatedAt: new Date().toISOString() }, null, 2)}\n`);
		writeGate(ctx.outDir, { manifest: ctx.manifestBase, presetReason: ctx.pick.reason }, preflight, { framesViewed: framesViewed(ctx.outDir, args, { render: true }), round: ctx.manifestBase.round, stage: "preflight", notes: ["pre-flight FAIL: fix the named unit and rerun with --round N+1"] });
		throw new Exit(EXIT.GATE_FAIL_QA, `GATE_FAIL_QA (pre-flight): ${preflight.filter((r) => r.status === "FAIL").map((r) => `${r.id} ${r.detail}`).join("; ")}; report: ${join(ctx.outDir, "gate-report.txt")}`);
	}
	const run = await startSession(ctx, { samples: ctx.manifestBase.samples });
	try {
		ctx.effectiveSamples = run.samples;
		const stillsOnly = args.flags.has("stills-only");
		const set = await stillsSet(ctx, run, stillsOnly ? "stills-only" : "render");
		out(`stills: ${set.files.map((f) => join(set.dir, f.file)).join(" ")}`);
		out(`stills manifest: ${join(set.dir, "manifest.json")} (sha256 ${set.manifestSha256})`);
		if (stillsOnly) {
			const track = prepareTrack({ outDir: ctx.outDir, treatment: ctx.treatment, frameCount: ctx.plan.totalFrames, fps: FRAME.fps, cuts: ctx.plan.shots.slice(1).map((shot) => shot.start), supplied: ctx.audio });
			for (const note of track.notes) out(note);
			out("stills-only: view every still, then record the look round; this is not a finished film.");
			return EXIT.OK;
		}
		const ffmpeg = requireFfmpeg();
		const manifest = { ...ctx.manifestBase, renderer: run.session.renderer, softwareRenderer: run.software, chromeFlags: run.session.flags, samples: run.samples, previewEncoder: ffmpeg.previewEncoder, passRanges: passRanges(run.plans), stillsManifestSha256: set.manifestSha256, generatedAt: new Date().toISOString() };
		if (run.software) manifest.warnings.push(`software GL detected (${run.session.renderer}); --samples lowered to 1`);
		ctx.track = prepareTrack({ outDir: ctx.outDir, treatment: ctx.treatment, frameCount: ctx.plan.totalFrames, fps: FRAME.fps, cuts: ctx.plan.shots.slice(1).map((shot) => shot.start), supplied: ctx.audio });
		manifest.sound = { mode: ctx.track.mode, notes: ctx.track.notes };
		const { frames, previewCount } = await master(ctx, run, ffmpeg, join(ctx.outDir, ".run", "film.mp4"));
		ctx.minFontPx = minFontPx(ctx);
		const pv = await preview(ctx, ffmpeg, previewCount);
		const log = createWriteStream(join(ctx.outDir, ".run", "render.jsonl"), { flags: "a" });
		for (const record of pv.records) log.write(`${JSON.stringify({ previewFrame: record.f, rung: `${pv.rung.width}x${pv.rung.fps}`, pass: null, flash: { g: record.g, r: record.r, step: record.step } })}\n`);
		await new Promise((done) => log.end(done));
		if (!pv.fit) notes.push(`preview: smallest reachable size ${pv.smallest.bytes} B at ${pv.smallest.width} px / ${pv.smallest.fps} fps`);
		notes.push(`preview rung: ${pv.rung.width} px @ ${pv.rung.fps} fps, ${pv.bytes} B, encoder ${pv.encoder}`);
		const posterShot = ctx.plan.shots.find((s) => s.text) ?? ctx.plan.shots[0];
		const poster = await renderStill(ctx, run, Math.round(((posterShot.start + posterShot.end) / 2) * FRAME.fps), join(ctx.outDir, ".run", "poster.png"));
		const finalShot = [...ctx.plan.shots].reverse().find((s) => s.text) ?? ctx.plan.shots[ctx.plan.shots.length - 1];
		const still = await renderStill(ctx, run, finalShot.frameEnd, join(ctx.outDir, ".run", "reduced-motion.png"));
		writeFileSync(join(ctx.outDir, ".run", "exports.json"), `${JSON.stringify({ poster, still, preview: { fps: pv.rung.fps, width: pv.rung.width, bytes: pv.bytes, encoder: pv.encoder } }, null, 2)}\n`);
		writeFileSync(join(ctx.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		await perf(ctx, run);
		await close(run.session, run.egress);
		run.closed = true;
		const videoLines = new Map(frames.map((f) => [f.frame, f.rgbaSha256]));
		const det = determinism(ctx, run.software ? 1 : 0, cutFrames(ctx.plan).slice(0, 8), videoLines);
		if (det.error) notes.push(`determinism re-render failed: ${det.error}`);
		for (const warning of manifest.warnings) notes.push(`warning: ${warning}`);
		notes.push(`egress: ${run.egress.kind}${run.egress.listenError ? ` (listen error: ${run.egress.listenError})` : ""}`);
		notes.push(`audio tier: ${manifest.audioTier}`);
		notes.push(...ctx.track.notes);
		const data = loadRunData(ctx.outDir);
		const rules = evaluate(data);
		const { withheld, passed } = writeGate(ctx.outDir, data, rules, { framesViewed: framesViewed(ctx.outDir, args, { render: true }), round: manifest.round, notes });
		out(`report: ${join(ctx.outDir, "gate-report.txt")}`);
		if (soundFailed(rules)) throw new Exit(EXIT.SOUND_INVALID, `SOUND_INVALID: ${rules.filter((r) => r.sound && r.status === "FAIL").map((r) => `${r.id} ${r.detail}`).join("; ")}`);
		if (passed) {
			out(`GATE PASS: ${join(ctx.outDir, "film.mp4")}`);
			return EXIT.OK;
		}
		const failed = rules.filter((r) => r.status === "FAIL").map((r) => r.id).join(", ");
		if (withheld) throw new Exit(EXIT.GATE_FAIL_QA, `GATE_FAIL_QA: ${failed}. MO-C-03 flash FAIL: film, preview and poster are withheld in ${join(ctx.outDir, "withheld")} as diagnostics, not deliverables.${manifest.round >= MAX_ROUNDS ? " Round 3 of 3 reached: the render is withheld pending a fix." : ` Fix and rerun with --round ${manifest.round + 1}.`}`);
		throw new Exit(EXIT.GATE_FAIL_QA, `GATE_FAIL_QA: ${failed}.${manifest.round >= MAX_ROUNDS ? " Round 3 of 3 reached: deliver the report with the render for review." : ` Fix the named rule and rerun with --round ${manifest.round + 1}.`}`);
	} finally {
		if (!run.closed) await close(run.session, run.egress);
	}
}

function minFontPx(ctx) {
	let min = Number.POSITIVE_INFINITY;
	const log = join(ctx.outDir, ".run", "render.jsonl");
	for (const text of readFileSync(log, "utf8").split("\n")) {
		if (!text.includes('"textBoxes"')) continue;
		for (const box of JSON.parse(text).textBoxes ?? []) min = Math.min(min, box.fontSizePx);
	}
	return Number.isFinite(min) ? min : 28;
}

async function runVideo(args, ctx) {
	const ffmpeg = requireFfmpeg();
	const run = await startSession(ctx, { samples: ctx.manifestBase.samples });
	try {
		const manifest = { ...ctx.manifestBase, renderer: run.session.renderer, softwareRenderer: run.software, chromeFlags: run.session.flags, samples: run.samples, previewEncoder: ffmpeg.previewEncoder, passRanges: passRanges(run.plans), generatedAt: new Date().toISOString() };
		ctx.track = prepareTrack({ outDir: ctx.outDir, treatment: ctx.treatment, frameCount: ctx.plan.totalFrames, fps: FRAME.fps, cuts: ctx.plan.shots.slice(1).map((shot) => shot.start), supplied: ctx.audio });
		manifest.sound = { mode: ctx.track.mode, notes: ctx.track.notes };
		const { previewCount } = await master(ctx, run, ffmpeg, join(ctx.outDir, "film.mp4"));
		ctx.minFontPx = minFontPx(ctx);
		const pv = await preview(ctx, ffmpeg, previewCount);
		renameSync(pv.target, join(ctx.outDir, pv.encoder === "gif" ? "preview.gif" : "preview.webp"));
		const log = createWriteStream(join(ctx.outDir, ".run", "render.jsonl"), { flags: "a" });
		for (const record of pv.records) log.write(`${JSON.stringify({ previewFrame: record.f, rung: `${pv.rung.width}x${pv.rung.fps}`, pass: null, flash: { g: record.g, r: record.r, step: record.step } })}\n`);
		await new Promise((done) => log.end(done));
		const posterShot = ctx.plan.shots.find((s) => s.text) ?? ctx.plan.shots[0];
		const poster = await renderStill(ctx, run, Math.round(((posterShot.start + posterShot.end) / 2) * FRAME.fps), join(ctx.outDir, "poster.png"));
		const finalShot = [...ctx.plan.shots].reverse().find((s) => s.text) ?? ctx.plan.shots[ctx.plan.shots.length - 1];
		const still = await renderStill(ctx, run, finalShot.frameEnd, join(ctx.outDir, "reduced-motion.png"));
		writeFileSync(join(ctx.outDir, ".run", "exports.json"), `${JSON.stringify({ poster, still, preview: { fps: pv.rung.fps, width: pv.rung.width, bytes: pv.bytes, encoder: pv.encoder } }, null, 2)}\n`);
		writeFileSync(join(ctx.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		renameSync(join(ctx.outDir, ".run", "render.jsonl"), join(ctx.outDir, "render.jsonl"));
		out(`video: ${join(ctx.outDir, "film.mp4")} (run \`node ${SELF} gate --out ${ctx.outDir}\` for the full gate)`);
		return EXIT.OK;
	} finally {
		await close(run.session, run.egress);
	}
}

async function runDeterminismChild(args) {
	const recorded = JSON.parse(readFileSync(resolve(args.brief), "utf8"));
	const briefPath = join(resolve(args.out), ".run", `determinism-brief-${process.pid}.json`);
	writeFileSync(briefPath, JSON.stringify({ ...recorded.brief, preset: recorded.preset }));
	const ctx = await prepare({ ...args, brief: briefPath, flags: new Set() }, { record: false });
	rmSync(briefPath, { force: true });
	const rung = Number(args.rung ?? 0);
	const session = await launch({ runtime: ctx.runtime, outDir: ctx.outDir, scale: ctx.manifestBase.scale, rung });
	const egress = await openEgress({ runtime: ctx.runtime, page: session.page });
	try {
		const software = isSoftwareRenderer(session.renderer);
		const stateful = ctx.preset.passes.some((p) => p.pass === "crt") && !software;
		const accentId = accentShot(ctx.plan.shots);
		const accent = ctx.plan.shots.find((s) => s.id === accentId);
		const accentLength = Math.min(accent.holdSec - 0.35, 0.09 * ctx.plan.durationSec);
		const accentWindow = [accent.start + 0.3, accent.start + 0.3 + Math.max(0.2, accentLength)];
		const { plans } = planPasses({ preset: ctx.preset, shots: ctx.plan.shots, runSeed: ctx.brief.seed, softwareGL: software, fps: FRAME.fps, stateful });
		const run = { session, egress, stateful, composer: () => new Composer({ book: ctx.book, preset: ctx.preset, plan: ctx.plan, passPlans: plans, runSeed: ctx.brief.seed, fps: FRAME.fps, footer: ctx.brief.filmName ?? "", showIndex: ctx.brief.showIndex, accentShotId: accentId, accentWindow, stateful }) };
		const lines = [];
		for (const n of args.frames.split(",").map(Number)) {
			const { bytes } = await renderSeeked(run, run.composer(), n, { samples: Number(args.samples), shutter: Number(args.shutter), countInk: false });
			lines.push({ frame: n, rgbaSha256: rgbaSha256(bytes), renderer: session.renderer, chromeFlags: session.flags });
		}
		writeFileSync(resolve(args.record), jsonl(lines));
		return EXIT.OK;
	} finally {
		await close(session, egress);
	}
}

/**
 * Run a long stage render in the background. The child writes .run/progress.json while it works
 * and .run/exit.json when it ends; its output goes to .run/render.log.
 */
function detach(argv, outDir) {
	const runDir = join(outDir, ".run");
	mkdirSync(runDir, { recursive: true });
	rmSync(join(runDir, "exit.json"), { force: true });
	const logFd = openSync(join(runDir, "render.log"), "w");
	const child = spawn(process.execPath, [SELF, ...argv.filter((a) => a !== "--detach")], { detached: true, stdio: ["ignore", logFd, logFd], env: { ...process.env, LITCODEX_MOTION_EXIT_FILE: join(runDir, "exit.json") } });
	child.unref();
	closeSync(logFd);
	out(`rendering in the background (pid ${child.pid}). Progress: ${join(runDir, "progress.json")}; the exit code lands in ${join(runDir, "exit.json")}; output in ${join(runDir, "render.log")}.`);
	return EXIT.OK;
}

export async function main(argv = process.argv.slice(2)) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
		out(USAGE);
		return argv.length === 0 ? EXIT.USAGE : EXIT.OK;
	}
	let args;
	try {
		args = parseArgs(argv);
		if (!MODES.includes(args.mode)) throw new Error(`unknown mode "${args.mode}" (use ${MODES.filter((m) => m !== "determinism").join(", ")})`);
	} catch (error) {
		err(`${error.message}\n\n${USAGE}`);
		return EXIT.USAGE;
	}
	try {
		if (args.mode === "gate") {
			if (!args.out) throw new Exit(EXIT.USAGE, "--out <dir> is required");
			const outDir = resolve(args.out);
			if (!existsSync(join(outDir, "manifest.json"))) throw new Exit(EXIT.USAGE, `no manifest.json in ${outDir}; render first`);
			if (JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")).path === "stage") {
				const outcome = gateStage(outDir, { framesViewed: framesViewed(outDir, args) });
				out(`report: ${join(outDir, "gate-report.txt")}`);
				if (outcome.soundInvalid) {
					err(`SOUND_INVALID: ${outcome.rules.filter((r) => r.sound && r.status === "FAIL").map((r) => `${r.id} ${r.detail}`).join("; ")}`);
					return EXIT.SOUND_INVALID;
				}
				if (outcome.passed) {
					out("GATE PASS");
					return EXIT.OK;
				}
				err(`GATE_FAIL_QA: ${outcome.rules.filter((r) => r.status === "FAIL").map((r) => r.id).join(", ")}${outcome.withheld ? "; exports withheld in withheld/" : ""}`);
				return EXIT.GATE_FAIL_QA;
			}
			const data = loadRunData(outDir);
			const rules = evaluate(data);
			const notes = (data.manifest.warnings ?? []).map((w) => `warning: ${w}`);
			const { passed, withheld } = writeGate(outDir, data, rules, { framesViewed: framesViewed(outDir, args), round: data.manifest.round ?? 1, notes });
			out(`report: ${join(outDir, "gate-report.txt")}`);
			if (soundFailed(rules)) {
				err(`SOUND_INVALID: ${rules.filter((r) => r.sound && r.status === "FAIL").map((r) => `${r.id} ${r.detail}`).join("; ")}`);
				return EXIT.SOUND_INVALID;
			}
			if (passed) {
				out("GATE PASS");
				return EXIT.OK;
			}
			err(`GATE_FAIL_QA: ${rules.filter((r) => r.status === "FAIL").map((r) => r.id).join(", ")}${withheld ? "; exports withheld in withheld/" : ""}`);
			return EXIT.GATE_FAIL_QA;
		}
		if (args.mode === "determinism") return await runDeterminismChild(args);
		if (args.mode === "completion") {
			if (!args.out) throw new Exit(EXIT.USAGE, "--out <dir> is required");
			const verdict = evaluateCompletion(resolve(args.out));
			out(`completion: ${verdict.status} - ${verdict.reason}`);
			if (verdict.downgraded.length) out(`downgraded: ${verdict.downgraded.join("; ")} (say so in the reply)`);
			if (verdict.openItems.length) out(`open look items: ${verdict.openItems.join(" | ")}`);
			return verdict.complete ? EXIT.OK : 1;
		}
		if (args.mode === "look") {
			if (!args.out || !args.answers) throw new Exit(EXIT.USAGE, "look needs --out <dir> --round N --answers <file>");
			const entry = recordLook(resolve(args.out), Number(args.round), resolve(args.answers));
			if (entry.blocked) out(`look round ${entry.round}: blocked (${entry.blocked}); the film will be reported as not viewed`);
			else out(`look round ${entry.round} recorded against stills ${entry.manifestSha256.slice(0, 12)}: ${Object.keys(entry.frames).length} frames stamped${entry.needsAnotherRound ? `; another round needed: ${entry.openItems.map((item) => item.split(":")[0]).join(", ")}` : "; nothing asks for another round"}`);
			return EXIT.OK;
		}
		if (args.mode === "sound") {
			const { treatment } = resolveTreatment(args, null);
			const fps = treatment.fps ?? 60;
			const outDir = resolve(args.out);
			const track = prepareTrack({ outDir, treatment, frameCount: Math.round(treatment.durationSec * fps), fps });
			for (const note of track.notes) out(note);
			if (track.wav) out(`track: ${track.wav}\ncues: ${join(outDir, "sound-cues.json")}`);
			return EXIT.OK;
		}
		if (args.mode === "stage") {
			const { treatment } = resolveTreatment(args, "stage");
			if (args.flags.has("detach") && !args.flags.has("stills-only")) return detach(argv, resolve(args.out));
			return await runStage({ outDir: resolve(args.out), treatment, round: Number(args.round ?? 1), stillsOnly: args.flags.has("stills-only"), log: out });
		}
		const { treatment } = resolveTreatment(args, "type");
		if (!args.audio && ["supplied", "authored"].includes(treatment.sound.mode)) args.audio = trackPath(resolve(args.out), treatment.sound.file);
		const ctx = await prepare(args, { rawBrief: typeBrief(args, treatment) });
		ctx.treatment = treatment;
		if (args.mode === "film") return await runFilm(args, ctx);
		if (args.mode === "video") return await runVideo(args, ctx);
		const run = await startSession(ctx, { samples: ctx.manifestBase.samples });
		try {
			if (args.mode === "stills") out((await stills(ctx, run, args.t ? args.t.split(",").map(Number) : null)).join("\n"));
			else if (args.mode === "sheet") {
				if (!args.flags.has("cuts")) throw new Exit(EXIT.USAGE, "sheet needs --cuts (one frame set around every cut)");
				out(await sheet(ctx, run));
			} else if (args.mode === "perf") {
				const result = await perf(ctx, run);
				out(`perf: ${result.frames} frames, p50 ${result.p50.toFixed(1)} ms, p95 ${result.p95.toFixed(1)} ms (${run.software ? "software GL" : "hardware"})`);
			}
			return EXIT.OK;
		} finally {
			await close(run.session, run.egress);
		}
	} catch (error) {
		if (error instanceof Blocked) {
			err(`${error.blockedName}: ${error.message}`);
			return error.exit;
		}
		if (error instanceof Exit) {
			err(error.message);
			return error.code;
		}
		err(`render error: ${error.stack ?? error.message}`);
		return 1;
	}
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(SELF)) {
	process.exitCode = await main();
	if (process.env.LITCODEX_MOTION_EXIT_FILE) writeFileSync(process.env.LITCODEX_MOTION_EXIT_FILE, `${JSON.stringify({ exit: process.exitCode, at: new Date().toISOString() })}\n`);
}
