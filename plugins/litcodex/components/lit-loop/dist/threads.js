// src/threads.ts — the threads of a session as the card and the text HUD draw them.
//
// A thread is a frame of the session's workflow stack, a child agent (lane) running under its top frame, or
// the top frame of another session of the same project that moved lately. Each takes its `k/n` from the
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
            return {
                ...frameRow(top, `session-${other.id.slice(0, SHORT_SESSION)}`, frameCounts(top, cwd, null, null), false, false),
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
/** Each state's glyph is ASCII or a plain geometric mark, and the state word always rides beside it. */
const STATE_GLYPH = {
    running: "●",
    paused: "|",
    blocked: "!",
    idle: "-",
    done: "✓",
};
/** `3 lanes in parallel`, `1 lane in parallel`. */
export function forkLabel(laneCount) {
    return `${laneCount} ${laneCount === 1 ? "lane" : "lanes"} in parallel`;
}
function rowText(row, lead, nameWidth) {
    const name = row.name.length >= nameWidth ? row.name : row.name.padEnd(nameWidth);
    const tail = row.gauge ?? row.note;
    const parts = [`${lead}${STATE_GLYPH[row.state]} ${name}`];
    if (row.stage !== null)
        parts.push(row.stage);
    if (tail !== "")
        parts.push(tail);
    parts.push(row.state);
    if (row.session !== undefined)
        parts.push(`· other session ${row.session}`);
    return parts.join(" ");
}
/**
 * The thread rows as plain text, parent first, each child under the one before it; lanes hang under the top
 * frame with a fork line over them when two or more run in parallel; other sessions come last.
 *
 *   | lit-loop   WORK [▉▉░░░░░░░░] 3/6 paused
 *   └─ ● lit-brainstorm interview step 2 running · back: lit continue
 *      ┬ 3 lanes in parallel
 *      ├─ ● Aquinas   [▉▉░░░] 2/5 running
 *      ├─ ● Lagrange  3 steps running
 *      └─ ● Hume      starting running
 */
export function threadLines(view) {
    const rows = [...view.chain, ...view.lanes, ...view.others];
    const nameWidth = Math.min(18, Math.max(0, ...rows.map((row) => row.name.length)));
    const lines = [];
    view.chain.forEach((row, index) => {
        const lead = index === 0 ? "" : `${"   ".repeat(index - 1)}└─ `;
        const back = view.back && index === view.chain.length - 1 ? " · back: lit continue" : "";
        lines.push(`${rowText(row, lead, nameWidth)}${back}`);
    });
    const under = "   ".repeat(Math.max(0, view.chain.length - 1));
    if (view.laneCount >= 2)
        lines.push(`${under}┬ ${forkLabel(view.laneCount)}`);
    view.lanes.forEach((row, index) => {
        const branch = view.laneCount >= 2 ? (index === view.lanes.length - 1 ? "└─ " : "├─ ") : view.chain.length > 0 ? "└─ " : "";
        lines.push(rowText(row, `${under}${branch}`, nameWidth));
    });
    for (const row of view.others)
        lines.push(rowText(row, "", nameWidth));
    if (view.more > 0 && lines.length > 0)
        lines[lines.length - 1] += ` +${view.more} more`;
    return lines;
}
