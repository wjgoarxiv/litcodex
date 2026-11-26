import { type ChecklistRow, type WorkflowMap } from "./workflow-map.js";
/** The longest a row of words gets; the terminal wraps those between words. */
export declare const DEFAULT_CARD_WIDTH = 96;
/**
 * A hook has no terminal to measure, and Codex indents its rows by four cells. The path, the checklist and the lines
 * a hook adds under the card stay inside 44 cells; the horizon, which has no word to break at, inside a phone's 32.
 */
export declare const SAFE_WIDTH = 44;
export interface ScreenCardInput {
    readonly mode: string;
    readonly note: string | null;
    readonly look: string | null;
    readonly map: WorkflowMap | null;
    readonly checklist: readonly ChecklistRow[];
    /** The paused-work row from the workflow stack; null while one frame or none is on it. */
    readonly stack?: string | null;
}
export interface ScreenCardOptions {
    readonly color: boolean;
    readonly width?: number;
    /** False leaves the horizon row out of the coloured card. */
    readonly horizon?: boolean;
    /** The path stays one row, cut at the width, for a caller that counts rows. */
    readonly fixedRows?: boolean;
    /** The window is light: words in its own ink, colour on the pills, the marks and the horizon only. */
    readonly light?: boolean;
    /** 256 takes the colours to that palette. */
    readonly depth?: 256;
    /** The pills end in round caps, in the cells their square ends have. */
    readonly caps?: boolean;
}
/** The card rows joined by newlines. */
export declare function renderScreenCard(input: ScreenCardInput, options: ScreenCardOptions): string;
/**
 * The card for a session's saved state. With `quietWhenEmpty`, null when there is neither a map nor a
 * checklist, since the route row alone would repeat the activation banner above it.
 */
export declare function workflowCard(repoRoot: string, sessionId: string | null, mode: string, 
/** The note, or the two it can be: with the next task while the card names it nowhere else, and without. */
note: string | null | ((next: boolean) => string | null), options: ScreenCardOptions & {
    readonly quietWhenEmpty?: boolean;
    /** Leave the path out while nothing on it is counted: the turn's own words say more than it. */
    readonly quietMap?: boolean;
    /** The activation banner above already names the skill, so the plain card leaves its first row out. */
    readonly underBanner?: boolean;
    /** The turn ended by asking the person something. */
    readonly waiting?: boolean;
    /** The turn is over, so work that has nothing open is done. */
    readonly ended?: boolean;
    /** `show` remembers the path and checklist this card prints; `omit` also leaves them out when the last card had them. */
    readonly repeats?: "show" | "omit";
}): string | null;
