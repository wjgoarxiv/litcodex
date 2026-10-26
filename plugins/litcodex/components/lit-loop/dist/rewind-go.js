// src/rewind-go.ts — `go` after a lit-adhd brief runs the one step the brief named.
//
// The whole prompt `go`, `lit go`, `ㄱㄱ`, `고` or `진행` is read only when this session has a next-step note
// (`.litcodex/adhd/next-<session>.json`, written by the brief) and it is at most 30 minutes old. The note is
// bound to the session by its file name and deleted as soon as it is read, so one brief buys one `go`. The
// step is checked again against the saved state before it runs, and a boundary waiting for an answer is
// never started this way. A `go` that fits becomes the ordinary prompt of that step (`lit continue` or
// `start-work <plan>`), so it goes through the same routes, stack and contracts as if the user had typed it.
import { rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { clean } from "./control-chars.js";
import { plainDirsOrMissing, readSmallJson } from "./live-step.js";
import { ADHD_DIR, chooseNext, GO_WINDOW_MS } from "./rewind.js";
import { normalizeSessionId } from "./state-paths.js";
const GO_PROMPT = /^\s*(?:(?:lit\s+)?go|ㄱㄱ|고|진행)[\s.!?]*$/iu;
const MAX_NOTE_BYTES = 8 * 1024;
/** True for the whole prompt being a go word; `go ahead and fix it` is an ordinary request. */
export function isGoPrompt(prompt) {
    return GO_PROMPT.test(prompt);
}
const KINDS = ["resume-frame", "approve-boundary", "continue-work", "start-plan"];
function readNote(cwd, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (id === null || !isAbsolute(cwd) || !plainDirsOrMissing(cwd, ADHD_DIR))
        return null;
    const path = join(cwd, ADHD_DIR, `next-${id}.json`);
    const record = readSmallJson(path, MAX_NOTE_BYTES);
    if (record === null)
        return null;
    // Read once: the note is gone before it is judged, whatever the outcome.
    try {
        rmSync(path, { force: true });
    }
    catch {
        // A note that cannot be removed still expires on its own.
    }
    if (typeof record !== "object" || Array.isArray(record))
        return null;
    const fields = record;
    if (fields["sessionId"] !== sessionId && normalizeSessionId(String(fields["sessionId"])) !== id)
        return null;
    const kind = fields["kind"];
    const at = fields["at"];
    if (typeof kind !== "string" || !KINDS.includes(kind) || typeof at !== "number")
        return null;
    return {
        kind: kind,
        at,
        plan: typeof fields["plan"] === "string" ? fields["plan"] : null,
        text: typeof fields["text"] === "string" ? clean(fields["text"]) : "",
    };
}
const EXPIRED = "The user said `go`, but the briefed next step is older than 30 minutes, so nothing was started. Tell the user that in one sentence and offer `lit adhd` for a fresh brief; start no other work.";
const STALE = "The user said `go`, but the briefed next step no longer holds, so nothing was started. Tell the user that in one sentence and offer `lit adhd` for a fresh brief; start no other work.";
const BOUNDARY = "The user said `go`, but the briefed step is a start-work boundary waiting for an answer. `go` never approves it: tell the user in one sentence to answer `lit approve` or `lit deny` themselves; start nothing.";
/**
 * What a go-word prompt means in this session. Null when the session has no note (the prompt is then an
 * ordinary one); a hint when a note existed but cannot run; otherwise the prompt to route in its place.
 */
export function takeGo(cwd, sessionId, now) {
    const note = readNote(cwd, sessionId);
    if (note === null)
        return null;
    if (now - note.at > GO_WINDOW_MS || note.at > now + 60_000)
        return { kind: "hint", text: EXPIRED };
    if (note.kind === "approve-boundary")
        return { kind: "hint", text: BOUNDARY };
    const fresh = chooseNext(cwd, sessionId);
    if (fresh.kind !== note.kind || (note.kind === "start-plan" && fresh.plan !== note.plan)) {
        return { kind: "hint", text: STALE };
    }
    if (note.kind === "start-plan" && fresh.plan !== undefined) {
        return { kind: "run", prompt: `start-work ${fresh.plan.replace(/\.md$/u, "")}`, note: `go: ${fresh.text}` };
    }
    return { kind: "run", prompt: "lit continue", note: `go: ${fresh.text}` };
}
const BOUNDARY_ANSWER = /^lit[ \t]+(?:approve|승인|deny|거절)$/u;
/**
 * True for the whole prompt `lit approve`, `lit deny`, `lit 승인` or `lit 거절`. The start-work lifecycle hook
 * owns these words; this hook stays silent for them so a bare `lit` never starts a loop on top of an answer.
 */
export function isBoundaryAnswer(prompt) {
    return prompt.length <= 512 && BOUNDARY_ANSWER.test(prompt.trim());
}
