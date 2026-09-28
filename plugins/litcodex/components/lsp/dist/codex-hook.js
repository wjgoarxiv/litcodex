// LitCodex LSP hook — inert placeholder.
//
// The upstream reference drove post-edit LSP diagnostics through an external LSP daemon package
// that is NOT bundled in this build. LitCodex ships the hook SURFACE
// (PostToolUse post-edit + PostCompact cache-reset subcommands and their payload contracts) so the
// component is present and wired, but both handlers degrade gracefully to a no-op: with no daemon
// there are no diagnostics to compute and no cache to reset. They read + validate the payload and
// emit nothing. When a daemon is later provided, these are the seams to fill in.
export function parsePostToolUsePayload(raw) {
    if (raw.trim().length === 0)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return isRecord(parsed) &&
            parsed["hook_event_name"] === "PostToolUse" &&
            typeof parsed["session_id"] === "string" &&
            typeof parsed["cwd"] === "string" &&
            typeof parsed["tool_name"] === "string" &&
            Object.hasOwn(parsed, "tool_input")
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export function parsePostCompactPayload(raw) {
    if (raw.trim().length === 0)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return isRecord(parsed) &&
            parsed["hook_event_name"] === "PostCompact" &&
            typeof parsed["session_id"] === "string" &&
            (parsed["trigger"] === undefined || typeof parsed["trigger"] === "string")
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
/** Post-edit diagnostics — no-op without a daemon. Returns "" (nothing to inject). */
export function runPostToolUseHook(_payload) {
    return "";
}
/** Diagnostics cache reset — no-op without a daemon. Returns "" (nothing to inject). */
export function runPostCompactHook(_payload) {
    return "";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
