import { type HudView } from "./hud.js";
import { type Cell } from "./hud-paint.js";
export interface CardOptions {
    /** Cells the card takes, frame included. */
    readonly width: number;
    readonly rows: number;
    /** The terminal draws round caps itself. */
    readonly caps: boolean;
    readonly now: number;
}
export interface HudCard {
    /** Whether the card moves by itself: LIT is working. */
    readonly moving: boolean;
    /** Every row as cells, `seconds` into the motion; `burst` runs 0 to 1 while a completion is celebrated. */
    paint(seconds: number, burst?: number | null): Cell[][];
}
/** Past this many cells the card stops growing, so a wide window does not stretch it thin. */
export declare const CARD_MAX = 120;
/** The card and its scene, laid out once for this view and window. */
export declare function composeCard(view: HudView, options: CardOptions): HudCard;
