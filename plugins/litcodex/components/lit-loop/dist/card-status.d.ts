import { type LaneState } from "./card-looks.js";
import { type ThreadView } from "./threads.js";
import { type WorkflowMap } from "./workflow-map.js";
export interface CardStatus {
    readonly version: 1;
    /** The normalized thread id, so the card can name its thread when the host does not. */
    readonly thread: string | null;
    readonly state: "ready" | "ignited" | "complete";
    readonly mode: string | null;
    /** The card's look: "rewind", "review", "turn" (waiting on the user), "done" (just finished), or null. */
    readonly look: string | null;
    readonly ignitedAt: number | null;
    readonly map: WorkflowMap | null;
    readonly step: {
        readonly tool: string;
        readonly startedAt: number;
    } | null;
    readonly lastStepAt: number | null;
    /** The tool that finished last in this turn, named the way the step is. */
    readonly lastTool: string | null;
    /** When the current turn began, so the card can count the turn's time while no tool runs. */
    readonly turnStartedAt: number | null;
    /** When the current turn ended, so a finished turn shows its own length. */
    readonly turnEndedAt: number | null;
    readonly working: boolean;
    /** Percent of the context window and of each quota window in use, from the thread's last token count. */
    readonly usage: Usage | null;
    /** Work paused under a side discipline, or null while the thread has a single line of work. */
    readonly stack?: CardStack | null;
    /** Frames, child agents and other live sessions as rows; null while the stack row says all there is to say. */
    readonly threads?: ThreadView | null;
    /** The five review-work lane states, in border-draw order; null when the mode is not review-work. */
    readonly reviewLanes?: readonly LaneState[] | null;
    /** The workspace's checked-out branch, or a short commit when detached. */
    readonly branch: string | null;
    /** Folder name of the workspace only; the full path stays out of the card. */
    readonly workspace: string | null;
    /** When the newest card of this thread opened; an older card that sees a later time folds itself. */
    readonly cardOpenedAt: number | null;
    readonly now: number;
}
/**
 * One frame of the session's workflow stack as the card names it: the skill and its stage, and a gauge only when
 * both counts are real. A frame without a total carries a short `note` in words instead (`step 2`, or empty).
 */
export interface CardFrame {
    readonly name: string;
    readonly stage: string | null;
    readonly gauge: string | null;
    readonly note: string;
}
/** A side discipline running over paused work: what is paused, what runs, and the way back. */
export interface CardStack {
    readonly breadcrumb: string;
    readonly row: string;
    readonly paused: readonly CardFrame[];
    readonly running: CardFrame;
}
export interface Usage {
    readonly ctx: number | null;
    readonly fiveHour: number | null;
    readonly week: number | null;
}
/** The workspace a thread runs in: the hook pointer, else (when `rollout` allows) the rollout header; null when unknown. */
export declare function resolveThreadCwd(threadId: string | null, env: NodeJS.ProcessEnv, rollout?: boolean): string | null;
/** Context and quota use from the newest token count in a rollout tail; null when there is none. */
export declare function usageFromRollout(text: string): Usage | null;
/** A tool name as the card shows it: an MCP tool reads `server · tool` rather than its joined id. */
export declare function toolDisplayName(tool: string): string;
/** The card for one thread. `rollout: false` keeps every Codex rollout file unread; the usage row then stays empty. */
export declare function readCardStatus(threadId: string | null, env: NodeJS.ProcessEnv, now?: number, options?: {
    readonly rollout?: boolean;
}): CardStatus;
/** Minutes and seconds, `m:ss`. */
export declare function clock(ms: number): string;
/** The card as plain text, for hosts that cannot draw it (the terminal `codex`). */
export declare function cardStatusText(status: CardStatus): string;
