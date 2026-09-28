// M13 — model catalog reader (S13 catalog.ts).
//
// The packaged model-catalog.json is the single source for selectable models,
// effort bounds, defaults, role routes, and installer menu entries.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const bundledCatalog: unknown = createRequire(import.meta.url)("../../model-catalog.json");

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffortId = (typeof REASONING_EFFORTS)[number];
export const MODEL_CONFIG_PROFILES = ["astra", "sol", "terra", "luna"] as const;
export type ModelConfigProfile = (typeof MODEL_CONFIG_PROFILES)[number];

export interface ReasoningProfile {
	model: string;
	model_reasoning_effort: string;
	model_context_window?: number;
	model_auto_compact_token_limit?: number;
	plan_mode_reasoning_effort?: string;
}

/** A partial set of root keys used to detect a stale/managed config. */
export type ProfileMatch = Readonly<Record<string, string | number>>;

export interface ManagedProfile {
	version: string;
	match: ProfileMatch;
}

export interface ModelRetirement {
	retirementAt: string;
	upgradeModel: string;
}

export interface ModelDefinition {
	id: string;
	configProfile: ModelConfigProfile;
	legacyProfile?: Exclude<ModelConfigProfile, "astra">;
	contextProbe: boolean;
	displayName: string;
	generation: string;
	priority: number;
	visibility: "list";
	supportedInApi: boolean;
	speedTier: string;
	aliases: readonly string[];
	supportedEfforts: readonly ReasoningEffortId[];
	configurableEfforts: readonly ReasoningEffortId[];
	safeExistingEfforts?: readonly ReasoningEffortId[];
	installerMenu: Readonly<{
		lead: readonly ReasoningEffortId[];
		helper: readonly ReasoningEffortId[];
	}>;
	defaultEffort: ReasoningEffortId;
	recommendedRole: string;
	recommendedEffort: ReasoningEffortId;
	retirement?: ModelRetirement;
}

export interface ModelCatalog {
	version: string;
	current: ReasoningProfile;
	models: readonly ModelDefinition[];
	roles: Readonly<Record<string, Partial<ReasoningProfile>>>;
	managedProfiles: readonly ManagedProfile[];
}

/** The bundle must ship one valid catalog; do not silently invent a second model table. */
function loadBundledCatalog(): ModelCatalog {
	const parsed = parseCatalog(bundledCatalog);
	if (parsed === null) throw new Error("The bundled model-catalog.json is missing or invalid.");
	return parsed;
}

export const FALLBACK_CATALOG = loadBundledCatalog();

/** Read the catalog. Never throws — returns FALLBACK_CATALOG on any failure. */
export async function readModelCatalog(env: NodeJS.ProcessEnv = process.env): Promise<ModelCatalog> {
	const override = env["LITCODEX_MODEL_CATALOG_PATH"]?.trim();
	if (override === undefined || override === "") {
		return FALLBACK_CATALOG;
	}
	try {
		const parsed = parseCatalog(JSON.parse(await readFile(override, "utf8")));
		return parsed ?? FALLBACK_CATALOG;
	} catch {
		return FALLBACK_CATALOG;
	}
}

/** Return the catalog definition for a canonical id or one of its aliases. */
export function modelDefinition(
	modelId: string | undefined,
	catalog: ModelCatalog = FALLBACK_CATALOG,
): ModelDefinition | undefined {
	const normalized = terminalModelId(modelId);
	if (normalized === null) return undefined;
	return catalog.models.find((entry) => entry.id === normalized || entry.aliases.includes(normalized));
}

/** Return the canonical id for a user-supplied id or alias. */
export function canonicalModelId(
	modelId: string | undefined,
	catalog: ModelCatalog = FALLBACK_CATALOG,
): string | undefined {
	return modelDefinition(modelId, catalog)?.id;
}

/** All ids accepted by installer/config-migration boundaries, canonical ids first. */
export function acceptedModelIds(catalog: ModelCatalog = FALLBACK_CATALOG): readonly string[] {
	return [...new Set(catalog.models.flatMap((entry) => [entry.id, ...entry.aliases]))];
}

export function supportedEffortsForModel(
	modelId: string | undefined,
	catalog: ModelCatalog = FALLBACK_CATALOG,
): readonly ReasoningEffortId[] {
	return modelDefinition(modelId, catalog)?.supportedEfforts ?? [];
}

function parseCatalog(value: unknown): ModelCatalog | null {
	if (!isRecord(value) || typeof value["version"] !== "string") return null;
	const current = value["current"];
	if (!isReasoningProfile(current)) return null;
	const models = parseModels(value["models"]);
	if (models === null) return null;
	const acceptedIds = models.flatMap((entry) => [entry.id, ...entry.aliases]);
	if (new Set(acceptedIds).size !== acceptedIds.length) return null;
	const legacyProfiles = models.flatMap((entry) => (entry.legacyProfile === undefined ? [] : [entry.legacyProfile]));
	if (new Set(legacyProfiles).size !== legacyProfiles.length) return null;
	const currentDefinition = findModel(models, current.model);
	if (
		currentDefinition === undefined ||
		!currentDefinition.configurableEfforts.includes(current.model_reasoning_effort as ReasoningEffortId) ||
		currentDefinition.installerMenu.lead[0] !== current.model_reasoning_effort
	) {
		return null;
	}
	const rawProfiles = value["managedProfiles"];
	if (!Array.isArray(rawProfiles)) return null;
	const managedProfiles: ManagedProfile[] = [];
	for (const profile of rawProfiles) {
		if (!isRecord(profile) || typeof profile["version"] !== "string" || !isMatchRecord(profile["match"])) {
			return null;
		}
		managedProfiles.push({ version: profile["version"], match: profile["match"] });
	}
	const rawRoles = value["roles"];
	if (!isRecord(rawRoles)) return null;
	const roles: Record<string, Partial<ReasoningProfile>> = {};
	for (const [role, value] of Object.entries(rawRoles)) {
		if (!isReasoningProfile(value)) return null;
		const definition = findModel(models, value.model);
		if (
			definition === undefined ||
			!definition.configurableEfforts.includes(value.model_reasoning_effort as ReasoningEffortId)
		) {
			return null;
		}
		roles[role] = value;
	}
	const defaultRoute = roles["default"];
	if (defaultRoute?.model === undefined || defaultRoute.model_reasoning_effort === undefined) return null;
	const defaultDefinition = findModel(models, defaultRoute.model);
	if (
		defaultDefinition === undefined ||
		defaultDefinition.installerMenu.helper[0] !== defaultRoute.model_reasoning_effort
	) {
		return null;
	}
	return { version: value["version"], current, models, roles, managedProfiles };
}

function parseModels(value: unknown): ModelDefinition[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const models: ModelDefinition[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return null;
		const id = entry["id"];
		const configProfile = entry["config_profile"];
		const legacyProfile = entry["legacy_profile"];
		const contextProbe = entry["context_probe"];
		const displayName = entry["display_name"];
		const generation = entry["generation"];
		const priority = entry["priority"];
		const visibility = entry["visibility"];
		const supportedInApi = entry["supported_in_api"];
		const speedTier = entry["speed_tier"];
		const aliases = entry["aliases"];
		const supportedEfforts = entry["supported_efforts"];
		const configurableEfforts = entry["configurable_efforts"];
		const safeExistingEfforts = entry["safe_existing_efforts"];
		const rawInstallerMenu = entry["installer_menu"];
		const defaultEffort = entry["default_effort"];
		const recommendedRole = entry["recommended_role"];
		const recommendedEffort = entry["recommended_effort"];
		if (
			typeof id !== "string" ||
			!isModelConfigProfile(configProfile) ||
			(legacyProfile !== undefined && !isLegacyProfile(legacyProfile)) ||
			(contextProbe !== undefined && typeof contextProbe !== "boolean") ||
			typeof displayName !== "string" ||
			typeof generation !== "string" ||
			typeof priority !== "number" ||
			!Number.isInteger(priority) ||
			visibility !== "list" ||
			supportedInApi !== true ||
			typeof speedTier !== "string" ||
			!isStringArray(aliases) ||
			!isEffortArray(supportedEfforts) ||
			!isEffortArray(configurableEfforts) ||
			(safeExistingEfforts !== undefined && !isEffortArray(safeExistingEfforts)) ||
			!isRecord(rawInstallerMenu) ||
			!isEffortList(rawInstallerMenu["lead"]) ||
			!isEffortList(rawInstallerMenu["helper"]) ||
			!isReasoningEffort(defaultEffort) ||
			typeof recommendedRole !== "string" ||
			!isReasoningEffort(recommendedEffort)
		) {
			return null;
		}
		if (
			!supportedEfforts.includes(defaultEffort) ||
			!configurableEfforts.includes(recommendedEffort) ||
			!configurableEfforts.every((effort) => supportedEfforts.includes(effort)) ||
			(safeExistingEfforts !== undefined &&
				!safeExistingEfforts.every((effort) => supportedEfforts.includes(effort))) ||
			!rawInstallerMenu["lead"].every((effort) => configurableEfforts.includes(effort)) ||
			!rawInstallerMenu["helper"].every((effort) => configurableEfforts.includes(effort)) ||
			new Set(rawInstallerMenu["lead"]).size !== rawInstallerMenu["lead"].length ||
			new Set(rawInstallerMenu["helper"]).size !== rawInstallerMenu["helper"].length
		) {
			return null;
		}
		const retirementValue = entry["retirement"];
		let retirement: ModelRetirement | undefined;
		if (retirementValue !== undefined) {
			if (
				!isRecord(retirementValue) ||
				typeof retirementValue["retirement_at"] !== "string" ||
				!isRecord(retirementValue["upgrade"]) ||
				typeof retirementValue["upgrade"]["model"] !== "string"
			) {
				return null;
			}
			retirement = {
				retirementAt: retirementValue["retirement_at"],
				upgradeModel: retirementValue["upgrade"]["model"],
			};
		}
		models.push({
			id,
			configProfile,
			...(legacyProfile === undefined ? {} : { legacyProfile }),
			contextProbe: contextProbe === true,
			displayName,
			generation,
			priority,
			visibility,
			supportedInApi,
			speedTier,
			aliases,
			supportedEfforts,
			configurableEfforts,
			...(safeExistingEfforts === undefined ? {} : { safeExistingEfforts }),
			installerMenu: {
				lead: rawInstallerMenu["lead"],
				helper: rawInstallerMenu["helper"],
			},
			defaultEffort,
			recommendedRole,
			recommendedEffort,
			...(retirement === undefined ? {} : { retirement }),
		});
	}
	return models;
}

function findModel(models: readonly ModelDefinition[], value: string): ModelDefinition | undefined {
	const terminal = terminalModelId(value);
	return models.find((entry) => entry.id === terminal || entry.aliases.includes(terminal ?? ""));
}

function terminalModelId(modelId: string | undefined): string | null {
	if (modelId === undefined) return null;
	const terminal = modelId.trim().split("/").at(-1)?.trim().toLowerCase();
	return terminal === undefined || terminal === "" ? null : terminal;
}

function isReasoningProfile(value: unknown): value is ReasoningProfile {
	return (
		isRecord(value) &&
		typeof value["model"] === "string" &&
		typeof value["model_reasoning_effort"] === "string" &&
		(value["model_context_window"] === undefined || typeof value["model_context_window"] === "number") &&
		(value["model_auto_compact_token_limit"] === undefined ||
			typeof value["model_auto_compact_token_limit"] === "number") &&
		(value["plan_mode_reasoning_effort"] === undefined || typeof value["plan_mode_reasoning_effort"] === "string")
	);
}

function isReasoningEffort(value: unknown): value is ReasoningEffortId {
	return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isModelConfigProfile(value: unknown): value is ModelConfigProfile {
	return typeof value === "string" && (MODEL_CONFIG_PROFILES as readonly string[]).includes(value);
}

function isLegacyProfile(value: unknown): value is Exclude<ModelConfigProfile, "astra"> {
	return value === "sol" || value === "terra" || value === "luna";
}

function isEffortArray(value: unknown): value is ReasoningEffortId[] {
	return Array.isArray(value) && value.length > 0 && value.every(isReasoningEffort);
}

function isEffortList(value: unknown): value is ReasoningEffortId[] {
	return Array.isArray(value) && value.every(isReasoningEffort);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isMatchRecord(value: unknown): value is ProfileMatch {
	if (!isRecord(value)) return false;
	for (const entry of Object.values(value)) {
		if (typeof entry !== "string" && typeof entry !== "number") return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
