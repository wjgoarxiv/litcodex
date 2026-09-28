import { describe, expect, it } from "vitest";

import { CodexConfigMigrationError } from "./errors.js";
import { ensureNativeDefaultAgentConfig } from "./native-default-route.js";

const TARGET = "/tmp/codex/litcodex-default.toml";

describe("native default-agent binding", () => {
	it("adds the managed binding only when no user binding or table exists", () => {
		expect(ensureNativeDefaultAgentConfig('model = "gpt-6-astra"\n', TARGET)).toBe(
			'model = "gpt-6-astra"\n\n[agents.default]\nconfig_file = "/tmp/codex/litcodex-default.toml"\n',
		);
	});

	it.each([
		'[agents.default]\nconfig_file = "/user-owned/agent.toml"\n',
		"[agents.default]\nconfig_file = '/user-owned/agent.toml'\n",
		'agents.default.config_file = "/user-owned/agent.toml"\n',
		'[agents]\ndefault = { config_file = "/user-owned/agent.toml" }\n',
		'[agents]\n"default" = { config_file = "/user-owned/agent.toml" }\n',
		'agents."default".config_file = "/user-owned/agent.toml"\n',
		'[agents]\ndefault = { "config_file" = "/user-owned/agent.toml" }\n',
		'[agents."default"]\n"config_file" = "/user-owned/agent.toml"\n',
		'["agents"."default"]\nconfig_file = "/user-owned/agent.toml"\n',
		'"agents"."default"."config_file" = "/user-owned/agent.toml"\n',
	])("preserves a valid existing native binding: %s", (config) => {
		expect(ensureNativeDefaultAgentConfig(config, TARGET)).toBe(config);
	});

	it("does not confuse a literal dotted key with a dotted table path", () => {
		const config = '["agents.default"]\nconfig_file = "/user-owned/agent.toml"\n';
		expect(ensureNativeDefaultAgentConfig(config, TARGET)).toBe(
			`${config.trimEnd()}\n\n[agents.default]\nconfig_file = "/tmp/codex/litcodex-default.toml"\n`,
		);
	});

	it.each([
		[
			"foreign dotted assignment under another table",
			'[user]\nagents.default.config_file = "/inert/foreign.toml"\n',
			'[user]\nagents.default.config_file = "/inert/foreign.toml"\n\n[agents.default]\nconfig_file = "/tmp/codex/litcodex-default.toml"\n',
		],
		[
			"relative dotted assignment under agents",
			'[agents]\ndefault.config_file = "/user/native.toml"\n',
			'[agents]\ndefault.config_file = "/user/native.toml"\n',
		],
		[
			"explicit default table assignment",
			'[agents.default]\nconfig_file = "/user/native.toml"\n',
			'[agents.default]\nconfig_file = "/user/native.toml"\n',
		],
		[
			"root dotted assignment",
			'agents.default.config_file = "/user/native.toml"\n',
			'agents.default.config_file = "/user/native.toml"\n',
		],
	])("classifies %s by effective TOML path", (_label, config, expected) => {
		expect(ensureNativeDefaultAgentConfig(config, TARGET)).toBe(expected);
	});

	it("preserves a user-owned default table even when it has no config_file", () => {
		const config = '[agents.default]\nname = "user-owned"\n';
		expect(ensureNativeDefaultAgentConfig(config, TARGET)).toBe(config);
	});

	it.each([
		'[agents.default]\nconfig_file = "/one.toml"\nconfig_file = "/two.toml"\n',
		'[agents.default]\nconfig_file = "/one.toml"\n\n[agents.default]\nconfig_file = "/two.toml"\n',
		'[[agents.default]]\nconfig_file = "/user-owned/agent.toml"\n',
		'agents.default.config_file = "/one.toml"\nagents.default.config_file = "/two.toml"\n',
		'[agents]\ndefault = { config_file = "/one.toml" }\n[agents."default"]\nname = "user-owned"\n',
		'[agents.default]\nconfig_file = "/one.toml"\n"config_file" = "/two.toml"\n',
		'agents.default.config_file = "/one.toml"\n[agents.default]\nname = "user-owned"\n',
		'agents.default = { config_file = "/one.toml" }\nagents.default.model = "user-owned"\n',
	])("rejects an ambiguous native binding before mutation: %s", (config) => {
		expect(() => ensureNativeDefaultAgentConfig(config, TARGET, "/tmp/config.toml")).toThrow(
			new CodexConfigMigrationError(
				"CONFIG_MALFORMED",
				"Codex default-agent binding is ambiguous; refusing to rewrite it.",
				"/tmp/config.toml",
				{ reason: expect.any(String) },
			),
		);
	});
});
