export type Bucket = "done" | "doing" | "waiting" | "todo";
export type BoardLang = "en" | "ko";
/** Ten cells on every bar. */
export declare const BAR_CELLS = 10;
export declare const DONE_SHOWN = 5;
export declare const REMAINING_SHOWN = 7;
export declare const REMINDERS_SHOWN = 5;
export declare const MILESTONES_SHOWN = 4;
/** A plan nobody touched for this long is named as stopped. */
export declare const STALE_MS: number;
/** One plan as the board reads it: its title, its rows in order, and when its file last changed. */
export interface BoardPlanInput {
    readonly title: string;
    readonly file: string;
    readonly rows: readonly {
        readonly done: boolean;
        readonly label: string;
    }[];
    readonly changedMs: number | null;
}
/** What the board needs from one worktree. */
export interface BoardTreeInput {
    /** The worktree folder's name; shown, never its full path. */
    readonly name: string;
    /** Plans changed inside the window, open or finished. */
    readonly plans: readonly BoardPlanInput[];
    /** Open plans whose file has not changed for `STALE_MS` or longer. */
    readonly stale: readonly {
        readonly title: string;
        readonly changedMs: number;
    }[];
    /** The plan file of the start-work run under way here, and its state. */
    readonly work: {
        readonly file: string;
        readonly paused: boolean;
        readonly parked: number;
    } | null;
    /** Steps the start-work run here parked; the run keeps going, and `lit approve` is optional. */
    readonly parked: number;
    readonly goals: {
        readonly done: number;
        readonly total: number;
    } | null;
    /** Changed or untracked files (`git status`); null when git could not say. */
    readonly uncommitted: number | null;
    /** Commits ahead of the upstream branch; null when there is no upstream or git could not say. */
    readonly unpushed: number | null;
    readonly handoffNext: string | null;
}
/** The step to take now, as data; `renderBoard` writes it in words. */
export type BoardNow = {
    readonly kind: "resume";
    readonly skill: string;
    readonly stage: string | null;
} | {
    readonly kind: "approve";
    readonly place: string;
} | {
    readonly kind: "continue";
    readonly title: string;
    readonly done: number | null;
    readonly total: number | null;
} | {
    readonly kind: "start";
    readonly title: string;
    readonly done: number;
    readonly total: number;
} | {
    readonly kind: "elsewhere";
} | {
    readonly kind: "answer-lane";
    readonly place: string;
    readonly more: number;
} | {
    readonly kind: "wait-lanes";
    readonly place: string;
    readonly count: number;
} | {
    readonly kind: "handoff";
    readonly item: string;
} | {
    readonly kind: "answer";
    readonly place: string;
    readonly question: string | null;
} | {
    readonly kind: "review";
    readonly place: string;
    readonly title: string;
} | {
    readonly kind: "resume-other";
    readonly label: string;
    readonly place: string;
} | {
    readonly kind: "plan-item";
    readonly title: string;
    readonly item: string;
} | {
    readonly kind: "check";
    readonly place: string;
    readonly title: string;
} | {
    readonly kind: "pick-up";
    readonly place: string;
    readonly title: string;
} | {
    readonly kind: "nothing";
};
/** One reminder, as data: a fact the records show and what to do about it. */
export type BoardReminder = {
    readonly kind: "waiting";
    readonly place: string;
    readonly question: string | null;
} | {
    readonly kind: "parked";
    readonly place: string;
    readonly count: number;
} | {
    readonly kind: "uncommitted";
    readonly place: string;
    readonly count: number;
} | {
    readonly kind: "unpushed";
    readonly place: string;
    readonly count: number;
} | {
    readonly kind: "lanes";
    readonly count: number;
} | {
    readonly kind: "stale";
    readonly title: string;
    readonly days: number;
} | {
    readonly kind: "handoff";
    readonly item: string;
};
export interface BoardMilestone {
    readonly title: string;
    readonly state: Bucket;
    readonly done: number;
    readonly total: number;
    readonly bar: string;
    readonly lastMs: number | null;
}
export interface BoardCounts {
    readonly done: number;
    readonly doing: number;
    readonly waiting: number;
    readonly todo: number;
    readonly total: number;
    /** Whole percent of `total` that is done; 0 when nothing is tracked. */
    readonly percent: number;
    readonly bar: string;
}
export interface RewindBoard {
    readonly at: number;
    readonly now: BoardNow;
    /** How the person takes the step: type a word, wait for a lane, or do something by hand. */
    readonly take: "go" | "approve" | "wait" | "do";
    readonly counts: BoardCounts;
    readonly milestones: readonly BoardMilestone[];
    readonly doneLately: readonly string[];
    readonly remaining: readonly string[];
    /** Remaining rows past the ones listed. */
    readonly remainingMore: number;
    readonly reminders: readonly BoardReminder[];
    /** Sources that could not be read, named once under the board. */
    readonly unknown: readonly string[];
}
export interface BoardInput {
    readonly now: number;
    readonly step: BoardNow;
    /** Trees in order, the asking folder's first. */
    readonly trees: readonly BoardTreeInput[];
    /** Places of sessions that wait on the person, newest first, with their last question when there is one. */
    readonly waiting: readonly {
        readonly place: string;
        readonly question: string | null;
    }[];
    /** Other lanes still at work, not counting the ones that wait on the person. */
    readonly working: number;
    readonly unknown: readonly string[];
}
/** Ten cells of `█` and `░`; a partly done total never draws as full or as empty. */
export declare function boardBar(done: number, total: number): string;
export declare function boardPercent(done: number, total: number): number;
export declare function buildBoard(input: BoardInput): RewindBoard;
/**
 * The board as Markdown the Codex terminal draws: bold section lines (it prints `#` heading marks literally),
 * emoji, two tables and lists. Fixed order: do this now, at a glance, milestones, done lately, still to do,
 * don't forget. About forty lines at most; every empty section says so in one line.
 */
export declare function renderBoard(board: RewindBoard, lang?: BoardLang): string;
