import { canonicalModelId, FALLBACK_CATALOG, modelDefinition } from "./config-migration/catalog.js";
import type { Gpt56Profile, ReasoningEffort } from "./config-migration/gpt56-policy.js";
import { unsafeEffectiveRoute } from "./config-migration/gpt56-policy.js";

/** Pure model-route readers used by the synchronous dry-run dispatcher. */
export function readModelChoice(args: readonly string[]): Gpt56Profile {
	if (!args.includes("--model")) return modelDefinition(FALLBACK_CATALOG.current.model)?.configProfile ?? "astra";
	const value = args[args.indexOf("--model") + 1];
	return modelDefinition(canonicalModelId(value))?.configProfile ?? readModelChoice([]);
}

export function readLeadModelChoice(args: readonly string[]): string {
	if (!args.includes("--model")) return FALLBACK_CATALOG.current.model;
	return canonicalModelId(args[args.indexOf("--model") + 1]) ?? FALLBACK_CATALOG.current.model;
}

export function readSubagentModelChoice(args: readonly string[]): string {
	const defaultRoute = FALLBACK_CATALOG.roles["default"];
	const defaultModel = defaultRoute?.model ?? FALLBACK_CATALOG.current.model;
	if (!args.includes("--subagent-model")) return defaultModel;
	return canonicalModelId(args[args.indexOf("--subagent-model") + 1]) ?? defaultModel;
}

export function readSubagentEffortChoice(args: readonly string[]): ReasoningEffort {
	const value = args[args.indexOf("--subagent-effort") + 1];
	const model = readSubagentModelChoice(args);
	const defaultEffort = args.includes("--subagent-model")
		? modelDefinition(model)?.recommendedEffort
		: (FALLBACK_CATALOG.roles["default"]?.model_reasoning_effort as ReasoningEffort | undefined);
	return effortForModel(value, model, defaultEffort ?? modelDefinition(model)?.recommendedEffort ?? "max");
}

export function readEffortChoice(args: readonly string[]): ReasoningEffort {
	const value = args[args.indexOf("--effort") + 1];
	const model = readLeadModelChoice(args);
	const defaultEffort = args.includes("--model")
		? modelDefinition(model)?.recommendedEffort
		: (FALLBACK_CATALOG.current.model_reasoning_effort as ReasoningEffort);
	return effortForModel(value, model, defaultEffort ?? modelDefinition(model)?.recommendedEffort ?? "xhigh");
}

function effortForModel(value: string | undefined, model: string, fallback: ReasoningEffort): ReasoningEffort {
	const definition = modelDefinition(model);
	if (
		definition !== undefined &&
		value !== undefined &&
		definition.configurableEfforts.includes(value as ReasoningEffort) &&
		unsafeEffectiveRoute({ model, model_reasoning_effort: value }) === null
	) {
		return value as ReasoningEffort;
	}
	return fallback;
}
