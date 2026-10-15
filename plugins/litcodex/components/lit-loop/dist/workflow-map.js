// src/workflow-map.ts — the plain-text LIT workflow map.
//
// Codex shows a hook `systemMessage` as plain text (escape codes appear literally), so the map uses
// emoji and block cells instead of colour. It is built from saved state only: the start-work record
// and its plan checkboxes, lit-loop goals, the lit-plan activation record and the litresearch
// journal. A stage with no saved signal is left out rather than guessed. Every read fails open.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { plainDirs, plainDirsOrMissing, writeFileAtomic } from "./live-step.js";
import { LIT_LOOP_DIR, LIT_LOOP_GOALS, normalizeSessionId } from "./state-paths.js";
const STAGES = [
    ["interview", "🧭", "INTERVIEW"],
    ["plan", "📝", "PLAN"],
    ["work", "🔨", "WORK"],
    ["review", "🔍", "REVIEW"],
    ["done", "🏁", "DONE"],
];
/** Where each LIT skill sits in the main chain; `research` is its own short family. */
const MODE_STAGE = {
    "deep-interview": "interview",
    "lit-crucible": "interview",
    "lit-plan": "plan",
    litgoal: "plan",
    "start-work": "work",
    litwork: "work",
    "lit-loop": "work",
    "review-work": "review",
    litresearch: "research",
};
const MAX_STATE_BYTES = 1_000_000;
const MAX_TITLE = 48;
const BAR_CELLS = 10;
const TURN_DIR = ".litcodex/workflow-map";
const RESEARCH_DIR = `${LIT_LOOP_DIR}/litresearch`;
/** An unfinished journal older than this belongs to research the user has moved on from. */
const RESEARCH_STALE_MS = 24 * 60 * 60 * 1000;
/** The start-work continuation hook stops reading a transcript past this size and stays quiet. */
const MAX_TRANSCRIPT_BYTES = 2_000_000;
const CONTEXT_ERROR_CODES = new Set(["context_length_exceeded", "context_too_large"]);
const MIN_TITLE_WORDS = 3;
const NO_SIGNALS = { work: null, goals: null, plan: null, research: null };
const NO_STOP_CONTEXT = { stopHookActive: false, transcriptPath: null };
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * True when `path` sits inside `repoRoot` with no symlinked folder between them, so a state read never
 * leaves the workspace through a linked `.litcodex/plans` or similar.
 */
function ownedPath(repoRoot, path) {
    const rel = relative(repoRoot, dirname(path));
    if (rel === "")
        return true;
    if (rel.startsWith("..") || isAbsolute(rel))
        return false;
    return plainDirs(repoRoot, rel.split(sep).join("/"));
}
/** Parse a small regular file (never a symlink, never behind a symlinked folder); null on any failure. */
function readJson(repoRoot, path) {
    const text = readText(repoRoot, path);
    if (text === null)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function readText(repoRoot, path) {
    try {
        if (!ownedPath(repoRoot, path))
            return null;
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > MAX_STATE_BYTES)
            return null;
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
/**
 * Checkbox rows the way start-work counts them: fenced blocks are skipped, and when the plan has a
 * `## Todos` or `## Final verification wave` section only rows inside those sections count.
 */
export function countPlanRows(markdown) {
    const rows = planRows(markdown);
    return {
        done: rows.filter((row) => row.done).length,
        total: rows.length,
        next: rows.find((row) => !row.done)?.label ?? null,
    };
}
/** The counted checkbox rows in order, as start-work reads them. */
function planRows(markdown) {
    const lines = markdown.split(/\r?\n/);
    const visible = [];
    let fence = null;
    for (const line of lines) {
        if (fence !== null) {
            const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
            if (closing?.[1]?.[0] === fence.marker && closing[1].length >= fence.length)
                fence = null;
            continue;
        }
        const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (opening?.[1] !== undefined) {
            fence = { marker: opening[1][0] ?? "`", length: opening[1].length };
            continue;
        }
        visible.push(line);
    }
    const section = (line) => {
        if (!line.startsWith("## ") || line.startsWith("### "))
            return null;
        const heading = line.slice(3).replace(/\s+/g, " ").trim().toLowerCase();
        return (heading === "todos" || heading === "final verification wave" || heading.startsWith("final verification wave "));
    };
    const sectioned = visible.some((line) => section(line) === true);
    let inside = !sectioned;
    const rows = [];
    for (const line of visible) {
        const heading = section(line);
        if (heading !== null)
            inside = heading;
        if (!inside)
            continue;
        const match = line.match(/^- \[([ xX])\] (.*)$/s);
        const label = (match?.[2] ?? "").replace(/\s+/g, " ").trim();
        if (match === null || label.length === 0)
            continue;
        rows.push({ done: match[1] !== " ", label });
    }
    return rows;
}
/** One cell per task, at most ten; a partly done plan never draws as full or empty. */
export function progressBar(done, total) {
    const cells = Math.min(total, BAR_CELLS);
    let filled = total === 0 ? 0 : Math.round((done / total) * cells);
    if (done > 0 && filled === 0)
        filled = 1;
    if (done < total && filled === cells)
        filled = cells - 1;
    return "▰".repeat(filled) + "▱".repeat(cells - filled);
}
/** A path, code span, variable or flag: the first one ends a title, since nothing after it is shown. */
function isTechnical(word) {
    return /[/\\`]/u.test(word) || /^--?[\p{L}\d]/u.test(word) || /^\$[\p{L}_{(]/u.test(word) || word.startsWith("~");
}
/**
 * A task title without its row number, cut at the first code span, path, variable or flag and marked
 * with `…`. Deleting those words mid-sentence reads oddly, so the title stops there instead; a title
 * with fewer than three words left before the cut is dropped.
 */
export function safeTitle(label) {
    const words = label
        .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
        .replace(/^(?:F?\d+\.\s+)/iu, "")
        .split(/\s+/u)
        .filter((word) => word.length > 0);
    const cut = words.findIndex(isTechnical);
    if (cut === 0)
        return null;
    if (cut > 0 && cut < MIN_TITLE_WORDS)
        return null;
    const title = (cut < 0 ? words : words.slice(0, cut)).join(" ").replace(/[\s,:;(—–-]+$/u, "");
    if (title.length === 0)
        return null;
    if (title.length > MAX_TITLE)
        return `${title.slice(0, MAX_TITLE - 1)}…`;
    return cut < 0 ? title : `${title} …`;
}
function readWork(repoRoot, sessionId) {
    const state = readJson(repoRoot, join(repoRoot, ".litcodex/start-work/state.json"));
    if (!isRecord(state) || !isRecord(state["works"]))
        return null;
    const works = Object.values(state["works"]).filter(isRecord);
    const activeId = state["active_work_id"];
    let work = works.find((entry) => entry["work_id"] === activeId && (entry["status"] === "active" || entry["status"] === "paused"));
    if (work === undefined && sessionId !== null) {
        // A finished plan belongs to the session that ran it, so an old one never shows in a new session.
        const mine = works.filter((entry) => entry["status"] === "completed" &&
            Array.isArray(entry["session_ids"]) &&
            entry["session_ids"].includes(`codex:${sessionId}`));
        const at = (entry) => {
            const last = entry["last_transition"];
            return isRecord(last) && typeof last["at"] === "string" ? last["at"] : "";
        };
        work = mine.sort((a, b) => at(b).localeCompare(at(a)))[0];
    }
    if (work === undefined || typeof work["active_plan"] !== "string")
        return null;
    const file = basename(work["active_plan"]);
    if (!file.endsWith(".md"))
        return null;
    const text = readText(repoRoot, join(repoRoot, ".litcodex/plans", file));
    if (text === null)
        return null;
    const rows = countPlanRows(text);
    if (rows.total === 0)
        return null;
    return { ...rows, status: work["status"] };
}
function goalProgress(repoRoot, path) {
    const plan = readJson(repoRoot, path);
    if (!isRecord(plan) || !Array.isArray(plan["goals"]))
        return null;
    const goals = plan["goals"].filter(isRecord);
    if (goals.length === 0)
        return null;
    const open = goals.find((goal) => goal["status"] === "in_progress") ?? goals.find((goal) => goal["status"] === "pending");
    return {
        done: goals.filter((goal) => goal["status"] === "complete").length,
        total: goals.length,
        next: typeof open?.["title"] === "string" ? open["title"] : null,
    };
}
function readGoals(repoRoot, sessionId) {
    if (sessionId !== null) {
        const scoped = goalProgress(repoRoot, join(repoRoot, LIT_LOOP_DIR, sessionId, LIT_LOOP_GOALS));
        if (scoped !== null)
            return scoped;
    }
    const shared = goalProgress(repoRoot, join(repoRoot, LIT_LOOP_DIR, LIT_LOOP_GOALS));
    return shared !== null && shared.done < shared.total ? shared : null;
}
function readPlanRecord(repoRoot, sessionId) {
    if (sessionId === null)
        return null;
    const record = readJson(repoRoot, join(repoRoot, ".litcodex/lit-plan", `${sessionId}.json`));
    if (!isRecord(record) || typeof record["satisfied"] !== "boolean")
        return null;
    return record["satisfied"] ? "published" : "drafting";
}
/** The newest research journal by its last write, with the names of the files in it. */
function newestJournal(repoRoot) {
    const root = join(repoRoot, RESEARCH_DIR);
    if (!plainDirs(repoRoot, RESEARCH_DIR))
        return null;
    try {
        let newest = null;
        for (const name of readdirSync(root)) {
            if (name.startsWith("."))
                continue;
            const dir = join(root, name);
            if (!lstatSync(dir).isDirectory())
                continue;
            const files = readdirSync(dir);
            const mtime = Math.max(statSync(dir).mtimeMs, ...files.map((file) => lstatSync(join(dir, file)).mtimeMs));
            if (newest === null || mtime > newest.mtime)
                newest = { files, mtime };
        }
        return newest;
    }
    catch {
        return null;
    }
}
function highestWave(files) {
    const waves = files.map((name) => name.match(/^wave-(\d+)-/)?.[1]).filter((wave) => wave !== undefined);
    return waves.length === 0 ? null : Math.max(...waves.map(Number));
}
/**
 * Progress of research still under way: the newest journal, unless it already holds `SYNTHESIS.md` or
 * nothing was written to it for a day, in which case a new research starts at decomposition.
 */
function readResearch(repoRoot, now) {
    const journal = newestJournal(repoRoot);
    if (journal === null || now - journal.mtime > RESEARCH_STALE_MS || journal.files.includes("SYNTHESIS.md")) {
        return null;
    }
    return {
        wave: highestWave(journal.files),
        verifying: journal.files.some((name) => /^verify-.+\.md$/u.test(name)),
    };
}
export function readWorkflowSignals(repoRoot, sessionId, now = Date.now()) {
    if (typeof repoRoot !== "string" || !isAbsolute(repoRoot))
        return NO_SIGNALS;
    const id = normalizeSessionId(sessionId);
    return {
        work: readWork(repoRoot, id),
        goals: readGoals(repoRoot, id),
        plan: readPlanRecord(repoRoot, id),
        research: readResearch(repoRoot, now),
    };
}
function stageFromState(signals) {
    if (signals.work?.status === "completed")
        return { index: 4, active: true };
    if (signals.work !== null || signals.goals !== null)
        return { index: 2, active: true };
    if (signals.plan === "drafting")
        return { index: 1, active: true };
    if (signals.plan === "published")
        return { index: 2, active: false };
    return null;
}
function cell(key, icon, state, label = null, progress = null, word = key) {
    return { key, icon, word, state, label, progress };
}
/** The research family: decompose › waves (the first, then expansion) › verify › synthesis. */
function researchCells(research) {
    const pending = (key, icon) => cell(key, icon, "pending");
    if (research === null || (research.wave === null && !research.verifying)) {
        return [
            cell("decompose", "🔎", "current", "DECOMPOSE"),
            pending("wave", "🌊"),
            pending("verify", "🔬"),
            pending("synthesis", "🏁"),
        ];
    }
    const { wave } = research;
    if (!research.verifying) {
        const label = `WAVE ${wave}${wave !== null && wave > 1 ? " EXPAND" : ""}`;
        return [
            cell("decompose", "🔎", "done"),
            cell("wave", "🌊", "current", label),
            pending("verify", "🔬"),
            pending("synthesis", "🏁"),
        ];
    }
    const waves = wave === null ? [] : [cell("wave", "🌊", "done", `${wave} wave${wave === 1 ? "" : "s"}`)];
    return [
        cell("decompose", "🔎", "done"),
        ...waves,
        cell("verify", "🔬", "current", "VERIFY"),
        pending("synthesis", "🏁"),
    ];
}
/** The map as stages, or null when there is nothing true to draw. */
export function workflowMapCells(mode, signals) {
    const fromMode = mode === null ? undefined : MODE_STAGE[mode];
    const { work } = signals;
    const progress = work ?? signals.goals;
    const next = progress === null || progress.next === null ? null : safeTitle(progress.next);
    if (fromMode === "research")
        return { family: "research", cells: researchCells(signals.research), next: null };
    const position = fromMode === undefined
        ? stageFromState(signals)
        : { index: STAGES.findIndex(([stage]) => stage === fromMode), active: true };
    if (position === null)
        return null;
    const planKnown = work !== null || signals.plan === "published";
    const workFinished = work !== null && (work.status === "completed" || work.done === work.total);
    const cells = [];
    STAGES.forEach(([stage, icon, label], index) => {
        if (index > position.index || (index === position.index && !position.active)) {
            cells.push(cell(stage, icon, "pending"));
            return;
        }
        if (index === position.index) {
            const name = stage === "work" && work?.status === "paused" ? "PAUSED" : label;
            const bar = stage === "work" && progress !== null ? { done: progress.done, total: progress.total } : null;
            cells.push(cell(stage, icon, "current", name, bar));
            return;
        }
        if (stage === "interview" || stage === "plan") {
            if (planKnown)
                cells.push(cell(stage, icon, "done"));
        }
        else if (stage === "work") {
            const bar = work === null ? null : { done: work.done, total: work.total };
            if (workFinished)
                cells.push(cell(stage, icon, "done", null, bar));
            else if (work !== null)
                cells.push(cell(stage, icon, "partial", null, bar));
        }
        else if (stage === "review" && work?.status === "completed") {
            cells.push(cell(stage, icon, "done"));
        }
    });
    return { family: "main", cells, next };
}
function cellText(item) {
    const bar = item.progress === null
        ? ""
        : `${progressBar(item.progress.done, item.progress.total)} ${item.progress.done}/${item.progress.total}`;
    switch (item.state) {
        case "pending":
            return `${item.icon} ·`;
        case "done":
            return item.label === null ? `${item.icon} ✓` : `${item.icon} ✓ ${item.label}`;
        case "partial":
            return `${item.icon} ${bar}`;
        case "current":
            return `${item.icon} ${item.label ?? item.word.toUpperCase()}${bar === "" ? "" : ` ${bar}`}`;
    }
}
/** One map line, or null when there is nothing true to draw. Plain text: emoji and block cells only. */
export function renderWorkflowMap(mode, signals) {
    const map = workflowMapCells(mode, signals);
    return map === null ? null : workflowMapText(map);
}
/** The text line for a map already built. */
export function workflowMapText(map) {
    return map.cells.map(cellText).join(" › ");
}
export function workflowMapLine(repoRoot, sessionId, mode) {
    return renderWorkflowMap(mode, readWorkflowSignals(repoRoot, sessionId));
}
function turnPath(repoRoot, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (id === null || typeof repoRoot !== "string" || !isAbsolute(repoRoot))
        return null;
    return join(repoRoot, TURN_DIR, `${id}.json`);
}
/** Remember that this turn is a LIT activation and where its progress started. Never throws. */
export function recordWorkflowTurn(repoRoot, sessionId, turnId, mode, now = Date.now()) {
    const path = turnPath(repoRoot, sessionId);
    if (path === null || turnId.length === 0)
        return;
    const signals = readWorkflowSignals(repoRoot, sessionId);
    const record = {
        version: 1,
        turnId,
        mode,
        startedAt: now,
        workDone: signals.work?.done ?? null,
        goalsDone: signals.goals?.done ?? null,
    };
    try {
        if (!plainDirsOrMissing(repoRoot, TURN_DIR))
            return;
        mkdirSync(join(repoRoot, TURN_DIR), { recursive: true });
        writeFileAtomic(path, `${JSON.stringify(record)}\n`);
    }
    catch {
        // Without the record the Stop hook simply stays quiet for this turn.
    }
}
function readTurn(repoRoot, path) {
    const record = readJson(repoRoot, path);
    if (!isRecord(record) ||
        record["version"] !== 1 ||
        typeof record["turnId"] !== "string" ||
        typeof record["mode"] !== "string" ||
        typeof record["startedAt"] !== "number")
        return null;
    const count = (value) => (typeof value === "number" ? value : null);
    return {
        version: 1,
        turnId: record["turnId"],
        mode: record["mode"],
        startedAt: record["startedAt"],
        workDone: count(record["workDone"]),
        goalsDone: count(record["goalsDone"]),
    };
}
/** The LIT activation this session last recorded: its skill and when it started; null when none. */
export function workflowTurn(repoRoot, sessionId) {
    const path = turnPath(repoRoot, sessionId);
    const turn = path === null ? null : readTurn(repoRoot, path);
    return turn === null ? null : { mode: turn.mode, startedAt: turn.startedAt };
}
/** Highest wave number in the newest research journal written since `since`, or null. */
function researchWave(repoRoot, since) {
    const journal = newestJournal(repoRoot);
    return journal === null || journal.mtime < since ? null : highestWave(journal.files);
}
function isContextError(value) {
    if (!isRecord(value))
        return false;
    const error = value["type"] === "error"
        ? value["error"]
        : value["type"] === "message" && isRecord(value["payload"]) && isRecord(value["payload"]["content"])
            ? value["payload"]["content"]["error"]
            : null;
    return isRecord(error) && CONTEXT_ERROR_CODES.has(String(error["code"]));
}
/** The transcript check the continuation hook makes: a missing path is clear; oversized, unparsable or full context is not. */
function transcriptClear(path) {
    if (path === null || path.length === 0)
        return true;
    try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES)
            return false;
        for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
            if (line.length > 0 && isContextError(JSON.parse(line)))
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
/**
 * The plan start-work will carry on with after this Stop, or null when its continuation hook stays
 * quiet. It repeats that hook's decision read-only (host continuation flag, transcript, the one active
 * work this session owns with authority and open rows, and the lease that nudges each plan state once
 * per turn), so the answer is the same whichever Stop hook the host runs first.
 */
function continuingWork(repoRoot, sessionId, turnId, stop) {
    if (stop.stopHookActive || !transcriptClear(stop.transcriptPath))
        return null;
    const state = readJson(repoRoot, join(repoRoot, ".litcodex/start-work/state.json"));
    if (!isRecord(state) || !isRecord(state["works"]) || typeof state["active_work_id"] !== "string")
        return null;
    const owner = `codex:${sessionId}`;
    const owned = Object.entries(state["works"]).filter(([id, work]) => isRecord(work) &&
        work["work_id"] === id &&
        work["status"] === "active" &&
        Array.isArray(work["session_ids"]) &&
        work["session_ids"].includes(owner));
    const [entry] = owned;
    if (owned.length !== 1 || entry === undefined || entry[0] !== state["active_work_id"])
        return null;
    const work = entry[1];
    const plan = work["active_plan"];
    if (!isRecord(work["authority"]) || typeof plan !== "string" || !/^\.litcodex\/plans\/[^/\\]+\.md$/u.test(plan)) {
        return null;
    }
    const text = readText(repoRoot, join(repoRoot, plan));
    if (text === null)
        return null;
    const rows = planRows(text);
    const done = rows.filter((row) => row.done).length;
    if (rows.length === 0 || done === rows.length)
        return null;
    const token = createHash("sha256")
        .update(JSON.stringify(rows.map((row) => [row.done ? 1 : 0, row.label])))
        .digest("hex");
    const lease = work["continuation_lease"];
    if (isRecord(lease) && lease["progress_token"] === token && lease["turn_id"] !== turnId)
        return null;
    return { done, total: rows.length, next: rows.find((row) => !row.done)?.label ?? null };
}
function counted(n, unit) {
    return `${n} ${unit}${n === 1 ? "" : "s"} ✓`;
}
/**
 * The Stop line for a LIT turn, or null when this turn was not a LIT activation. At a start-work
 * checkpoint the continuation hook keeps the turn going, so the line says so instead of "turn done".
 * No commands or paths.
 */
export function workflowStopLine(repoRoot, sessionId, turnId, stop = NO_STOP_CONTEXT) {
    const path = turnPath(repoRoot, sessionId);
    if (path === null)
        return null;
    const turn = readTurn(repoRoot, path);
    if (turn === null || turn.turnId !== turnId)
        return null;
    const continuing = continuingWork(repoRoot, sessionId, turnId, stop);
    if (continuing !== null) {
        const next = continuing.next === null ? null : safeTitle(continuing.next);
        const status = `⏳ ${continuing.done}/${continuing.total} tasks ✓ · continuing`;
        return next === null ? status : `${status} ▸ ${next}`;
    }
    const signals = readWorkflowSignals(repoRoot, sessionId);
    const parts = ["✨ turn done"];
    const progress = signals.work ?? signals.goals;
    if (progress !== null) {
        const unit = signals.work !== null ? "task" : "goal";
        const before = signals.work !== null ? turn.workDone : turn.goalsDone;
        if (before !== null && progress.done > before)
            parts.push(counted(progress.done - before, unit));
        if (progress.done >= progress.total)
            parts.push(`all ${progress.total} ${unit}s ✓`);
        else {
            const next = progress.next === null ? null : safeTitle(progress.next);
            if (next !== null)
                parts.push(`next ▸ ${next}`);
        }
    }
    if (turn.mode === "litresearch") {
        const wave = researchWave(repoRoot, turn.startedAt);
        if (wave !== null)
            parts.push(`🌊 wave ${wave}`);
    }
    return parts.join(" · ");
}
