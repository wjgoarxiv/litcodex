import { type HudLine, type HudView } from "./hud.js";
/** Narrower windows keep the plain lines. */
export declare const CARD_MIN = 40;
/** `wait` is the card between turns. */
export type SceneMood = "work" | "wait" | "turn" | "rewind" | null;
export interface SceneOptions {
    readonly width: number;
    /** The terminal draws U+E0B4 and U+E0B6 itself, so gauges and pills may end in round caps. */
    readonly caps: boolean;
}
/** What the stage pill shows of this view; a notice or a finished plan shows it at rest. */
export declare function sceneMood(view: HudView): SceneMood;
/** A terminal that says its background is light (`COLORFGBG=0;15`). */
export declare function lightBackground(env: NodeJS.ProcessEnv): boolean;
/** The card's lines for a narrow window, each cut to `width`, with their pills and gauges. */
export declare function narrowLines(lines: readonly HudLine[], mood: SceneMood, options: SceneOptions): string[];
