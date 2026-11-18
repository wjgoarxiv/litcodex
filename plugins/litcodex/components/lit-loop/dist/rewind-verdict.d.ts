import type { RewindResult } from "./rewind.js";
import type { BoardLang } from "./rewind-board.js";
export declare const VERDICT_RULES_VERSION = "adhd-verdict.v1";
export interface VerdictCursor {
    readonly version: 1;
    readonly at: string;
    readonly seen: readonly string[];
    readonly fp: string | null;
}
export interface VerdictAction {
    readonly rule: string;
    readonly kind: "approve" | "answer" | "resume" | "continue" | "start" | "elsewhere" | "wait" | "review" | "row" | "dirty";
    readonly where: string | null;
    readonly what: string;
    readonly type: string | null;
    readonly fp: string;
    readonly pre: string;
}
export interface Verdict {
    readonly version: string;
    readonly code: "NEEDS_YOU" | "ONE_ACTION" | "WAIT" | "ALL_CLEAR" | "UNKNOWN";
    readonly action: VerdictAction | null;
    readonly since: number | null;
    readonly newlyDone: number | null;
    readonly waiting: number;
    readonly coverage: {
        readonly read: number;
        readonly found: number;
        readonly missing: readonly string[];
    };
    readonly checked: number;
    readonly done: readonly string[];
}
export declare const fingerprint: (parts: readonly unknown[]) => string;
/** Proven finished items only: plans with every row ticked, completed start-work runs, and commits. */
export declare function provenDone(result: RewindResult): string[];
type Rule = readonly [name: string, test: (result: RewindResult) => Omit<VerdictAction, "rule"> | null];
/** The rule table, top first. A change of order or meaning bumps VERDICT_RULES_VERSION. */
export declare const RULES: readonly Rule[];
/** Who could not be read: session records skipped for a reason, and sources that could not be read at all. */
export declare function coverageOf(result: RewindResult, lang: BoardLang): Verdict["coverage"];
/** The structured verdict: delta, the one action (or nothing / unknown), queue inputs and coverage. */
export declare function decideVerdict(result: RewindResult, { cursor, lang }?: {
    readonly cursor?: VerdictCursor | null;
    readonly lang?: BoardLang;
}): Verdict;
/** The card as text, about six lines. `lang` is ko (default) or en. */
export declare function renderVerdict(result: RewindResult, { lang, cursor }?: {
    readonly lang?: BoardLang;
    readonly cursor?: VerdictCursor | null;
}): {
    readonly text: string;
    readonly verdict: Verdict;
};
/** The next cursor: when the person looked, which proven items they have now seen, and the action shown. */
export declare function nextCursor(verdict: Verdict, now: number): VerdictCursor;
/** A cursor read from disk, or null when it is missing or malformed. */
export declare function parseCursor(value: unknown): VerdictCursor | null;
export {};
