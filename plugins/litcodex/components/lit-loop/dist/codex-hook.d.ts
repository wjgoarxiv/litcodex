import { type LitMode } from "./modes.js";
/**
 * Accepted stdin event shape AFTER JSON.parse. The declared canonical wire form is snake_case;
 * `isLitUserPromptSubmitInput` additionally accepts the camelCase event-name/transcript keys at
 * runtime (A3 C12). Extra fields (cwd, model, session_id, …) are tolerated and ignored.
 */
export interface LitUserPromptSubmitInput {
    readonly hook_event_name: "UserPromptSubmit";
    readonly prompt: string;
    readonly transcript_path?: string | null;
}
export interface LitPreToolUseCreateGoalInput {
    readonly hook_event_name: "PreToolUse";
    readonly tool_name: "create_goal";
    readonly tool_input: unknown;
}
/** Structured engine result. The CLI maps this to stdout / exit. */
export type HookDecision = {
    readonly kind: "inject";
    readonly stdout: string;
    readonly mode: LitMode;
} | {
    readonly kind: "noop";
};
export type PreToolUseCreateGoalDecision = {
    readonly kind: "deny";
    readonly stdout: string;
} | {
    readonly kind: "noop";
};
/**
 * Type-guard. True iff `value` is a record whose accepted event-name key (snake `hook_event_name`
 * primary, camel `hookEventName` fallback) === "UserPromptSubmit", `prompt` is a string, and the
 * transcript-path key (either casing) is undefined | null | string (A3 C12). This is a runtime
 * accept-set, not a structural type assert, so a camelCase-keyed record also returns true.
 */
export declare function isLitUserPromptSubmitInput(value: unknown): value is LitUserPromptSubmitInput;
export declare function isLitPreToolUseCreateGoalInput(value: unknown): value is LitPreToolUseCreateGoalInput;
/**
 * Wraps directive text and the active mode in the Codex output envelope. Returns "" if the
 * normalized context is empty (caller treats "" as noop). Output is a single-line JSON + trailing
 * "\n" with the per-invocation user-visible systemMessage at the top level.
 */
export declare function formatAdditionalContextOutput(additionalContext: string, mode: LitMode, env?: NodeJS.ProcessEnv): string;
export declare function applyPreToolUseCreateGoalGuard(input: unknown): PreToolUseCreateGoalDecision;
/**
 * Pure decision function (multi-mode router). Takes an already-parsed value (NOT a raw string).
 * Total over `unknown`; NEVER throws. Flow: validate shape → match the lit-family trigger token
 * (guard 0) → resolve the mode → run guards 1-3 against the MATCHED mode's marker (RC1) → load that
 * mode's directive fail-silent. Returns { kind:"noop" } for a wrong-shape value, no trigger, a guard
 * veto, or a fail-silent empty directive; { kind:"inject", stdout } only on a real activation.
 */
export declare function runUserPromptSubmitHook(input: unknown): HookDecision;
