export declare const MOTION_MAX_BLOCKS = 2;
export interface MotionRun {
    readonly mode: string;
    readonly out: string | null;
    readonly round: number | null;
    readonly stillsOnly: boolean;
    readonly exitCode: number | null;
    readonly at: number;
}
export interface MotionTurn {
    readonly sessionId: string;
    readonly promptAt: number;
    readonly runs: readonly MotionRun[];
    readonly blockCount: number;
    readonly warned: boolean;
    readonly notified: boolean;
}
/** What the film skill's done-check returns (`engine/completion.mjs`). */
export interface MotionVerdict {
    readonly status: string;
    readonly reason: string;
    readonly downgraded?: readonly string[];
    readonly openItems?: readonly string[];
    readonly labels?: readonly string[];
    readonly mode?: string;
}
export type MotionEvaluator = (outDir: string) => Promise<MotionVerdict | null> | MotionVerdict | null;
export type MotionStopDecision = {
    readonly action: "allow";
    readonly why: string;
} | {
    readonly action: "block";
    readonly why: string;
    readonly reason: string;
};
export declare function motionTurnPath(root: string): string;
/**
 * The nearest folder up the tree from `cwd` whose record belongs to `sessionId`. The model often works
 * inside the film folder, and that folder is not the one the prompt armed. A record of another session is
 * not this turn's; an unreadable one of this folder ends the search as "bad" so the caller fails open.
 */
export declare function findMotionTurnRoot(cwd: string, sessionId: string): {
    readonly root: string;
    readonly turn: MotionTurn;
} | "bad" | null;
/** Arm the turn for a film prompt: a fresh record, no runs, no reminders yet. */
export declare function armMotionTurn(cwd: string, sessionId: string, now?: number): boolean;
/** A prompt that is not a film prompt ends the gate for this session; nothing else is touched. */
export declare function disarmMotionTurn(cwd: string, sessionId: string): void;
export interface ParsedMotionCommand {
    readonly mode: string;
    readonly out: string | null;
    readonly round: number | null;
    readonly stillsOnly: boolean;
}
/**
 * Parse one shell call that runs `render.mjs <subcommand> ...`. Variables the same command set earlier
 * (`D=/x/film && node "$R" stage --out "$D"`, also `${D}`) are expanded first. An output path that still
 * holds a `$` after that, or a command substitution, is unknown (`out: null`), never guessed.
 */
export declare function parseMotionCommand(command: string, workdir: string): ParsedMotionCommand | null;
/** The run's exit: a numeric field the host sends, else an `exit <code>` line, else a blocked name the renderer printed. */
export declare function exitCodeOf(response: unknown): number | null;
/** Record a finished shell call that ran `render.mjs`. Silent for anything else, and never throws. */
export declare function recordMotionTool(input: unknown, now?: number): MotionTurn | null;
/**
 * The installed film skill's done-check, imported by absolute path. Null when the skill or its module is
 * missing (the gate cannot judge, so it fails open); a check that throws on a render folder it cannot read
 * is a not-complete verdict that names the cause.
 */
export declare const installedEvaluator: MotionEvaluator;
export interface MotionStopInput {
    readonly cwd: string;
    readonly sessionId: string;
    readonly now?: number;
    readonly evaluate?: MotionEvaluator;
}
/** Decide whether the Stop event may end a film turn. Allows when there is no armed turn or this gate cannot judge. */
export declare function evaluateMotionStop(input: MotionStopInput): Promise<MotionStopDecision>;
