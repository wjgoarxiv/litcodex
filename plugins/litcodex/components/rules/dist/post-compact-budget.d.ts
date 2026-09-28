import { type ModelMetadata } from "./model-metadata.js";
import type { PiRulesConfig } from "./rules/types.js";
export interface PostCompactBudgetContext {
    readonly model: string;
    readonly transcriptPath: string | null;
    readonly modelMetadata?: ModelMetadata | null;
}
export declare function withPostCompactBudget(config: PiRulesConfig, context?: PostCompactBudgetContext): PiRulesConfig;
