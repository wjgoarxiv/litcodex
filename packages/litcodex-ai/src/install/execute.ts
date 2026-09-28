// M12 / T17 — install execution (S12 §execute.ts; addendum A3/A4/A5).
//
// SELF-CONTAINED + IDEMPOTENT. The ONLY child process ever spawned is `codex`. Each skippable
// registration step is PROBE-GATED before spawn (addendum A5.1) so a re-install is a guaranteed
// no-op regardless of Codex's own re-add exit codes. `config-update` is in-process: it calls
// `migrateCodexConfig({ env, cwd: codexHome, mode: "install" })` (A3 C4) and maps every
// `CodexConfigMigrationError` → `LITCODEX_INSTALL_CONFIG_WRITE_FAILED` (exit 3). `hooks-register`
// is a best-effort drift guard; the real hook is wired by `codex plugin add` from the marketplace.
// `agents-install` copies bundled litwork agent .toml files (resolved relative to THIS package, so
// npx/global installs work regardless of cwd) into <codexHome>/agents/ except the native generic
// default role, which is installed beside that directory and selected through the native binding;
// all writes remain backup-safe + idempotent.

import { CodexConfigMigrationError } from "../config-migration/errors.js";
import { EXPLICIT_GPT56_SOL_MODEL } from "../config-migration/gpt56-policy.js";
import type { MigrateOptions, MigrateResult } from "../config-migration/index.js";
import {
	type PreparedAgentSources,
	prepareAgentSources,
	runAgentsInstall,
	type WritableFsLike,
} from "./agents-install.js";
import { detectAuthMode } from "./auth-mode.js";
import { capabilityPreflightError } from "./capability-preflight-error.js";
import { findCodexBinary, type ReadonlyFsLike, resolveCodexHome, type SpawnLike } from "./codex.js";
import { InstallError } from "./errors.js";
import { defaultVerifyHook } from "./hook-verifier.js";
import { type HostCapabilities, modelContextsForWrites, probeHostCapabilities } from "./host-capabilities.js";
import { materializeManagedMarketplace } from "./marketplace-payload.js";
import { runRegistration } from "./registration.js";
import type {
	InstallPreflightResult,
	InstallPreflightStage,
	InstallResult,
	InstallStep,
	InstallStepResult,
	InstallStepStatus,
} from "./types.js";

export type { WritableFsLike } from "./agents-install.js";

/** Injectable side-effect surface (every default is overridable for tests). */
export interface ExecuteDeps {
	readonly spawn: SpawnLike;
	readonly fs: ReadonlyFsLike;
	readonly env: NodeJS.ProcessEnv;
	readonly now: () => number;
	/** Absolute development repo root retained for compatibility with injected hook verifiers. */
	readonly repoRoot: string;
	/** In-process config migration (defaults to the real M13 engine). */
	readonly migrateConfig: (opts: MigrateOptions) => Promise<MigrateResult>;
	/** Hook verification (defaults to the M14 resolvers over `repoRoot`). */
	readonly verifyHook?: (repoRoot: string) => void;
	/** Whether `--force` re-runs skippable steps despite a present probe. */
	readonly force?: boolean;
	/** Resolved Codex home (passed to `migrateCodexConfig` as `cwd`). */
	readonly codexHome?: string;
	/** Writable fs surface for agents-install (defaults to node:fs). */
	readonly writeFs?: WritableFsLike;
	/** Absolute path to the bundled agents source dir (defaults to resolved @litcodex/lit-loop/agents). */
	readonly agentsSourceDir?: string;
	/** Optional callback fired before each step begins (for TUI spinners). */
	readonly onStepStart?: (step: InstallStep) => void;
	/** Optional callback fired after each step completes (for TUI spinners). */
	readonly onStepEnd?: (result: InstallStepResult) => void;
	/** Optional callback fired when a visible pre-install preparation stage begins. */
	readonly onPreflightStart?: (stage: InstallPreflightStage) => void;
	/** Optional callback fired after a preparation stage completes or is intentionally skipped. */
	readonly onPreflightEnd?: (result: InstallPreflightResult) => void;
	/** Optional callback for install warnings that must remain visible in non-interactive modes. */
	readonly onWarning?: (message: string) => void;
	readonly profile?: import("../config-migration/gpt56-policy.js").Gpt56Profile;
	/** Explicit lead model id; "gpt-5.6-sol" routes the managed sol profile through the explicit id. */
	readonly leadModel?: string;
	readonly effort?: import("../config-migration/gpt56-policy.js").ReasoningEffort;
	readonly subagentModel?: string;
	readonly subagentEffort?: import("../config-migration/gpt56-policy.js").ReasoningEffort;
	readonly style?: string;
	readonly reconfigure?: boolean;
	readonly enforceCapabilityPreflight?: boolean;
	readonly hostCapabilities?: HostCapabilities;
	/** Package-bundled marketplace root. Omit only for explicit custom --repo/test flows. */
	readonly marketplaceSourceDir?: string;
	/** Internal: payload version changed, so replace an already-installed plugin. */
	readonly refreshPlugin?: boolean;
	readonly authMode?: import("./auth-mode.js").AuthMode;
	readonly preparedAgentSources?: PreparedAgentSources;
}

/**
 * Run the plan in order. Returns a `Promise<InstallResult>` (config-update is async). Throws a
 * typed `InstallError` on the first non-recoverable step failure; the dry-run path never calls this.
 */
export async function executeInstallPlan(steps: readonly InstallStep[], deps: ExecuteDeps): Promise<InstallResult> {
	// Pre-flight: discover `codex` (pure, no spawn). Null → hard "not found", exit 2, zero mutation.
	deps.onPreflightStart?.("host-capabilities");
	const codexBin = findCodexBinary(deps.env, deps.fs);
	if (codexBin === null) {
		throw new InstallError("LITCODEX_INSTALL_CODEX_NOT_FOUND", "Codex CLI not found on PATH or in CODEX_HOME.", {
			source: deps.env["CODEX_BIN"]?.trim() ? "CODEX_BIN" : "PATH",
		});
	}
	const codexHome = deps.codexHome ?? resolveCodexHome(deps.env);
	const authMode = detectAuthMode(deps.fs, codexHome);
	const preparedAgentSources = steps.some((step) => step.kind === "agents-install")
		? (deps.preparedAgentSources ??
			prepareAgentSources({
				now: deps.now,
				repoRoot: deps.repoRoot,
				...(deps.codexHome === undefined ? {} : { codexHome: deps.codexHome }),
				...(deps.writeFs === undefined ? {} : { writeFs: deps.writeFs }),
				...(deps.agentsSourceDir === undefined ? {} : { agentsSourceDir: deps.agentsSourceDir }),
				...(deps.subagentModel === undefined ? {} : { subagentModel: deps.subagentModel }),
				...(deps.subagentEffort === undefined ? {} : { subagentEffort: deps.subagentEffort }),
				authMode,
			}))
		: undefined;
	let hostCapabilities = deps.hostCapabilities;
	if (deps.enforceCapabilityPreflight === true) {
		hostCapabilities = probeHostCapabilities(codexBin, deps.spawn, {
			env: deps.env,
			...(deps.profile === undefined ? {} : { profile: deps.profile }),
			...(deps.leadModel === undefined ? {} : { model: deps.leadModel }),
			...(deps.effort === undefined ? {} : { effort: deps.effort }),
		});
		if (hostCapabilities.concurrency.status === "unavailable") {
			throw capabilityPreflightError(hostCapabilities, codexBin);
		}
	}
	deps.onPreflightEnd?.({
		stage: "host-capabilities",
		status: "ok",
		detail:
			hostCapabilities === undefined
				? "Codex CLI found"
				: `Codex host accepted · concurrency ${hostCapabilities.concurrency.status}`,
	});

	deps.onPreflightStart?.("config-dry-run");
	if (deps.enforceCapabilityPreflight === true && hostCapabilities !== undefined) {
		await deps.migrateConfig({
			env: deps.env,
			...(deps.codexHome === undefined ? {} : { cwd: deps.codexHome }),
			mode: "install",
			dryRun: true,
			...(deps.profile === undefined ? {} : { profile: deps.profile }),
			...(deps.leadModel === undefined ? {} : { modelOverride: deps.leadModel }),
			...(deps.effort === undefined ? {} : { effort: deps.effort }),
			...(deps.reconfigure === undefined ? {} : { reconfigure: deps.reconfigure }),
			...(deps.subagentModel === undefined ? {} : { subagentModel: deps.subagentModel }),
			...(deps.subagentEffort === undefined ? {} : { subagentEffort: deps.subagentEffort }),
			modelContexts: modelContextsForWrites(),
		});
		deps.onPreflightEnd?.({
			stage: "config-dry-run",
			status: "ok",
			detail: "strict config accepted · no files changed",
		});
	} else {
		deps.onPreflightEnd?.({
			stage: "config-dry-run",
			status: "skipped",
			detail: "host config validation not requested",
		});
	}

	deps.onPreflightStart?.("marketplace-payload");
	const marketplaceStep = steps.find((step) => step.kind === "marketplace-add");
	const marketplaceTarget = marketplaceStep?.command?.at(-1);
	const payload =
		deps.marketplaceSourceDir === undefined || marketplaceTarget === undefined
			? undefined
			: materializeManagedMarketplace({ sourceRoot: deps.marketplaceSourceDir, targetRoot: marketplaceTarget });
	for (const warning of payload?.warnings ?? []) deps.onWarning?.(warning);
	deps.onPreflightEnd?.({
		stage: "marketplace-payload",
		status: payload === undefined ? "skipped" : "ok",
		detail:
			payload === undefined
				? "custom or test marketplace source retained"
				: [
						payload.changed
							? "bundled marketplace payload staged"
							: "bundled marketplace payload already current",
						...(payload.warnings ?? []),
					].join(" · "),
	});
	const results: InstallStepResult[] = [];
	const effectiveDeps = {
		...deps,
		...(hostCapabilities === undefined ? {} : { hostCapabilities }),
		...(payload?.changed === true ? { refreshPlugin: true } : {}),
		authMode,
		...(preparedAgentSources === undefined ? {} : { preparedAgentSources }),
	};
	for (const step of steps) {
		deps.onStepStart?.(step);
		try {
			const result = await runStep(step, codexBin, effectiveDeps);
			deps.onStepEnd?.(result);
			results.push(result);
		} catch (error) {
			deps.onStepEnd?.({
				kind: step.kind,
				status: "failed",
				detail: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	return {
		ok: results.every((r) => r.status !== "failed"),
		steps: results,
		codexHome: deps.codexHome ?? "",
		...(hostCapabilities === undefined ? {} : { capabilities: hostCapabilities }),
	};
}

async function runStep(step: InstallStep, codexBin: string, deps: ExecuteDeps): Promise<InstallStepResult> {
	switch (step.kind) {
		case "marketplace-add":
			return runRegistration(step, codexBin, deps, "marketplace");
		case "plugin-add":
			return runRegistration(step, codexBin, deps, "plugin");
		case "hooks-register":
			return runHooksRegister(step, deps);
		case "agents-install":
			return runAgentsInstall(step, deps);
		case "config-update":
			return runConfigUpdate(step, deps);
		case "verify":
			return ok(step, "doctor passed");
	}
}

/** Verify the host wired the bundled UserPromptSubmit hook; fail loudly if the payload is broken. */
function runHooksRegister(step: InstallStep, deps: ExecuteDeps): InstallStepResult {
	try {
		const verify = deps.verifyHook ?? defaultVerifyHook;
		verify(deps.repoRoot);
	} catch (err) {
		throw new InstallError(
			"LITCODEX_INSTALL_HOOKS_MISSING",
			"Bundled lit-loop UserPromptSubmit hook payload is missing or malformed.",
			{ cause: err instanceof Error ? err.message : String(err) },
		);
	}
	return { kind: step.kind, status: "skipped", detail: "UserPromptSubmit hook wired (manifest-driven)" };
}

/** In-process config migration via the M13 engine; collapses all M13 codes → CONFIG_WRITE_FAILED. */
async function runConfigUpdate(step: InstallStep, deps: ExecuteDeps): Promise<InstallStepResult> {
	let res: MigrateResult;
	const migrateOpts: MigrateOptions = { env: deps.env, mode: "install" };
	if (deps.codexHome !== undefined) {
		migrateOpts.cwd = deps.codexHome;
	}
	try {
		res = await deps.migrateConfig({
			...migrateOpts,
			...(deps.profile === undefined ? {} : { profile: deps.profile }),
			...(deps.effort === undefined ? {} : { effort: deps.effort }),
			...(deps.style === undefined ? {} : { style: deps.style }),
			...(deps.reconfigure === undefined ? {} : { reconfigure: deps.reconfigure }),
			...(deps.hostCapabilities === undefined ? {} : { modelContexts: modelContextsForWrites() }),
			...(deps.subagentModel === undefined ? {} : { subagentModel: deps.subagentModel }),
			...(deps.subagentEffort === undefined ? {} : { subagentEffort: deps.subagentEffort }),
			...(deps.leadModel === undefined ? {} : { modelOverride: deps.leadModel }),
			...(deps.authMode === "chatgpt" || deps.leadModel === EXPLICIT_GPT56_SOL_MODEL
				? { solModelOverride: EXPLICIT_GPT56_SOL_MODEL }
				: {}),
		});
	} catch (e) {
		if (e instanceof CodexConfigMigrationError) {
			throw new InstallError("LITCODEX_INSTALL_CONFIG_WRITE_FAILED", e.message, {
				cause: e.code,
				configPath: e.configPath,
				...e.details,
			});
		}
		throw e;
	}
	const rootPreserved = res.skipped.some((skip) => skip.reason === "user-modified" || skip.reason === "preserved");
	if (res.changed.length > 0 && rootPreserved) {
		return mark(
			step,
			"ok",
			`config partially applied (${res.changed.length} file(s)); root preserved, review --dry-run then use --reconfigure for a one-time managed update`,
		);
	}
	if (res.changed.length > 0) {
		return mark(step, "ok", `config.toml managed keys updated (${res.changed.length} file(s))`);
	}
	if (rootPreserved) {
		return mark(
			step,
			"skipped",
			"config preserved; review --dry-run, then use --reconfigure for a one-time managed update",
		);
	}
	return mark(step, "skipped", "config.toml already current");
}

function ok(step: InstallStep, detail: string): InstallStepResult {
	return mark(step, "ok", detail);
}

function mark(step: InstallStep, status: InstallStepStatus, detail: string): InstallStepResult {
	return { kind: step.kind, status, detail };
}
