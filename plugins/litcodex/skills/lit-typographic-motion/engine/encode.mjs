// Encoding shared by both render paths: the pinned x264 master arguments, the ffprobe reader, the
// MO-A-38 preview ladder (keyed on the long edge, so a 9:16 film previews at 540x960) and a pipe
// reader that joins chunks once per frame instead of re-copying the whole buffer on every chunk.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, Exit, OUTPUT, PREVIEW } from "./constants.mjs";
import { detectLoopingStream } from "./flash.mjs";
import { flashFailed } from "./gate.mjs";
import { decodePng, encodePng } from "./image.mjs";
import { ffmpegProbe, firstLine } from "./runtime.mjs";

export function requireFfmpeg() {
	const probe = ffmpegProbe();
	if (!probe.ok) throw new Exit(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, "BLOCKED_NO_FFMPEG_FOR_VIDEO: ffmpeg not found on PATH. Stills and the contact sheet are written (--stills-only works); install ffmpeg for the film, preview and poster.");
	if (!probe.ffprobe) throw new Exit(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, "BLOCKED_NO_FFMPEG_FOR_VIDEO: ffprobe not found next to ffmpeg; the gate needs it for MO-C-10..12.");
	return probe;
}

/**
 * The pinned master encode. `audio`, when given, is a WAV already padded or trimmed to the video's
 * exact length, so no -shortest is needed and a short track never truncates the picture.
 */
export function encoderArgs(size, fps, output, audio) {
	const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${size[0]}x${size[1]}`, "-r", String(fps), "-i", "pipe:0"];
	if (audio) args.push("-i", audio);
	args.push("-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "grain", "-x264-params", "aq-mode=3", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv");
	if (audio) args.push("-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "256k");
	args.push("-movflags", "+faststart", output);
	return args;
}

/** Video and (when present) audio stream facts from ffprobe; null when the file is unreadable. */
export function ffprobe(path) {
	const probe = ffmpegProbe();
	if (!probe.ffprobe) return null;
	const result = spawnSync(probe.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate,pix_fmt,color_space,color_range,color_transfer,color_primaries,duration,sample_rate,channels:format=duration", "-of", "json", path], { encoding: "utf8" });
	if (result.status !== 0) return null;
	const data = JSON.parse(result.stdout);
	const stream = data.streams?.find((s) => s.codec_type === "video") ?? {};
	const audio = data.streams?.find((s) => s.codec_type === "audio") ?? null;
	const [num, den] = String(stream.r_frame_rate ?? "0/1").split("/").map(Number);
	return {
		width: stream.width,
		height: stream.height,
		fps: den ? num / den : 0,
		duration: Number(data.format?.duration ?? 0),
		videoDuration: Number(stream.duration ?? data.format?.duration ?? 0),
		pixFmt: stream.pix_fmt,
		colorSpace: stream.color_space,
		colorRange: stream.color_range,
		colorTransfer: stream.color_transfer,
		colorPrimaries: stream.color_primaries,
		audio: audio ? { duration: Number(audio.duration ?? 0), sampleRate: Number(audio.sample_rate ?? 0), channels: Number(audio.channels ?? 0) } : null,
	};
}

export function ffprobeSafe(path) {
	try {
		return ffprobe(path);
	} catch {
		return null;
	}
}

/** Read fixed-size frames from a stream; chunks are kept in a list and joined once per frame. */
export async function readRgbaStream(stream, frameBytes, onFrame) {
	let parts = [];
	let have = 0;
	let index = 0;
	for await (const chunk of stream) {
		parts.push(chunk);
		have += chunk.length;
		while (have >= frameBytes) {
			const joined = parts.length === 1 ? parts[0] : Buffer.concat(parts, have);
			await onFrame(joined.subarray(0, frameBytes), index++);
			const rest = joined.subarray(frameBytes);
			parts = rest.length ? [rest] : [];
			have = rest.length;
		}
	}
	return index;
}

const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** Preview dimensions for a long-edge rung, keeping the master's aspect. */
export function previewSize(frame, long) {
	const [w, h] = frame;
	return w >= h ? [long, even((long * h) / w)] : [even((long * w) / h), long];
}

/**
 * MO-A-38 ladders: encoder rung by availability, size rung by the 3 MB cap; audits the exact frames.
 * `runDir/preview-src/%05d.png` holds the master decimated to 30 fps at the first rung's size.
 */
export async function buildPreview({ runDir, ffmpeg, previewCount, frame, minGlyph = 28 }) {
	const src = join(runDir, "preview-src");
	const work = join(runDir, "preview-rung");
	const srcLong = Math.max(frame[0], frame[1]);
	const rungs = [];
	for (const long of PREVIEW.widths) for (const fps of PREVIEW.fps) if (minGlyph * (long / srcLong) >= PREVIEW.minGlyphPx) rungs.push({ long, fps });
	let smallest = null;
	for (const rung of rungs) {
		rmSync(work, { recursive: true, force: true });
		mkdirSync(work, { recursive: true });
		const [width, height] = previewSize(frame, rung.long);
		const first = rung.long === PREVIEW.widths[0] && rung.fps === PREVIEW.fps[0];
		let count = previewCount;
		if (!first) {
			const scaler = spawn(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-framerate", String(PREVIEW.fps[0]), "-i", join(src, "%05d.png"), "-vf", `fps=${rung.fps},scale=${width}:${height}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
			count = await readRgbaStream(scaler.stdout, width * height * 4, (bytes, i) => writeFileSync(join(work, `${String(i).padStart(5, "0")}.png`), encodePng(width, height, bytes, 4, 3)));
			await new Promise((done) => scaler.on("close", done));
		}
		const dir = first ? src : work;
		const names = Array.from({ length: count }, (_, i) => join(dir, `${String(i).padStart(5, "0")}.png`));
		const target = join(runDir, ffmpeg.previewEncoder === "gif" ? "preview.gif" : "preview.webp");
		rmSync(target, { force: true });
		let result;
		if (ffmpeg.previewEncoder === "libwebp_anim") result = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(rung.fps), "-i", join(dir, "%05d.png"), "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(PREVIEW.webpQuality), "-loop", "0", target], { encoding: "utf8" });
		else if (ffmpeg.previewEncoder === "img2webp") result = spawnSync(ffmpeg.img2webp, ["-loop", "0", "-lossy", "-q", String(PREVIEW.webpQuality), "-d", String(Math.round(1000 / rung.fps)), ...names, "-o", target], { encoding: "utf8", maxBuffer: 1 << 26 });
		else result = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(rung.fps), "-i", join(dir, "%05d.png"), "-vf", "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", target], { encoding: "utf8" });
		if (result.status !== 0 || !existsSync(target)) throw new Error(`preview encoder ${ffmpeg.previewEncoder} failed: ${firstLine(result.stderr || result.error?.message || "")}`);
		const bytes = statSync(target).size;
		smallest = !smallest || bytes < smallest.bytes ? { ...rung, width, height, bytes } : smallest;
		if (bytes <= OUTPUT.previewMaxBytes || rung === rungs[rungs.length - 1]) {
			const records = await detectLoopingStream(count, width, height, async (i) => decodePng(readFileSync(names[i])).pixels);
			rmSync(work, { recursive: true, force: true });
			rmSync(src, { recursive: true, force: true });
			return { target, bytes, rung: { ...rung, width, height }, records, encoder: ffmpeg.previewEncoder, fit: bytes <= OUTPUT.previewMaxBytes, smallest };
		}
	}
	throw new Error("no preview rung is allowed by the 10 px glyph floor");
}

// ------------------------------------------------------------------------------ exports

export function exportPaths(outDir, manifest) {
	const previewName = manifest.previewEncoder === "gif" ? "preview.gif" : "preview.webp";
	return { mp4: "film.mp4", preview: previewName, poster: "poster.png", still: "reduced-motion.png" };
}

export function locate(outDir, name) {
	for (const dir of [join(outDir, ".run"), outDir, join(outDir, "withheld")]) if (existsSync(join(dir, name))) return join(dir, name);
	return null;
}

/** Promote on PASS or a non-flash FAIL; withhold every export on an MO-C-03 FAIL (MO-C-16). */
export function promote(outDir, manifest, rules) {
	const names = Object.values(exportPaths(outDir, manifest));
	const withhold = flashFailed(rules);
	const withheld = join(outDir, "withheld");
	if (withhold) mkdirSync(withheld, { recursive: true });
	for (const name of names) {
		const current = locate(outDir, name);
		if (!current) continue;
		const target = withhold ? join(withheld, name) : join(outDir, name);
		if (current !== target) renameSync(current, target);
	}
	if (!withhold) rmSync(withheld, { recursive: true, force: true });
	return withhold;
}

