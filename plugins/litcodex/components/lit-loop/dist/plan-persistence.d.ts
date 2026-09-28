export declare const PLAN_PERSISTENCE_DIR = ".litcodex/lit-plan";
export declare const PLAN_PERSISTENCE_PLANS_DIR = ".litcodex/plans";
export declare const PLAN_PERSISTENCE_MAX_BLOCKS = 2;
export declare const PLAN_PUBLISHER_COMMAND = "node <plugin-root>/components/start-work-continuation/dist/cli.js publish-plan --cwd <path> --slug <slug>";
export type PlanPersistenceDecision = {
    readonly decision: "pass";
} | {
    readonly decision: "block";
    readonly reason: string;
};
/** Record (or re-record) a lit-plan activation for `sessionId`. Fail-open: never throws. */
export declare function recordLitPlanActivation(repoRoot: string, sessionId: string, now?: number): void;
/**
 * Decide whether the Stop for `sessionId` may end. Pass when no activation exists, when the guard is
 * already satisfied, or when the block cap is spent; otherwise block until a checkbox plan newer than
 * the activation exists. Fail-open on any fs error.
 */
export declare function evaluatePlanPersistence(repoRoot: string, sessionId: string): PlanPersistenceDecision;
/** Codex Stop hook output for a block decision (single line + newline). */
export declare function formatStopBlockOutput(reason: string): string;
