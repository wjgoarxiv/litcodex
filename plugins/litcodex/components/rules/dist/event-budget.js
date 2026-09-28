export function withDynamicBudget(config) {
    return {
        ...config,
        maxRuleChars: Math.min(config.maxRuleChars, config.dynamicMaxRuleChars),
        maxResultChars: Math.min(config.maxResultChars, config.dynamicMaxResultChars),
    };
}
export function withPromptBudget(config) {
    return {
        ...config,
        maxRuleChars: Math.min(config.maxRuleChars, config.promptMaxRuleChars),
        maxResultChars: Math.min(config.maxResultChars, config.promptMaxResultChars),
    };
}
export function withOptionalContextBudget(config, optionalBlocks, hasLeadingContext = true) {
    const blocks = optionalBlocks.filter((block) => block.trim().length > 0);
    const reservedChars = blocks.reduce((total, block, index) => total + block.length + (index === 0 && !hasLeadingContext ? 0 : 2), 0);
    if (reservedChars > config.maxResultChars) {
        return { config, blocks: [] };
    }
    return {
        config: {
            ...config,
            maxResultChars: config.maxResultChars - reservedChars,
        },
        blocks,
    };
}
