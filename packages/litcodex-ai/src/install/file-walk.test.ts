import * as nodeFs from "node:fs";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRegularFileBuffer, type StableFileReadFs } from "./file-walk.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readRegularFileBuffer", () => {
	it.runIf(process.platform !== "win32")("rejects a same-size replacement after the initial file stat", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-file-read-"));
		roots.push(root);
		const target = join(root, "payload.json");
		writeFileSync(target, "original bytes\n");
		const replacement = "forged xxbytes\n";
		expect(Buffer.byteLength(replacement)).toBe(lstatSync(target).size);
		let swapped = false;
		const fakeFs: StableFileReadFs = {
			...nodeFs,
			openSync(path, flags) {
				if (!swapped && String(path) === target) {
					swapped = true;
					const stamp = lstatSync(target);
					writeFileSync(target, replacement);
					utimesSync(target, stamp.atimeMs / 1000, stamp.mtimeMs / 1000);
				}
				return nodeFs.openSync(path, flags);
			},
		};

		expect(() => readRegularFileBuffer(target, fakeFs)).toThrow(/payload file identity changed/);
		expect(swapped).toBe(true);
	});

	it("accepts a replacement installed before the read begins", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-file-read-"));
		roots.push(root);
		const target = join(root, "payload.json");
		writeFileSync(target, "forged  bytes\n");

		expect(Buffer.from(readRegularFileBuffer(target)).toString("utf8")).toBe("forged  bytes\n");
	});

	it.runIf(process.platform !== "win32")("rejects a parent swap before reading bytes", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-file-read-"));
		roots.push(root);
		const parent = join(root, "parent");
		const displaced = join(root, "parent-original");
		const target = join(parent, "payload.json");
		mkdirSync(parent, { recursive: true });
		writeFileSync(target, "expected bytes\n", { flag: "w" });

		let swapped = false;
		let reads = 0;
		const fakeFs: StableFileReadFs = {
			...nodeFs,
			openSync(path: nodeFs.PathLike, flags: nodeFs.OpenMode) {
				const descriptor = nodeFs.openSync(path, flags);
				if (!swapped && String(path) === target) {
					swapped = true;
					renameSync(parent, displaced);
					cpSync(displaced, parent, { recursive: true, preserveTimestamps: true });
				}
				return descriptor;
			},
			readFileSync(fd: number) {
				reads += 1;
				return nodeFs.readFileSync(fd);
			},
		};

		expect(() => readRegularFileBuffer(target, fakeFs)).toThrow(/parent identity changed before read/);
		expect(swapped).toBe(true);
		expect(reads).toBe(0);
	});
});
