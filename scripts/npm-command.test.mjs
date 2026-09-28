import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveNpmCommand, resolveNpmInvocation } from "./npm-command.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = /\.(?:mjs|js|ts|tsx)$/u;
const CHILD_PROCESS_LITERAL_RE =
	/\b(?:spawnSync|spawn|execFileSync|execFile|execSync|exec|runCommand|run|provenanceRunCommand)\s*\(\s*(["'`])(npm|npx)\1\s*,/gs;

function trackedSourceFiles() {
	return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
		.split("\0")
		.filter((file) => SOURCE_EXTENSIONS.test(file) && !file.startsWith("# REFERENCE/"));
}

test("resolves the npm shim from an injected platform and preserves npm_execpath when available", () => {
	assert.equal(resolveNpmCommand("win32"), "npm.cmd");
	assert.equal(resolveNpmCommand("linux"), "npm");
	assert.deepEqual(resolveNpmInvocation(["run", "build"], { platform: "win32", npmExecPath: "" }), {
		command: "npm.cmd",
		args: ["run", "build"],
	});
	assert.deepEqual(
		resolveNpmInvocation(["run", "build"], {
			platform: "win32",
			npmExecPath: "C:\\Program Files\\nodejs\\npm-cli.js",
			nodePath: "C:\\Program Files\\nodejs\\node.exe",
		}),
		{
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: ["C:\\Program Files\\nodejs\\npm-cli.js", "run", "build"],
		},
	);
});

test("no production or test child-process call passes a bare npm or npx literal", () => {
	const violations = [];
	for (const file of trackedSourceFiles()) {
		const source = readFileSync(join(REPO_ROOT, file), "utf8");
		for (const match of source.matchAll(CHILD_PROCESS_LITERAL_RE)) {
			const index = match.index ?? 0;
			const line = source.slice(0, index).split(/\r?\n/u).length;
			violations.push(`${file}:${line}: ${match[0].replace(/\s+/gu, " ").trim()}`);
		}
	}
	assert.deepEqual(violations, [], `Windows-unsafe child-process npm shims:\n${violations.join("\n")}`);
});
