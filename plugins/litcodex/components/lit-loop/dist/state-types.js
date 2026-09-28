// src/state-types.ts — M08/T13 SINGLE schema source (A3 C7, S08-addendum §B).
//
// The persisted TypeScript shapes for the lit-loop durable state, the status/kind unions, the
// `LitLoopStateError` class, the `iso()` clock seam, and the small pure validators the store
// (and M09's plan builder) share. Types + error + pure predicates only; ZERO I/O. M09's
// `loop-types.ts` is a re-export barrel of these shapes — no parallel schema is declared anywhere.
/** Frozen tuple of the three user-model values (enumerable, single source). */
export const LIT_LOOP_USER_MODELS = Object.freeze(["happy", "edge", "regression"]);
/** Lit-loop goal events plus canonical start-work lifecycle events. */
export const LIT_LOOP_LEDGER_EVENT_KINDS = [
    "plan_created",
    "goal_added",
    "goal_started",
    "goal_resumed",
    "goal_retried",
    "goal_completed",
    "goal_failed",
    "goal_blocked",
    "evidence_captured",
    "criterion_failed",
    "criterion_blocked",
    "criteria_revised",
    "state_recovered",
    "start_work_initialized",
    "start_work_continuation_issued",
    "start_work_paused",
    "start_work_resumed",
    "start_work_cancelled",
    "start_work_completed",
];
// ── Id regexes (A3 Part D / S08-addendum §B.1.2) ─────────────────────────────
/** Goal-id: uppercase `G`, exactly 3 digits, optional non-empty lowercase-slug. `G001-` invalid. */
export const LIT_LOOP_GOAL_ID_RE = /^G\d{3}(-[a-z0-9-]+)?$/;
/** Criterion-id: uppercase `C`, exactly 3 digits. */
export const LIT_LOOP_CRITERION_ID_RE = /^C\d{3}$/;
/**
 * The single error type the store throws. Consumers branch on the stable SCREAMING_SNAKE
 * `.code` (NOT on `instanceof` subclasses — none exist). `details` is undefined unless supplied.
 */
export class LitLoopStateError extends Error {
    constructor(message, code, opts) {
        super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
        this.name = "LitLoopStateError";
        this.code = code;
        if (opts?.details !== undefined) {
            this.details = opts.details;
        }
    }
}
// ── Clock seam ───────────────────────────────────────────────────────────────
/** Single clock seam. Tests may inject a fake by spying on this module export. */
export function iso() {
    return new Date().toISOString();
}
// ── Pure validators (shared by the store's validatePlan and M09's builder tests) ──
export function isUserModel(value) {
    return typeof value === "string" && LIT_LOOP_USER_MODELS.includes(value);
}
export function isLedgerEventKind(value) {
    return typeof value === "string" && LIT_LOOP_LEDGER_EVENT_KINDS.includes(value);
}
export function isGoalId(value) {
    return typeof value === "string" && LIT_LOOP_GOAL_ID_RE.test(value);
}
export function isCriterionId(value) {
    return typeof value === "string" && LIT_LOOP_CRITERION_ID_RE.test(value);
}
