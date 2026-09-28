import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readRegularBytesWithin } from "./scripts/strict-input.mjs";

function inTemporaryRoot(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "litcodex-strict-input-"));
	try {
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function descriptorLifecycle(target: string, root: string, failAfterOpen: boolean) {
	const moduleUrl = new URL("./scripts/strict-input.mjs", import.meta.url).href;
	const script = `
		import { fstatSync } from "node:fs";
		import { readRegularBytesWithin } from ${JSON.stringify(moduleUrl)};
		let descriptor;
		let bytes;
		let error = "";
		try {
			bytes = readRegularBytesWithin(${JSON.stringify(target)}, ${JSON.stringify(root)}, 1024, "CAPTURE_INVALID", {
				afterOpen(opened) {
					descriptor = opened;
					if (${JSON.stringify(failAfterOpen)}) throw new Error("injected descriptor validation failure");
				},
			});
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		let closed = false;
		try { fstatSync(descriptor); } catch (caught) { closed = caught?.code === "EBADF"; }
		process.stdout.write(JSON.stringify({ bytes: bytes?.toString("utf8"), error, closed }));
	`;
	const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
	expect(run.status, run.stderr).toBe(0);
	return JSON.parse(run.stdout) as { bytes?: string; error: string; closed: boolean };
}

describe("visual-qa strict file input", () => {
	it("reads a normal contained file through a descriptor and closes it", () => {
		inTemporaryRoot((root) => {
			const target = join(root, "capture.txt");
			writeFileSync(target, "inside bytes");

			expect(descriptorLifecycle(target, root, false)).toEqual({
				bytes: "inside bytes",
				error: "",
				closed: true,
			});
		});
	});

	it("rejects direct symlinks and directories", () => {
		inTemporaryRoot((root) => {
			const target = join(root, "capture.txt");
			const link = join(root, "capture-link.txt");
			const directory = join(root, "capture-directory");
			writeFileSync(target, "inside bytes");
			symlinkSync(target, link);
			mkdirSync(directory);

			expect(() => readRegularBytesWithin(link, root, 1024)).toThrow(/regular non-symlink file/i);
			expect(() => readRegularBytesWithin(directory, root, 1024)).toThrow(/regular non-symlink file/i);
		});
	});

	it("rejects a symlink swap before open without consuming outside bytes", () => {
		inTemporaryRoot((root) => {
			const allowed = join(root, "allowed");
			const target = join(allowed, "capture.txt");
			const validated = join(allowed, "validated.txt");
			const outside = join(root, "outside.txt");
			mkdirSync(allowed);
			writeFileSync(target, "validated bytes");
			writeFileSync(outside, "outside secret bytes");
			let readAttempts = 0;

			expect(() =>
				readRegularBytesWithin(target, allowed, 1024, "CAPTURE_INVALID", {
					afterPathValidation() {
						renameSync(target, validated);
						symlinkSync(outside, target);
					},
					beforeRead() {
						readAttempts += 1;
					},
				}),
			).toThrow(/changed during validation|opened safely/i);

			expect(readAttempts).toBe(0);
			expect(readFileSync(outside, "utf8")).toBe("outside secret bytes");
		});
	});

	it("rejects a regular-file swap before open without consuming replacement bytes", () => {
		inTemporaryRoot((root) => {
			const allowed = join(root, "allowed");
			const target = join(allowed, "capture.txt");
			const validated = join(allowed, "validated.txt");
			const outside = join(root, "outside.txt");
			mkdirSync(allowed);
			writeFileSync(target, "validated bytes");
			writeFileSync(outside, "outside secret bytes");
			let readAttempts = 0;

			expect(() =>
				readRegularBytesWithin(target, allowed, 1024, "CAPTURE_INVALID", {
					afterPathValidation() {
						renameSync(target, validated);
						renameSync(outside, target);
					},
					beforeRead() {
						readAttempts += 1;
					},
				}),
			).toThrow(/changed during validation/i);

			expect(readAttempts).toBe(0);
			expect(readFileSync(target, "utf8")).toBe("outside secret bytes");
		});
	});

	it("closes the descriptor when validation after open throws", () => {
		inTemporaryRoot((root) => {
			const target = join(root, "capture.txt");
			writeFileSync(target, "inside bytes");

			expect(descriptorLifecycle(target, root, true)).toEqual({
				error: "injected descriptor validation failure",
				closed: true,
			});
		});
	});
});
