import { type WorkflowSignals } from "./workflow-map.js";
/** The card shows at most this many thread rows; the rest are counted as `+N more`. */
export declare const THREAD_ROWS = 4;
/** A deep chain still leaves this many rows for the lanes under it. */
export declare const PARALLEL_ROWS = 3;
export type ThreadState = "running" | "paused" | "blocked" | "idle" | "done";
export type ThreadKind = "frame" | "lane" | "session";
export interface ThreadRow {
    readonly key: string;
    readonly kind: ThreadKind;
    readonly name: string;
    readonly stage: string | null;
    /** `[▉▉░░░] 2/5`, only when both counts are real. */
    readonly gauge: string | null;
    /** What is known in words when there is no gauge: `step 2`, `3 steps`, `starting`, or empty. */
    readonly note: string;
    readonly state: ThreadState;
    readonly active: boolean;
    /** The first characters of another session's id. */
    readonly session?: string;
}
export interface ThreadView {
    readonly chain: readonly ThreadRow[];
    readonly lanes: readonly ThreadRow[];
    readonly others: readonly ThreadRow[];
    /** All live lanes, kept or not, for the fork line. */
    readonly laneCount: number;
    readonly more: number;
    /** True while a side frame runs over a paused spine: the way back is `lit continue`. */
    readonly back: boolean;
}
/**
 * The thread rows of a session, or null while it has no lane and no other live session (the stack row
 * then says what there is to say). `signals` are the session's saved work state, read once by the caller.
 */
export declare function readThreads(cwd: string, sessionId: string, now: number, signals: WorkflowSignals | null): ThreadView | null;
/** `3 lanes in parallel`, `1 lane in parallel`. */
export declare function forkLabel(laneCount: number): string;
/**
 * The threads as short sentences. The one running skill is left out, since the map names it.
 *
 *   Now: lit-brainstorm (interview, step 2)
 *   Paused: lit-loop (work, 3/6) · type `lit continue` to go back
 *   3 helpers: Aquinas 2/5, Lagrange 3 steps, Hume starting
 *   Also open in this project: lit-loop (work), waiting for you
 */
export declare function threadLines(view: ThreadView): string[];
