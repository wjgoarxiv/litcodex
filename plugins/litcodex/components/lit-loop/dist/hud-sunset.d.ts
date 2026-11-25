import { type Cell, type Color } from "./hud-paint.js";
export declare const SUN_WIDTH = 18;
export declare const SUN_ROWS = 3;
/** Blank cells kept on each side of the sun. */
export declare const SUN_CLEAR = 2;
export interface Palette {
    /** Each sun row's resting colour and the colour the light lifts it to. */
    readonly sun: readonly (readonly [Color, Color])[];
    /** The sea from the sun outward. */
    readonly sea: readonly Color[];
    readonly rule: readonly Color[];
    readonly stage: readonly [Color, Color];
}
export declare const DUSK: Palette;
export declare const AMBER: Palette;
/** The rewind line's eight colours in truecolor, for a sun that matches it. */
export declare const WHEEL: readonly Color[];
export interface SunsetOptions {
    readonly palette: Palette;
    readonly moving: boolean;
    /** Sunk toward the dark while the card rests. */
    readonly dim: boolean;
    /** A colour by column, for the rewind look; the sunset then stands still in it. */
    readonly wheel: ((x: number) => Color) | null;
}
export interface Sunset {
    /** Whether the sun found room. */
    readonly sun: boolean;
    /** The cell under the middle of the sun. */
    readonly middle: number;
    /** Draws a moment of the scene into a copy of the rows it was laid out on. */
    paint(grid: Cell[][], seconds: number, burst: number | null): void;
}
/** Right of centre, and never so far left that the three usage figures lose their place beside it. */
export declare const sunLeft: (width: number) => number;
/** Whether the sun fits on rows `top` to `top + 2`, with its margin, without touching text. */
export declare function sunFits(rows: readonly (readonly Cell[])[], top: number, width: number): boolean;
/** The scene laid out on `rows`, its sun's first row at `top`; the rows are read once, here. */
export declare function layoutSunset(rows: readonly (readonly Cell[])[], top: number, width: number, options: SunsetOptions): Sunset;
