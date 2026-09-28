import type { LoopGoal, LoopPlan } from "./loop-types.js";
export declare function codexGoalMode(plan: LoopPlan): "aggregate" | "per_story";
export declare function aggregateCodexObjective(plan: LoopPlan): string;
/** The Codex goal objective for a lit-loop plan/goal. Defaults to one aggregate goal per plan. */
export declare function expectedCodexObjective(plan: LoopPlan, goal: LoopGoal): string;
/** True when the goal has at least one criterion and every criterion is `pass`. */
export declare function hasAllCriteriaPass(goal: LoopGoal): boolean;
/** True when every goal in the plan is `complete`. */
export declare function isLitLoopDone(plan: LoopPlan): boolean;
/**
 * True when the given goal is NOT complete AND every OTHER goal IS complete — meaning completing
 * this goal would finish the entire plan.
 */
export declare function isFinalRunCompletionCandidate(plan: LoopPlan, goal: LoopGoal): boolean;
