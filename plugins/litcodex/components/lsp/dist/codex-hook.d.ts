export interface PostToolUsePayload {
    readonly hook_event_name: "PostToolUse";
    readonly session_id: string;
    readonly cwd: string;
    readonly tool_name: string;
    readonly tool_input: unknown;
}
export interface PostCompactPayload {
    readonly hook_event_name: "PostCompact";
    readonly session_id: string;
    readonly trigger?: string;
}
export declare function parsePostToolUsePayload(raw: string): PostToolUsePayload | null;
export declare function parsePostCompactPayload(raw: string): PostCompactPayload | null;
/** Post-edit diagnostics — no-op without a daemon. Returns "" (nothing to inject). */
export declare function runPostToolUseHook(_payload: PostToolUsePayload): string;
/** Diagnostics cache reset — no-op without a daemon. Returns "" (nothing to inject). */
export declare function runPostCompactHook(_payload: PostCompactPayload): string;
