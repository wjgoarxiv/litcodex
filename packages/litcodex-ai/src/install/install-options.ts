import {
	acceptedModelIds,
	canonicalModelId,
	FALLBACK_CATALOG,
	type ModelDefinition,
	modelDefinition,
} from "../config-migration/catalog.js";
import type { Gpt56Profile, ReasoningEffort } from "../config-migration/gpt56-policy.js";
import { unsafeEffectiveRoute } from "../config-migration/gpt56-policy.js";
import { resolveCodexHome } from "./codex.js";
import { InstallError } from "./errors.js";
import { managedMarketplaceRoot } from "./marketplace.js";
import type { InstallOptions } from "./types.js";

const KNOWN_FLAGS = new Set([
	"--dry-run",
	"--no-tui",
	"--codex-autonomous",
	"--force",
	"--json",
	"--repo",
	"--model",
	"--effort",
	"--subagent-model",
	"--subagent-effort",
	"--style",
	"--yes",
	"--reconfigure",
	"--no-auto-update",
	"--managed-upgrade",
]);

interface ModelChoice {
	readonly id: string;
	readonly profile: Gpt56Profile;
	readonly defaultEffort: ReasoningEffort;
	readonly definition: ModelDefinition;
}

export const OUTPUT_STYLE_IDS = ["off", "asd-ste100", "asd-ste100-ko", "eli5", "eli5-ko"] as const;
export type OutputStyleId = (typeof OUTPUT_STYLE_IDS)[number];

export function parseInstallOptions(
	args: readonly string[],
	context: { readonly env: NodeJS.ProcessEnv; readonly repoRoot: string },
): InstallOptions {
	const valueIndexes = new Set(
		["--repo", "--model", "--effort", "--subagent-model", "--subagent-effort", "--style"]
			.map((flag) => args.indexOf(flag) + 1)
			.filter((index) => index > 0),
	);
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token !== undefined && !valueIndexes.has(index) && token.startsWith("--") && !KNOWN_FLAGS.has(token)) {
			throw badFlag(`unknown flag "${token}"`, token);
		}
	}
	const codexHome = resolveCodexHome(context.env);
	const style = styleChoice(args);
	const lead = modelChoice(args);
	const effort = effortChoice(args, lead);
	const subagent = subagentModelChoice(args);
	const subagentEffort = subagentEffortChoice(args, subagent);
	return {
		dryRun: args.includes("--dry-run"),
		noTui: args.includes("--no-tui"),
		autonomous: args.includes("--codex-autonomous"),
		force: args.includes("--force"),
		json: args.includes("--json"),
		yes: args.includes("--yes"),
		profile: lead.profile,
		leadModel: lead.id,
		effort,
		subagentModel: subagent.id,
		subagentEffort,
		...(style === undefined ? {} : { style }),
		reconfigure: args.includes("--reconfigure") || args.includes("--managed-upgrade"),
		codexHome,
		repoUrl: repoUrl(args, codexHome),
		repoRoot: context.repoRoot,
	};
}

/** True when any model-route flag was passed explicitly (prompting must then be skipped). */
export function hasExplicitModelRouteFlags(args: readonly string[]): boolean {
	return ["--model", "--effort", "--subagent-model", "--subagent-effort"].some((flag) => args.includes(flag));
}

function modelChoice(args: readonly string[]): ModelChoice {
	const index = args.indexOf("--model");
	if (index === -1) {
		return choiceForModel(
			FALLBACK_CATALOG.current.model,
			"",
			FALLBACK_CATALOG.current.model_reasoning_effort as ReasoningEffort,
		);
	}
	const value = args[index + 1];
	if (value === undefined) throw badFlag(`--model requires one of: ${acceptedModelIds().join(", ")}`, "--model");
	return choiceForModel(value, "--model");
}

function subagentModelChoice(args: readonly string[]): ModelChoice {
	const index = args.indexOf("--subagent-model");
	if (index === -1) {
		const route = FALLBACK_CATALOG.roles["default"];
		if (route?.model === undefined || route.model_reasoning_effort === undefined) {
			throw new Error("The bundled model catalog has no default helper route.");
		}
		return choiceForModel(route.model, "", route.model_reasoning_effort as ReasoningEffort);
	}
	const value = args[index + 1];
	if (value === undefined) {
		throw badFlag(`--subagent-model requires one of: ${acceptedModelIds().join(", ")}`, "--subagent-model");
	}
	return choiceForModel(value, "--subagent-model");
}

function choiceForModel(value: string, flag = "", defaultEffort?: ReasoningEffort): ModelChoice {
	const id = canonicalModelId(value);
	const definition = modelDefinition(value);
	if (id === undefined || definition === undefined) {
		if (flag !== "") throw badFlag(`${flag} requires one of: ${acceptedModelIds().join(", ")}`, flag);
		throw new Error(`Unknown bundled model ${value}`);
	}
	return {
		id,
		profile: definition.configProfile,
		defaultEffort: defaultEffort ?? definition.recommendedEffort,
		definition,
	};
}

function effortChoice(args: readonly string[], lead: ModelChoice): ReasoningEffort {
	return pairedEffort(args, "--effort", lead);
}

function subagentEffortChoice(args: readonly string[], subagent: ModelChoice): ReasoningEffort {
	return pairedEffort(args, "--subagent-effort", subagent);
}

/** Resolve an effort flag against its model and fail closed on a policy-forbidden pair. */
function pairedEffort(
	args: readonly string[],
	flag: "--effort" | "--subagent-effort",
	model: ModelChoice,
): ReasoningEffort {
	const index = args.indexOf(flag);
	let effort: ReasoningEffort = model.defaultEffort;
	if (index !== -1) {
		const value = args[index + 1];
		if (!model.definition.configurableEfforts.includes(value as ReasoningEffort)) {
			throw badFlag(
				`${flag} for ${model.id} requires one of: ${formatEfforts(model.definition.configurableEfforts)}`,
				flag,
			);
		}
		effort = value as ReasoningEffort;
	}
	const unsafe = unsafeEffectiveRoute({ model: model.id, model_reasoning_effort: effort });
	if (unsafe !== null) {
		throw badFlag(unsafe, flag);
	}
	return effort;
}

function formatEfforts(efforts: readonly string[]): string {
	if (efforts.length < 2) return efforts.join("");
	if (efforts.length === 2) return `${efforts[0]} or ${efforts[1]}`;
	return `${efforts.slice(0, -1).join(", ")}, or ${efforts.at(-1)}`;
}

function styleChoice(args: readonly string[]): OutputStyleId | undefined {
	const index = args.indexOf("--style");
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (
		value !== "off" &&
		value !== "asd-ste100" &&
		value !== "asd-ste100-ko" &&
		value !== "eli5" &&
		value !== "eli5-ko"
	) {
		throw badFlag("--style requires one of: off, asd-ste100, asd-ste100-ko, eli5, eli5-ko", "--style");
	}
	return value;
}

function repoUrl(args: readonly string[], codexHome: string): string {
	const index = args.indexOf("--repo");
	if (index === -1) return managedMarketplaceRoot(codexHome);
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw badFlag("--repo requires a value (a local marketplace path or a git URL)", "--repo");
	}
	return value;
}

function badFlag(message: string, flag: string): InstallError {
	return new InstallError("LITCODEX_INSTALL_BAD_FLAG", message, { flag });
}
