// Frame-byte utilities for the Node side: sha256 over exact RGBA bytes (MO-C-09), a dependency-free
// PNG encoder, area downscaling, per-pixel luminance percentiles, and contact-sheet assembly.
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

export const rgbaSha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const CRC = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(buffers) {
	let c = 0xffffffff;
	for (const buffer of buffers) for (let i = 0; i < buffer.length; i++) c = CRC[(c ^ buffer[i]) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "ascii");
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc32([head.subarray(4), data]), 0);
	return Buffer.concat([head, data, tail]);
}

/**
 * Encode 8-bit pixels as PNG. `channels` is 4 (RGBA input written as RGB), 3 (RGB) or 1 (grey).
 * Rows use the per-row filter with the smallest absolute sum, which keeps clean frames small.
 */
export function encodePng(width, height, pixels, channels = 4, level = 9) {
	const out = channels === 1 ? 1 : 3;
	const stride = width * out;
	const raw = Buffer.alloc((stride + 1) * height);
	const row = Buffer.alloc(stride);
	const prev = Buffer.alloc(stride);
	const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const src = (y * width + x) * channels;
			if (out === 1) row[x] = pixels[src];
			else {
				row[x * 3] = pixels[src];
				row[x * 3 + 1] = pixels[src + 1];
				row[x * 3 + 2] = pixels[src + 2];
			}
		}
		let best = 0;
		let bestSum = Number.POSITIVE_INFINITY;
		for (let type = 0; type < 5; type++) {
			const line = candidates[type];
			let sum = 0;
			for (let i = 0; i < stride; i++) {
				const a = i >= out ? row[i - out] : 0;
				const b = prev[i];
				const c = i >= out ? prev[i - out] : 0;
				let predicted = 0;
				if (type === 1) predicted = a;
				else if (type === 2) predicted = b;
				else if (type === 3) predicted = (a + b) >> 1;
				else if (type === 4) {
					const p = a + b - c;
					const pa = Math.abs(p - a);
					const pb = Math.abs(p - b);
					const pc = Math.abs(p - c);
					predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
				}
				const value = (row[i] - predicted) & 255;
				line[i] = value;
				sum += value < 128 ? value : 256 - value;
			}
			if (sum < bestSum) {
				bestSum = sum;
				best = type;
			}
		}
		raw[y * (stride + 1)] = best;
		candidates[best].copy(raw, y * (stride + 1) + 1);
		row.copy(prev);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = out === 1 ? 0 : 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level })), chunk("IEND", Buffer.alloc(0))]);
}

/** Area-average RGBA downscale to (dw, dh); exact box filter when the ratio is an integer. */
export function downscale(bytes, width, height, dw, dh) {
	const out = new Uint8Array(dw * dh * 4);
	const sx = width / dw;
	const sy = height / dh;
	for (let y = 0; y < dh; y++) {
		const y0 = y * sy;
		const y1 = y0 + sy;
		for (let x = 0; x < dw; x++) {
			const x0 = x * sx;
			const x1 = x0 + sx;
			let r = 0;
			let g = 0;
			let b = 0;
			let area = 0;
			for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
				const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
				for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
					const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
					const w = wx * wy;
					const i = (yy * width + xx) * 4;
					r += bytes[i] * w;
					g += bytes[i + 1] * w;
					b += bytes[i + 2] * w;
					area += w;
				}
			}
			const o = (y * dw + x) * 4;
			out[o] = Math.round(r / area);
			out[o + 1] = Math.round(g / area);
			out[o + 2] = Math.round(b / area);
			out[o + 3] = 255;
		}
	}
	return out;
}

const LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
	const s = v / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});
export const linearOf = (v) => LINEAR[v];

/** Percentile of per-pixel WCAG relative luminance (1024-bin histogram). */
export function luminancePercentile(bytes, fraction) {
	const bins = new Uint32Array(1024);
	const count = bytes.length / 4;
	for (let i = 0; i < bytes.length; i += 4) {
		const l = 0.2126 * LINEAR[bytes[i]] + 0.7152 * LINEAR[bytes[i + 1]] + 0.0722 * LINEAR[bytes[i + 2]];
		bins[Math.min(1023, Math.floor(l * 1024))]++;
	}
	const target = count * fraction;
	let seen = 0;
	for (let k = 0; k < 1024; k++) {
		seen += bins[k];
		if (seen >= target) return (k + 1) / 1024;
	}
	return 1;
}

// A 3x5 bitmap face for contact-sheet labels only (time and frame numbers); never film type.
const GLYPHS = {
	0: "111101101101111",
	1: "010110010010111",
	2: "111001111100111",
	3: "111001111001111",
	4: "101101111001001",
	5: "111100111001111",
	6: "111100111101111",
	7: "111001010010010",
	8: "111101111101111",
	9: "111101111001111",
	".": "000000000000010",
	s: "000011110011110",
	f: "011010111010010",
	" ": "000000000000000",
	"/": "001001010100100",
};

function label(sheet, sheetWidth, text, x, y, px = 3) {
	let cx = x;
	for (const char of text) {
		const bits = GLYPHS[char] ?? GLYPHS[" "];
		for (let r = 0; r < 5; r++)
			for (let c = 0; c < 3; c++) {
				if (bits[r * 3 + c] !== "1") continue;
				for (let dy = 0; dy < px; dy++)
					for (let dx = 0; dx < px; dx++) {
						const o = ((y + r * px + dy) * sheetWidth + cx + c * px + dx) * 4;
						sheet[o] = 235;
						sheet[o + 1] = 235;
						sheet[o + 2] = 235;
						sheet[o + 3] = 255;
					}
			}
		cx += 4 * px;
	}
}

/** Contact sheet of thumbnails (each already RGBA at tw x th), labelled, `columns` wide. */
export function contactSheet(thumbs, tw, th, columns, labels) {
	const pad = 6;
	const band = 22;
	const rows = Math.ceil(thumbs.length / columns);
	const width = columns * (tw + pad) + pad;
	const height = rows * (th + band + pad) + pad;
	const sheet = new Uint8Array(width * height * 4);
	for (let i = 0; i < sheet.length; i += 4) {
		sheet[i] = 30;
		sheet[i + 1] = 30;
		sheet[i + 2] = 30;
		sheet[i + 3] = 255;
	}
	thumbs.forEach((thumb, k) => {
		const x0 = pad + (k % columns) * (tw + pad);
		const y0 = pad + Math.floor(k / columns) * (th + band + pad);
		label(sheet, width, labels[k], x0 + 2, y0 + 3);
		for (let y = 0; y < th; y++) sheet.set(thumb.subarray(y * tw * 4, (y + 1) * tw * 4), ((y0 + band + y) * width + x0) * 4);
	});
	return { width, height, pixels: sheet };
}

/** Decode an 8-bit, non-interlaced grey/RGB/RGBA PNG (the files this engine writes) to RGBA or grey. */
export function decodePng(buffer) {
	let offset = 8;
	let width = 0;
	let height = 0;
	let colorType = 0;
	const data = [];
	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString("ascii", offset + 4, offset + 8);
		const body = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit non-interlaced PNG is supported");
			colorType = body[9];
		} else if (type === "IDAT") data.push(body);
		else if (type === "IEND") break;
		offset += 12 + length;
	}
	const channels = { 0: 1, 2: 3, 6: 4 }[colorType];
	if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
	const raw = inflateSync(Buffer.concat(data));
	const stride = width * channels;
	const out = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const src = y * (stride + 1) + 1;
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? out[y * stride + i - channels] : 0;
			const b = y > 0 ? out[(y - 1) * stride + i] : 0;
			const c = y > 0 && i >= channels ? out[(y - 1) * stride + i - channels] : 0;
			let predicted = 0;
			if (filter === 1) predicted = a;
			else if (filter === 2) predicted = b;
			else if (filter === 3) predicted = (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[y * stride + i] = (raw[src + i] + predicted) & 255;
		}
	}
	if (channels === 1) return { width, height, channels: 1, pixels: out };
	if (channels === 4) return { width, height, channels: 4, pixels: out };
	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
		rgba[j] = out[i];
		rgba[j + 1] = out[i + 1];
		rgba[j + 2] = out[i + 2];
		rgba[j + 3] = 255;
	}
	return { width, height, channels: 4, pixels: rgba };
}
