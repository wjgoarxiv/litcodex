import { type CardStatus } from "./card-status.js";
export { clean } from "./control-chars.js";
export interface HudSession {
    readonly id: string;
    readonly cwd: string;
    readonly updatedAt: number;
    /** The newest LIT activity: the pointer time or a time the live step or workflow record carries. */
    readonly activeAt: number;
}
export interface HudView {
    /** What `--session` asked for, or null to follow the newest session. */
    readonly wanted: string | null;
    readonly session: {
        readonly id: string;
        readonly folder: string;
        readonly lastSeen: number;
    } | null;
    readonly status: CardStatus | null;
    /** Records that exist but could not be read, named for the user. */
    readonly unreadable: readonly string[];
    /** How many sessions `wanted` matched when it named more than one. */
    readonly matches?: number;
}
export interface HudRenderOptions {
    readonly width: number;
    readonly color: boolean;
    readonly now: number;
}
/** Every session with a readable pointer, newest LIT activity first. */
export declare function listSessions(env: NodeJS.ProcessEnv): HudSession[];
/** The most recently active session, or the one `wanted` names by exact id or unique prefix; else null. */
export declare function pickSession(env: NodeJS.ProcessEnv, wanted?: string | null): HudSession | null;
/** Everything one frame needs, read once. Never throws and never writes. */
export declare function readHud(env: NodeJS.ProcessEnv, wanted: string | null, now: number): HudView;
/** The card with every record-derived string stripped of control characters. */
export declare function cleanStatus(status: CardStatus): CardStatus;
/** Terminal cells a plain string takes: CJK and emoji take two, combining marks none. */
export declare function displayWidth(text: string): number;
/** The line cut to `width` terminal cells, ending in `…` when anything was cut. */
export declare function fit(line: string, width: number): string;
/** One frame as text: a header, the card, and at most one "cannot read" line. Pure. */
export declare function renderHud(view: HudView, options: HudRenderOptions): string;
