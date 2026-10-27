export declare const LIVENESS_DIR = ".litcodex/liveness";
export declare const LIVENESS_THROTTLE_MS = 30000;
export declare const LIVENESS_ENDED_MS: number;
export type LivenessState = "alive" | "idle" | "ended";
export interface LivenessRecord {
    readonly sessionId: string;
    readonly state: LivenessState;
    readonly at: number;
    readonly herdrPane: string | null;
}
/** Note that `sessionId` is `alive` or `idle` now. Never throws; a failed write only leaves the old record. */
export declare function recordLiveness(repoRoot: string, sessionId: string, state: "alive" | "idle", env: NodeJS.ProcessEnv, now?: number): void;
/** This session's record with `ended` derived from its age, or null when there is none. */
export declare function readLiveness(repoRoot: string, sessionId: string, now?: number): LivenessRecord | null;
/** Every session's record in this workspace (at most 64), `ended` derived from age. */
export declare function readSessionsLiveness(repoRoot: string, now?: number): LivenessRecord[];
