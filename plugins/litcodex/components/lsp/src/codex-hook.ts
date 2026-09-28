// LitCodex LSP hook — inert placeholder.
//
// The upstream reference drove post-edit LSP diagnostics through an external LSP daemon package
// that is NOT bundled in this build. LitCodex ships the hook SURFACE
// (PostToolUse post-edit + PostCompact cache-reset subcommands and their payload contracts) so the
// component is present and wired, but both handlers degrade gracefully to a no-op: with no daemon
// there are no diagnostics to compute and no cache to reset. They read + validate the payload and
// emit nothing. When a daemon is later provided, these are the seams to fill in.

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

export function parsePostToolUsePayload(raw: string): PostToolUsePayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) &&
			parsed["hook_event_name"] === "PostToolUse" &&
			typeof parsed["session_id"] === "string" &&
			typeof parsed["cwd"] === "string" &&
			typeof parsed["tool_name"] === "string" &&
			Object.hasOwn(parsed, "tool_input")
			? (parsed as unknown as PostToolUsePayload)
			: null;
	} catch {
		return null;
	}
}

export function parsePostCompactPayload(raw: string): PostCompactPayload | null {
	if (raw.trim().length === 0) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) &&
			parsed["hook_event_name"] === "PostCompact" &&
			typeof parsed["session_id"] === "string" &&
			(parsed["trigger"] === undefined || typeof parsed["trigger"] === "string")
			? (parsed as unknown as PostCompactPayload)
			: null;
	} catch {
		return null;
	}
}

/** Post-edit diagnostics — no-op without a daemon. Returns "" (nothing to inject). */
export function runPostToolUseHook(_payload: PostToolUsePayload): string {
	return "";
}

/** Diagnostics cache reset — no-op without a daemon. Returns "" (nothing to inject). */
export function runPostCompactHook(_payload: PostCompactPayload): string {
	return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
