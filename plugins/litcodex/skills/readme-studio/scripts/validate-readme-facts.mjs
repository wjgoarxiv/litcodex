#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function safeHttpUrl(value) {
	if (!nonEmptyString(value) || value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value)) return false;
	try {
		const url = new URL(value);
		return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0 && !url.username && !url.password;
	} catch {
		return false;
	}
}

function safeEvidenceFile(root, source) {
	if (!nonEmptyString(source) || isAbsolute(source) || source.includes("\\")) return false;
	const segments = source.split("/");
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
	const target = resolve(root, ...segments);
	const relativeTarget = relative(root, target);
	if (relativeTarget === "" || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) return false;
	let cursor = root;
	try {
		for (const segment of relativeTarget.split(sep)) {
			cursor = join(cursor, segment);
			const stat = lstatSync(cursor);
			if (stat.isSymbolicLink()) return false;
			if (cursor !== target && !stat.isDirectory()) return false;
			if (cursor === target && !stat.isFile()) return false;
		}
		const realTarget = realpathSync(target);
		const realRelative = relative(root, realTarget);
		return realRelative !== "" && !realRelative.startsWith(`..${sep}`) && !isAbsolute(realRelative);
	} catch {
		return false;
	}
}

export function validateReadmeFacts(input, projectRoot = process.cwd()) {
	const issues = [];
	const report = (problems) => ({
		valid: problems.length === 0,
		validation_scope: "structure-only",
		factual_accuracy: "not-checked",
		source_contents_compared: false,
		badge_truth_checked: false,
		issues: problems,
	});
	if (!isRecord(input)) return report(["facts document must be an object"]);
	if (input.schema_id !== "litcodex.readme-facts/v1") issues.push("schema_id must be litcodex.readme-facts/v1");
	if (!Array.isArray(input.facts) || input.facts.length === 0) {
		issues.push("facts must contain at least one sourced claim");
	} else {
		const seen = new Set();
		let root;
		try {
			root = realpathSync(projectRoot);
		} catch {
			return report(["project root must be an existing directory"]);
		}
		if (!lstatSync(root).isDirectory()) return report(["project root must be an existing directory"]);
		for (const fact of input.facts) {
			if (!isRecord(fact)) {
				issues.push("each fact must be an object");
				continue;
			}
			const claim = nonEmptyString(fact.claim) ? fact.claim.trim() : "<unnamed claim>";
			if (!nonEmptyString(fact.claim)) issues.push("each fact needs a non-empty claim id");
			if (seen.has(claim)) issues.push(`${claim} is duplicated`);
			seen.add(claim);
			if (!nonEmptyString(fact.value)) issues.push(`${claim} needs a non-empty value`);
			if (!safeEvidenceFile(root, fact.source)) issues.push(`${claim} must cite a regular non-symlink file using a safe relative evidence path`);
		}
	}
	if (input.badges !== undefined && !Array.isArray(input.badges)) {
		issues.push("badges must be an array when present");
	} else if (Array.isArray(input.badges)) {
		let root;
		try {
			root = realpathSync(projectRoot);
		} catch {
			return report([...issues, "project root must be an existing directory"]);
		}
		for (const badge of input.badges) {
			if (!isRecord(badge) || !nonEmptyString(badge.label)) {
				issues.push("each badge needs a non-empty label");
				continue;
			}
			if (!safeHttpUrl(badge.url)) issues.push(`badge ${badge.label} must use an absolute http(s) URL without embedded credentials`);
			if (!safeEvidenceFile(root, badge.source)) issues.push(`badge ${badge.label} must cite a regular non-symlink evidence file`);
		}
	}
	return report(issues);
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		if (key !== "--facts" && key !== "--project-root") throw new Error(`unknown option ${key}`);
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`${key} requires a value`);
		options[key === "--facts" ? "facts" : "projectRoot"] = value;
		index += 1;
	}
	if (!options.facts || !options.projectRoot) throw new Error("usage: validate-readme-facts.mjs --facts <json-file> --project-root <repository-root>");
	return options;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const result = validateReadmeFacts(JSON.parse(readFileSync(resolve(options.facts), "utf8")), resolve(options.projectRoot));
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		if (!result.valid) process.exitCode = 1;
	} catch (error) {
		process.stderr.write(`readme-studio: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
