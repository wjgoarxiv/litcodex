// src/rewind.ts — the lit-adhd collector: where the work stands across sessions and worktrees.
//
// Reads Codex session records (rewind-rollout.ts), `git worktree list`, and each worktree's own saved
// state (workflow stacks, the start-work record, plan checkboxes, lit-loop goals, a HANDOFF heading). It
// writes one file, the next-step note `.litcodex/adhd/next-<session>.json` that a following `go` consumes,
// and nothing else. Every string that leaves is redacted and stripped of control characters; a source it
// cannot read is named `unknown` instead of guessed. The brief itself is composed by the model from the
// JSON; `renderBrief` is the Markdown draft of the same parts: a three-line opener (done so far, doing now, next),
// session cards, one table row for each ended session, a roadmap and one boxed next step.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { clean, cleanDeep, cleanLines } from "./control-chars.js";
import { readHerdrAgents } from "./herdr-agents.js";
import { displayWidth, fit } from "./hud.js";
import { codexHomeFrom, plainDirsOrMissing, readSmallJson, writeFileAtomic } from "./live-step.js";
import { makeRedactor } from "./rewind-redact.js";
import { listRollouts, newBudget, readRollout, TOTAL_BYTES, } from "./rewind-rollout.js";
import { readLiveness, readSessionsLiveness } from "./session-liveness.js";
import { normalizeSessionId } from "./state-paths.js";
import { countPlanRows, planProgress, planRows, readWorkflowSignals } from "./workflow-map.js";
import { frameLabel, frameNote, pausedSpine, readStack, STACK_DIR, stackGauge, } from "./workflow-stack.js";
export const ADHD_DIR = ".litcodex/adhd";
/** A session written to in the last quarter hour is still running. */
export const ACTIVE_MS = 15 * 60 * 1000;
/** How long a briefed next step stays runnable by `go`. */
export const GO_WINDOW_MS = 30 * 60 * 1000;
export const DEFAULT_SINCE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_MAX = 12;
const MAX_WORKTREES = 12;
const MAX_STATE_BYTES = 1_000_000;
const MAX_HANDOFF_BYTES = 16 * 1024;
const GIT_TIMEOUT_MS = 3000;
export const runGit = (cwd, args) => {
    try {
        return execFileSync("git", ["-C", cwd, ...args], {
            encoding: "utf8",
            timeout: GIT_TIMEOUT_MS,
            stdio: ["ignore", "pipe", "ignore"],
            env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
            maxBuffer: 1_000_000,
        });
    }
    catch {
        return null;
    }
};
/** `7d`, `36h`, `90m` as milliseconds; null for anything else. */
export function parseSince(text) {
    const match = /^(\d{1,4})([dhm])$/u.exec(text.trim());
    if (match?.[1] === undefined || match[2] === undefined)
        return null;
    const unit = match[2] === "d" ? 86_400_000 : match[2] === "h" ? 3_600_000 : 60_000;
    return Number(match[1]) * unit;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function insideDir(path, dir) {
    const rel = relative(dir, path);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
// ── Sessions ─────────────────────────────────────────────────────────────────
/** The last words ask the person something: a closing question, or a request to approve, confirm or deny. */
const ASKS = /[?？]\s*$|`?lit approve`?|`?lit deny`?|승인해\s*주|확인해\s*주|괜찮을까요|할까요/iu;
function statusOf(facts, mtimeMs, now) {
    const last = facts.lastAt ?? mtimeMs;
    if (facts.last === null && facts.lastAt === null)
        return "unknown";
    // A turn that has finished and asks something no longer runs, however recent it is.
    if (facts.last === "complete" && ASKS.test(facts.lastAgent ?? ""))
        return "waiting-on-user";
    if (now - Math.max(last, mtimeMs) < ACTIVE_MS)
        return "active";
    // A finished turn that asks nothing is history, not something that waits.
    if ((facts.last === "complete" || facts.last === "agent") && ASKS.test(facts.lastAgent ?? ""))
        return "waiting-on-user";
    return "ended";
}
function snippet(redact, text, width) {
    if (text === null)
        return null;
    const flat = clean(redact(text)).replace(/\s+/gu, " ").trim();
    return flat === "" ? null : fit(flat, width);
}
/** UUIDv7 ids open with a timestamp, so sessions started minutes apart share the first 8 characters; use the random tail then. */
export function shortIdOf(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/iu.test(id) ? id.slice(-8) : id.slice(0, 8);
}
function worktreesOf(folders, git) {
    const trees = new Map();
    let gitState = "ok";
    const listed = new Set();
    for (const folder of folders) {
        if (!existsSync(folder))
            continue;
        if ([...trees.keys()].some((known) => insideDir(folder, known)))
            continue;
        const top = git(folder, ["rev-parse", "--show-toplevel"]);
        if (top === null) {
            // A folder that is simply not a repository is not a git failure; only a git that cannot run is.
            if (git(folder, ["--version"]) === null)
                gitState = "unknown";
            if (!trees.has(folder))
                trees.set(folder, { path: folder, branch: null });
            continue;
        }
        const root = top.trim();
        if (listed.has(root))
            continue;
        listed.add(root);
        const porcelain = git(root, ["worktree", "list", "--porcelain"]);
        if (porcelain === null) {
            trees.set(root, { path: root, branch: null });
            continue;
        }
        for (const block of porcelain.split(/\n\n+/u)) {
            const path = /^worktree (.+)$/mu.exec(block)?.[1];
            if (path === undefined)
                continue;
            const branch = /^branch refs\/heads\/(.+)$/mu.exec(block)?.[1] ?? null;
            trees.set(path, { path, branch });
            listed.add(path);
        }
    }
    // A repo with many worktrees must not push the folders the sessions ran in past the cap.
    const holds = (tree) => folders.some((folder) => insideDir(folder, tree.path));
    const ordered = [...trees.values()];
    return {
        trees: [...ordered.filter(holds), ...ordered.filter((tree) => !holds(tree))].slice(0, MAX_WORKTREES),
        gitState,
    };
}
function listDir(dir, suffix, limit) {
    try {
        const lst = lstatSync(dir);
        if (!lst.isDirectory())
            return [];
        return readdirSync(dir)
            .filter((name) => name.endsWith(suffix))
            .sort()
            .slice(0, limit);
    }
    catch {
        return [];
    }
}
/** A plan scaffold nobody filled in: a row that is still a `<placeholder>`, or every row the same. */
function isTemplate(rows) {
    return (rows.some((row) => /<[^<>]{1,40}>/u.test(row.label)) ||
        (rows.length > 1 && new Set(rows.map((row) => row.label.trim())).size === 1));
}
function plansOf(path) {
    const scan = { open: [], finished: [], skipped: [] };
    if (!plainDirsOrMissing(path, ".litcodex/plans"))
        return scan;
    for (const file of listDir(join(path, ".litcodex/plans"), ".md", 40)) {
        try {
            const full = join(path, ".litcodex/plans", file);
            const stat = lstatSync(full);
            if (!stat.isFile())
                continue;
            if (stat.size > MAX_STATE_BYTES) {
                scan.skipped.push({ name: file, done: 0, total: 0, gauge: null, changedMs: stat.mtimeMs });
                continue;
            }
            const text = readFileSync(full, "utf8");
            const rows = countPlanRows(text);
            if (rows.total === 0 || isTemplate(planRows(text)))
                continue;
            const plan = {
                name: file,
                done: rows.done,
                total: rows.total,
                gauge: stackGauge({ n: rows.done, total: rows.total }),
                changedMs: stat.mtimeMs,
            };
            (rows.done < rows.total ? scan.open : scan.finished).push(plan);
        }
        catch {
            // An unreadable plan is left out.
        }
    }
    return scan;
}
function openPlansOf(path) {
    return plansOf(path).open;
}
/** The open plan `name` (a file under `.litcodex/plans`), or null when it is finished, a scaffold or missing. */
export function openPlanNamed(cwd, name) {
    return openPlansOf(cwd).find((plan) => plan.name === name) ?? null;
}
function pausedFramesOf(path) {
    if (!plainDirsOrMissing(path, STACK_DIR))
        return [];
    const out = [];
    for (const file of listDir(join(path, STACK_DIR), ".json", 20)) {
        const session = file.slice(0, -".json".length);
        for (const frame of readStack(path, session).frames)
            if (frame.status === "paused")
                out.push({ session, frame });
    }
    return out;
}
/** The first 16 KiB of this folder's newest HANDOFF note (by change time, then name), or null. */
function handoffText(path) {
    const notes = [];
    for (const name of listDir(path, ".md", 200).filter((file) => /^HANDOFF/iu.test(file))) {
        try {
            const full = join(path, name);
            const stat = lstatSync(full);
            if (stat.isFile())
                notes.push({ full, mtimeMs: stat.mtimeMs });
        }
        catch {
            // An unreadable note is left out.
        }
    }
    const newest = notes.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (newest === undefined)
        return null;
    try {
        return readFileSync(newest.full, "utf8").slice(0, MAX_HANDOFF_BYTES);
    }
    catch {
        return null;
    }
}
/** A Next item already finished: ticked, struck through, or marked ✅, ✓, DONE or SHIPPED (those words in capitals). */
const DONE_ITEM = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\[[xX]\]|~~.*~~\s*$)|[✅✔✓]|\b(?:DONE|SHIPPED)\b/u;
function handoffHeading(path) {
    const text = handoffText(path);
    return text === null ? null : (/^#{1,3}\s+(.+)$/mu.exec(text)?.[1]?.trim() ?? null);
}
/** The first item under the HANDOFF note's `## Next` that is not ticked off, or null. */
function handoffNext(path) {
    const text = handoffText(path);
    const body = text === null ? undefined : /^##\s+Next\b[^\n]*\n([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/imu.exec(text)?.[1];
    for (const line of (body ?? "").split("\n")) {
        if (DONE_ITEM.test(line))
            continue;
        const item = line
            .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[ \]\s+)?/u, "")
            .replace(/\s+/gu, " ")
            .trim();
        if (item !== "")
            return fit(item, 160);
    }
    return null;
}
/** The session finished what it ran: its top frame is a closed start-work, or the plan it carries is all ticked. */
function sessionFinished(cwd, sessionId) {
    const top = readStack(cwd, sessionId).frames.at(-1);
    if (top === undefined)
        return false;
    if (top.done === true && (top.skill === "start-work" || top.skill === "litwork"))
        return true;
    const plan = top.ref === undefined ? null : planProgress(cwd, top.ref.plan);
    return plan !== null && plan.done >= plan.total;
}
// ── Session and timeline words ───────────────────────────────────────────────
/** `6m`, `2h 5m`, `3d` for a length of time. */
function spanWords(ms) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60)
        return `${minutes}m`;
    if (minutes < 48 * 60)
        return minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return `${Math.round(minutes / 1440)}d`;
}
/** What a session's records show, in words: `12 steps · 4m · last: apply_patch`. Empty when they show nothing. */
function sessionFacts(facts, redact) {
    const parts = [];
    if (facts.steps > 0)
        parts.push(`${facts.steps}${facts.stepsPartial ? "+" : ""} step${facts.steps === 1 ? "" : "s"}`);
    if (facts.startedAt !== null && facts.lastAt !== null && facts.lastAt > facts.startedAt)
        parts.push(spanWords(facts.lastAt - facts.startedAt));
    if (facts.lastTool !== null)
        parts.push(`last: ${clean(redact(facts.lastTool))}`);
    return parts.join(" · ");
}
/** What this session needs from the person, in plain words. */
function needsOf(status, doing) {
    if (status === "waiting-on-user")
        return "answer its question";
    if (status === "done")
        return "review what it finished";
    if (status === "idle")
        return "its turn is over; it waits for your next message";
    if (status === "active")
        return doing === null ? "nothing yet; it is still working" : `now: ${doing}`;
    if (status === "ended")
        return "pick it up again, or leave it";
    return "unknown; open it to see";
}
/** What a session reported, else what it did without a report: files edited, or the tools it used most. */
function doneOf(facts, lastAgent, tools, redact) {
    if (lastAgent !== null)
        return lastAgent;
    if (facts.edited.length > 0) {
        const names = facts.edited.slice(0, 3).map((name) => clean(redact(name)));
        return `edited ${plural(facts.edited.length, "file")}${facts.stepsPartial ? " or more" : ""}: ${names.join(", ")}`;
    }
    return tools.length > 0 ? `no edits yet; used ${tools.join(", ")}` : null;
}
const OPEN_ROWS_SHOWN = 2;
/** A worktree's timeline: recent commits (done, dated), the step under way, then the next open plan rows. */
function milestonesOf(path, git, paused, plans, now) {
    const out = [];
    const log = git(path, ["log", "-3", "--format=%cs%x09%s"]);
    if (log !== null) {
        const commits = log
            .split("\n")
            .map((line) => /^(\d{4}-\d{2}-\d{2})\t(.+)$/u.exec(line))
            .filter((match) => match !== null)
            .map((match) => ({ state: "done", label: match[2] ?? "", date: match[1] ?? null }))
            .reverse();
        out.push(...commits);
    }
    const today = new Date(now).toISOString().slice(0, 10);
    for (const label of paused)
        out.push({ state: "now", label: `paused: ${label}`, date: today });
    const rows = [];
    for (const plan of plans.slice(0, 1)) {
        try {
            const full = join(path, ".litcodex/plans", plan.name);
            const stat = lstatSync(full);
            if (!stat.isFile() || stat.size > MAX_STATE_BYTES)
                continue;
            for (const row of planRows(readFileSync(full, "utf8")))
                rows.push({ ...row, plan: plan.name });
        }
        catch {
            // An unreadable plan adds no rows.
        }
    }
    const open = rows.filter((row) => !row.done);
    const current = open[0];
    if (current !== undefined && paused.length === 0)
        out.push({ state: "now", label: current.label, date: today });
    const ahead = paused.length === 0 ? open.slice(1) : open;
    for (const row of ahead.slice(0, OPEN_ROWS_SHOWN))
        out.push({ state: "later", label: row.label, date: null });
    return out;
}
// ── Next step ────────────────────────────────────────────────────────────────
/** A paused start-work record waiting on a boundary answer, read from the workspace state file. */
function pendingBoundary(cwd) {
    if (!plainDirsOrMissing(cwd, ".litcodex/start-work"))
        return false;
    const state = readSmallJson(join(cwd, ".litcodex/start-work/state.json"), MAX_STATE_BYTES);
    if (!isRecord(state) || !isRecord(state["works"]))
        return false;
    return Object.values(state["works"])
        .filter(isRecord)
        .some((work) => work["status"] === "paused" && isRecord(work["pending_boundary"]));
}
/** The start-work run under way here (active, or paused without a boundary), and whether this session owns it. */
function workUnderWay(cwd, sessionId) {
    if (!plainDirsOrMissing(cwd, ".litcodex/start-work"))
        return null;
    const state = readSmallJson(join(cwd, ".litcodex/start-work/state.json"), MAX_STATE_BYTES);
    if (!isRecord(state) || !isRecord(state["works"]))
        return null;
    const activeId = state["active_work_id"];
    const work = Object.values(state["works"])
        .filter(isRecord)
        .find((entry) => entry["work_id"] === activeId && (entry["status"] === "active" || entry["status"] === "paused"));
    if (work === undefined || typeof activeId !== "string")
        return null;
    const owners = Array.isArray(work["session_ids"]) ? work["session_ids"] : [];
    const mine = sessionId !== null &&
        owners.some((owner) => typeof owner === "string" &&
            owner.startsWith("codex:") &&
            normalizeSessionId(owner.slice("codex:".length)) === sessionId);
    return { id: activeId, mine };
}
/**
 * The one step worth taking next, in priority order: the paused frame of this session's stack, then a boundary
 * waiting for an answer (shown, never started), then work already under way, then the single open plan.
 */
export function chooseNext(cwd, sessionId) {
    return cleanDeep(chooseNextRaw(cwd, sessionId));
}
function chooseNextRaw(cwd, sessionId) {
    if (sessionId !== null) {
        const spine = pausedSpine(readStack(cwd, sessionId));
        if (spine !== null) {
            return {
                kind: "resume-frame",
                text: `resume the paused ${frameLabel(spine)} with \`lit continue\``,
                skill: spine.skill ?? "work",
                stage: spine.stage,
                ...(spine.n === undefined ? {} : { n: spine.n }),
                ...(spine.total === undefined ? {} : { total: spine.total }),
            };
        }
    }
    if (pendingBoundary(cwd)) {
        return {
            kind: "approve-boundary",
            text: "start-work waits at a boundary: answer `lit approve` or `lit deny` yourself",
        };
    }
    const signals = readWorkflowSignals(cwd, sessionId);
    const work = signals.work;
    if (work !== null && work.status !== "completed" && work.done < work.total) {
        // Another session's run is shown where it runs, never continued from here.
        const run = workUnderWay(cwd, sessionId === null ? null : normalizeSessionId(sessionId));
        if (run === null || !run.mine) {
            return {
                kind: "other-session",
                text: `another session runs the ${work.status} start-work plan, ${work.done} of ${work.total} tasks done: continue it there`,
            };
        }
        return {
            kind: "continue-work",
            text: `continue the ${work.status} start-work plan, ${work.done} of ${work.total} tasks done`,
            work: run.id,
        };
    }
    if (signals.goals !== null && signals.goals.done < signals.goals.total) {
        return {
            kind: "continue-work",
            text: `continue the open lit-loop goals, ${signals.goals.done} of ${signals.goals.total} done`,
        };
    }
    const open = openPlansOf(cwd);
    const only = open[0];
    if (open.length === 1 && only !== undefined && (work === null || work.status === "completed")) {
        return {
            kind: "start-plan",
            text: `start work on ${only.name}, ${only.done} of ${only.total} tasks done`,
            plan: only.name,
        };
    }
    const handoff = open.length === 0 ? handoffNext(cwd) : null;
    if (handoff !== null)
        return { kind: "handoff", text: `from the handoff: ${handoff}` };
    return { kind: "none", text: "no single next step stands out; say what to work on" };
}
function nextPath(cwd, sessionId) {
    const id = normalizeSessionId(sessionId);
    return id === null || !isAbsolute(cwd) ? null : join(cwd, ADHD_DIR, `next-${id}.json`);
}
/** Save the briefed step for `go`, or remove a stale one when there is nothing to run. Never throws. */
export function writeNext(cwd, sessionId, next, now) {
    const path = nextPath(cwd, sessionId);
    if (path === null)
        return;
    try {
        if (!plainDirsOrMissing(cwd, ADHD_DIR))
            return;
        // A handoff or nothing at all leaves no note; a held-back step leaves one so `go` can say why it waits.
        if (next.kind === "none" || next.kind === "handoff") {
            rmSync(path, { force: true });
            return;
        }
        mkdirSync(join(cwd, ADHD_DIR), { recursive: true });
        const record = { version: 1, sessionId, at: now, ...next };
        writeFileAtomic(path, `${JSON.stringify(record)}\n`);
    }
    catch {
        // Without the note `go` simply finds nothing to run.
    }
}
// ── Collect ──────────────────────────────────────────────────────────────────
export function collectRewind(options) {
    const now = options.now ?? Date.now();
    const env = options.env;
    const home = env["HOME"] ?? homedir();
    const redact = makeRedactor(env, home);
    const git = options.git ?? runGit;
    const codexHome = options.codexHome ?? codexHomeFrom(env);
    const sinceMs = options.sinceMs ?? DEFAULT_SINCE_MS;
    const max = Math.max(1, Math.min(options.max ?? DEFAULT_MAX, 50));
    const sessionId = options.sessionId === undefined || options.sessionId === null ? null : normalizeSessionId(options.sessionId);
    const limit = options.budgetBytes ?? TOTAL_BYTES;
    const budget = newBudget(limit);
    let sessionsState = codexHome === null ? "unknown" : "ok";
    const sessions = [];
    if (codexHome !== null) {
        const files = listRollouts(codexHome).filter((file) => now - file.mtimeMs <= sinceMs);
        for (const file of files) {
            if (sessions.length >= max)
                break;
            const facts = readRollout(file, budget);
            if (facts === null) {
                if (budget.exhausted)
                    break;
                continue;
            }
            if (facts.subagent)
                continue;
            if (options.here === true && (facts.cwd === null || !insideDir(facts.cwd, options.cwd)))
                continue;
            const top = facts.cwd === null ? undefined : readStack(facts.cwd, facts.id).frames.at(-1);
            const seen = statusOf(facts, file.mtimeMs, now);
            // What the workspace recorded outranks a guess from the record's age: finished work, then a closed turn.
            const status = facts.cwd !== null && sessionFinished(facts.cwd, facts.id)
                ? "done"
                : seen !== "waiting-on-user" &&
                    facts.cwd !== null &&
                    readLiveness(facts.cwd, facts.id, now)?.state === "idle"
                    ? "idle"
                    : seen;
            const lastAgent = snippet(redact, facts.lastAgent, 160);
            const gauge = stackGauge(top ?? {});
            const noted = top === undefined ? "" : frameNote(top);
            const facted = sessionFacts(facts, redact);
            const tools = facts.tools.slice(0, 3).map(([name]) => clean(redact(name)));
            const tool = facts.lastTool === null ? null : clean(redact(facts.lastTool));
            const doing = tool === null ? null : facts.lastTarget === null ? tool : `${tool} “${clean(redact(facts.lastTarget))}”`;
            sessions.push({
                id: facts.id,
                shortId: shortIdOf(facts.id),
                current: sessionId !== null && normalizeSessionId(facts.id) === sessionId,
                cwd: facts.cwd === null ? null : redact(facts.cwd),
                status,
                lastAt: facts.lastAt ?? file.mtimeMs,
                tree: null,
                gauge,
                facts: [noted, facted].filter((part) => part !== "").join(" · "),
                title: snippet(redact, facts.firstUser, 80),
                lastUser: snippet(redact, facts.lastUser, 120),
                lastAgent,
                done: doneOf(facts, lastAgent, tools, redact),
                needs: needsOf(status, doing),
                tools,
                edited: facts.edited.length,
                doing,
            });
        }
        if (files.length === 0 && listRollouts(codexHome).length === 0)
            sessionsState = "unknown";
    }
    const folders = [
        options.cwd,
        ...sessions.flatMap((session) => {
            const found = session.cwd === null ? undefined : session.cwd.replace(/^~(?=$|\/)/u, home);
            return found === undefined ? [] : [found];
        }),
    ];
    const unique = [...new Set(folders)].filter((folder) => isAbsolute(folder));
    const { trees, gitState } = worktreesOf(unique, git);
    const worktrees = trees.map((tree) => {
        const signals = readWorkflowSignals(tree.path, null, now);
        const subject = git(tree.path, ["log", "-1", "--format=%s"]);
        const work = signals.work === null
            ? null
            : {
                status: signals.work.status,
                done: signals.work.done,
                total: signals.work.total,
                gauge: stackGauge({ n: signals.work.done, total: signals.work.total }),
            };
        const goals = signals.goals === null
            ? null
            : {
                done: signals.goals.done,
                total: signals.goals.total,
                gauge: stackGauge({ n: signals.goals.done, total: signals.goals.total }),
            };
        // Every plan, this worktree's too, counts only if it changed inside the window.
        const inWindow = (plan) => plan.changedMs !== null && now - plan.changedMs <= sinceMs;
        const scan = plansOf(tree.path);
        const openPlans = scan.open.filter(inWindow).slice(0, 4);
        const pausedHere = pausedFramesOf(tree.path);
        return {
            path: redact(tree.path),
            branch: tree.branch,
            lastCommit: snippet(redact, subject, 80),
            gauge: work?.gauge ?? goals?.gauge ?? null,
            work,
            goals,
            openPlans,
            finishedPlans: scan.finished
                .filter(inWindow)
                .map((plan) => plan.name)
                .slice(0, 4),
            skippedPlans: scan.skipped.filter(inWindow).length,
            milestones: milestonesOf(tree.path, git, pausedHere.map(({ frame }) => redact(frameLabel(frame))), openPlans, now).map((milestone) => ({ ...milestone, label: snippet(redact, milestone.label, 80) ?? "" })),
            paused: pausedHere.map(({ session, frame }) => ({
                session: session.slice(0, 8),
                label: frameLabel(frame),
            })),
            handoff: snippet(redact, handoffHeading(tree.path), 80),
        };
    });
    const homed = (path) => path.replace(/^~(?=$|\/)/u, home);
    const placed = sessions.map((session) => {
        const where = session.cwd === null ? undefined : homed(session.cwd);
        const owner = where === undefined
            ? undefined
            : [...worktrees]
                .sort((a, b) => b.path.length - a.path.length)
                .find((tree) => insideDir(where, homed(tree.path)));
        return { ...session, tree: owner?.path ?? null };
    });
    const herdr = readHerdrAgents(env, options.herdr);
    const lanes = lanesOf(placed, laneRootsOf(options.cwd, git), sessionId, env, herdr, now, homed);
    const chosen = chooseNext(options.cwd, sessionId);
    // A step `go` would only start, a handoff item or nothing at all waits while other lanes work: the live signal wins.
    const next = lanes.count > 0 && (chosen.kind === "start-plan" || chosen.kind === "handoff" || chosen.kind === "none")
        ? { kind: "wait-lanes", text: waitText(lanes), lanes: lanes.count }
        : chosen;
    if (sessionId !== null)
        writeNext(options.cwd, sessionId, next, now);
    // Commit subjects, branch names, plan rows and names, goals and paths are record text: none of it may carry a control.
    return cleanDeep({
        generatedAt: new Date(now).toISOString(),
        codexHome: codexHome === null ? null : redact(codexHome),
        sessions: placed,
        worktrees,
        next,
        lanes: { count: lanes.count, waiting: lanes.waiting, labels: lanes.labels, herdr: herdr.state },
        suggestion: suggestionOf(placed, worktrees),
        scope: { sinceMs, worktrees: worktrees.length },
        sources: { sessions: sessionsState, git: gitState, state: "ok" },
        budget: { limit, used: limit - budget.remaining, exhausted: budget.exhausted },
    });
}
// ── Lanes ────────────────────────────────────────────────────────────────────
/** This checkout's top folder and the other worktrees of its repository; the folder alone when git cannot say. */
function laneRootsOf(cwd, git) {
    const top = git(cwd, ["rev-parse", "--show-toplevel"])?.trim();
    if (top === undefined || top === "")
        return [cwd];
    const porcelain = git(top, ["worktree", "list", "--porcelain"]);
    const listed = porcelain === null ? [] : [...porcelain.matchAll(/^worktree (.+)$/gmu)].map((match) => match[1] ?? "");
    return [...new Set([top, ...listed.filter((path) => isAbsolute(path))])];
}
const LANE_LABELS = 3;
/**
 * Other lanes at work in this repository, each once: a session that runs or waits on the user, a session whose
 * liveness record says it is working, and, under herdr, a working or blocked agent of this workspace or repo.
 * The asking session and its own pane never count.
 */
function lanesOf(sessions, roots, sessionId, env, herdr, now, homed) {
    const inRepo = (path) => path !== null && isAbsolute(homed(path)) && roots.some((root) => insideDir(homed(path), root));
    const own = (id) => id !== null && sessionId !== null && normalizeSessionId(id) === sessionId;
    const lanes = [];
    const known = new Map(sessions.map((session) => [normalizeSessionId(session.id), session.status]));
    for (const session of sessions) {
        if (session.current || own(session.id) || !inRepo(session.cwd))
            continue;
        if (session.status !== "active" && session.status !== "waiting-on-user")
            continue;
        lanes.push({
            session: normalizeSessionId(session.id),
            pane: null,
            waiting: session.status === "waiting-on-user",
            label: `${session.shortId} in ${placeOf(session)}`,
        });
    }
    for (const root of roots) {
        for (const record of readSessionsLiveness(root, now)) {
            const id = normalizeSessionId(record.sessionId);
            if (record.state !== "alive" || id === null || own(id))
                continue;
            const seen = lanes.find((lane) => lane.session === id);
            if (seen !== undefined) {
                seen.pane ??= record.herdrPane;
                continue;
            }
            // A session the records show as finished or idle is not at work, whatever its last tool call wrote.
            const status = known.get(id);
            if (status !== undefined && status !== "active" && status !== "waiting-on-user")
                continue;
            lanes.push({
                session: id,
                pane: record.herdrPane,
                waiting: false,
                label: `${shortIdOf(id)} in ${basename(root)}`,
            });
        }
    }
    const ownPane = env["HERDR_PANE_ID"];
    const ownWorkspace = env["HERDR_WORKSPACE_ID"];
    for (const agent of herdr.agents) {
        if (agent.status !== "working" && agent.status !== "blocked")
            continue;
        if (agent.pane !== null && agent.pane === ownPane)
            continue;
        if (own(agent.session))
            continue;
        const here = (typeof ownWorkspace === "string" && ownWorkspace !== "" && agent.workspace === ownWorkspace) ||
            inRepo(agent.cwd) ||
            inRepo(agent.foregroundCwd);
        if (!here)
            continue;
        const id = agent.session === null ? null : normalizeSessionId(agent.session);
        const seen = lanes.find((lane) => (id !== null && lane.session === id) || (agent.pane !== null && lane.pane === agent.pane));
        if (seen !== undefined) {
            seen.waiting ||= agent.status === "blocked";
            continue;
        }
        lanes.push({
            session: id,
            pane: agent.pane,
            waiting: agent.status === "blocked",
            label: `${agent.agent} in pane ${agent.pane ?? "unknown"}`,
        });
    }
    const ordered = [...lanes.filter((lane) => lane.waiting), ...lanes.filter((lane) => !lane.waiting)];
    return {
        count: lanes.length,
        waiting: ordered.filter((lane) => lane.waiting).length,
        labels: ordered.slice(0, LANE_LABELS).map((lane) => lane.label),
    };
}
/** The held-back step: answer the lane that waits on the user, else wait for the lanes to finish. */
function waitText(lanes) {
    const first = lanes.labels[0] ?? "the other lane";
    if (lanes.waiting > 0) {
        const rest = lanes.count - 1;
        return `answer ${first}: it waits on you${rest > 0 ? `; ${plural(rest, "more lane")} still at work` : ""}`;
    }
    return `wait for ${plural(lanes.count, "lane")} to finish: ${lanes.labels.join(", ")}`;
}
// ── Suggestion ───────────────────────────────────────────────────────────────
const homeless = (path) => (path === null ? "unknown" : basename(path));
/** The worktree folder a session runs in, else the folder it started in, as a short name. */
function placeOf(session) {
    return homeless(session.tree ?? session.cwd);
}
/** The last sentence of a session's final words that ends in a question mark, clipped. */
function lastQuestion(text) {
    const found = [...(text ?? "").matchAll(/[^.!?。？\n]{4,}[?？]/gu)].at(-1)?.[0];
    return found === undefined ? null : fit(found.replace(/\s+/gu, " ").trim(), 90);
}
/**
 * The step to recommend when nothing can run on `go`, so the brief never ends on "nothing". In order: a session
 * that waits on the user, a paused workflow, the open plan item of a worktree where a session is live, any
 * open plan item, the latest other active session, the latest other ended one. It is shown, never recorded.
 */
export function suggestionOf(sessions, worktrees) {
    const others = sessions.filter((session) => !session.current);
    const waiting = others.find((session) => session.status === "waiting-on-user");
    if (waiting !== undefined) {
        const question = lastQuestion(waiting.lastAgent);
        return `answer ${waiting.shortId} in ${placeOf(waiting)}${question === null ? "" : `: “${question}”`}`;
    }
    // Finished work is reviewed, never picked up again as if it were still to do.
    const finished = others.find((session) => session.status === "done");
    if (finished !== undefined)
        return `review what ${finished.shortId} finished in ${placeOf(finished)}: ${fit(finished.title ?? "no first request", 50)}`;
    for (const tree of worktrees) {
        const paused = tree.paused[0];
        if (paused !== undefined)
            return `resume ${paused.label} in ${paused.session} (${homeless(tree.path)})`;
    }
    const liveTrees = new Set(sessions
        .filter((session) => session.status !== "ended" && session.status !== "done")
        .map((session) => session.tree));
    const withItem = worktrees
        .filter((tree) => tree.openPlans.length > 0 && tree.milestones.some((item) => item.state === "now"))
        .sort((a, b) => Number(liveTrees.has(b.path)) - Number(liveTrees.has(a.path)));
    const tree = withItem[0];
    const item = tree?.milestones.find((milestone) => milestone.state === "now");
    if (tree !== undefined && item !== undefined)
        return `next in ${tree.openPlans[0]?.name ?? "the open plan"} (${homeless(tree.path)}): ${item.label}`;
    const active = others.find((session) => session.status === "active" || session.status === "idle");
    if (active !== undefined)
        return `check on ${active.shortId} in ${placeOf(active)} (${fit(active.title ?? "no first request", 50)})${active.doing === null ? "" : `, now ${active.doing}`}`;
    const ended = others.find((session) => session.status === "ended");
    if (ended !== undefined)
        return `pick up ${ended.shortId} in ${placeOf(ended)}: ${fit(ended.title ?? "no first request", 50)}`;
    return "no session or plan in this window: say what to start";
}
// ── Brief ────────────────────────────────────────────────────────────────────
function pad(text, width) {
    const cut = fit(text, width);
    return cut + " ".repeat(Math.max(0, width - displayWidth(cut)));
}
function ago(from, now) {
    if (from === null)
        return "a while ago";
    const minutes = Math.max(0, Math.round((now - from) / 60_000));
    if (minutes < 1)
        return "just now";
    if (minutes < 60)
        return `${minutes}m ago`;
    if (minutes < 48 * 60)
        return `${Math.round(minutes / 60)}h ago`;
    return `${Math.round(minutes / 1440)}d ago`;
}
/** The age in its largest unit only (`20m`, `14h`, `3d`), short enough for a table cell. */
function agoShort(from, now) {
    if (from === null)
        return "·";
    const minutes = Math.max(0, Math.round((now - from) / 60_000));
    if (minutes < 60)
        return `${minutes}m`;
    if (minutes < 48 * 60)
        return `${Math.round(minutes / 60)}h`;
    return `${Math.round(minutes / 1440)}d`;
}
const BADGE = {
    "waiting-on-user": "🟡 **WAITS ON YOU**",
    active: "🟢 **RUNNING**",
    idle: "💤 **IDLE**",
    done: "✅ **DONE**",
    ended: "⚪ **ENDED**",
    unknown: "⚫ **NO RECORD**",
};
const MARK = { done: "✓", now: "▶", later: "○" };
function plural(count, one, many = `${one}s`) {
    return `${count} ${count === 1 ? one : many}`;
}
/** The headline's step: the recorded `next`, else the suggestion drawn from the records. */
function stepOf(result) {
    return result.next.kind === "none" ? result.suggestion : result.next.text;
}
/** The opener's three parts: what is finished, what is under way, and the one next step. */
function openerOf(result) {
    const count = (status) => result.sessions.filter((session) => session.status === status).length;
    const plans = result.worktrees.reduce((sum, tree) => sum + tree.finishedPlans.length, 0);
    const finished = [
        plans > 0 ? `${plural(plans, "plan")} finished` : "",
        count("done") > 0 ? `${plural(count("done"), "session")} done` : "",
    ].filter((part) => part !== "");
    const waiting = count("waiting-on-user");
    const paused = result.worktrees.reduce((sum, tree) => sum + tree.paused.length, 0);
    const doing = [
        count("active") > 0 ? `${count("active")} running` : "",
        count("idle") > 0 ? `${count("idle")} idle` : "",
        paused > 0 ? `${paused} paused` : "",
    ].filter((part) => part !== "");
    if (doing.length === 0)
        doing.push("nothing running");
    doing.push(waiting === 0 ? "nothing waits on you" : `${waiting} ${waiting === 1 ? "waits" : "wait"} on you`);
    return {
        done: finished.length === 0 ? "nothing finished in this window" : finished.join(" · "),
        doing: doing.join(" · "),
        next: stepOf(result),
    };
}
/** The three-line opener in plain words: done so far, doing now, next. */
export function briefHeadline(result) {
    const opener = openerOf(result);
    return [`done so far: ${opener.done}`, `doing now: ${opener.doing}`, `next: ${opener.next}`].join("\n");
}
// Markdown words: record text is inert data, so every character that would turn it into markup is neutralised.
const GAUGE = /\[[▉░]{1,10}\] \d+\/\d+/gu;
const bare = (text) => text.replace(/\s+/gu, " ").trim();
const escapeMd = (text) => text
    .replace(/[<>`]/gu, (char) => (char === "<" ? "‹" : char === ">" ? "›" : "'"))
    .replace(/[*|[\]\\]|(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, (char) => `\\${char}`);
const code = (text) => `\`${bare(text).replaceAll("`", "'")}\``;
/** Record text as Markdown; a gauge inside it stays whole in a code span instead of being escaped. */
function rich(text) {
    const flat = bare(text);
    let out = "";
    let from = 0;
    for (const match of flat.matchAll(GAUGE)) {
        out += escapeMd(flat.slice(from, match.index)) + code(match[0]);
        from = match.index + match[0].length;
    }
    return out + escapeMd(flat.slice(from));
}
function sessionCard(session, now) {
    const mark = session.current ? " · this session" : "";
    const progress = [session.gauge === null ? "" : code(session.gauge), rich(session.facts)].filter((part) => part !== "");
    const lines = [
        `${BADGE[session.status]} · ${code(session.shortId)} · ${ago(session.lastAt, now)}${mark}`,
        `**${rich(session.title ?? "no first request recorded")}**`,
        `⏳ ${progress.length === 0 ? "no activity recorded" : progress.join(" · ")}`,
        `✅ Done: ${session.done === null ? "nothing on record" : rich(session.done)}`,
        `▶ Next: ${rich(session.needs)}`,
    ];
    return lines.map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`)).join("  \n");
}
/** A worktree's roadmap; without a live session here, only when something in it is still open. */
function roadmapBlock(tree, live) {
    const lines = [];
    const gauge = tree.gauge === null ? "" : ` ${code(tree.gauge)}`;
    const parts = [
        tree.work === null
            ? null
            : `start-work ${rich(tree.work.status)}${tree.work.gauge === null ? "" : ` ${code(tree.work.gauge)}`}`,
        tree.goals === null ? null : `goals${tree.goals.gauge === null ? "" : ` ${code(tree.goals.gauge)}`}`,
        ...tree.openPlans.map((plan) => `plan ${code(plan.name)}${plan.gauge === null ? "" : ` ${code(plan.gauge)}`}`),
        ...tree.finishedPlans.map((name) => `plan ${code(name)} finished`),
    ].filter((part) => part !== null);
    const open = parts.length > 0 || tree.milestones.some((item) => item.state !== "done");
    if (!open && !(live && (tree.milestones.length > 0 || tree.handoff !== null)))
        return lines;
    lines.push(`🗺️ **Roadmap**${gauge}`, "");
    if (parts.length > 0)
        lines.push(`- 📌 open: ${parts.join(" · ")}`);
    for (const milestone of tree.milestones) {
        const when = milestone.date ?? (milestone.state === "later" ? "later" : "");
        lines.push(`- ${MARK[milestone.state]} ${when === "" ? "" : `${code(when)} · `}${rich(milestone.label)}`);
    }
    if (tree.handoff !== null)
        lines.push(`- 📝 handoff note: ${rich(tree.handoff)}`);
    return lines;
}
const ENDED_ROWS = 8;
/** Ended sessions, one table row each, newest first: they are history, so no card. One line per row at 120 columns. */
export function endedTable(sessions, now, width = 96) {
    const goalWidth = Math.max(16, Math.min(44, width - 74));
    const cell = (text) => escapeMd(bare(text)) || "·";
    const rows = sessions.slice(0, ENDED_ROWS).map((session) => {
        const done = session.edited > 0 ? plural(session.edited, "file") : "·";
        const place = fit(session.tree === null && session.cwd === null ? "unknown" : placeOf(session), 20);
        return `| ${code(session.shortId)} | ${cell(place)} | ${cell(fit(bare(session.title ?? "no first request"), goalWidth))} | ${agoShort(session.lastAt, now)} | ${cell(done)} |`;
    });
    const more = sessions.length > ENDED_ROWS ? ["", `*…and ${sessions.length - ENDED_ROWS} more ended*`] : [];
    return ["| id | where | goal | ago | done |", "|---|---|---|---|---|", ...rows, ...more];
}
/** A step cut at word breaks to the box, three lines at most, the last one clipped. */
function wrap(text, width, limit = 3) {
    const out = [""];
    for (const word of bare(text).split(" ")) {
        const joined = out.at(-1) === "" ? word : `${out.at(-1)} ${word}`;
        if (displayWidth(joined) <= width || out.at(-1) === "")
            out[out.length - 1] = joined;
        else
            out.push(word);
    }
    const kept = out.slice(0, limit);
    if (out.length > limit)
        kept[limit - 1] = `${kept[limit - 1]} ${out.slice(limit).join(" ")}`;
    return kept.map((line) => fit(line, width));
}
function nextBox(result, width) {
    const inner = Math.min(Math.max(28, width - 4), 76);
    const say = result.next.kind === "none"
        ? "nothing runs on its own here: open that session, or say what to do"
        : result.next.kind === "approve-boundary"
            ? "answer `lit approve` or `lit deny` yourself"
            : result.next.kind === "handoff"
                ? "a step from the handoff note; `go` does not run it, so say what to do"
                : result.next.kind === "other-session"
                    ? "that run belongs to another session; `go` here does not run it"
                    : result.next.kind === "wait-lanes"
                        ? "do not type `go` until they finish"
                        : "say `go` to run it";
    const box = (text) => `│ ${pad(text, inner)} │`;
    return [
        "```",
        `╭─ Recommended next step ${"─".repeat(Math.max(1, inner - 22))}╮`,
        ...wrap(stepOf(result), inner).map(box),
        ...wrap(say, inner, 2).map(box),
        `╰${"─".repeat(inner + 2)}╯`,
        "```",
    ];
}
/** `7d`, `36h`, `90m` for the window read. */
function windowWords(ms) {
    if (ms % 86_400_000 === 0)
        return `${ms / 86_400_000}d`;
    if (ms % 3_600_000 === 0)
        return `${ms / 3_600_000}h`;
    return `${Math.max(1, Math.round(ms / 60_000))}m`;
}
/**
 * The brief as Markdown limited to what the Codex terminal draws: bold, emoji, lists, a table and a fenced box.
 * Never `#` headings or `>` quotes, which it prints as raw marks. A three-line opener, a card for every session
 * that has not ended, grouped by worktree with each worktree's roadmap (done ✓ with its date, now ▶, later ○), one table
 * row for every ended session, and the one recommended next step in a box. A progress gauge appears only when
 * both counts are real; otherwise the known facts are written out in words.
 */
export function renderBrief(result, width = 96) {
    const now = Date.parse(result.generatedAt);
    const opener = openerOf(result);
    const lines = [
        `**✅ Done so far:** ${rich(opener.done)}  `,
        `**▶ Doing now:** ${rich(opener.doing)}  `,
        `**⏭ Next:** ${rich(opener.next)}`,
    ];
    lines.push(`*last ${windowWords(result.scope.sinceMs)} · ${plural(result.sessions.length, "session")} · ${plural(Math.max(1, result.scope.worktrees), "worktree")}*`);
    if (result.sessions.length === 0)
        lines.push("", "No Codex session records in range.");
    const live = result.sessions.filter((session) => session.status !== "ended");
    const ended = result.sessions.filter((session) => session.status === "ended");
    const groups = new Map();
    for (const session of live)
        groups.set(session.tree ?? "", [...(groups.get(session.tree ?? "") ?? []), session]);
    const known = new Set(result.worktrees.map((tree) => tree.path));
    const order = [...result.worktrees.map((tree) => tree.path), ...[...groups.keys()].filter((key) => !known.has(key))];
    for (const key of order) {
        const tree = result.worktrees.find((candidate) => candidate.path === key);
        const here = groups.get(key) ?? [];
        const roadmap = tree === undefined ? [] : roadmapBlock(tree, here.length > 0);
        if (here.length === 0 && roadmap.length === 0)
            continue;
        const name = tree === undefined ? "folder unknown" : escapeMd(basename(tree.path));
        const branch = tree?.branch == null ? "" : `${code(tree.branch)} · `;
        lines.push("", `🌿 ${branch}**${name}**`);
        for (const session of here)
            lines.push("", sessionCard(session, now));
        if (roadmap.length > 0)
            lines.push("", ...roadmap);
    }
    if (ended.length > 0)
        lines.push("", `⚪ **Ended · ${ended.length}**`, "", ...endedTable(ended, now, width));
    if (result.worktrees.length === 0 && result.sessions.length === 0)
        lines.push("", "No worktree found.");
    lines.push("", ...nextBox(result, width));
    const unknown = Object.entries(result.sources)
        .filter(([, state]) => state === "unknown")
        .map(([name]) => name);
    if (result.lanes.herdr === "unknown")
        unknown.push("herdr agents");
    if (unknown.length > 0)
        lines.push("", `*not readable: ${unknown.join(", ")}*`);
    const skipped = result.worktrees.reduce((sum, tree) => sum + tree.skippedPlans, 0);
    if (skipped > 0)
        lines.push("", `*${skipped === 1 ? "1 plan" : `${skipped} plans`} too large to read, left out*`);
    if (result.budget.exhausted)
        lines.push("", "*older sessions were not read (read budget spent)*");
    return cleanLines(lines.join("\n"));
}
