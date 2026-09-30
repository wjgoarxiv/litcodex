import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptedModelIds, FALLBACK_CATALOG, modelDefinition } from "../config-migration/catalog.js";
import { parseConfigMigrateArgs } from "../config-migration/cli.js";
import { chatgptDesiredRouteModel, GPT6_MODELS, GPT56_MODELS } from "../config-migration/gpt56-policy.js";
import { modelContextsForWrites } from "./host-capabilities.js";
import {
	HELPER_MENU_ROWS,
	LEAD_MENU_ROWS,
	renderHelperModelMenu,
	renderLeadModelMenu,
	renderModelRouteSummary,
	waitForModelRouteConfirmation,
} from "./install-model-prompt.js";
import { parseInstallOptions } from "./install-options.js";
import { runUninstall } from "./uninstall.js";

const CONTEXT = { env: { CODEX_HOME: "/tmp/isolated-codex-home" }, repoRoot: "/repo" };
interface AuthoredModelMenu {
	id: string;
	aliases: string[];
	generation: string;
	recommended_role: string;
	legacy_profile?: string;
	context_probe?: boolean;
	supported_efforts: string[];
	configurable_efforts: string[];
	safe_existing_efforts?: string[];
	installer_menu: { lead: string[]; helper: string[] };
}

interface AuthoredCatalog {
	current: { model: string; model_reasoning_effort: string };
	roles: Record<string, { model: string; model_reasoning_effort: string }>;
	models: AuthoredModelMenu[];
}

const authoredCatalog = JSON.parse(
	readFileSync(new URL("../../model-catalog.json", import.meta.url), "utf8"),
) as AuthoredCatalog;
const authoredModels = authoredCatalog.models;

function assertRowsUseBundledCatalog(rows: readonly { readonly model: string }[]): void {
	const bundledIds = new Set(acceptedModelIds());
	const absent = rows.map((row) => row.model).filter((model) => !bundledIds.has(model));
	if (absent.length > 0) throw new Error(`menu rows name absent bundled model ids: ${absent.join(", ")}`);
}

describe("install --model / --subagent-model matrix", () => {
	it("keeps the authored JSON catalog aligned with accepted ids, supported efforts, and installer rows", () => {
		const authoredIds = authoredModels.flatMap((model) => [model.id, ...model.aliases]);
		expect(acceptedModelIds()).toEqual(authoredIds);
		expect(parseInstallOptions([], CONTEXT)).toMatchObject({
			leadModel: authoredCatalog.current.model,
			effort: authoredCatalog.current.model_reasoning_effort,
			subagentModel: authoredCatalog.roles["default"]?.model,
			subagentEffort: authoredCatalog.roles["default"]?.model_reasoning_effort,
		});
		expect(parseConfigMigrateArgs([])).toMatchObject({
			model: authoredCatalog.current.model,
			effort: authoredCatalog.current.model_reasoning_effort,
		});
		expect(GPT6_MODELS).toEqual({
			astra: authoredCatalog.roles["plan"]?.model,
			sol: authoredModels.find((model) => model.recommended_role === "coding-lead")?.id,
			luna: authoredCatalog.roles["default"]?.model,
		});
		expect(GPT56_MODELS).toEqual(
			Object.fromEntries(
				authoredModels
					.filter((model) => model.legacy_profile !== undefined)
					.map((model) => [model.legacy_profile, model.id]),
			),
		);
		expect(Object.keys(modelContextsForWrites()).sort()).toEqual(
			authoredModels
				.filter((model) => model.context_probe === true)
				.map((model) => model.id)
				.sort(),
		);

		const pairs = (rows: readonly { readonly model: string; readonly effort: string }[]) =>
			rows.map((row) => `${row.model}/${row.effort}`).sort();
		const leadPairs = authoredModels.flatMap((model) =>
			model.installer_menu.lead.map((effort) => `${model.id}/${effort}`),
		);
		const helperPairs = authoredModels.flatMap((model) =>
			model.installer_menu.helper.map((effort) => `${model.id}/${effort}`),
		);
		expect(pairs(LEAD_MENU_ROWS)).toEqual([...leadPairs].sort());
		expect(pairs(HELPER_MENU_ROWS)).toEqual([...helperPairs].sort());

		for (const model of authoredModels.filter((entry) => entry.generation === "gpt-6")) {
			expect([...model.installer_menu.lead].sort()).toEqual([...model.supported_efforts].sort());
			expect([...model.installer_menu.helper].sort()).toEqual([...model.supported_efforts].sort());
			expect([...model.configurable_efforts].sort()).toEqual([...model.supported_efforts].sort());
			for (const effort of model.configurable_efforts) {
				expect(() => parseInstallOptions(["--model", model.id, "--effort", effort], CONTEXT)).not.toThrow();
				expect(() =>
					parseInstallOptions(["--subagent-model", model.id, "--subagent-effort", effort], CONTEXT),
				).not.toThrow();
			}
		}
		const allEfforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
		for (const model of authoredModels) {
			for (const effort of allEfforts) {
				const shouldAccept = model.configurable_efforts.includes(effort);
				const lead = () => parseInstallOptions(["--model", model.id, "--effort", effort], CONTEXT);
				const helper = () =>
					parseInstallOptions(["--subagent-model", model.id, "--subagent-effort", effort], CONTEXT);
				if (shouldAccept) {
					expect(lead).not.toThrow();
					expect(helper).not.toThrow();
					expect(() => parseConfigMigrateArgs(["--model", model.id, "--effort", effort])).not.toThrow();
				} else {
					expect(lead).toThrow();
					expect(helper).toThrow();
					expect(() => parseConfigMigrateArgs(["--model", model.id, "--effort", effort])).toThrow();
				}
			}
		}
	});

	it("keeps the authored GPT-6 facts and the retiring-only legacy marker in the catalog", () => {
		expect(modelDefinition("gpt-6-astra")?.supportedEfforts).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"ultra",
		]);
		expect(modelDefinition("gpt-6.1-sol")?.recommendedRole).toBe("coding-lead");
		expect(modelDefinition("gpt-6.1-sol")?.supportedEfforts).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"ultra",
		]);
		expect(modelDefinition("gpt-6-sol")?.recommendedRole).toBe("previous-generation");
		expect(modelDefinition("gpt-6-luna")?.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
		expect(modelDefinition("gpt-5.6-sol")?.retirement).toBeUndefined();
		expect(modelDefinition("gpt-5.6-terra")?.retirement).toBeUndefined();
		expect(modelDefinition("gpt-5.6-luna")?.retirement).toBeUndefined();
		expect(modelDefinition("gpt-5.6-terra")?.safeExistingEfforts).toEqual(["high", "xhigh"]);
		expect(modelDefinition("gpt-5.6-luna")?.safeExistingEfforts).toEqual(["high", "max"]);
		expect(modelDefinition("gpt-5.5")?.retirement).toEqual({
			retirementAt: "2026-10-14T19:00:00Z",
			upgradeModel: "gpt-5.6-sol",
		});
		expect(FALLBACK_CATALOG.roles["default"]).toEqual({ model: "gpt-6-luna", model_reasoning_effort: "max" });
	});

	it("accepts the formal Astra choice for lead and helper with every public effort", () => {
		const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
		for (const effort of efforts) {
			const opts = parseInstallOptions(
				[
					"--model",
					"gpt-6-astra",
					"--effort",
					effort,
					"--subagent-model",
					"gpt-6-astra",
					"--subagent-effort",
					effort,
				],
				CONTEXT,
			);
			expect(opts.profile).toBe("astra");
			expect(opts.leadModel).toBe("gpt-6-astra");
			expect(opts.effort).toBe(effort);
			expect(opts.subagentModel).toBe("gpt-6-astra");
			expect(opts.subagentEffort).toBe(effort);
		}
	});

	it("recommends GPT-6.1 Sol as the coding-lead alternative and keeps GPT-6 Sol selectable as the previous generation", () => {
		expect(GPT6_MODELS.sol).toBe("gpt-6.1-sol");
		expect(renderLeadModelMenu()).toContain("gpt-6.1-sol   · xhigh   — coding-lead alternative");
		expect(renderLeadModelMenu()).toMatch(/gpt-6-sol\s+· xhigh\s+— previous-generation/);
		expect(renderLeadModelMenu()).not.toMatch(/gpt-6-sol\s+· \w+\s+— coding-lead/);
		const next = parseInstallOptions(["--model", "gpt-6.1-sol", "--effort", "ultra"], CONTEXT);
		expect(next.leadModel).toBe("gpt-6.1-sol");
		expect(next.profile).toBe("sol");
		expect(next.effort).toBe("ultra");
		expect(parseInstallOptions(["--model", "gpt-6.1-sol"], CONTEXT).effort).toBe("xhigh");
		const helper = parseInstallOptions(["--subagent-model", "gpt-6.1-sol", "--subagent-effort", "max"], CONTEXT);
		expect(helper.subagentModel).toBe("gpt-6.1-sol");
		expect(helper.subagentEffort).toBe("max");
	});

	it("accepts GPT-6 Sol and Luna from the catalog while rejecting Luna ultra", () => {
		const sol = parseInstallOptions(["--model", "gpt-6-sol", "--effort", "low"], CONTEXT);
		expect(sol.leadModel).toBe("gpt-6-sol");
		expect(sol.effort).toBe("low");

		const luna = parseInstallOptions(["--subagent-model", "gpt-6-luna", "--subagent-effort", "max"], CONTEXT);
		expect(luna.subagentModel).toBe("gpt-6-luna");
		expect(luna.subagentEffort).toBe("max");

		expect(() =>
			parseInstallOptions(["--subagent-model", "gpt-6-luna", "--subagent-effort", "ultra"], CONTEXT),
		).toThrow(/--subagent-effort for gpt-6-luna requires one of: low, medium, high, xhigh, or max/i);
	});

	it("uses Astra/xhigh for a fresh lead while using GPT-6 Luna/max for ordinary helpers", () => {
		const opts = parseInstallOptions([], CONTEXT);
		expect(opts.profile).toBe("astra");
		expect(opts.leadModel).toBe("gpt-6-astra");
		expect(opts.effort).toBe("xhigh");
		expect(opts.subagentModel).toBe("gpt-6-luna");
		expect(opts.subagentEffort).toBe("max");
	});

	it("keeps fresh defaults with no flags (Astra/xhigh lead, GPT-6 Luna/max helpers, no --yes)", () => {
		const opts = parseInstallOptions([], CONTEXT);
		expect(opts.profile).toBe("astra");
		expect(opts.leadModel).toBe("gpt-6-astra");
		expect(opts.effort).toBe("xhigh");
		expect(opts.subagentModel).toBe("gpt-6-luna");
		expect(opts.subagentEffort).toBe("max");
		expect(opts.yes).toBe(false);
	});

	it.each([
		["gpt-6-sol", "gpt-6-sol", "sol", "xhigh"],
		["gpt-6-luna", "gpt-6-luna", "luna", "max"],
		["sol", "gpt-5.6-sol", "sol", "xhigh"],
		["gpt-5.6", "gpt-5.6", "sol", "high"],
		["luna", "gpt-5.6-luna", "luna", "max"],
		["terra", "gpt-5.6-terra", "terra", "xhigh"],
	])("--model %s resolves model id %s (profile %s, default effort %s)", (flag, id, profile, effort) => {
		const opts = parseInstallOptions(["--model", flag], CONTEXT);
		expect(opts.leadModel).toBe(id);
		expect(opts.profile).toBe(profile);
		expect(opts.effort).toBe(effort);
	});

	it("rejects an unknown --model value with the catalog ids", () => {
		expect(() => parseInstallOptions(["--model", "mercury"], CONTEXT)).toThrow(/gpt-6-sol.*gpt-6-luna/);
	});

	it("rejects an effort outside the selected catalog bounds", () => {
		expect(() => parseInstallOptions(["--model", "luna", "--effort", "xhigh"], CONTEXT)).toThrow(
			"--effort for gpt-5.6-luna requires one of: high or max",
		);
	});

	it("rejects an effort outside the selected catalog bounds for Terra", () => {
		expect(() => parseInstallOptions(["--model", "terra", "--effort", "max"], CONTEXT)).toThrow(
			"--effort for gpt-5.6-terra requires one of: high or xhigh",
		);
	});

	it("accepts --subagent-model and --subagent-effort", () => {
		const opts = parseInstallOptions(["--subagent-model", "terra", "--subagent-effort", "xhigh"], CONTEXT);
		expect(opts.subagentModel).toBe("gpt-5.6-terra");
		expect(opts.subagentEffort).toBe("xhigh");
	});

	it("rejects an effort outside the selected catalog bounds for Luna helpers", () => {
		expect(() => parseInstallOptions(["--subagent-model", "luna", "--subagent-effort", "xhigh"], CONTEXT)).toThrow(
			"--subagent-effort for gpt-5.6-luna requires one of: high or max",
		);
	});

	it("accepts GPT-6 Sol as a helper alternative", () => {
		const opts = parseInstallOptions(["--subagent-model", "gpt-6-sol", "--subagent-effort", "xhigh"], CONTEXT);
		expect(opts.subagentModel).toBe("gpt-6-sol");
		expect(opts.subagentEffort).toBe("xhigh");
	});

	it("accepts --yes as a prompt-free install", () => {
		const opts = parseInstallOptions(["--yes"], CONTEXT);
		expect(opts.yes).toBe(true);
		expect(opts.leadModel).toBe("gpt-6-astra");
		expect(opts.subagentModel).toBe("gpt-6-luna");
	});

	it("accepts the documented --no-auto-update install flag without changing defaults", () => {
		const opts = parseInstallOptions(["--yes", "--no-auto-update"], CONTEXT);
		expect(opts.yes).toBe(true);
		expect(opts.leadModel).toBe("gpt-6-astra");
		expect(opts.subagentModel).toBe("gpt-6-luna");
	});
});

describe("installer menus and summary card (contract snapshot)", () => {
	it("offers only model ids from the bundled Codex catalog", () => {
		assertRowsUseBundledCatalog([...LEAD_MENU_ROWS, ...HELPER_MENU_ROWS]);
	});

	it("the bundled-model guard rejects a fabricated menu row", () => {
		expect(() => assertRowsUseBundledCatalog([{ model: "gpt-fictional" }])).toThrow("gpt-fictional");
	});

	it("renders the LEAD menu from every authored installer row", () => {
		expect(LEAD_MENU_ROWS).toHaveLength(
			authoredModels.reduce((count, model) => count + model.installer_menu.lead.length, 0),
		);
		expect(LEAD_MENU_ROWS.some((row) => row.model === "gpt-5.6")).toBe(false);
		expect(LEAD_MENU_ROWS[0]).toMatchObject({
			model: FALLBACK_CATALOG.current.model,
			effort: FALLBACK_CATALOG.current.model_reasoning_effort,
		});
		for (const model of authoredModels.filter((entry) => entry.generation === "gpt-6")) {
			for (const effort of model.supported_efforts) {
				expect(renderLeadModelMenu()).toContain(`${model.id.padEnd(13)} · ${effort}`);
			}
		}
	});

	it("renders the HELPER menu from every authored installer row", () => {
		expect(HELPER_MENU_ROWS).toHaveLength(
			authoredModels.reduce((count, model) => count + model.installer_menu.helper.length, 0),
		);
		expect(HELPER_MENU_ROWS.some((row) => row.model === "gpt-5.6")).toBe(false);
		expect(HELPER_MENU_ROWS[0]).toMatchObject({
			model: FALLBACK_CATALOG.roles["default"]?.model,
			effort: FALLBACK_CATALOG.roles["default"]?.model_reasoning_effort,
		});
		for (const model of authoredModels.filter((entry) => entry.generation === "gpt-6")) {
			for (const effort of model.supported_efforts) {
				expect(renderHelperModelMenu()).toContain(`${model.id.padEnd(13)} · ${effort}`);
			}
		}
	});

	it("keeps the effort marker aligned across every rendered menu row", () => {
		for (const menu of [renderLeadModelMenu(), renderHelperModelMenu()]) {
			const markerColumns = menu
				.split("\n")
				.slice(1)
				.map((line) => line.indexOf("·"));
			expect(new Set(markerColumns)).toEqual(new Set([20]));
		}
	});

	it("renders the MODEL ROUTE summary card and passes a visible confirmation prompt to readline", async () => {
		const card = renderModelRouteSummary(
			{ leadModel: "gpt-5.6-sol", effort: "xhigh", subagentModel: "gpt-5.6-luna", subagentEffort: "max" },
			"/home/user/.codex",
		);
		expect(card).toContain("╭─ MODEL ROUTE");
		expect(card).toContain("│ Provider   openai");
		expect(card).toContain("│ Lead       gpt-5.6-sol · xhigh");
		expect(card).toContain("│ Helpers    gpt-5.6-luna · max");
		expect(card).toContain("│ Writes     /home/user/.codex/config.toml  (managed keys only)");
		expect(card).toContain("╰─ Enter to continue · Ctrl-C to abort (nothing written yet)");
		let prompt = "";
		await waitForModelRouteConfirmation(
			{
				question: async (value: string): Promise<string> => {
					prompt = value;
					return "";
				},
			},
			false,
		);
		expect(prompt).toBe("  Press Enter to install · Ctrl-C to abort: ");
		expect(prompt.length).toBeGreaterThan(0);
	});
});

describe("ChatGPT-auth Sol dispatch fix", () => {
	it("fires for the catalog's explicit gpt-5.6-sol id and for the bare alias", () => {
		expect(chatgptDesiredRouteModel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
		expect(chatgptDesiredRouteModel("gpt-5.6")).toBe("gpt-5.6-sol");
		expect(chatgptDesiredRouteModel("gpt-5.6-luna")).toBe("gpt-5.6-luna");
		expect(chatgptDesiredRouteModel("gpt-5.6-terra")).toBe("gpt-5.6-terra");
	});
});

describe("uninstall removes the managed subagent keys", () => {
	it("strips default_subagent_model/effort from config.toml and keeps the rest", () => {
		const codexHome = "/tmp/codex-home";
		const config = [
			'model = "gpt-5.6-luna"',
			"[agents]",
			"max_depth = 1",
			'default_subagent_model = "gpt-5.6-luna"',
			'default_subagent_reasoning_effort = "max"',
			"",
		].join("\n");
		const writes = new Map<string, string>();
		const result = runUninstall({
			codexBin: "/usr/local/bin/codex",
			codexHome,
			spawn: (_cmd, _args) => ({ status: 0 }),
			fs: {
				existsSync: () => true,
				readdirSync: () => [],
				rmSync: () => undefined,
				readFileSync: () => config,
				writeFileSync: (path, data) => {
					writes.set(path, data);
				},
			},
		});
		expect(result.ok).toBe(true);
		const written = writes.get(`${codexHome}/config.toml`) ?? "";
		expect(written).not.toContain("default_subagent_model");
		expect(written).not.toContain("default_subagent_reasoning_effort");
		expect(written).toContain('model = "gpt-5.6-luna"');
		expect(written).toContain("max_depth = 1");
	});
});
