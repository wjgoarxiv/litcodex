// src/run-end.ts — how each LIT run ended: `sent`, `nothing` or `waiting`.
//
// The lit-loop Stop hook is the run-end point of a LIT thread: the turn that ignited a LIT skill closes there. It
// then leaves one line in `.litcodex/run-end/outcomes.jsonl`:
//
//   sent      the turn closed with its summary card, the report LitCodex itself prints
//   waiting   the last assistant message asks the user something or reports BLOCKED, so the run waits on a person
//   nothing   the Stop has no card to print for the recorded turn
//
// A Stop that start-work keeps running (the `⏳ … continuing` line) is not an end and writes nothing, and a
// session that never ignited LIT writes nothing, so other projects get no `.litcodex` folder. The record is
// append-only, capped, never written through a symlink, and every failure is silent: the Stop output is the same
// with or without it.
import { appendFileSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { plainDirsOrMissing, writeFileAtomic } from "./live-step.js";
import { normalizeSessionId } from "./state-paths.js";
import { CONTINUING_MARK } from "./workflow-map.js";
const RUN_END_DIR = ".litcodex/run-end";
const RUN_END_FILE = "outcomes.jsonl";
/** Past this the oldest lines are dropped before the next one is appended. */
const MAX_BYTES = 32 * 1024;
const KEEP_LINES = 100;
const OUTCOMES = ["sent", "nothing", "waiting"];
export function runEndPath(repoRoot) {
    return join(repoRoot, RUN_END_DIR, RUN_END_FILE);
}
/**
 * The outcome for a turn that just closed, or null when the run is not over. `line` is the Stop line
 * `workflowStopLine` made for the recorded turn (null when it made none) and `waitReason` what
 * `detectWaitReason` read from the last assistant message.
 */
export function outcomeFor(line, waitReason) {
    if (line?.startsWith(CONTINUING_MARK) === true)
        return null;
    if (waitReason !== null)
        return "waiting";
    return line === null ? "nothing" : "sent";
}
/** Append one run end. Never throws. */
export function recordRunEnd(repoRoot, sessionId, entry, now = Date.now()) {
    try {
        const session = normalizeSessionId(sessionId);
        if (session === null || !plainDirsOrMissing(repoRoot, RUN_END_DIR))
            return;
        const path = runEndPath(repoRoot);
        const existing = lstatSync(path, { throwIfNoEntry: false });
        if (existing !== undefined && !existing.isFile())
            return;
        mkdirSync(join(repoRoot, RUN_END_DIR), { recursive: true });
        if (existing !== undefined && existing.size >= MAX_BYTES) {
            const kept = readFileSync(path, "utf8").split("\n").filter(Boolean).slice(-KEEP_LINES);
            writeFileAtomic(path, `${kept.join("\n")}\n`);
        }
        const line = { version: 1, at: now, session, mode: entry.mode, outcome: entry.outcome };
        appendFileSync(path, `${JSON.stringify(line)}\n`);
    }
    catch {
        // The Stop output does not depend on this record.
    }
}
/** Every well-formed run end, oldest first; a corrupt line is skipped and an unreadable file reads as empty. */
export function readRunEnds(repoRoot) {
    try {
        const path = runEndPath(repoRoot);
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat === undefined || !stat.isFile() || stat.size > 4 * MAX_BYTES)
            return [];
        const ends = [];
        for (const line of readFileSync(path, "utf8").split("\n")) {
            try {
                const entry = JSON.parse(line);
                if (typeof entry === "object" &&
                    entry !== null &&
                    entry["version"] === 1 &&
                    typeof entry["at"] === "number" &&
                    typeof entry["session"] === "string" &&
                    typeof entry["mode"] === "string" &&
                    typeof entry["outcome"] === "string" &&
                    OUTCOMES.includes(entry["outcome"])) {
                    ends.push(entry);
                }
            }
            catch {
                // a corrupt line is skipped
            }
        }
        return ends;
    }
    catch {
        return [];
    }
}
