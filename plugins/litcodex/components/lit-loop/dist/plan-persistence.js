// src/plan-persistence.ts — lit-plan plan-file persistence guard for the Stop hook.
//
// A lit-plan turn must leave a durable `.litcodex/plans/<slug>.md` behind (written through the
// compiled start-work-continuation publisher), otherwise `lit start work` later fails with a missing
// plan. The UserPromptSubmit hook records the activation timestamp per session when the lit-plan
// directive is injected; the Stop hook then blocks the turn end until a plan file newer than that
// activation with at least one top-level `- [ ] N.` task row exists. At most
// PLAN_PERSISTENCE_MAX_BLOCKS blocks are issued per session so a model that keeps interviewing (or a
// user who abandons the plan) can never be trapped in a Stop loop. Every fs failure is FAIL-OPEN.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { normalizeSessionId } from "./state-paths.js";
export const PLAN_PERSISTENCE_DIR = ".litcodex/lit-plan";
export const PLAN_PERSISTENCE_PLANS_DIR = ".litcodex/plans";
export const PLAN_PERSISTENCE_MAX_BLOCKS = 2;
export const PLAN_PUBLISHER_COMMAND = "node <plugin-root>/components/start-work-continuation/dist/cli.js publish-plan --cwd <path> --slug <slug>";
const STATE_VERSION = 1;
const MAX_PLAN_BYTES = 1_000_000;
const TASK_ROW = /^- \[ \] \d+\./m;
const PASS = Object.freeze({ decision: "pass" });
function statePath(repoRoot, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (id === null || !isAbsolute(repoRoot))
        return null;
    return join(repoRoot, PLAN_PERSISTENCE_DIR, `${id}.json`);
}
function readState(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            return null;
        const record = parsed;
        if (record["version"] !== STATE_VERSION ||
            typeof record["sessionId"] !== "string" ||
            typeof record["activatedAt"] !== "number" ||
            typeof record["blocks"] !== "number" ||
            typeof record["satisfied"] !== "boolean") {
            return null;
        }
        return {
            version: STATE_VERSION,
            sessionId: record["sessionId"],
            activatedAt: record["activatedAt"],
            blocks: record["blocks"],
            satisfied: record["satisfied"],
        };
    }
    catch {
        return null;
    }
}
function writeState(path, state) {
    mkdirSync(join(path, ".."), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmp, path);
}
/** Record (or re-record) a lit-plan activation for `sessionId`. Fail-open: never throws. */
export function recordLitPlanActivation(repoRoot, sessionId, now = Date.now()) {
    const path = statePath(repoRoot, sessionId);
    if (path === null)
        return;
    try {
        writeState(path, { version: STATE_VERSION, sessionId, activatedAt: now, blocks: 0, satisfied: false });
    }
    catch {
        // A state write failure only disables the guard for this session.
    }
}
/** Newest `.litcodex/plans/*.md` modified at or after `since`, or null when none exists. */
function newestPlanSince(repoRoot, since) {
    const dir = join(repoRoot, PLAN_PERSISTENCE_PLANS_DIR);
    let entries;
    try {
        entries = readdirSync(dir).filter((name) => name.endsWith(".md") && !name.startsWith("."));
    }
    catch {
        return null;
    }
    let newest = null;
    for (const file of entries) {
        try {
            const stat = statSync(join(dir, file));
            if (!stat.isFile() || stat.mtimeMs < since || stat.size > MAX_PLAN_BYTES)
                continue;
            if (newest === null || stat.mtimeMs > newest.mtimeMs)
                newest = { file, mtimeMs: stat.mtimeMs };
        }
        catch {
            // unreadable entry: skip
        }
    }
    if (newest === null)
        return null;
    try {
        const body = readFileSync(join(dir, newest.file), "utf8");
        return { file: newest.file, taskRows: body.split(/\r?\n/).filter((line) => TASK_ROW.test(line)).length };
    }
    catch {
        return null;
    }
}
function blockReason(detail) {
    return (`lit-plan must persist the plan before finishing: ${detail}. ` +
        `If the user approved the plan, publish it now through the compiled publisher: ${PLAN_PUBLISHER_COMMAND} ` +
        "(plan Markdown on stdin; `## Todos` rows as `- [ ] N. <title>` at column zero). " +
        `If approval is still pending, ask for it explicitly and end the turn; this guard blocks at most ${PLAN_PERSISTENCE_MAX_BLOCKS} turns per session.`);
}
/**
 * Decide whether the Stop for `sessionId` may end. Pass when no activation exists, when the guard is
 * already satisfied, or when the block cap is spent; otherwise block until a checkbox plan newer than
 * the activation exists. Fail-open on any fs error.
 */
export function evaluatePlanPersistence(repoRoot, sessionId) {
    const path = statePath(repoRoot, sessionId);
    if (path === null)
        return PASS;
    const state = readState(path);
    if (state === null || state.satisfied)
        return PASS;
    const newest = newestPlanSince(repoRoot, state.activatedAt);
    if (newest !== null && newest.taskRows > 0) {
        try {
            writeState(path, { ...state, satisfied: true });
        }
        catch {
            // Losing the satisfied mark only means the next Stop re-checks the (already valid) plan.
        }
        return PASS;
    }
    if (state.blocks >= PLAN_PERSISTENCE_MAX_BLOCKS)
        return PASS;
    try {
        writeState(path, { ...state, blocks: state.blocks + 1 });
    }
    catch {
        return PASS;
    }
    const detail = newest === null
        ? `no ${PLAN_PERSISTENCE_PLANS_DIR}/<slug>.md was written after this lit-plan prompt`
        : `the newest plan ${PLAN_PERSISTENCE_PLANS_DIR}/${newest.file} has zero top-level \`- [ ] N.\` checkbox task rows`;
    return { decision: "block", reason: blockReason(detail) };
}
/** Codex Stop hook output for a block decision (single line + newline). */
export function formatStopBlockOutput(reason) {
    return `${JSON.stringify({ decision: "block", reason })}\n`;
}
