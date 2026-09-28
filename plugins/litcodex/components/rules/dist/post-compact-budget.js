import { readFileSync } from "node:fs";
import { hasContextPressureMarker } from "./context-pressure.js";
import { managedGpt56Slug, resolveModelMetadata } from "./model-metadata.js";
const DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
const ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN = 3;
const PROJECTED_INJECTION_CHARS_PER_TOKEN = 2;
const POST_COMPACT_RESERVED_CONTEXT_PERCENT = 5;
const POST_COMPACT_MIN_RESERVED_TOKENS = 8_000;
const POST_COMPACT_MIN_GUIDE_CHARS = 500;
const FALLBACK_CONTEXT_WINDOW_TOKENS = 200_000;
const MODEL_CONTEXT_BUDGETS = [
    { slug: "gpt-5.5", contextWindowTokens: 272_000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
    { slug: "gpt-5.4-mini", contextWindowTokens: 272_000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
    {
        slug: "codex-auto-review",
        contextWindowTokens: 272_000,
        effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
    },
];
export function withPostCompactBudget(config, context) {
    const postCompactMaxResultChars = dynamicPostCompactMaxResultChars(context) ?? config.postCompactMaxResultChars;
    const maxResultChars = Math.min(config.maxResultChars, config.postCompactMaxResultChars, postCompactMaxResultChars);
    const maxRuleChars = Math.min(config.maxRuleChars, config.postCompactMaxRuleChars, maxResultChars);
    return {
        ...config,
        maxRuleChars,
        maxResultChars,
    };
}
function dynamicPostCompactMaxResultChars(context) {
    if (context === undefined || context.transcriptPath === null) {
        return undefined;
    }
    const transcript = estimateTranscript(context.transcriptPath);
    if (transcript === undefined) {
        return undefined;
    }
    if (hasContextPressureMarker(transcript.text)) {
        return POST_COMPACT_MIN_GUIDE_CHARS;
    }
    const modelBudget = resolveModelContextBudget(context);
    if (modelBudget === null) {
        return POST_COMPACT_MIN_GUIDE_CHARS;
    }
    const effectiveContextWindow = Math.floor((modelBudget.contextWindowTokens * modelBudget.effectivePercent) / 100);
    const reservedTokens = Math.max(POST_COMPACT_MIN_RESERVED_TOKENS, Math.floor((effectiveContextWindow * POST_COMPACT_RESERVED_CONTEXT_PERCENT) / 100));
    const injectableTokens = Math.max(0, effectiveContextWindow - reservedTokens - transcript.tokens);
    return Math.max(POST_COMPACT_MIN_GUIDE_CHARS, Math.floor(injectableTokens * PROJECTED_INJECTION_CHARS_PER_TOKEN));
}
function resolveModelContextBudget(context) {
    const gpt56Slug = managedGpt56Slug(context.model);
    if (gpt56Slug === null) {
        return modelContextBudgetFor(context.model) ?? fallbackModelContextBudget();
    }
    if (context.modelMetadata !== undefined) {
        return context.modelMetadata !== null && context.modelMetadata.slug === gpt56Slug
            ? {
                slug: gpt56Slug,
                contextWindowTokens: context.modelMetadata.contextWindow,
                effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
            }
            : null;
    }
    const resolved = resolveModelMetadata(context.model);
    return resolved.state === "available"
        ? {
            slug: resolved.metadata.slug,
            contextWindowTokens: resolved.metadata.contextWindow,
            effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
        }
        : null;
}
function modelContextBudgetFor(model) {
    const normalizedModel = model.trim().toLowerCase();
    for (const budget of MODEL_CONTEXT_BUDGETS) {
        if (normalizedModel === budget.slug ||
            normalizedModel.endsWith(`.${budget.slug}`) ||
            normalizedModel.endsWith(`/${budget.slug}`)) {
            return budget;
        }
    }
    return undefined;
}
function fallbackModelContextBudget() {
    return {
        slug: "unknown",
        contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS,
        effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
    };
}
function estimateTranscript(transcriptPath) {
    let transcriptText;
    try {
        transcriptText = readFileSync(transcriptPath, "utf8");
    }
    catch {
        return undefined;
    }
    return {
        text: transcriptText,
        tokens: Math.ceil(Buffer.byteLength(transcriptText, "utf8") / ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN),
    };
}
