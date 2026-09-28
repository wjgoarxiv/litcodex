// Installer model/effort prompts per the LitFamily installer choice contract.
// Model metadata and supported effort validation come from model-catalog.json through catalog.ts.
// Numbered readline menus, zero-based, default in brackets, no TUI library.

import type readline from "node:readline/promises";
import { FALLBACK_CATALOG, type ModelDefinition } from "../config-migration/catalog.js";
import type { Gpt56Profile, ReasoningEffort } from "../config-migration/gpt56-policy.js";
import { dim } from "../ui-style.js";
import { InstallError } from "./errors.js";

export interface ModelRouteSelection {
	readonly profile: Gpt56Profile;
	readonly leadModel: string;
	readonly effort: ReasoningEffort;
	readonly subagentModel: string;
	readonly subagentEffort: ReasoningEffort;
}

interface ConfirmationReader {
	readonly question: (prompt: string) => Promise<string>;
}

interface MenuRow {
	readonly model: string;
	readonly profile: Gpt56Profile;
	readonly effort: ReasoningEffort;
	readonly note: string;
}

function menuRows(role: "lead" | "helper"): readonly MenuRow[] {
	const preferredModel = role === "lead" ? FALLBACK_CATALOG.current.model : FALLBACK_CATALOG.roles["default"]?.model;
	const orderedModels = [...FALLBACK_CATALOG.models].sort((left, right) => {
		if (left.id === preferredModel) return -1;
		if (right.id === preferredModel) return 1;
		return left.priority - right.priority;
	});
	return orderedModels.flatMap((definition) =>
		definition.installerMenu[role].map((effort) => catalogRow(definition, effort, role)),
	);
}

function catalogRow(definition: ModelDefinition, effort: ReasoningEffort, role: "lead" | "helper"): MenuRow {
	if (!definition.configurableEfforts.includes(effort)) {
		throw new Error(`Invalid installer menu route: ${definition.id} · ${effort}`);
	}
	return {
		model: definition.id,
		profile: definition.configProfile,
		effort,
		note: menuNote(definition, effort, role),
	};
}

function menuNote(definition: ModelDefinition, effort: ReasoningEffort, role: "lead" | "helper"): string {
	if (effort !== definition.recommendedEffort) return "";
	if (definition.recommendedRole === "lead") return "— recommended lead";
	if (definition.recommendedRole === "coding-lead") return "— coding-lead alternative";
	if (definition.recommendedRole === "helper") {
		return role === "lead" ? "— recommended helper route" : "— recommended helper";
	}
	if (definition.recommendedRole === "previous-generation") {
		return `— previous-generation ${definition.displayName.replace(/^GPT-5\.6\s*/i, "")}`;
	}
	return "";
}

export const LEAD_MENU_ROWS: readonly MenuRow[] = menuRows("lead");

export const HELPER_MENU_ROWS: readonly MenuRow[] = menuRows("helper");

function menuLine(index: number, row: MenuRow): string {
	return `  ${String(index).padStart(2)}. ${row.model.padEnd(13)} · ${row.effort.padEnd(8)}${row.note}`.replace(
		/\s+$/,
		"",
	);
}

export function renderLeadModelMenu(): string {
	return ["Choose the LEAD model (plans and reviews).", ...LEAD_MENU_ROWS.map((row, i) => menuLine(i, row))].join(
		"\n",
	);
}

export function renderHelperModelMenu(): string {
	return [
		"Choose the HELPER model (spawned/delegated agents).",
		...HELPER_MENU_ROWS.map((row, i) => menuLine(i, row)),
	].join("\n");
}

/** Contract §Summary card: printed before any write; the caller waits for Enter. */
export function renderModelRouteSummary(
	route: Pick<ModelRouteSelection, "leadModel" | "effort" | "subagentModel" | "subagentEffort">,
	codexHome: string,
): string {
	return [
		"",
		"  ╭─ MODEL ROUTE",
		"  │ Provider   openai",
		`  │ Lead       ${route.leadModel} · ${route.effort}`,
		`  │ Helpers    ${route.subagentModel} · ${route.subagentEffort}`,
		`  │ Writes     ${codexHome}/config.toml  (managed keys only)`,
		"  ╰─ Enter to continue · Ctrl-C to abort (nothing written yet)",
		"",
	].join("\n");
}

export async function waitForModelRouteConfirmation(rl: ConfirmationReader, color: boolean): Promise<void> {
	await rl.question(`  ${dim("Press Enter to install · Ctrl-C to abort:", color)} `);
}

async function chooseIndex(
	rl: readline.Interface,
	stdout: NodeJS.WritableStream,
	menu: string,
	rowCount: number,
	defaultIndex: number,
): Promise<number> {
	stdout.write(`\n${menu}\n`);
	const answer = ((await rl.question(`Select 0-${String(rowCount - 1)} [${String(defaultIndex)}]: `)) ?? "").trim();
	if (answer.length === 0) return defaultIndex;
	const selected = Number.parseInt(answer, 10);
	if (Number.isInteger(selected) && selected >= 0 && selected < rowCount) return selected;
	throw new InstallError("LITCODEX_INSTALL_BAD_FLAG", `Invalid model selection: ${answer}`, { flag: "--model" });
}

/** Run the contract's lead + helper prompts. The caller decides when prompting is allowed. */
export async function promptModelRoute(
	rl: readline.Interface,
	stdout: NodeJS.WritableStream,
): Promise<ModelRouteSelection> {
	const leadIndex = await chooseIndex(rl, stdout, renderLeadModelMenu(), LEAD_MENU_ROWS.length, 0);
	const lead = LEAD_MENU_ROWS[leadIndex] ?? LEAD_MENU_ROWS[0];
	const helperIndex = await chooseIndex(rl, stdout, renderHelperModelMenu(), HELPER_MENU_ROWS.length, 0);
	const helper = HELPER_MENU_ROWS[helperIndex] ?? HELPER_MENU_ROWS[0];
	if (lead === undefined || helper === undefined) {
		throw new InstallError("LITCODEX_INSTALL_BAD_FLAG", "Model menu selection failed.", { flag: "--model" });
	}
	return {
		profile: lead.profile,
		leadModel: lead.model,
		effort: lead.effort,
		subagentModel: helper.model,
		subagentEffort: helper.effort,
	};
}
