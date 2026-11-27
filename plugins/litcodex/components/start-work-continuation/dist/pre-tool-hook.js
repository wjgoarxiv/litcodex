import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { guardShellCall, loadRun } from "./autopilot.js";
import { findLifecycleRoot } from "./lifecycle-root.js";
import { inspectLifecycleState, statePathFor } from "./lifecycle-store.js";
import { containedReason, isProtectedFileName, protectedReason } from "./protected-paths.js";
const MAX_INPUT_STRING = 100_000;
const PATH_FIELDS = [
    "path",
    "file_path",
    "filePath",
    "target",
    "targetPath",
    "target_path",
    "paths",
    "file_paths",
    "filePaths",
];
const PATCH_FIELDS = ["input", "patch", "command", "cmd"];
const PATCH_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gmu;
/**
 * The start-work PreToolUse guard. While this session owns a nonterminal run, a direct tool call naming a secret
 * or a Codex setting is denied; after another session ended the run with `lit cancel`, every guarded call is
 * denied until the user next types here. Everything else, including every other session, gets no output. The hook
 * never answers allow or ask; the lifecycle store's own checks stay the authority.
 */
export function runPreToolUseHook(input, options = {}) {
    if (!isRecord(input) || input["hook_event_name"] !== "PreToolUse")
        return "";
    const sessionId = input["session_id"];
    const cwd = input["cwd"];
    const tool = input["tool_name"];
    if (!bounded(sessionId) || !bounded(cwd) || !isAbsolute(cwd) || typeof tool !== "string")
        return "";
    const env = options.env ?? process.env;
    const root = findLifecycleRoot(cwd, { wantSession: sessionId });
    const inspected = inspectLifecycleState(root);
    if (!inspected.ok) {
        // Fail closed for this session only: a lifecycle file that cannot be read but still names it may hold its run.
        return namesSession(statePathFor(root), sessionId)
            ? deny("LitCodex start-work could not read the run state that names this session, so it could not check this call and did not run it. Stop making tool calls, and tell the user the start-work state is unreadable; they can end the run with `lit cancel`.", null)
            : "";
    }
    const state = inspected.state;
    const notice = state.cancel_notices?.[`codex:${sessionId}`];
    if (notice !== undefined) {
        return deny(`LitCodex start-work ${inert(notice.work_id)} (${inert(notice.plan_name)}) was ended by \`lit cancel\` from another Codex session. Stop working on it: make no further tool calls this turn, and tell the user the run was cancelled. This guard clears when the user next types in this session.`);
    }
    const active = state.active_work_id === null ? undefined : state.works[state.active_work_id];
    if (active === undefined ||
        (active.status !== "active" && active.status !== "paused") ||
        !active.session_ids.includes(`codex:${sessionId}`)) {
        return "";
    }
    for (const target of targetsOf(tool, input["tool_input"], cwd, env)) {
        const reason = protectedReason(target.path, target.kind, env) ??
            (target.kind === "write" ? containedReason(target.path, env, [root]) : null);
        if (reason !== null) {
            return deny(`LitCodex start-work refused this call: ${inert(target.path)} is ${reason}, and a start-work run never reads or edits secrets or Codex settings. Nobody can approve it here, \`lit approve\` included. Do not retry it another way; if a row needs it, write \`BLOCKED: <reason>\` under that row and continue with the next row.`);
        }
    }
    // The guard follows the lifecycle state alone: a plain prompt, a side `lit` route or a paused boundary leaves it on.
    if (tool === "Bash") {
        const command = isRecord(input["tool_input"])
            ? (input["tool_input"]["command"] ?? input["tool_input"]["cmd"])
            : undefined;
        if (typeof command !== "string")
            return "";
        // Fail closed: this session owns a run, so a plan or state that cannot be read denies the call.
        const run = loadRun(cwd, sessionId, ["active", "paused"]);
        if (run === null) {
            return deny("LitCodex start-work could not read this run's plan or state, so it could not check this call and did not run it. Stop making tool calls, and tell the user the run's plan is unreadable or has no rows; they can fix the plan or end the run with `lit cancel`.", null);
        }
        try {
            const parked = guardShellCall(run, command, cwd, { env });
            if (parked !== null)
                return deny(parked.reason, parked.ping);
        }
        catch (error) {
            if (!(error instanceof Error))
                throw error;
            return deny("LitCodex start-work could not check or park this call (its state was busy or unreadable), so it did not run. Continue with the next row and try this step again later.", null);
        }
    }
    return "";
}
const UNCHECKED = "LitCodex start-work could not check this call (its hook input was too large, malformed, or the check failed), so it did not run. Split the step into smaller calls; if it keeps failing, write `BLOCKED: <reason>` under the row and continue with the next row.";
/**
 * The guard's answer when it could not run: hook input over the byte limit, input that is not JSON, or a check that
 * threw. It denies when the input names a session that owns a run here, or when it names no session and folder at
 * all; a readable session and folder without a run get no output, so other sessions keep working.
 */
export function runPreToolUseFallback(head) {
    return uncheckedDecision(jsonField(head, "session_id"), jsonField(head, "cwd"));
}
/** The same answer for parsed input whose check threw. */
export function uncheckedDecision(sessionId, cwd) {
    if (!bounded(sessionId) || !bounded(cwd) || !isAbsolute(cwd))
        return deny(UNCHECKED, null);
    try {
        return sessionOwnsRun(cwd, sessionId) ? deny(UNCHECKED, null) : "";
    }
    catch {
        return deny(UNCHECKED, null);
    }
}
function sessionOwnsRun(cwd, sessionId) {
    const root = findLifecycleRoot(cwd, { wantSession: sessionId });
    const inspected = inspectLifecycleState(root);
    if (!inspected.ok)
        return namesSession(statePathFor(root), sessionId);
    const state = inspected.state;
    if (state.cancel_notices?.[`codex:${sessionId}`] !== undefined)
        return true;
    const active = state.active_work_id === null ? undefined : state.works[state.active_work_id];
    return (active !== undefined &&
        (active.status === "active" || active.status === "paused") &&
        active.session_ids.includes(`codex:${sessionId}`));
}
/** The first `"name": "<string>"` in raw hook input, decoded; null when it is missing or not a JSON string. */
function jsonField(raw, name) {
    const match = new RegExp(`"${name}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`, "u").exec(raw);
    if (match?.[1] === undefined)
        return null;
    try {
        const value = JSON.parse(match[1]);
        return typeof value === "string" ? value : null;
    }
    catch {
        return null;
    }
}
function targetsOf(tool, toolInput, cwd, env) {
    if (tool === "Bash") {
        const command = isRecord(toolInput) ? (toolInput["command"] ?? toolInput["cmd"]) : undefined;
        return typeof command === "string" ? bashWords(command, cwd, env) : [];
    }
    if (tool === "apply_patch") {
        const texts = typeof toolInput === "string"
            ? [toolInput]
            : isRecord(toolInput)
                ? PATCH_FIELDS.map((field) => toolInput[field]).filter((value) => typeof value === "string")
                : [];
        return texts.flatMap((text) => [...text.matchAll(PATCH_HEADER)].map((match) => ({
            path: resolve(cwd, (match[1] ?? "").trim()),
            kind: "write",
        })));
    }
    if (!isRecord(toolInput))
        return [];
    const paths = [];
    for (const field of PATH_FIELDS) {
        const value = toolInput[field];
        const list = Array.isArray(value) ? value : [value];
        for (const item of list) {
            if (typeof item === "string" && item.length > 0)
                paths.push({ path: resolve(cwd, item), kind: "write" });
        }
    }
    return paths;
}
/**
 * Literal path words of a shell command: words with a slash, words starting with `.` or `~`, and bare protected
 * file names. Shell expansions such as `$HOME` are not evaluated, so they are not caught here.
 */
function bashWords(command, cwd, env) {
    const home = env["HOME"];
    const targets = [];
    for (const raw of command.split(/[\s;&|<>()]+/u)) {
        const word = unquote(raw);
        if (word.length === 0)
            continue;
        if (!(word.includes("/") || word.startsWith(".") || word.startsWith("~") || isProtectedFileName(word)))
            continue;
        let path = word;
        if (path === "~" || path.startsWith("~/")) {
            if (typeof home !== "string" || !isAbsolute(home))
                continue;
            path = join(home, path.slice(1));
        }
        targets.push({ path: resolve(cwd, path), kind: "read" });
    }
    return targets;
}
function unquote(word) {
    const first = word[0];
    return word.length >= 2 && (first === "'" || first === '"') && word.at(-1) === first ? word.slice(1, -1) : word;
}
function deny(text, ping = null) {
    return `${JSON.stringify({
        ...(ping === null ? {} : { systemMessage: ping }),
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: text,
            additionalContext: text,
        },
    })}\n`;
}
function namesSession(path, sessionId) {
    try {
        const stat = lstatSync(path);
        if (!stat.isFile())
            return false;
        const text = readFileSync(path, "utf8").slice(0, 8_000_000);
        return text.includes(`codex:${sessionId}`);
    }
    catch {
        return false;
    }
}
function inert(text) {
    return text.replace(/\p{Cc}/gu, " ");
}
function bounded(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_INPUT_STRING;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
