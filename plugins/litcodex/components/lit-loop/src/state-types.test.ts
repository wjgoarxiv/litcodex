// src/state-types.test.ts — M08/T13 schema-authority suite (A3 C7 + addendum §B).
//
// state-types.ts is the SINGLE schema source. This suite pins the 3-value userModel union
// (NO "adversarial"), the unified goal-id regex /^G\d{3}(-[a-z0-9-]+)?$/ (non-empty slug,
// rejects "G001-"), the criterion-id regex, the goal + work-lifecycle ledger-kind union, the
// LitLoopStateError class shape, and the iso() clock seam. Validators reject adversarial.

import { describe, expect, it } from "vitest";
import type { LitLoopLedgerEntry } from "./state-types.js";
import {
	isGoalId,
	isLedgerEventKind,
	iso,
	isUserModel,
	LIT_LOOP_GOAL_ID_RE,
	LIT_LOOP_LEDGER_EVENT_KINDS,
	LIT_LOOP_USER_MODELS,
	LitLoopStateError,
} from "./state-types.js";

describe("LitLoopUserModel union #given/#when/#then", () => {
	it("is exactly the three MVP values, never adversarial", () => {
		expect([...LIT_LOOP_USER_MODELS].sort()).toEqual(["edge", "happy", "regression"]);
		expect(LIT_LOOP_USER_MODELS.includes("adversarial" as never)).toBe(false);
	});

	it("validator accepts the three values and REJECTS adversarial", () => {
		expect(isUserModel("happy")).toBe(true);
		expect(isUserModel("edge")).toBe(true);
		expect(isUserModel("regression")).toBe(true);
		expect(isUserModel("adversarial")).toBe(false);
		expect(isUserModel("HAPPY")).toBe(false);
		expect(isUserModel("")).toBe(false);
		expect(isUserModel(42)).toBe(false);
	});
});

describe("goal-id regex #given/#when/#then", () => {
	it("accepts bare G + 3 digits and an optional non-empty slug", () => {
		expect(isGoalId("G001")).toBe(true);
		expect(isGoalId("G001-ship-state-store")).toBe(true);
		expect(isGoalId("G123-add-login")).toBe(true);
		expect(LIT_LOOP_GOAL_ID_RE.test("G000")).toBe(true);
	});

	it("rejects an empty slug, wrong digit count, lowercase g, or bad slug chars", () => {
		expect(isGoalId("G001-")).toBe(false); // empty slug
		expect(isGoalId("g001")).toBe(false); // lowercase G
		expect(isGoalId("G1")).toBe(false); // too few digits
		expect(isGoalId("G0001")).toBe(false); // too many digits
		expect(isGoalId("G001-UP")).toBe(false); // slug must be lowercase
		expect(isGoalId("G001-bad_underscore")).toBe(false);
		expect(isGoalId("")).toBe(false);
	});
});

describe("ledger event kinds #given/#when/#then", () => {
	it("includes the six canonical start-work lifecycle kinds", () => {
		expect([...LIT_LOOP_LEDGER_EVENT_KINDS].sort()).toEqual(
			[
				"criteria_revised",
				"criterion_blocked",
				"criterion_failed",
				"evidence_captured",
				"goal_added",
				"goal_blocked",
				"goal_completed",
				"goal_failed",
				"goal_resumed",
				"goal_retried",
				"goal_started",
				"plan_created",
				"state_recovered",
				"start_work_cancelled",
				"start_work_completed",
				"start_work_continuation_issued",
				"start_work_initialized",
				"start_work_paused",
				"start_work_resumed",
			].sort(),
		);
		expect(LIT_LOOP_LEDGER_EVENT_KINDS.length).toBe(19);
	});

	it("validator accepts members and rejects non-members", () => {
		expect(isLedgerEventKind("goal_resumed")).toBe(true);
		expect(isLedgerEventKind("goal_retried")).toBe(true);
		expect(isLedgerEventKind("evidence_captured")).toBe(true);
		expect(isLedgerEventKind("start_work_paused")).toBe(true);
		expect(isLedgerEventKind("work-paused")).toBe(false);
		expect(isLedgerEventKind("nope")).toBe(false);
	});

	it("types canonical work lifecycle fields on kind/at records", () => {
		const entry: LitLoopLedgerEntry = {
			kind: "start_work_paused",
			at: "2026-07-22T00:00:00.000Z",
			workId: "w1",
			transitionId: "pause-1",
			revision: 4,
			fromWorkStatus: "active",
			toWorkStatus: "paused",
			plan: ".litcodex/plans/plan.md",
			sessionId: "codex:s1",
			reasonCode: "authorization_required",
			progressToken: "progress-token",
		};
		expect(entry.kind).toBe("start_work_paused");
		expect(entry.revision).toBe(4);
	});
});

describe("LitLoopStateError #given/#when/#then", () => {
	it("carries a stable code and optional details", () => {
		const err = new LitLoopStateError("boom", "LIT_LOOP_WRITE_FAILED", {
			details: { path: "/x" },
		});
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("LitLoopStateError");
		expect(err.code).toBe("LIT_LOOP_WRITE_FAILED");
		expect(err.message).toBe("boom");
		expect(err.details).toEqual({ path: "/x" });
	});

	it("preserves a cause", () => {
		const cause = new Error("underlying");
		const err = new LitLoopStateError("wrap", "LIT_LOOP_PLAN_CORRUPT", { cause });
		expect(err.cause).toBe(cause);
		expect(err.details).toBeUndefined();
	});
});

describe("iso clock seam #given/#when/#then", () => {
	it("returns an ISO-8601 UTC timestamp", () => {
		const s = iso();
		expect(typeof s).toBe("string");
		expect(s).toBe(new Date(s).toISOString());
		expect(s.endsWith("Z")).toBe(true);
	});
});
