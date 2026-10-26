// Integration tests for the look system fixes: YOUR TURN gating, done burst once-only, review route coverage.
import { describe, expect, it } from "vitest";
import { detectWaitReason } from "./live-step.js";

// ── Fix 1: YOUR TURN only when the last words ask something or report BLOCKED ──

describe("detectWaitReason", () => {
	it("returns 'question' when the message ends with a question mark", () => {
		expect(detectWaitReason("Should I proceed?")).toBe("question");
	});

	it("returns 'question' for a full-width question mark", () => {
		expect(detectWaitReason("다음 단계는？")).toBe("question");
	});

	it("returns 'question' for lit approve mention", () => {
		expect(detectWaitReason("Type `lit approve` to continue.")).toBe("question");
	});

	it("returns 'question' for Korean approval phrase", () => {
		expect(detectWaitReason("진행해도 괜찮을까요")).toBe("question");
	});

	it("returns 'blocked' when the message starts with BLOCKED:", () => {
		expect(detectWaitReason("BLOCKED: no auth token — set CODEX_API_KEY")).toBe("blocked");
	});

	it("returns 'blocked' when BLOCKED: appears on a later line", () => {
		expect(detectWaitReason("I tried but\nBLOCKED: missing credential")).toBe("blocked");
	});

	it("returns null for a plain done message", () => {
		expect(detectWaitReason("Done, all tests pass.")).toBeNull();
	});

	it("returns null for an empty message", () => {
		expect(detectWaitReason("")).toBeNull();
	});

	it("returns null for null", () => {
		expect(detectWaitReason(null)).toBeNull();
	});

	it("returns null for a statement that does not ask", () => {
		expect(detectWaitReason("I refactored the module and the tests pass now.")).toBeNull();
	});
});

// ── Fix 2: done burst deduplication is tested in card-html.test.ts ──

// ── Fix 3: review-work route coverage ──

import { lookOf } from "./card-looks.js";

describe("review-work look per route", () => {
	it("the bare word 'review-work' maps to the review look", () => {
		expect(lookOf("review-work")).toBe("review");
	});
});
