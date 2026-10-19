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
/** One row of the card's checklist: a plan task or a lit-loop goal. */
export interface ChecklistRow {
    readonly state: "done" | "current" | "pending";
    readonly label: string;
}
/** The checklist under the map: the start-work plan rows, else this session's lit-loop goals; [] when neither. */
export declare function readChecklist(repoRoot: string, sessionId: string | null): ChecklistRow[];
export declare function readWorkflowSignals(repoRoot: string, sessionId: string | null, now?: number): WorkflowSignals;
/** One stage of the map, as the text line and the LIT card both draw it. */
export interface MapCell {
    readonly key: string;
    readonly icon: string;
    /** Lowercase stage word for the card. */
    readonly word: string;
    /** `done` ✓, `current` (named in capitals), `partial` (an earlier stage with an open bar) or `pending` ·. */
    readonly state: "done" | "current" | "partial" | "pending";
    /** What the current stage says in capitals; for a done research wave stage, how many waves ran. */
    readonly label: string | null;
    readonly progress: {
        readonly done: number;
        readonly total: number;
    } | null;
}
export interface WorkflowMap {
    readonly family: "main" | "research";
    readonly cells: readonly MapCell[];
    /** The next open task or goal title, cut the way the Stop line cuts it. */
    readonly next: string | null;
}
/** The map as stages, or null when there is nothing true to draw. */
export declare function workflowMapCells(mode: string | null, signals: WorkflowSignals): WorkflowMap | null;
/** One map line, or null when there is nothing true to draw. Plain text: emoji and block cells only. */
export declare function renderWorkflowMap(mode: string | null, signals: WorkflowSignals): string | null;
/** The text line for a map already built. */
export declare function workflowMapText(map: WorkflowMap): string;
export declare function workflowMapLine(repoRoot: string, sessionId: string | null, mode: string | null): string | null;
/** Remember that this turn is a LIT activation and where its progress started. Never throws. */
export declare function recordWorkflowTurn(repoRoot: string, sessionId: string, turnId: string, mode: string, now?: number): void;
/** The LIT activation this session last recorded: its skill and when it started; null when none. */
export declare function workflowTurn(repoRoot: string, sessionId: string): {
    mode: string;
    startedAt: number;
} | null;
/**
 * The Stop line for a LIT turn, or null when this turn was not a LIT activation. At a start-work
 * checkpoint the continuation hook keeps the turn going, so the line says so instead of "turn done".
 * No commands or paths.
 */
export declare function workflowStopLine(repoRoot: string, sessionId: string, turnId: string, stop?: StopContext): string | null;
export {};
