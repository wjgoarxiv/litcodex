import { type LitMode } from "./modes.js";
export declare const REENTRY_DIR = ".litcodex/lit-reentry";
/** Work this session could pick up again, worded for the one-line resume note. */
export interface ResumeWork {
    readonly text: string;
}
/** Saved state a route decision needs; read lazily, only when a lit-family route matched. */
export interface ReentryContext {
    /** The route this session last sent an activation for; null when none is saved. */
    readonly active: string | null;
    /** Approved or running work a bare `lit` should resume; null when there is none. */
    readonly resume: ResumeWork | null;
    /** The paused spine a `lit continue` brings back, with the stage and count it left; absent when none. */
    readonly frame?: ResumedFrame | null;
}
/** A paused frame of the workflow stack, as `lit continue` names it to the model. */
export interface ResumedFrame {
    readonly skill: string;
    readonly stage: string | null;
    readonly n?: number;
    readonly total?: number;
}
export declare const NO_REENTRY: ReentryContext;
export type Entry = {
    readonly kind: "first";
    readonly confirm: boolean;
} | {
    readonly kind: "continue";
    readonly confirm: boolean;
    readonly route: LitMode;
    readonly frame?: ResumedFrame;
} | {
    readonly kind: "resume";
    readonly work: ResumeWork;
    readonly active: boolean;
    readonly route: LitMode;
    readonly frame?: ResumedFrame;
};
/** The route this session last sent an activation for, or null when nothing readable is saved. */
export declare function readActiveRoute(cwd: string, sessionId: string): string | null;
/** Remember that `mode`'s activation reached this session. Never throws. */
export declare function recordActiveRoute(cwd: string, sessionId: string, mode: string, now?: number): void;
/** Forget the saved route, so the next lit prompt sends the full activation again. Never throws. */
export declare function clearActiveRoute(cwd: string, sessionId: string): void;
/**
 * Approved or running work for this session, from the same saved state the LIT card reads: a start-work
 * plan that is active or paused, a plan this session published through lit-plan and has not started,
 * or lit-loop goals that are not all complete. A finished plan resumes nothing.
 */
export declare function readResumeWork(cwd: string, sessionId: string): ResumeWork | null;
/** True for exactly `lit continue`: the way back from a side discipline to the work it paused. */
export declare function isLitContinue(prompt: string): boolean;
/** True for a bare `lit` or `lit continue`: the prompt carries no task and no route of its own. */
export declare function isBareLit(prompt: string): boolean;
/** True for `lit new …` or `lit restart …`: the work starts again instead of continuing. */
export declare function isRestartPrompt(prompt: string): boolean;
/**
 * How a matched lit-family route enters. start-work always gets its full activation: its prompt carries
 * the write grant. `lit new …` and `lit restart …` start again. A bare `lit` or `lit continue` carries on
 * whichever route the session holds (resuming approved or running work when there is some), so it never
 * switches; only an explicit `lit <other route>` does. The same route as the saved one continues; anything
 * else is a first activation. Only a bare `lit` with no task and nothing active or in flight asks what to start.
 */
export declare function enterRoute(prompt: string, mode: LitMode, context: ReentryContext): Entry;
/** Lines a resume or confirmation adds to a full activation. */
export declare function entryNotes(entry: Entry): string[];
/**
 * The short context a repeated prompt gets while its contract is still loaded: no skill or directive
 * files to read, the visible banner line, and a one-line reminder where the contract guards writes.
 */
export declare function continueContext(mode: LitMode, entry: Entry): string;
