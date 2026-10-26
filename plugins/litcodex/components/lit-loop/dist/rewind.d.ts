export declare const ADHD_DIR = ".litcodex/adhd";
/** A session written to in the last quarter hour is still running. */
export declare const ACTIVE_MS: number;
/** How long a briefed next step stays runnable by `go`. */
export declare const GO_WINDOW_MS: number;
export declare const DEFAULT_SINCE_MS: number;
export declare const DEFAULT_MAX = 12;
export type SessionStatus = "waiting-on-user" | "active" | "ended" | "unknown";
export type NextKind = "resume-frame" | "approve-boundary" | "continue-work" | "start-plan" | "none";
export interface NextStep {
    readonly kind: NextKind;
    readonly text: string;
    readonly skill?: string;
    readonly stage?: string | null;
    readonly n?: number;
    readonly total?: number;
    readonly plan?: string;
}
export interface RewindSession {
    readonly id: string;
    readonly shortId: string;
    readonly current: boolean;
    readonly cwd: string | null;
    readonly status: SessionStatus;
    readonly lastAt: number | null;
    /** The worktree folder this session runs in (redacted), so the brief can group by it. */
    readonly tree: string | null;
    /** The session's own stage gauge from its workflow stack; null unless both counts are real. */
    readonly gauge: string | null;
    /** What is known when there is no gauge, in words: `12 steps · 4m · last: apply_patch`. */
    readonly facts: string;
    readonly title: string | null;
    readonly lastUser: string | null;
    readonly lastAgent: string | null;
    /** What the session last reported, in plain words, for the card's "done" line. */
    readonly done: string | null;
    /** What this session needs from the person, in plain words, for the card's "next" line. */
    readonly needs: string;
    /** The tools it used most, most used first (at most three); names only, never counted. */
    readonly tools: readonly string[];
    /** Files `apply_patch` touched in the part of the record that was read (a floor when the record was cut). */
    readonly edited: number;
    /** What its last tool call was about, as `apply_patch “card.ts”`; a program or file base name, never a command line. */
    readonly doing: string | null;
}
/** One line of a worktree's timeline: finished (with its date), under way now, or still ahead. */
export interface RewindMilestone {
    readonly state: "done" | "now" | "later";
    readonly label: string;
    readonly date: string | null;
}
export interface RewindWorktree {
    readonly path: string;
    readonly branch: string | null;
    readonly lastCommit: string | null;
    /** The worktree's roadmap gauge: its start-work plan, else its lit-loop goals, else null. */
    readonly gauge: string | null;
    readonly work: {
        readonly status: string;
        readonly done: number;
        readonly total: number;
        readonly gauge: string | null;
    } | null;
    readonly goals: {
        readonly done: number;
        readonly total: number;
        readonly gauge: string | null;
    } | null;
    readonly openPlans: readonly OpenPlan[];
    /** Recent commits (done, dated), the step under way, and the next open plan rows. */
    readonly milestones: readonly RewindMilestone[];
    readonly paused: readonly {
        readonly session: string;
        readonly label: string;
    }[];
    readonly handoff: string | null;
}
export type SourceState = "ok" | "unknown";
export interface RewindResult {
    readonly generatedAt: string;
    readonly codexHome: string | null;
    readonly sessions: readonly RewindSession[];
    readonly worktrees: readonly RewindWorktree[];
    readonly next: NextStep;
    /**
     * A step to recommend when `next.kind` is `none`, chosen from the records: a session that waits on the user, a
     * paused workflow, an open plan item, the latest active session, the latest ended one. Shown, never recorded.
     */
    readonly suggestion: string;
    /** The window read, so the brief can say how far back it looked. */
    readonly scope: {
        readonly sinceMs: number;
        readonly worktrees: number;
    };
    readonly sources: {
        readonly sessions: SourceState;
        readonly git: SourceState;
        readonly state: SourceState;
    };
    readonly budget: {
        readonly limit: number;
        readonly used: number;
        readonly exhausted: boolean;
    };
}
/** Runs git in a folder and returns its stdout, or null when it fails. Injectable for tests. */
export type GitRunner = (cwd: string, args: readonly string[]) => string | null;
export declare const runGit: GitRunner;
export interface RewindOptions {
    readonly env: NodeJS.ProcessEnv;
    readonly cwd: string;
    readonly here?: boolean;
    readonly sinceMs?: number;
    readonly max?: number;
    /** The session asking; its next-step note is written for `go`. */
    readonly sessionId?: string | null;
    readonly now?: number;
    readonly git?: GitRunner;
    /** Overrides the Codex home (a test seam; the command reads `CODEX_HOME` or `~/.codex`). */
    readonly codexHome?: string | null;
    /** Overrides the whole-run read allowance in bytes (a test seam). */
    readonly budgetBytes?: number;
}
/** `7d`, `36h`, `90m` as milliseconds; null for anything else. */
export declare function parseSince(text: string): number | null;
/** UUIDv7 ids open with a timestamp, so sessions started minutes apart share the first 8 characters; use the random tail then. */
export declare function shortIdOf(id: string): string;
interface OpenPlan {
    readonly name: string;
    readonly done: number;
    readonly total: number;
    readonly gauge: string | null;
    /** When the plan file last changed; null when that cannot be read. */
    readonly changedMs: number | null;
}
/**
 * The one step worth taking next, in priority order: the paused frame of this session's stack, then a boundary
 * waiting for an answer (shown, never started), then work already under way, then the single open plan.
 */
export declare function chooseNext(cwd: string, sessionId: string | null): NextStep;
/** Save the briefed step for `go`, or remove a stale one when there is nothing to run. Never throws. */
export declare function writeNext(cwd: string, sessionId: string, next: NextStep, now: number): void;
export declare function collectRewind(options: RewindOptions): RewindResult;
/**
 * The step to recommend when nothing can run on `go`, so the brief never ends on "nothing". In order: a session
 * that waits on the user, a paused workflow, the open plan item of a worktree where a session is live, any
 * open plan item, the latest other active session, the latest other ended one. It is shown, never recorded.
 */
export declare function suggestionOf(sessions: readonly RewindSession[], worktrees: readonly RewindWorktree[]): string;
/** The one-line headline: how many sessions, what waits on the person, and the one next step. */
export declare function briefHeadline(result: RewindResult): string;
/** Ended sessions, one table row each, newest first: they are history, so no card. One line per row at 120 columns. */
export declare function endedTable(sessions: readonly RewindSession[], now: number, width?: number): string[];
/**
 * The brief as Markdown limited to what the Codex terminal draws: bold, emoji, lists, a table and a fenced box.
 * Never `#` headings or `>` quotes, which it prints as raw marks. A headline, live session cards (waiting or
 * running) grouped by worktree with each worktree's roadmap (done ✓ with its date, now ▶, later ○), one table
 * row for every ended session, and the one recommended next step in a box. A progress gauge appears only when
 * both counts are real; otherwise the known facts are written out in words.
 */
export declare function renderBrief(result: RewindResult, width?: number): string;
export {};
