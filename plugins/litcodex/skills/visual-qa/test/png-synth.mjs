import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { crc32, PNG_SIGNATURE } from "../scripts/png-crc.mjs";

function chunk(type, data) {
	const typeBytes = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, checksum]);
}

export function solidRgba(width, height, color) {
	const rgba = new Uint8Array(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel += 1) rgba.set(color, pixel * 4);
	return rgba;
}

export function encodeRgbaPng(width, height, rgba) {
	const rowBytes = width * 4;
	const raw = Buffer.alloc(height * (rowBytes + 1));
	for (let row = 0; row < height; row += 1) {
		Buffer.from(rgba).copy(raw, row * (rowBytes + 1) + 1, row * rowBytes, (row + 1) * rowBytes);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
