import { type PlanProgress } from "./plan-progress.js";
export declare const START_WORK_STATE_MAX_BYTES = 1000000;
export declare const START_WORK_PLAN_MAX_BYTES = 1000000;
export declare const START_WORK_LEDGER_TAIL_BYTES = 2000000;
export declare const START_WORK_MAX_FIELD_BYTES = 10000;
export declare const START_WORK_MAX_DISPLAY_BYTES = 512;
export declare const START_WORK_MAX_STDIN_BYTES = 1000000;
export declare const START_WORK_MAX_HISTORY_EVENTS = 64;
export declare const START_WORK_MAX_AUTHORITY_BYTES = 64000;
export declare const START_WORK_MAX_INIT_BYTES = 256000;
export declare const MAX_PARKED_BOUNDARIES = 16;
export declare const MAX_DENIED_BOUNDARIES = 64;
export declare const MAX_CANCEL_NOTICES = 16;
export type WorkStatus = "active" | "paused" | "abandoned" | "completed";
export type WorkTransitionAction = "pause" | "resume" | "cancel" | "complete";
export type WorkReasonCode = "authorization_required" | "credential_required" | "host_capability_required" | "explicit_user_resume" | "user_cancelled" | "completed";
export type WorkLifecycleKind = "start_work_initialized" | "start_work_continuation_issued" | "start_work_paused" | "start_work_resumed" | "start_work_cancelled" | "start_work_completed" | "start_work_boundary_parked" | "start_work_boundary_denied";
export interface AuthorityEnvelope {
    readonly authority_id: string;
    readonly allowed_roots: readonly string[];
    readonly allowed_actions: readonly string[];
    readonly forbidden_actions: readonly string[];
}
export interface AuthorityBoundary {
    readonly boundary_id: string;
    readonly authority_id: string;
    readonly action: string;
    readonly root: string;
}
export interface AuthorityGrant {
    readonly grant_id: string;
    readonly authority_id: string;
    readonly boundary_id: string;
    readonly action: string;
    readonly root: string;
}
export interface ParkedBoundary extends AuthorityBoundary {
    readonly parked_at: string;
    readonly session_id: string;
    readonly transition_id: string;
}
export interface CancelNotice {
    readonly work_id: string;
    readonly plan_name: string;
    readonly by_session_id: string;
    readonly at: string;
}
export interface ContinuationLease {
    readonly progress_token: string;
    readonly turn_id: string;
    readonly transition_id: string;
    /** Short digest of the parked boundary ids when the lease was issued; absent when nothing was parked. */
    readonly parked_digest?: string;
}
export interface WorkLifecycleEvent {
    readonly kind: WorkLifecycleKind;
    readonly at: string;
    readonly workId: string;
    readonly transitionId: string;
    readonly revision: number;
    readonly fromWorkStatus?: WorkStatus;
    readonly toWorkStatus: WorkStatus;
    readonly plan: string;
    readonly sessionId: string;
    readonly reasonCode?: WorkReasonCode;
    readonly turnId?: string;
    readonly progressToken?: string;
    readonly initFingerprint?: string;
    readonly boundary?: AuthorityBoundary;
    readonly grant?: AuthorityGrant;
    /** The boundaries a typed `lit deny` refused; deny events only. */
    readonly boundaryIds?: readonly string[];
}
export interface WorkStateEntry {
    readonly [key: string]: unknown;
    readonly work_id: string;
    readonly active_plan: string;
    readonly plan_name: string;
    readonly session_ids: readonly string[];
    readonly status: WorkStatus;
    readonly worktree_path: string | null;
    readonly authority?: AuthorityEnvelope;
    /** Written by older versions only; a schema-3 paused work holding one is read as an active work with it parked. */
    readonly pending_boundary?: AuthorityBoundary;
    readonly parked_boundaries?: readonly ParkedBoundary[];
    readonly denied_boundaries?: readonly AuthorityBoundary[];
    readonly authority_grants?: readonly AuthorityGrant[];
    readonly continuation_lease?: ContinuationLease;
    readonly last_transition?: WorkLifecycleEvent;
}
export interface LifecycleState {
    readonly [key: string]: unknown;
    readonly schema_version: 3;
    readonly revision: number;
    readonly active_work_id: string | null;
    readonly works: Readonly<Record<string, WorkStateEntry>>;
    readonly transition_history?: Readonly<Record<string, WorkLifecycleEvent>>;
    readonly history_floor_revision?: number;
    readonly cancel_notices?: Readonly<Record<string, CancelNotice>>;
}
export interface TransitionRequest {
    readonly action: WorkTransitionAction;
    readonly expectedRevision: number;
    readonly sessionId: string;
    readonly transitionId: string;
    readonly workId: string;
    readonly reasonCode: WorkReasonCode;
    readonly turnId?: string;
    readonly boundary?: AuthorityBoundary;
    readonly grant?: AuthorityGrant;
    readonly authority?: InitRequest["authority"];
}
export interface InitRequest {
    readonly initId: string;
    readonly expectedRevision: number;
    readonly workId: string;
    readonly plan: string;
    readonly planName: string;
    readonly sessionId: string;
    readonly worktreePath?: string | null;
    readonly authority: {
        readonly authorityId: string;
        readonly allowedRoots: readonly string[];
        readonly allowedActions: readonly string[];
        readonly forbiddenActions: readonly string[];
    };
}
export interface StoreOptions {
    /** Supplies HOME and CODEX_HOME for the protected-path and host-read rules; defaults to `process.env`. */
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: () => string;
    readonly nowMs?: () => number;
    readonly afterStateWrite?: () => void;
    readonly onLedgerRead?: (bytes: number, offset: number) => void;
}
export type TransitionOutcome = "authorized" | "parked" | "already_parked";
export interface TransitionResult {
    readonly changed: boolean;
    readonly state: LifecycleState;
    readonly event: WorkLifecycleEvent;
    /** Set for a pause: whether the step was already covered, newly parked, or parked before. */
    readonly outcome?: TransitionOutcome;
}
export type CancelResult = {
    readonly outcome: "nothing";
} | {
    readonly outcome: "replay";
    readonly workId: string;
    readonly plan: string;
} | {
    readonly outcome: "cancelled";
    readonly workId: string;
    readonly plan: string;
    readonly otherSession: boolean;
};
export type DenyResult = {
    readonly outcome: "nothing";
} | {
    readonly outcome: "denied" | "replay";
    readonly workId: string;
    readonly boundaries: readonly AuthorityBoundary[];
};
export type InitResult = TransitionResult;
export type StopLeaseResult = {
    readonly outcome: "silent";
    readonly state: LifecycleState;
} | {
    readonly outcome: "issued" | "replay";
    readonly state: LifecycleState;
    readonly event: WorkLifecycleEvent;
};
export interface CanonicalPlan {
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly text: string;
    readonly progress: PlanProgress;
}
export declare class LifecycleStoreError extends Error {
    readonly code: string;
    readonly name = "LifecycleStoreError";
    constructor(code: string, message: string);
}
export declare function statePathFor(cwd: string): string;
export declare function ledgerPathFor(cwd: string): string;
export declare function isBoundedLifecycleText(value: unknown, maxBytes?: number): value is string;
export declare function readLifecycleState(cwd: string): LifecycleState | null;
export declare function inspectLifecycleState(cwd: string): {
    readonly ok: true;
    readonly state: LifecycleState;
    readonly sourceSchema: 2 | 3;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
export declare function selectWorkForSession(state: LifecycleState, sessionId: string, statuses: readonly WorkStatus[]): WorkStateEntry | null;
export declare function resolveCanonicalPlan(cwd: string, activePlan: string, allowHistoricalAbsolute?: boolean): CanonicalPlan;
export declare function initializeWork(cwd: string, request: InitRequest, options?: StoreOptions): InitResult;
export declare function transitionWork(cwd: string, request: TransitionRequest, options?: StoreOptions): TransitionResult;
/**
 * The typed `lit cancel`: ends the project's nonterminal run whichever Codex session of the project typed it. It
 * checks neither session membership nor an expected revision and never reads the plan, so a deleted or emptied
 * plan cannot keep a user from ending the run. Every other session of the run is left a notice for its next prompt.
 */
export declare function cancelWorkFromUserPrompt(cwd: string, request: {
    readonly sessionId: string;
    readonly turnId: string;
}, options?: StoreOptions): CancelResult;
/**
 * Remove and return this session's cancel notice. It is bookkeeping, not a lifecycle step: no event is recorded and
 * the revision does not move, so a lane still holding the old revision is not turned away.
 */
export declare function takeCancelNotice(cwd: string, sessionId: string, options?: StoreOptions): CancelNotice | null;
/** The typed `lit deny`: every parked step of this session's run moves to the refused list for the rest of the run. */
export declare function denyParkedBoundaries(cwd: string, request: {
    readonly sessionId: string;
    readonly turnId: string;
}, options?: StoreOptions): DenyResult;
/**
 * Drop a parked step whose root no longer exists, without an event or a revision move. Returns false and changes
 * nothing when the root is still there or the step is not parked for this session.
 */
export declare function dropVanishedParkedBoundary(cwd: string, sessionId: string, boundaryId: string, options?: StoreOptions): boolean;
export declare function advanceStopLease(cwd: string, request: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly progressToken: string;
    readonly workId: string;
    readonly expectedRevision: number;
}, options?: StoreOptions): StopLeaseResult;
export declare function reconcileLifecycleState(cwd: string, options?: StoreOptions): LifecycleState | null;
export declare function isReleaseClass(action: string): boolean;
