// src/loop-model.ts — M09/T14 PURE domain logic (A3 C7, S09 §5 model rules).
//
// Goal derivation from a brief, success-criteria seeding, next-runnable-goal selection, plan
// summary, the all-criteria-pass gate, and the deterministic run-handoff text. Operates on
// in-memory plan objects only. Imports state-types (types) and the pure redaction helper — NO
// node:fs, NO store, NO I/O, no `process`, no clock. Every output is fully determined by its arguments.
import { redactSecrets } from "./redaction.js";
const FALLBACK_OBJECTIVE = "Complete the requested project objective.";
const MAX_OBJECTIVE = 1200;
const MAX_TITLE = 72;
const BULLET_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
/** Strip a leading bullet/numbered marker and surrounding whitespace from one line. */
function cleanLine(line) {
    return line.replace(BULLET_RE, "").trim();
}
/**
 * Derive ordered goal objective strings from a free-text brief. Bullets/numbered lines win; if
 * none, non-heading paragraphs; if neither yields a candidate, a single fallback objective. Pure
 * and deterministic — a single linear pass, per-line capped at 1200 chars, deduped keeping first.
 */
export function deriveGoalCandidates(brief) {
    const lines = brief.split(/\r?\n/);
    const bulletLines = lines.filter((l) => BULLET_RE.test(l));
    let raw;
    if (bulletLines.length > 0) {
        raw = bulletLines.map(cleanLine);
    }
    else {
        raw = brief
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0 && !p.startsWith("#"));
    }
    const seen = new Set();
    const candidates = [];
    for (const value of raw) {
        if (value.length === 0 || value.length > MAX_OBJECTIVE) {
            continue;
        }
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        candidates.push(value);
    }
    return candidates.length > 0 ? candidates : [FALLBACK_OBJECTIVE];
}
/**
 * Build a goal id `G` + 3-digit zero-padded (index+1) + optional `-<slug>`. The slug strips every
 * non-`[a-z0-9]` run to `-`, trims edge dashes, caps at 36 chars; an empty slug body drops the
 * trailing dash so the id is just `G001`. Always matches `^G\d{3}(-[a-z0-9-]+)?$`.
 */
export function normalizeGoalId(index, objective) {
    const num = String(index + 1).padStart(3, "0");
    const slugBody = objective
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 36)
        .replace(/-+$/g, "");
    return slugBody.length > 0 ? `G${num}-${slugBody}` : `G${num}`;
}
/** First non-empty line of the objective, truncated to 69 + "..." when longer than 72 chars. */
export function titleFromObjective(objective) {
    const firstLine = objective
        .split(/\r?\n/)
        .find((l) => l.trim().length > 0)
        ?.trim() ?? "";
    return firstLine.length > MAX_TITLE ? `${firstLine.slice(0, MAX_TITLE - 3)}...` : firstLine;
}
function truncate(value, max) {
    return value.length > max ? value.slice(0, max) : value;
}
/**
 * Seed exactly C001(happy)/C002(edge)/C003(regression), each pending with no captured evidence.
 * The objective's first 80 chars form the human-readable subject in the happy-path scenario.
 */
export function seedDefaultSuccessCriteria(objective) {
    const subject = truncate(titleFromObjective(objective) || objective, 80);
    const seed = (id, userModel, scenario, expectedEvidence) => ({
        id,
        scenario,
        userModel,
        expectedEvidence,
        capturedEvidence: null,
        status: "pending",
    });
    return [
        seed("C001", "happy", `happy path for: ${subject}`, "Run the happy-path scenario and capture passing output via record-evidence."),
        seed("C002", "edge", "edge case (boundary/empty/malformed)", "Exercise a boundary/empty/malformed input and capture the result."),
        seed("C003", "regression", "regression: adjacent surface still works", "Verify an adjacent surface is unbroken and capture proof."),
    ];
}
/**
 * Select the next goal to run: first `in_progress` (resume), else first `pending`, else — only
 * when `retryFailed` — the first `failed` or `blocked` goal in plan order (retry re-pick), else null. Pure: returns the goal
 * reference; the caller (R4) applies the attempt/status mutations.
 */
export function pickNextRunnableGoal(plan, opts) {
    const inProgress = plan.goals.find((g) => g.status === "in_progress");
    if (inProgress) {
        return { goal: inProgress, resumed: true, retried: false };
    }
    const pending = plan.goals.find((g) => g.status === "pending");
    if (pending) {
        return { goal: pending, resumed: false, retried: false };
    }
    if (opts.retryFailed) {
        const retryable = plan.goals.find((g) => g.status === "failed" || g.status === "blocked");
        if (retryable) {
            return { goal: retryable, resumed: false, retried: true };
        }
    }
    return null;
}
/**
 * Returns the list of `{id,status}` criteria blocking completion. A goal completes only when it
 * has >=1 criterion and EVERY criterion is `pass`; an empty list FAILS (returns a sentinel entry).
 */
export function requireAllCriteriaPass(goal) {
    if (goal.successCriteria.length === 0) {
        return [{ id: "(none)", status: "missing" }];
    }
    return goal.successCriteria.filter((c) => c.status !== "pass").map((c) => ({ id: c.id, status: c.status }));
}
/** Roll up goal-status counts and the criteria pass/pending/fail/blocked totals. Never persisted. */
export function summarizePlan(plan) {
    const summary = {
        total: plan.goals.length,
        pending: 0,
        in_progress: 0,
        complete: 0,
        failed: 0,
        blocked: 0,
        criteria: { total: 0, pass: 0, pending: 0, fail: 0, blocked: 0 },
    };
    for (const goal of plan.goals) {
        summary[goal.status] += 1;
        for (const crit of goal.successCriteria) {
            summary.criteria.total += 1;
            summary.criteria[crit.status] += 1;
        }
    }
    return summary;
}
/**
 * The deterministic, marker-free, legacy-token-free run handoff block. No `<lit-loop-mode>`
 * marker (that is the M15 directive, not the CLI instruction) and no marketing copy — only the
 * plan/ledger paths, the goal, its objective, the seeded criteria, and the LitCodex-native
 * next-action commands a caller runs to record evidence and checkpoint.
 */
export function buildRunInstruction(plan, goal) {
    const lines = [
        "lit-loop active-goal handoff",
        `Plan: ${plan.goalsPath}`,
        `Ledger: ${plan.ledgerPath}`,
        `Goal: ${goal.id} — ${goal.title}`,
        `Objective: ${goal.objective}`,
        "Success criteria:",
    ];
    for (const c of goal.successCriteria) {
        lines.push(`- [${c.id}] (${c.userModel}) ${c.scenario} — expect: ${c.expectedEvidence} — status: ${c.status}`);
    }
    lines.push("Next actions:", "1. Do the work for this goal.", `2. For each criterion: litcodex loop record-evidence --goal-id ${goal.id} --criterion-id <Cxxx> --status pass --evidence "<proof>"`, `3. Once all criteria pass: litcodex loop checkpoint --goal-id ${goal.id} --status complete --evidence "<summary>"`);
    return redactSecrets(`${lines.join("\n")}\n`);
}
