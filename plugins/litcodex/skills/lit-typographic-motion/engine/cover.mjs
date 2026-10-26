// Cover mode orchestration (references/cover.md). One round: the cover treatment -> the static scan of
// cover/ -> assets.json (exit 22 for a missing asset, before any capture) -> fonts -> a master Chrome
// seeks t = i / N for every frame at 2x, the pool downsamples each to the cover size, and the same
// page draws the title mask -> a fresh Chrome repeats every frame (G0) -> another fresh Chrome renders
// a seeded shuffle of frames, which must match the master (a page that keeps state between frames
// fails here, exit 18) -> the flash audit on the frames, looped -> img2webp with frame 0 and the
// frames before the seam at a higher quality, or gifski when libwebp is missing -> the cover gate on
// the DECODED file with the cap-height floor and frame 0's base art -> stills (decoded sheet frames,
// poster, seam pair) and the review sheet -> manifest and report. A flash FAIL withholds the cover.
// `--window t0,t1` captures and sheets only the frames around a logged defect; it never counts as done.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { COVER, EXIT, Exit, INSTALL_COMMAND } from "./constants.mjs";
import { artCheck, checkAssets, readRaster } from "./cover-assets.mjs";
import { CoverPool, CoverSession, capturePass } from "./cover-capture.mjs";
import { coverGate, formatCoverReport, frameFiles, readPngRgba, verdictOf } from "./cover-gate.mjs";
import { lumaGrid } from "./cover-image.mjs";
import { renderSheet } from "./cover-sheet.mjs";
import { loadCoverTreatment } from "./cover-treatment.mjs";
import { countFlashes, detectLoopingStream } from "./flash.mjs";
import { FONTS, verifyFonts } from "./fonts.mjs";
import { encodePng } from "./image.mjs";
import { firstLine, resolveRuntime, which } from "./runtime.mjs";
import { fontRoutes, scanStage, stageFontFaults } from "./stage.mjs";
import { TreatmentError } from "./treatment.mjs";
import { findDwebp, findImg2webp } from "./webp.mjs";

export const COVER_DIR = "cover";
export const COVER_OUTPUTS = Object.freeze(["cover.webp", "cover.gif", "poster.png", "manifest.json", "gate-report.txt"]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pad4 = (n) => String(n).padStart(4, "0");
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** Display time of one frame in whole milliseconds, as img2webp stores it. */
export const frameMs = (fps) => Math.round(1000 / fps);

/** Loop times on the master grid: frame i shows t = i / N, so t = 1 (a copy of frame 0) is never drawn. */
export const loopTimes = (frames) => Array.from({ length: frames }, (_, i) => [i, i / frames]);

/** The decoded frame on screen at `ms`, given per-frame durations. */
export function frameAt(durations, ms) {
	let end = 0;
	for (let i = 0; i < durations.length; i++) {
		end += durations[i];
		if (ms < end) return i;
	}
	return durations.length - 1;
}

/** img2webp arguments: lossy, loop forever, default keyframes, frame 0 and the last `edgeFrames` at `edgeQ`. */
export function img2webpArgs({ files, fps, encode, out }) {
	const args = ["-loop", "0", "-lossy", "-q", String(encode.q), "-m", String(encode.method)];
	files.forEach((file, i) => args.push("-d", String(frameMs(fps)), "-q", String(i === 0 || i >= files.length - encode.edgeFrames ? encode.edgeQ : encode.q), file));
	return [...args, "-o", out];
}

/** The encoder this host offers: img2webp with dwebp (the gate decodes with it), else gifski, else exit 21. */
export function coverEncoder(env = process.env) {
	const img2webp = findImg2webp(env);
	const dwebp = findDwebp(env);
	if (img2webp && dwebp) return { kind: "img2webp", path: img2webp };
	const gifski = which("gifski", env);
	if (gifski) return { kind: "gifski", path: gifski };
	throw new Exit(EXIT.BLOCKED_NO_COVER_ENCODER, "BLOCKED_NO_COVER_ENCODER: install libwebp (img2webp and dwebp) or gifski; a cover is never an MP4, because a README does not autoplay video");
}

/** Encode the frames into `<outDir>/cover.webp` (or cover.gif). */
export function encodeCover({ files, fps, encode, outDir, env = process.env }) {
	const encoder = coverEncoder(env);
	const file = join(outDir, encoder.kind === "img2webp" ? "cover.webp" : "cover.gif");
	const args = encoder.kind === "img2webp" ? img2webpArgs({ files, fps, encode, out: file }) : ["--fps", String(fps), "--quality", "90", "--repeat", "0", "-o", file, ...files];
	const run = spawnSync(encoder.path, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env });
	if (run.status !== 0) throw new Error(`${encoder.kind} failed: ${(run.stderr || run.error?.message || `exit ${run.status}`).trim().split("\n").pop()}`);
	return { file, encoder: encoder.kind };
}

/** A seeded shuffle (mulberry32, as the loop kit's rng) of `count` distinct frame indices. */
export function seekOrder(frames, seed, count = COVER.seekFrames) {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let x = Math.imul(state ^ (state >>> 15), 1 | state);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
	const order = Array.from({ length: frames }, (_, i) => i);
	for (let i = frames - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order.slice(0, Math.min(count, frames));
}

/** The largest per-channel difference between two same-size PNG frames (255 when the sizes differ). */
export function maxLevelDiff(fileA, fileB) {
	const a = readPngRgba(fileA);
	const b = readPngRgba(fileB);
	if (a.width !== b.width || a.height !== b.height) return 255;
	let max = 0;
	for (let i = 0; i < a.rgba.length; i++) max = Math.max(max, Math.abs(a.rgba[i] - b.rgba[i]));
	return max;
}

/** Everything a cover round checks before the first capture: treatment, page, assets, runtime, fonts. */
function prepare(outDir) {
	let treatment;
	try {
		treatment = loadCoverTreatment(outDir);
	} catch (error) {
		if (error instanceof TreatmentError) throw new Exit(EXIT.BLOCKED_TREATMENT_INVALID, `BLOCKED_TREATMENT_INVALID: ${error.message}`);
		throw error;
	}
	const coverDir = join(outDir, COVER_DIR);
	if (!existsSync(join(coverDir, "index.html"))) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: no cover/index.html in ${outDir}; write the cover page first (references/cover.md)`);
	const scan = scanStage(coverDir);
	const { assets } = checkAssets({ outDir, treatment, files: scan.files, coverDir: COVER_DIR });
	const runtime = resolveRuntime();
	if (!runtime.deps.ready) throw new Exit(EXIT.BLOCKED_DEPS_NOT_PREWARMED, `BLOCKED_DEPS_NOT_PREWARMED: ${runtime.deps.missing.join("; ")}. Run \`${INSTALL_COMMAND}\` outside the sandboxed session, then rerun.`);
	stageFontFaults(verifyFonts(FONTS.map((f) => f.key), runtime.dir));
	return { treatment, scan, assets, runtime, fonts: fontRoutes(runtime.dir) };
}

/** The cover stills (frames decoded from the encoded file): twelve sheet frames, the poster and the seam pair. */
function writeCoverStills({ outDir, durations, kept, width, height }) {
	const dir = join(outDir, "stills");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const total = durations.reduce((a, b) => a + b, 0);
	const files = [];
	const put = (name, bytes, entry) => {
		writeFileSync(join(dir, name), bytes);
		files.push({ file: name, sha256: sha256(bytes), ...entry });
	};
	const tiles = [];
	for (let k = 0; k < COVER.sheetTiles; k++) {
		const t = k / COVER.sheetTiles;
		const frame = frameAt(durations, t * total);
		put(`frame-${String(k).padStart(2, "0")}.png`, encodePng(width, height, kept.get(frame), 4, 6), { kind: "frame", t: Number(t.toFixed(4)), frame });
		tiles.push({ rgba: kept.get(frame), width, height, caption: `t=${t.toFixed(3)}  frame ${frame}` });
	}
	const last = durations.length - 1;
	put("poster.png", encodePng(width, height, kept.get(0), 4, 6), { kind: "poster", frame: 0 });
	const pair = Buffer.alloc(width * 2 * height * 4);
	for (let y = 0; y < height; y++) {
		pair.set(kept.get(last).subarray(y * width * 4, (y + 1) * width * 4), y * width * 8);
		pair.set(kept.get(0).subarray(y * width * 4, (y + 1) * width * 4), y * width * 8 + width * 4);
	}
	put("seam.png", encodePng(width * 2, height, pair, 4, 6), { kind: "seam", frames: [last, 0] });
	return { dir, files, tiles };
}

/**
 * Render one cover round. Returns the exit code: 0 when the decoded cover reaches every TARGET gate,
 * 13 when a gate misses TARGET or FLOOR or the flash audit fails (the cover is then withheld).
 */
export async function renderCover({ outDir, round, log = () => {}, env = process.env }) {
	if (!Number.isInteger(round) || round < 1 || round > 3) throw new Exit(EXIT.USAGE, "--round must be 1..3");
	const { treatment, scan, assets, runtime, fonts } = prepare(outDir);
	coverEncoder(env);
	for (const name of COVER_OUTPUTS) rmSync(join(outDir, name), { force: true });
	rmSync(join(outDir, "withheld"), { recursive: true, force: true });
	const [pw, ph] = treatment.page;
	const size = treatment.size;
	const runDir = join(outDir, ".run", "cover");
	rmSync(runDir, { recursive: true, force: true });
	const dirs = { frames: join(runDir, "frames"), masks: join(runDir, "masks"), replay: join(runDir, "replay"), seek: join(runDir, "seek") };
	for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
	const times = loopTimes(treatment.frames);
	const order = seekOrder(times.length, treatment.seed);
	const started = Date.now();
	const pool = new CoverPool();
	let master;
	let replay;
	let sought;
	// The 3D hero asks for the GPU rung. When it cannot start or draw there, all three passes take the
	// software rung (they must share one) and the report says so.
	let rung = treatment.recipe === "hero-3d" ? "gpu" : "software";
	const notices = [];
	try {
		const pass = async (label, work) => {
			const open = () => CoverSession.open({ runtime, scan, fonts, width: pw, height: ph, scale: COVER.captureScale, profileDir: join(runDir, `chrome-${label}`), rung, env });
			let session;
			try {
				session = await open();
			} catch (error) {
				if (rung !== "gpu" || error instanceof Exit) throw error;
				notices.push(`the 3D hero asked for the GPU rung and it did not start (${firstLine(String(error.message)).slice(0, 120)}); rendered on the software rung (SwiftShader), slower, same frames`);
				rung = "software";
				session = await open();
			}
			try {
				return await work(session);
			} finally {
				await session.close();
			}
		};
		master = await pass("master", async (session) => {
			const hashes = await capturePass({ session, pool, times, dir: dirs.frames, size });
			log(`cover: ${times.length} frames captured at ${pw * COVER.captureScale}x${ph * COVER.captureScale} and downsampled to ${size.join("x")}`);
			await capturePass({ session, pool, times, dir: dirs.masks, prefix: "m", mask: true, size });
			return hashes;
		});
		replay = await pass("replay", (session) => capturePass({ session, pool, times, dir: dirs.replay, size }));
		sought = await pass("seek", (session) => capturePass({ session, pool, times: order.map((i) => times[i]), dir: dirs.seek, prefix: "s", size }));
	} finally {
		await pool.close();
	}
	const captureSec = (Date.now() - started) / 1000;
	const ms = frameMs(treatment.fps);
	const differing = times.filter(([i]) => master.get(i) !== replay.get(i)).map(([i, t]) => `frame ${i} (t = ${t.toFixed(4)})`);
	if (differing.length) throw new Exit(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: a fresh capture differs at ${differing.slice(0, 4).join(", ")}${differing.length > 4 ? ` (+${differing.length - 4})` : ""}; draw every pixel from t and LitLoop.rng(seed)`);
	// A sought frame within one level per channel of the master is the software rasterizer's own
	// rounding (opacity and transform changing together depend on what was painted before); state kept
	// between frames differs by far more.
	let oneLevel = 0;
	for (const [k, i] of order.entries()) {
		if (sought.get(i) === master.get(i)) continue;
		const levels = maxLevelDiff(join(dirs.frames, `f${pad4(i)}.png`), join(dirs.seek, `s${pad4(i)}.png`));
		if (levels <= COVER.seekLevels) {
			oneLevel++;
			continue;
		}
		throw new Exit(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: frame ${i} (t = ${((i * ms) / 1000).toFixed(3)} s) differs by up to ${levels} levels when sought out of order (a fresh page drew it ${k ? `after frame ${order[k - 1]}` : "first"}); the page keeps state between frames: clear every canvas and draw each frame from t alone`);
	}

	const files = frameFiles(dirs.frames, "f");
	const [cw, ch] = size;
	const flash = countFlashes(await detectLoopingStream(files.length, cw, ch, async (i) => readPngRgba(files[i]).rgba), treatment.fps, true);
	const encoded = encodeCover({ files, fps: treatment.fps, encode: treatment.encode, outDir, env });
	const planned = times.length * ms;
	const wanted = Array.from({ length: COVER.sheetTiles }, (_, k) => (k / COVER.sheetTiles) * planned);
	let elapsed = 0;
	const keep = (i, dur) => {
		const start = elapsed;
		elapsed += dur;
		return i === 0 || start + dur >= planned || wanted.some((x) => x >= start && x < start + dur);
	};
	const painted = treatment.title.kind === "painted" ? assets.find((a) => a.role === "base-art" && a.title) : null;
	const gate = coverGate(encoded.file, { frames: dirs.frames, frames2: dirs.replay, masks: dirs.masks, title: treatment.title.box, glyph: { exempt: painted ? `painted into the base art ${painted.path}` : null }, fps: treatment.fps, keep, env });
	gate.gates.SEEK = { pass: true, sampled: order.length, identical: order.length - oneLevel, oneLevel };
	for (const asset of assets.filter((a) => a.role === "base-art")) {
		const art = readRaster(join(outDir, asset.path), env);
		const check = art ? artCheck({ frame0: gate.kept.get(0), width: gate.width, height: gate.height, art, box: asset.box, checkBox: asset.checkBox }) : null;
		gate.gates.ART = check ? { pass: check.pass, ssim: check.ssim, checked: check.checked.join(",") } : { pass: false, reason: `${asset.path} could not be decoded to compare with frame 0` };
	}
	gate.gates.FLASH = { pass: flash.pass, generalFlashes: flash.general.flashes, redFlashes: flash.red.flashes, worstStartFrame: flash.general.startFrame };
	gate.pass = Object.values(gate.gates).every((g) => g.pass !== false);
	gate.target = gate.pass && Object.values(gate.gates).every((g) => g.target !== false);

	const stills = writeCoverStills({ outDir, durations: gate.durations, kept: gate.kept, width: gate.width, height: gate.height });
	const status = Object.entries(gate.gates).map(([k, g]) => `${k}:${g.pass === false ? "FAIL" : g.target === false ? "floor" : "ok"}`).join("  ");
	const sheetFile = join(stills.dir, "sheet.png");
	await renderSheet({
		file: sheetFile,
		tiles: stills.tiles,
		diffs: gate.diffs,
		medianD: gate.medianD,
		durationSec: gate.durationSec,
		label: `median d ${gate.medianD.toFixed(5)} | moving ${(100 * gate.movingFrac).toFixed(0)}% | longest still ${gate.longestStillSec.toFixed(2)} s | spike ${gate.spike.toFixed(1)} | seam ${gate.seamLocal.toFixed(2)}x local | ${(gate.bytes / 1048576).toFixed(2)} MiB`,
		status,
		runtime,
		workDir: join(runDir, "sheet"),
		env,
	});
	const sheetBytes = readFileSync(sheetFile);
	stills.files.push({ file: "sheet.png", sha256: sha256(sheetBytes), kind: "sheet" });
	const stillsManifest = `${JSON.stringify({ schema: 1, kind: "cover", mode: "cover", round, width: gate.width, height: gate.height, fps: treatment.fps, durationSec: gate.sourceDurationSec, files: stills.files }, null, 2)}\n`;
	writeFileSync(join(stills.dir, "manifest.json"), stillsManifest);
	writeFileSync(join(outDir, "poster.png"), readFileSync(join(stills.dir, "poster.png")));
	const report = `${formatCoverReport(gate, { strict: true })}${notices.map((n) => `warning: ${n}\n`).join("")}`;
	writeFileSync(join(outDir, "gate-report.txt"), report);
	const manifest = {
		schemaVersion: 1,
		path: "cover",
		mode: "cover",
		round,
		recipe: treatment.recipe,
		rung,
		warnings: notices,
		treatmentSha256: sha256(readFileSync(join(outDir, "treatment.json"))),
		stillsManifestSha256: sha256(stillsManifest),
		page: treatment.page,
		size,
		scale: COVER.captureScale,
		fps: treatment.fps,
		frames: times.length,
		frameMs: ms,
		encoder: encoded.encoder,
		encode: treatment.encode,
		file: basename(encoded.file),
		bytes: statSync(encoded.file).size,
		captureSec: Math.round(captureSec * 10) / 10,
		gate: { verdict: verdictOf(gate), pass: gate.pass, target: gate.target, medianD: gate.medianD, movingFrac: gate.movingFrac, longestStillSec: gate.longestStillSec, spike: gate.spike, seamLocal: gate.seamLocal, gates: gate.gates },
		generatedAt: new Date().toISOString(),
	};
	writeJson(join(outDir, "manifest.json"), manifest);
	if (!flash.pass) {
		mkdirSync(join(outDir, "withheld"), { recursive: true });
		renameSync(encoded.file, join(outDir, "withheld", basename(encoded.file)));
		rmSync(join(outDir, "poster.png"), { force: true });
	}
	log(report.trimEnd());
	log(`cover: ${manifest.file} ${manifest.bytes} bytes, ${times.length} frames at ${treatment.fps} fps, ${size.join("x")}, captured in ${captureSec.toFixed(0)} s; stills and sheet in ${stills.dir}`);
	if (gate.target) return EXIT.OK;
	const missed = Object.entries(gate.gates).filter(([, g]) => g.pass === false || g.target === false).map(([k]) => k);
	throw new Exit(EXIT.GATE_FAIL_QA, `GATE_FAIL_QA: ${missed.join(", ")} ${gate.pass ? "miss the cover TARGET" : "fail"}${flash.pass ? "" : "; the flash audit failed, so the cover is withheld in withheld/"}. Fix the cause and render round ${Math.min(3, round + 1)}; never raise a number, shorten the loop or drop a layer to pass. Report: ${join(outDir, "gate-report.txt")}`);
}

/**
 * `--window t0,t1` (seconds into the loop): capture only the frames from t0 - 0.5 s to t1 + 0.5 s
 * (wrapping at the seam) in a fresh page and sheet them with the span shaded. It reads the same
 * treatment, page and asset list as a full render and writes only under windows/round-N/; stills,
 * cover file, report and manifest stay untouched, so a window render never counts as done.
 */
export async function renderCoverWindow({ outDir, round, window: [t0, t1], log = () => {}, env = process.env }) {
	const { treatment, scan, runtime, fonts } = prepare(outDir);
	const ms = frameMs(treatment.fps);
	const total = (treatment.frames * ms) / 1000;
	if (!(Number.isFinite(t0) && Number.isFinite(t1) && t0 >= 0 && t1 >= t0 && t1 <= total)) throw new Exit(EXIT.USAGE, `--window takes t0,t1 in seconds with 0 <= t0 <= t1 <= ${total.toFixed(3)}`);
	const lo = t0 - COVER.windowPadSec;
	const hi = t1 + COVER.windowPadSec;
	const picks = [];
	for (let i = 0; i < treatment.frames; i++)
		for (const lap of [-1, 0, 1]) {
			const t = (i * ms) / 1000 + lap * total;
			if (t >= lo - 1e-9 && t <= hi + 1e-9) picks.push({ index: i, t: Number(t.toFixed(3)) });
		}
	picks.sort((a, b) => a.t - b.t);
	const dir = join(outDir, "windows", `round-${round}`, `${t0.toFixed(3)}-${t1.toFixed(3)}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const size = treatment.size;
	const pool = new CoverPool();
	const session = await CoverSession.open({ runtime, scan, fonts, width: treatment.page[0], height: treatment.page[1], scale: COVER.captureScale, profileDir: join(outDir, ".run", "cover-window-chrome"), rung: treatment.recipe === "hero-3d" ? "gpu" : "software", env });
	try {
		await capturePass({ session, pool, times: [...new Set(picks.map((p) => p.index))].map((i) => [i, i / treatment.frames]), dir, size });
	} finally {
		await session.close();
		await pool.close();
	}
	const frames = picks.map((p) => readPngRgba(join(dir, `f${pad4(p.index)}.png`)));
	const lumas = frames.map((f) => lumaGrid(f.rgba, f.width, f.height).luma);
	const diffs = lumas.slice(1).map((l, k) => l.reduce((sum, v, i) => sum + Math.abs(v - lumas[k][i]), 0) / l.length / 255);
	const sorted = [...diffs].sort((a, b) => a - b);
	const count = Math.min(COVER.sheetTiles, picks.length);
	const tiles = Array.from({ length: count }, (_, k) => Math.round((k * (picks.length - 1)) / Math.max(1, count - 1))).map((p) => ({ ...frames[p], caption: `t=${picks[p].t.toFixed(3)} s  frame ${picks[p].index}` }));
	await renderSheet({
		file: join(dir, "sheet.png"),
		tiles,
		diffs,
		medianD: sorted.length ? sorted[sorted.length >> 1] : 0,
		durationSec: hi - lo,
		marks: [{ t0: t0 - lo, t1: t1 - lo }],
		label: `window ${t0.toFixed(3)}-${t1.toFixed(3)} s (shaded) with ${COVER.windowPadSec} s on each side | ${picks.length} frames before encoding`,
		status: "a window render never counts as done",
		runtime,
		workDir: join(outDir, ".run", "cover-window-sheet"),
		env,
	});
	writeJson(join(dir, "window.json"), { schema: 1, round, t0, t1, padSec: COVER.windowPadSec, frames: picks, note: "frames before encoding; a window render never counts as done" });
	log(`window round ${round}: ${picks.length} frames from ${lo.toFixed(3)} to ${hi.toFixed(3)} s; sheet: ${join(dir, "sheet.png")}`);
	log("a window render never counts as done: fix the cause, then render the full cover");
	return EXIT.OK;
}
