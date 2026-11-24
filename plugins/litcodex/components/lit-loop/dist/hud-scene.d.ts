import { type HudLine, type HudView } from "./hud.js";
/** `wait` is the card between turns; null draws no scene at all. */
export type SceneMood = "work" | "wait" | "turn" | "rewind" | null;
export interface SceneOptions {
    readonly width: number;
    readonly rows: number;
    /** The terminal draws U+E0B4 and U+E0B6 itself, so gauges and pills may end in round caps. */
    readonly caps: boolean;
}
export interface HudScene {
    /** Whether `paint` draws anything different from one moment to the next. */
    readonly moving: boolean;
    /** Every row of the frame, `seconds` into the motion. */
    paint(seconds: number): string[];
}
/** What the scene does for this view; a notice or a finished plan draws none. */
export declare function sceneMood(view: HudView): SceneMood;
/** Terminals that draw the round caps themselves, whatever the font. */
export declare function drawsRoundCaps(env: NodeJS.ProcessEnv): boolean;
/** A terminal that says its background is light (`COLORFGBG=0;15`). */
export declare function lightBackground(env: NodeJS.ProcessEnv): boolean;
/** The card and its scene, laid out once for this text and window. */
export declare function composeScene(lines: readonly HudLine[], mood: SceneMood, options: SceneOptions): HudScene;
