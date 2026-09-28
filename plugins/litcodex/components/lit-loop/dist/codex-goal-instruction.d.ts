import type { LoopGoal, LoopGoalStatus, LoopPlan } from "./loop-types.js";
export interface CodexCreateGoalPayload {
    readonly objective: string;
}
export interface LitLoopGoalInstruction {
    readonly text: string;
    readonly json: CodexCreateGoalPayload;
}
export declare function buildCodexGoalInstruction(args: {
    readonly plan: LoopPlan;
    readonly goal: LoopGoal;
    readonly isFinal?: boolean;
}): LitLoopGoalInstruction;
export declare function buildCodexGoalCheckpoint(args: {
    readonly plan: LoopPlan;
    readonly goal: LoopGoal;
    readonly status: LoopGoalStatus;
}): string;
