export declare const HEAD_BYTES: number;
export declare const TAIL_BYTES: number;
export declare const TOTAL_BYTES: number;
export interface RolloutFile {
    readonly path: string;
    readonly id: string;
    readonly mtimeMs: number;
    readonly size: number;
}
export type LastEvent = "user" | "agent" | "complete" | "tool" | "aborted" | null;
export interface RolloutFacts {
    readonly id: string;
    readonly cwd: string | null;
    readonly startedAt: number | null;
    readonly lastAt: number | null;
    readonly firstUser: string | null;
    readonly lastUser: string | null;
    readonly lastAgent: string | null;
    readonly last: LastEvent;
    readonly subagent: boolean;
    /** Tool calls seen in the window read; a floor, not a total, when `stepsPartial`. */
    readonly steps: number;
    readonly stepsPartial: boolean;
    /** Name of the last tool the session called, as Codex records it. */
    readonly lastTool: string | null;
    /** What that last call was about, in a word or two: a patched file's base name or the program a shell call ran. */
    readonly lastTarget: string | null;
    /** Tool names with the number of calls seen in the window read, most used first. */
    readonly tools: readonly (readonly [string, number])[];
    /** Base names of the files `apply_patch` touched in the window read, in order, without repeats. */
    readonly edited: readonly string[];
}
/** A byte allowance shared by every read of one run. */
export interface ByteBudget {
    remaining: number;
    exhausted: boolean;
}
export declare function newBudget(total?: number): ByteBudget;
/** Rollout files under `<home>/sessions`, newest first. Symlinks, other file types and deep trees are skipped. */
export declare function listRollouts(codexHome: string): RolloutFile[];
/** Facts from the head and tail records of one rollout. */
export declare function parseRollout(fileId: string, window: {
    head: string;
    tail: string | null;
    headCut: boolean;
}): RolloutFacts;
/** Facts for one rollout, or null when it cannot be read (refused type, budget spent, unreadable). */
export declare function readRollout(file: RolloutFile, budget: ByteBudget): RolloutFacts | null;
