interface Progress {
    readonly done: number;
    readonly total: number;
    readonly next: string | null;
}
/** Where an unfinished research journal stands: the highest wave written and whether verification began. */
interface ResearchProgress {
    readonly wave: number | null;
    readonly verifying: boolean;
}
export interface WorkflowSignals {
    readonly work: (Progress & {
        readonly status: "active" | "paused" | "completed";
    }) | null;
    readonly goals: Progress | null;
    readonly plan: "drafting" | "published" | null;
    readonly research: ResearchProgress | null;
}
/** What the Stop event says about the host's own continuation state. */
export interface StopContext {
    readonly stopHookActive: boolean;
    readonly transcriptPath: string | null;
}
/**
 * Checkbox rows the way start-work counts them: fenced blocks are skipped, and when the plan has a
 * `## Todos` or `## Final verification wave` section only rows inside those sections count.
 */
export declare function countPlanRows(markdown: string): Progress;
/** One cell per task, at most ten; a partly done plan never draws as full or empty. */
export declare function progressBar(done: number, total: number): string;
/**
 * A task title without its row number, cut at the first code span, path, variable or flag and marked
 * with `…`. Deleting those words mid-sentence reads oddly, so the title stops there instead; a title
 * with fewer than three words left before the cut is dropped.
 */
export declare function safeTitle(label: string): string | null;
export declare function readWorkflowSignals(repoRoot: string, sessionId: string | null, now?: number): WorkflowSignals;
/** One map line, or null when there is nothing true to draw. Plain text: emoji and block cells only. */
export declare function renderWorkflowMap(mode: string | null, signals: WorkflowSignals): string | null;
export declare function workflowMapLine(repoRoot: string, sessionId: string | null, mode: string | null): string | null;
/** Remember that this turn is a LIT activation and where its progress started. Never throws. */
export declare function recordWorkflowTurn(repoRoot: string, sessionId: string, turnId: string, mode: string, now?: number): void;
/**
 * The Stop line for a LIT turn, or null when this turn was not a LIT activation. At a start-work
 * checkpoint the continuation hook keeps the turn going, so the line says so instead of "turn done".
 * No commands or paths.
 */
export declare function workflowStopLine(repoRoot: string, sessionId: string, turnId: string, stop?: StopContext): string | null;
export {};
