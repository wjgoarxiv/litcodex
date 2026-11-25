import { type CardStatus } from "./card-status.js";
import { type HudView } from "./hud.js";
import { type ChecklistRow } from "./workflow-map.js";
/** Rows of the plain panel below Codex. */
export declare const PANEL_ROWS = 4;
/** Rows of the sunset card, and of the taller one a high window has room for. */
export declare const SCENE_ROWS = 7;
export declare const TALL_SCENE_ROWS = 9;
/** The panel needs room for its own rows and a usable Codex above them. */
export declare const MIN_RUN_ROWS = 12;
export declare const MIN_RUN_COLUMNS = 40;
/** How many rows the panel takes in a window of this size; `scene` when the terminal can draw the sunset. */
export declare function panelRows(size: {
    readonly rows: number;
    readonly columns: number;
}, scene: boolean): number;
export interface RunPanelView {
    /** The session's card, or null while no LIT turn has run in this folder since the run started. */
    readonly status: CardStatus | null;
    /** The open checklist row, else the next one, else the last finished one; null when there is none. */
    readonly checklist: ChecklistRow | null;
    /** The session the card is about; null while none is. */
    readonly session?: HudView["session"];
}
export interface RunPanelOptions {
    readonly width: number;
    readonly color: boolean;
    readonly now: number;
}
/** What the panel shows now for a run started in `cwd` at `since`. Never throws and never writes. */
export declare function readRunPanel(env: NodeJS.ProcessEnv, cwd: string, since: number, now: number): RunPanelView;
/** Exactly `PANEL_ROWS` rows, each at most `width` cells. Pure. */
export declare function renderRunPanel(view: RunPanelView, options: RunPanelOptions): string[];
/** The sunset card of `litcodex hud` as the panel: whole frames, and between them only the cells that moved. */
export interface RunScene {
    /** Reads the records and lays the card out for `rows` × `width`. */
    read(size: {
        readonly rows: number;
        readonly width: number;
    }): void;
    /** Every row, each `width` cells at most. */
    rows(): string[];
    /** The escapes that bring the drawn rows, the first on screen row `top` + 1, to this moment; "" when none changed. */
    changes(top: number): string;
    readonly moving: boolean;
}
export declare function createRunScene(env: NodeJS.ProcessEnv, cwd: string, since: number, now: () => number): RunScene;
/** The escapes that draw `rows` below a child of `childRows` rows and put the cursor back where it was. */
export declare function panelFrame(rows: readonly string[], options: {
    readonly childRows: number;
    readonly cursorVisible: boolean;
}): string;
/** The escapes that give the whole screen back: no scroll region, empty panel rows, cursor below the child. */
export declare function panelClear(childRows: number, height?: number): string;
