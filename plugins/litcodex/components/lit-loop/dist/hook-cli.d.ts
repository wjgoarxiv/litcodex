import { type JevHttpClient } from "./jev-hint.js";
/** Hard cap on stdin to bound memory / ReDoS exposure inside the 5 s Codex hook budget. 8 MB. */
export declare const MAX_STDIN_BYTES = 8000000;
/** Machine-readable error envelope emitted to stderr on a NON-zero exit. */
export interface LitHookError {
    readonly ok: false;
    readonly error: {
        readonly code: LitHookErrorCode;
        readonly message: string;
    };
}
export type LitHookErrorCode = "LIT_HOOK_STDIN_INVALID_JSON" | "LIT_HOOK_STDIN_TOO_LARGE";
/**
 * Stream-driven entry point. Resolves exactly one exit code (0 or 2); NEVER calls process.exit and
 * NEVER throws. Writes the camelCase activation line to stdout (empty on no-op), or a LitHookError
 * line to stderr on malformed / oversized stdin.
 */
export declare function runUserPromptSubmitHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, jev?: JevHookOptions, auto?: AutoHandoffHookOptions): Promise<number>;
/** Injectable environment for the automatic-handoff hooks; production uses the process environment. */
export interface AutoHandoffHookOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: number;
}
/** Injectable Jev dependencies; production uses the process environment and built-in `fetch`. */
export interface JevHookOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly http?: JevHttpClient;
    readonly skillsRoot?: string;
}
/** Enforce lit-plan persistence when a Stop hook event arrives. */
export declare function runStopPlanPersistenceHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
/** SessionStart: after a compaction inside a turn, bring this session's fresh handoff back once. */
export declare function runSessionStartHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
/** PostCompact: remember that a session that saved a handoff has now been compacted. Writes nothing to stdout. */
export declare function runPostCompactHookCli(stdin: NodeJS.ReadableStream, _stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
export declare function runPreToolUseCreateGoalGuardCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Promise<number>;
