import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateCodexConfig } from "../config-migration/index.js";
import { parseAgentRoute } from "./agent-routing.js";
import { runAgentsInstall } from "./agents-install.js";
import { parseInstallOptions } from "./install-options.js";
import { renderInstallReceipt } from "./install-presentation.js";
import { makeMemWriteFs } from "./install-test-helpers.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(config: string) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-routing-contract-"));
	roots.push(root);
	const codexHome = join(root, "codex-home");
	mkdirSync(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	writeFileSync(configPath, config);
	return {
		root,
		codexHome,
		configPath,
		env: {
			CODEX_HOME: codexHome,
			LITCODEX_MODEL_CATALOG_STATE_PATH: join(root, "state.json"),
			LITCODEX_DATA: join(root, "data"),
		},
	};
}

function routeFromToml(path: string) {
	const text = readFileSync(path, "utf8");
	return {
		role: basename(path, ".toml").replace(/^litcodex-/, ""),
		model: text.match(/^model = "([^"]+)"$/m)?.[1],
		effort: text.match(/^model_reasoning_effort = "([^"]+)"$/m)?.[1],
	};
}

describe("GPT-5.6 routing policy", () => {
	it("rejects Luna below high before preflight or mutation", () => {
		expect(() =>
			parseInstallOptions(["--model", "luna", "--effort", "medium"], {
				env: { CODEX_HOME: "/tmp/isolated-codex-home" },
				repoRoot: "/repo",
			}),
		).toThrow("--effort for gpt-5.6-luna requires one of: high or max");
	});

	it.each([
		["gpt-5.6-luna", "medium"],
		["gpt-5.6-luna", "low"],
		["openai/gpt-5.6-luna", "medium"],
		["custom/gpt-5.6-luna", "low"],
		["gpt-5.6-terra", "medium"],
		["gpt-5.6-terra", "low"],
		["openai/gpt-5.6-terra", "medium"],
		["custom/gpt-5.6-terra", "low"],
	])("fails closed for unsafe effective route %s/%s without rewriting it", async (model, effort) => {
		const original = `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`;
		const state = fixture(original);

		await expect(migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" })).rejects.toMatchObject({
			code: "UNSAFE_MODEL_ROUTE",
		});
		expect(readFileSync(state.configPath, "utf8")).toBe(original);
	});

	it("preserves a provider-qualified explicit user override", async () => {
		const original = 'model = "custom/gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\n';
		const state = fixture(original);

		const result = await migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" });

		expect(readFileSync(state.configPath, "utf8")).toBe(original);
		expect(result.skipped).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: state.configPath, reason: "user-modified" })]),
		);
	});

	it("preserves exact SOL/medium as an explicit non-managed override", async () => {
		const original = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\n';
		const state = fixture(original);

		const result = await migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" });

		expect(readFileSync(state.configPath, "utf8")).toBe(original);
		expect(result.skipped).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: state.configPath, reason: "user-modified" })]),
		);
	});

	it.each([
		["custom/gpt-5.6-lunatic", "high"],
		["custom/my-gpt-5.6-terra", "low"],
	])("does not reject a non-terminal lookalike model id %s", async (model, effort) => {
		const original = `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`;
		const state = fixture(original);

		const result = await migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" });

		expect(readFileSync(state.configPath, "utf8")).toBe(original);
		expect(result.skipped).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: state.configPath, reason: "user-modified" })]),
		);
	});

	it.each([
		["openai/gpt-5.6-luna", "medium"],
		["custom/gpt-5.6-terra", "medium"],
	])("rejects unsafe bundled agent route %s/%s before writing any TOML", (model, effort) => {
		const sourceDir = "/fake/agents";
		const codexHome = "/tmp/isolated-agent-home";
		const file = "litcodex-unsafe.toml";
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${sourceDir}/${file}`, `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`],
			]),
			sourceDirEntries: new Map([[sourceDir, [file]]]),
		});

		expect(() =>
			runAgentsInstall(
				{ kind: "agents-install", title: "test", command: null, skippable: false },
				{ now: () => 0, repoRoot: "/repo", codexHome, writeFs: wfs, agentsSourceDir: sourceDir },
			),
		).toThrow(expect.objectContaining({ code: "LITCODEX_INSTALL_UNSAFE_MODEL_ROUTE" }));
		expect(wfs.written.size).toBe(0);
	});

	it("keeps the catalog aligned with every installed agent TOML", () => {
		const catalog = JSON.parse(readFileSync(new URL("../../model-catalog.json", import.meta.url), "utf8"));
		const agentRoot = new URL("../../../../plugins/litcodex/components/lit-loop/agents/", import.meta.url);
		const files = [
			"litcodex-default.toml",
			"litcodex-explorer.toml",
			"litcodex-librarian.toml",
			"litcodex-plan.toml",
			"litcodex-metis.toml",
			"litcodex-momus.toml",
			"litcodex-litwork-reviewer.toml",
		];

		for (const file of files) {
			const route = routeFromToml(new URL(file, agentRoot).pathname);
			expect(catalog.roles[route.role], `catalog missing ${route.role}`).toEqual({
				model: route.model,
				model_reasoning_effort: route.effort,
			});
		}
		expect(catalog.current).toEqual({ model: "gpt-6-astra", model_reasoning_effort: "xhigh" });
		expect(catalog.roles.worker).toBeUndefined();
		expect(catalog.roles.verifier).toBeUndefined();
	});

	it("rewrites SOL-aliased agent TOMLs to explicit Sol for chatgpt auth", () => {
		const sourceDir = "/fake/agents";
		const codexHome = "/tmp/isolated-chatgpt-agent-home";
		const solToml = 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n[agent]\nname="plan"\n';
		const terraToml = 'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "xhigh"\n[agent]\nname="explorer"\n';
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${sourceDir}/litcodex-plan.toml`, solToml],
				[`${sourceDir}/litcodex-explorer.toml`, terraToml],
			]),
			sourceDirEntries: new Map([[sourceDir, ["litcodex-explorer.toml", "litcodex-plan.toml"]]]),
		});

		runAgentsInstall(
			{ kind: "agents-install", title: "test", command: null, skippable: false },
			{ now: () => 0, repoRoot: "/repo", codexHome, writeFs: wfs, agentsSourceDir: sourceDir, authMode: "chatgpt" },
		);

		const planContent = wfs.written.get(`${codexHome}/agents/litcodex-plan.toml`) ?? "";
		expect(planContent).toContain('model = "gpt-5.6-sol"');
		expect(planContent).not.toContain('model = "gpt-5.6"\n');

		const explorerContent = wfs.written.get(`${codexHome}/agents/litcodex-explorer.toml`) ?? "";
		expect(explorerContent).toContain('model = "gpt-5.6-terra"');
	});

	it("keeps public alias for api-key auth", () => {
		const sourceDir = "/fake/agents";
		const codexHome = "/tmp/isolated-apikey-agent-home";
		const solToml = 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n[agent]\nname="plan"\n';
		const wfs = makeMemWriteFs({
			initialFiles: new Map([[`${sourceDir}/litcodex-plan.toml`, solToml]]),
			sourceDirEntries: new Map([[sourceDir, ["litcodex-plan.toml"]]]),
		});

		runAgentsInstall(
			{ kind: "agents-install", title: "test", command: null, skippable: false },
			{ now: () => 0, repoRoot: "/repo", codexHome, writeFs: wfs, agentsSourceDir: sourceDir, authMode: "api-key" },
		);

		const content = wfs.written.get(`${codexHome}/agents/litcodex-plan.toml`) ?? "";
		expect(content).toContain('model = "gpt-5.6"');
		expect(content).not.toContain("gpt-5.6-sol");
	});

	it("labels installed TOMLs separately from unverified effective child execution", () => {
		const agentRoot = new URL("../../../../plugins/litcodex/components/lit-loop/agents/", import.meta.url);
		const agentRoutes = [
			"litcodex-default.toml",
			"litcodex-explorer.toml",
			"litcodex-librarian.toml",
			"litcodex-plan.toml",
			"litcodex-metis.toml",
			"litcodex-momus.toml",
			"litcodex-litwork-reviewer.toml",
		].map((file) => parseAgentRoute(file, readFileSync(new URL(file, agentRoot), "utf8")));
		const receipt = renderInstallReceipt(
			{
				ok: true,
				codexHome: "/tmp/isolated-codex-home",
				steps: [
					{
						kind: "agents-install",
						status: "ok",
						detail: "7 agent role(s) installed, 0 unchanged, 0 preserved",
						agentRoutes,
					},
					{ kind: "config-update", status: "ok", detail: "applied" },
				],
			},
			{ model: "gpt-5.6-luna", effort: "max", color: false },
		);

		expect(receipt).toContain("Installed TOMLs");
		expect(receipt).toContain("explorer=gpt-6-luna/max");
		expect(receipt).toContain("gpt-5.6-luna · max");
		expect(receipt).toContain("Spawn override");
		expect(receipt).toContain("not exposed by the verified host schema");
		expect(receipt).toContain("Effective child");
		expect(receipt).toContain("unverified without a child JSONL receipt");
	});
});
