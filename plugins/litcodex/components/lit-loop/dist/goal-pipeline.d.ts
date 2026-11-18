export declare const GOAL_DIR = ".litcodex/goal";
export declare const GOAL_MAX_CHARS = 500;
export declare const CONSENT_TTL_MS: number;
export declare const FALSIFY_TIMEOUT_MS = 120000;
/** Fixed status lines, one per outcome. The CLI and the hook print these and nothing else. */
export declare const GOAL_STATUS: Readonly<{
    asked: (condition: string) => string;
    askStart: "Approve plan and start work? (yes / no)";
    notStarted: (reason: string) => string;
    skipped: (reason: string) => string;
    set: (id: string) => string;
    yours: "Your own goal is active; LitCodex left it alone.";
    notConfirmed: (condition: string) => string;
    met: (id: string) => string;
    clearByUser: (id: string) => string;
}>;
export declare const conditionHash: (condition: string) => string;
/** Binds the answer to the plan it starts and the goal it sets, so an edited consent file arms nothing. */
export declare const consentHash: (plan: string, condition: string | null) => string;
export declare const goalId: (plan: string, check: string) => string;
export type Outcome<T> = ({
    readonly ok: true;
} & T) | {
    readonly ok: false;
    readonly reason: string;
};
/** The `## Done when` block: a `check: \`<command>\`` line, the first one wins. */
export declare function parseDoneWhen(planText: string): Outcome<{
    readonly check: string;
}>;
/** `Every row in .litcodex/plans/<f>.md is ticked and \`<cmd>\` exits 0 [lit:<id>]`, or why it cannot be built. */
export declare function compileCondition(plan: string, check: string): Outcome<{
    readonly condition: string;
    readonly id: string;
}>;
/** Rejects judgment words, an outward-only success, a command off the allowlist and conditions over the cap. */
export declare function lintCondition(condition: string, check: string): {
    readonly ok: boolean;
    readonly reasons: string[];
};
/** Plan rows as LitCodex plans write them: `- [ ] N. title` / `- [x] F1. title` at column zero. */
export declare function planRows(planText: string): {
    readonly total: number;
    readonly open: number;
};
export interface CheckResult {
    readonly status: number | null;
    readonly signal?: NodeJS.Signals | null;
    readonly error?: {
        readonly code?: string;
    } | undefined;
}
export type CheckRunner = (cmd: string, args: readonly string[], cwd: string, timeoutMs: number) => CheckResult;
/**
 * The dry run: the condition must be false right now, or the goal would be met at its first check. The
 * check runs once, time-boxed, with no shell, so an unrunnable or hanging command is caught before it is a goal.
 */
export declare function falsify(args: {
    readonly cwd: string;
    readonly plan: string;
    readonly planText: string;
    readonly check: string;
    readonly timeoutMs?: number;
    readonly run?: CheckRunner;
}): Outcome<{
    readonly open: number;
    readonly exit: number | null;
}>;
export interface GoalConsent {
    readonly version: 1;
    /** Null when no goal could be compiled: `yes` then starts the work alone. */
    readonly condition: string | null;
    readonly hash: string;
    readonly id: string;
    readonly plan: string;
    readonly askedAt: string;
}
/** `goal propose <plan>`: the one line to add to the approval question, and the consent it recorded. */
export declare function proposeGoal(args: {
    readonly cwd: string;
    readonly planArg: string | undefined;
    readonly now?: number;
    readonly timeoutMs?: number;
    readonly run?: CheckRunner;
}): {
    readonly line: string;
    readonly consent?: GoalConsent;
};
/** `yes`, `edit` and `no` (exactly, any case) answer the goal question; anything else is no answer. */
export declare function consentAnswer(prompt: string): "yes" | "edit" | "no" | null;
/** The consent the user is answering: fresh, and its hash still binds its condition. */
export declare function liveConsent(cwd: string, now: number): GoalConsent | null;
/** The goal LitCodex armed in this project, if any. */
export declare function ownedGoal(cwd: string): {
    readonly condition: string;
    readonly id: string;
} | null;
/** What an answer to the plan question does: the context for the model and, on a `yes` that starts, the start prompt. */
export interface PlanAnswer {
    readonly context: string;
    /** The ordinary `start-work <slug>` prompt the hook routes in place of `yes`; null when nothing starts. */
    readonly start: string | null;
}
/** Why the approved plan cannot start now, or null when it can. */
export type StartCheck = (cwd: string, plan: string, sessionId: string | null) => string | null;
/** The production start check: the plan is still open and no start-work run is under way in this project. */
export declare const defaultStartCheck: StartCheck;
/**
 * The answer to the plan question (R1), or null when no live question is open. An exact `yes` both starts the
 * plan's start-work run (the hook routes `start-work <slug>` exactly as if the user had typed it) and arms the
 * goal; when the run cannot start, the goal is not armed either. Every answer drops the consent.
 */
export declare function planAnswer(args: {
    readonly cwd: string;
    readonly prompt: string;
    readonly sessionId: string | null;
    readonly now: number;
    readonly startCheck?: StartCheck;
}): PlanAnswer | null;
/** `lit cancel` while LitCodex owns a goal: the clear line for the user, never a clear of the goal itself. */
export declare function goalCancelContext(cwd: string): string | null;
/** SessionStart sweep: an expired question is removed so a later bare `yes` arms nothing. */
export declare function sweepGoalState(cwd: string, now: number): void;
/** `cli.js goal propose <plan>`. */
export declare function goalCommand(argv: readonly string[], io: {
    readonly stdout: NodeJS.WritableStream;
    readonly stderr: NodeJS.WritableStream;
    readonly cwd?: string;
}): number;
