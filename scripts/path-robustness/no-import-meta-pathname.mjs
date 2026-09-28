#!/usr/bin/env node
// scripts/path-robustness/no-import-meta-pathname.mjs — M20 static path-fragility lint (T24).
//
// AST-free, line-based source scanner. It flags the single most probable latent path bug inherited
// from the reference archive: `import.meta.url` `.pathname` access (which silently percent-mangles
// paths containing spaces / `#` / non-ASCII), and deriving a repo/component root from the module URL
// instead of `process.cwd()` / an explicit argument. The fix is always `fileURLToPath(import.meta.url)`.
//
// Excludes test files (allowed to use fileURLToPath / .pathname for fixtures), `dist/`,
// `node_modules/`, `.litcodex/`, and `# REFERENCE/`. Pure + read-only; never throws on a single
// unreadable file (records nothing, continues). Throws LIT_PATHROBUST_SCAN_ROOT_MISSING only when an
// entire required root dir is absent (a broken checkout). Exit 0 = clean, 2 = >=1 hit, 4 = missing root.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { PathRobustnessError } from "./errors.mjs";

const SCAN_EXTENSIONS = new Set([".ts", ".mjs", ".js"]);
const EXCLUDED_SEGMENTS = ["dist", "node_modules", ".litcodex"];

/** True for a path that must never be scanned (built output, deps, reference archive, test files). */
function isExcludedPath(absPath) {
	const parts = absPath.split(sep);
	if (parts.some((part) => EXCLUDED_SEGMENTS.includes(part))) {
		return true;
	}
	if (absPath.includes("# REFERENCE")) {
		return true;
	}
	const base = parts[parts.length - 1] ?? "";
	return /\.(test|spec)\.[cm]?[jt]s$/.test(base);
}

/** `import.meta.url` driven `.pathname` access — the reference's exact percent-mangling bug. */
function matchImportMetaPathname(line) {
	if (!line.includes("import.meta.url")) {
		return false;
	}
	return /import\.meta\.url[\s\S]*?\.pathname/.test(line) || /\.pathname/.test(line);
}

/** A repo/component root assigned FROM the module URL (must come from process.cwd()/an explicit arg). */
function matchReporootFromModuleUrl(line) {
	if (!/repo_?root|repoRoot|projectRoot|packageRoot|componentRoot/i.test(line)) {
		return false;
	}
	if (!/[=:]/.test(line)) {
		return false;
	}
	return /import\.meta\.url/.test(line);
}

/** Recursively collect scannable source files under one root (absolute paths). */
async function collectFiles(rootAbs, out) {
	const entries = await readdir(rootAbs, { withFileTypes: true });
	for (const entry of entries) {
		const childAbs = join(rootAbs, entry.name);
		if (isExcludedPath(childAbs)) {
			continue;
		}
		if (entry.isDirectory()) {
			await collectFiles(childAbs, out);
		} else if (entry.isFile()) {
			const dot = entry.name.lastIndexOf(".");
			if (dot >= 0 && SCAN_EXTENSIONS.has(entry.name.slice(dot))) {
				out.push(childAbs);
			}
		}
	}
}

/**
 * Pure scan over the given absolute source roots. Returns sorted hits (by file, then line); [] when
 * clean. Throws LIT_PATHROBUST_SCAN_ROOT_MISSING if a root dir is entirely absent. `repoRoot` is used
 * only to render repo-relative paths in the hits — never to derive scan behavior.
 */
export async function scanForbiddenPathPatterns(roots, repoRoot = process.cwd()) {
	const hits = [];
	for (const rootAbs of roots) {
		let info;
		try {
			info = await stat(rootAbs);
		} catch {
			throw new PathRobustnessError("LIT_PATHROBUST_SCAN_ROOT_MISSING", rootAbs);
		}
		if (!info.isDirectory()) {
			throw new PathRobustnessError("LIT_PATHROBUST_SCAN_ROOT_MISSING", rootAbs);
		}
		const files = [];
		await collectFiles(rootAbs, files);
		for (const fileAbs of files) {
			let text;
			try {
				text = await readFile(fileAbs, "utf8");
			} catch {
				continue;
			}
			const lines = text.split(/\r\n|\r|\n/);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (matchImportMetaPathname(line)) {
					hits.push({
						file: relative(repoRoot, fileAbs),
						line: i + 1,
						rule: "IMPORT_META_PATHNAME",
						snippet: line.trim(),
					});
				} else if (matchReporootFromModuleUrl(line)) {
					hits.push({
						file: relative(repoRoot, fileAbs),
						line: i + 1,
						rule: "REPOROOT_FROM_MODULE_URL",
						snippet: line.trim(),
					});
				}
			}
		}
	}
	hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
	return hits;
}

/** The default scan roots (absolute) for the real LitCodex tree, anchored at `repoRoot`. */
export function defaultScanRoots(repoRoot) {
	return [
		join(repoRoot, "packages/litcodex-ai/src"),
		join(repoRoot, "packages/litcodex-ai/bin"),
		join(repoRoot, "plugins/litcodex/components/lit-loop/src"),
	];
}

/** Standalone CLI: `node no-import-meta-pathname.mjs [root...]`. Exit 0 clean / 2 hits / 4 missing root. */
async function main() {
	const repoRoot = process.cwd();
	const argv = process.argv.slice(2);
	const roots =
		argv.length > 0 ? argv.map((r) => (r.startsWith(sep) ? r : join(repoRoot, r))) : defaultScanRoots(repoRoot);
	try {
		const hits = await scanForbiddenPathPatterns(roots, repoRoot);
		for (const hit of hits) {
			process.stdout.write(`${hit.file}:${hit.line} ${hit.rule} :: ${hit.snippet}\n`);
		}
		process.stdout.write(`forbidden-path-patterns: ${hits.length} hit(s)\n`);
		process.exit(hits.length === 0 ? 0 : 2);
	} catch (err) {
		if (err instanceof PathRobustnessError && err.code === "LIT_PATHROBUST_SCAN_ROOT_MISSING") {
			process.stderr.write(`${JSON.stringify({ ok: false, error: { code: err.code, message: err.message } })}\n`);
			process.exit(4);
		}
		throw err;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
