export type { LitLoopCriterion, LitLoopCriterionStatus, LitLoopGoal, LitLoopGoalStatus, LitLoopLedgerEntry, LitLoopLedgerEventKind, LitLoopLedgerInput, LitLoopPlan, LitLoopUserModel, } from "./state-types.js";
export { LitLoopStateError } from "./state-types.js";
import type { LitLoopCriterion, LitLoopCriterionStatus, LitLoopGoal, LitLoopGoalStatus, LitLoopLedgerEntry, LitLoopLedgerEventKind, LitLoopPlan, LitLoopUserModel } from "./state-types.js";
export type LoopPlan = LitLoopPlan;
export type LoopGoal = LitLoopGoal;
export type LoopCriterion = LitLoopCriterion;
export type LoopLedgerEntry = LitLoopLedgerEntry;
export type LoopLedgerKind = LitLoopLedgerEventKind;
export type LoopGoalStatus = LitLoopGoalStatus;
export type LoopCriterionStatus = LitLoopCriterionStatus;
export type LoopUserModel = LitLoopUserModel;
export interface PlanSummary {
    total: number;
    pending: number;
    in_progress: number;
    complete: number;
    failed: number;
    blocked: number;
    criteria: {
        total: number;
        pass: number;
        pending: number;
        fail: number;
        blocked: number;
    };
}
