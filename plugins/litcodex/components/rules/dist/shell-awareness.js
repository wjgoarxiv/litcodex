import { existsSync } from "node:fs";
import { join } from "node:path";
const SHELL_AWARENESS_MARKER = "## Shell Runtime";
export const SHELL_AWARENESS_DEDUP_KEY = "__litcodex_shell_awareness__";
export function isCodexAppServerActive(env = process.env) {
    const originator = env["CODEX_INTERNAL_ORIGINATOR_OVERRIDE"]?.toLowerCase() ?? "";
    const bundleIdentifier = env["__CFBundleIdentifier"]?.toLowerCase() ?? "";
    const shellActive = isTruthy(env["CODEX_SHELL"]);
    return (shellActive &&
        (originator.includes("codex desktop") ||
            originator.includes("codex app") ||
            bundleIdentifier === "com.openai.codex"));
}
function isShellAppServerConfigured(env = process.env) {
    const codexSocketPath = env["CODEX_APP_SERVER_SOCKET"]?.trim() ?? "";
    const litcodexSocketPath = env["LITCODEX_SHELL_APP_SERVER_SOCKET"]?.trim() ?? "";
    return codexSocketPath.length > 0 || litcodexSocketPath.length > 0;
}
export function resolveLitCodexInvocation(env = process.env, deps = {}) {
    const fileExists = deps.fileExists ?? existsSync;
    const platform = deps.platform ?? process.platform;
    const binNames = platform === "win32" ? ["litcodex.cmd", "litcodex.exe", "litcodex"] : ["litcodex"];
    const pathDelimiter = platform === "win32" ? ";" : ":";
    const pathEntries = (env["PATH"] ?? "").split(pathDelimiter).filter((entry) => entry.trim().length > 0);
    for (const pathEntry of pathEntries) {
        for (const binName of binNames) {
            if (fileExists(join(pathEntry, binName)))
                return "litcodex";
        }
    }
    for (const candidateDir of litcodexCandidateBinDirs(env)) {
        for (const binName of binNames) {
            const candidate = join(candidateDir, binName);
            if (fileExists(candidate))
                return candidate;
        }
    }
    return null;
}
function litcodexCandidateBinDirs(env) {
    const dirs = [];
    const localBinDir = env["CODEX_LOCAL_BIN_DIR"]?.trim() ?? "";
    if (localBinDir.length > 0)
        dirs.push(localBinDir);
    const home = env["HOME"]?.trim() || env["USERPROFILE"]?.trim() || "";
    const codexHome = env["CODEX_HOME"]?.trim() || (home.length > 0 ? join(home, ".codex") : "");
    if (codexHome.length > 0)
        dirs.push(join(codexHome, "bin"));
    if (home.length > 0)
        dirs.push(join(home, ".local", "bin"));
    return dirs;
}
export function getShellRuntimeAwareness(env = process.env, deps = {}) {
    const override = env["LITCODEX_SHELL_AWARENESS"] ?? env["LITCODEX_SHELL_AWARENESS"];
    if (isFalsy(override)) {
        return "";
    }
    if (!isTruthy(override) && !isCodexAppServerActive(env) && !isShellAppServerConfigured(env)) {
        return "";
    }
    const resolved = resolveLitCodexInvocation(env, deps);
    const invocation = resolved ?? (isTruthy(override) ? "litcodex" : null);
    if (invocation === null) {
        return "";
    }
    const command = /\s/.test(invocation) ? `"${invocation}"` : invocation;
    return [
        SHELL_AWARENESS_MARKER,
        "",
        `- Prefer \`${command} shell <command>\` for repo inspection, CLI smoke tests, git/history checks, and bounded verification before falling back to raw shell commands.`,
        `- Use \`${command} shell --shell '<command>'\` only when shell metacharacters are required.`,
        `- Use \`${command} shell --tmux-pane <pane-id> --tail-lines 400\` to inspect an existing tmux pane. Tail lines must stay between 100 and 1000.`,
        "- When no native sidecar or appserver is available, Shell silently falls back to raw command execution. `LITCODEX_SHELL_BIN` selects a native sidecar path.",
        "- When `CODEX_THREAD_ID` identifies a Codex session, Shell appends recent session context (first/latest user request + last 5 conversation messages) after the shell result so output consumers stay aligned with the session goals. `LITCODEX_SHELL_SESSION_CONTEXT=0` disables it.",
        `- Route potentially huge output (full log files, big diffs, \`cat\`/\`grep\` over large artifacts) through \`${command} shell\` instead of reading it raw: oversized output is condensed to a budget while preserving error signatures, repeated patterns, session-goal-relevant lines, and head/tail. Tune with \`--budget <chars>\`; disable with \`LITCODEX_SHELL_CONDENSE=0\`.`,
        "- Oversized output is first summarized by the spark model (`codex exec`, default `gpt-5.3-codex-spark`) fed with the session context: the summary reproduces the output as-is (no masking) and ends with a `[shell caption]` line describing what ran and which lines were omitted. `LITCODEX_SHELL_SPARK=0` skips the model and uses deterministic condensation directly.",
    ].join("\n");
}
function isTruthy(value) {
    if (value === undefined) {
        return false;
    }
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
function isFalsy(value) {
    if (value === undefined) {
        return false;
    }
    return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
