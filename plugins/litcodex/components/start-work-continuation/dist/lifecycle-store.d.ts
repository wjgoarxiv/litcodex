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
export type WorkStatus = "active" | "paused" | "abandoned" | "completed";
export type WorkTransitionAction = "pause" | "resume" | "cancel" | "complete";
export type WorkReasonCode = "authorization_required" | "credential_required" | "host_capability_required" | "explicit_user_resume" | "user_cancelled" | "completed";
export type WorkLifecycleKind = "start_work_initialized" | "start_work_continuation_issued" | "start_work_paused" | "start_work_resumed" | "start_work_cancelled" | "start_work_completed";
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
export interface ContinuationLease {
    readonly progress_token: string;
    readonly turn_id: string;
    readonly transition_id: string;
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
    readonly pending_boundary?: AuthorityBoundary;
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
    readonly now?: () => string;
    readonly nowMs?: () => number;
    readonly afterStateWrite?: () => void;
    readonly onLedgerRead?: (bytes: number, offset: number) => void;
}
export interface TransitionResult {
    readonly changed: boolean;
    readonly state: LifecycleState;
    readonly event: WorkLifecycleEvent;
}
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
export declare function advanceStopLease(cwd: string, request: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly progressToken: string;
    readonly workId: string;
    readonly expectedRevision: number;
}, options?: StoreOptions): StopLeaseResult;
export declare function reconcileLifecycleState(cwd: string, options?: StoreOptions): LifecycleState | null;
