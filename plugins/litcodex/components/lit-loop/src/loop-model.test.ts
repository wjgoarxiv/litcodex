// src/loop-model.test.ts — M09/T14 pure-model suite (#given/#when/#then).
//
// Covers goal derivation (bullets > paragraphs > fallback, dedupe, oversize drop, unicode),
// id normalization, title truncation, criteria seeding (C001/C002/C003 + 3 user models),
// the next-runnable-goal scheduler ordering, plan summary, and the all-criteria-pass gate.
// loop-model is PURE: it imports only state-types (types) — no fs, no store, no I/O.

import { describe, expect, it } from "vitest";
import {
	buildRunInstruction,
	deriveGoalCandidates,
	normalizeGoalId,
	pickNextRunnableGoal,
	requireAllCriteriaPass,
	seedDefaultSuccessCriteria,
	summarizePlan,
	titleFromObjective,
} from "./loop-model.js";
import type { LoopCriterion, LoopGoal, LoopPlan } from "./loop-types.js";

const ISO = "2026-06-13T12:00:00.000Z";

function goal(partial: Partial<LoopGoal> & { id: string }): LoopGoal {
	return {
		...partial,
		id: partial.id,
		title: partial.title ?? partial.id,
		objective: partial.objective ?? partial.id,
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

describe("deriveGoalCandidates #given/#when/#then", () => {
	it("derives bullet goals stripping the bullet prefix", () => {
		expect(deriveGoalCandidates("- Add login\n- Add logout")).toEqual(["Add login", "Add logout"]);
	});

	it("supports numbered list markers", () => {
		expect(deriveGoalCandidates("1. First\n2) Second")).toEqual(["First", "Second"]);
	});

	it("prefers bullets over paragraphs when both present", () => {
		const brief = "Some intro paragraph.\n\n- Only this becomes a goal\n\nTrailing prose.";
		expect(deriveGoalCandidates(brief)).toEqual(["Only this becomes a goal"]);
	});

	it("dedupes candidates keeping the first occurrence", () => {
		expect(deriveGoalCandidates("- a\n- a\n- b")).toEqual(["a", "b"]);
	});

	it("falls back to paragraphs when there are no bullets", () => {
		expect(deriveGoalCandidates("First paragraph.\n\nSecond paragraph.")).toEqual([
			"First paragraph.",
			"Second paragraph.",
		]);
	});

	it("drops headings and falls back when only a heading is present", () => {
		expect(deriveGoalCandidates("# Title only")).toEqual(["Complete the requested project objective."]);
	});

	it("drops an oversized (>1200 char) line and falls back when all dropped", () => {
		const big = `- ${"x".repeat(5000)}`;
		expect(deriveGoalCandidates(big)).toEqual(["Complete the requested project objective."]);
	});

	it("returns the fallback for an empty brief", () => {
		expect(deriveGoalCandidates("   \n  \n")).toEqual(["Complete the requested project objective."]);
	});

	it("treats shell-metachar brief text as inert data (single goal)", () => {
		expect(deriveGoalCandidates("; rm -rf / #")).toEqual(["; rm -rf / #"]);
	});

	it("keeps unicode/Hangul objective text intact", () => {
		expect(deriveGoalCandidates("- 로그인 추가")).toEqual(["로그인 추가"]);
	});
});

describe("normalizeGoalId #given/#when/#then", () => {
	it("zero-pads the index and appends a slug", () => {
		expect(normalizeGoalId(0, "Add login")).toBe("G001-add-login");
		expect(normalizeGoalId(11, "Add logout")).toBe("G012-add-logout");
	});

	it("drops the trailing dash when the slug body is empty (unicode-only)", () => {
		expect(normalizeGoalId(0, "로그인 추가")).toBe("G001");
	});

	it("always matches the goal-id regex", () => {
		const id = normalizeGoalId(2, "; rm -rf / #");
		expect(/^G\d{3}(-[a-z0-9-]+)?$/.test(id)).toBe(true);
	});
});

describe("titleFromObjective #given/#when/#then", () => {
	it("uses the first non-empty line", () => {
		expect(titleFromObjective("\n  Add login\nmore")).toBe("Add login");
	});

	it("truncates a title longer than 72 chars to 69 + ...", () => {
		const t = titleFromObjective("y".repeat(100));
		expect(t.length).toBe(72);
		expect(t.endsWith("...")).toBe(true);
	});
});

describe("seedDefaultSuccessCriteria #given/#when/#then", () => {
	it("seeds exactly C001/C002/C003 with happy/edge/regression models", () => {
		const crits = seedDefaultSuccessCriteria("Add login");
		expect(crits.map((c) => c.id)).toEqual(["C001", "C002", "C003"]);
		expect(crits.map((c) => c.userModel)).toEqual(["happy", "edge", "regression"]);
		for (const c of crits) {
			expect(c.capturedEvidence).toBeNull();
			expect(c.status).toBe("pending");
		}
	});
});

describe("pickNextRunnableGoal #given/#when/#then", () => {
	it("resumes the first in_progress goal before any pending", () => {
		const p = plan([goal({ id: "G001", status: "pending" }), goal({ id: "G002", status: "in_progress" })]);
		const pick = pickNextRunnableGoal(p, { retryFailed: false });
		expect(pick?.goal.id).toBe("G002");
		expect(pick?.resumed).toBe(true);
		expect(pick?.retried).toBe(false);
	});

	it("picks the first pending goal when none are in_progress", () => {
		const p = plan([goal({ id: "G001", status: "complete" }), goal({ id: "G002", status: "pending" })]);
		const pick = pickNextRunnableGoal(p, { retryFailed: false });
		expect(pick?.goal.id).toBe("G002");
		expect(pick?.resumed).toBe(false);
	});

	it("returns null when no goal is runnable and retryFailed is off", () => {
		const p = plan([goal({ id: "G001", status: "complete" }), goal({ id: "G002", status: "failed" })]);
		expect(pickNextRunnableGoal(p, { retryFailed: false })).toBeNull();
	});

	it("retries the first failed goal only with retryFailed", () => {
		const p = plan([goal({ id: "G001", status: "complete" }), goal({ id: "G002", status: "failed" })]);
		const pick = pickNextRunnableGoal(p, { retryFailed: true });
		expect(pick?.goal.id).toBe("G002");
		expect(pick?.retried).toBe(true);
	});

	it("retries the first failed or blocked goal in plan order with retryFailed", () => {
		const p = plan([goal({ id: "G001", status: "blocked" }), goal({ id: "G002", status: "failed" })]);
		const pick = pickNextRunnableGoal(p, { retryFailed: true });
		expect(pick?.goal.id).toBe("G001");
		expect(pick?.retried).toBe(true);
	});
});

describe("requireAllCriteriaPass #given/#when/#then", () => {
	const passing: LoopCriterion = {
		id: "C001",
		scenario: "s",
		userModel: "happy",
		expectedEvidence: "e",
		capturedEvidence: "x",
		status: "pass",
	};

	it("passes when every criterion is pass and the list is non-empty", () => {
		expect(requireAllCriteriaPass(goal({ id: "G001", successCriteria: [passing] }))).toEqual([]);
	});

	it("returns the unresolved list when any criterion is not pass", () => {
		const g = goal({ id: "G001", successCriteria: [passing, { ...passing, id: "C002", status: "pending" }] });
		expect(requireAllCriteriaPass(g)).toEqual([{ id: "C002", status: "pending" }]);
	});

	it("FAILS an empty criteria list (a goal must have >=1 passing criterion)", () => {
		const result = requireAllCriteriaPass(goal({ id: "G001", successCriteria: [] }));
		expect(result.length).toBeGreaterThan(0);
	});
});

describe("summarizePlan #given/#when/#then", () => {
	it("counts goal statuses and criteria roll-up", () => {
		const c = (status: LoopCriterion["status"], id: string): LoopCriterion => ({
			id,
			scenario: "s",
			userModel: "happy",
			expectedEvidence: "e",
			capturedEvidence: null,
			status,
		});
		const p = plan([
			goal({ id: "G001", status: "complete", successCriteria: [c("pass", "C001"), c("pass", "C002")] }),
			goal({ id: "G002", status: "pending", successCriteria: [c("pending", "C001")] }),
		]);
		const s = summarizePlan(p);
		expect(s.total).toBe(2);
		expect(s.complete).toBe(1);
		expect(s.pending).toBe(1);
		expect(s.criteria).toEqual({ total: 3, pass: 2, pending: 1, fail: 0, blocked: 0 });
	});
});

describe("buildRunInstruction #given/#when/#then", () => {
	it("emits a deterministic, marker-free, legacy-token-free handoff block", () => {
		const g = goal({
			id: "G001-add-login",
			title: "Add login",
			objective: "Add login",
			successCriteria: seedDefaultSuccessCriteria("Add login"),
		});
		const text = buildRunInstruction(plan([g]), g);
		expect(text).toContain("lit-loop active-goal handoff");
		expect(text).toContain("Goal: G001-add-login");
		expect(text).toContain("litcodex loop record-evidence");
		expect(text).toContain("litcodex loop checkpoint");
		expect(text).not.toContain("<lit-loop-mode>");
		// no legacy tokens (assembled to avoid self-trip)
		expect(text.toLowerCase()).not.toContain(["o", "m", "o"].join(""));
		expect(text.toLowerCase()).not.toContain(["ultra", "work"].join(""));
	});

	it("removes URI userinfo before returning the model-facing handoff", () => {
		const uri = "https://alice:TOP_SECRET_PASSWORD@example.invalid/private";
		const g = goal({
			id: "G001-private-uri",
			title: `Review ${uri}`,
			objective: `Review ${uri}`,
		});
		const text = buildRunInstruction(plan([g]), g);

		expect(text).not.toContain("alice");
		expect(text).not.toContain("TOP_SECRET_PASSWORD");
		expect(text).toContain("https://example.invalid/private");
	});
});
