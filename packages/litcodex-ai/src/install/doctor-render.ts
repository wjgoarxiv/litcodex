import { autoHandoffLine } from "./auto-handoff-doctor.js";
import { hookReviewLine } from "./auto-update-doctor.js";
import type { DoctorReport, TuiSuggestion } from "./types.js";

const MAX_RESOURCE_FAMILIES = 2;
const MAX_RESOURCE_EXAMPLES = 2;
const MAX_RESOURCE_PATH_LENGTH = 120;

export function renderDoctorText(report: DoctorReport): string {
	const lines = [
		"litcodex doctor",
		`  binary:       ${yn(report.codexBinaryFound)}`,
		`  marketplace:  ${yn(report.marketplaceRegistered)}`,
		`  plugin:       ${yn(report.pluginInstalled)}`,
		`  hook:         ${yn(report.hooksWired)}`,
		`  managed config: ${yn(report.configManaged)}`,
		`  agent file:  ${report.agentFile}`,
		`  config:       ${report.effectiveConfig.state} (${report.effectiveConfig.detail})`,
		`  agent config: ${report.agentRouting.desiredConfig}`,
		`  agent TOMLs:  ${report.agentRouting.installedTomls}`,
		`  spawn:        ${report.agentRouting.spawnOverride}`,
		`  child route:  ${report.agentRouting.effectiveChild}`,
		`  agents:       ${yn(report.agentsInstalled)}`,
		`  skills complete: ${yn(report.skillCatalogComplete)}`,
		...(report.missingSkillResourcePaths.length > 0
			? [`  missing skill resources: ${missingResourceSummary(report.missingSkillResourcePaths)}`]
			: []),
		`  lit-handoff: ${yn(report.handoffInstalled)}`,
		`  science payload: ${yn(report.scientificVisualizationInstalled)}`,
		...(report.autoUpdate === undefined
			? []
			: [
					`  auto-update: ${report.autoUpdate.enabled ? "enabled" : "disabled"} (${report.autoUpdate.status ?? "no receipt"}; ${report.autoUpdate.detail})`,
					...(report.autoUpdate.remedy === undefined ? [] : [`    → ${report.autoUpdate.remedy}`]),
					...autoUpdateHookLines(report.autoUpdate.hookReview),
				]),
		...(report.autoHandoff === undefined ? [] : [`  automatic handoff: ${autoHandoffLine(report.autoHandoff)}`]),
		...(report.statusCard === undefined
			? []
			: [
					`  card:         Codex desktop app only; needs the app's MCP Apps feature${report.statusCard.serverInstalled ? "" : " (server missing)"}`,
				]),
		`  concurrency: ${capabilityText(report.capabilities.concurrency)}`,
		`  probe-only explicit context/auto-compaction override: ${capabilityText(report.capabilities.autoCompaction)}`,
	];
	if (report.issues.length > 0) {
		lines.push("Issues:");
		for (const issue of report.issues) lines.push(`  - ${issue}`);
	}
	if (report.warnings.length > 0) {
		lines.push("Warnings:");
		for (const warning of report.warnings) lines.push(`  - ${warning}`);
	}
	// A cosmetic tip would only crowd real issues, so it waits for a clean run.
	if (report.issues.length === 0 && report.tuiSuggestion) lines.push(...tuiSuggestionLines(report.tuiSuggestion));
	if (report.issues.length === 0) lines.push("All checks passed.");
	return lines.join("\n");
}

function tuiSuggestionLines(suggestion: TuiSuggestion): string[] {
	const what = suggestion.missing
		.map((key) => (key === "status_line" ? "status line" : "terminal title"))
		.join(" and ");
	const commands = suggestion.missing.map((key) => (key === "status_line" ? "/statusline" : "/title")).join(" and ");
	const where = {
		"new-table": `paste this into ${suggestion.configPath}`,
		"existing-table": `add these lines under the [tui] table in ${suggestion.configPath}`,
		"root-dotted": `add these lines above the first table in ${suggestion.configPath}`,
	}[suggestion.placement];
	return [
		`Suggestion: your Codex config has no built-in ${what}. LitCodex never edits it for you.`,
		`  Pick items in Codex with ${commands}, or ${where}:`,
		...suggestion.snippet.split("\n").map((line) => `    ${line}`),
		...(suggestion.missing.includes("status_line")
			? ["  task-progress counts the steps of Codex's own plan; the LIT workflow map shows the stage on activation."]
			: []),
	];
}

function missingResourceSummary(paths: readonly string[]): string {
	const byFamily = new Map<string, string[]>();
	for (const path of paths) {
		const integrity = path.match(/^<(.+)-payload-integrity>$/u);
		const family = integrity?.[1] ?? path.split("/", 1)[0] ?? "unknown";
		const familyPaths = byFamily.get(family) ?? [];
		familyPaths.push(
			path.length > MAX_RESOURCE_PATH_LENGTH ? `${path.slice(0, MAX_RESOURCE_PATH_LENGTH - 1)}…` : path,
		);
		byFamily.set(family, familyPaths);
	}
	const families = [...byFamily.entries()].sort(([left], [right]) => left.localeCompare(right));
	const examples = families.slice(0, MAX_RESOURCE_FAMILIES).map(([family, familyPaths]) => {
		const shown = familyPaths.slice(0, MAX_RESOURCE_EXAMPLES);
		const remainder = familyPaths.length - shown.length;
		return `${family}: ${familyPaths.length} missing [${shown.join(", ")}${remainder > 0 ? `, +${remainder} more` : ""}]`;
	});
	const remainingFamilies = families.length - examples.length;
	if (remainingFamilies > 0) examples.push(`+${remainingFamilies} more families`);
	const familyLabel = families.length === 1 ? "family" : "families";
	return `${paths.length} across ${families.length} ${familyLabel} (${examples.join("; ")}; full paths: --json)`;
}

function autoUpdateHookLines(review: import("./types.js").AutoUpdateHookReview | undefined): string[] {
	const line = review === undefined ? null : hookReviewLine(review);
	return line === null ? [] : [`  ${line}`];
}

function yn(value: boolean): string {
	return value ? "yes" : "no";
}

function capabilityText(report: import("./host-capabilities.js").CapabilityReport): string {
	return `${report.status} (${report.reason}; source: ${report.observedSource})`;
}
