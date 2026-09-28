import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { crc32, PNG_SIGNATURE } from "./png-crc.mjs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 64 * 1024 * 1024;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_ALLOCATION = 256 * 1024 * 1024;
const KNOWN_CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

export class PngDecodeError extends Error {
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.name = "PngDecodeError";
		this.code = code;
	}
}

function chunks(buffer) {
	const result = [];
	let offset = 8;
	while (offset < buffer.length) {
		if (offset + 12 > buffer.length) throw new PngDecodeError("PNG_TRUNCATED", "incomplete chunk framing");
		const length = buffer.readUInt32BE(offset);
		const end = offset + 12 + length;
		if (end > buffer.length) throw new PngDecodeError("PNG_TRUNCATED", "declared chunk exceeds input");
		const type = buffer.toString("ascii", offset + 4, offset + 8);
		if (!/^[A-Za-z]{4}$/.test(type)) throw new PngDecodeError("PNG_CHUNK_TYPE_INVALID", type);
		if (/^[A-Z]/.test(type) && !KNOWN_CRITICAL.has(type)) {
			throw new PngDecodeError("PNG_CRITICAL_CHUNK_UNSUPPORTED", type);
		}
		const typedData = buffer.subarray(offset + 4, offset + 8 + length);
		const expected = buffer.readUInt32BE(offset + 8 + length);
		if (crc32(typedData) !== expected) throw new PngDecodeError("PNG_CRC_MISMATCH", type);
		result.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
		offset = end;
		if (type === "IEND") {
			if (offset !== buffer.length) throw new PngDecodeError("PNG_TRAILING_DATA", "bytes after IEND");
			return result;
		}
	}
	throw new PngDecodeError("PNG_TRUNCATED", "missing IEND");
}

function header(chunk) {
	if (chunk.data.length !== 13) throw new PngDecodeError("PNG_HEADER_INVALID", "IHDR length must be 13");
	const width = chunk.data.readUInt32BE(0);
	const height = chunk.data.readUInt32BE(4);
	if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
		throw new PngDecodeError("PNG_RESOURCE_LIMIT", "dimension exceeds 16,384 or 64 megapixels");
	}
	const bitDepth = chunk.data[8];
	const colorType = chunk.data[9];
	if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) throw new PngDecodeError("PNG_FORMAT_UNSUPPORTED", "8-bit grayscale/RGB/GA/RGBA only");
	if (chunk.data[10] !== 0 || chunk.data[11] !== 0 || chunk.data[12] !== 0) throw new PngDecodeError("PNG_FORMAT_UNSUPPORTED", "compression/filter/interlace");
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
	return { width, height, colorType, channels };
}

function paeth(left, above, upperLeft) {
	const estimate = left + above - upperLeft;
	const dl = Math.abs(estimate - left);
	const da = Math.abs(estimate - above);
	const du = Math.abs(estimate - upperLeft);
	return dl <= da && dl <= du ? left : da <= du ? above : upperLeft;
}

function unfilter(filter, source, previous, bytesPerPixel) {
	const row = Buffer.alloc(source.length);
	for (let index = 0; index < source.length; index += 1) {
		const raw = source[index];
		const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
		const above = previous?.[index] ?? 0;
		const upperLeft = index >= bytesPerPixel ? previous?.[index - bytesPerPixel] ?? 0 : 0;
		const predictor = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
		if (predictor === undefined) throw new PngDecodeError("PNG_FILTER_UNSUPPORTED", String(filter));
		row[index] = (raw + predictor) & 0xff;
	}
	return row;
}

function rgbaFromRows(inflated, meta) {
	const rowBytes = meta.width * meta.channels;
	const expected = meta.height * (rowBytes + 1);
	if (inflated.length !== expected) throw new PngDecodeError("PNG_DATA_INVALID", "inflated byte count");
	const rgba = new Uint8Array(meta.width * meta.height * 4);
	let transparent = false;
	let previous;
	for (let y = 0; y < meta.height; y += 1) {
		const start = y * (rowBytes + 1);
		const row = unfilter(inflated[start], inflated.subarray(start + 1, start + 1 + rowBytes), previous, meta.channels);
		for (let x = 0; x < meta.width; x += 1) {
			const source = x * meta.channels;
			const target = (y * meta.width + x) * 4;
			const gray = row[source];
			const values = meta.channels === 1 ? [gray, gray, gray, 255]
				: meta.channels === 2 ? [gray, gray, gray, row[source + 1]]
					: meta.channels === 3 ? [row[source], row[source + 1], row[source + 2], 255]
						: [row[source], row[source + 1], row[source + 2], row[source + 3]];
			rgba.set(values, target);
			if (values[3] < 255) transparent = true;
		}
		previous = row;
	}
	return { rgba, transparent };
}

export function decodePng(input) {
	if (!ArrayBuffer.isView(input)) throw new PngDecodeError("PNG_INPUT_INVALID", "expected byte array");
	if (input.byteLength > MAX_FILE_BYTES) throw new PngDecodeError("PNG_RESOURCE_LIMIT", "file exceeds 25 MiB");
	const buffer = Buffer.isBuffer(input)
		? input
		: Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new PngDecodeError("PNG_SIGNATURE_INVALID", "not PNG");
	const parsed = chunks(buffer);
	if (parsed[0]?.type !== "IHDR" || parsed.at(-1)?.type !== "IEND" || parsed.filter((item) => item.type === "IHDR").length !== 1) {
		throw new PngDecodeError("PNG_CHUNK_ORDER_INVALID", "IHDR/IEND");
	}
	const meta = header(parsed[0]);
	const types = parsed.map((item) => item.type);
	if (types.filter((type) => type === "PLTE").length > 1) {
		throw new PngDecodeError("PNG_CHUNK_ORDER_INVALID", "duplicate PLTE");
	}
	const idatStart = types.indexOf("IDAT");
	const idatEnd = types.lastIndexOf("IDAT");
	if (types.includes("PLTE") && types.indexOf("PLTE") > idatStart) {
		throw new PngDecodeError("PNG_CHUNK_ORDER_INVALID", "PLTE after IDAT");
	}
	const palette = parsed.find((item) => item.type === "PLTE");
	if (palette !== undefined) {
		if ([0, 4].includes(meta.colorType)) {
			throw new PngDecodeError("PNG_FORMAT_UNSUPPORTED", "PLTE is forbidden for grayscale");
		}
		if (palette.data.length === 0 || palette.data.length % 3 !== 0 || palette.data.length > 256 * 3) {
			throw new PngDecodeError("PNG_FORMAT_UNSUPPORTED", "PLTE length is invalid");
		}
	}
	if (types.slice(idatStart, idatEnd + 1).some((type) => type !== "IDAT")) {
		throw new PngDecodeError("PNG_CHUNK_ORDER_INVALID", "IDAT chunks must be contiguous");
	}
	if (parsed.at(-1)?.data.length !== 0) throw new PngDecodeError("PNG_CHUNK_ORDER_INVALID", "IEND must be empty");
	if (types.includes("tRNS")) throw new PngDecodeError("PNG_FORMAT_UNSUPPORTED", "tRNS transparency");
	const idat = parsed.filter((item) => item.type === "IDAT");
	if (idat.length === 0) throw new PngDecodeError("PNG_DATA_INVALID", "missing IDAT");
	const expected = meta.height * (meta.width * meta.channels + 1);
	if (expected > MAX_DECODED_BYTES) throw new PngDecodeError("PNG_RESOURCE_LIMIT", "decoded bytes exceed 256 MiB");
	const rgbaBytes = meta.width * meta.height * 4;
	const compressedBytes = idat.reduce((total, item) => total + item.data.length, 0);
	const rowBytes = meta.width * meta.channels;
	const peakAllocation = buffer.length + compressedBytes + expected + rgbaBytes + rowBytes * 2;
	if (peakAllocation > MAX_TOTAL_ALLOCATION) {
		throw new PngDecodeError("PNG_RESOURCE_LIMIT", "total allocation exceeds 256 MiB");
	}
	let inflated;
	try {
		inflated = inflateSync(Buffer.concat(idat.map((item) => item.data)), { maxOutputLength: expected });
	} catch (error) {
		throw new PngDecodeError("PNG_DATA_INVALID", error instanceof Error ? error.message : String(error));
	}
	const pixels = rgbaFromRows(inflated, meta);
	return {
		width: meta.width,
		height: meta.height,
		rgba: pixels.rgba,
		hasAlphaChannel: meta.colorType === 4 || meta.colorType === 6,
		hasTransparentPixels: pixels.transparent,
	};
}
