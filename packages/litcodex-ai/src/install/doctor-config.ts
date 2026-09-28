import { modelDefinition } from "../config-migration/catalog.js";
import {
	EXPLICIT_GPT56_SOL_MODEL,
	type ReasoningEffort,
	unsafeEffectiveRoute,
} from "../config-migration/gpt56-policy.js";
import { hasReservedSpawnSchemaMismatch } from "../config-migration/multi-agent-v2-guard.js";
import { readRootSettings } from "../config-migration/root-settings.js";
import type { ReadonlyFsLike } from "./codex.js";
import type { EffectiveConfigReport } from "./types.js";

/** Read-only effective root-route inspection shared by the doctor surface and its tests. */
export function inspectEffectiveConfig(fs: ReadonlyFsLike, configPath: string): EffectiveConfigReport {
	if (!fs.existsSync(configPath)) {
		return { state: "unavailable", detail: "config.toml is missing" };
	}
	try {
		const config = fs.readFileSync(configPath, "utf8");
		if (hasReservedSpawnSchemaMismatch(config)) {
			return {
				state: "unavailable",
				detail: "multi-agent V2 exposes metadata that violates the reserved collaboration.spawn_agent schema",
			};
		}
		const root = readRootSettings(config);
		const unsafeRoute = unsafeEffectiveRoute(root);
		if (unsafeRoute !== null) return { state: "unavailable", detail: `unsafe effective model route: ${unsafeRoute}` };
		const model = root.model ?? "host default";
		const effort = root.model_reasoning_effort ?? "host default";
		if (model === EXPLICIT_GPT56_SOL_MODEL) {
			return {
				state: "preserved",
				detail:
					"gpt-5.6-sol · existing explicit Sol representation preserved; review `litcodex install --reconfigure` for a one-time alias update",
			};
		}
		if (isManagedRoute(model, effort)) {
			if (root.model_context_window === undefined && root.model_auto_compact_token_limit === undefined) {
				return {
					state: "applied",
					detail: `${model} · ${effort}; context/auto-compaction unset; host defaults apply`,
				};
			}
		}
		return {
			state: "preserved",
			detail: `${model} · ${effort}; preserved (limits or ownership differ); use --reconfigure to review`,
		};
	} catch (error) {
		if (error instanceof Error) {
			return { state: "unavailable", detail: "config.toml could not be read" };
		}
		throw error;
	}
}

function isManagedRoute(model: string, effort: string): boolean {
	const definition = modelDefinition(model);
	return (
		definition?.configurableEfforts.includes(effort as ReasoningEffort) === true &&
		unsafeEffectiveRoute({ model, model_reasoning_effort: effort }) === null
	);
}
