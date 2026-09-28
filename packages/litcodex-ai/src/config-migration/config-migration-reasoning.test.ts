import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FALLBACK_CATALOG } from "./catalog.js";
import { readMigrationFixture, useConfigMigrationFixture } from "./config-migration-test-helpers.js";
import { migrateCodexConfig, migrateConfigFile } from "./index.js";
import { ensureStableMultiAgent } from "./multi-agent-v2-guard.js";
import { ensureCodexReasoningConfig, MANAGED_KEYS } from "./root-settings.js";

const MARKER = "Managed by LitCodex";
const { newDir, isolatedEnv, writeConfig } = useConfigMigrationFixture();

describe("#given a config with no managed keys #when migrating #then managed scalars are inserted", () => {
	it("creates config when absent", async () => {
		const codexHome = join(newDir(), ".codex");
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		const written = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(result.changed).toContain(join(codexHome, "config.toml"));
		expect(result.backups).toEqual([]); // nothing to back up (file did not exist)
		expect(written).toContain('model = "gpt-6-astra"');
		expect(written).not.toContain("model_context_window");
		expect(written).not.toContain("model_auto_compact_token_limit");
		expect(written).toContain("multi_agent = true");
		expect(written).toContain("[features.multi_agent_v2]");
		expect(written).toContain("enabled = true");
		expect(written).toContain("hide_spawn_agent_metadata = true");
		expect(written).toContain("max_concurrent_threads_per_session = 20");
		expect(written).not.toContain("max_threads");
		expect(written).toContain("max_depth = 1");
	});

	it("enrolls an unconfigured existing config while preserving unrelated root settings", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, "# only comments and an unrelated key\nfoo = 1\n\n[bar]\nbaz = 2\n");
		const env = isolatedEnv(codexHome);
		await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toContain('model = "gpt-6-astra"');
		expect(out).toContain("foo = 1");
		expect(out).toContain("baz = 2");
	});
});

describe("#given an already-current config #when migrating #then no reasoning rewrite occurs", () => {
	it("no-op when already current (guard already normalized)", async () => {
		const codexHome = newDir();
		const seed = ensureCodexReasoningConfig("", FALLBACK_CATALOG.current);
		const guarded = ensureStableMultiAgent(seed);
		writeConfig(codexHome, `${guarded.trimEnd()}\n`);
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		expect(result.changed).toEqual([
			join(codexHome, "gpt56-luna-max.config.toml"),
			join(codexHome, "gpt56-sol-high.config.toml"),
			join(codexHome, "gpt56-terra-high.config.toml"),
			join(codexHome, "gpt6-astra-xhigh.config.toml"),
		]);
	});
});

describe("#given a user-customized reasoning profile #when migrating #then it is preserved", () => {
	it("preserves user-customized reasoning (managed:false, reasoning untouched)", async () => {
		const codexHome = newDir();
		const seed =
			'model = "gpt-5.5"\nmodel_context_window = 400000\nmodel_reasoning_effort = "medium"\nplan_mode_reasoning_effort = "xhigh"\n';
		writeConfig(codexHome, seed);
		const env = isolatedEnv(codexHome);
		const result = await migrateConfigFile(join(codexHome, "config.toml"), {
			catalog: FALLBACK_CATALOG,
			mode: "install",
		});
		expect(result.managed).toBe(false);
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toBe(seed);
		expect(result.changed).toBe(false);
		expect(result.skipReason).toBe("user-modified");
		await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
	});
});

describe("#given a legacy profile #when explicitly reconfiguring #then it upgrades to current", () => {
	it("upgrades legacy 272k profile", async () => {
		const codexHome = newDir();
		writeConfig(
			codexHome,
			'model = "gpt-5.5"\nmodel_context_window = 272000\nmodel_reasoning_effort = "high"\nplan_mode_reasoning_effort = "xhigh"\n',
		);
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install", reconfigure: true });
		expect(result.changed).toContain(join(codexHome, "config.toml"));
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toContain('model = "gpt-6-astra"');
		expect(out).not.toContain("model_context_window");
	});
});

describe("#given a config with sections + comments #when migrating #then they survive untouched", () => {
	it("preserves section-scoped keys and unrelated root keys + comments", async () => {
		const fixture = readMigrationFixture("sample-config.toml");
		const codexHome = newDir();
		writeConfig(codexHome, fixture);
		const env = isolatedEnv(codexHome);
		await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		// Every non-managed line from the fixture survives byte-identical.
		for (const line of [
			"# This top comment MUST survive a migration untouched.",
			'approval_policy = "on-request"',
			'sandbox_mode = "workspace-write"',
			"# A user note that must be preserved verbatim.",
			"disable_response_storage = false",
			"[some.other]",
			"# unrelated section the migration must never touch",
			'custom_setting = "keep me"',
			"nested_value = 42",
			"[profiles.review]",
			'model_reasoning_effort = "medium"', // section-scoped: NOT replaced
		]) {
			expect(out).toContain(line);
		}
		// Existing unconfigured reasoning receives the default while unrelated bytes survive.
		expect(out).toContain('model = "gpt-6-astra"');
		expect(out).toContain("[features.multi_agent_v2]");
	});
});

describe("#given a reasoning profile #when written #then TOML scalar types are valid", () => {
	it("writes quoted model/effort without explicit context or plan effort", () => {
		const out = ensureCodexReasoningConfig("", FALLBACK_CATALOG.current);
		expect(out).toMatch(/^model = "gpt-6-astra"$/m);
		expect(out).not.toContain("model_context_window");
		expect(out).toMatch(/^model_reasoning_effort = "xhigh"$/m);
		expect(out).not.toContain("plan_mode_reasoning_effort");
	});

	it("managed keys and guard table match the Codex contract", () => {
		expect([...MANAGED_KEYS]).toEqual([
			"model",
			"model_context_window",
			"model_auto_compact_token_limit",
			"model_reasoning_effort",
			"plan_mode_reasoning_effort",
		]);
		const guarded = ensureStableMultiAgent("");
		expect(guarded).toContain("[features.multi_agent_v2]");
		expect(guarded).toContain("multi_agent = true");
		expect(guarded).toContain("enabled = true");
		expect(guarded).toContain("hide_spawn_agent_metadata = true");
		expect(guarded).toContain("max_concurrent_threads_per_session = 20");
		expect(guarded).not.toContain("max_threads");
		expect(guarded).toContain("max_depth = 1");
	});
});

describe("#given the multi_agent_v2 guard #when run twice #then it is byte-identical", () => {
	it("multi_agent_v2 guard is byte-identical on re-run, one marker", () => {
		const once = ensureStableMultiAgent('model = "x"\n');
		const twice = ensureStableMultiAgent(once);
		expect(twice).toBe(once);
		const markers = once.split(MARKER).length - 1;
		expect(markers).toBe(1);
	});

	it("removes the [features] boolean shorthand and adds the table", () => {
		const out = ensureStableMultiAgent("[features]\nmulti_agent_v2 = true\nother = 1\n");
		expect(out).not.toMatch(/multi_agent_v2\s*=\s*true/);
		expect(out).toContain("multi_agent = true");
		expect(out).toContain("[features.multi_agent_v2]");
		expect(out).toContain("enabled = true");
		expect(out).toContain("hide_spawn_agent_metadata = true");
		expect(out).toContain("max_concurrent_threads_per_session = 20");
		expect(out).toContain("other = 1");
	});

	it("normalizes the prior managed V2 table to the reserved schema contract", () => {
		const out = ensureStableMultiAgent(
			[
				"# Managed by LitCodex: strict-probed multi-agent-v2 hard concurrency.",
				"[features.multi_agent_v2]",
				"enabled = true",
				"hide_spawn_agent_metadata = true",
				"max_concurrent_threads_per_session = 20",
				"custom_v2_setting = 7",
				"",
			].join("\n"),
		);
		expect(out).toContain("reserved-schema-safe depth-one multi-agent");
		expect(out).toContain("enabled = true");
		expect(out).toContain("hide_spawn_agent_metadata = true");
		expect(out).toContain("max_concurrent_threads_per_session = 20");
		expect(out).toContain("custom_v2_setting = 7");
		expect(out).not.toContain("strict-probed multi-agent-v2");
	});

	it("repairs an unsafe unmarked V2 table while preserving a custom root model", async () => {
		const codexHome = newDir();
		writeConfig(
			codexHome,
			[
				'model = "custom/provider-model"',
				'model_reasoning_effort = "medium"',
				"[features.multi_agent_v2]",
				"enabled = true",
				"hide_spawn_agent_metadata = false",
				"max_concurrent_threads_per_session = 10000",
				"[agents]",
				"max_threads = 99",
				"max_depth = 7",
				"",
			].join("\n"),
		);
		await migrateCodexConfig({ env: isolatedEnv(codexHome), cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toContain('model = "custom/provider-model"');
		expect(out).toContain("hide_spawn_agent_metadata = true");
		expect(out).toContain("max_concurrent_threads_per_session = 20");
		expect(out).toContain("max_depth = 1");
		expect(out).not.toContain("max_threads");
	});

	it("does not invent a guard for an unmarked user-modified config", async () => {
		const codexHome = newDir();
		const seed = 'model_reasoning_effort = "medium"\n[agents]\nmax_depth = 7\n';
		writeConfig(codexHome, seed);
		const env = isolatedEnv(codexHome);
		await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toBe(seed);
	});

	it("automatically migrates a recognizable older LitCodex V2 guard", async () => {
		const codexHome = newDir();
		writeConfig(
			codexHome,
			[
				'model_reasoning_effort = "medium"',
				"# Managed by LitCodex: strict-probed multi-agent-v2 hard concurrency.",
				"[features.multi_agent_v2]",
				"enabled = true",
				"hide_spawn_agent_metadata = true",
				"max_concurrent_threads_per_session = 20",
				"",
			].join("\n"),
		);
		const result = await migrateCodexConfig({ env: isolatedEnv(codexHome), cwd: newDir(), mode: "install" });
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(result.changed).toContain(join(codexHome, "config.toml"));
		expect(result.skipped).not.toContainEqual({ path: join(codexHome, "config.toml"), reason: "user-modified" });
		expect(out).toContain("enabled = true");
		expect(out).toContain("hide_spawn_agent_metadata = true");
		expect(out).toContain("max_depth = 1");
	});
});
