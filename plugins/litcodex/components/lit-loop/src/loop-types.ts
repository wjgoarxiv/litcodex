// src/loop-types.ts — M09/T14 re-export / type-alias barrel (A3 C7, C9 flat layout).
//
// `state-types.ts` (M08) is the SINGLE schema source. This module declares NO independent
// plan/goal/criterion/ledger shapes — it only re-exports the store types under M09's spelling
// (`LoopPlan = LitLoopPlan`, etc.) plus the two pure VIEW types M09 computes and M11's doctor
// imports (`PlanSummary`, `LoopGoalStatus`). Flat sibling import `./state-types.js` (NOT
// `../state/...`). Types only; ZERO runtime / I/O.

export type {
	LitLoopCriterion,
	LitLoopCriterionStatus,
	LitLoopGoal,
	LitLoopGoalStatus,
	LitLoopLedgerEntry,
	LitLoopLedgerEventKind,
	LitLoopLedgerInput,
	LitLoopPlan,
	LitLoopUserModel,
} from "./state-types.js";
export { LitLoopStateError } from "./state-types.js";

import type {
	LitLoopCriterion,
	LitLoopCriterionStatus,
	LitLoopGoal,
	LitLoopGoalStatus,
	LitLoopLedgerEntry,
	LitLoopLedgerEventKind,
	LitLoopPlan,
	LitLoopUserModel,
} from "./state-types.js";

// ── M09-spelled aliases of the single M08 schema (A3 C7) ─────────────────────
export type LoopPlan = LitLoopPlan;
export type LoopGoal = LitLoopGoal;
export type LoopCriterion = LitLoopCriterion;
export type LoopLedgerEntry = LitLoopLedgerEntry;
export type LoopLedgerKind = LitLoopLedgerEventKind;
export type LoopGoalStatus = LitLoopGoalStatus;
export type LoopCriterionStatus = LitLoopCriterionStatus;
export type LoopUserModel = LitLoopUserModel;

// ── Computed VIEW type (never persisted; consumed by status + M11 doctor) ────
export interface PlanSummary {
	total: number;
	pending: number;
	in_progress: number;
	complete: number;
	failed: number;
	blocked: number;
	criteria: { total: number; pass: number; pending: number; fail: number; blocked: number };
}
