// Non-destructive config migration orchestrator. Install mode fails fast after
// backup; session-start records per-file errors without blocking the Codex turn.

import { dirname, join } from "node:path";

import { backupConfigFile } from "./backup.js";
import type { ModelCatalog, ReasoningProfile } from "./catalog.js";
import { modelDefinition, readModelCatalog } from "./catalog.js";
import { configPathExists, readConfigFile, writeConfigFile } from "./config-file-io.js";
import { configPaths } from "./config-paths.js";
import { CodexConfigMigrationError } from "./errors.js";
import {
	decideCatalogApplication,
	type Gpt56ModelContexts,
	type Gpt56Profile,
	type ReasoningEffort,
	selectedModel,
	selectedProfile,
	unsafeEffectiveRoute,
} from "./gpt56-policy.js";
import { ensureStableMultiAgent, hasManagedMultiAgentGuard, removeSubagentDefaults } from "./multi-agent-v2-guard.js";
import { ensureNativeDefaultAgentConfig } from "./native-default-route.js";
import { ensureGpt56ProfileFiles } from "./profile-files.js";
import { ensureCodexReasoningConfig, ensureLitCodexOutputStyleConfig, readRootSettings } from "./root-settings.js";
import type { ManagedFileState, MigrationState } from "./state.js";
import { readState, resolveStatePath, writeState } from "./state.js";
import { validateTomlShape } from "./toml-shape.js";
import { assertNoUnsafeInstallRoutes } from "./unsafe-route-guard.js";

export type { ModelCatalog, ReasoningProfile } from "./catalog.js";
export { readModelCatalog } from "./catalog.js";
export type { CodexConfigMigrationCode } from "./errors.js";
export { CodexConfigMigrationError } from "./errors.js";
export {
	ensureCodexReasoningConfig,
	ensureLitCodexOutputStyleConfig,
	readLitCodexOutputStyleId,
} from "./root-settings.js";
export type { ManagedFileState, MigrationState } from "./state.js";
export type { TomlShapeRejection, TomlShapeResult } from "./toml-shape.js";
export { validateTomlShape } from "./toml-shape.js";

export type MigrationMode = "session-start" | "install";

export interface MigrateOptions {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	mode?: MigrationMode;
	dryRun?: boolean;
	reconfigure?: boolean;
	profile?: Gpt56Profile;
	effort?: ReasoningEffort;
	modelContexts?: Gpt56ModelContexts;
	/** Exact catalog model selected by the installer; existing config remains untouched unless reconfigured. */
	modelOverride?: string;
	/** Override the sol model identifier (e.g. "gpt-5.6-sol" for ChatGPT-subscription auth). */
	solModelOverride?: string;
	/** Output style id to persist (e.g. "asd-ste100"). "off" removes the key. Omit to leave unchanged. */
	style?: string;
	/** Selected helper route; retained for installer compatibility (not written as a global key). */
	subagentModel?: string;
	/** Selected helper effort; retained for installer compatibility (not written as a global key). */
	subagentEffort?: string;
}

export interface MigrateSkip {
	path: string;
	reason: "user-modified" | "preserved" | "current" | "error";
}

export interface MigrateResult {
	changed: string[];
	backups: string[];
	skipped: MigrateSkip[];
	stateWritten: boolean;
}

export interface MigrateFileOptions {
	catalog: ModelCatalog;
	previousState?: ManagedFileState | undefined;
	mode: MigrationMode;
	dryRun?: boolean | undefined;
	reconfigure?: boolean | undefined;
	target?: ReasoningProfile | undefined;
	style?: string | undefined;
	subagentModel?: string | undefined;
	subagentEffort?: string | undefined;
	nativeDefaultAgentConfigFile?: string | undefined;
}

export interface MigrateFileResult {
	changed: boolean;
	written: Partial<ReasoningProfile>;
	managed: boolean;
	backup: string | null;
	skipReason: "user-modified" | "preserved" | "current" | null;
}

/** Orchestrate the migration across the discovered config paths. */
export async function migrateCodexConfig(options: MigrateOptions = {}): Promise<MigrateResult> {
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	const mode: MigrationMode = options.mode ?? "install";
	const dryRun = options.dryRun ?? false;
	const reconfigure = options.reconfigure ?? false;

	// Opt-out short-circuit: no reads, no writes.
	if (env["LITCODEX_CONFIG_MIGRATION_DISABLED"]?.trim() === "1") {
		return { changed: [], backups: [], skipped: [], stateWritten: false };
	}

	const catalog = await readModelCatalog(env);
	const defaultDefinition = modelDefinition(catalog.current.model, catalog);
	const selected = options.profile ?? defaultDefinition?.configProfile ?? "astra";
	const selectedEffort =
		options.effort ??
		(options.modelOverride === undefined && options.profile === undefined
			? (catalog.current.model_reasoning_effort as ReasoningEffort)
			: options.modelOverride === undefined
				? selected === "astra"
					? "xhigh"
					: "max"
				: (modelDefinition(options.modelOverride)?.recommendedEffort ??
					(defaultDefinition?.recommendedEffort as ReasoningEffort | undefined) ??
					(catalog.current.model_reasoning_effort as ReasoningEffort)));
	const baseTarget =
		options.modelOverride !== undefined
			? selectedModel(options.modelOverride, selectedEffort)
			: options.profile !== undefined
				? selectedProfile(selected, selectedEffort)
				: catalog.current;
	const target =
		options.solModelOverride !== undefined && selected === "sol"
			? { ...baseTarget, model: options.solModelOverride }
			: baseTarget;

	const defaultHelper = catalog.roles["default"];
	const subagentModel = options.subagentModel ?? defaultHelper?.model ?? catalog.current.model;
	const subagentEffort =
		options.subagentEffort ??
		(defaultHelper?.model_reasoning_effort as ReasoningEffort | undefined) ??
		(catalog.current.model_reasoning_effort as ReasoningEffort);
	const unsafeSubagent = unsafeEffectiveRoute({ model: subagentModel, model_reasoning_effort: subagentEffort });
	if (unsafeSubagent !== null) {
		throw new CodexConfigMigrationError(
			"UNSAFE_MODEL_ROUTE",
			`Requested subagent default route is unsafe: ${unsafeSubagent}.`,
			null,
			{ model: subagentModel, effort: subagentEffort },
		);
	}

	const statePath = resolveStatePath(env);
	const state = await readState(statePath);
	const previousFiles = "files" in state ? state.files : undefined;
	const paths = await configPaths({ env, cwd });
	// Keep the managed generic role outside Codex's autodiscovered agents directory. The explicit
	// native binding remains the only dispatch mechanism for omitted-agent children.
	const nativeDefaultAgentConfigFile = join(dirname(paths[0] ?? ""), "litcodex-default.toml");
	if (mode === "install") await assertNoUnsafeInstallRoutes(paths);

	const nextState: MigrationState = { catalogVersion: catalog.version, files: {} };
	const changed: string[] = [];
	const backups: string[] = [];
	const skipped: MigrateSkip[] = [];

	for (const configPath of paths) {
		const previousState = previousFiles?.[configPath];
		let result: MigrateFileResult;
		try {
			result = await migrateConfigFile(configPath, {
				catalog,
				previousState,
				mode,
				dryRun,
				reconfigure,
				target,
				style: options.style,
				subagentModel,
				subagentEffort,
				nativeDefaultAgentConfigFile,
			});
		} catch (error) {
			if (mode === "install") {
				throw error; // fail-fast; backup (if any) already written.
			}
			// session-start: swallow, record, continue. Never re-throw.
			skipped.push({ path: configPath, reason: "error" });
			continue;
		}
		if (result.changed) {
			changed.push(configPath);
		}
		if (result.backup !== null) {
			backups.push(result.backup);
		}
		if (result.skipReason !== null) {
			skipped.push({ path: configPath, reason: result.skipReason });
		}
		nextState.files[configPath] = {
			catalogVersion: catalog.version,
			written: result.written,
			managed: result.managed,
		};
	}

	if (mode === "install") {
		const profileResult = await ensureGpt56ProfileFiles({
			codexHome: dirname(paths[0] ?? ""),
			dryRun,
			reconfigure,
			...(options.modelContexts === undefined ? {} : { modelContexts: options.modelContexts }),
		});
		changed.push(...profileResult.changed);
		backups.push(...profileResult.backups);
	}

	let stateWritten = false;
	if (dryRun) {
		changed.sort();
		backups.sort();
		return { changed, backups, skipped, stateWritten: false };
	}
	try {
		await writeState(statePath, nextState);
		stateWritten = true;
	} catch (error) {
		// A state-write failure must not strand a successfully-migrated config.
		if (mode === "install" && changed.length === 0) {
			throw new CodexConfigMigrationError(
				"STATE_UNWRITABLE",
				"Could not write the LitCodex migration state file.",
				null,
				{
					errno: errnoOf(error),
					statePath,
				},
			);
		}
		skipped.push({ path: statePath, reason: "error" });
	}

	changed.sort();
	backups.sort();
	return { changed, backups, skipped, stateWritten };
}

/** Per-file migration: read -> validate -> decide -> backup -> apply -> write. */
export async function migrateConfigFile(configPath: string, options: MigrateFileOptions): Promise<MigrateFileResult> {
	const { catalog, previousState, mode } = options;
	const reconfigure = options.reconfigure ?? false;
	const target = options.target ?? catalog.current;
	const dryRun = options.dryRun ?? false;
	const fileExisted = await configPathExists(configPath);
	const before = await readConfigFile(configPath);

	// Malformed detection (install: backup THEN throw; session-start: throw -> caught upstream).
	const shape = validateTomlShape(before);
	if (!shape.ok) {
		let backup: string | null = null;
		if (mode === "install" && fileExisted) {
			backup = await backupConfigFile(configPath);
		}
		throw new CodexConfigMigrationError(
			"CONFIG_MALFORMED",
			"Codex config could not be migrated safely; a backup was created.",
			configPath,
			{
				reason: shape.reason,
				line: shape.line,
				backup,
			},
		);
	}

	const current = readRootSettings(before);
	const unsafeRoute = unsafeEffectiveRoute(current);
	if (unsafeRoute !== null) {
		throw new CodexConfigMigrationError(
			"UNSAFE_MODEL_ROUTE",
			`Codex config contains an unsafe effective model route: ${unsafeRoute}.`,
			configPath,
			{ model: current.model ?? null, effort: current.model_reasoning_effort ?? null },
		);
	}

	const decision = decideCatalogApplication({
		current,
		target,
		catalog,
		previousState,
		reconfigure,
	});

	// Codex 0.144.0 reserves every unrecognized key in [agents] for an
	// AgentRoleToml table. The global default_subagent_* keys are not in
	// that pinned schema, so remove legacy LitCodex values before deciding
	// whether any other managed settings need to change.
	let config = removeSubagentDefaults(before);
	if (decision.apply) {
		config = ensureCodexReasoningConfig(config, target);
	}
	if (options.style !== undefined) {
		config = ensureLitCodexOutputStyleConfig(config, options.style);
	}
	const guardManaged = decision.apply || hasManagedMultiAgentGuard(before);
	if (guardManaged) {
		config = ensureStableMultiAgent(config);
	}
	if (decision.apply && options.nativeDefaultAgentConfigFile !== undefined) {
		config = ensureNativeDefaultAgentConfig(config, options.nativeDefaultAgentConfigFile, configPath);
	}

	const changed = config !== before;
	let backup: string | null = null;
	if (changed && !dryRun) {
		// Backup BEFORE the write so a crash mid-write leaves the backup intact.
		if (mode === "install" && fileExisted) {
			backup = await backupConfigFile(configPath);
		}
		await writeConfigFile(configPath, config);
	}

	const written = decision.apply ? target : readRootSettings(config);
	const managed = decision.apply ? true : decision.managed;
	const skipReason = changed
		? null
		: decision.reason === "managed-legacy"
			? "preserved"
			: decision.managed
				? "current"
				: "user-modified";
	return { changed, written, managed, backup, skipReason };
}

function errnoOf(error: unknown): string | null {
	if (error instanceof Error && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : null;
	}
	return null;
}
