import { type LaneCounts, type LaneEvent } from "./lane-state.js";
export interface LaneScope {
    readonly sessionId: string;
    readonly cwd: string;
}
/** The session and workspace a payload names; null unless both are present and the workspace is absolute. */
export declare function laneScope(parsed: unknown): LaneScope | null;
/** The lane event a `SubagentStart` or `SubagentStop` payload carries, or null. */
export declare function subagentEvent(parsed: unknown, kind: "start" | "stop"): LaneEvent | null;
/** Done and total of an `update_plan` list (`plan: [{ step, status }]`); null for an empty or odd one. */
export declare function planCounts(toolInput: unknown): LaneCounts | null;
/** The lane events one `PostToolUse` payload carries: a spawn's name, an `update_plan` count, a child's step. */
export declare function toolLaneEvents(parsed: unknown): LaneEvent[];
