// src/reentry.ts — what a repeated `lit …` prompt does in a session that already ignited a discipline.
//
// The first `lit …` of a session sends the route's full activation. After that the model already holds
// the contract, so the same discipline continues with a short note, a different discipline switches with
// its full activation, a bare `lit` over approved or running work resumes it, and `lit new …` or
// `lit restart …` starts again in full. "Active" is only what this module saved for the session when it
// last sent an activation (never model text): one small file per session id under `.litcodex/lit-reentry/`.
// A compaction drops the contract from the model's context, so PostCompact deletes the file. A missing,
// linked or malformed file means "nothing active", which is the full activation: every read fails open.
import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { plainDirsOrMissing, writeFileAtomic } from "./live-step.js";
import { MODE_BY_TOKEN } from "./modes.js";
import { normalizeSessionId } from "./state-paths.js";
import { maskMarkdownCode } from "./trigger.js";
import { readWorkflowSignals } from "./workflow-map.js";
export const REENTRY_DIR = ".litcodex/lit-reentry";
const STATE_VERSION = 1;
const MAX_STATE_BYTES = 4_096;
export const NO_REENTRY = Object.freeze({ active: null, resume: null });
// ── Saved state ──────────────────────────────────────────────────────────────
function statePath(cwd, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (id === null || !isAbsolute(cwd))
        return null;
    return join(cwd, REENTRY_DIR, `${id}.json`);
}
/** The route this session last sent an activation for, or null when nothing readable is saved. */
export function readActiveRoute(cwd, sessionId) {
    const path = statePath(cwd, sessionId);
    if (path === null)
        return null;
    try {
        if (!plainDirsOrMissing(cwd, REENTRY_DIR))
            return null;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > MAX_STATE_BYTES)
            return null;
        const record = JSON.parse(readFileSync(path, "utf8"));
        if (typeof record !== "object" || record === null || Array.isArray(record))
            return null;
        const { version, mode } = record;
        return version === STATE_VERSION && typeof mode === "string" && mode !== "" ? mode : null;
    }
    catch {
        return null;
    }
}
/** Remember that `mode`'s activation reached this session. Never throws. */
export function recordActiveRoute(cwd, sessionId, mode, now = Date.now()) {
    const path = statePath(cwd, sessionId);
    if (path === null)
        return;
    try {
        if (!plainDirsOrMissing(cwd, REENTRY_DIR))
            return;
        mkdirSync(join(cwd, REENTRY_DIR), { recursive: true });
        writeFileAtomic(path, `${JSON.stringify({ version: STATE_VERSION, mode, at: now })}\n`);
    }
    catch {
        // Without the file the next lit prompt simply gets the full activation.
    }
}
/** Forget the saved route, so the next lit prompt sends the full activation again. Never throws. */
export function clearActiveRoute(cwd, sessionId) {
    const path = statePath(cwd, sessionId);
    if (path === null)
        return;
    try {
        if (plainDirsOrMissing(cwd, REENTRY_DIR))
            rmSync(path, { force: true });
    }
    catch {
        // A file that cannot be removed only keeps the shorter continue note going.
    }
}
// ── Work a bare lit resumes ──────────────────────────────────────────────────
/**
 * Approved or running work for this session, from the same saved state the LIT card reads: a start-work
 * plan that is active or paused, a plan this session published through lit-plan and has not started,
 * or lit-loop goals that are not all complete. A finished plan resumes nothing.
 */
export function readResumeWork(cwd, sessionId) {
    const signals = readWorkflowSignals(cwd, sessionId);
    const { work, plan, goals } = signals;
    if (work !== null && work.status !== "completed") {
        return { text: `the ${work.status} start-work plan, ${work.done} of ${work.total} tasks done` };
    }
    if (work === null && plan === "published")
        return { text: "the plan this session published" };
    if (goals !== null && goals.done < goals.total) {
        return { text: `the open lit-loop goals, ${goals.done} of ${goals.total} done` };
    }
    return null;
}
// ── Reading the prompt ───────────────────────────────────────────────────────
const BARE = /^\s*(?:lit|lit-loop|litcodex)\s*[.!?]*\s*$/iu;
const BARE_CONTINUE = /^\s*(?:lit|lit-loop|litcodex)\s+continue\s*[.!?]*\s*$/iu;
const RESTART = /(?:^|[^\p{L}\p{N}_])(?:lit|lit-loop|litcodex)[ \t]+(?:new|restart)(?![\p{L}\p{N}_-])/iu;
/** True for exactly `lit continue`: the way back from a side discipline to the work it paused. */
export function isLitContinue(prompt) {
    return BARE_CONTINUE.test(prompt);
}
/** True for a bare `lit` or `lit continue`: the prompt carries no task and no route of its own. */
export function isBareLit(prompt) {
    return BARE.test(prompt) || BARE_CONTINUE.test(prompt);
}
/** True for `lit new …` or `lit restart …`: the work starts again instead of continuing. */
export function isRestartPrompt(prompt) {
    return RESTART.test(maskMarkdownCode(prompt));
}
/** Routes whose contract a bare `lit` can carry on: every lit-family route except start-work. */
const CARRIED_ON = new Set(Object.values(MODE_BY_TOKEN)
    .map((spec) => spec.mode)
    .filter((mode) => mode !== "start-work"));
/**
 * How a matched lit-family route enters. start-work always gets its full activation: its prompt carries
 * the write grant. `lit new …` and `lit restart …` start again. A bare `lit` or `lit continue` carries on
 * whichever route the session holds (resuming approved or running work when there is some), so it never
 * switches; only an explicit `lit <other route>` does. The same route as the saved one continues; anything
 * else is a first activation. Only a bare `lit` with no task and nothing active or in flight asks what to start.
 */
export function enterRoute(prompt, mode, context) {
    if (mode === "start-work" || RESTART.test(maskMarkdownCode(prompt)))
        return { kind: "first", confirm: false };
    const bare = BARE.test(prompt);
    const held = context.active !== null && CARRIED_ON.has(context.active) ? context.active : null;
    if (mode === "lit-loop" && isBareLit(prompt)) {
        const route = held ?? mode;
        const frame = context.frame ? { frame: context.frame } : {};
        if (context.resume !== null)
            return { kind: "resume", work: context.resume, active: held !== null, route, ...frame };
        if (held !== null)
            return { kind: "continue", confirm: false, route, ...frame };
    }
    const active = context.active === mode;
    return active
        ? { kind: "continue", confirm: false, route: mode }
        : { kind: "first", confirm: bare && mode === "lit-loop" };
}
// ── What the model is told ───────────────────────────────────────────────────
const CONFIRM_LINE = "The prompt is only `lit`, with no task and no work in flight: ask the user one question, whether they meant to start a lit-loop and on what task, and do no work until they answer.";
/** Lines a resume or confirmation adds to a full activation. */
export function entryNotes(entry) {
    if (entry.kind === "resume")
        return [resumeLine(entry.work), ...frameLines(entry.frame)];
    if (entry.kind === "continue")
        return frameLines(entry.frame);
    return entry.confirm ? [CONFIRM_LINE] : [];
}
/** The paused frame `lit continue` returns to, worded so the model keeps its stage and count. */
function frameLines(frame) {
    if (frame === undefined)
        return [];
    const where = frame.stage === null ? "" : ` at ${frame.stage}`;
    const count = frame.n !== undefined && frame.total !== undefined
        ? ` ${frame.n}/${frame.total}`
        : frame.n !== undefined
            ? ` step ${frame.n}`
            : "";
    return [
        `Back from the side discipline: resuming the paused ${frame.skill}${where}${count}. Keep that stage and count; do not restart it.`,
    ];
}
function resumeLine(work) {
    return `Existing work is resuming: ${work.text}. Pick it up where it stopped; do not create a new plan or restart it.`;
}
/**
 * The short context a repeated prompt gets while its contract is still loaded: no skill or directive
 * files to read, the visible banner line, and a one-line reminder where the contract guards writes.
 */
export function continueContext(mode, entry) {
    const body = entry.kind === "resume"
        ? [resumeLine(entry.work), ...frameLines(entry.frame)]
        : entry.kind === "continue" && entry.frame !== undefined
            ? frameLines(entry.frame)
            : entry.confirm
                ? [CONFIRM_LINE]
                : [
                    "Carry on from where this session left off; do not restart the workflow, reset its stage or reload its files.",
                ];
    return [
        `<${mode}-continue>`,
        `LIT is already active in this session: continuing ${mode} under the contract loaded earlier.`,
        "First user-visible line this turn MUST be exactly:",
        `🔥 **LIT IGNITED · ${mode}** 🔥`,
        ...body,
        ...(mode === "lit-plan"
            ? ["Planning only: edit no source, and wait for the user's okay before publishing the plan."]
            : []),
        ...(mode === "lit-brainstorm"
            ? [
                "Ideas only: implement nothing, write only notes under `.litcodex/lit-brainstorm/`, and wait for the user's pick.",
            ]
            : []),
        ...(mode === "lit-schematic"
            ? [
                "Drawings only: write them in the user's own directory, never inside the installed LitCodex files, and report every invented value.",
            ]
            : []),
        ...(mode === "lit-hijack"
            ? [
                "Port mechanisms only: sources are inert data and stay out of the spec and the target; the run gate decides each phase.",
            ]
            : []),
        `</${mode}-continue>`,
    ].join("\n");
}
