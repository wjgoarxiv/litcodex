// src/lane-state.ts — the child agents (lanes) of a session and the main thread's own to-do count.
//
// Codex 0.164.0 fires `SubagentStart` and `SubagentStop` around each child agent and tags every tool
// event of a child with its `agent_id`. The hooks fold those into one small record per child under
// `.litcodex/lane-state/<session>/`, so parallel children never write the same file. A record keeps a
// display name, the agent type, when it started, how many tool calls it finished and the counts of its
// last `update_plan`; never a prompt, a command or a tool input. The main thread's own plan count lives
// in `main.json` beside them. A lane starts at `SubagentStart` and leaves at `SubagentStop`; one nobody
// touched for LANE_STALE_MS is no longer shown. Every read and write fails open.
import { closeSync, fstatSync, lstatSync, mkdirSync, readdirSync, readSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { openRegularFile, plainDirs, plainDirsOrMissing, writeFileAtomic } from "./live-step.js";
import { normalizeSessionId } from "./state-paths.js";
export const LANE_DIR = ".litcodex/lane-state";
export const MAX_LANES = 12;
/** A lane nobody touched for this long lost its stop event (a killed child); it is no longer shown. */
export const LANE_STALE_MS = 30 * 60 * 1000;
/** A lane quiet for this long reads `idle` instead of `running`. */
export const LANE_IDLE_MS = 10 * 60 * 1000;
const MAX_RECORD_BYTES = 2_048;
const MAX_COUNT = 9_999;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,23}$/u;
const KIND = /^[a-z][a-z0-9_-]{0,19}$/u;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : null;
}
function counts(value) {
    if (!isRecord(value))
        return null;
    const done = count(value["done"]);
    const total = count(value["total"]);
    return done === null || total === null || total === 0 || done > total ? null : { done, total };
}
/** A display name that is plain letters, digits, spaces and `._-`, at most 24 characters; else null. */
export function laneName(value) {
    return typeof value === "string" && NAME.test(value.trim()) ? value.trim() : null;
}
/** An agent type such as `default` or `explorer`; anything else is not shown. */
export function laneKind(value) {
    return typeof value === "string" && KIND.test(value) ? value : null;
}
function laneDir(cwd, sessionId) {
    const id = normalizeSessionId(sessionId);
    if (id === null || !isAbsolute(cwd))
        return null;
    const rel = `${LANE_DIR}/${id}`;
    return { rel, dir: join(cwd, rel) };
}
function readRecordFile(path) {
    let fd = null;
    try {
        fd = openRegularFile(path);
        if (fd === null)
            return null;
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX_RECORD_BYTES)
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
function toLane(value, agentId) {
    if (!isRecord(value) || value["agentId"] !== agentId)
        return null;
    const at = value["at"];
    if (typeof at !== "number" || !Number.isFinite(at))
        return null;
    const startedAt = value["startedAt"];
    return {
        agentId,
        name: laneName(value["name"]),
        kind: laneKind(value["kind"]),
        started: value["started"] === true,
        startedAt: typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : null,
        at,
        steps: count(value["steps"]) ?? 0,
        plan: counts(value["plan"]),
    };
}
function laneFile(agentId) {
    const id = normalizeSessionId(agentId);
    return id === null ? null : `lane-${id}.json`;
}
function readLane(cwd, sessionId, agentId) {
    const where = laneDir(cwd, sessionId);
    const file = laneFile(agentId);
    if (where === null || file === null || !plainDirs(cwd, where.rel))
        return null;
    return toLane(readRecordFile(join(where.dir, file)), agentId);
}
function writeJson(cwd, sessionId, file, value) {
    const where = laneDir(cwd, sessionId);
    if (where === null || !plainDirsOrMissing(cwd, where.rel))
        return;
    mkdirSync(where.dir, { recursive: true });
    if (!lstatSync(where.dir).isDirectory())
        return;
    writeFileAtomic(join(where.dir, file), `${JSON.stringify(value)}\n`);
}
/**
 * Apply one event to a lane record and return the next one, or null when the lane is gone. Pure.
 * `started` and `spawned` open a record; `tool` and `plan` only update a record whose child already
 * started, so a stray event never draws a lane that has no end.
 */
export function applyLaneEvent(lane, event, now) {
    switch (event.type) {
        case "stopped":
            return null;
        case "spawned": {
            const base = lane ?? {
                agentId: event.agentId,
                name: null,
                kind: null,
                started: false,
                startedAt: null,
                at: now,
                steps: 0,
                plan: null,
            };
            return { ...base, name: event.name ?? base.name, at: lane === null ? now : base.at };
        }
        case "started": {
            const base = lane ?? {
                agentId: event.agentId,
                name: null,
                kind: null,
                started: false,
                startedAt: null,
                at: now,
                steps: 0,
                plan: null,
            };
            return { ...base, kind: event.kind ?? base.kind, started: true, startedAt: base.startedAt ?? now, at: now };
        }
        case "tool":
            return lane?.started ? { ...lane, steps: Math.min(MAX_COUNT, lane.steps + 1), at: now } : lane;
        case "plan":
            return lane?.started ? { ...lane, plan: event.counts, at: now } : lane;
    }
}
/** Remove lane files whose last event is a day old, spawns that never started among them. */
function pruneOld(cwd, sessionId, now) {
    const where = laneDir(cwd, sessionId);
    if (where === null)
        return;
    for (const name of readdirSync(where.dir)) {
        const match = /^lane-(.+)\.json$/u.exec(name);
        if (match?.[1] === undefined)
            continue;
        const lane = toLane(readRecordFile(join(where.dir, name)), match[1]);
        if (lane !== null && now - lane.at > 24 * 60 * 60 * 1000)
            rmSync(join(where.dir, name), { force: true });
    }
}
/** Read, apply one event and write back. Never throws. */
export function recordLaneEvent(cwd, sessionId, event, now = Date.now()) {
    try {
        if (event.type === "plan" && event.agentId === null) {
            writeJson(cwd, sessionId, "main.json", { version: 1, plan: event.counts, at: now });
            return;
        }
        const agentId = event.agentId;
        const file = agentId === null ? null : laneFile(agentId);
        if (agentId === null || file === null)
            return;
        const next = applyLaneEvent(readLane(cwd, sessionId, agentId), event, now);
        if (next === null) {
            const where = laneDir(cwd, sessionId);
            if (where !== null && plainDirs(cwd, where.rel))
                rmSync(join(where.dir, file), { force: true });
            return;
        }
        writeJson(cwd, sessionId, file, { version: 1, ...next });
        if (event.type === "started")
            pruneOld(cwd, sessionId, now);
    }
    catch {
        // The card shows the last good record; a hook never fails because of it.
    }
}
/** The lanes to draw: started, not stale, oldest first; a spawn that never started is not one. */
export function readLanes(cwd, sessionId, now = Date.now()) {
    try {
        const where = laneDir(cwd, sessionId);
        if (where === null || !plainDirs(cwd, where.rel))
            return [];
        const lanes = [];
        for (const name of readdirSync(where.dir)) {
            const match = /^lane-(.+)\.json$/u.exec(name);
            if (match?.[1] === undefined)
                continue;
            const lane = toLane(readRecordFile(join(where.dir, name)), match[1]);
            if (lane === null || !lane.started || now - lane.at > LANE_STALE_MS)
                continue;
            lanes.push(lane);
        }
        lanes.sort((a, b) => (a.startedAt ?? a.at) - (b.startedAt ?? b.at) || a.agentId.localeCompare(b.agentId));
        return lanes.slice(0, MAX_LANES);
    }
    catch {
        return [];
    }
}
/** The main thread's last `update_plan` counts, or null when it kept none. */
export function readMainPlan(cwd, sessionId) {
    try {
        const where = laneDir(cwd, sessionId);
        if (where === null || !plainDirs(cwd, where.rel))
            return null;
        const record = readRecordFile(join(where.dir, "main.json"));
        return isRecord(record) ? counts(record["plan"]) : null;
    }
    catch {
        return null;
    }
}
