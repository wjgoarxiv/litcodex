import { EXPLICIT_GPT56_SOL_MODEL, GPT56_MODELS } from "../config-migration/gpt56-policy.js";
import { amber, bold, dim, green, orange, red } from "../ui-style.js";
import { routingReport } from "./agent-routing.js";
import type { InstallErrorEnvelope } from "./errors.js";
import type { InstallResult, InstallStep, InstallStepKind, InstallStepResult } from "./types.js";

const STEP_PRESENTATION: Readonly<Record<InstallStepKind, { readonly title: string; readonly purpose: string }>> = {
	"marketplace-add": {
		title: "MARKETPLACE",
		purpose: "Prepare a stable local plugin source (no GitHub login required)",
	},
	"plugin-add": { title: "PLUGIN", purpose: "Install the LitCodex hooks, skills, and runtime components" },
	"hooks-register": { title: "HOOKS", purpose: "Confirm Codex can route the UserPromptSubmit lifecycle hook" },
	"agents-install": {
		title: "SUBAGENTS",
		purpose: "Install six selectable roles plus the native generic default route",
	},
	"config-update": {
		title: "CONFIG",
		purpose: "Apply recognized model and concurrency settings while retaining host-owned limits",
	},
	verify: { title: "HEALTH CHECK", purpose: "Verify the installed plugin, agents, config, and host capabilities" },
};

export function renderStepIntro(
	step: InstallStep,
	index: number,
	total: number,
	codexHome: string,
	color: boolean,
): string {
	const presentation = STEP_PRESENTATION[step.kind];
	const ordinal = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
	return [
		`  ${dim(ordinal, color)}  ${bold(amber(presentation.title, color), color)}`,
		`       ${presentation.purpose}`,
		`       ${dim(`target  ${stepTarget(step.kind, codexHome)}`, color)}`,
	].join("\n");
}

export function renderPreflightIntro(codexHome: string, color: boolean): string {
	return [
		`  ${orange("╭─ PREPARING INSTALL", color)}`,
		row("01 · Host", "host compatibility and model-context discovery"),
		row("02 · Config", "read-only config validation against Codex strict schema"),
		row("03 · Package", "package staging for the local marketplace"),
		detailRow("Target", codexHome, color),
		detailRow("Timing", "Each strict host probe may take up to 60 seconds.", color),
		`  ${orange("╰─ Config writes begin only at install step 05 / 06", color)}`,
		"",
	].join("\n");
}

export function renderStepResult(result: InstallStepResult, color: boolean): string {
	if (result.receipts === undefined || result.receipts.length === 0) return "";
	return `${result.receipts.map((line) => `       ${dim("│ codex", color)}  ${line}`).join("\n")}\n`;
}

export function renderInstallReceipt(
	result: InstallResult,
	opts: {
		readonly model: string;
		readonly effort: import("../config-migration/gpt56-policy.js").ReasoningEffort;
		readonly subagentModel?: string;
		readonly subagentEffort?: string;
		readonly color: boolean;
	},
): string {
	const model = opts.model;
	const config = result.steps.find((step) => step.kind === "config-update")?.detail ?? "not reported";
	const modelLabel = config.includes("preserved") ? "Requested model" : "Model";
	const agents = result.steps.find((step) => step.kind === "agents-install")?.detail ?? "not reported";
	const routes = result.steps.find((step) => step.kind === "agents-install")?.agentRoutes ?? [];
	const routing = routingReport(routes);
	const concurrency = result.capabilities?.concurrency;
	const compaction = result.capabilities?.autoCompaction;
	const contexts: Readonly<Record<string, number | null>> | undefined = result.capabilities?.modelContexts;
	const context = contexts?.[model === EXPLICIT_GPT56_SOL_MODEL ? GPT56_MODELS.sol : model] ?? null;
	const counts = summarizeSteps(result.steps);
	const lines = [
		"",
		`  ${orange("╭─ INSTALL RECEIPT", opts.color)}`,
		row("Status", result.ok ? green("Ready for Codex", opts.color) : red("Action required", opts.color)),
		row("Codex host", hostLabel(concurrency?.observedSource)),
		row(modelLabel, `${model} · ${opts.effort}`),
		row(
			"Subagent route",
			opts.subagentModel === undefined
				? "host default"
				: `${opts.subagentModel} · ${opts.subagentEffort ?? "max"} (selected helper route)`,
		),
		row("Marketplace", `${result.codexHome}/marketplaces/litcodex`),
		row("Subagents", agents),
		row("Installed TOMLs", routing.installedTomls),
		row("Preserved routes", routing.preservedRoutes),
		row("Spawn override", routing.spawnOverride),
		row("Effective child", routing.effectiveChild),
		row("Config", config),
		row("Concurrency", capabilityLimit(concurrency?.limit, "threads", concurrency?.status)),
		row(
			"Context",
			context === null
				? "host default (unset) · probe metadata unavailable"
				: compaction?.status === "hard"
					? `host default (unset) · probe-only explicit override accepted at ${formatNumber(context)} tokens`
					: `host default (unset) · metadata observed at ${formatNumber(context)} tokens · override probe ${compaction?.status ?? "unavailable"}`,
		),
		row(
			"Auto-compact",
			compaction?.status === "hard"
				? "host default (unset) · probe-only explicit override accepted · hard"
				: `host default (unset) · probe ${compaction?.status ?? "unavailable"}`,
		),
		row("Steps", `${counts.ok} completed · ${counts.skipped} no change · ${counts.failed} failed`),
	];
	if (concurrency !== undefined) lines.push(detailRow("Concurrency proof", concurrency.reason, opts.color));
	if (compaction !== undefined) lines.push(detailRow("Compaction proof", compaction.reason, opts.color));
	if (config.includes("preserved"))
		lines.push(
			detailRow("Next", "Review `litcodex install --dry-run`; use --reconfigure only by intent.", opts.color),
		);
	if (result.ok) lines.push(`  ${orange("╰─ Installation complete", opts.color)}`);
	lines.push("");
	return lines.join("\n");
}

export function renderInstallFailure(envelope: InstallErrorEnvelope, color: boolean): string {
	const hostDetail = failureHostDetail(envelope.error.details);
	return [
		"",
		`  ${red("╭─ INSTALL STOPPED", color)}`,
		row("Code", envelope.error.code),
		row("Reason", envelope.error.message),
		row("Codex", hostDetail),
		row("Safety", "No later install steps were run."),
		row("Next", "Resolve the reason above, then rerun `litcodex install`."),
		`  ${red("╰─ Exit without reporting success", color)}`,
		"",
	].join("\n");
}

function stepTarget(kind: InstallStepKind, codexHome: string): string {
	switch (kind) {
		case "marketplace-add":
			return `${codexHome}/marketplaces/litcodex`;
		case "plugin-add":
			return "litcodex@litcodex";
		case "hooks-register":
			return "UserPromptSubmit";
		case "agents-install":
			return `${codexHome}/agents`;
		case "config-update":
			return `${codexHome}/config.toml`;
		case "verify":
			return "litcodex doctor";
	}
}

function summarizeSteps(steps: readonly InstallStepResult[]): {
	readonly ok: number;
	readonly skipped: number;
	readonly failed: number;
} {
	return {
		ok: steps.filter((step) => step.status === "ok").length,
		skipped: steps.filter((step) => step.status === "skipped").length,
		failed: steps.filter((step) => step.status === "failed").length,
	};
}

function capabilityLimit(limit: number | undefined, unit: string, status: string | undefined): string {
	return limit === undefined
		? `host default · ${status ?? "unavailable"}`
		: `${formatNumber(limit)} ${unit} · ${status}`;
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function hostLabel(observedSource: string | undefined): string {
	return observedSource?.match(/codex-cli\s+\S+/)?.[0] ?? observedSource ?? "not reported";
}

function failureHostDetail(details: Readonly<Record<string, unknown>>): string {
	const stderr = details["stderr"];
	if (typeof stderr === "string" && stderr.trim().length > 0) return stderr.trim();
	const capabilities = details["capabilities"];
	if (!isRecord(capabilities)) return "No additional host output.";
	const concurrency = capabilities["concurrency"];
	if (!isRecord(concurrency)) return "No additional host output.";
	const fields = [concurrency["status"], concurrency["reason"], concurrency["observedSource"]].filter(
		(value): value is string => typeof value === "string" && value.length > 0,
	);
	return fields.length === 0 ? "No additional host output." : fields.join(" · ");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function row(label: string, value: string): string {
	return `  │ ${label.padEnd(13)} ${value}`;
}
function detailRow(label: string, value: string, color: boolean): string {
	return `  │ ${dim(label.padEnd(13), color)} ${dim(value, color)}`;
}
