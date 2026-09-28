import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { analyzeAnsi, stripAnsi } from "./scripts/ansi.mjs";
import { diffImages } from "./scripts/image-diff.mjs";
import { crc32 } from "./scripts/png-crc.mjs";
import { decodePng } from "./scripts/png-decode.mjs";
import { checkTui } from "./scripts/tui-grid.mjs";
import { encodeRgbaPng, solidRgba } from "./test/png-synth.mjs";

function chunk(type: string, data: Buffer): Buffer {
	const typeBytes = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, checksum]);
}

function insertBeforeIdat(png: Buffer, inserted: Buffer): Buffer {
	const idat = png.indexOf(Buffer.from("IDAT", "ascii"));
	return Buffer.concat([png.subarray(0, idat - 4), inserted, png.subarray(idat - 4)]);
}

function splitIdat(png: Buffer): Buffer {
	const type = png.indexOf(Buffer.from("IDAT", "ascii"));
	const start = type - 4;
	const length = png.readUInt32BE(start);
	const data = png.subarray(type + 4, type + 4 + length);
	const end = type + 8 + length;
	return Buffer.concat([
		png.subarray(0, start),
		chunk("IDAT", data.subarray(0, 1)),
		chunk("tEXt", Buffer.from("gap")),
		chunk("IDAT", data.subarray(1)),
		png.subarray(end),
	]);
}

function withColorType(png: Buffer, colorType: number): Buffer {
	const modified = Buffer.from(png);
	modified[25] = colorType;
	modified.writeUInt32BE(crc32(modified.subarray(12, 29)), 29);
	return modified;
}

describe("visual-qa hardened PNG boundary", () => {
	it("rejects unknown critical chunks and noncontiguous IDAT sequences", () => {
		const valid = Buffer.from(encodeRgbaPng(1, 1, solidRgba(1, 1, [1, 2, 3, 255])));
		expect(() => decodePng(insertBeforeIdat(valid, chunk("ABCD", Buffer.alloc(0))))).toThrow(
			/PNG_CRITICAL_CHUNK_UNSUPPORTED/,
		);
		expect(() => decodePng(splitIdat(valid))).toThrow(/PNG_CHUNK_ORDER_INVALID/);
		expect(() => decodePng(insertBeforeIdat(valid, chunk("tRNS", Buffer.alloc(2))))).toThrow(
			/PNG_FORMAT_UNSUPPORTED/,
		);
	});

	it("enforces PLTE legality for grayscale and RGB families", () => {
		const valid = Buffer.from(encodeRgbaPng(1, 1, solidRgba(1, 1, [1, 2, 3, 255])));
		const palette = chunk("PLTE", Buffer.from([1, 2, 3]));
		expect(() => decodePng(insertBeforeIdat(withColorType(valid, 0), palette))).toThrow(
			/PLTE is forbidden/,
		);
		expect(() => decodePng(insertBeforeIdat(valid, chunk("PLTE", Buffer.from([1, 2]))))).toThrow(
			/PLTE length is invalid/,
		);
	});

	it("rejects dimension mismatch before scoring and reports alpha loss", () => {
		const reference = decodePng(encodeRgbaPng(1, 1, solidRgba(1, 1, [1, 2, 3, 0])));
		const larger = decodePng(encodeRgbaPng(2, 1, solidRgba(2, 1, [1, 2, 3, 0])));
		expect(() => diffImages(reference, larger)).toThrow(/IMAGE_DIMENSION_MISMATCH/);
		const opaque = decodePng(encodeRgbaPng(1, 1, solidRgba(1, 1, [1, 2, 3, 255])));
		expect(diffImages(reference, opaque).alphaChannelIntact).toBe(false);
	});
});

describe("visual-qa hardened terminal boundary", () => {
	it("strips C1 OSC, DCS, APC, and ST-terminated controls as inert data", () => {
		const controls = [
			"\u009d8;;https://invalid\u0007visible\u009d8;;\u0007",
			"\u001bPpayload\u001b\\visible",
			"\u0090payload\u009cvisible",
			"\u001b_payload\u001b\\visible",
			"\u009fpayload\u009cvisible",
		];
		for (const value of controls) expect(stripAnsi(value)).toBe("visible");
	});

	it("reports unterminated control strings and broken border topology", () => {
		expect(analyzeAnsi("\u001bPunterminated")).toMatchObject({ hasControl: true, unterminated: true });
		const report = checkTui("┌────┐\n│text \n└────┘\u001bPunterminated", 6);
		expect(report.controlSequencesValid).toBe(false);
		expect(report.topologyErrors).toEqual(
			expect.arrayContaining(["open side border on line 2", "unterminated control sequence"]),
		);
	});

	it.each(["\u0007", "\u0008", "\r", "\u0091"])(
		"rejects unsafe C0/C1 control %j",
		(control) => {
			const report = checkTui(`┌────┐\n│a${control}b │\n└────┘`, 6);
			expect(report.controlSequencesValid).toBe(false);
			expect(report.topologyErrors).toContain("unsafe C0/C1 control");
		},
	);

	it("detects missing frame sides and reports ZWJ grapheme display cells", () => {
		const report = checkTui("┌────┐\n👩‍💻text\n└────┘", 6);
		expect(report.topologyErrors).toContain("open side border on line 2");
		expect(report.wideCharColumns).toContain(0);
	});

	it.each([
		["top", "┌─x──┐\n│text │\n└────┘", "broken top border cell continuity"],
		["bottom", "┌────┐\n│text │\n└──x─┘", "broken bottom border cell continuity"],
		["mixed side", "┌────┐\n║text ║\n└────┘", "broken side border cell continuity on line 2"],
	])("rejects a discontinuous %s border cell", (_name, frame, expected) => {
		expect(checkTui(frame, 6).topologyErrors).toContain(expected);
	});
});

describe("visual-qa CLI file boundary", () => {
	it("rejects unknown args, devices, symlinks, FIFOs, ancestor escapes, oversized files, and invalid UTF-8", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-visual-cli-"));
		const cwd = join(root, "cwd");
		mkdirSync(cwd);
		const cli = fileURLToPath(new URL("./scripts/cli.mjs", import.meta.url));
		const outside = join(root, "outside.txt");
		const invalid = join(cwd, "invalid.txt");
		const oversized = join(cwd, "oversized.txt");
		const link = join(cwd, "link.txt");
		const fifo = join(cwd, "capture.fifo");
		writeFileSync(outside, "outside");
		writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
		writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1));
		symlinkSync(outside, link);
		expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
		const invoke = (args: string[]) => spawnSync(process.execPath, [cli, ...args], {
			cwd,
			encoding: "utf8",
			timeout: 1000,
		});
		for (const args of [
			["tui-check", invalid, "--unknown", "1"],
			["tui-check", "/dev/null"],
			["tui-check", link],
			["tui-check", fifo],
			["tui-check", "../outside.txt"],
			["tui-check", oversized],
			["tui-check", invalid],
		]) {
			const run = invoke(args);
			expect(run.status, `${args.join(" ")} unexpectedly passed`).not.toBe(0);
		}
		rmSync(root, { recursive: true, force: true });
	});
});
