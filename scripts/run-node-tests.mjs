#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const repoRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const approvedRoots = new Set(["scripts", "tools"]);

function unsafePath(path, reason) {
	throw new Error(`unsafe Git path ${JSON.stringify(path)}: ${reason}`);
}

function validateGitPath(path) {
	if (path.length === 0) unsafePath(path, "empty record");
	if (path.includes("\\") || isAbsolute(path)) unsafePath(path, "non-repository-relative path");
	const segments = path.split("/");
	if (!approvedRoots.has(segments[0])) unsafePath(path, "outside approved test roots");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
		unsafePath(path, "invalid path segment");
	}

	const approvedRoot = resolve(repoRoot, segments[0]);
	const absolutePath = resolve(repoRoot, ...segments);
	const containedPath = relative(approvedRoot, absolutePath);
	if (containedPath === ".." || containedPath.startsWith(`..${sep}`) || isAbsolute(containedPath)) {
		unsafePath(path, "path escape");
	}
	return absolutePath;
}

function decodeGitPaths(stdout) {
	if (stdout.length === 0) return [];
	if (stdout.at(-1) !== 0) throw new Error("malformed Git output: missing NUL terminator");

	const decoder = new TextDecoder("utf-8", { fatal: true });
	const paths = [];
	for (let start = 0; start < stdout.length; ) {
		const end = stdout.indexOf(0, start);
		if (end === start) throw new Error("malformed Git output: empty path record");
		try {
			paths.push(decoder.decode(stdout.subarray(start, end)));
		} catch {
			throw new Error("malformed Git output: path is not valid UTF-8");
		}
		start = end + 1;
	}
	return paths;
}

function discoverTests() {
	const listed = spawnSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "scripts", "tools"],
		{
			cwd: repoRoot,
			encoding: null,
			maxBuffer: 16 * 1024 * 1024,
			shell: false,
		},
	);
	if (listed.error) throw new Error(`Git test discovery failed: ${listed.error.message}`);
	if (listed.signal || listed.status !== 0) {
		const detail = listed.stderr?.toString("utf8").trim();
		throw new Error(`Git test discovery failed${detail ? `: ${detail}` : ""}`);
	}

	const tests = [];
	const seen = new Set();
	for (const path of decodeGitPaths(listed.stdout)) {
		const absolutePath = validateGitPath(path);
		if (seen.has(path)) throw new Error(`malformed Git output: duplicate path ${JSON.stringify(path)}`);
		seen.add(path);
		if (!path.endsWith(".test.mjs")) continue;

		let entry;
		try {
			entry = lstatSync(absolutePath);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (!entry.isFile()) unsafePath(path, "test candidate is not a regular file");
		if (realpathSync(absolutePath) !== absolutePath) unsafePath(path, "test candidate crosses a symlink");
		tests.push(path);
	}
	return tests.sort();
}

let tests;
try {
	tests = discoverTests();
} catch (error) {
	process.stderr.write(`[node-tests] ${error.message}\n`);
	process.exit(1);
}
if (tests.length === 0) {
	process.stderr.write("[node-tests] no .test.mjs files found\n");
	process.exit(1);
}

// Several Node suites rebuild or dry-pack the same dist tree. Their results are only
// independent when those filesystem mutations cannot overlap other suites.
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...tests], {
	cwd: repoRoot,
	stdio: "inherit",
	shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
