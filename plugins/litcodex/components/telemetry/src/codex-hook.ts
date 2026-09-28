// LitCodex telemetry — deliberately INERT local stub.
//
// The upstream reference component recorded session activity to a remote analytics endpoint on every
// SessionStart. LitCodex does NOT collect or transmit usage data, so this port keeps the same hook
// SURFACE (the `session-start` subcommand + payload contract) but the handler is a pure no-op: it
// reads the payload, does nothing, and emits no output. There is intentionally no network client,
// no distinct-id, no on-disk record, and no dependency that could phone home.

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
export async function runSessionStartHook(_input: CodexSessionStartInput): Promise<string> {
	return "";
}
