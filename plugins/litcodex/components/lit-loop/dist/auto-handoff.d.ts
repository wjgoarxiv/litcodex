export declare const HANDOFF_MARKER_LABEL = "Auto-handoff session:";
export declare const SAVED_LINE_RUN_COMPACT = "Handoff saved. Run /compact now.";
export declare const SAVED_LINE_HOST_COMPACTS = "Handoff saved. Codex compacts the conversation next.";
export declare const RELOAD_EXCERPT_CHARS = 3000;
declare const STATE_VERSION = 1;
export type AutoHandoffPhase = "idle" | "fired" | "compacted" | "reloaded";
export interface AutoHandoffSession {
    readonly version: typeof STATE_VERSION;
    readonly sessionId: string;
    readonly phase: AutoHandoffPhase;
    readonly firedAt: number | null;
    readonly firedPercent: number | null;
    readonly lastPercent: number | null;
}
export interface ContextReading {
    readonly percent: number;
    readonly tokens: number;
    readonly window: number;
}
/**
 * Context used by the last model request, as a percent of the window Codex reports for the session.
 * Codex's own post-turn compaction compares the same two numbers, so the hook and the host cross the
 * threshold together. Null when the transcript has no usage yet.
 */
export declare function readContextPercent(transcriptPath: string | null | undefined): ContextReading | null;
export interface AutoHandoffStopInput {
    readonly repoRoot: string;
    readonly sessionId: string;
    readonly transcriptPath: string | null | undefined;
    readonly stopHookActive: boolean;
    readonly env: NodeJS.ProcessEnv;
    readonly now?: number;
}
export type AutoHandoffStopDecision = {
    readonly decision: "pass";
} | {
    readonly decision: "block";
    readonly reason: string;
};
export declare function buildHandoffInstruction(sessionId: string, percent: number, threshold: number, hostCompacts: boolean): string;
/**
 * Decide the Stop for one turn. Fires at most once per crossing: the record moves to "fired" before the
 * instruction is returned, `stop_hook_active` never fires again, and the record is re-armed only after
 * the context has been seen back under the percent.
 */
export declare function evaluateAutoHandoffStop(input: AutoHandoffStopInput): AutoHandoffStopDecision;
/** Mark a fired session as compacted. Sessions that never fired are left alone. */
export declare function recordCompaction(repoRoot: string, sessionId: string): void;
interface FreshHandoff {
    readonly path: string;
    readonly mtimeMs: number;
    readonly text: string;
}
/** The newest HANDOFF file written after `since` that names `sessionId`; everything else is ignored. */
export declare function findFreshHandoff(repoRoot: string, sessionId: string, since: number): FreshHandoff | null;
/**
 * The reload text for a session that fired and then compacted, or null when there is nothing to bring
 * back. `allowFired` lets SessionStart (source "compact") reload even when PostCompact has not run yet.
 * The record moves to "reloaded" first, so the excerpt is injected once.
 */
export declare function takeReloadContext(repoRoot: string, sessionId: string, env: NodeJS.ProcessEnv, allowFired: boolean): string | null;
/** Mirror of the rendered state for the doctor: what this session's record says. */
export declare function readSessionPhase(repoRoot: string, sessionId: string): AutoHandoffPhase | null;
export {};
