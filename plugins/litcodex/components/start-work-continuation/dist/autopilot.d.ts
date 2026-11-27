import { type AutopilotFile, type ParkedStep, type Snapshot, type WorkAutopilot } from "./autopilot-store.js";
import { type CanonicalPlan, type WorkStateEntry } from "./lifecycle-store.js";
import { type PlanFacts } from "./plan-rows.js";
import { type ShellContext } from "./shell-tier.js";
/** hooks.json gives the start-work Stop hook 60 s; the Done-when check gets 50 s of it. */
export declare const CHECK_CAP_MS = 50000;
/** hooks.json gives the start-work UserPromptSubmit hook 60 s; a replay gets 50 s of it at most. */
export declare const REPLAY_BUDGET_MS = 50000;
export declare const INBOX_SHOWN = 8;
/** The longest command the guard stores in the parked list. */
export declare const MAX_PARKED_COMMAND = 4096;
/**
 * Size ceilings for what the hooks hand Codex. The rules component already caps hook context at 32 000 characters;
 * the inbox stays under 12 000 and a replay answer, redrawn inbox included, under 16 000.
 */
export declare const INBOX_MAX_CHARS = 12000;
export declare const ANSWER_MAX_CHARS = 16000;
export interface RunView {
    readonly root: string;
    readonly sessionId: string;
    readonly work: WorkStateEntry;
    readonly plan: CanonicalPlan;
    readonly facts: PlanFacts;
    readonly project: string;
    readonly roots: readonly string[];
}
export interface AutopilotOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: () => number;
}
/** This session's active run with its plan read fresh, or null. Never throws. */
export declare function loadRun(cwd: string, sessionId: string, statuses?: readonly ("active" | "paused")[]): RunView | null;
/** The shell context the guard and the replay check a command against. */
export declare function shellContextFor(run: RunView, cwd: string, file: AutopilotFile, env: NodeJS.ProcessEnv): ShellContext;
/** PreToolUse for a shell call inside an active run: null to let it run, or the deny text (and the user's ping). */
export declare function guardShellCall(run: RunView, command: string, cwd: string, options?: AutopilotOptions): {
    readonly reason: string;
    readonly ping: string | null;
} | null;
export type StopDecision = "continue" | "wrap-up" | "done" | "impossible" | "silent";
export interface StopResult {
    readonly decision: StopDecision;
    /** Exact hook stdout: a block, a user-facing message, or "". */
    readonly stdout: string;
}
export interface StopEvent {
    readonly sessionId: string;
    readonly turnId: string;
    readonly cwd: string;
    readonly reentry: boolean;
}
/**
 * Decide what one turn-end does for this session's run. Runs on the re-entry turn-end too (Codex 0.172 honours a
 * block while `stop_hook_active` is true), so a row ticked during a continuation can close the run right there.
 * At most two blocks per plan state, then one inbox, then silence.
 */
export declare function driveStop(run: RunView, event: StopEvent, directive: () => string, options?: AutopilotOptions): StopResult;
/** The native goal's objective: it always ends itself. */
export declare function nativeGoalObjective(run: Pick<RunView, "work">): string;
export declare function inboxText(run: RunView, file: AutopilotFile, stuck?: readonly string[], snapshot?: Snapshot | null): string;
export type RunWord = {
    readonly kind: "approve";
} | {
    readonly kind: "approve-x";
} | {
    readonly kind: "approve-x-inexact";
} | {
    readonly kind: "deny";
} | {
    readonly kind: "cancel";
} | {
    readonly kind: "skip-row";
    readonly row: string | null;
} | {
    readonly kind: "pause";
} | {
    readonly kind: "resume";
};
/** The whole typed prompt as a run answer, or null. Only a typed prompt event may carry one. */
export declare function parseRunWord(prompt: string): RunWord | null;
export interface ReplayReport {
    readonly ran: readonly {
        readonly step: ParkedStep;
        readonly ok: boolean;
        readonly tail: string;
        readonly note: string;
    }[];
    readonly skipped: readonly {
        readonly step: ParkedStep;
        readonly reason: string;
    }[];
    readonly drew: boolean;
    /** The stored list no longer matched the digest the hook sealed when it showed it; nothing ran. */
    readonly tampered: boolean;
}
/**
 * Replay the snapshot's steps of one tier, in order, each in its stored folder, within the budget. Each step is
 * checked again first (protected paths, its tier, its folder); a held, changed or moved step stays parked. The
 * first failure stops the rest. Afterwards the list is drawn again and becomes the next snapshot.
 */
export declare function replaySnapshot(run: RunView, tier: "B" | "X", options?: AutopilotOptions): ReplayReport;
/** `lit deny`: drop every parked step and refuse those exact commands for the rest of the run. */
export declare function denySteps(run: RunView): readonly ParkedStep[];
/** `lit skip-row [N]`: tick BLOCKED/IMPOSSIBLE rows as skipped and drop the steps parked under them only. */
export declare function skipRowsOf(run: RunView, only: string | null): {
    readonly ids: readonly string[];
    readonly dropped: number;
};
export declare function setPaused(run: RunView, paused: boolean): void;
/**
 * Remember that the user typed start-work, for the one plan it selects: the plan the prompt names, else this
 * session's run, else the only plan in `.litcodex/plans/`. It binds that plan's `Run charter:` lines and its Done-when
 * line as they stand; a charter added later is not consented. Returns the consented plan and its charters (shown to
 * the user), or null when no single plan was selected, in which case nothing is consented.
 */
export declare function recordStartConsent(root: string, sessionId: string, at: string, selector?: string | null): {
    readonly plan: string;
    readonly charters: readonly {
        branch: string;
        repo: string;
    }[];
} | null;
/** One program from the allowlist with plain arguments, or null. No shell ever runs a check. */
export declare function checkArgv(command: string): string[] | null;
/** What counts as progress: row ticks and notes, parked steps, parked path boundaries and stuck lanes. */
export declare function planState(facts: PlanFacts, work: WorkAutopilot, stuck: readonly string[], boundaries?: readonly string[]): string;
/** A code span long enough for any backticks inside, with control characters written as escapes. */
export declare function codeSpan(command: string): string;
