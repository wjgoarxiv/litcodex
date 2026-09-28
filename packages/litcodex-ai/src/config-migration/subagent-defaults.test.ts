import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateCodexConfig } from "./index.js";
import { ensureSubagentDefaults, readSubagentDefaults, removeSubagentDefaults } from "./multi-agent-v2-guard.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(config: string | null) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-subagent-defaults-"));
	roots.push(root);
	const codexHome = join(root, "codex-home");
	mkdirSync(codexHome, { recursive: true });
	const configPath = join(codexHome, "config.toml");
	if (config !== null) writeFileSync(configPath, config);
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

describe("legacy subagent-default serializer (pure)", () => {
	it("writes both managed [agents] keys into an empty config", () => {
		const out = ensureSubagentDefaults("", "gpt-5.6-luna", "max");
		expect(out).toContain("[agents]");
		expect(out).toMatch(/^default_subagent_model = "gpt-5\.6-luna"$/m);
		expect(out).toMatch(/^default_subagent_reasoning_effort = "max"$/m);
	});

	it("inserts into an existing [agents] section without duplicating it", () => {
		const out = ensureSubagentDefaults("[agents]\nmax_depth = 1\n", "gpt-5.6-luna", "max");
		expect(out.match(/\[agents\]/g)).toHaveLength(1);
		expect(out).toContain("max_depth = 1");
		expect(readSubagentDefaults(out)).toEqual({ model: "gpt-5.6-luna", effort: "max" });
	});

	it("preserves an existing user value on re-run and is idempotent", () => {
		const seeded = '[agents]\ndefault_subagent_model = "gpt-5.6-terra"\ndefault_subagent_reasoning_effort = "high"\n';
		const out = ensureSubagentDefaults(seeded, "gpt-5.6-luna", "max");
		expect(readSubagentDefaults(out)).toEqual({ model: "gpt-5.6-terra", effort: "high" });
		expect(ensureSubagentDefaults(out, "gpt-5.6-luna", "max")).toBe(out);
	});

	it("overwrite mode rewrites the managed keys (explicit reconfigure only)", () => {
		const seeded = '[agents]\ndefault_subagent_model = "gpt-5.6-terra"\ndefault_subagent_reasoning_effort = "high"\n';
		const out = ensureSubagentDefaults(seeded, "gpt-5.6-luna", "max", { overwrite: true });
		expect(readSubagentDefaults(out)).toEqual({ model: "gpt-5.6-luna", effort: "max" });
	});

	it("removeSubagentDefaults strips exactly the two managed keys", () => {
		const seeded = ensureSubagentDefaults("[agents]\nmax_depth = 1\n", "gpt-5.6-luna", "max");
		const out = removeSubagentDefaults(seeded);
		expect(out).not.toContain("default_subagent_model");
		expect(out).not.toContain("default_subagent_reasoning_effort");
		expect(out).toContain("max_depth = 1");
	});
});

describe("migrateCodexConfig subagent route compatibility", () => {
	it("leaves a fresh install compatible with Codex 0.144.0", async () => {
		const state = fixture(null);
		await migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" });
		const config = readFileSync(state.configPath, "utf8");
		expect(readSubagentDefaults(config)).toEqual({});
		expect(config).toContain("[agents]");
		expect(config).toContain("max_depth = 1");
	});

	it("removes legacy default keys while preserving the rest of the managed section", async () => {
		const state = fixture(
			ensureSubagentDefaults(
				'model = "custom/provider-model"\nmodel_reasoning_effort = "medium"\n[agents]\nmax_depth = 1\n',
				"gpt-5.6-terra",
				"xhigh",
			),
		);
		await migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" });
		const config = readFileSync(state.configPath, "utf8");
		expect(readSubagentDefaults(config)).toEqual({});
		expect(config).toContain("max_depth = 1");
		expect(config).toContain('model = "custom/provider-model"');
		expect(config).toContain('model_reasoning_effort = "medium"');
	});

	it("rejects the luna+xhigh subagent route before any write", async () => {
		const state = fixture(null);
		await expect(
			migrateCodexConfig({
				env: state.env,
				cwd: state.root,
				mode: "install",
				subagentModel: "gpt-5.6-luna",
				subagentEffort: "xhigh",
			}),
		).rejects.toMatchObject({ code: "UNSAFE_MODEL_ROUTE" });
	});

	it("role TOMLs are untouched by legacy-key cleanup", async () => {
		const state = fixture(null);
		await migrateCodexConfig({ env: state.env, cwd: state.root, mode: "install" });
		const config = readFileSync(state.configPath, "utf8");
		expect(config).not.toContain("litcodex-plan");
		expect(config).not.toContain("litcodex-momus");
	});
});
