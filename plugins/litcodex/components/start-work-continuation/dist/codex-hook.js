import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { START_WORK_CONTINUATION_DIRECTIVE } from "./directive.js";
import { advanceStopLease, inspectLifecycleState, reconcileLifecycleState, selectWorkForSession, transitionWork, } from "./lifecycle-store.js";
import { readContinuationState } from "./work-state-reader.js";
const MAX_TRANSCRIPT_BYTES = 2_000_000;
const MAX_INPUT_STRING = 100_000;
const TRUSTED_CONTEXT_ERROR_CODES = new Set(["context_length_exceeded", "context_too_large"]);
const O_NOFOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
export function runStopHook(input, _legacyFs) {
    if (!isStopInput(input))
        return "";
    if (input.stop_hook_active)
        return "";
    const transcript = inspectTranscript(input.transcript_path);
    if (transcript !== "clear")
        return "";
    const continuation = readContinuationState(input.cwd, input.session_id);
    if (continuation === null)
        return "";
    try {
        const lease = advanceStopLease(input.cwd, {
            sessionId: input.session_id,
            turnId: input.turn_id,
            progressToken: continuation.progressToken,
            workId: continuation.workId,
            expectedRevision: continuation.revision,
        });
        if (lease.outcome === "silent")
            return "";
        return block(renderDirective({ ...continuation, revision: lease.state.revision }, input.session_id));
    }
    catch (error) {
        if (error instanceof Error)
            return "";
        throw error;
    }
}
export function runUserPromptSubmitHook(input, options = {}) {
    if (!isUserPromptSubmitInput(input))
        return "";
    const route = parseExplicitStartWorkPrompt(input.prompt);
    if (route === null)
        return "";
    try {
        reconcileLifecycleState(input.cwd, options);
        const inspected = inspectLifecycleState(input.cwd);
        if (!inspected.ok || inspected.state.active_work_id === null)
            return "";
        if (route.resumeBoundaryId === null || route.grantId === null)
            return "";
        const transitionId = `prompt-resume:${digest([inspected.state.active_work_id, route.resumeBoundaryId, route.grantId, input.session_id, input.turn_id].join("\0"))}`;
        const paused = selectWorkForSession(inspected.state, input.session_id, ["paused"]);
        const selected = paused ??
            matchingResumeReplay(inspected.state.works[inspected.state.active_work_id], input.session_id, transitionId);
        if (selected === null ||
            !selectorMatches(route.selector, selected) ||
            !worktreeMatches(route.worktreePath, selected)) {
            return "";
        }
        const pending = selected.pending_boundary ??
            (selected.last_transition?.kind === "start_work_resumed" ? selected.last_transition.boundary : undefined);
        if (pending === undefined || pending.boundary_id !== route.resumeBoundaryId)
            return "";
        const grant = {
            grant_id: route.grantId,
            authority_id: pending.authority_id,
            boundary_id: pending.boundary_id,
            action: pending.action,
            root: pending.root,
        };
        transitionWork(input.cwd, {
            action: "resume",
            expectedRevision: inspected.state.revision,
            sessionId: input.session_id,
            transitionId,
            workId: selected.work_id,
            reasonCode: "explicit_user_resume",
            turnId: input.turn_id,
            boundary: pending,
            grant,
        }, options);
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
    }
    // Codex accepts a zero-byte successful UserPromptSubmit hook. The lit-loop handler owns the
    // additionalContext directive for this same prompt; this lifecycle handler must not steal it.
    return "";
}
function block(reason) {
    return JSON.stringify({ decision: "block", reason });
}
function renderDirective(state, sessionId) {
    const context = {
        workId: state.workId,
        revision: state.revision,
        planName: state.planName,
        planPath: state.planPath,
        workStatePath: state.workStatePath,
        remainingCount: state.checklist.remaining,
        totalCount: state.checklist.total,
        nextTaskLabel: state.checklist.nextTaskLabel,
        worktreePath: state.worktreePath,
        authority: state.authority,
        authorityGrants: state.authorityGrants,
        pendingBoundary: state.pendingBoundary,
        ledgerPath: state.ledgerPath,
        sessionId: `codex:${sessionId}`,
    };
    return START_WORK_CONTINUATION_DIRECTIVE.replace("{{START_WORK_CONTEXT_JSON}}", safeJson(context));
}
function safeJson(value) {
    return JSON.stringify(value).replace(/[<>&`\u2028\u2029]/g, (character) => {
        const code = character.codePointAt(0);
        return code === undefined ? "" : `\\u${code.toString(16).padStart(4, "0")}`;
    });
}
function inspectTranscript(transcriptPath) {
    if (transcriptPath === null || transcriptPath.length === 0)
        return "clear";
    if (O_NOFOLLOW === 0)
        return "invalid";
    let fd;
    try {
        fd = openSync(transcriptPath, constants.O_RDONLY | O_NOFOLLOW);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES)
            return "invalid";
        const buffer = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < buffer.byteLength) {
            const read = readSync(fd, buffer, offset, buffer.byteLength - offset, offset);
            if (read === 0)
                break;
            offset += read;
        }
        if (offset !== stat.size)
            return "invalid";
        for (const line of buffer.toString("utf8").split(/\r?\n/)) {
            if (line.length === 0)
                continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                return "invalid";
            }
            if (isTrustedHostContextError(parsed))
                return "pressure";
        }
        return "clear";
    }
    catch (error) {
        if (error instanceof Error)
            return "invalid";
        throw error;
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
function isTrustedHostContextError(value) {
    if (!isRecord(value))
        return false;
    if (value["type"] === "error") {
        const error = value["error"];
        return isRecord(error) && TRUSTED_CONTEXT_ERROR_CODES.has(String(error["code"]));
    }
    if (value["type"] !== "message")
        return false;
    const payload = value["payload"];
    if (!isRecord(payload))
        return false;
    const content = payload["content"];
    if (!isRecord(content))
        return false;
    const error = content["error"];
    return isRecord(error) && TRUSTED_CONTEXT_ERROR_CODES.has(String(error["code"]));
}
export function parseExplicitStartWorkPrompt(prompt) {
    if (/[^\S ]/u.test(prompt) || prompt.includes("  "))
        return null;
    const match = prompt.match(/^(?:start-work|\$start-work|lit start work|\$litcodex:start-work)(?: (.+))?$/u);
    if (match === null)
        return null;
    let rest = match[1] ?? "";
    let worktreePath = null;
    const worktreeMatches = [...rest.matchAll(/(?:^| )--worktree /g)];
    if (worktreeMatches.length > 1)
        return null;
    if (worktreeMatches.length === 1) {
        const marker = worktreeMatches[0];
        if (marker === undefined)
            return null;
        const index = marker.index;
        if (index === undefined)
            return null;
        const prefixLength = marker[0].length;
        worktreePath = rest.slice(index + prefixLength);
        if (worktreePath.length === 0 || !isAbsolute(worktreePath) || / --\S/.test(worktreePath)) {
            return null;
        }
        rest = rest.slice(0, index);
        if (rest.endsWith(" "))
            rest = rest.slice(0, -1);
    }
    const flags = rest.match(/^--resume ([^ ]+) --grant ([^ ]+)$/u) ?? rest.match(/^(.*?) --resume ([^ ]+) --grant ([^ ]+)$/u);
    const selector = flags?.[1] === undefined ? rest : flags.length === 3 ? "" : (flags[1] ?? "");
    const resumeBoundaryId = flags === null ? null : ((flags.length === 3 ? flags[1] : flags[2]) ?? null);
    const grantId = flags === null ? null : ((flags.length === 3 ? flags[2] : flags[3]) ?? null);
    if (selector.includes("--") || (resumeBoundaryId === null) !== (grantId === null))
        return null;
    return {
        selector: selector.length === 0 ? null : selector,
        resumeBoundaryId,
        grantId,
        worktreePath,
    };
}
function matchingResumeReplay(work, sessionId, transitionId) {
    if (work?.status !== "active" ||
        !work.session_ids.includes(`codex:${sessionId}`) ||
        work.last_transition?.transitionId !== transitionId ||
        work.last_transition.kind !== "start_work_resumed")
        return null;
    return work;
}
function selectorMatches(selector, work) {
    if (selector === null)
        return true;
    const file = basename(work.active_plan);
    const stem = file.endsWith(".md") ? file.slice(0, -3) : file;
    return selector === work.plan_name || selector === stem || selector === file || selector === work.active_plan;
}
function worktreeMatches(input, work) {
    if (input === null)
        return true;
    if (work.worktree_path === null)
        return false;
    try {
        return realpathSync(input) === work.worktree_path;
    }
    catch {
        return false;
    }
}
function isStopInput(value) {
    return (isRecord(value) &&
        isStopHookEventName(value["hook_event_name"]) &&
        boundedString(value["session_id"]) &&
        boundedString(value["turn_id"]) &&
        (value["transcript_path"] === null || boundedPathString(value["transcript_path"])) &&
        boundedString(value["cwd"]) &&
        boundedString(value["model"]) &&
        boundedString(value["permission_mode"]) &&
        typeof value["stop_hook_active"] === "boolean" &&
        optionalString(value["last_assistant_message"]));
}
function isUserPromptSubmitInput(value) {
    return (isRecord(value) &&
        value["hook_event_name"] === "UserPromptSubmit" &&
        boundedString(value["session_id"]) &&
        boundedString(value["turn_id"]) &&
        boundedString(value["cwd"]) &&
        boundedString(value["prompt"]) &&
        (value["transcript_path"] === undefined ||
            value["transcript_path"] === null ||
            boundedPathString(value["transcript_path"])));
}
function isStopHookEventName(value) {
    return value === "Stop";
}
function boundedString(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_INPUT_STRING;
}
function boundedPathString(value) {
    return typeof value === "string" && value.length <= MAX_INPUT_STRING;
}
function optionalString(value) {
    return value === undefined || (typeof value === "string" && value.length <= MAX_INPUT_STRING);
}
function digest(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
