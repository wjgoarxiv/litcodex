import { isAbsolute, join, resolve } from "node:path";
import { findLifecycleRoot } from "./lifecycle-root.js";
import { inspectLifecycleState } from "./lifecycle-store.js";
import { isProtectedFileName, protectedReason } from "./protected-paths.js";
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
    if (!inspected.ok)
        return "";
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
        const reason = protectedReason(target.path, target.kind, env);
        if (reason !== null) {
            return deny(`LitCodex start-work refused this call: ${inert(target.path)} is ${reason}, and a start-work run never reads or edits secrets or Codex settings. Nobody can approve it here, \`lit approve\` included. Do not retry it another way; leave any task that needs it unchecked, give the reason on a \`BLOCKED:\` line in your final message, and continue with the remaining tasks.`);
        }
    }
    return "";
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
function deny(text) {
    return `${JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: text,
            additionalContext: text,
        },
    })}\n`;
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
