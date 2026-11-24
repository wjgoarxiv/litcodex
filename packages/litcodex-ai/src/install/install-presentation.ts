import { EXPLICIT_GPT56_SOL_MODEL, GPT56_MODELS } from "../config-migration/gpt56-policy.js";
import { amber, bold, dim, green, orange, red } from "../ui-style.js";
import { routingReport } from "./agent-routing.js";
import type { InstallErrorEnvelope } from "./errors.js";
import type { InstallCards, PanelRow, RowMark } from "./install-cards.js";
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

interface ReceiptOptions {
	readonly model: string;
	readonly effort: import("../config-migration/gpt56-policy.js").ReasoningEffort;
	readonly subagentModel?: string;
	readonly subagentEffort?: string;
}

interface ReceiptRow {
	readonly group: "installed" | "models" | "host";
	readonly label: string;
	readonly value: string;
	readonly quiet?: boolean;
}

/** What the install did and found, in receipt order: the receipt and the summary card show the same rows. */
function receiptRows(result: InstallResult, opts: ReceiptOptions): readonly ReceiptRow[] {
	const model = opts.model;
	const config = configDetail(result);
	const modelLabel = config.includes("preserved") ? "Requested model" : "Model";
	const agents = result.steps.find((step) => step.kind === "agents-install")?.detail ?? "not reported";
	const routes = result.steps.find((step) => step.kind === "agents-install")?.agentRoutes ?? [];
	const routing = routingReport(routes);
	const concurrency = result.capabilities?.concurrency;
	const compaction = result.capabilities?.autoCompaction;
	const contexts: Readonly<Record<string, number | null>> | undefined = result.capabilities?.modelContexts;
	const context = contexts?.[model === EXPLICIT_GPT56_SOL_MODEL ? GPT56_MODELS.sol : model] ?? null;
	const counts = summarizeSteps(result.steps);
	const rows: ReceiptRow[] = [
		{ group: "host", label: "Codex host", value: hostLabel(concurrency?.observedSource) },
		{ group: "models", label: modelLabel, value: `${model} · ${opts.effort}` },
		{
			group: "models",
			label: "Subagent route",
			value:
				opts.subagentModel === undefined
					? "host default"
					: `${opts.subagentModel} · ${opts.subagentEffort ?? "max"} (selected helper route)`,
		},
		{ group: "installed", label: "Marketplace", value: `${result.codexHome}/marketplaces/litcodex` },
		{ group: "installed", label: "Subagents", value: agents },
		{ group: "models", label: "Installed TOMLs", value: routing.installedTomls },
		{ group: "models", label: "Preserved routes", value: routing.preservedRoutes },
		{ group: "models", label: "Spawn override", value: routing.spawnOverride },
		{ group: "models", label: "Effective child", value: routing.effectiveChild },
		{ group: "installed", label: "Config", value: config },
		{
			group: "host",
			label: "Concurrency",
			value: capabilityLimit(concurrency?.limit, "threads", concurrency?.status),
		},
		{
			group: "host",
			label: "Context",
			value:
				context === null
					? "host default (unset) · probe metadata unavailable"
					: compaction?.status === "hard"
						? `host default (unset) · probe-only explicit override accepted at ${formatNumber(context)} tokens`
						: `host default (unset) · metadata observed at ${formatNumber(context)} tokens · override probe ${compaction?.status ?? "unavailable"}`,
		},
		{
			group: "host",
			label: "Auto-compact",
			value:
				compaction?.status === "hard"
					? "host default (unset) · probe-only explicit override accepted · hard"
					: `host default (unset) · probe ${compaction?.status ?? "unavailable"}`,
		},
		{
			group: "installed",
			label: "Steps",
			value: `${counts.ok} completed · ${counts.skipped} no change · ${counts.failed} failed`,
		},
	];
	if (concurrency !== undefined) {
		rows.push({ group: "host", label: "Concurrency proof", value: concurrency.reason, quiet: true });
	}
	if (compaction !== undefined) {
		rows.push({ group: "host", label: "Compaction proof", value: compaction.reason, quiet: true });
	}
	return rows;
}

function configDetail(result: InstallResult): string {
	return result.steps.find((step) => step.kind === "config-update")?.detail ?? "not reported";
}

const CONFIG_REVIEW = "Review `litcodex install --dry-run`; use --reconfigure only by intent.";

export function renderInstallReceipt(
	result: InstallResult,
	opts: ReceiptOptions & { readonly color: boolean },
): string {
	const lines = [
		"",
		`  ${orange("╭─ INSTALL RECEIPT", opts.color)}`,
		row("Status", result.ok ? green("Ready for Codex", opts.color) : red("Action required", opts.color)),
		...receiptRows(result, opts).map(({ label, value, quiet }) =>
			quiet === true ? detailRow(label, value, opts.color) : row(label, value),
		),
	];
	if (configDetail(result).includes("preserved")) lines.push(detailRow("Next", CONFIG_REVIEW, opts.color));
	if (result.ok) lines.push(`  ${orange("╰─ Installation complete", opts.color)}`);
	lines.push("");
	return lines.join("\n");
}

/** The closing card: the receipt's rows by section, the warnings, and what to do next. */
export function renderInstallSummary(
	cards: InstallCards,
	result: InstallResult,
	opts: ReceiptOptions & {
		readonly version: string;
		readonly agentFile: string;
		readonly warnings: readonly string[];
	},
): string {
	const rows = receiptRows(result, opts);
	const group = (name: ReceiptRow["group"], mark: RowMark): PanelRow[] =>
		rows.filter((entry) => entry.group === name).map(({ label, value }) => ({ mark, label, value }));
	const agentFile = opts.agentFile.replace(/^AGENT_FILE: /u, "");
	const preserved = configDetail(result).includes("preserved");
	return cards.panel({
		title: result.ok ? `LitCodex ${opts.version} is installed` : `LitCodex ${opts.version}: action required`,
		bad: !result.ok,
		sections: [
			{
				head: "Installed",
				rows: [
					{
						mark: result.ok ? "done" : "fail",
						label: "Status",
						value: result.ok ? "Ready for Codex" : "Action required",
					},
					...group("installed", "done").map(
						(entry): PanelRow => (entry.label === "Config" && preserved ? { ...entry, mark: "warn" } : entry),
					),
					{
						mark: /^(?:refused|symlink|not-)/u.test(agentFile)
							? "warn"
							: /^off/u.test(agentFile)
								? "skip"
								: "done",
						label: "AGENTS.md",
						value: agentFile,
					},
				],
			},
			{ head: "Warnings", rows: opts.warnings.map((value): PanelRow => ({ mark: "warn", value })) },
			{ head: "Models", rows: group("models", "note") },
			{ head: "Codex host", rows: group("host", "note") },
			{
				head: "Next",
				rows: [
					...(preserved ? [{ mark: "warn", label: "Config", value: CONFIG_REVIEW } as const] : []),
					...(result.ok
						? ([
								{
									mark: "note",
									label: "Codex",
									value: "restart Codex if it is open, and approve the LitCodex hooks when Codex asks",
								},
								{ mark: "note", label: "First task", value: "start a request with lit" },
							] as const)
						: []),
				],
			},
		],
	});
}

function failureRows(envelope: InstallErrorEnvelope): readonly (readonly [label: string, value: string])[] {
	return [
		["Code", envelope.error.code],
		["Reason", envelope.error.message],
		["Codex", failureHostDetail(envelope.error.details)],
		["Safety", "No later install steps were run."],
		["Next", "Resolve the reason above, then rerun `litcodex install`."],
	];
}

/** The same stop as a red card. */
export function renderInstallFailureCard(cards: InstallCards, envelope: InstallErrorEnvelope): string {
	return cards.panel({
		title: "Install stopped",
		bad: true,
		sections: [
			{
				rows: failureRows(envelope).map(([label, value], index) => ({
					mark: index < 3 ? "fail" : "note",
					label,
					value: label === "Safety" ? `${value} Exit without reporting success.` : value,
				})),
			},
		],
	});
}

export function renderInstallFailure(envelope: InstallErrorEnvelope, color: boolean): string {
	return [
		"",
		`  ${red("╭─ INSTALL STOPPED", color)}`,
		...failureRows(envelope).map(([label, value]) => row(label, value)),
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

/** A step's title as a row label: `Health check`. */
export function stepName(kind: InstallStepKind): string {
	const { title } = STEP_PRESENTATION[kind];
	return title.charAt(0) + title.slice(1).toLowerCase();
}
