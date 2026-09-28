import type { LoopCriterion, LoopGoal, LoopPlan, PlanSummary } from "./loop-types.js";
/**
 * Derive ordered goal objective strings from a free-text brief. Bullets/numbered lines win; if
 * none, non-heading paragraphs; if neither yields a candidate, a single fallback objective. Pure
 * and deterministic — a single linear pass, per-line capped at 1200 chars, deduped keeping first.
 */
export declare function deriveGoalCandidates(brief: string): string[];
/**
 * Build a goal id `G` + 3-digit zero-padded (index+1) + optional `-<slug>`. The slug strips every
 * non-`[a-z0-9]` run to `-`, trims edge dashes, caps at 36 chars; an empty slug body drops the
 * trailing dash so the id is just `G001`. Always matches `^G\d{3}(-[a-z0-9-]+)?$`.
 */
export declare function normalizeGoalId(index: number, objective: string): string;
/** First non-empty line of the objective, truncated to 69 + "..." when longer than 72 chars. */
export declare function titleFromObjective(objective: string): string;
/**
 * Seed exactly C001(happy)/C002(edge)/C003(regression), each pending with no captured evidence.
 * The objective's first 80 chars form the human-readable subject in the happy-path scenario.
 */
export declare function seedDefaultSuccessCriteria(objective: string): LoopCriterion[];
/** A scheduler pick: the selected goal plus whether it was a resume or a retry re-pick. */
export interface RunnablePick {
    goal: LoopGoal;
    resumed: boolean;
    retried: boolean;
}
/**
 * Select the next goal to run: first `in_progress` (resume), else first `pending`, else — only
 * when `retryFailed` — the first `failed` or `blocked` goal in plan order (retry re-pick), else null. Pure: returns the goal
 * reference; the caller (R4) applies the attempt/status mutations.
 */
export declare function pickNextRunnableGoal(plan: LoopPlan, opts: {
    retryFailed: boolean;
}): RunnablePick | null;
/**
 * Returns the list of `{id,status}` criteria blocking completion. A goal completes only when it
 * has >=1 criterion and EVERY criterion is `pass`; an empty list FAILS (returns a sentinel entry).
 */
export declare function requireAllCriteriaPass(goal: LoopGoal): Array<{
    id: string;
    status: string;
}>;
/** Roll up goal-status counts and the criteria pass/pending/fail/blocked totals. Never persisted. */
export declare function summarizePlan(plan: LoopPlan): PlanSummary;
/**
 * The deterministic, marker-free, legacy-token-free run handoff block. No `<lit-loop-mode>`
 * marker (that is the M15 directive, not the CLI instruction) and no marketing copy — only the
 * plan/ledger paths, the goal, its objective, the seeded criteria, and the LitCodex-native
 * next-action commands a caller runs to record evidence and checkpoint.
 */
export declare function buildRunInstruction(plan: LoopPlan, goal: LoopGoal): string;
