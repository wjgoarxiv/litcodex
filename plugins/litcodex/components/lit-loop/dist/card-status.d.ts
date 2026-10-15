import { type WorkflowMap } from "./workflow-map.js";
export interface CardStatus {
    readonly version: 1;
    /** The normalized thread id, so the card can name its thread when the host does not. */
    readonly thread: string | null;
    readonly state: "ready" | "ignited" | "complete";
    readonly mode: string | null;
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
    /** The workspace's checked-out branch, or a short commit when detached. */
    readonly branch: string | null;
    /** Folder name of the workspace only; the full path stays out of the card. */
    readonly workspace: string | null;
    readonly now: number;
}
export interface Usage {
    readonly ctx: number | null;
    readonly fiveHour: number | null;
    readonly week: number | null;
}
/** The workspace a thread runs in: the hook pointer, else the rollout header; null when unknown. */
export declare function resolveThreadCwd(threadId: string | null, env: NodeJS.ProcessEnv): string | null;
/** Context and quota use from the newest token count in a rollout tail; null when there is none. */
export declare function usageFromRollout(text: string): Usage | null;
/** A tool name as the card shows it: an MCP tool reads `server · tool` rather than its joined id. */
export declare function toolDisplayName(tool: string): string;
export declare function readCardStatus(threadId: string | null, env: NodeJS.ProcessEnv, now?: number): CardStatus;
/** The card as plain text, for hosts that cannot draw it (the terminal `codex`). */
export declare function cardStatusText(status: CardStatus): string;
