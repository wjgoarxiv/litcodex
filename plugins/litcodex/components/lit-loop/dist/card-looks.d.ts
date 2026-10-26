export interface Look {
    readonly label: string;
    readonly palette: "rainbow" | "lanes" | "amber" | "rainbow" | "default";
    readonly comet: "bottom-leftward" | "none";
    readonly pill: "rainbow" | "accent" | "amber" | "brand";
}
export declare const LOOKS: Readonly<Record<string, Readonly<Look>>>;
export declare const LOOK_BY_SKILL: Readonly<Record<string, string>>;
/** The look a skill or discipline id brings, or null for one that keeps the card's own look. */
export declare function lookOf(id: string): string | null;
/** The five review-work lanes in the order the border draws them. */
export declare const REVIEW_LANE_NAMES: readonly ["scope", "tests", "package", "security", "surface"];
/** The review-work lane ids as the workflow stack stores them. */
export declare const REVIEW_LANE_IDS: readonly ["goal", "quality", "security", "qa", "context"];
/** One colour per review lane in border-draw order, and each one dimmed while the lane is still running. */
export declare const LANE_COLORS: readonly string[];
export type LaneState = "pass" | "running" | "fail" | "dim";
/** A lane segment's colour: its own once it passed, red once it failed, dim until it reports. */
export declare function laneColor(index: number, state: LaneState): string;
