// scripts/path-robustness/fs-snapshot.mjs — M20 path-set snapshot/diff for state containment (T24).
//
// Walks a workspace tree and returns the set of paths under it, EXCLUDING the staged `.harness/`
// artifacts and the marker `.git/` dir (neither is CLI-written state). The diff feeds the containment
// check: every path a probe newly creates must land under `<workspaceRoot>/.litcodex/`.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([".harness", ".git", "node_modules"]);

/** Recursively collect paths under `root` (relative, sep-joined), skipping staged-artifact dirs. */
function walk(root, prefix, out) {
	let entries;
	try {
		entries = readdirSync(join(root, prefix), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (prefix === "" && SKIP_DIRS.has(entry.name)) {
			continue;
		}
		const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		out.add(rel);
		if (entry.isDirectory()) {
			walk(root, rel, out);
		}
	}
}

/** Snapshot the set of (relative) paths under `workspaceRoot`, minus staged-artifact dirs. */
export function snapshotPaths(workspaceRoot) {
	const out = new Set();
	walk(workspaceRoot, "", out);
	return out;
}

/** Absolute paths present now but absent in `before`. */
export function diffNewPaths(workspaceRoot, before) {
	const now = snapshotPaths(workspaceRoot);
	const created = [];
	for (const rel of now) {
		if (!before.has(rel)) {
			created.push(join(workspaceRoot, rel));
		}
	}
	return created;
}
