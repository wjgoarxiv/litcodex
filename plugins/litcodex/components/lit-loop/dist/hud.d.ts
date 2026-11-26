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
    /** The terminal takes 24-bit colour; only then does the first line carry the LIT pill. */
    readonly truecolor?: boolean;
    /** The window is light: words in its own ink, and one line in a tint that reads on white. */
    readonly light?: boolean;
    readonly now: number;
}
/** Every session with a readable pointer, newest LIT activity first. */
export declare function listSessions(env: NodeJS.ProcessEnv): HudSession[];
/** The most recently active session, or the one `wanted` names by exact id or unique prefix; else null. */
export declare function pickSession(env: NodeJS.ProcessEnv, wanted?: string | null): HudSession | null;
/** The same for a panel that follows session `id` (null while it follows none) and began at `since`. */
export declare function unreadableSince(env: NodeJS.ProcessEnv, id: string | null, since: number): string[];
export declare function tilde(path: string, home: string | undefined): string;
/** Everything one frame needs, read once. Never throws and never writes. */
export declare function readHud(env: NodeJS.ProcessEnv, wanted: string | null, now: number): HudView;
/** The card with every record-derived string stripped of control characters. */
export declare function cleanStatus(status: CardStatus): CardStatus;
/** The string, composed, as the characters a reader sees and the terminal cells each takes. */
export declare function cells(text: string): {
    text: string;
    width: number;
}[];
/** Terminal cells a plain string takes: CJK and emoji take two, combining marks none. */
export declare function displayWidth(text: string): number;
/** The line cut to `width` terminal cells, ending in `…` when anything was cut. */
export declare function fit(line: string, width: number): string;
/**
 * The line in rows of at most `width` cells, `first` on the first one: broken at ` · ` where its parts fit, else between
 * words. A code span stays in one piece while it fits a row, an indented line keeps its indent, and a first row with
 * room for nothing is "".
 */
export declare function wrapped(line: string, width: number, first?: number): string[];
export declare const BOLD = "\u001B[1m";
export declare const DIM = "\u001B[2m";
export declare const RESET = "\u001B[0m";
/** Inks of the 256-colour cube that read on white (4.7:1 or more), for windows that may draw no more than that. */
export declare const LIGHT_INK: {
    readonly turn: "\u001B[38;5;94m";
    readonly done: "\u001B[38;5;28m";
    readonly live: "\u001B[38;5;130m";
};
/** 256-colour codes, one per cell: red, orange, yellow, green, cyan, blue, violet, pink. */
export declare const RAINBOW: number[];
export declare const BRAND = "\uD83D\uDD25 LIT";
export declare const PILL_TEXT = " \uD83D\uDD25 LIT ";
/** Chrome stops 1 and 4 of the LitCodex palette in the LitFamily synthwave spec. */
export declare const PILL_STOPS: readonly [readonly [number, number, number], readonly [number, number, number]];
export declare const PILL_INK = "\u001B[1m\u001B[38;2;11;14;20m";
/** The LIT pill: dark bold ink on a mint gradient background, one colour step per cell. Truecolor only. */
export declare function litPill(): string;
/** One line of the card before it is cut to a width. */
export interface HudLine {
    readonly text: string;
    /** Shorter forms of the text, longest first, for a window it does not fit. */
    readonly short?: readonly string[];
    readonly style: string;
    /** The style on a light window, where dim words are too faint; none when left out. */
    readonly light?: string;
    readonly rainbow?: boolean;
    /** The brand pill's colours on this line, for a state that has its own. */
    readonly pill?: readonly number[];
    /** Where the current stage's name stands in `text`, as a string slice. */
    readonly stage?: readonly [start: number, end: number];
}
/** The line's text, or the longest of its forms that `width` cells hold. */
export declare function lineText(line: HudLine, width: number): string;
/** The header, the card, and at most one "cannot read" line, uncut and in plain text. Pure. */
export declare function hudLines(view: HudView, now: number): HudLine[];
/** One frame as text: a header, the card, and at most one "cannot read" line. Pure. */
export declare function renderHud(view: HudView, options: HudRenderOptions): string;
