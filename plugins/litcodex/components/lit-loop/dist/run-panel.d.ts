import { type CardStatus } from "./card-status.js";
import { type ChecklistRow } from "./workflow-map.js";
/** Rows the panel takes below Codex. */
export declare const PANEL_ROWS = 4;
/** The panel needs room for its own rows and a usable Codex above them. */
export declare const MIN_RUN_ROWS = 12;
export declare const MIN_RUN_COLUMNS = 40;
export interface RunPanelView {
    /** The session's card, or null while no LIT turn has run in this folder since the run started. */
    readonly status: CardStatus | null;
    /** The open checklist row, else the next one, else the last finished one; null when there is none. */
    readonly checklist: ChecklistRow | null;
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
/** The escapes that draw `rows` below a child of `childRows` rows and put the cursor back where it was. */
export declare function panelFrame(rows: readonly string[], options: {
    readonly childRows: number;
    readonly cursorVisible: boolean;
}): string;
/** The escapes that give the whole screen back: no scroll region, empty panel rows, cursor below the child. */
export declare function panelClear(childRows: number): string;
