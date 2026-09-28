import { type LitLoopScope } from "./state-paths.js";
import { type LitLoopLedgerEntry, type LitLoopLedgerInput, type LitLoopPlan } from "./state-types.js";
export { evidencePath, resolveLoopScope } from "./state-paths.js";
/** Alias of `litLoopDir` under the name M09 (loop model) and M11 (doctor) import. */
export declare function resolveLoopStateDir(repoRoot: string, scope?: LitLoopScope): string;
export declare function statExists(absPath: string): Promise<boolean>;
export declare class BriefFileMissingError extends Error {
    readonly name = "BriefFileMissingError";
    readonly path: string;
    constructor(path: string, cause?: unknown);
}
export declare class BriefFileUnreadableError extends Error {
    readonly name = "BriefFileUnreadableError";
    readonly path: string;
    constructor(path: string, cause?: unknown);
}
/**
 * Read `briefFilePath` as INERT UTF-8 text. The path is used AS GIVEN — no normalization, no
 * re-rooting against `repoRoot`, no rejection (the bytes are data, never re-interpreted as a
 * path/flag). ENOENT/EISDIR → BriefFileMissingError; EACCES/EIO → BriefFileUnreadableError.
 */
export declare function readBriefFile(_repoRoot: string, briefFilePath: string): Promise<string>;
export declare function withMutationLock<T>(repoRoot: string, scope: LitLoopScope | undefined, body: () => Promise<T>): Promise<T>;
/** @deprecated Alias of `withMutationLock` (SAME function reference, same lock map). */
export declare const withStateMutationLock: typeof withMutationLock;
export declare function writePlan(repoRoot: string, plan: LitLoopPlan, scope?: LitLoopScope): Promise<void>;
export declare function writeBrief(repoRoot: string, brief: string, scope?: LitLoopScope): Promise<void>;
export declare function readBrief(repoRoot: string, scope?: LitLoopScope): Promise<string>;
export declare function appendLedger(repoRoot: string, entry: LitLoopLedgerInput, scope?: LitLoopScope): Promise<void>;
export declare function readLedger(repoRoot: string, scope?: LitLoopScope): Promise<{
    entries: LitLoopLedgerEntry[];
    skipped: number;
}>;
export declare function ensureEvidenceDir(repoRoot: string, scope?: LitLoopScope): Promise<string>;
export declare function readPlan(repoRoot: string, scope?: LitLoopScope): Promise<LitLoopPlan>;
export declare function initState(repoRoot: string, args: {
    brief: string;
    sessionId?: string | null;
}): Promise<LitLoopPlan>;
export declare function exitCodeFor(err: unknown): number;
