import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const skillScripts = path.join(repoRoot, "plugins/litcodex/skills/lit-diagram-drawer/scripts");
const doctorScript = path.join(skillScripts, "doctor.mjs");
const exportScript = path.join(skillScripts, "export.mjs");
const inputSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const chromeReady = JSON.stringify({
	success: true,
	checks: [{ id: "chrome.installed", message: "Chrome for Testing 154.0.1" }],
});
const chromeMissing = JSON.stringify({
	success: false,
	checks: [{ id: "chrome.installed", message: "Chrome for Testing not found" }],
});

function withTempDir(callback) {
	const directory = mkdtempSync(path.join(os.tmpdir(), "lit-diagram-runtime-"));
	try {
		return callback(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function makeRenderer(directory, { version = "0.38.1", doctor = chromeReady } = {}) {
	const bin = path.join(directory, "bin");
	mkdirSync(bin, { recursive: true });
	const executable = path.join(bin, "agent-browser");
	writeFileSync(
		executable,
		`#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' 'agent-browser ${version}'; exit 0; fi\nif [ "$1" = "doctor" ]; then printf '%s\\n' '${doctor}'; exit 0; fi\nexit 0\n`,
	);
	chmodSync(executable, 0o755);
	return bin;
}

function run(script, args, bin) {
	return spawnSync(process.execPath, [script, ...args], {
		encoding: "utf8",
		env: { ...process.env, PATH: bin },
	});
}

function writeInput(directory) {
	const file = path.join(directory, "diagram.svg");
	writeFileSync(file, inputSvg);
	return file;
}

function copyExporter(directory) {
	const scripts = path.join(directory, "skills/lit-diagram-drawer/scripts");
	mkdirSync(scripts, { recursive: true });
	for (const name of ["export.mjs", "runtime-probes.mjs", "block-registry.mjs", "office-safety.mjs"]) {
		copyFileSync(path.join(skillScripts, name), path.join(scripts, name));
	}
	return path.join(scripts, "export.mjs");
}

test("diagram doctor reports an absent renderer and an unsupported renderer version", () => {
	withTempDir((directory) => {
		const missing = run(doctorScript, [], directory);
		const missingChecks = JSON.parse(missing.stdout).checks;
		assert.equal(missingChecks.find(({ name }) => name === "agent-browser >= 0.38.1").status, "fail");

		const bin = makeRenderer(directory, { version: "0.38.0" });
		const unsupported = run(doctorScript, [], bin);
		const unsupportedChecks = JSON.parse(unsupported.stdout).checks;
		assert.equal(unsupportedChecks.find(({ name }) => name === "agent-browser >= 0.38.1").status, "fail");
	});
});

test("diagram doctor reports a missing bundled font from its own skill root", () => {
	withTempDir((directory) => {
		const scripts = path.join(directory, "skills/lit-diagram-drawer/scripts");
		mkdirSync(scripts, { recursive: true });
		copyFileSync(doctorScript, path.join(scripts, "doctor.mjs"));
		copyFileSync(path.join(skillScripts, "runtime-probes.mjs"), path.join(scripts, "runtime-probes.mjs"));
		mkdirSync(path.join(directory, "skills/lit-humanizer/scripts"), { recursive: true });
		writeFileSync(path.join(directory, "skills/lit-humanizer/scripts/detect.mjs"), "");
		const bin = makeRenderer(directory);

		const result = run(path.join(scripts, "doctor.mjs"), [], bin);
		const fontCheck = JSON.parse(result.stdout).checks.find(
			({ name }) => name === "assets/fonts/PretendardVariable.woff2",
		);
		assert.equal(fontCheck.status, "fail");
		assert.equal(fontCheck.detail, "missing");
	});
});

test("diagram exporter prints renderer setup guidance when agent-browser is absent", () => {
	withTempDir((directory) => {
		const input = writeInput(directory);
		const result = run(exportScript, ["--input", input], directory);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /RENDERER_REQUIRED/);
		assert.match(result.stderr, /npm install -g agent-browser/);
	});
});

test("diagram exporter rejects an unsupported renderer version", () => {
	withTempDir((directory) => {
		const input = writeInput(directory);
		const bin = makeRenderer(directory, { version: "0.38.0" });
		const result = run(exportScript, ["--input", input], bin);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /RENDERER_REQUIRED/);
	});
});

test("diagram exporter prints the user-run Chrome setup step when Chrome is absent", () => {
	withTempDir((directory) => {
		const input = writeInput(directory);
		const bin = makeRenderer(directory, { doctor: chromeMissing });
		const result = run(exportScript, ["--input", input], bin);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /CHROME_REQUIRED/);
		assert.match(result.stderr, /agent-browser install/);
	});
});

test("office-safe export reports a missing bundled font before opening a browser", () => {
	withTempDir((directory) => {
		const script = copyExporter(directory);
		const input = writeInput(directory);
		const bin = makeRenderer(directory);
		const result = run(script, ["--input", input, "--office-safe"], bin);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /FONT_MISSING/);
	});
});

test("diagram exporter reports usage when --out has no value", () => {
	withTempDir((directory) => {
		const input = writeInput(directory);
		const result = run(exportScript, ["--input", input, "--out"], directory);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /Usage:/);
		assert.doesNotMatch(result.stderr, /TypeError|stack/i);
	});
});
