import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	BROWSER_DRIVE_SKILL_FILES,
	copyLitLoopSkills,
	HANDOFF_SKILL_FILES,
	SCIENTIFIC_VISUALIZATION_SKILL_FILES,
	VENDOR_FILES,
} from "./lit-loop-skill-bundle.mjs";

function filesUnder(root, relative = "") {
	return readdirSync(join(root, relative), { withFileTypes: true })
		.flatMap((entry) => {
			const child = join(relative, entry.name);
			return entry.isDirectory() ? filesUnder(root, child) : [child.replaceAll("\\", "/")];
		})
		.sort();
}

test("materializes the lit-handoff adapter and shared vendor payload", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-hook-skills-"));
	try {
		copyLitLoopSkills(root);
		assert.deepEqual(filesUnder(join(root, "skills/lit-handoff")), [...HANDOFF_SKILL_FILES].sort());
		assert.deepEqual(filesUnder(join(root, "vendor")), [...VENDOR_FILES].sort());
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("materializes the scientific-visualization adapter alongside the shared vendor payload", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-hook-science-"));
	try {
		copyLitLoopSkills(root);
		assert.deepEqual(
			filesUnder(join(root, "skills/lit-scientific-visualization")),
			[...SCIENTIFIC_VISUALIZATION_SKILL_FILES].sort(),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("materializes the Codex-native deep-interview body for hook routing", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-hook-deep-interview-"));
	try {
		copyLitLoopSkills(root);
		assert.deepEqual(filesUnder(join(root, "skills/deep-interview")), ["SKILL.md"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("materializes the complete browser-drive adapter for hook routing", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-hook-browser-drive-"));
	try {
		copyLitLoopSkills(root);
		assert.deepEqual(filesUnder(join(root, "skills/browser-drive")), [...BROWSER_DRIVE_SKILL_FILES].sort());
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("materializes the full humanizer resource closure and removes the old hook skill id", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-hook-humanizer-"));
	try {
		copyLitLoopSkills(root);
		const paths = filesUnder(root);
		for (const path of [
			"skills/lit-humanizer/SKILL.md",
			"skills/lit-humanizer/rules.json",
			"skills/lit-humanizer/NOTICE",
			"skills/lit-humanizer/references/taxonomy.md",
			"skills/lit-humanizer/scripts/detect.mjs",
		])
			assert.ok(paths.includes(path), `${path} must be bundled for hook routing`);
		assert.ok(!paths.some((path) => path.startsWith("skills/lit-korean/")));
		assert.ok(!paths.some((path) => path.includes("/fixtures/")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("materialized hook payload omits removed observer and skill-loop artifacts", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-hook-skill-removal-"));
	try {
		const copied = copyLitLoopSkills(root);
		const paths = filesUnder(root);
		for (const removedPath of [
			"skills/skill-observer/SKILL.md",
			"skills/skill-observer/references/review-contract.md",
		]) {
			assert.equal(paths.includes(removedPath), false, `${removedPath} must not be materialized`);
			assert.equal(copied.includes(removedPath), false, `${removedPath} must not be reported as materialized`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
