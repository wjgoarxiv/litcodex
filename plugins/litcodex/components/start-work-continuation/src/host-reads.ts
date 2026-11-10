import { basename, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonical, codexHomeOf } from "./protected-paths.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * True when reading `root` belongs to the Codex host rather than to the plan: this session's own rollout file, the
 * Codex home's `AGENTS.md`, `skills/`, `agents/` and `litcodex/` folders, the transcript Codex named, or this
 * plugin. Such a read never needs a boundary. A folder under `sessions/` is not included, since listing it shows
 * other sessions. The protected-path check runs first and always wins.
 */
export function isHostOwnedRead(
	root: string,
	sessionId: string,
	env: NodeJS.ProcessEnv = process.env,
	transcriptPath?: string,
): boolean {
	const target = canonical(root);
	if (transcriptPath !== undefined && isAbsolute(transcriptPath) && canonical(transcriptPath) === target) return true;
	if (within(canonical(PLUGIN_ROOT), target)) return true;
	const home = codexHomeOf(env);
	if (home === null) return false;
	if (within(join(home, "sessions"), target)) {
		return basename(target).toLowerCase().endsWith(`-${sessionId.toLowerCase()}.jsonl`);
	}
	if (target === canonical(join(home, "AGENTS.md"))) return true;
	return ["skills", "agents", "litcodex"].some((folder) => within(canonical(join(home, folder)), target));
}

function within(base: string, candidate: string): boolean {
	const rel = relative(base, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
