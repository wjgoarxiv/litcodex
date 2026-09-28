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
export declare function runUserPromptSubmitHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string): Promise<number>;
/** Enforce lit-plan persistence when a Stop hook event arrives. */
export declare function runStopPlanPersistenceHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string): Promise<number>;
export declare function runPreToolUseCreateGoalGuardCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Promise<number>;
