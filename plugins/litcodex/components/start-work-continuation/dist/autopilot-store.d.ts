import type { Tier } from "./shell-tier.js";
/**
 * The autopilot's own small state beside the lifecycle state: parked commands, the inbox snapshot, the block budget
 * per plan state, the paused flag, a stored check timeout and the typed start-work consents that bind a
 * `Run charter:`. The lifecycle store stays the authority for a run's status; this file only remembers what the
 * guard parked and what the user was shown. Only the hooks write it, under its own lock, by atomic rename.
 */
export declare const MAX_B_STEPS = 32;
export declare const MAX_X_STEPS = 16;
export declare const MAX_REFUSED = 64;
export interface ParkedStep {
    readonly id: string;
    readonly command: string;
    readonly cwd: string;
    readonly tier: Tier;
    readonly held: string | null;
    readonly outward: boolean;
    /** The next open row when it was parked, or null when every row was ticked. */
    readonly row: string | null;
    readonly parked_at: string;
    readonly asked: number;
    readonly last_result?: string;
}
export interface SnapshotStep {
    readonly id: string;
    readonly command: string;
    readonly cwd: string;
    readonly tier: Tier;
}
export interface Snapshot {
    readonly list_id: string;
    readonly steps: readonly SnapshotStep[];
}
export interface Budget {
    readonly state: string;
    readonly blocks: number;
    readonly inbox: boolean;
    readonly turn: string | null;
    readonly last: string;
    /** sha256 of the plan text at the last spend, so the LIT card line can tell an unchanged plan without the state digest. */
    readonly plan?: string;
}
export interface WorkAutopilot {
    readonly session: string;
    readonly steps: readonly ParkedStep[];
    readonly refused: readonly {
        readonly command: string;
        readonly cwd: string;
    }[];
    readonly snapshot: Snapshot | null;
    readonly budget: Budget | null;
    readonly paused: boolean;
    readonly check: {
        readonly state: string;
        readonly turn: string;
        readonly outcome: "timeout";
    } | null;
    readonly overflow: number;
    /** Rows whose parked step an approved replay ran; the Stop driver tells the model to clear their BLOCKED line. */
    readonly released?: readonly {
        readonly row: string;
        readonly command: string;
    }[];
}
export interface Consent {
    readonly plans: Readonly<Record<string, string>>;
    readonly at: string;
}
export interface AutopilotFile {
    readonly version: 1;
    readonly works: Readonly<Record<string, WorkAutopilot>>;
    readonly consents: Readonly<Record<string, Consent>>;
}
export declare function autopilotPathFor(root: string): string;
export declare function emptyWork(session: string): WorkAutopilot;
/** The file as stored, or an empty one when it is missing, too large, a link or unreadable. */
export declare function readAutopilot(root: string): AutopilotFile;
export declare function workOf(file: AutopilotFile, workId: string, session: string): WorkAutopilot;
/** Read, change and write the file under its lock. `change` returns the next file, or null to write nothing. */
export declare function updateAutopilot<T>(root: string, change: (file: AutopilotFile) => {
    readonly next: AutopilotFile | null;
    readonly result: T;
}): T;
export declare function withWork(file: AutopilotFile, workId: string, work: WorkAutopilot): AutopilotFile;
/** Park `step`, or count one more ask when the same command in the same folder is already parked. */
export declare function parkStep(work: WorkAutopilot, step: Omit<ParkedStep, "id" | "asked" | "parked_at">, at: string): {
    readonly work: WorkAutopilot;
    readonly outcome: "parked" | "again" | "full";
    readonly asked: number;
};
