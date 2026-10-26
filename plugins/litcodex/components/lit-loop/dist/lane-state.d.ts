export declare const LANE_DIR = ".litcodex/lane-state";
export declare const MAX_LANES = 12;
/** A lane nobody touched for this long lost its stop event (a killed child); it is no longer shown. */
export declare const LANE_STALE_MS: number;
/** A lane quiet for this long reads `idle` instead of `running`. */
export declare const LANE_IDLE_MS: number;
export interface LaneCounts {
    readonly done: number;
    readonly total: number;
}
export interface LaneRecord {
    readonly agentId: string;
    readonly name: string | null;
    readonly kind: string | null;
    readonly started: boolean;
    readonly startedAt: number | null;
    readonly at: number;
    readonly steps: number;
    readonly plan: LaneCounts | null;
}
export type LaneEvent = {
    readonly type: "spawned";
    readonly agentId: string;
    readonly name: string | null;
} | {
    readonly type: "started";
    readonly agentId: string;
    readonly kind: string | null;
} | {
    readonly type: "stopped";
    readonly agentId: string;
} | {
    readonly type: "tool";
    readonly agentId: string;
} | {
    readonly type: "plan";
    readonly agentId: string | null;
    readonly counts: LaneCounts;
};
/** A display name that is plain letters, digits, spaces and `._-`, at most 24 characters; else null. */
export declare function laneName(value: unknown): string | null;
/** An agent type such as `default` or `explorer`; anything else is not shown. */
export declare function laneKind(value: unknown): string | null;
/**
 * Apply one event to a lane record and return the next one, or null when the lane is gone. Pure.
 * `started` and `spawned` open a record; `tool` and `plan` only update a record whose child already
 * started, so a stray event never draws a lane that has no end.
 */
export declare function applyLaneEvent(lane: LaneRecord | null, event: LaneEvent, now: number): LaneRecord | null;
/** Read, apply one event and write back. Never throws. */
export declare function recordLaneEvent(cwd: string, sessionId: string, event: LaneEvent, now?: number): void;
/** The lanes to draw: started, not stale, oldest first; a spawn that never started is not one. */
export declare function readLanes(cwd: string, sessionId: string, now?: number): LaneRecord[];
/** The main thread's last `update_plan` counts, or null when it kept none. */
export declare function readMainPlan(cwd: string, sessionId: string): LaneCounts | null;
