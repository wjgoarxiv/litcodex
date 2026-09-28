export type CodexSessionStartInput = {
    session_id: string;
    transcript_path: string | null;
    cwd: string;
    hook_event_name: "SessionStart";
    model: string;
    permission_mode: string;
    source: "startup" | "resume" | "clear";
};
/**
 * SessionStart hook — local-only no-op. Accepts a validated payload and returns the empty string
 * (Codex treats empty output as "nothing to inject"). NEVER performs I/O beyond returning.
 */
export declare function runSessionStartHook(_input: CodexSessionStartInput): Promise<string>;
