// Animated WebP, decoded the way a browser shows it, with no npm dependency: the RIFF container is
// parsed here (canvas size, loop count, and every ANMF frame's rectangle, duration, blend and dispose
// flags), each frame's own bitstream is wrapped as a standalone still and decoded by the host's
// `dwebp` (libwebp ships it with img2webp), and the stills are composited onto one canvas in order.
// The cover gate reads the encoded file through this, because a lossy animation encoder skips small
// changes and only the decoded file shows what it skipped.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { which } from "./runtime.mjs";

export const findImg2webp = (env = process.env) => which("img2webp", env);
export const findDwebp = (env = process.env) => which("dwebp", env);

const u24 = (bytes, o) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);

/** The container: { width, height, loop, animated, frames: [{ x, y, w, h, durationMs, blend, dispose, data, still }] }. */
export function parseWebp(bytes) {
	if (bytes.length < 16 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") throw new Error("not a WebP file");
	const out = { width: 0, height: 0, loop: null, animated: false, frames: [] };
	const end = Math.min(bytes.length, 8 + bytes.readUInt32LE(4));
	for (let o = 12; o + 8 <= end; ) {
		const type = bytes.toString("latin1", o, o + 4);
		const size = bytes.readUInt32LE(o + 4);
		const body = bytes.subarray(o + 8, o + 8 + size);
		if (type === "VP8X") {
			out.animated = (body[0] & 0x02) !== 0;
			out.width = 1 + u24(body, 4);
			out.height = 1 + u24(body, 7);
		} else if (type === "ANIM") out.loop = body.readUInt16LE(4);
		else if (type === "ANMF")
			out.frames.push({ x: 2 * u24(body, 0), y: 2 * u24(body, 3), w: 1 + u24(body, 6), h: 1 + u24(body, 9), durationMs: u24(body, 12), blend: (body[15] & 0x02) === 0, dispose: (body[15] & 0x01) !== 0, data: body.subarray(16), still: false });
		else if ((type === "VP8 " || type === "VP8L") && out.frames.length === 0) out.frames.push({ x: 0, y: 0, w: 0, h: 0, durationMs: 0, blend: false, dispose: false, data: bytes.subarray(o, o + 8 + size + (size & 1)), still: true });
		o += 8 + size + (size & 1);
	}
	if (!out.animated && out.frames.length === 1 && out.loop === null) out.loop = 0;
	return out;
}

/** One ANMF payload (an optional ALPH chunk, then VP8 or VP8L) as a standalone still WebP. */
function asStill(frame, header) {
	if (frame.still) return Buffer.concat([header, frame.data]);
	const alpha = frame.data.toString("latin1", 0, 4) === "ALPH";
	const chunks = [frame.data];
	if (alpha) {
		const vp8x = Buffer.alloc(18);
		vp8x.write("VP8X", 0, "latin1");
		vp8x.writeUInt32LE(10, 4);
		vp8x[8] = 0x10;
		vp8x.writeUIntLE(frame.w - 1, 12, 3);
		vp8x.writeUIntLE(frame.h - 1, 15, 3);
		chunks.unshift(vp8x);
	}
	const riff = Buffer.alloc(12);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(4 + chunks.reduce((n, c) => n + c.length, 0), 4);
	riff.write("WEBP", 8, "latin1");
	return Buffer.concat([riff, ...chunks]);
}

/** A PAM image (P7) as dwebp writes it: { width, height, rgba }. */
export function readPam(buffer) {
	const end = buffer.indexOf("ENDHDR\n");
	if (buffer.toString("latin1", 0, 2) !== "P7" || end < 0) throw new Error("not a PAM image");
	const head = buffer.toString("latin1", 0, end);
	const field = (name) => Number(new RegExp(`${name} (\\d+)`, "u").exec(head)?.[1]);
	const width = field("WIDTH");
	const height = field("HEIGHT");
	const depth = field("DEPTH");
	const data = buffer.subarray(end + 7);
	if (depth === 4) return { width, height, rgba: data };
	const rgba = Buffer.alloc(width * height * 4, 255);
	for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = data[i * depth + c];
	return { width, height, rgba };
}

/** Composite one decoded frame: non-premultiplied alpha blend (as libwebp's demuxer) or a plain copy. */
function composite(canvas, canvasWidth, frame, rgba) {
	for (let y = 0; y < frame.h; y++)
		for (let x = 0; x < frame.w; x++) {
			const s = (y * frame.w + x) * 4;
			const d = ((frame.y + y) * canvasWidth + frame.x + x) * 4;
			const sa = rgba[s + 3];
			if (!frame.blend || sa === 255) {
				canvas[d] = rgba[s];
				canvas[d + 1] = rgba[s + 1];
				canvas[d + 2] = rgba[s + 2];
				canvas[d + 3] = sa;
			} else if (sa > 0) {
				const under = (canvas[d + 3] * (255 - sa)) / 255;
				const alpha = sa + under;
				for (let c = 0; c < 3; c++) canvas[d + c] = Math.round((rgba[s + c] * sa + canvas[d + c] * under) / alpha);
				canvas[d + 3] = Math.round(alpha);
			}
		}
}

/**
 * Decode every frame of `file`. `onFrame(index, rgba, durationMs, width, height)` sees the composited
 * canvas, which is reused between calls (copy what you keep). Returns { width, height, loop, durations,
 * bytes, frames }.
 */
export function decodeWebp(file, { env = process.env, onFrame = () => {} } = {}) {
	const dwebp = findDwebp(env);
	if (!dwebp) throw new Error("dwebp not found on PATH (libwebp ships it with img2webp)");
	const bytes = readFileSync(file);
	const info = parseWebp(bytes);
	if (!info.frames.length) throw new Error(`${file} holds no frames`);
	const work = mkdtempSync(join(tmpdir(), "litcodex-webp-"));
	try {
		let width = info.width;
		let height = info.height;
		let canvas = null;
		let previous = null;
		const durations = [];
		info.frames.forEach((frame, i) => {
			const src = join(work, "frame.webp");
			const pam = join(work, "frame.pam");
			writeFileSync(src, asStill(frame, bytes.subarray(0, 12)));
			const run = spawnSync(dwebp, [src, "-pam", "-quiet", "-o", pam], { encoding: "utf8", env });
			if (run.status !== 0) throw new Error(`dwebp failed on frame ${i}: ${(run.stderr || run.error?.message || "").trim().split("\n")[0]}`);
			const decoded = readPam(readFileSync(pam));
			if (frame.still) {
				width = decoded.width;
				height = decoded.height;
				Object.assign(frame, { w: width, h: height });
			}
			canvas ??= Buffer.alloc(width * height * 4);
			if (previous?.dispose) for (let y = previous.y; y < previous.y + previous.h; y++) canvas.fill(0, (y * width + previous.x) * 4, (y * width + previous.x + previous.w) * 4);
			composite(canvas, width, frame, decoded.rgba);
			durations.push(frame.durationMs);
			onFrame(i, canvas, frame.durationMs, width, height);
			previous = frame;
		});
		return { width, height, loop: info.loop, durations, bytes: statSync(file).size, frames: info.frames.length };
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}
