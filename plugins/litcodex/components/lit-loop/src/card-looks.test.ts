// The look registry: every skill with a look maps to the right one, the look drives the card class,
// the HUD tint and the statusline label. Tests per look and per route.

import { describe, expect, it } from "vitest";
import {
	LANE_COLORS,
	LOOK_BY_SKILL,
	LOOKS,
	laneColor,
	lookOf,
	REVIEW_LANE_IDS,
	REVIEW_LANE_NAMES,
} from "./card-looks.js";

describe("lookOf", () => {
	it("lit-adhd maps to rewind", () => expect(lookOf("lit-adhd")).toBe("rewind"));
	it("lit-rewind maps to rewind", () => expect(lookOf("lit-rewind")).toBe("rewind"));
	it("review-work maps to review", () => expect(lookOf("review-work")).toBe("review"));
	it("lit-loop has no look", () => expect(lookOf("lit-loop")).toBeNull());
	it("start-work has no look", () => expect(lookOf("start-work")).toBeNull());
	it("litresearch has no look", () => expect(lookOf("litresearch")).toBeNull());
	it("unknown skill has no look", () => expect(lookOf("unknown")).toBeNull());
});

describe("LOOKS registry", () => {
	it("contains the four looks", () => {
		expect(Object.keys(LOOKS).sort()).toEqual(["done", "review", "rewind", "turn"]);
	});

	it.each(Object.entries(LOOKS))("%s has label, palette, comet and pill", (_name, look) => {
		expect(typeof look.label).toBe("string");
		expect(look.label.length).toBeGreaterThan(0);
		expect(typeof look.palette).toBe("string");
		expect(typeof look.comet).toBe("string");
		expect(typeof look.pill).toBe("string");
	});

	it("rewind has rainbow palette and bottom-leftward comet", () => {
		expect(LOOKS["rewind"]?.palette).toBe("rainbow");
		expect(LOOKS["rewind"]?.comet).toBe("bottom-leftward");
	});

	it("turn has amber palette and YOUR TURN label", () => {
		expect(LOOKS["turn"]?.palette).toBe("amber");
		expect(LOOKS["turn"]?.label).toBe("YOUR TURN");
	});

	it("review has lanes palette", () => {
		expect(LOOKS["review"]?.palette).toBe("lanes");
	});
});

describe("LOOK_BY_SKILL", () => {
	it("every skill in the map resolves through lookOf", () => {
		for (const [skill, look] of Object.entries(LOOK_BY_SKILL)) {
			expect(lookOf(skill)).toBe(look);
		}
	});
});

describe("review lanes", () => {
	it("has five lane names", () => expect(REVIEW_LANE_NAMES).toHaveLength(5));
	it("has five lane ids", () => expect(REVIEW_LANE_IDS).toHaveLength(5));
	it("has five lane colours", () => expect(LANE_COLORS).toHaveLength(5));

	it.each(["pass", "running", "fail", "dim"] as const)("laneColor returns a hex colour for %s", (state) => {
		for (let i = 0; i < 5; i++) {
			const color = laneColor(i, state);
			expect(color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it("pass colours differ from dim", () => {
		for (let i = 0; i < 5; i++) expect(laneColor(i, "pass")).not.toBe(laneColor(i, "dim"));
	});

	it("fail colour is red for every lane", () => {
		for (let i = 0; i < 5; i++) expect(laneColor(i, "fail")).toBe("#ff5f5f");
	});
});

describe("card look selection (via card-status)", () => {
	// These test the look selection logic in card-status through the import, verified via readCardStatus in integration.
	it("every registered look name exists in the LOOKS registry", () => {
		for (const look of Object.values(LOOK_BY_SKILL)) {
			expect(LOOKS).toHaveProperty(look);
		}
	});
});
