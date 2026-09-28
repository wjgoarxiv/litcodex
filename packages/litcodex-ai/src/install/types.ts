// M12 / T17 — installer shared types (S12 §Public-contract types.ts).
//
// Pure type declarations only. The installer is self-contained: the ONLY child process it ever
// spawns is `codex`; no exec-wrapper, no forwarder. `--dry-run` performs zero spawns and zero writes.

/** Parsed, typed install options (parse-don't-validate boundary out of argv). */
export interface InstallOptions {
	readonly dryRun: boolean;
	readonly noTui: boolean;
	readonly autonomous: boolean;
	readonly force: boolean;
	readonly json: boolean;
	readonly yes: boolean;
	readonly profile: import("../config-migration/gpt56-policy.js").Gpt56Profile;
	/** Explicit lead model id (e.g. "gpt-5.6-sol", "gpt-5.6", "gpt-5.6-luna"). */
	readonly leadModel: string;
	readonly effort: import("../config-migration/gpt56-policy.js").ReasoningEffort;
	/** Selected helper route (Codex 0.144.0 has no global helper-default key). */
	readonly subagentModel: string;
	readonly subagentEffort: import("../config-migration/gpt56-policy.js").ReasoningEffort;
	readonly style?: string;
	readonly reconfigure: boolean;
	/** Resolved absolute Codex home (never relative). */
	readonly codexHome: string;
	/** Stable local marketplace path, or an explicit developer `--repo` override. */
	readonly repoUrl: string;
	/** Absolute repo root used to resolve the bundled marketplace metadata / hooks. */
	readonly repoRoot: string;
}

export type InstallStepKind =
	| "marketplace-add"
	| "plugin-add"
	| "hooks-register"
	| "agents-install"
	| "config-update"
	| "verify";

export interface InstallStep {
	readonly kind: InstallStepKind;
	/** Human one-line label (LitCodex-native; no legacy tokens). */
	readonly title: string;
	/** argv to spawn (always `codex …`), or null for an in-process step. */
	readonly command: readonly string[] | null;
	/** True when a prior identical state makes this a probe-gated no-op. */
	readonly skippable: boolean;
}

export type InstallStepStatus = "ok" | "skipped" | "failed";

export type InstallPreflightStage = "host-capabilities" | "config-dry-run" | "marketplace-payload";

export interface InstallPreflightResult {
	readonly stage: InstallPreflightStage;
	readonly status: Exclude<InstallStepStatus, "failed">;
	readonly detail: string;
}

export interface InstallStepResult {
	readonly kind: InstallStepKind;
	readonly status: InstallStepStatus;
	readonly detail: string;
	/** Clean child-process lines captured for decorated, post-spinner receipts. */
	readonly receipts?: readonly string[];
	readonly agentRoutes?: readonly AgentRoute[];
}

export interface AgentRoute {
	readonly file: string;
	readonly role: string;
	readonly model: string;
	readonly effort: string;
}

export interface AgentRoutingReport {
	readonly healthy: boolean;
	readonly issues: readonly string[];
	readonly desiredConfig: string;
	readonly installedTomls: string;
	/** Safe user-owned route differences retained during an ordinary reinstall. */
	readonly preservedRoutes: string;
	readonly spawnOverride: string;
	readonly effectiveChild: string;
}

export interface InstallResult {
	readonly ok: boolean;
	readonly steps: readonly InstallStepResult[];
	readonly codexHome: string;
	readonly capabilities?: import("./host-capabilities.js").HostCapabilities;
}

export interface DoctorReport {
	readonly ok: boolean;
	readonly marketplaceRegistered: boolean;
	readonly pluginInstalled: boolean;
	readonly hooksWired: boolean;
	readonly configManaged: boolean;
	readonly effectiveConfig: EffectiveConfigReport;
	readonly agentRouting: AgentRoutingReport;
	readonly codexBinaryFound: boolean;
	readonly agentsInstalled: boolean;
	readonly skillCatalogComplete: boolean;
	readonly missingSkillIds: readonly string[];
	readonly missingSkillResourcePaths: readonly string[];
	readonly handoffInstalled: boolean;
	readonly scientificVisualizationInstalled: boolean;
	readonly capabilities: import("./host-capabilities.js").HostCapabilities;
	readonly issues: readonly string[];
	readonly warnings: readonly string[];
	/** Read-only foreground update barrier state; the updater owns the receipt/journal files. */
	readonly autoUpdate?: AutoUpdateDoctorReport;
	/** Opt-in Jev skill hint switch, read from this process's environment. Never carries the key. */
	readonly jevSkillHint?: JevSkillHintState;
}

export type JevSkillHintState = "off" | "on" | "flag on but TYPESAFE_API_KEY missing";

export interface AutoUpdateDoctorReport {
	readonly enabled: boolean;
	readonly status: string | null;
	readonly receiptPath: string;
	readonly detail: string;
}

export interface EffectiveConfigReport {
	readonly state: "applied" | "preserved" | "unavailable";
	readonly detail: string;
}
