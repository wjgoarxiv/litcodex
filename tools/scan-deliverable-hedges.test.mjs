import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { addedLinesFromDiff, SCAN_LIMITS, scanAddedText, scanArtifactFiles } from "./scan-deliverable-hedges.mjs";

const casesPath = fileURLToPath(
	new URL("../plugins/litcodex/skills/lit-humanizer/fixtures/rule-cases.json", import.meta.url),
);
const cases = JSON.parse(await import("node:fs").then(({ readFileSync }) => readFileSync(casesPath, "utf8")));
const block = cases.positive["en-bold-deliverable-label"];
const clean = cases.negative["en-bold-deliverable-label"];
const tempRoots = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot() {
	const root = mkdtempSync(join(tmpdir(), "litcodex-humanizer-scan-"));
	tempRoots.push(root);
	return root;
}

function git(root, ...args) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("changed-text humanizer scanner", () => {
	test("uses the canonical detector for block, clean prose, and caption context", () => {
		assert.equal(scanAddedText("report.md", block)[0]?.severity, "block");
		assert.deepEqual(scanAddedText("report.md", clean), []);
		const caption = cases.contextCases.plainSourceAttached.find((item) => item.name === "image-caption");
		assert.ok(caption?.clean);
		assert.deepEqual(scanAddedText("report.md", caption.text), []);
	});

	test("extracts additions while excluding diff headers and removed text", () => {
		const diff = [
			"--- a/report.md",
			"+++ b/report.md",
			"@@ -1 +1,2 @@",
			`-${clean}`,
			`+${block}`,
			"+clean line",
		].join("\n");
		assert.equal(addedLinesFromDiff(diff), `${block}\nclean line`);
	});

	test("scans only new additions in a tracked file", () => {
		const root = tempRoot();
		git(root, "init", "-q");
		git(root, "config", "user.name", "LitCodex Test");
		git(root, "config", "user.email", "litcodex-test@example.invalid");
		git(root, "config", "color.ui", "always");
		writeFileSync(join(root, "report.md"), `${block}\n`, "utf8");
		git(root, "add", "report.md");
		git(root, "commit", "-qm", "baseline");
		assert.deepEqual(scanArtifactFiles(["report.md"], { cwd: root }).violations, []);
		writeFileSync(join(root, "report.md"), `${block}\n${block}\n`, "utf8");
		const report = scanArtifactFiles(["report.md"], { cwd: root });
		assert.equal(report.violations.length, 1);
		assert.equal(report.violations[0].severity, "block");
	});

	test("treats an untracked reader-facing file as new content", () => {
		const root = tempRoot();
		writeFileSync(join(root, "new.md"), block, "utf8");
		const report = scanArtifactFiles(["new.md"], { cwd: root });
		assert.equal(report.violations.length, 1);
		assert.equal(report.ok, false);
	});

	test("skips internal paths before opening them", () => {
		const report = scanArtifactFiles(["plans/not-created.md", ".litcodex/session.json"], { cwd: tempRoot() });
		assert.equal(report.ok, true);
		assert.equal(report.scannedFiles, 0);
		assert.deepEqual(report.errors, []);
	});

	test("retains bounded path and byte inputs", () => {
		const root = tempRoot();
		const oversized = join(root, "large.md");
		writeFileSync(oversized, "x".repeat(SCAN_LIMITS.maxFileBytes + 1), "utf8");
		const tooMany = scanArtifactFiles(
			Array.from({ length: SCAN_LIMITS.maxFiles + 1 }, () => "new.md"),
			{ cwd: root },
		);
		assert.equal(tooMany.errors[0].code, "HUMANIZER_FILE_COUNT_EXCEEDED");
		const tooLarge = scanArtifactFiles([oversized], { cwd: root });
		assert.equal(tooLarge.errors[0].code, "HUMANIZER_FILE_TOO_LARGE");
	});
});
