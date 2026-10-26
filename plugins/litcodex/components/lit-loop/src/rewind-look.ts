// src/rewind-look.ts — turns the rewind look (rainbow card, tinted HUD line) on for the session that runs the lit-adhd
// brief. The UserPromptSubmit hook marks a typed `lit adhd`; every other route (a scoped `$litcodex:lit-adhd` mention,
// Codex loading the skill by itself, a collector run by hand) never reaches that hook, so the collector marks the look
// when it runs. The mark is the same turn record the hook writes, in the same session folder, so it ends the same way:
// the session's next LIT activation replaces it.

import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { readThreadPointer, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { recordWorkflowTurn, workflowTurn } from "./workflow-map.js";

const MODE = "lit-adhd";

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Mark `sessionId` as running lit-adhd. The workspace is the one the session's pointer already names, so a run from a
 * subfolder cannot leave state beside the wrong folder; with no pointer it is the run's own folder. A turn the hook
 * already recorded as lit-adhd is left as it is, so that turn's Stop card still matches. Never throws.
 */
export function markRewindLook(cwd: string, sessionId: string, env: NodeJS.ProcessEnv, now = Date.now()): void {
	try {
		const pointed = readThreadPointer(env, sessionId)?.cwd;
		const root = pointed !== undefined && isFolder(pointed) ? pointed : cwd;
		if (!isAbsolute(root) || !isFolder(root)) return;
		if (workflowTurn(root, sessionId)?.mode !== MODE) {
			recordWorkflowTurn(root, sessionId, `rewind-${now}`, MODE, now);
			if (workflowTurn(root, sessionId)?.mode !== MODE) return;
			recordTurnStart(root, sessionId, now);
		}
		writeThreadPointer(env, sessionId, root, now);
	} catch {
		// The brief is what the person asked for; the look only decorates it.
	}
}
