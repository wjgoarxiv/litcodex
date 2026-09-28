import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createBlockingSpinnerMotion } from "./spinner-motion.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function block(milliseconds: number): void {
	const state = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(state, 0, 0, milliseconds);
}

describe("blocking-safe spinner motion", () => {
	it("keeps drawing frames while the installer main thread is synchronously blocked", () => {
		// Given: a real fd and the same blocked main-thread shape as spawnSync.
		const root = mkdtempSync(join(tmpdir(), "litcodex-spinner-motion-"));
		roots.push(root);
		const outputPath = join(root, "motion.log");
		const fd = openSync(outputPath, "w");
		const motion = createBlockingSpinnerMotion(fd);

		// When: the main thread blocks for several animation intervals.
		const stop = motion.start("checking host");
		block(450);
		stop();
		closeSync(fd);

		// Then: the worker wrote multiple distinct frames during the block.
		const output = readFileSync(outputPath, "utf8");
		expect(output.match(/checking host/g)?.length ?? 0).toBeGreaterThan(2);
		expect(new Set([...output.matchAll(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g)].map((match) => match[0])).size).toBeGreaterThan(1);
	});

	it("stops all worker writes before the completion row is rendered", () => {
		// Given: an active worker-backed motion stream.
		const root = mkdtempSync(join(tmpdir(), "litcodex-spinner-stop-"));
		roots.push(root);
		const outputPath = join(root, "motion.log");
		const fd = openSync(outputPath, "w");
		const stop = createBlockingSpinnerMotion(fd).start("stopping safely");
		block(250);

		// When: the parent stops motion before writing its final row.
		stop();
		const stoppedSize = readFileSync(outputPath).byteLength;
		block(250);
		closeSync(fd);

		// Then: no late frame races with the final row.
		expect(readFileSync(outputPath).byteLength).toBe(stoppedSize);
	});
});
