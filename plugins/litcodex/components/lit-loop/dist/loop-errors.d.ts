/** Stable SCREAMING_SNAKE error codes; consumers map them to an exit code via `.code`. */
export type LoopErrorCode = "LIT_LOOP_SUBCOMMAND_UNKNOWN" | "LIT_LOOP_ARGUMENT_MISSING" | "LIT_LOOP_ARGUMENT_INVALID" | "LIT_LOOP_BRIEF_REQUIRED" | "LIT_LOOP_BRIEF_FILE_UNREADABLE" | "LIT_LOOP_PLAN_EXISTS_COMPLETE" | "LIT_LOOP_PLAN_EXISTS_DIFFERENT_BRIEF" | "LIT_LOOP_EVIDENCE_STATUS_INVALID" | "LIT_LOOP_GOAL_NOT_FOUND" | "LIT_LOOP_CRITERION_NOT_FOUND" | "LIT_LOOP_CRITERIA_NOT_ALL_PASS";
/** Machine-readable CLI error. `code` is the stable token; the exit code is derived from it. */
export declare class LitLoopError extends Error {
    readonly name = "LitLoopError";
    readonly code: LoopErrorCode;
    readonly details?: Readonly<Record<string, unknown>>;
    constructor(message: string, code: LoopErrorCode, details?: Readonly<Record<string, unknown>>);
}
/**
 * Exit code for any thrown error, branching ONLY on `err.code` (A3 C7 — never `instanceof`
 * PlanMissingError/PlanCorruptError). Store codes (PLAN_MISSING→3, PLAN_CORRUPT→4, WRITE_FAILED→5)
 * defer to the store-owned {@link exitCodeFor}; the CLI's own codes map here.
 */
export declare function exitCodeForLoop(err: unknown): number;
