export interface LiveStep {
    readonly tool: string | null;
    readonly toolUseId: string | null;
    readonly startedAt: number | null;
    readonly endedAt: number | null;
    readonly turnStartedAt: number | null;
    readonly turnEndedAt: number | null;
    /** The tool that finished last in this turn; most steps end between two card polls. */
    readonly lastTool: string | null;
}
export interface ThreadPointer {
    readonly cwd: string;
    readonly updatedAt: number;
    readonly cardOfferedAt: number | null;
}
export interface ToolRef {
    readonly tool: string;
    readonly toolUseId: string | null;
}
/**
 * Open a regular file for reading, or return null. The type is checked before the open, so a symlink,
 * a named pipe or a device is never opened (opening a pipe would wait for a writer and freeze a hook);
 * the open itself refuses a symlink swapped in since, and callers check the type again with `fstat`.
 */
export declare function openRegularFile(path: string): number | null;
/** Parse a small regular file opened without following a symlink; null on any failure. */
export declare function readSmallJson(path: string, maxBytes?: number): unknown;
/** True when every folder of `rel` under `base` is missing or a real directory (no symlink on the way). */
export declare function plainDirsOrMissing(base: string, rel: string): boolean;
/**
 * Write `text` to `path` through a new temp file beside it and a rename. The temp name is random and
 * opened exclusively, so a file or symlink planted at a guessable name is never written through.
 */
export declare function writeFileAtomic(path: string, text: string): void;
export declare function liveStepPath(repoRoot: string, sessionId: string): string | null;
/** True when every folder of `rel` under `base` is a real directory (no symlink on the way). */
export declare function plainDirs(base: string, rel: string): boolean;
export declare function readLiveStep(repoRoot: string, sessionId: string): LiveStep | null;
/**
 * Open a turn: a LIT prompt arrived, so the model is working until Stop says otherwise. A tool that is
 * still running (a message typed while it runs) keeps its step.
 */
export declare function recordTurnStart(repoRoot: string, sessionId: string, now?: number): void;
export declare function recordLiveStepStart(repoRoot: string, sessionId: string, ref: ToolRef, now?: number): void;
/** Clear the step when this call is the one shown; a newer parallel call keeps its record. */
export declare function recordLiveStepEnd(repoRoot: string, sessionId: string, ref: ToolRef, now?: number): void;
/**
 * End whatever step this session still shows, since no tool runs once Stop fires, and close the turn
 * unless a Stop guard is sending the model back to work (`closeTurn` false).
 */
export declare function endLiveStep(repoRoot: string, sessionId: string, now?: number, closeTurn?: boolean): void;
/** `$CODEX_HOME`, else `$HOME/.codex`, read from the given environment only; null when neither is set. */
export declare function codexHomeFrom(env: NodeJS.ProcessEnv): string | null;
export declare function threadPointerPath(env: NodeJS.ProcessEnv, threadId: string): string | null;
export declare function readThreadPointer(env: NodeJS.ProcessEnv, threadId: string): ThreadPointer | null;
/** Point the thread at `cwd`; skips the write when the pointer already says so. */
export declare function writeThreadPointer(env: NodeJS.ProcessEnv, threadId: string, cwd: string, now?: number, options?: {
    readonly cardOffered?: boolean;
}): void;
