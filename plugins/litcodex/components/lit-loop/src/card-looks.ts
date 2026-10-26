// src/card-looks.ts — the LIT card's looks: what a skill or session state turns the card into.
//
// A look names its palette, its corner label, its comet path and its pill style; card-html.ts and
// screen-card.ts draw them. card-status.ts picks one look per read: a completion first, then the
// session waiting on the user, then the look of a skill running this turn (whatever route ran it).
//
//   rewind  lit-adhd and lit-rewind: rainbow border and rails, `REWIND <<`, a `<<` comet
//   review  review-work: the top and bottom rules split into the five review lanes
//   turn    waiting on the user: an amber border breathing over 2.4 s, `YOUR TURN`
//   done    a plan, goal, review or release finished: one rainbow burst of embers

export interface Look {
	readonly label: string;
	readonly palette: "rainbow" | "lanes" | "amber" | "rainbow" | "default";
	readonly comet: "bottom-leftward" | "none";
	readonly pill: "rainbow" | "accent" | "amber" | "brand";
}

export const LOOKS: Readonly<Record<string, Readonly<Look>>> = Object.freeze({
	rewind: Object.freeze({
		label: "REWIND <<",
		palette: "rainbow" as const,
		comet: "bottom-leftward" as const,
		pill: "rainbow" as const,
	}),
	review: Object.freeze({
		label: "REVIEW",
		palette: "lanes" as const,
		comet: "none" as const,
		pill: "accent" as const,
	}),
	turn: Object.freeze({
		label: "YOUR TURN",
		palette: "amber" as const,
		comet: "none" as const,
		pill: "amber" as const,
	}),
	done: Object.freeze({ label: "DONE", palette: "rainbow" as const, comet: "none" as const, pill: "brand" as const }),
});

export const LOOK_BY_SKILL: Readonly<Record<string, string>> = Object.freeze({
	"lit-adhd": "rewind",
	"lit-rewind": "rewind",
	"review-work": "review",
});

const BY_SKILL = new Map(Object.entries(LOOK_BY_SKILL));

/** The look a skill or discipline id brings, or null for one that keeps the card's own look. */
export function lookOf(id: string): string | null {
	return BY_SKILL.get(id) ?? null;
}

/** The five review-work lanes in the order the border draws them. */
export const REVIEW_LANE_NAMES = Object.freeze(["scope", "tests", "package", "security", "surface"] as const);

/** The review-work lane ids as the workflow stack stores them. */
export const REVIEW_LANE_IDS = Object.freeze(["goal", "quality", "security", "qa", "context"] as const);

/** One colour per review lane in border-draw order, and each one dimmed while the lane is still running. */
export const LANE_COLORS = Object.freeze(["#5fd7ff", "#b48cff", "#ff6fae", "#6bdb8f", "#ffd75f"]);
const LANE_RUNNING = Object.freeze(["#5095af", "#7e6caf", "#a85c82", "#569771", "#a89557"]);
const LANE_DIM = "#3d444d";
const LANE_FAIL = "#ff5f5f";

export type LaneState = "pass" | "running" | "fail" | "dim";

/** A lane segment's colour: its own once it passed, red once it failed, dim until it reports. */
export function laneColor(index: number, state: LaneState): string {
	if (state === "pass") return LANE_COLORS[index] ?? LANE_DIM;
	if (state === "running") return LANE_RUNNING[index] ?? LANE_DIM;
	return state === "fail" ? LANE_FAIL : LANE_DIM;
}
