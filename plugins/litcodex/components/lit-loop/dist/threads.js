// src/threads.ts — the threads of a session as the card and the text HUD draw them.
//
// A thread is a frame of the session's workflow stack, a child agent (lane) running under its top frame, or
// the top frame of another session of the same project that moved lately or whose liveness record is fresh
// (running first, then idle). Each takes its `k/n` from the
// first source that really knows it: the count the frame recorded, the start-work run it drives, the
// checkboxes of the plan it works from, the open goal's criteria, the main thread's own `update_plan` list
// (top frame only), and for a lane its own `update_plan`. A gauge is drawn only when both numbers are real;
// otherwise the row says what is known in words (`step 4`, `3 steps`, `starting`) and the desktop card adds
// a moving pulse. No placeholder (`?/?`, `[???]`, `k/?`) is ever produced.
//
// `readThreads` returns null while the stack alone describes the work (the card's own paused-work row then
// stays as it was): it fires only when a lane or another session is live. At most THREAD_ROWS rows are kept
// (PARALLEL_ROWS for lanes under a deep chain); the rest are counted as `+N more`. Pure but for its reads.
import { LANE_IDLE_MS, readLanes, readMainPlan } from "./lane-state.js";
import { planProgress } from "./workflow-map.js";
import { frameNote, gaugeBar, pausedSpine, readOtherStacks, readStack } from "./workflow-stack.js";
/** The card shows at most this many thread rows; the rest are counted as `+N more`. */
export const THREAD_ROWS = 4;
/** A deep chain still leaves this many rows for the lanes under it. */
export const PARALLEL_ROWS = 3;
const SHORT_SESSION = 8;
const LOOP_SKILLS = ["lit-loop", "litgoal"];
const WORK_SKILLS = ["start-work", "litwork"];
function gaugeOf(counts) {
    if (counts === null || counts.total <= 0)
        return null;
    return `${gaugeBar(Math.min(counts.done, counts.total), counts.total)} ${counts.done}/${counts.total}`;
}
/** The first source that knows a frame's `k/n`, or null. */
function frameCounts(frame, cwd, signals, mainPlan) {
    if (frame.total !== undefined && frame.total > 0)
        return { done: frame.n ?? 0, total: frame.total };
    const work = signals?.work ?? null;
    const worksPlan = frame.skill !== null &&
        (WORK_SKILLS.includes(frame.skill) || (frame.family === "main" && frame.stage === "work"));
    if (work !== null && work.total > 0 && worksPlan)
        return { done: work.done, total: work.total };
    const plan = frame.ref === undefined ? null : planProgress(cwd, frame.ref.plan);
    if (plan !== null)
        return plan;
    const goals = signals?.goals ?? null;
    if (goals !== null &&
        goals.total > 0 &&
        (frame.family === "loop" || (frame.skill !== null && LOOP_SKILLS.includes(frame.skill))))
        return { done: goals.done, total: goals.total };
    return mainPlan;
}
function frameRow(frame, key, counts, active, blocked) {
    const gauge = gaugeOf(counts);
    return {
        key,
        kind: "frame",
        name: frame.skill ?? frame.family ?? "work",
        stage: frame.stage,
        gauge,
        note: gauge === null ? frameNote(frame) : "",
        state: frame.done === true ? "done" : frame.status === "paused" ? "paused" : blocked ? "blocked" : "running",
        active,
    };
}
function laneRow(lane, now) {
    const gauge = gaugeOf(lane.plan);
    const steps = lane.steps === 1 ? "1 step" : `${lane.steps} steps`;
    return {
        key: `lane-${lane.agentId}`,
        kind: "lane",
        name: lane.name ?? `${lane.kind ?? "agent"} ${lane.agentId.slice(-4)}`,
        stage: lane.kind !== null && lane.kind !== "default" && lane.name !== null ? lane.kind : null,
        gauge,
        note: gauge === null ? (lane.steps > 0 ? steps : "starting") : "",
        state: now - lane.at > LANE_IDLE_MS ? "idle" : "running",
        active: false,
    };
}
/**
 * The thread rows of a session, or null while it has no lane and no other live session (the stack row
 * then says what there is to say). `signals` are the session's saved work state, read once by the caller.
 */
export function readThreads(cwd, sessionId, now, signals) {
    try {
        const stack = readStack(cwd, sessionId);
        const lanes = readLanes(cwd, sessionId, now);
        const others = readOtherStacks(cwd, sessionId, now);
        if (lanes.length === 0 && others.length === 0)
            return null;
        const frames = stack.frames;
        if (frames.length + lanes.length + others.length < 2)
            return null;
        const mainPlan = readMainPlan(cwd, sessionId);
        const chain = frames.map((frame, index) => {
            const active = index === frames.length - 1;
            const blocked = frame.skill === "start-work" && signals?.work?.status === "paused";
            return frameRow(frame, `frame-${index}`, frameCounts(frame, cwd, signals, active ? mainPlan : null), active, blocked);
        });
        const laneRows = lanes.map((lane) => laneRow(lane, now));
        const otherRows = others.map((other) => {
            const top = other.frames.at(-1);
            const row = frameRow(top, `session-${other.id.slice(0, SHORT_SESSION)}`, frameCounts(top, cwd, null, null), false, false);
            return {
                ...row,
                // A session whose turn has closed waits for its person, so it reads idle rather than running.
                ...(other.liveness === "idle" && row.state === "running" ? { state: "idle" } : {}),
                kind: "session",
                session: other.id.slice(0, SHORT_SESSION),
            };
        });
        const room = Math.max(PARALLEL_ROWS, THREAD_ROWS - chain.length);
        const keptLanes = laneRows.slice(0, room);
        const keptOthers = otherRows.slice(0, Math.max(0, room - keptLanes.length));
        return {
            chain,
            lanes: keptLanes,
            others: keptOthers,
            laneCount: laneRows.length,
            more: laneRows.length + otherRows.length - keptLanes.length - keptOthers.length,
            back: pausedSpine(stack) !== null,
        };
    }
    catch {
        return null;
    }
}
// ── Text ────────────────────────────────────────────────────────────────────
/** `3 lanes in parallel`, `1 lane in parallel`. */
export function forkLabel(laneCount) {
    return `${laneCount} ${laneCount === 1 ? "lane" : "lanes"} in parallel`;
}
/** What a row knows beside its name: `2/5`, else its words, else nothing. */
function saidOf(row) {
    return /\d+\/\d+$/u.exec(row.gauge ?? "")?.[0] ?? row.note;
}
/** `lit-loop (work, 2/4)`. */
function named(row) {
    const facts = [row.stage ?? "", saidOf(row)].filter((fact) => fact !== "");
    return facts.length === 0 ? row.name : `${row.name} (${facts.join(", ")})`;
}
const OTHER_STATE = {
    running: "working",
    paused: "paused",
    blocked: "paused",
    idle: "waiting for you",
    done: "done",
};
/**
 * The threads as short sentences. The one running skill is left out, since the map names it.
 *
 *   Now: lit-brainstorm (interview, step 2)
 *   Paused: lit-loop (work, 3/6) · type `lit continue` to go back
 *   3 helpers: Aquinas 2/5, Lagrange 3 steps, Hume starting
 *   Also open in this project: lit-loop (work), waiting for you
 */
export function threadLines(view) {
    const lines = [];
    const top = view.chain.at(-1);
    const under = view.chain.slice(0, -1);
    if (top !== undefined && under.length > 0) {
        lines.push(`Now: ${named(top)}`);
        lines.push(`Paused: ${under.map(named).join(", ")}${view.back ? " · type `lit continue` to go back" : ""}`);
    }
    const hidden = Math.max(0, view.laneCount - view.lanes.length);
    if (view.laneCount > 0) {
        const said = view.lanes.map((row) => {
            const words = [row.name, saidOf(row)].filter((word) => word !== "").join(" ");
            return row.state === "idle" ? `${words} (quiet)` : row.state === "done" ? `${words} (done)` : words;
        });
        if (hidden > 0)
            said.push(`${hidden} more`);
        lines.push(`${view.laneCount} ${view.laneCount === 1 ? "helper" : "helpers"}: ${said.join(", ")}`);
    }
    const unseen = Math.max(0, view.more - hidden);
    view.others.forEach((row, index) => {
        const more = unseen > 0 && index === view.others.length - 1 ? `, and ${unseen} more` : "";
        lines.push(`Also open in this project: ${named(row)}, ${OTHER_STATE[row.state]}${more}`);
    });
    return lines;
}
