// M12 / T17 — doctor health report (S12 §doctor; A2 §6.6 — installer-side install health).
//
// Read-only: spawns ONLY the `codex … list` probes (never a mutating command). Reports whether the
// marketplace is registered, the plugin installed, the hook wired, the config managed, and whether
// a `codex` binary was even found. `ok` is true only when every check passes.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { EXPLICIT_GPT56_SOL_MODEL, GPT56_MODELS } from "../config-migration/gpt56-policy.js";
import { isNewer } from "../update-check.js";
import { inspectAgentRouting, routingReport } from "./agent-routing.js";
import { detectAuthMode } from "./auth-mode.js";
import { probeBundledSkills } from "./bundled-skills.js";
import {
	findCodexBinary,
	probeMarketplaceRegistration,
	probePluginInstalled,
	type ReadonlyFsLike,
	resolveCodexHome,
	type SpawnLike,
} from "./codex.js";
import { inspectEffectiveConfig } from "./doctor-config.js";
import { modelContextsForWrites, probeHostCapabilities } from "./host-capabilities.js";
import { canonicalMarketplacePath, LITCODEX_MARKETPLACE, managedMarketplaceRoot } from "./marketplace.js";
import { probeSkillCatalogPayload } from "./skill-catalog.js";
import type { AutoUpdateDoctorReport, DoctorReport, JevSkillHintState } from "./types.js";

export { renderDoctorText } from "./doctor-render.js";

const PACKAGE_VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;
const MAX_DIAGNOSTIC_FAMILIES = 2;
const MAX_DIAGNOSTIC_PATHS = 2;
const MAX_DIAGNOSTIC_PATH_LENGTH = 120;

function boundedCatalogSummary(missingSkillIds: readonly string[], missingResourcePaths: readonly string[]): string {
	const byFamily = new Map<string, string[]>();
	const add = (family: string, path: string) => {
		const paths = byFamily.get(family) ?? [];
		paths.push(path.length > MAX_DIAGNOSTIC_PATH_LENGTH ? `${path.slice(0, MAX_DIAGNOSTIC_PATH_LENGTH - 1)}…` : path);
		byFamily.set(family, paths);
	};
	for (const skillId of missingSkillIds) add(skillId, `${skillId}/SKILL.md`);
	for (const path of missingResourcePaths) {
		const integrity = path.match(/^<(.+)-payload-integrity>$/u);
		add(integrity?.[1] ?? path.split("/", 1)[0] ?? "unknown", path);
	}
	const families = [...byFamily.entries()].sort(([left], [right]) => left.localeCompare(right));
	const summaries = families.slice(0, MAX_DIAGNOSTIC_FAMILIES).map(([family, paths]) => {
		const shown = paths.slice(0, MAX_DIAGNOSTIC_PATHS);
		const remainder = paths.length - shown.length;
		return `${family}: ${paths.length} missing [${shown.join(", ")}${remainder > 0 ? `, +${remainder} more` : ""}]`;
	});
	const remainingFamilies = families.length - summaries.length;
	if (remainingFamilies > 0) summaries.push(`+${remainingFamilies} more families`);
	return summaries.join("; ");
}

export interface DoctorDeps {
	readonly spawn: SpawnLike;
	readonly fs: ReadonlyFsLike;
	readonly env: NodeJS.ProcessEnv;
	readonly repoRoot: string;
	/** Hook verification (defaults to the M14 resolvers over repoRoot). */
	readonly verifyHook?: (repoRoot: string) => void;
}

export function runDoctor(deps: DoctorDeps): DoctorReport {
	const codexBin = findCodexBinary(deps.env, deps.fs);
	const codexBinaryFound = codexBin !== null;
	const issues: string[] = [];
	const warnings: string[] = [];
	const unavailableCapabilities = {
		concurrency: {
			status: "unavailable" as const,
			reason: "codex-binary-unavailable",
			observedSource: "Codex binary discovery",
		},
		autoCompaction: {
			status: "unavailable" as const,
			reason: "codex-binary-unavailable",
			observedSource: "Codex binary discovery",
		},
		modelContexts: modelContextsForWrites(),
	};

	if (!codexBinaryFound) {
		issues.push("Codex CLI not found on PATH or in CODEX_HOME.");
		return {
			ok: false,
			marketplaceRegistered: false,
			pluginInstalled: false,
			hooksWired: false,
			configManaged: false,
			effectiveConfig: { state: "unavailable", detail: "Codex CLI not found" },
			agentRouting: routingReport([]),
			codexBinaryFound: false,
			agentsInstalled: false,
			skillCatalogComplete: false,
			missingSkillIds: [],
			missingSkillResourcePaths: [],
			handoffInstalled: false,
			scientificVisualizationInstalled: false,
			capabilities: unavailableCapabilities,
			autoUpdate: readAutoUpdateReport(deps.env),
			jevSkillHint: jevSkillHintState(deps.env),
			issues,
			warnings,
		};
	}

	const codexHome = resolveCodexHome(deps.env);
	const managedRoot = managedMarketplaceRoot(codexHome);
	const registration = probeMarketplaceRegistration(codexBin, deps.spawn);
	const marketplaceRegistered =
		registration?.source !== null &&
		registration?.source !== undefined &&
		canonicalMarketplacePath(registration.source) === canonicalMarketplacePath(managedRoot);
	const capabilities = probeHostCapabilities(codexBin, deps.spawn, { env: deps.env });
	if (!marketplaceRegistered) {
		issues.push("LitCodex managed local marketplace is not registered. Run `litcodex install`.");
	}
	const pluginInstalled = probePluginInstalled(codexBin, deps.spawn);
	if (!pluginInstalled) {
		issues.push("LitCodex plugin is not installed. Run `litcodex install`.");
	}

	let hooksWired = payloadHealthy(deps.fs, managedRoot);
	try {
		(deps.verifyHook ?? (() => undefined))(managedRoot);
	} catch {
		hooksWired = false;
	}
	if (!hooksWired) issues.push("Bundled UserPromptSubmit hook payload is missing or malformed.");

	const effectiveConfig = inspectEffectiveConfig(deps.fs, join(codexHome, "config.toml"));
	const configManaged = effectiveConfig.state !== "unavailable";
	if (effectiveConfig.state === "unavailable") {
		issues.push(`Codex config unavailable: ${effectiveConfig.detail}.`);
	}
	const authMode = detectAuthMode(deps.fs, codexHome);
	const agentRouting = inspectAgentRouting(deps.fs, codexHome, authMode);
	const agentsInstalled = agentRouting.healthy;
	if (!agentsInstalled) {
		issues.push("LitCodex litwork agent roles are not installed. Run `litcodex install`.");
		for (const issue of agentRouting.issues) issues.push(`Agent routing ${issue}.`);
	}
	const bundledSkills = probeBundledSkills(deps.fs, managedRoot);
	const skillCatalog = probeSkillCatalogPayload(deps.fs, managedRoot);
	if (!skillCatalog.complete) {
		issues.push(
			`Bundled skill catalog is incomplete (${boundedCatalogSummary(skillCatalog.missingSkillIds, skillCatalog.missingResourcePaths)}). Run \`litcodex install\`.`,
		);
	}
	if (!bundledSkills.handoffInstalled) {
		issues.push("Bundled lit-handoff payload is incomplete. Run `litcodex install`.");
	}
	if (!bundledSkills.scientificVisualizationInstalled) {
		issues.push("Bundled lit-scientific-visualization payload is incomplete. Run `litcodex install`.");
	}
	if (capabilities.concurrency.status === "unavailable") {
		issues.push(`Concurrency 20 is ${capabilities.concurrency.status}: ${capabilities.concurrency.reason}.`);
	} else if (capabilities.concurrency.status === "advisory") {
		warnings.push(`Concurrency 20 is advisory: ${capabilities.concurrency.reason}.`);
	}

	if (authMode === "chatgpt") {
		const rootModel = effectiveConfig.state !== "unavailable" ? effectiveConfig.detail : "";
		const rootUsesAlias = new RegExp(`^${GPT56_MODELS.sol.replaceAll(".", "\\.")}(?:\\s|$)`).test(rootModel);
		if (rootUsesAlias) {
			issues.push(
				`ChatGPT-subscription auth detected with model ${GPT56_MODELS.sol}: the API rejects this alias for ChatGPT accounts. Run \`litcodex install --reconfigure\` to route through ${EXPLICIT_GPT56_SOL_MODEL}.`,
			);
		}
	} else if (authMode === "unknown") {
		warnings.push(
			"Codex auth mode could not be determined (auth.json absent or unrecognized). ChatGPT-subscription accounts may fail with the public gpt-5.6 alias; run `litcodex install` after authenticating.",
		);
	}
	const autoUpdate = readAutoUpdateReport(deps.env);
	if (autoUpdate.status === "unknown-state") {
		issues.push(
			`Foreground auto-update rollback failed; installation state is unknown. Inspect ${autoUpdate.receiptPath} and reinstall the exact stable package.`,
		);
	}

	return {
		ok: issues.length === 0,
		marketplaceRegistered,
		pluginInstalled,
		hooksWired,
		configManaged,
		effectiveConfig,
		agentRouting,
		codexBinaryFound,
		agentsInstalled,
		skillCatalogComplete: skillCatalog.complete,
		missingSkillIds: skillCatalog.missingSkillIds,
		missingSkillResourcePaths: skillCatalog.missingResourcePaths,
		...bundledSkills,
		capabilities,
		autoUpdate,
		jevSkillHint: jevSkillHintState(deps.env),
		issues,
		warnings,
	};
}

/** Mirrors the lit-loop hook switch: `LITCODEX_JEV=1` plus a non-empty `TYPESAFE_API_KEY`. */
function jevSkillHintState(env: NodeJS.ProcessEnv): JevSkillHintState {
	if (env["LITCODEX_JEV"] !== "1") return "off";
	return (env["TYPESAFE_API_KEY"]?.trim() ?? "") !== "" ? "on" : "flag on but TYPESAFE_API_KEY missing";
}

/** Read the updater receipt without touching the updater lock, journal, or npm. */
function readAutoUpdateReport(env: NodeJS.ProcessEnv): AutoUpdateDoctorReport {
	const configuredRoot = env["LITCODEX_AUTO_UPDATE_STATE_ROOT"]?.trim();
	const dataRoot = env["LITCODEX_DATA_ROOT"]?.trim() || join(homedir(), ".litcodex");
	const stateRoot = configuredRoot || join(dataRoot, "auto-update");
	const receiptPath = join(stateRoot, "receipt.json");
	const enabled =
		!Object.hasOwn(env, "LITCODEX_NO_AUTO_UPDATE") &&
		!Object.hasOwn(env, "NO_UPDATE_NOTIFIER") &&
		!Object.hasOwn(env, "LITCODEX_NO_UPDATE_CHECK");
	try {
		const parsed: unknown = JSON.parse(readFileSync(receiptPath, "utf8"));
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const fields = parsed as Record<string, unknown>;
			const status = fields["status"];
			if (typeof status === "string") {
				const target = fields["latestVersion"];
				// A failed update whose target the installed package has since reached (or passed) is history:
				// a later install finished the job, so the old receipt no longer describes this machine.
				if (
					status === "unknown-state" &&
					typeof target === "string" &&
					(target === PACKAGE_VERSION || isNewer(PACKAGE_VERSION, target))
				) {
					return {
						enabled,
						status: "resolved",
						receiptPath,
						detail: `an earlier update to ${target} did not finish, and ${PACKAGE_VERSION} is installed now`,
					};
				}
				return {
					enabled,
					status,
					receiptPath,
					detail: "receipt present",
				};
			}
		}
	} catch {
		// A missing or malformed receipt is a healthy read-only no-receipt state, not a doctor issue.
	}
	return { enabled, status: null, receiptPath, detail: "no receipt yet" };
}

function payloadHealthy(fs: DoctorDeps["fs"], root: string): boolean {
	const marketplacePath = join(root, ".agents", "plugins", "marketplace.json");
	const pluginPath = join(root, "plugins", "litcodex", ".codex-plugin", "plugin.json");
	const hooksPath = join(root, "plugins", "litcodex", "hooks", "hooks.json");
	if (![marketplacePath, pluginPath, hooksPath].every((path) => fs.existsSync(path))) return false;
	try {
		const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8")) as { name?: unknown };
		const plugin = JSON.parse(fs.readFileSync(pluginPath, "utf8")) as { name?: unknown; version?: unknown };
		const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as { hooks?: unknown };
		return (
			marketplace.name === LITCODEX_MARKETPLACE &&
			plugin.name === "litcodex" &&
			plugin.version === PACKAGE_VERSION &&
			typeof hooks.hooks === "object" &&
			hooks.hooks !== null
		);
	} catch {
		return false;
	}
}
