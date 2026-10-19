// src/hud.ts — the LIT card for a second terminal window (`litcodex hud`).
//
// Every LIT session leaves a thread pointer in the Codex home (live-step.ts) naming its project folder, so
// the HUD can run from any directory. A pointer is written once per session, so the session to follow is
// the one with the newest LIT activity: the pointer time or the times its live step and workflow record
// carry, which the hooks rewrite on every prompt and tool. Files are re-parsed only after their `lstat`
// identity (inode, size, times) changes, so an idle HUD costs a few `lstat` calls a tick. The card itself is
// the one `cardStatusText` prints, read with `rollout: false` so no Codex rollout file is ever opened.
// Nothing here writes. A record that exists but cannot be read becomes one "cannot read" line instead
// of a quiet "ready". Record text is data: control characters and escapes are stripped before printing.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cardStatusText, readCardStatus } from "./card-status.js";
import { codexHomeFrom, liveStepPath, plainDirsOrMissing, readLiveStep, readSmallJson, readThreadPointer, threadPointerPath, } from "./live-step.js";
import { LIT_LOOP_DIR, LIT_LOOP_GOALS, normalizeSessionId } from "./state-paths.js";
import { workflowTurn } from "./workflow-map.js";
const POINTER_DIR = "litcodex/lit-loop/threads";
const MAX_LIVE_STEP_BYTES = 4_096;
/** The cap the workflow map itself reads its state files under. */
const MAX_STATE_BYTES = 1_000_000;
const SHORT_ID = 8;
/** Past this, the session is likely gone; the header says when it was last seen instead. */
const LAST_SEEN_MS = 10 * 60 * 1000;
/** Parsed files keyed by reader and path, kept while the file's `lstat` identity stays the same. */
const parsed = new Map();
/** `read()` for `path`, re-run only when the file's inode, size or times changed since `reader` last read it. */
function cachedRead(reader, path, read) {
    let key;
    try {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        key = stat === undefined ? "missing" : `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    }
    catch {
        return read();
    }
    const slot = `${reader}\0${path}`;
    const hit = parsed.get(slot);
    if (hit !== undefined && hit.key === key)
        return hit.value;
    const value = read();
    parsed.set(slot, { key, value });
    return value;
}
function mtimeOf(path) {
    try {
        return lstatSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    }
    catch {
        return 0;
    }
}
/** The newest time the session's live step or workflow record carries; null when neither has one. */
function activityAt(cwd, id) {
    const stepPath = liveStepPath(cwd, id);
    const step = stepPath === null ? null : cachedRead("live step", stepPath, () => readLiveStep(cwd, id));
    const turn = cachedRead("turn", join(cwd, ".litcodex/workflow-map", `${id}.json`), () => workflowTurn(cwd, id));
    const times = [step?.turnStartedAt, step?.turnEndedAt, step?.startedAt, step?.endedAt, turn?.startedAt];
    const known = times.filter((time) => typeof time === "number");
    return known.length === 0 ? null : Math.max(...known);
}
function scanPointers(env) {
    const home = codexHomeFrom(env);
    if (home === null)
        return { sessions: [], brokenAt: null };
    if (!plainDirsOrMissing(home, POINTER_DIR))
        return { sessions: [], brokenAt: Number.POSITIVE_INFINITY };
    let names;
    try {
        names = readdirSync(join(home, POINTER_DIR)).filter((name) => name.endsWith(".json"));
    }
    catch (error) {
        const missing = error.code === "ENOENT";
        return { sessions: [], brokenAt: missing ? null : Number.POSITIVE_INFINITY };
    }
    const sessions = [];
    let brokenAt = null;
    for (const name of names) {
        const id = name.slice(0, -".json".length);
        const path = threadPointerPath(env, id);
        if (path === null || normalizeSessionId(id) !== id)
            continue;
        const pointer = cachedRead("pointer", path, () => readThreadPointer(env, id));
        const pointerMtime = mtimeOf(path);
        if (pointer === null) {
            brokenAt = Math.max(brokenAt ?? 0, pointerMtime);
            continue;
        }
        const activity = activityAt(pointer.cwd, id);
        const activeAt = Math.max(pointer.updatedAt, activity ?? pointer.updatedAt);
        sessions.push({ id, cwd: pointer.cwd, updatedAt: pointer.updatedAt, activeAt, pointerMtime });
    }
    sessions.sort((a, b) => b.activeAt - a.activeAt || a.id.localeCompare(b.id));
    return { sessions, brokenAt };
}
/** Every session with a readable pointer, newest LIT activity first. */
export function listSessions(env) {
    return scanPointers(env).sessions.map(({ id, cwd, updatedAt, activeAt }) => ({ id, cwd, updatedAt, activeAt }));
}
function choose(sessions, wanted) {
    if (wanted === null || wanted === undefined || wanted === "") {
        const newest = sessions[0] ?? null;
        return { session: newest, matches: newest === null ? 0 : 1 };
    }
    const exact = sessions.find((session) => session.id === wanted);
    if (exact !== undefined)
        return { session: exact, matches: 1 };
    const found = sessions.filter((session) => session.id.startsWith(wanted));
    return { session: found.length === 1 ? (found[0] ?? null) : null, matches: found.length };
}
/** The most recently active session, or the one `wanted` names by exact id or unique prefix; else null. */
export function pickSession(env, wanted) {
    return choose(listSessions(env), wanted).session;
}
/** True when a record exists at `base/rel/name` but is not a small, regular, parseable file. */
function unreadableRecord(base, rel, name, maxBytes) {
    if (!plainDirsOrMissing(base, rel))
        return true;
    const path = join(base, rel, name);
    try {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat === undefined)
            return false;
        if (!stat.isFile() || stat.size > maxBytes)
            return true;
    }
    catch {
        return true;
    }
    return cachedRead(`unreadable ${maxBytes}`, path, () => readSmallJson(path, maxBytes) === null);
}
/** Every record the card reads, with the name the "cannot read" line gives it. */
function recordsOf(id) {
    return [
        ["live step", ".litcodex/live-step", `${id}.json`, MAX_LIVE_STEP_BYTES],
        ["workflow record", ".litcodex/workflow-map", `${id}.json`, MAX_STATE_BYTES],
        ["start-work state", ".litcodex/start-work", "state.json", MAX_STATE_BYTES],
        ["session goals", `${LIT_LOOP_DIR}/${id}`, LIT_LOOP_GOALS, MAX_STATE_BYTES],
        ["shared goals", LIT_LOOP_DIR, LIT_LOOP_GOALS, MAX_STATE_BYTES],
        ["lit-plan record", ".litcodex/lit-plan", `${id}.json`, MAX_STATE_BYTES],
    ];
}
function unreadableRecords(cwd, id) {
    if (!plainDirsOrMissing(cwd, ".litcodex"))
        return ["project records (.litcodex)"];
    return recordsOf(id)
        .filter(([, rel, name, maxBytes]) => unreadableRecord(cwd, rel, name, maxBytes))
        .map(([label]) => label);
}
function tilde(path, home) {
    if (home === undefined || home === "" || home === "/")
        return path;
    if (path === home)
        return "~";
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
/** Everything one frame needs, read once. Never throws and never writes. */
export function readHud(env, wanted, now) {
    try {
        const { sessions, brokenAt } = scanPointers(env);
        const { session, matches } = choose(sessions, wanted);
        if (session === null) {
            return {
                wanted,
                session: null,
                status: null,
                unreadable: brokenAt !== null ? ["session pointer"] : [],
                matches,
            };
        }
        const status = readCardStatus(session.id, env, now, { rollout: false });
        const lastSeen = Math.min(now, session.activeAt);
        // A broken pointer written after the chosen one may be the session the user is actually in.
        const pointer = brokenAt !== null && brokenAt > session.pointerMtime ? ["session pointer"] : [];
        const unreadable = [...pointer, ...unreadableRecords(session.cwd, session.id)];
        return {
            wanted,
            session: { id: session.id, folder: tilde(session.cwd, env["HOME"]), lastSeen },
            status,
            unreadable,
        };
    }
    catch {
        return { wanted, session: null, status: null, unreadable: ["LIT records"] };
    }
}
/** C0/C1 controls (ESC, CSI, BEL among them) plus zero-width and bidi format characters. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu;
export function clean(text) {
    return text.replace(CONTROL, "");
}
/** The card with every record-derived string stripped of control characters. */
export function cleanStatus(status) {
    return {
        ...status,
        mode: status.mode === null ? null : clean(status.mode),
        step: status.step === null ? null : { ...status.step, tool: clean(status.step.tool) },
        map: status.map === null ? null : { ...status.map, next: status.map.next === null ? null : clean(status.map.next) },
    };
}
const MARK = /^\p{M}$/u;
const WIDE_EMOJI = /^\p{Emoji_Presentation}$/u;
function charWidth(char) {
    const code = char.codePointAt(0) ?? 0;
    if (MARK.test(char) || (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f))
        return 0;
    if (WIDE_EMOJI.test(char))
        return 2;
    if ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x3fffd))
        return 2;
    return 1;
}
/** The string as terminal cells; a narrow character followed by U+FE0F (emoji presentation) takes two. */
function cells(text) {
    const out = [];
    for (const char of text) {
        const previous = out.at(-1);
        if (char === "\ufe0f" && previous !== undefined) {
            previous.text += char;
            previous.width = Math.max(previous.width, 2);
            continue;
        }
        out.push({ text: char, width: charWidth(char) });
    }
    return out;
}
/** Terminal cells a plain string takes: CJK and emoji take two, combining marks none. */
export function displayWidth(text) {
    return cells(text).reduce((sum, cell) => sum + cell.width, 0);
}
/** The line cut to `width` terminal cells, ending in `…` when anything was cut. */
export function fit(line, width) {
    if (displayWidth(line) <= width)
        return line;
    let out = "";
    let used = 0;
    for (const cell of cells(line)) {
        if (used + cell.width > width - 1)
            break;
        out += cell.text;
        used += cell.width;
    }
    return `${out}…`;
}
function age(lastSeen, now) {
    const seconds = Math.max(0, Math.floor((now - lastSeen) / 1000));
    if (now - lastSeen > LAST_SEEN_MS)
        return `last seen ${Math.floor(seconds / 60)} min ago`;
    return seconds < 60 ? `updated ${seconds}s ago` : `updated ${Math.floor(seconds / 60)} min ago`;
}
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";
/** One frame as text: a header, the card, and at most one "cannot read" line. Pure. */
export function renderHud(view, options) {
    const width = Math.max(10, Math.floor(options.width));
    const lines = [];
    if ((view.session === null || view.status === null) && view.wanted !== null && (view.matches ?? 0) > 1) {
        lines.push({ text: "🔥 LIT · which session?", style: BOLD });
        lines.push({
            text: `--session ${clean(view.wanted)} matches ${view.matches} sessions; give more of the id`,
            style: DIM,
        });
    }
    else if (view.session === null || view.status === null) {
        lines.push({ text: "🔥 LIT · waiting for a LIT session", style: BOLD });
        lines.push({
            text: view.wanted === null
                ? "Start `codex` in a project and type `lit <task>`."
                : `waiting for session ${clean(view.wanted)}`,
            style: DIM,
        });
    }
    else {
        const { id, folder, lastSeen } = view.session;
        lines.push({ text: `${id.slice(0, SHORT_ID)} · ${clean(folder)} · ${age(lastSeen, options.now)}`, style: DIM });
        cardStatusText(cleanStatus(view.status))
            .split("\n")
            .forEach((text, index) => {
            lines.push({ text, style: index === 0 ? BOLD : "" });
        });
    }
    if (view.unreadable.length > 0)
        lines.push({ text: `cannot read ${view.unreadable.join(", ")}`, style: DIM });
    return lines
        .map(({ text, style }) => {
        const line = fit(clean(text), width);
        return options.color && style !== "" ? `${style}${line}${RESET}` : line;
    })
        .join("\n");
}
