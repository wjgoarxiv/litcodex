import { describe, expect, it, vi } from "vitest";

// Simulate the platform path API without making this test depend on the host OS. The real
// implementation receives the same `node:path` `isAbsolute` behavior on Windows; the mock keeps
// POSIX temp roots valid while adding Windows drive and UNC roots to the simulated platform.
vi.mock("node:path", async () => {
	const actual = await vi.importActual<typeof import("node:path")>("node:path");
	return {
		...actual,
		isAbsolute: (value: string) => actual.isAbsolute(value) || actual.win32.isAbsolute(value),
	};
});

import { runLoopDoctor } from "./loop-doctor.js";

describe("loop-doctor Windows absolute roots", () => {
	it.each([
		String.raw`C:\repo`,
		String.raw`\\server\share`,
	])("accepts a Windows-shaped absolute root (%s) through the platform path API", async (repoRoot) => {
		const report = await runLoopDoctor({ repoRoot });
		expect(report.stateDir).not.toBe("");
		expect(report.checks.some((check) => check.detail === "invalid repoRoot (not absolute)")).toBe(false);
	});
});
