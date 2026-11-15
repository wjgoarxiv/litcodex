export type RunOutcome = "sent" | "nothing" | "waiting";
export interface RunEnd {
    readonly version: 1;
    readonly at: number;
    readonly session: string;
    readonly mode: string;
    readonly outcome: RunOutcome;
}
export declare function runEndPath(repoRoot: string): string;
/**
 * The outcome for a turn that just closed, or null when the run is not over. `line` is the Stop line
 * `workflowStopLine` made for the recorded turn (null when it made none) and `waitReason` what
 * `detectWaitReason` read from the last assistant message.
 */
export declare function outcomeFor(line: string | null, waitReason: string | null): RunOutcome | null;
/** Append one run end. Never throws. */
export declare function recordRunEnd(repoRoot: string, sessionId: string, entry: {
    readonly mode: string;
    readonly outcome: RunOutcome;
}, now?: number): void;
/** Every well-formed run end, oldest first; a corrupt line is skipped and an unreadable file reads as empty. */
export declare function readRunEnds(repoRoot: string): RunEnd[];
