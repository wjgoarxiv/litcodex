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
    /** False leaves the next task out of the line: the card under it names it, or it belongs to other work. */
    readonly next?: boolean;
}
/**
 * Checkbox rows the way start-work counts them: fenced blocks are skipped, and when the plan has a
 * `## Todos` or `## Final verification wave` section only rows inside those sections count.
 */
export declare function countPlanRows(markdown: string): Progress;
/** Done and total checkbox rows of a project-relative plan file; null when it cannot be read or holds none. */
export declare function planProgress(repoRoot: string, rel: string): {
    readonly done: number;
    readonly total: number;
} | null;
/** The counted checkbox rows in order, as start-work reads them. */
export declare function planRows(markdown: string): {
    readonly done: boolean;
    readonly label: string;
}[];
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
export declare function mapCellText(item: MapCell): string;
/** A stage in small words: its own word, and what its label adds (`work paused`, `wave 2 expand`, `2 waves`). */
export declare function stageName(item: MapCell): string;
/** What stands between two stages of the map line. */
export declare const MAP_JOIN = " \u2500\u2500 ";
/** One map line, or null when there is nothing true to draw. Plain text: words and round marks only. */
export declare function renderWorkflowMap(mode: string | null, signals: WorkflowSignals): string | null;
/** The text line for a map already built. */
export declare function workflowMapText(map: WorkflowMap): string;
export declare function workflowMapLine(repoRoot: string, sessionId: string | null, mode: string | null): string | null;
/** Remember that this turn is a LIT activation and where its progress started. Never throws. */
export declare function recordWorkflowTurn(repoRoot: string, sessionId: string, turnId: string, mode: string, now?: number): void;
/** Remember what a card of this turn shows; true when the card before it already showed the same. Never throws. */
export declare function rememberShown(repoRoot: string, sessionId: string, content: string): boolean;
/** The LIT activation this session last recorded: its skill and when it started; null when none. */
export declare function workflowTurn(repoRoot: string, sessionId: string): {
    mode: string;
    startedAt: number;
} | null;
/**
 * The plan start-work will carry on with after this Stop, or null when its continuation hook stays
 * quiet. It repeats that hook's decision read-only (host continuation flag, transcript, the one active
 * work this session owns with authority and open rows, and the lease that nudges each plan state once
 * per turn), so the answer is the same whichever Stop hook the host runs first.
 */
export declare function continuingWork(repoRoot: string, sessionId: string, turnId: string, stop: StopContext): Progress | null;
/** The Stop line of a turn that start-work keeps running starts with this mark; it is not the end of the run. */
export declare const CONTINUING_MARK = "\u23F3";
/**
 * The Stop line for a LIT turn, or null when this turn was not a LIT activation. At a start-work
 * checkpoint the continuation hook keeps the turn going, so the line says so instead of "turn done".
 * No commands or paths.
 */
export declare function workflowStopLine(repoRoot: string, sessionId: string, turnId: string, stop?: StopContext): string | null;
export {};
