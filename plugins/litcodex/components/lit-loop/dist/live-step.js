// src/live-step.ts — the live step and the per-thread pointer the LIT card reads.
//
// Two small owned records. The live step lives in the workspace (`.litcodex/live-step/<session>.json`)
// and names the tool that is running now; the catch-all PreToolUse hook writes it and PostToolUse
// clears it. It also says whether the turn is still open: a LIT prompt opens it and Stop closes it, so
// the card can tell a model that is thinking between tools from one that has answered and waits. The pointer lives in the Codex home the hook sees (`litcodex/lit-loop/threads/<session>.json`)
// and maps a session id, which the desktop app also sends as its thread id, to the hook's `cwd`, because
// the card server is started in the plugin folder and learns nothing else about the thread. The pointer
// also keeps when the newest card of the thread opened, so an older card can fold itself away. Every write
// is atomic, skips symlinked folders and never throws; every read is size-capped and refuses symlinks.
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { normalizeSessionId } from "./state-paths.js";
const LIVE_STEP_DIR = ".litcodex/live-step";
const POINTER_DIR = "litcodex/lit-loop/threads";
const MAX_RECORD_BYTES = 4_096;
const MAX_TOOL_LABEL = 64;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = constants.O_NONBLOCK ?? 0;
/**
 * Open a regular file for reading, or return null. The type is checked before the open, so a symlink,
 * a named pipe or a device is never opened (opening a pipe would wait for a writer and freeze a hook);
 * the open itself refuses a symlink swapped in since, and callers check the type again with `fstat`.
 */
export function openRegularFile(path) {
    try {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat === undefined || !stat.isFile())
            return null;
        return openSync(path, constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
    }
    catch {
        return null;
    }
}
/** Parse a small regular file opened without following a symlink; null on any failure. */
export function readSmallJson(path, maxBytes = MAX_RECORD_BYTES) {
    let fd = null;
    try {
        fd = openRegularFile(path);
        if (fd === null)
            return null;
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > maxBytes)
            return null;
        const buffer = Buffer.alloc(stat.size);
        const read = readSync(fd, buffer, 0, stat.size, 0);
        return JSON.parse(buffer.subarray(0, read).toString("utf8"));
    }
    catch {
        return null;
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}
/** True when `path` is missing or a real directory; a symlink or a file in its place is refused. */
function plainDirOrMissing(path) {
    try {
        return lstatSync(path).isDirectory();
    }
    catch (error) {
        return error.code === "ENOENT";
    }
}
/** True when every folder of `rel` under `base` is missing or a real directory (no symlink on the way). */
export function plainDirsOrMissing(base, rel) {
    let dir = base;
    for (const part of rel.split("/")) {
        dir = join(dir, part);
        if (!plainDirOrMissing(dir))
            return false;
    }
    return true;
}
/** Write `value` as JSON through a temp file and a rename, inside `dir` under `base`. Never throws. */
function writeRecord(base, rel, name, value) {
    try {
        if (!plainDirsOrMissing(base, rel))
            return;
        const dir = join(base, rel);
        mkdirSync(dir, { recursive: true });
        writeFileAtomic(join(dir, name), `${JSON.stringify(value)}\n`);
    }
    catch {
        // The card shows the last good record; a hook never fails because of it.
    }
}
/**
 * Write `text` to `path` through a new temp file beside it and a rename. The temp name is random and
 * opened exclusively, so a file or symlink planted at a guessable name is never written through.
 */
export function writeFileAtomic(path, text) {
    const tmp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    try {
        writeFileSync(tmp, text, { flag: "wx" });
        renameSync(tmp, path);
    }
    catch (error) {
        if (error.code !== "EEXIST")
            rmSync(tmp, { force: true });
        throw error;
    }
}
/** A printable tool label of at most 64 characters. */
function toolLabel(tool) {
    const clean = tool.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim();
    return clean.length > MAX_TOOL_LABEL ? `${clean.slice(0, MAX_TOOL_LABEL - 1)}…` : clean;
}
export function liveStepPath(repoRoot, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (id === null || typeof repoRoot !== "string" || !isAbsolute(repoRoot))
        return null;
    return join(repoRoot, LIVE_STEP_DIR, `${id}.json`);
}
/** True when every folder of `rel` under `base` is a real directory (no symlink on the way). */
export function plainDirs(base, rel) {
    let dir = base;
    for (const part of rel.split("/")) {
        dir = join(dir, part);
        try {
            if (!lstatSync(dir).isDirectory())
                return false;
        }
        catch {
            return false;
        }
    }
    return true;
}
export function readLiveStep(repoRoot, sessionId) {
    const path = liveStepPath(repoRoot, sessionId);
    if (path === null || !plainDirs(repoRoot, LIVE_STEP_DIR))
        return null;
    const record = readSmallJson(path);
    if (!isRecord(record) || record["version"] !== 1)
        return null;
    const text = (value) => (typeof value === "string" && value !== "" ? value : null);
    const time = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const waitReason = text(record["waitReason"]);
    return {
        tool: text(record["tool"]),
        toolUseId: text(record["toolUseId"]),
        startedAt: time(record["startedAt"]),
        endedAt: time(record["endedAt"]),
        turnStartedAt: time(record["turnStartedAt"]),
        turnEndedAt: time(record["turnEndedAt"]),
        lastTool: text(record["lastTool"]),
        ...(waitReason !== null ? { waitReason } : {}),
    };
}
function writeLiveStep(repoRoot, path, step) {
    writeRecord(repoRoot, LIVE_STEP_DIR, basename(path), { version: 1, ...step });
}
/** A tool step older than this never ended cleanly, so it no longer counts as running. */
const STALE_STEP_MS = 30 * 60 * 1000;
/**
 * Open a turn: a LIT prompt arrived, so the model is working until Stop says otherwise. A tool that is
 * still running (a message typed while it runs) keeps its step.
 */
export function recordTurnStart(repoRoot, sessionId, now = Date.now()) {
    const path = liveStepPath(repoRoot, sessionId);
    if (path === null)
        return;
    const current = readLiveStep(repoRoot, sessionId);
    const running = current !== null && current.tool !== null && current.startedAt !== null && now - current.startedAt < STALE_STEP_MS
        ? current
        : null;
    writeLiveStep(repoRoot, path, {
        tool: running?.tool ?? null,
        toolUseId: running?.toolUseId ?? null,
        startedAt: running?.startedAt ?? null,
        endedAt: null,
        turnStartedAt: now,
        turnEndedAt: null,
        lastTool: null,
    });
}
export function recordLiveStepStart(repoRoot, sessionId, ref, now = Date.now()) {
    const path = liveStepPath(repoRoot, sessionId);
    const tool = toolLabel(ref.tool);
    if (path === null || tool === "")
        return;
    const current = readLiveStep(repoRoot, sessionId);
    writeLiveStep(repoRoot, path, {
        tool,
        toolUseId: ref.toolUseId,
        startedAt: now,
        endedAt: null,
        turnStartedAt: current?.turnStartedAt ?? null,
        turnEndedAt: null,
        lastTool: current?.lastTool ?? null,
    });
}
/** Clear the step when this call is the one shown; a newer parallel call keeps its record. */
export function recordLiveStepEnd(repoRoot, sessionId, ref, now = Date.now()) {
    const path = liveStepPath(repoRoot, sessionId);
    if (path === null)
        return;
    const current = readLiveStep(repoRoot, sessionId);
    if (current === null)
        return;
    if (current.tool !== null) {
        const same = current.toolUseId !== null && ref.toolUseId !== null
            ? current.toolUseId === ref.toolUseId
            : current.tool === toolLabel(ref.tool);
        if (!same)
            return;
    }
    writeLiveStep(repoRoot, path, {
        tool: null,
        toolUseId: null,
        startedAt: null,
        endedAt: now,
        turnStartedAt: current.turnStartedAt,
        turnEndedAt: current.turnEndedAt,
        lastTool: toolLabel(ref.tool) || current.lastTool,
    });
}
/**
 * End whatever step this session still shows, since no tool runs once Stop fires, and close the turn
 * unless a Stop guard is sending the model back to work (`closeTurn` false).
 */
export function endLiveStep(repoRoot, sessionId, now = Date.now(), closeTurn = true, waitReason) {
    const path = liveStepPath(repoRoot, sessionId);
    const current = path === null ? null : readLiveStep(repoRoot, sessionId);
    if (path === null || current === null)
        return;
    if (current.tool === null && (!closeTurn || current.turnEndedAt !== null))
        return;
    writeLiveStep(repoRoot, path, {
        tool: null,
        toolUseId: null,
        startedAt: null,
        endedAt: current.tool === null ? current.endedAt : now,
        turnStartedAt: current.turnStartedAt,
        turnEndedAt: closeTurn ? now : current.turnEndedAt,
        lastTool: current.tool ?? current.lastTool,
        ...(closeTurn && waitReason != null ? { waitReason } : {}),
    });
}
/** The last words ask the person something: a closing question, or a request to approve, confirm or deny. */
const ASKS = /[?？]\s*$|`?lit approve`?|`?lit deny`?|승인해\s*주|확인해\s*주|괜찮을까요|할까요/iu;
const BLOCKED_RE = /^BLOCKED:/mu;
/** Detect why the session waits on the user from the last assistant message, or null. */
export function detectWaitReason(lastMessage) {
    if (lastMessage === null || lastMessage === "")
        return null;
    if (BLOCKED_RE.test(lastMessage))
        return "blocked";
    if (ASKS.test(lastMessage))
        return "question";
    return null;
}
/** `$CODEX_HOME`, else `$HOME/.codex`, read from the given environment only; null when neither is set. */
export function codexHomeFrom(env) {
    const fromEnv = env["CODEX_HOME"]?.trim() ?? "";
    if (fromEnv !== "" && isAbsolute(fromEnv))
        return fromEnv;
    const home = env["HOME"]?.trim() ?? "";
    return home !== "" && isAbsolute(home) ? join(home, ".codex") : null;
}
export function threadPointerPath(env, threadId) {
    const id = normalizeSessionId(threadId);
    const home = codexHomeFrom(env);
    if (id === null || home === null)
        return null;
    return join(home, POINTER_DIR, `${id}.json`);
}
export function readThreadPointer(env, threadId) {
    const path = threadPointerPath(env, threadId);
    const home = codexHomeFrom(env);
    if (path === null || home === null || !plainDirs(home, POINTER_DIR))
        return null;
    const record = readSmallJson(path);
    if (!isRecord(record) || record["version"] !== 1)
        return null;
    const { cwd, updatedAt, cardOfferedAt, cardOpenedAt } = record;
    if (typeof cwd !== "string" || !isAbsolute(cwd) || typeof updatedAt !== "number")
        return null;
    const time = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { cwd, updatedAt, cardOfferedAt: time(cardOfferedAt), cardOpenedAt: time(cardOpenedAt) };
}
/** Point the thread at `cwd`, keeping the card times it already holds; skips the write when nothing changes. */
export function writeThreadPointer(env, threadId, cwd, now = Date.now(), options = {}) {
    const path = threadPointerPath(env, threadId);
    const home = codexHomeFrom(env);
    if (path === null || home === null || typeof cwd !== "string" || !isAbsolute(cwd))
        return;
    const current = readThreadPointer(env, threadId);
    const cardOfferedAt = options.cardOffered === true ? now : (current?.cardOfferedAt ?? null);
    const cardOpenedAt = options.cardOpened === true ? now : (current?.cardOpenedAt ?? null);
    if (current !== null &&
        current.cwd === cwd &&
        current.cardOfferedAt === cardOfferedAt &&
        current.cardOpenedAt === cardOpenedAt)
        return;
    writeRecord(home, POINTER_DIR, basename(path), {
        version: 1,
        cwd,
        updatedAt: now,
        cardOfferedAt,
        cardOpenedAt,
    });
}
/**
 * Remember that a card opened in this thread now, so every poll can tell the older cards to fold. Only a
 * thread the hooks already pointed at a workspace is recorded; returns the time recorded, or null.
 */
export function recordCardOpened(env, threadId, now = Date.now()) {
    const current = readThreadPointer(env, threadId);
    if (current === null)
        return null;
    writeThreadPointer(env, threadId, current.cwd, now, { cardOpened: true });
    return readThreadPointer(env, threadId)?.cardOpenedAt === now ? now : null;
}
