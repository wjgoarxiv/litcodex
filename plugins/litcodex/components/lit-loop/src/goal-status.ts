// src/goal-status.ts — pure goal-status helpers for Codex native-goal integration.
//
// Predicates and objective resolver for the lit-loop ↔ Codex `/goal` handoff. All functions are
// PURE — no I/O, no store, no clock. Imports only loop-types (which re-exports state-types).

import type { LoopGoal, LoopPlan } from "./loop-types.js";

export function codexGoalMode(plan: LoopPlan): "aggregate" | "per_story" {
	return plan.codexGoalMode ?? "aggregate";
}

export function aggregateCodexObjective(plan: LoopPlan): string {
	return (
		plan.codexObjective ??
		`Complete the durable lit-loop plan in ${plan.goalsPath}, including any later accepted/appended goals; use ${plan.ledgerPath} as the audit trail.`
	);
}

/** The Codex goal objective for a lit-loop plan/goal. Defaults to one aggregate goal per plan. */
export function expectedCodexObjective(plan: LoopPlan, goal: LoopGoal): string {
	return codexGoalMode(plan) === "per_story" ? goal.objective : aggregateCodexObjective(plan);
}

/** True when the goal has at least one criterion and every criterion is `pass`. */
export function hasAllCriteriaPass(goal: LoopGoal): boolean {
	return goal.successCriteria.length > 0 && goal.successCriteria.every((c) => c.status === "pass");
}

/** True when every goal in the plan is `complete`. */
export function isLitLoopDone(plan: LoopPlan): boolean {
	return plan.goals.every((g) => g.status === "complete");
}

/**
 * True when the given goal is NOT complete AND every OTHER goal IS complete — meaning completing
 * this goal would finish the entire plan.
 */
export function isFinalRunCompletionCandidate(plan: LoopPlan, goal: LoopGoal): boolean {
	if (goal.status === "complete") return false;
	return plan.goals.every((g) => g.id === goal.id || g.status === "complete");
}
