#!/usr/bin/env node
// scripts/check-workspaces.mjs — assert every declared workspace exists with the expected npm name.
// Exit 0 = all ok; 1 = a workspace dir/manifest missing or name mismatch; 2 = root manifest fault.
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// npm-workspace name map (NOT the Codex plugin manifest name; addendum §C).
const EXPECTED_NAMES = [
	["packages/litcodex-ai", "@litfamily/litcodex"],
	["plugins/litcodex", "@litcodex/plugin"],
	["plugins/litcodex/components/lit-loop", "@litcodex/lit-loop"],
	["plugins/litcodex/components/git-bash", "@litcodex/git-bash"],
	["plugins/litcodex/components/comment-checker", "@litcodex/comment-checker"],
	["plugins/litcodex/components/lsp", "@litcodex/lsp"],
	["plugins/litcodex/components/start-work-continuation", "@litcodex/start-work-continuation"],
	["plugins/litcodex/components/telemetry", "@litcodex/telemetry"],
	["plugins/litcodex/components/rules", "@litcodex/rules"],
	["plugins/litcodex/components/auto-update", "@litcodex/auto-update"],
	["plugins/litcodex/components/wikify-knowledge", "@litcodex/wikify-knowledge"],
];

function readRootWorkspaces() {
	let raw;
	try {
		raw = readFileSync(resolve(REPO_ROOT, "package.json"), "utf8");
	} catch {
		return { error: { code: "ROOT_MANIFEST_UNREADABLE", detail: "root package.json unreadable" } };
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { error: { code: "ROOT_MANIFEST_UNREADABLE", detail: "root package.json malformed JSON" } };
	}
	if (!Array.isArray(parsed.workspaces)) {
		return { error: { code: "WORKSPACES_MALFORMED", detail: "workspaces is not an array" } };
	}
	return { workspaces: parsed.workspaces };
}

function checkWorkspace(relPath, expectedName) {
	const dir = resolve(REPO_ROOT, relPath);
	let stat;
	try {
		stat = lstatSync(dir);
	} catch {
		return { code: "WORKSPACE_DIR_MISSING", path: relPath, detail: "directory missing" };
	}
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		return { code: "WORKSPACE_DIR_MISSING", path: relPath, detail: "not a real directory" };
	}
	let manifestRaw;
	try {
		manifestRaw = readFileSync(resolve(dir, "package.json"), "utf8");
	} catch {
		return { code: "WORKSPACE_MANIFEST_MISSING", path: relPath, detail: "package.json missing" };
	}
	let manifest;
	try {
		manifest = JSON.parse(manifestRaw);
	} catch {
		return { code: "WORKSPACE_MANIFEST_MISSING", path: relPath, detail: "package.json malformed JSON" };
	}
	if (manifest.name !== expectedName) {
		return {
			code: "WORKSPACE_NAME_MISMATCH",
			path: relPath,
			detail: `expected ${expectedName}, found ${String(manifest.name)}`,
		};
	}
	return null;
}

function main() {
	const json = process.argv.slice(2).includes("--json");
	const root = readRootWorkspaces();
	if (root.error) {
		const payload = { ok: false, errors: [root.error] };
		process.stderr.write(
			json ? `${JSON.stringify(payload)}\n` : `check:workspaces: ${root.error.code} ${root.error.detail}\n`,
		);
		process.exit(2);
	}

	const errors = [];
	const ok = [];
	for (const [relPath, expectedName] of EXPECTED_NAMES) {
		const err = checkWorkspace(relPath, expectedName);
		if (err) {
			errors.push(err);
		} else {
			ok.push({ name: expectedName, path: relPath });
		}
	}

	if (errors.length > 0) {
		const payload = { ok: false, errors };
		if (json) {
			process.stderr.write(`${JSON.stringify(payload)}\n`);
		} else {
			for (const e of errors) {
				process.stderr.write(`check:workspaces: ${e.code} ${e.path} (${e.detail})\n`);
			}
		}
		process.exit(1);
	}

	if (json) {
		process.stdout.write(`${JSON.stringify({ ok: true, workspaces: ok })}\n`);
	} else {
		for (const w of ok) {
			process.stdout.write(`OK ${w.name} ${w.path}\n`);
		}
		process.stdout.write(`workspaces: ${ok.length} ok\n`);
	}
	process.exit(0);
}

main();
