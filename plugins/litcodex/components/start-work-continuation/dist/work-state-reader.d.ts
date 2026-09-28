import type { AuthorityBoundary, AuthorityEnvelope, AuthorityGrant } from "./lifecycle-store.js";
import type { ReadonlyFileSystem } from "./types.js";
export type PlanChecklist = {
    readonly remaining: number;
    readonly total: number;
    readonly nextTaskLabel: string | null;
};
export type ContinuationState = {
    readonly workId: string;
    readonly revision: number;
    readonly planName: string;
    readonly planPath: string;
    readonly progressToken: string;
    readonly workStatePath: string;
    readonly ledgerPath: string;
    readonly worktreePath: string | null;
    readonly authority: AuthorityEnvelope;
    readonly authorityGrants: readonly AuthorityGrant[];
    readonly pendingBoundary: AuthorityBoundary | null;
    readonly checklist: PlanChecklist;
};
export declare function parsePlanChecklist(markdown: string): PlanChecklist;
export declare function readContinuationState(cwd: string, sessionId: string, _fs?: ReadonlyFileSystem): ContinuationState | null;
export type LifecycleDiagnostic = {
    readonly ok: true;
    readonly schemaVersion: 2 | 3;
    readonly revision: number;
    readonly activeWorkId: string | null;
    readonly state: "valid";
    readonly history: {
        readonly retained: number;
        readonly floorRevision: number;
    };
    readonly active: {
        readonly workId: string;
        readonly status: string;
    } | null;
    readonly pendingBoundary: AuthorityBoundary | null;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
export declare function diagnoseLifecycle(cwd: string): LifecycleDiagnostic;
