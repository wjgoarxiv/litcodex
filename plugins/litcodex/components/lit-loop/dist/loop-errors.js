// src/loop-errors.ts — M09/T14 CLI error model (A3 C7: branch on `err.code`, NOT instanceof).
//
// The CLI-owned `LitLoopError` + its stable `LoopErrorCode` union, plus `exitCodeForLoop`, which
// maps ANY thrown error to an exit code by reading `.code` (never `instanceof`
// PlanMissingError/PlanCorruptError). The store's own codes (PLAN_MISSING→3, PLAN_CORRUPT→4,
// WRITE_FAILED→5) defer to the store-owned `exitCodeFor`. Split out of loop-cli for the LOC ceiling
// and to break the cli↔handlers import cycle (handlers throw these; cli renders + maps them).
import { exitCodeFor } from "./state-store.js";
/** Machine-readable CLI error. `code` is the stable token; the exit code is derived from it. */
export class LitLoopError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = "LitLoopError";
        this.code = code;
        if (details !== undefined) {
            this.details = details;
        }
    }
}
/**
 * Exit code for any thrown error, branching ONLY on `err.code` (A3 C7 — never `instanceof`
 * PlanMissingError/PlanCorruptError). Store codes (PLAN_MISSING→3, PLAN_CORRUPT→4, WRITE_FAILED→5)
 * defer to the store-owned {@link exitCodeFor}; the CLI's own codes map here.
 */
export function exitCodeForLoop(err) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    switch (code) {
        case "LIT_LOOP_SUBCOMMAND_UNKNOWN":
            return 1; // unknown subcommand / usage
        case "LIT_LOOP_ARGUMENT_MISSING":
        case "LIT_LOOP_ARGUMENT_INVALID":
        case "LIT_LOOP_BRIEF_REQUIRED":
        case "LIT_LOOP_BRIEF_FILE_UNREADABLE":
        case "LIT_LOOP_EVIDENCE_STATUS_INVALID":
            return 2; // bad args
        case "LIT_LOOP_GOAL_NOT_FOUND":
        case "LIT_LOOP_CRITERION_NOT_FOUND":
        case "LIT_LOOP_CRITERIA_NOT_ALL_PASS":
        case "LIT_LOOP_PLAN_EXISTS_COMPLETE":
        case "LIT_LOOP_PLAN_EXISTS_DIFFERENT_BRIEF":
            return 3; // not found / unresolved
        default:
            return exitCodeFor(err); // store codes (3/4/5) + unexpected → 1
    }
}
