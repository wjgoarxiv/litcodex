import { FALLBACK_CATALOG } from "../config-migration/catalog.js";
import type { Gpt56Profile, ReasoningEffort } from "../config-migration/gpt56-policy.js";
import {
	ASTRA_MODEL,
	alignedContextLimits,
	GPT56_AUTO_COMPACT_TOKEN_LIMIT,
	GPT56_MODELS,
} from "../config-migration/gpt56-policy.js";
import type { SpawnLike } from "./codex.js";
import { type CodexVersionSupport, classifyCodexVersion } from "./codex-version.js";
import { probeStrictConfig } from "./strict-config-probe.js";

const HARD_CONCURRENCY_LIMIT = 20;
const PROBE_TIMEOUT_MS = 5_000;
const MODELS = FALLBACK_CATALOG.models.filter((model) => model.contextProbe).map((model) => model.id);

export type CapabilityStatus = "hard" | "advisory" | "unavailable";

export interface CapabilityReport {
	readonly status: CapabilityStatus;
	readonly reason: string;
	readonly observedSource: string;
	readonly limit?: number;
	/** Extra diagnostic text observed from Codex itself: a startup warning on acceptance, or the doctor-reported failure detail on host-config-incompatible rejection. */
	readonly detail?: string;
}

export interface HostCapabilities {
	readonly concurrency: CapabilityReport;
	readonly autoCompaction: CapabilityReport;
	readonly modelContexts: Readonly<Record<string, number | null>>;
}

export interface CapabilityProbeSelection {
	readonly profile?: Gpt56Profile;
	readonly model?: string;
	readonly effort?: ReasoningEffort;
	readonly env?: NodeJS.ProcessEnv;
}

export function probeHostCapabilities(
	codexBin: string,
	spawn: SpawnLike,
	selection: CapabilityProbeSelection = {},
): HostCapabilities {
	const versionResult = run(spawn, codexBin, ["--version"], PROBE_TIMEOUT_MS, selection.env);
	const versionSupport = classifyCodexVersion(versionResult.stdout, versionResult.stderr);
	const modelsResult = run(spawn, codexBin, ["debug", "models", "--bundled"], PROBE_TIMEOUT_MS, selection.env);
	const modelContexts = parseModelContexts(modelsResult);
	const selectedModel = selection.model ?? modelForProfile(selection.profile);
	const selectedEffort = selection.effort ?? "max";
	const selectedContextLimits =
		selectedModel === ASTRA_MODEL ? undefined : alignedContextLimits(modelContexts[selectedModel]);
	const strictOverrides = [
		`model=${JSON.stringify(selectedModel)}`,
		`model_reasoning_effort=${JSON.stringify(selectedEffort)}`,
		"features.multi_agent=true",
		"features.multi_agent_v2.enabled=true",
		"features.multi_agent_v2.hide_spawn_agent_metadata=true",
		`features.multi_agent_v2.max_concurrent_threads_per_session=${HARD_CONCURRENCY_LIMIT}`,
		"agents.max_depth=1",
	];
	const rootProbe = probeStrictConfig({
		codexBin,
		spawn,
		overrides: strictOverrides,
		...(selection.env === undefined ? {} : { env: selection.env }),
	});
	const contextProbe =
		selectedContextLimits === undefined
			? { kind: "rejected" as const }
			: probeStrictConfig({
					codexBin,
					spawn,
					...(selection.env === undefined ? {} : { env: selection.env }),
					overrides: [
						`model=${JSON.stringify(selectedModel)}`,
						`model_reasoning_effort=${JSON.stringify(selectedEffort)}`,
						`model_context_window=${selectedContextLimits.contextWindow}`,
						`model_auto_compact_token_limit=${selectedContextLimits.autoCompactTokenLimit}`,
					],
				});
	// Only when the override probe is rejected: replay the identical doctor call with
	// zero LitCodex overrides. The probe copies the machine's real config.toml into the
	// probe home, so a rejection can come from that pre-existing config rather than from
	// anything LitCodex asked for — and those two causes need different advice. Skipped
	// on the happy path so a successful install still costs one strict-config spawn.
	const baselineProbe =
		rootProbe.kind === "rejected"
			? probeStrictConfig({
					codexBin,
					spawn,
					overrides: [],
					...(selection.env === undefined ? {} : { env: selection.env }),
				})
			: undefined;
	const concurrency = concurrencyReport({
		rootAccepted: rootProbe.kind === "accepted",
		hostConfigRejected: baselineProbe?.kind === "rejected",
		timedOut: isTimeout(versionResult) || rootProbe.kind === "timeout",
		versionSupport,
		...(rootProbe.kind === "accepted" && rootProbe.warning !== undefined ? { rootWarning: rootProbe.warning } : {}),
		...(baselineProbe?.kind === "rejected" && baselineProbe.detail !== undefined
			? { hostConfigDetail: baselineProbe.detail }
			: {}),
	});
	return {
		concurrency,
		autoCompaction: autoCompactionReport({
			eligible: selectedContextLimits !== undefined,
			accepted: contextProbe.kind === "accepted",
			timedOut: isTimeout(modelsResult) || contextProbe.kind === "timeout",
			contexts: [selectedModel === ASTRA_MODEL ? null : (modelContexts[selectedModel] ?? null)],
		}),
		modelContexts,
	};
}

export function modelContextsForWrites(): HostCapabilities["modelContexts"] {
	return Object.fromEntries(MODELS.map((model) => [model, null]));
}

function concurrencyReport(args: {
	readonly rootAccepted: boolean;
	/** The no-override baseline was rejected too, so the machine's own config is the cause. */
	readonly hostConfigRejected?: boolean;
	readonly timedOut: boolean;
	readonly versionSupport: CodexVersionSupport;
	/** Codex's own startup warning text when the accepted probe still carried one (advisory, config.toml still parsed). */
	readonly rootWarning?: string;
	/** Codex's own doctor-reported detail for why the no-override baseline failed to load. */
	readonly hostConfigDetail?: string;
}): CapabilityReport {
	const observedSource = `codex-cli ${args.versionSupport.version ?? "unknown"} strict-config + version policy`;
	if (args.timedOut) return { status: "unavailable", reason: "host-probe-timeout", observedSource };
	if (args.versionSupport.kind === "too-old") {
		return { status: "unavailable", reason: "codex-version-too-old", observedSource };
	}
	if (args.versionSupport.kind === "prerelease") {
		return { status: "unavailable", reason: "codex-version-prerelease", observedSource };
	}
	if (args.versionSupport.kind === "unrecognized") {
		return { status: "unavailable", reason: "codex-version-unrecognized", observedSource };
	}
	if (!args.rootAccepted) {
		const reason = args.hostConfigRejected === true ? "host-config-incompatible" : "strict-config-rejected";
		return {
			status: "unavailable",
			reason,
			observedSource,
			...(args.hostConfigDetail === undefined ? {} : { detail: args.hostConfigDetail }),
		};
	}
	const detail = args.rootWarning === undefined ? {} : { detail: args.rootWarning };
	if (args.versionSupport.kind === "newer-stable") {
		return {
			status: "advisory",
			limit: HARD_CONCURRENCY_LIMIT,
			reason:
				"strict config accepted on a newer stable Codex; configured concurrency is usable but runtime enforcement is not yet source-verified",
			observedSource,
			...detail,
		};
	}
	return {
		status: "hard",
		limit: HARD_CONCURRENCY_LIMIT,
		reason:
			"strict-config accepted the reserved collaboration schema, max_concurrent_threads_per_session=20, and agents.max_depth=1",
		observedSource,
		...detail,
	};
}

function autoCompactionReport(args: {
	readonly eligible: boolean;
	readonly accepted: boolean;
	readonly timedOut: boolean;
	readonly contexts: readonly (number | null)[];
}): CapabilityReport {
	const observedSource = args.accepted ? "codex debug models + strict-config" : "codex debug models";
	if (args.timedOut) return { status: "unavailable", reason: "host-probe-timeout", observedSource };
	if (!args.eligible) {
		return {
			status: "unavailable",
			reason: args.contexts.some((value) => value === null)
				? "model-metadata-unavailable"
				: "model-context-not-verified-at-372000",
			observedSource,
		};
	}
	return args.accepted
		? {
				status: "hard",
				limit: GPT56_AUTO_COMPACT_TOKEN_LIMIT,
				reason:
					"probe-only explicit override acceptance for context 372000 and auto-compaction 334800; managed config remains unset",
				observedSource,
			}
		: { status: "unavailable", reason: "strict-config-rejected", observedSource };
}

function run(
	spawn: SpawnLike,
	command: string,
	args: readonly string[],
	timeout = PROBE_TIMEOUT_MS,
	env?: NodeJS.ProcessEnv,
): ReturnType<SpawnLike> {
	return spawn(command, args, { stdio: "pipe", timeout, ...(env === undefined ? {} : { env }) });
}

function parseModelContexts(result: ReturnType<SpawnLike>): HostCapabilities["modelContexts"] {
	const empty = Object.fromEntries(MODELS.map((model) => [model, null])) as Record<string, number | null>;
	if (result.error || result.status !== 0) return empty;
	try {
		const parsed: unknown = JSON.parse(result.stdout ?? "");
		if (!isRecord(parsed) || !Array.isArray(parsed["models"])) return empty;
		const contexts: Record<string, number | null> = { ...empty };
		for (const item of parsed["models"]) {
			if (!isRecord(item)) continue;
			const slug = item["slug"];
			const context = item["context_window"];
			if (
				typeof slug === "string" &&
				MODELS.some((model) => model === slug) &&
				typeof context === "number" &&
				Number.isFinite(context)
			) {
				contexts[slug] = context;
			}
		}
		return contexts;
	} catch (error) {
		if (error instanceof SyntaxError) return empty;
		throw error;
	}
}

function modelForProfile(profile: Gpt56Profile | undefined): string {
	if (profile === "astra") return ASTRA_MODEL;
	if (profile === undefined) return GPT56_MODELS.luna;
	return GPT56_MODELS[profile];
}

function isTimeout(result: ReturnType<SpawnLike>): boolean {
	return result.error instanceof Error && "code" in result.error && result.error.code === "ETIMEDOUT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
