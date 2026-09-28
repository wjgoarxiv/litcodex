import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	NODE_STABLE_READ_FS,
	readStableRegularUtf8,
	type StableReadFileSystem,
	snapshotStableDirectoryChain,
} from "./stable-file-read.js";

const roots: string[] = [];

const tempBase = process.platform === "darwin" ? "/private/tmp" : tmpdir();

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function rewriteSameSize(path: string, replacement: string): void {
	const before = lstatSync(path);
	if (Buffer.byteLength(replacement) !== before.size) throw new Error("the race fixture must preserve byte length");
	writeFileSync(path, replacement);
	utimesSync(path, before.atimeMs / 1000, before.mtimeMs / 1000);
}

describe("stable regular-file reads", () => {
	it("rejects a same-size replacement installed after the initial stat", () => {
		const root = mkdtempSync(join(tempBase, "litcodex-stable-read-"));
		roots.push(root);
		const target = join(root, "payload.txt");
		mkdirSync(root, { recursive: true });
		writeFileSync(target, "original payload\n");
		const replacement = "forged payload!!\n";
		expect(Buffer.byteLength(replacement)).toBe(lstatSync(target).size);
		let swapped = false;
		const fakeFs: StableReadFileSystem = {
			...NODE_STABLE_READ_FS,
			lstat(path) {
				const result = NODE_STABLE_READ_FS.lstat(path);
				if (path === target && !swapped) {
					swapped = true;
					rewriteSameSize(target, replacement);
					return result;
				}
				return result;
			},
		};
		expect(snapshotStableDirectoryChain(target, fakeFs)).toBeDefined();

		const raced = readStableRegularUtf8(target, 4096, fakeFs);
		expect(raced).toBeUndefined();
		expect(swapped).toBe(true);
	});

	it("accepts a replacement installed before the read begins", () => {
		const root = mkdtempSync(join(tempBase, "litcodex-stable-read-"));
		roots.push(root);
		const target = join(root, "payload.txt");
		writeFileSync(target, "original payload\n");
		const replacement = "forged payload!!\n";
		rewriteSameSize(target, replacement);

		const stable = readStableRegularUtf8(target, 4096);
		expect(stable).toBe(replacement);
		expect(readFileSync(target, "utf8")).toBe(replacement);
	});
});
