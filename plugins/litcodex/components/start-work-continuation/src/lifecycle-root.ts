import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { inspectLifecycleState, type LifecycleState } from "./lifecycle-store.js";

const MAX_LEVELS = 64;
const MAX_POINTER_BYTES = 4096;

/**
 * The folder whose start-work state a hook in `cwd` should act on. From `cwd` upward, the nearest folder whose
 * state holds a nonterminal run (or, with `wantSession`, a cancel notice for that session) wins, so a nested
 * project's own run beats an outer one. A linked Git worktree falls back to its main checkout. With neither, the
 * answer is `cwd` itself, as before. Only files are read; no subprocess runs inside the hook's time budget.
 */
export function findLifecycleRoot(cwd: string, options: { readonly wantSession?: string } = {}): string {
	let start: string;
	try {
		start = realpathSync(cwd);
	} catch {
		return cwd;
	}
	let dir = start;
	for (let level = 0; level < MAX_LEVELS; level += 1) {
		if (holdsRun(dir, options.wantSession)) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const main = mainCheckoutOf(start);
	if (main !== null && holdsRun(main, options.wantSession)) return main;
	return start;
}

function holdsRun(dir: string, wantSession: string | undefined): boolean {
	try {
		if (!lstatSync(join(dir, ".litcodex", "start-work", "state.json")).isFile()) return false;
	} catch {
		return false;
	}
	const inspected = inspectLifecycleState(dir);
	if (!inspected.ok) return false;
	return hasNonterminalRun(inspected.state) || (wantSession !== undefined && hasNotice(inspected.state, wantSession));
}

function hasNonterminalRun(state: LifecycleState): boolean {
	if (state.active_work_id === null) return false;
	const status = state.works[state.active_work_id]?.status;
	return status === "active" || status === "paused";
}

function hasNotice(state: LifecycleState, sessionId: string): boolean {
	return state.cancel_notices?.[`codex:${sessionId}`] !== undefined;
}

/** The main checkout behind the nearest `.git` file (`gitdir:` → `commondir`), or null. */
function mainCheckoutOf(start: string): string | null {
	let dir = start;
	for (let level = 0; level < MAX_LEVELS; level += 1) {
		const marker = join(dir, ".git");
		let isFile = false;
		let exists = false;
		try {
			const stat = lstatSync(marker);
			exists = true;
			isFile = stat.isFile();
		} catch {
			// No marker at this level.
		}
		if (exists) {
			if (!isFile) return null;
			const pointer = readSmall(marker)?.match(/^gitdir:[ \t]*(.+?)[ \t]*$/mu)?.[1];
			if (pointer === undefined) return null;
			const gitdir = isAbsolute(pointer) ? pointer : resolve(dir, pointer);
			const common = readSmall(join(gitdir, "commondir"))?.trim();
			if (common === undefined || common.length === 0) return null;
			const commonDir = resolve(gitdir, common);
			if (basename(commonDir) !== ".git") return null;
			try {
				return realpathSync(dirname(commonDir));
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}

function readSmall(path: string): string | undefined {
	const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	let fd: number | undefined;
	try {
		fd = openSync(path, constants.O_RDONLY | noFollow);
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > MAX_POINTER_BYTES) return undefined;
		const buffer = Buffer.alloc(stat.size);
		const read = readSync(fd, buffer, 0, buffer.byteLength, 0);
		return buffer.subarray(0, read).toString("utf8");
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
