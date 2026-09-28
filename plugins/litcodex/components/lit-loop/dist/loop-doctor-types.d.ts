import type { LoopGoalStatus, PlanSummary } from "./loop-types.js";
import type { LitLoopScope } from "./state-paths.js";
/** The six diagnostic surfaces, in stable render order. */
export type LoopDoctorCheckName = "state-dir" | "plan-schema" | "ledger" | "evidence-dir" | "hook" | "checkpoint";
/** ok = healthy; warn = absent-but-recoverable (NOT a failure); fail = corrupt/unusable. */
export type LoopDoctorCheckStatus = "ok" | "warn" | "fail";
export interface LoopDoctorCheck {
    readonly name: LoopDoctorCheckName;
    readonly status: LoopDoctorCheckStatus;
    /** One sanitized line. NO absolute paths beyond repo-relative artifacts; NO raw prompt/evidence text. */
    readonly detail: string;
    /** Optional machine-readable extras (e.g. backup path, ledger counts). JSON-serializable scalars only. */
    readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}
/** A pointer to the most-recent terminal goal event seen in the ledger tail. */
export interface LoopCheckpointRef {
    readonly goalId: string;
    readonly status: LoopGoalStatus;
    readonly at: string;
}
export interface LoopDoctorReport {
    /** false iff ANY check.status === "fail". A `warn` alone keeps healthy = true. */
    readonly healthy: boolean;
    /** Repo-relative resolved state dir, e.g. ".litcodex/lit-loop" or ".litcodex/lit-loop/<sid>". */
    readonly stateDir: string;
    /** Always present, always length 6, always in LoopDoctorCheckName order. */
    readonly checks: ReadonlyArray<LoopDoctorCheck>;
    /** Most recent terminal checkpoint, or null when none / ledger unreadable. */
    readonly latestCheckpoint: LoopCheckpointRef | null;
    /** Goal/criterion counts when the plan is readable; null when missing/corrupt. */
    readonly counts: PlanSummary | null;
}
export interface RunLoopDoctorOptions {
    /** Absolute project root. MUST be absolute (the doctor never infers it from import.meta.url). */
    readonly repoRoot: string;
    /** Session scope to inspect; undefined ⇒ unscoped root dir. */
    readonly scope?: LitLoopScope | undefined;
}
/**
 * Injectable seams for deterministic, side-effect-free testing. ALL default to the real M08
 * store + the real aggregate-hooks-manifest probe. Tests override individually for fault injection.
 */
export interface RunLoopDoctorDeps {
    readonly readPlan: (repoRoot: string, scope?: LitLoopScope) => Promise<unknown>;
    readonly readLedger: (repoRoot: string, scope?: LitLoopScope) => Promise<{
        entries: ReadonlyArray<Record<string, unknown>>;
        skipped: number;
    }>;
    readonly statExists: (absPath: string) => Promise<boolean>;
    /** Resolves true iff a UserPromptSubmit command is wired in the aggregate plugins/litcodex/hooks/hooks.json. */
    readonly hookRegistered: (repoRoot: string) => Promise<boolean>;
}
