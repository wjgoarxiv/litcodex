export declare const STACK_DIR = ".litcodex/workflow-stack";
export declare const MAX_FRAMES = 3;
export declare const MAX_HISTORY = 20;
export declare const MAX_STACK_BYTES: number;
/** A frame nobody touched for this long is dropped on the next event. */
export declare const STACK_DROP_MS: number;
/** Disciplines that only read: they neither pause the work under them nor appear as a frame. */
export declare const READ_ONLY_DISCIPLINES: readonly string[];
export declare const WORKFLOW_FAMILIES: Readonly<Record<string, readonly string[]>>;
export type FrameStatus = "active" | "paused";
export type FrameRole = "spine" | "side";
export interface StackFrame {
    readonly skill: string | null;
    readonly family: string | null;
    readonly stage: string | null;
    readonly role: FrameRole;
    readonly status: FrameStatus;
    readonly n?: number;
    readonly total?: number;
    readonly unit?: string;
    readonly done?: boolean;
    readonly ref?: {
        readonly plan: string;
    };
    readonly verdicts: Readonly<Record<string, string>>;
    readonly at: string;
    readonly pausedAt?: string;
}
export interface StackHistoryEntry {
    readonly event: string;
    readonly skill: string | null;
    readonly at: string;
}
export interface WorkflowStack {
    readonly version: 1;
    readonly sessionId: string | null;
    readonly frames: readonly StackFrame[];
    readonly history: readonly StackHistoryEntry[];
}
export type StackTransitionType = "started" | "paused" | "resumed" | "side.done" | "finished" | "dropped";
export interface StackTransition {
    readonly type: StackTransitionType;
    readonly skill: string | null;
    readonly stage: string | null;
    readonly n?: number;
    readonly total?: number;
}
interface StageFields {
    readonly family?: string;
    readonly stage?: string;
    readonly n?: number;
    readonly total?: number;
    readonly unit?: string;
    readonly done?: boolean;
    readonly verdicts?: Readonly<Record<string, string>>;
    readonly ref?: {
        readonly plan?: string;
    };
    readonly scope?: string;
}
export type StackEvent = {
    readonly type: "start";
    readonly skill: string;
    readonly ref?: {
        readonly plan?: string;
    };
    readonly restart?: boolean;
} | {
    readonly type: "continue";
} | ({
    readonly type: "move";
} & StageFields) | ({
    readonly type: "record";
} & StageFields);
export declare function emptyStack(sessionId?: string | null): WorkflowStack;
/** A known stage of a known family in its stored spelling, or null. */
export declare function normalizeStage(family: unknown, stage: unknown): string | null;
/**
 * Apply one event to the stack and return the next stack with the transitions it made (`started`,
 * `paused`, `resumed`, `side.done`, `finished`, `dropped`), which the caller may log.
 * Events: `start {skill, ref?, restart?}`, `continue`, `move {family, stage, n?, total?, unit?, done?,
 * verdicts?, ref?, scope?}` (the hooks' observations) and `record {...same fields}` (the model's
 * `loop stage` call, which updates the top frame or opens one).
 */
export declare function applyStackEvent(stack: WorkflowStack | null | undefined, event: StackEvent, now?: Date): {
    stack: WorkflowStack;
    transitions: StackTransition[];
};
export declare function stackPath(cwd: string, sessionId: string): string | null;
/** The session's stack; a link, a non-file, an oversized or malformed file reads as empty. */
export declare function readStack(cwd: string, sessionId: string): WorkflowStack;
/** Write the whole stack through a temporary file; a link at the destination is replaced, never followed. */
export declare function writeStack(cwd: string, sessionId: string, stack: WorkflowStack): void;
/** Read, apply one event and write back; returns the transitions it made. Never throws. */
export declare function recordStackEvent(cwd: string, sessionId: string, event: StackEvent, now?: Date): {
    stack: WorkflowStack;
    transitions: StackTransition[];
};
/** Another session of the project counts as live while its stack was written this recently. */
export declare const OTHER_SESSION_MS: number;
export interface OtherStack {
    readonly id: string;
    readonly frames: readonly StackFrame[];
    /** The newest time any of its frames moved. */
    readonly at: number;
}
/**
 * The stacks of the project's other sessions that moved within OTHER_SESSION_MS, newest first. It only
 * reads: a link, an oversized or malformed file reads as empty, and an older session is simply dropped.
 */
export declare function readOtherStacks(cwd: string, selfId: string, now?: number): OtherStack[];
/** The frame a bare `lit continue` should resume: the nearest spine below a side frame, else null. */
export declare function pausedSpine(stack: WorkflowStack): StackFrame | null;
/**
 * `[▉▉▉░░] 3/5` when both counts are real, otherwise null. A count with no total is never drawn as a
 * placeholder gauge: callers say what is known in words (`frameNote`) instead.
 */
export declare function stackGauge(frame: Pick<StackFrame, "n" | "total">): string | null;
/** Up to ten cells; a larger total is scaled down so the bar never grows past ten. */
export declare function gaugeBar(done: number, total: number): string;
/** What a frame knows when it has no real gauge, in words: `step 2`, or an empty string. */
export declare function frameNote(frame: Pick<StackFrame, "n" | "total">): string;
/** One frame as a short label: `lit-loop WORK [▉▉░░░] 2/5`, or `lit-loop WORK step 2` without a total. */
export declare function frameLabel(frame: StackFrame): string;
/** `lit-loop ‖ > lit-brainstorm`: paused frames, then the running one after `>`; null for one frame or none. */
export declare function breadcrumb(stack: WorkflowStack): string | null;
/**
 * The stack as one card row: paused frames with their stage and gauge, then the running frame after `>`,
 * then the way back. Null while there is a single frame or none, since the map already shows that.
 */
export declare function stackRow(stack: WorkflowStack): string | null;
export {};
