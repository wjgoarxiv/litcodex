#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	NODE_STABLE_READ_FS,
	readStableRegularUtf8,
	snapshotStableDirectoryChain,
} from "../plugins/litcodex/components/rules/dist/stable-file-read.js";
import { exitCode, parseRules, scanText } from "../plugins/litcodex/skills/lit-humanizer/scripts/core.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const RULES = parseRules(
	readFileSync(new URL("../plugins/litcodex/skills/lit-humanizer/rules.json", import.meta.url), "utf8"),
);
export const SCAN_LIMITS = Object.freeze({
	maxFiles: 64,
	maxFileBytes: 2 * 1024 * 1024,
	maxAggregateBytes: 4 * 1024 * 1024,
});
const USAGE = `Usage: node tools/scan-deliverable-hedges.mjs <path...> [--json]

Scans only added text: tracked files are compared with HEAD; untracked files are treated as new. Internal paths are skipped.`;

export function addedLinesFromDiff(diff) {
	return diff
		.split(/\r?\n/u)
		.filter((line) => line.startsWith("+") && !line.startsWith("+++"))
		.map((line) => line.slice(1))
		.join("\n");
}

function errorFor(path, code, message) {
	return { path, code, message };
}

function isInternalPath(path) {
	const segments = path.replaceAll("\\", "/").split("/");
	return segments.some(
		(segment) =>
			segment === "plans" ||
			segment === "evidence" ||
			segment === ".hermes" ||
			segment === `.${["o", "mo"].join("")}` ||
			/^\.lit[^/]*$/iu.test(segment) ||
			/^handoff(?:$|[-_.])/iu.test(segment) ||
			/^(?:ledgers?|status)(?:\.[^/]*)?$/iu.test(segment),
	);
}

function gitRoot(cwd) {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", shell: false });
	return result.status === 0 ? result.stdout.trim() : null;
}

function trackedAtHead(root, path) {
	const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", path], {
		cwd: root,
		encoding: "utf8",
		shell: false,
		stdio: ["ignore", "ignore", "ignore"],
	});
	return result.status === 0;
}

function changedText(root, relativePath, fullText) {
	if (!root || !trackedAtHead(root, relativePath)) return fullText;
	const result = spawnSync("git", ["diff", "--no-color", "--no-ext-diff", "--unified=0", "HEAD", "--", relativePath], {
		cwd: root,
		encoding: "utf8",
		shell: false,
		maxBuffer: SCAN_LIMITS.maxAggregateBytes,
	});
	if (result.error || result.status !== 0) throw new Error("could not read added lines from git diff");
	return addedLinesFromDiff(result.stdout);
}

export function scanAddedText(path, text) {
	const findings = scanText(text, RULES, path);
	return findings.map((item) => ({
		path,
		class: item.rule,
		severity: item.severity,
		line: item.line,
		column: 1,
		match: item.excerpt,
	}));
}

export function scanArtifactFiles(paths, { cwd = process.cwd() } = {}) {
	if (paths.length > SCAN_LIMITS.maxFiles) {
		return emptyReport([
			errorFor("<inputs>", "HUMANIZER_FILE_COUNT_EXCEEDED", `at most ${SCAN_LIMITS.maxFiles} paths may be scanned`),
		]);
	}
	const root = gitRoot(cwd);
	const errors = [];
	const seen = new Set();
	const candidates = [];
	let declaredBytes = 0;
	for (const input of paths) {
		if (isInternalPath(input)) continue;
		const absolute = resolve(cwd, input);
		let stat;
		try {
			stat = lstatSync(absolute);
		} catch (error) {
			errors.push(
				errorFor(
					input,
					"HUMANIZER_FILE_UNREADABLE",
					error?.code === "ENOENT" ? "file not found" : "file unreadable",
				),
			);
			continue;
		}
		if (stat.isSymbolicLink() || !stat.isFile()) {
			errors.push(errorFor(input, "HUMANIZER_NOT_REGULAR_FILE", "path must be a regular file without symlinks"));
			continue;
		}
		if (stat.size > SCAN_LIMITS.maxFileBytes) {
			errors.push(errorFor(input, "HUMANIZER_FILE_TOO_LARGE", `file exceeds ${SCAN_LIMITS.maxFileBytes} bytes`));
			continue;
		}
		let canonical;
		try {
			canonical = realpathSync.native(absolute);
		} catch {
			errors.push(errorFor(input, "HUMANIZER_FILE_UNREADABLE", "file unreadable"));
			continue;
		}
		const directories = snapshotStableDirectoryChain(canonical);
		if (directories === undefined) {
			errors.push(errorFor(input, "HUMANIZER_FILE_UNSTABLE", "file path was unsafe"));
			continue;
		}
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		declaredBytes += stat.size;
		const relativePath = root ? relative(root, canonical) : input;
		const scanPath = root && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) ? relativePath : canonical;
		candidates.push({ input, canonical, scanPath, directories, relativePath });
	}
	if (errors.length > 0) return emptyReport(errors);
	if (declaredBytes > SCAN_LIMITS.maxAggregateBytes) {
		return emptyReport([
			errorFor(
				"<inputs>",
				"HUMANIZER_AGGREGATE_BYTES_EXCEEDED",
				`combined files exceed ${SCAN_LIMITS.maxAggregateBytes} bytes`,
			),
		]);
	}
	const violations = [];
	let scannedFiles = 0;
	let actualBytes = 0;
	for (const candidate of candidates) {
		const text = readStableRegularUtf8(
			candidate.canonical,
			SCAN_LIMITS.maxFileBytes,
			NODE_STABLE_READ_FS,
			candidate.directories,
		);
		if (text === undefined) {
			errors.push(errorFor(candidate.input, "HUMANIZER_FILE_UNSTABLE", "file changed or was unsafe"));
			continue;
		}
		if (text.includes("\0")) {
			errors.push(errorFor(candidate.input, "HUMANIZER_BINARY_FILE", "binary files are not supported"));
			continue;
		}
		actualBytes += Buffer.byteLength(text, "utf8");
		if (actualBytes > SCAN_LIMITS.maxAggregateBytes) {
			errors.push(
				errorFor(
					"<inputs>",
					"HUMANIZER_AGGREGATE_BYTES_EXCEEDED",
					`combined files exceed ${SCAN_LIMITS.maxAggregateBytes} bytes`,
				),
			);
			break;
		}
		let additions;
		try {
			additions = changedText(root, candidate.relativePath, text);
		} catch {
			errors.push(errorFor(candidate.input, "HUMANIZER_DIFF_UNAVAILABLE", "could not determine the added text"));
			continue;
		}
		if (!additions.trim()) {
			scannedFiles += 1;
			continue;
		}
		violations.push(...scanAddedText(candidate.scanPath, additions));
		scannedFiles += 1;
	}
	if (errors.length > 0) return emptyReport(errors);
	violations.sort(
		(left, right) =>
			left.path.localeCompare(right.path) || left.line - right.line || left.class.localeCompare(right.class),
	);
	return { ok: violations.length === 0, scannedFiles, violations, errors: [] };
}

function emptyReport(errors) {
	return { ok: false, scannedFiles: 0, violations: [], errors };
}

function parseArgs(argv) {
	const paths = [];
	let json = false;
	let help = false;
	for (const argument of argv) {
		if (argument === "--json") json = true;
		else if (argument === "--help" || argument === "-h") help = true;
		else if (argument.startsWith("--")) return { error: `unexpected argument: ${argument}` };
		else paths.push(argument);
	}
	if (help) return { help: true };
	if (paths.length === 0) return { error: "at least one file path is required" };
	return { paths, json };
}

export function runCli(argv, io = {}) {
	const stdout = io.stdout ?? process.stdout;
	const stderr = io.stderr ?? process.stderr;
	const parsed = parseArgs(argv);
	if (parsed.error) {
		stderr.write(`${parsed.error}\n${USAGE}\n`);
		return 2;
	}
	if (parsed.help) {
		stdout.write(`${USAGE}\n`);
		return 0;
	}
	const report = scanArtifactFiles(parsed.paths);
	if (parsed.json) stdout.write(`${JSON.stringify(report)}\n`);
	else {
		for (const error of report.errors)
			stderr.write(`[lit-humanizer] ${error.code}: ${error.path}: ${error.message}\n`);
		for (const item of report.violations)
			stdout.write(`${item.path}:${item.line}:${item.column} [${item.severity} ${item.class}] ${item.match}\n`);
		stdout.write(
			report.ok
				? `lit-humanizer scan: OK (${report.scannedFiles} changed file(s))\n`
				: `lit-humanizer scan: findings=${report.violations.length} files=${report.scannedFiles}\n`,
		);
	}
	return report.errors.length > 0
		? 2
		: exitCode(report.violations.map((item) => ({ rule: item.class, severity: item.severity })));
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === SELF_PATH)
	process.exitCode = runCli(process.argv.slice(2));
