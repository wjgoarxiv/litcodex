/**
 * The parts of a start-work plan the autopilot reads: its top-level rows with their indented `BLOCKED:` or
 * `IMPOSSIBLE:` notes, the `## Done when` check, the `Run charter:` commit grant and the `goal: native` opt-in.
 * Text inside code fences is never read, so a quoted example grants and checks nothing.
 */
export interface PlanRow {
    /** `3` for a todo `3. …`, `F2` for a final-verification row, or the 1-based position when unnumbered. */
    readonly id: string;
    readonly label: string;
    readonly done: boolean;
    readonly blocked: string | null;
    readonly impossible: string | null;
    /** Zero-based line of the checkbox in the full plan text. */
    readonly line: number;
}
export interface PlanCharter {
    readonly branch: string;
    readonly repo: string;
}
export interface PlanFacts {
    readonly rows: readonly PlanRow[];
    readonly check: string | null;
    readonly charters: readonly PlanCharter[];
    readonly nativeGoal: boolean;
    /** sha256 over the `Run charter:` and `Scope roots:` lines, so a consent can be bound to them. */
    readonly charterDigest: string;
}
export declare function readPlanFacts(markdown: string): PlanFacts;
/** Rows still to do: unticked and not skipped. */
export declare function openRows(facts: PlanFacts): readonly PlanRow[];
/** Tick every BLOCKED/IMPOSSIBLE open row (or only row `only`) as skipped; returns the new text and the ids. */
export declare function skipRows(markdown: string, only: string | null): {
    readonly text: string;
    readonly ids: string[];
};
