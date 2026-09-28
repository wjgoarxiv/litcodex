// src/goal-status.test.ts — pure goal-status helper suite (#given/#when/#then).

import { describe, expect, it } from "vitest";
import {
	aggregateCodexObjective,
	expectedCodexObjective,
	hasAllCriteriaPass,
	isFinalRunCompletionCandidate,
	isLitLoopDone,
} from "./goal-status.js";
import type { LoopCriterion, LoopGoal, LoopPlan } from "./loop-types.js";

const ISO = "2026-06-13T12:00:00.000Z";

function goal(partial: Partial<LoopGoal> & { id: string }): LoopGoal {
	return {
		id: partial.id,
		title: partial.title ?? partial.id,
		objective: partial.objective ?? `Objective for ${partial.id}`,
		status: partial.status ?? "pending",
		successCriteria: partial.successCriteria ?? [],
		attempt: partial.attempt ?? 0,
		createdAt: partial.createdAt ?? ISO,
		updatedAt: partial.updatedAt ?? ISO,
	};
}

function plan(goals: LoopGoal[]): LoopPlan {
	return {
		version: 1,
		createdAt: ISO,
		updatedAt: ISO,
		briefPath: ".litcodex/lit-loop/brief.md",
		goalsPath: ".litcodex/lit-loop/goals.json",
		ledgerPath: ".litcodex/lit-loop/ledger.jsonl",
		evidenceDir: ".litcodex/lit-loop/evidence",
		sessionId: null,
		goals,
	};
}

function crit(id: string, status: LoopCriterion["status"]): LoopCriterion {
	return { id, scenario: "s", userModel: "happy", expectedEvidence: "e", capturedEvidence: null, status };
}

describe("expectedCodexObjective #given/#when/#then", () => {
	it("defaults to an aggregate objective for the whole durable plan", () => {
		const g = goal({ id: "G001", objective: "Add login feature" });
		const objective = expectedCodexObjective(plan([g]), g);
		expect(objective).toBe(aggregateCodexObjective(plan([g])));
		expect(objective).toContain("Complete the durable lit-loop plan");
		expect(objective).toContain(".litcodex/lit-loop/goals.json");
		expect(objective).toContain(".litcodex/lit-loop/ledger.jsonl");
	});

	it("returns the goal objective for explicit per_story compatibility", () => {
		const g = goal({ id: "G001", objective: "Add login feature" });
		expect(expectedCodexObjective({ ...plan([g]), codexGoalMode: "per_story" }, g)).toBe("Add login feature");
	});
});

describe("hasAllCriteriaPass #given/#when/#then", () => {
	it("returns true when all criteria are pass and list is non-empty", () => {
		const g = goal({ id: "G001", successCriteria: [crit("C001", "pass"), crit("C002", "pass")] });
		expect(hasAllCriteriaPass(g)).toBe(true);
	});

	it("returns false when any criterion is not pass", () => {
		const g = goal({ id: "G001", successCriteria: [crit("C001", "pass"), crit("C002", "pending")] });
		expect(hasAllCriteriaPass(g)).toBe(false);
	});

	it("returns false for an empty criteria list", () => {
		const g = goal({ id: "G001", successCriteria: [] });
		expect(hasAllCriteriaPass(g)).toBe(false);
	});
});

describe("isLitLoopDone #given/#when/#then", () => {
	it("returns true when every goal is complete", () => {
		const p = plan([goal({ id: "G001", status: "complete" }), goal({ id: "G002", status: "complete" })]);
		expect(isLitLoopDone(p)).toBe(true);
	});

	it("returns false when any goal is not complete", () => {
		const p = plan([goal({ id: "G001", status: "complete" }), goal({ id: "G002", status: "in_progress" })]);
		expect(isLitLoopDone(p)).toBe(false);
	});

	it("returns true for an empty goals list", () => {
		expect(isLitLoopDone(plan([]))).toBe(true);
	});
});

describe("isFinalRunCompletionCandidate #given/#when/#then", () => {
	it("returns true when the goal is not complete and all others are complete", () => {
		const g1 = goal({ id: "G001", status: "complete" });
		const g2 = goal({ id: "G002", status: "in_progress" });
		expect(isFinalRunCompletionCandidate(plan([g1, g2]), g2)).toBe(true);
	});

	it("returns false when another goal is also not complete", () => {
		const g1 = goal({ id: "G001", status: "pending" });
		const g2 = goal({ id: "G002", status: "in_progress" });
		expect(isFinalRunCompletionCandidate(plan([g1, g2]), g2)).toBe(false);
	});

	it("returns false when the goal itself is already complete", () => {
		const g1 = goal({ id: "G001", status: "complete" });
		expect(isFinalRunCompletionCandidate(plan([g1]), g1)).toBe(false);
	});

	it("returns true for a single non-complete goal (it is the final one)", () => {
		const g = goal({ id: "G001", status: "in_progress" });
		expect(isFinalRunCompletionCandidate(plan([g]), g)).toBe(true);
	});
});
