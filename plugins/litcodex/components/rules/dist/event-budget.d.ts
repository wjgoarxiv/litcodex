import type { PiRulesConfig } from "./rules/types.js";
export declare function withDynamicBudget(config: PiRulesConfig): PiRulesConfig;
export declare function withPromptBudget(config: PiRulesConfig): PiRulesConfig;
export declare function withOptionalContextBudget(config: PiRulesConfig, optionalBlocks: ReadonlyArray<string>, hasLeadingContext?: boolean): {
    config: PiRulesConfig;
    blocks: string[];
};
