// src/stack-hook.ts — what a lit prompt does to the session's workflow stack.
//
// The hook sees only the route it matched, so the stack learns from that and from the saved work state:
// before a newcomer pauses the frame below it, the paused frame is given the k/n the card already reads
// (start-work tasks, lit-loop goals) when the model has not recorded a count of its own. Every call
// fails open; a prompt is never delayed or changed because the stack could not be written.
import { isRestartPrompt } from "./reentry.js";
import { readWorkflowSignals } from "./workflow-map.js";
import { pausedSpine, readStack, recordStackEvent } from "./workflow-stack.js";
/** Count the saved work state puts on a frame of this skill, or null when it names none. */
function savedCounts(frame, cwd, sessionId) {
    const signals = readWorkflowSignals(cwd, sessionId);
    if (frame.skill === "start-work" || frame.skill === "litwork") {
        return signals.work === null ? null : { n: signals.work.done, total: signals.work.total };
    }
    if (frame.skill === "lit-loop" || frame.skill === "litgoal") {
        return signals.goals === null ? null : { n: signals.goals.done, total: signals.goals.total };
    }
    return null;
}
/** Give the running top frame the saved count it lacks, so a pause keeps the k/n it left. */
function snapshotTopCounts(stack, cwd, sessionId, now) {
    const top = stack.frames.at(-1);
    if (top === undefined || top.status !== "active" || top.family === null || top.stage === null)
        return;
    if (top.n !== undefined && top.total !== undefined)
        return;
    const counts = savedCounts(top, cwd, sessionId);
    if (counts === null)
        return;
    recordStackEvent(cwd, sessionId, { type: "record", family: top.family, stage: top.stage, n: top.n ?? counts.n, total: top.total ?? counts.total }, now);
}
/** The frame a `lit continue` returns to, read before the prompt is routed; null when nothing is paused. */
export function frameToResume(cwd, sessionId) {
    try {
        return pausedSpine(readStack(cwd, sessionId));
    }
    catch {
        return null;
    }
}
/** Apply one matched prompt to the stack: `lit continue` closes the side frames, any other route starts. */
export function applyPromptToStack(cwd, sessionId, prompt, route, now = new Date()) {
    try {
        if (route.continued) {
            recordStackEvent(cwd, sessionId, { type: "continue" }, now);
            return;
        }
        if (route.mode === null)
            return;
        snapshotTopCounts(readStack(cwd, sessionId), cwd, sessionId, now);
        recordStackEvent(cwd, sessionId, { type: "start", skill: route.mode, restart: isRestartPrompt(prompt) }, now);
    }
    catch {
        // The stack only decorates the card and the resume note.
    }
}
