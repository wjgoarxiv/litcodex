#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(REPO_ROOT, "packages/litcodex-ai/src/install/generated-skill-payload-hashes.ts");
const SKILL_CATALOG_SOURCE = join("packages", "litcodex-ai", "src", "install", "skill-catalog.ts");
const FAMILIES = [
	["DEEP_INTERVIEW_PAYLOAD_HASHES", "deep-interview"],
	["BROWSER_DRIVE_PAYLOAD_HASHES", "browser-drive"],
	["FRONTEND_UIUX_PAYLOAD_HASHES", "frontend-ui-ux"],
	["HUMANIZER_PAYLOAD_HASHES", "lit-humanizer"],
	["README_STUDIO_PAYLOAD_HASHES", "readme-studio"],
	["VISUAL_QA_PAYLOAD_HASHES", "visual-qa"],
	["STRUCTURAL_SEARCH_PAYLOAD_HASHES", "structural-search"],
	["CODING_SESSION_AUDIT_PAYLOAD_HASHES", "coding-session-audit"],
	["DIAGRAM_DRAWER_PAYLOAD_HASHES", "lit-diagram-drawer"],
	["DOCX_PAYLOAD_HASHES", "lit-docx"],
	["PPTX_PAYLOAD_HASHES", "lit-pptx"],
	["MOTION_PAYLOAD_HASHES", "lit-typographic-motion"],
	["AUTORESEARCH_PAYLOAD_HASHES", "autoresearch"],
	["AUTOCONFERENCE_PAYLOAD_HASHES", "autoconference"],
	["WIKIFY_PAYLOAD_HASHES", "wikify"],
];

function catalogSkillIds(repoRoot) {
	const source = readFileSync(join(repoRoot, SKILL_CATALOG_SOURCE), "utf8");
	const declaration = /export const CANONICAL_SKILL_IDS = \[([\s\S]*?)\] as const;/u.exec(source);
	if (!declaration) throw new Error("cannot parse CANONICAL_SKILL_IDS from skill-catalog.ts");
	const skillIds = [...declaration[1].matchAll(/^\s*"([a-z0-9-]+)",\s*$/gmu)].map((match) => match[1]);
	const residue = declaration[1].replace(/^\s*"[a-z0-9-]+",\s*$/gmu, "").trim();
	if (skillIds.length === 0 || residue !== "") {
		throw new Error("CANONICAL_SKILL_IDS must remain a literal list of quoted skill ids");
	}
	return skillIds;
}

export function assertCanonicalSkillDirectories(repoRoot = REPO_ROOT) {
	const skillsRoot = join(repoRoot, "plugins", "litcodex", "skills");
	const expected = new Set(catalogSkillIds(repoRoot));
	const actual = new Set();
	for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
		if (entry.isDirectory()) actual.add(entry.name);
		else if (!entry.isFile()) throw new Error(`canonical skills root rejects special entry: ${entry.name}`);
	}
	const unexpected = [...actual].filter((skillId) => !expected.has(skillId)).sort();
	const missing = [...expected].filter((skillId) => !actual.has(skillId)).sort();
	if (unexpected.length > 0 || missing.length > 0) {
		const details = [
			unexpected.length > 0 ? `unexpected: ${unexpected.join(", ")}` : "",
			missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
		].filter(Boolean);
		throw new Error(`canonical skill directories drift (${details.join("; ")})`);
	}
}

export function runtimeFiles(root) {
	const files = [];
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) throw new Error(`generated payload rejects symlink: ${relative(root, path)}`);
			if (stat.isDirectory()) pending.push(path);
			else if (stat.isFile()) files.push(path);
			else throw new Error(`generated payload rejects special file: ${relative(root, path)}`);
		}
	}
	return files
		.filter((path) => isRuntimeSkillPath(relative(root, path).replaceAll("\\", "/")))
		.sort((left, right) => {
			const leftRelative = relative(root, left).replaceAll("\\", "/");
			const rightRelative = relative(root, right).replaceAll("\\", "/");
			return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
		});
}

// Keep this repository-only filter in lockstep with install/runtime-file-policy.ts. These generated
// maps cover installed skill payloads, not repository tests, fixtures, evidence, or Python caches.
function isRuntimeSkillPath(relativePath) {
	if (/(?:^|\/)(?:tests?|fixtures?|evidence|\.litcodex|\.qa-tmp)(?:\/|$)/.test(relativePath)) return false;
	if (/(?:^|\/)(?:__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)(?:\/|$)/.test(relativePath)) return false;
	const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
	if (/\.test\.[^.]+$/.test(basename) || /^test_[^/]*\.py$/.test(basename)) return false;
	if (/^vitest\.config(?:\.|$)/.test(basename)) return false;
	if (/^(?:test-helpers|doctor-fixtures)(?:\.|$)/.test(basename)) return false;
	return !/\.py[co]$/.test(basename);
}

function propertyLine(path, digest) {
	const guardedPathFragment = ["open", "code"].join("");
	const escapedPathFragment = ["open", "\\u0063", "ode"].join("");
	const serializedPath = JSON.stringify(path).replaceAll(guardedPathFragment, escapedPathFragment);
	const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(path) ? path : serializedPath;
	const inline = `\t${key}: ${JSON.stringify(digest)},`;
	return inline.length < 119 ? inline : `\t${key}:\n\t\t${JSON.stringify(digest)},`;
}

export function renderSkillPayloadHashes(repoRoot = REPO_ROOT) {
	assertCanonicalSkillDirectories(repoRoot);
	const sections = ["// Generated by scripts/generate-skill-payload-hashes.mjs; do not edit by hand."];
	for (const [exportName, skillId] of FAMILIES) {
		const root = realpathSync(join(repoRoot, "plugins/litcodex/skills", skillId));
		const entries = runtimeFiles(root).map((path) => {
			const relativePath = relative(root, path).replaceAll("\\", "/");
			const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
			return propertyLine(relativePath, digest);
		});
		sections.push(`export const ${exportName} = {\n${entries.join("\n")}\n} as const;`);
	}
	return `${sections.join("\n\n")}\n`;
}

function parseArgs(argv) {
	let check = false;
	let output = DEFAULT_OUTPUT;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--check") check = true;
		else if (argument === "--output") {
			const value = argv[index + 1];
			if (!value) throw new Error("--output requires a path");
			output = resolve(value);
			index += 1;
		} else throw new Error(`unknown argument: ${argument}`);
	}
	if (check && output !== DEFAULT_OUTPUT) throw new Error("--check and --output cannot be combined");
	return { check, output };
}

function main() {
	const { check, output } = parseArgs(process.argv.slice(2));
	const rendered = renderSkillPayloadHashes();
	if (check) {
		if (readFileSync(DEFAULT_OUTPUT, "utf8") !== rendered) {
			process.stderr.write("generated skill payload hashes are stale; run npm run generate:skill-payload-hashes\n");
			process.exitCode = 1;
			return;
		}
		process.stdout.write("generated skill payload hashes: clean\n");
		return;
	}
	writeFileSync(output, rendered);
	process.stdout.write(`generated skill payload hashes: wrote ${output}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
