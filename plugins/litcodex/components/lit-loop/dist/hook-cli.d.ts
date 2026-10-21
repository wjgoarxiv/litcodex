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
export declare function runUserPromptSubmitHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
/** Injectable environment for the automatic-handoff hooks; production uses the process environment. */
export interface AutoHandoffHookOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: number;
}
/**
 * Asks the model to open the LIT card for this LIT turn, so the live card sits next to the newest turn
 * instead of scrolling away with the first one. In the terminal `codex` the same tool returns the map as text.
 */
export declare const CARD_OFFER_CONTEXT = "LIT card: if the `lit_card` tool (litcodex MCP server) is available, call the `lit_card` tool once now, with no arguments, so the user sees the live LIT card for this turn. It replaces the previous turn's card, which folds itself into one line. Do not call it again in this turn; it updates by itself.";
/** The card request for a continued discipline: the model already read the full one when it was activated. */
export declare const CARD_OFFER_CONTINUE_CONTEXT = "LIT card: if the `lit_card` tool is available, call it once now with no arguments; it updates by itself.";
/** Enforce lit-plan persistence when a Stop hook event arrives. */
export declare function runStopPlanPersistenceHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
/** SessionStart: after a compaction inside a turn, bring this session's fresh handoff back once. */
export declare function runSessionStartHookCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
/** PostCompact: remember that a session that saved a handoff has now been compacted. Writes nothing to stdout. */
export declare function runPostCompactHookCli(stdin: NodeJS.ReadableStream, _stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, repoRoot?: string, auto?: AutoHandoffHookOptions): Promise<number>;
export declare function runPreToolUseCreateGoalGuardCli(stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Promise<number>;
/** Injectable environment and clock for the live-step hooks. */
export interface LiveStepHookOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: number;
}
/**
 * Catch-all PreToolUse: in a thread with a LIT activation, remember the running tool for the LIT card
 * and point the thread at its workspace. It prints nothing and exits 0 on every input, so it can never block or change a tool call.
 */
export declare function runPreToolUseLiveHookCli(stdin: NodeJS.ReadableStream, _stdout: NodeJS.WritableStream, _stderr: NodeJS.WritableStream, options?: LiveStepHookOptions): Promise<number>;
/** Catch-all PostToolUse: clear the live step this call set. Prints nothing; exits 0 on every input. */
export declare function runPostToolUseLiveHookCli(stdin: NodeJS.ReadableStream, _stdout: NodeJS.WritableStream, _stderr: NodeJS.WritableStream, options?: LiveStepHookOptions): Promise<number>;
