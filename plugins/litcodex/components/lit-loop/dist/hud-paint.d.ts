export type Color = number;
/** One terminal cell; a wide character's second cell has an empty `text`. */
export interface Cell {
    readonly text: string;
    readonly fg?: Color;
    readonly bg?: Color;
    readonly bold?: boolean;
    /** A ready-made SGR string, for text that keeps the card's own style. */
    readonly sgr?: string;
    /** No word or drawing uses this cell. */
    readonly blank?: boolean;
}
export declare const INK: Color;
export declare const FAINT: Color;
export declare const MUTED: Color;
export declare const WHITE: Color;
export declare const TRACK: Color;
export declare const PINK: Color;
export declare const VIOLET: Color;
/** LitCodex mint. */
export declare const ACCENT: Color;
export declare const SUNSET: readonly Color[];
export declare const BLANK: Cell;
/** Colours come in eight steps, so neighbours often match and a frame stays short. */
export declare function mix(from: Color, to: Color, share: number): Color;
export declare function along(stops: readonly Color[], share: number): Color;
export declare function push(row: Cell[], text: string, width: number, style: Omit<Cell, "text">): void;
/** The brand pill; round caps replace its two padding cells, so it is as wide either way. */
export declare function brandPill(caps: boolean, stops?: readonly Color[]): Cell[];
/** Cells `from` up to `to` as a pill graded along `stops`, in dark ink; nothing moves. */
export declare function gradePill(row: Cell[], from: number, to: number, stops: readonly Color[], caps: boolean, ink?: Color, bold?: boolean): void;
/** A bar over `size` cells, `filled` of them lit along `stops`; round ends where the terminal draws them. */
export declare function bar(size: number, filled: number, stops: readonly Color[], caps: boolean): Cell[];
/** `text` as cells in one style. */
export declare function words(text: string, fg: Color, style?: {
    readonly bold?: boolean;
    readonly bg?: Color;
}): Cell[];
/** The row cut to `width` cells, ending in `…` when anything was cut; a wide character is never split. */
export declare function cut(row: readonly Cell[], width: number): Cell[];
/** A filled pill around `text`, graded along `stops`, with its two end cells. */
export declare function pill(text: string, stops: readonly Color[], caps: boolean, ink?: Color, bold?: boolean): Cell[];
/** The escapes that turn `before` into `after` on screen row `y`: only the runs of cells that changed. */
export declare function changedRuns(before: readonly Cell[], after: readonly Cell[], y: number): string;
/** The row as text: cells that look alike share one escape, and (unless `whole`) trailing blanks are dropped. */
export declare function rowText(row: readonly Cell[], whole?: boolean): string;
