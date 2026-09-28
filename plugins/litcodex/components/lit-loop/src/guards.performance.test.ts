import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { transcriptHasContextPressureMarker } from "./guards.js";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guard3 bounded head+tail performance", () => {
	it("guard3 bounded read stays within latency budget", () => {
		// 256 MiB transcript, marker only at the tail. Bounded read must complete fast.
		const dir = mkdtempSync(join(tmpdir(), "litcodex-guard-performance-"));
		tempDirs.push(dir);
		const path = join(dir, "huge.jsonl");
		const chunk = Buffer.alloc(8 * 1024 * 1024, 0x61); // 'a'
		const fd = openSync(path, "w");
		try {
			for (let i = 0; i < 32; i += 1) {
				writeSync(fd, chunk);
			}
			writeSync(fd, Buffer.from("context_length_exceeded\n", "utf8"));
		} finally {
			closeSync(fd);
		}
		const start = performance.now();
		const result = transcriptHasContextPressureMarker(path);
		const elapsedMs = performance.now() - start;
		expect(result).toBe(true);
		expect(elapsedMs).toBeLessThan(250);
	});
});
