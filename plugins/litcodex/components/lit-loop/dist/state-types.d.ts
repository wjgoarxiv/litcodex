export type LitLoopGoalStatus = "pending" | "in_progress" | "complete" | "failed" | "blocked";
export type LitLoopCriterionStatus = "pending" | "pass" | "fail" | "blocked";
/**
 * MVP user-model union — exactly three values (A3 C7 + S08-addendum §B.1.1). `"adversarial"`
 * was dropped: M09's builder emits only these three, so admitting a fourth created a no-op
 * branch + validation mismatch. Re-introducing it is a coordinated M08+M09 change.
 */
export type LitLoopUserModel = "happy" | "edge" | "regression";
export type LitLoopCodexGoalMode = "aggregate" | "per_story";
/** Frozen tuple of the three user-model values (enumerable, single source). */
export declare const LIT_LOOP_USER_MODELS: readonly LitLoopUserModel[];
/** Lit-loop goal events plus canonical start-work lifecycle events. */
export declare const LIT_LOOP_LEDGER_EVENT_KINDS: readonly ["plan_created", "goal_added", "goal_started", "goal_resumed", "goal_retried", "goal_completed", "goal_failed", "goal_blocked", "evidence_captured", "criterion_failed", "criterion_blocked", "criteria_revised", "state_recovered", "start_work_initialized", "start_work_continuation_issued", "start_work_paused", "start_work_resumed", "start_work_cancelled", "start_work_completed"];
export type LitLoopLedgerEventKind = (typeof LIT_LOOP_LEDGER_EVENT_KINDS)[number];
/** Goal-id: uppercase `G`, exactly 3 digits, optional non-empty lowercase-slug. `G001-` invalid. */
export declare const LIT_LOOP_GOAL_ID_RE: RegExp;
/** Criterion-id: uppercase `C`, exactly 3 digits. */
export declare const LIT_LOOP_CRITERION_ID_RE: RegExp;
export interface LitLoopCriterion {
    readonly id: string;
    readonly scenario: string;
    readonly userModel: LitLoopUserModel;
    readonly expectedEvidence: string;
    capturedEvidence: string | null;
    status: LitLoopCriterionStatus;
    capturedAt?: string;
    notes?: string;
}
export interface LitLoopGoal {
    id: string;
    title: string;
    objective: string;
    status: LitLoopGoalStatus;
    successCriteria: LitLoopCriterion[];
    attempt: number;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    failedAt?: string;
    evidence?: string;
    failureReason?: string;
}
export interface LitLoopPlan {
    version: 1;
    createdAt: string;
    updatedAt: string;
    briefPath: string;
    goalsPath: string;
    ledgerPath: string;
    evidenceDir: string;
    sessionId: string | null;
    codexGoalMode?: LitLoopCodexGoalMode;
    codexObjective?: string;
    activeGoalId?: string;
    goals: LitLoopGoal[];
}
export interface LitLoopLedgerEntry {
    at: string;
    kind: LitLoopLedgerEventKind;
    goalId?: string;
    criterionId?: string;
    goalStatus?: LitLoopGoalStatus;
    criterionStatus?: LitLoopCriterionStatus;
    message?: string;
    evidence?: string;
    fromStatus?: LitLoopGoalStatus;
    attempt?: number;
    before?: unknown;
    after?: unknown;
    workId?: string;
    transitionId?: string;
    revision?: number;
    workStatus?: "active" | "paused" | "abandoned" | "completed";
    fromWorkStatus?: "active" | "paused" | "abandoned" | "completed";
    toWorkStatus?: "active" | "paused" | "abandoned" | "completed";
    plan?: string;
    sessionId?: string;
    reason?: string;
    turnId?: string;
    reasonCode?: "authorization_required" | "credential_required" | "host_capability_required" | "explicit_user_resume" | "user_cancelled" | "completed";
    progressToken?: string;
    initFingerprint?: string;
    boundary?: {
        boundary_id: string;
        authority_id: string;
        action: string;
        root: string;
    };
    grant?: {
        grant_id: string;
        authority_id: string;
        boundary_id: string;
        action: string;
        root: string;
    };
}
/** Caller-supplied ledger entry: `at` is optional because `appendLedger` fills it when absent. */
export type LitLoopLedgerInput = Omit<LitLoopLedgerEntry, "at"> & {
    at?: string;
};
export interface LitLoopStateErrorOptions {
    readonly cause?: unknown;
    readonly details?: Record<string, unknown>;
}
/**
 * The single error type the store throws. Consumers branch on the stable SCREAMING_SNAKE
 * `.code` (NOT on `instanceof` subclasses — none exist). `details` is undefined unless supplied.
 */
export declare class LitLoopStateError extends Error {
    readonly name = "LitLoopStateError";
    readonly code: string;
    readonly details?: Record<string, unknown>;
    constructor(message: string, code: string, opts?: LitLoopStateErrorOptions);
}
/** Single clock seam. Tests may inject a fake by spying on this module export. */
export declare function iso(): string;
export declare function isUserModel(value: unknown): value is LitLoopUserModel;
export declare function isLedgerEventKind(value: unknown): value is LitLoopLedgerEventKind;
export declare function isGoalId(value: unknown): value is string;
export declare function isCriterionId(value: unknown): value is string;
