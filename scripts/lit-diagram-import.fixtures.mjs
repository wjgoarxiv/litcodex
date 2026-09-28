import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	".litcodex",
	"evidence",
	"2026-09-25-diagram-port-litcodex",
	"tmp",
);

function withInput(extension, content, run) {
	mkdirSync(evidenceRoot, { recursive: true });
	const root = mkdtempSync(join(evidenceRoot, "import-"));
	const file = join(root, `sample${extension}`);
	try {
		writeFileSync(file, content);
		return run(file);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function pngCrc32(data) {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
	const type = Buffer.from(name, "ascii");
	const body = Buffer.concat([type, data]);
	const header = Buffer.alloc(4);
	header.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(pngCrc32(body));
	return Buffer.concat([header, body, checksum]);
}

function pngWithMxfile(xml) {
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(1, 0);
	header.writeUInt32BE(1, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		signature,
		pngChunk("IHDR", header),
		pngChunk("tEXt", Buffer.concat([Buffer.from("mxfile\0", "latin1"), Buffer.from(xml)])),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

export { pngWithMxfile, withInput };
