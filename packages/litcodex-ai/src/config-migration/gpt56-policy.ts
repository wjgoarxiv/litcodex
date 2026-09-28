import {
	acceptedModelIds,
	canonicalModelId,
	FALLBACK_CATALOG,
	type ModelCatalog,
	modelDefinition,
	type ProfileMatch,
	type ReasoningEffortId,
	type ReasoningProfile,
} from "./catalog.js";
import type { ManagedFileState } from "./state.js";

function requiredRoleModel(role: string): string {
	const model = FALLBACK_CATALOG.roles[role]?.model;
	if (model === undefined) throw new Error(`The bundled model catalog has no ${role} route.`);
	return model;
}

function requiredRecommendedModel(role: string): string {
	const model = FALLBACK_CATALOG.models.find((entry) => entry.recommendedRole === role)?.id;
	if (model === undefined) throw new Error(`The bundled model catalog has no ${role} recommendation.`);
	return model;
}

function requiredLegacyProfileModel(profile: "sol" | "terra" | "luna"): string {
	const model = FALLBACK_CATALOG.models.find((entry) => entry.legacyProfile === profile)?.id;
	if (model === undefined) throw new Error(`The bundled model catalog has no ${profile} legacy profile.`);
	return model;
}

function requiredModelForAlias(alias: string): string {
	const model = modelDefinition(alias);
	if (model === undefined) throw new Error(`The bundled model catalog has no ${alias} alias.`);
	return model.id;
}

export const GPT6_MODELS = {
	astra: requiredRoleModel("plan"),
	sol: requiredRecommendedModel("coding-lead"),
	luna: requiredRoleModel("default"),
} as const;

/** Legacy profile ids are marked in model-catalog.json and keep the public selector stable. */
export const GPT56_MODELS = {
	sol: requiredLegacyProfileModel("sol"),
	terra: requiredLegacyProfileModel("terra"),
	luna: requiredLegacyProfileModel("luna"),
} as const;

export const ASTRA_MODEL = GPT6_MODELS.astra;
export const EXPLICIT_GPT56_SOL_MODEL = requiredModelForAlias("sol");

export type Gpt56Profile = keyof typeof GPT56_MODELS | "astra";
export type Gpt56Effort = "high" | "xhigh" | "max";
export type AstraEffort = ReasoningEffortId;
export type ReasoningEffort = ReasoningEffortId;
export type Gpt56ModelContexts = Readonly<Record<string, number | null>>;
export type CatalogClass =
	| "fresh"
	| "managed_legacy"
	| "existing_managed"
	| "explicit_sol_dispatch"
	| "other_gpt56"
	| "custom";

export const GPT56_CONTEXT_WINDOW_LIMIT = 372_000;
export const GPT56_AUTO_COMPACT_TOKEN_LIMIT = 334_800;

export interface Gpt56ContextLimits {
	readonly contextWindow: number;
	readonly autoCompactTokenLimit: number;
}

export interface CatalogDecision {
	readonly class: CatalogClass;
	readonly originalDispatchId: string | null;
	readonly apply: boolean;
	readonly managed: boolean;
	readonly reason: "fresh" | "current" | "managed-state" | "managed-legacy" | "user-modified";
}

/** Validate a model/effort pair against the authored catalog and legacy safety rules. */
export function unsafeEffectiveRoute(current: Partial<ReasoningProfile>): string | null {
	const model = terminalModelId(current.model);
	const effort = current.model_reasoning_effort;
	if (model === null || effort === undefined) return null;
	const definition = modelDefinition(model);
	if (definition === undefined) return null;
	if (definition.generation === "gpt-6" && !definition.supportedEfforts.includes(effort as ReasoningEffortId)) {
		return `${model} requires ${formatEfforts(definition.supportedEfforts)} reasoning effort`;
	}
	if (
		definition.safeExistingEfforts !== undefined &&
		!definition.safeExistingEfforts.includes(effort as ReasoningEffortId)
	) {
		if (definition.legacyProfile === "luna" && effort === "xhigh") {
			return `${model} cannot use xhigh reasoning effort; use max`;
		}
		return `${model} requires ${formatEfforts(definition.safeExistingEfforts)} reasoning effort`;
	}
	return null;
}

export function isKnownGpt56Model(model: string | undefined): boolean {
	return modelDefinition(model) !== undefined;
}

/** Resolve an explicit catalog id into the config target while retaining the exact spelling. */
export function selectedModel(model: string, effort: ReasoningEffort): ReasoningProfile {
	const canonical = canonicalModelId(model);
	if (canonical === undefined) {
		throw new Error(`Unknown model ${JSON.stringify(model)}; accepted ids: ${acceptedModelIds().join(", ")}`);
	}
	const selected = { model: canonical, model_reasoning_effort: effort };
	const unsafe = unsafeEffectiveRoute(selected);
	if (unsafe !== null) throw new Error(`Invalid ${canonical} model route: ${unsafe}.`);
	return selected;
}

function terminalModelId(model: string | undefined): string | null {
	if (model === undefined) return null;
	const segments = model.trim().split("/");
	const terminal = segments.at(-1)?.trim().toLowerCase();
	return terminal === undefined || terminal === "" ? null : terminal;
}

/**
 * Desired-route model under ChatGPT-subscription auth: both Sol representations (the bare
 * `gpt-5.6` alias and the explicit `gpt-5.6-sol` id) dispatch as explicit Sol; other ids pass
 * through unchanged. The API rejects the bare alias for ChatGPT accounts.
 */
export function chatgptDesiredRouteModel(model: string): string {
	const terminal = terminalModelId(model);
	return terminal === GPT56_MODELS.sol || terminal === EXPLICIT_GPT56_SOL_MODEL ? EXPLICIT_GPT56_SOL_MODEL : model;
}

type ProfileEffort<Profile extends Gpt56Profile> = Profile extends "astra" ? AstraEffort : Gpt56Effort;

/** Select a legacy profile or the existing Astra lead default. */
export function selectedProfile<Profile extends Gpt56Profile>(
	profile: Profile,
	effort: ProfileEffort<Profile>,
): ReasoningProfile {
	const selected = {
		model: profile === "astra" ? ASTRA_MODEL : GPT56_MODELS[profile as keyof typeof GPT56_MODELS],
		model_reasoning_effort: effort,
	};
	const definition = modelDefinition(selected.model);
	if (definition !== undefined && !definition.configurableEfforts.includes(effort)) {
		throw new Error(`${selected.model} requires ${formatEfforts(definition.configurableEfforts)} reasoning effort`);
	}
	const unsafe = unsafeEffectiveRoute(selected);
	if (unsafe !== null) throw new Error(`Invalid ${profile} model route: ${unsafe}.`);
	return selected;
}

export function alignedContextLimits(context: number | null | undefined): Gpt56ContextLimits | undefined {
	return context === GPT56_CONTEXT_WINDOW_LIMIT
		? { contextWindow: GPT56_CONTEXT_WINDOW_LIMIT, autoCompactTokenLimit: GPT56_AUTO_COMPACT_TOKEN_LIMIT }
		: undefined;
}

export function decideCatalogApplication(args: {
	readonly current: Partial<ReasoningProfile>;
	readonly target: ReasoningProfile;
	readonly catalog: ModelCatalog;
	readonly previousState?: ManagedFileState | undefined;
	readonly reconfigure: boolean;
}): CatalogDecision {
	const { current, target, catalog, previousState, reconfigure } = args;
	const identity = classifyCatalogInput({ current, catalog, previousState });
	if (Object.keys(current).length === 0) {
		return { ...identity, apply: true, managed: true, reason: "fresh" };
	}
	if (reconfigure) {
		return { ...identity, apply: true, managed: true, reason: "managed-state" };
	}
	if (isKnownCurrent(current)) {
		return matchesExact(current, target)
			? { ...identity, apply: false, managed: true, reason: "current" }
			: { ...identity, apply: reconfigure, managed: true, reason: reconfigure ? "managed-state" : "current" };
	}
	if (previousState?.managed === true && matchesExact(current, previousState.written)) {
		return { ...identity, apply: false, managed: true, reason: "managed-legacy" };
	}
	for (const profile of catalog.managedProfiles) {
		if (matchesExact(current, profile.match)) {
			return {
				...identity,
				apply: reconfigure,
				managed: true,
				reason: reconfigure ? "managed-state" : "managed-legacy",
			};
		}
	}
	return { ...identity, apply: false, managed: false, reason: "user-modified" };
}

export function classifyCatalogInput(args: {
	readonly current: Partial<ReasoningProfile>;
	readonly catalog: ModelCatalog;
	readonly previousState?: ManagedFileState | undefined;
}): Pick<CatalogDecision, "class" | "originalDispatchId"> {
	const { current, catalog, previousState } = args;
	const originalDispatchId = typeof current.model === "string" ? current.model : null;
	if (Object.keys(current).length === 0) return { class: "fresh", originalDispatchId };
	if (
		originalDispatchId === EXPLICIT_GPT56_SOL_MODEL &&
		previousState?.managed === true &&
		matchesExact(current, previousState.written)
	) {
		return { class: "managed_legacy", originalDispatchId };
	}
	if (originalDispatchId === EXPLICIT_GPT56_SOL_MODEL) {
		return { class: "explicit_sol_dispatch", originalDispatchId };
	}
	if (
		originalDispatchId === GPT56_MODELS.sol ||
		originalDispatchId === GPT56_MODELS.terra ||
		originalDispatchId === GPT56_MODELS.luna ||
		originalDispatchId === ASTRA_MODEL ||
		originalDispatchId === GPT6_MODELS.sol ||
		originalDispatchId === GPT6_MODELS.luna
	) {
		return { class: "existing_managed", originalDispatchId };
	}
	if (catalog.managedProfiles.some((profile) => matchesExact(current, profile.match))) {
		return { class: "managed_legacy", originalDispatchId };
	}
	if (originalDispatchId !== null && /^gpt-5\.6(?:$|-)/.test(originalDispatchId)) {
		return { class: "other_gpt56", originalDispatchId };
	}
	return { class: "custom", originalDispatchId };
}

function isKnownCurrent(current: Partial<ReasoningProfile>): boolean {
	return (
		current.model !== undefined &&
		current.model_reasoning_effort !== undefined &&
		canonicalModelId(current.model) === current.model &&
		current.model !== EXPLICIT_GPT56_SOL_MODEL &&
		modelDefinition(current.model) !== undefined &&
		unsafeEffectiveRoute(current) === null &&
		isKnownContextLimitPair(current) &&
		current.plan_mode_reasoning_effort === undefined
	);
}

function isKnownContextLimitPair(current: Partial<ReasoningProfile>): boolean {
	return (
		(current.model_context_window === undefined && current.model_auto_compact_token_limit === undefined) ||
		(current.model_context_window === undefined && current.model_auto_compact_token_limit === 650_000) ||
		(current.model_context_window === GPT56_CONTEXT_WINDOW_LIMIT &&
			current.model_auto_compact_token_limit === GPT56_AUTO_COMPACT_TOKEN_LIMIT)
	);
}

function matchesExact(current: Partial<ReasoningProfile>, profile: ProfileMatch | Partial<ReasoningProfile>): boolean {
	const currentEntries = Object.entries(current);
	const profileEntries = Object.entries(profile);
	if (currentEntries.length !== profileEntries.length) return false;
	return profileEntries.every(([key, value]) =>
		currentEntries.some(([currentKey, currentValue]) => currentKey === key && currentValue === value),
	);
}

function formatEfforts(efforts: readonly ReasoningEffortId[]): string {
	if (efforts.length < 2) return efforts.join("");
	if (efforts.length === 2) return `${efforts[0]} or ${efforts[1]}`;
	return `${efforts.slice(0, -1).join(", ")}, or ${efforts.at(-1)}`;
}
