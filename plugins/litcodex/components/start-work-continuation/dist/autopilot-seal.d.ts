import type { Snapshot } from "./autopilot-store.js";
/**
 * The autopilot's seals: what the hooks recorded for a run, kept outside the workspace under
 * `<CODEX_HOME>/litcodex/start-work-seals/`. Codex's workspace sandbox does not cover the Codex home and the start-work
 * guard refuses shell writes there, so the model cannot rewrite a seal the way it could rewrite the run state in the
 * project. Each seal holds the digest of the parked list the user was last shown, the digest of the typed start-work
 * consent, and the Done-when line as the run first saw it. Only the hook process's own environment picks the folder.
 * A missing or unreadable seal never passes a check that needs it.
 */
export interface SealRecord {
    readonly snapshot?: {
        readonly list_id: string;
        readonly digest: string;
    };
    readonly consent?: string;
    readonly check?: {
        readonly line: string | null;
    };
    /** Digests of the commands `lit deny` refused, kept here too so a corrupt run state cannot drop them. */
    readonly refused?: readonly string[];
}
export declare function readSeal(root: string, key: string): SealRecord;
/** Change one record by temp file and rename. False when the seal could not be written. */
export declare function writeSeal(root: string, key: string, change: (record: SealRecord) => SealRecord): boolean;
/** The short digest the inbox shows for a parked list: its id and every step's id, command, folder and tier. */
export declare function snapshotDigest(snapshot: Snapshot): string;
export declare function sealSnapshot(root: string, workId: string, snapshot: Snapshot): void;
/** True when `snapshot` is exactly the list the hook sealed for this work. */
export declare function snapshotSealed(root: string, workId: string, snapshot: Snapshot): boolean;
export declare function consentDigest(plans: Readonly<Record<string, string>>, at: string): string;
/** Remember the commands `lit deny` refused for this work (the newest 256). */
export declare function sealRefusals(root: string, workId: string, steps: readonly {
    command: string;
    cwd: string;
}[]): void;
export declare function refusalSealed(root: string, workId: string, command: string, cwd: string): boolean;
/** The seal key of one session's Done-when line for one plan. */
export declare function checkKey(sessionId: string, plan: string): string;
/**
 * The Done-when line bound to this session and plan: the one a typed start-work saw, else the one the first turn-end
 * saw, pinned then. `undefined` when no seal can be kept.
 */
export declare function pinnedCheck(root: string, key: string, line: string | null): string | null | undefined;
/** Bind the Done-when line as it stands now (a typed start-work rebinds it). */
export declare function pinCheck(root: string, key: string, line: string | null): boolean;
