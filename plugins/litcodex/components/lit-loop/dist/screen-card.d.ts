import { type ChecklistRow, type WorkflowMap } from "./workflow-map.js";
/** Codex indents hook rows by four cells; the card stays inside a common terminal width. */
export declare const DEFAULT_CARD_WIDTH = 96;
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
}
/** The card rows joined by newlines. */
export declare function renderScreenCard(input: ScreenCardInput, options: ScreenCardOptions): string;
/**
 * The card for a session's saved state. With `quietWhenEmpty`, null when there is neither a map nor a
 * checklist, since the route row alone would repeat the activation banner above it.
 */
export declare function workflowCard(repoRoot: string, sessionId: string | null, mode: string, note: string | null, options: ScreenCardOptions & {
    readonly quietWhenEmpty?: boolean;
    /** Leave the path out while nothing on it is counted: the turn's own words say more than it. */
    readonly quietMap?: boolean;
    /** The activation banner above already names the skill, so the plain card leaves its first row out. */
    readonly underBanner?: boolean;
    /** The turn ended by asking the person something. */
    readonly waiting?: boolean;
}): string | null;
