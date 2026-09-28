import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeConfigFile } from "./config-file-io.js";
import { migrateCodexConfig } from "./index.js";
import { ensureGpt56ProfileFiles } from "./profile-files.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { readonly root: string; readonly codexHome: string; readonly env: NodeJS.ProcessEnv } {
	const root = mkdtempSync(join(tmpdir(), "litcodex-gpt56-"));
	roots.push(root);
	const codexHome = join(root, "codex-home");
	return {
		root,
		codexHome,
		env: {
			CODEX_HOME: codexHome,
			LITCODEX_MODEL_CATALOG_STATE_PATH: join(root, "state.json"),
			LITCODEX_DATA: join(root, "data"),
		},
	};
}

function seed(codexHome: string, body: string): void {
	mkdirSync(codexHome, { recursive: true });
	writeFileSync(join(codexHome, "config.toml"), body);
}

describe("GPT-5.6 migration policy", () => {
	it("#given a fresh home #when migrated #then selects Astra/xhigh for the lead", async () => {
		const f = fixture();
		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toContain('model = "gpt-6-astra"');
		expect(root).toContain('model_reasoning_effort = "xhigh"');
		expect(root).toContain(`[agents.default]\nconfig_file = "${join(f.codexHome, "litcodex-default.toml")}"`);
		expect(root).not.toContain(
			`[agents.default]\nconfig_file = "${join(f.codexHome, "agents", "litcodex-default.toml")}"`,
		);
	});

	it("#given fresh absent config #when migrated #then writes the Astra lead, native generic default, reserved-schema-safe depth-one hard-20, and no explicit limits", async () => {
		const f = fixture();
		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toContain('model = "gpt-6-astra"');
		expect(root).toContain('model_reasoning_effort = "xhigh"');
		expect(root).toContain(`[agents.default]\nconfig_file = "${join(f.codexHome, "litcodex-default.toml")}"`);
		expect(root).not.toContain(
			`[agents.default]\nconfig_file = "${join(f.codexHome, "agents", "litcodex-default.toml")}"`,
		);
		expect(root).toContain("multi_agent = true");
		expect(root).toContain("enabled = true");
		expect(root).toContain("hide_spawn_agent_metadata = true");
		expect(root).toContain("max_concurrent_threads_per_session = 20");
		expect(root).not.toContain("max_threads");
		expect(root).toContain("max_depth = 1");
		expect(root).not.toContain("model_context_window");
		expect(root).not.toContain("model_auto_compact_token_limit");
	});

	it("#given unrelated root keys without managed reasoning #when migrated #then applies Astra/xhigh and preserves unrelated bytes", async () => {
		const f = fixture();
		seed(f.codexHome, '# user comment\napproval_policy = "never"\n\n[custom]\nvalue = 7\n');
		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toContain('# user comment\napproval_policy = "never"');
		expect(root).toContain("[custom]\nvalue = 7");
		expect(root).toContain('model = "gpt-6-astra"');
	});

	it("#given managed legacy #when no reconfigure #then preserves the root without inventing multi-agent settings", async () => {
		const f = fixture();
		const legacy =
			'model = "gpt-5.5"\nmodel_context_window = 272000\nmodel_reasoning_effort = "high"\nplan_mode_reasoning_effort = "xhigh"\n';
		seed(f.codexHome, legacy);
		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toBe(legacy);
	});

	it("#given authoritative 372K metadata #when fresh config migrates #then root and profiles still defer context limits to host defaults", async () => {
		const f = fixture();
		await migrateCodexConfig({
			env: f.env,
			cwd: f.root,
			mode: "install",
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		});
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		const sol = readFileSync(join(f.codexHome, "gpt56-sol-high.config.toml"), "utf8");
		const terra = readFileSync(join(f.codexHome, "gpt56-terra-high.config.toml"), "utf8");
		const luna = readFileSync(join(f.codexHome, "gpt56-luna-max.config.toml"), "utf8");
		expect(root).toContain('model = "gpt-6-astra"');
		expect(sol).toContain('model = "gpt-5.6"');
		expect(terra).toContain('model = "gpt-5.6-terra"');
		expect(luna).toContain('model = "gpt-5.6-luna"');
		for (const config of [root, sol, terra, luna]) {
			expect(config).not.toContain("model_context_window");
			expect(config).not.toContain("model_auto_compact_token_limit");
		}
	});

	it("#given an existing current alias root #when metadata arrives without reconfigure #then preserves the root values", async () => {
		const f = fixture();
		const existing = 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n';
		seed(f.codexHome, existing);

		await migrateCodexConfig({
			env: f.env,
			cwd: f.root,
			mode: "install",
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		});

		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toContain(existing.trim());
		expect(root).not.toContain("model_context_window");
		expect(root).not.toContain("model_auto_compact_token_limit");
	});

	it("#given an old-default-looking root and user default binding #when normally migrated #then preserves both routes", async () => {
		const f = fixture();
		const existing = [
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			"",
			"[agents.default]",
			'config_file = "/user-owned/agent.toml"',
			"",
		].join("\n");
		seed(f.codexHome, existing);

		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });

		expect(readFileSync(join(f.codexHome, "config.toml"), "utf8")).toBe(existing);
	});

	it("#given an existing legacy native default binding #when normally migrated #then preserves its explicit path", async () => {
		const f = fixture();
		const existing = [
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			"",
			"[agents.default]",
			`config_file = "${join(f.codexHome, "agents", "litcodex-default.toml")}"`,
			"",
		].join("\n");
		seed(f.codexHome, existing);

		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });

		expect(readFileSync(join(f.codexHome, "config.toml"), "utf8")).toBe(existing);
	});

	it("#given an ambiguous native default binding #when migrated #then fails before writing the config", async () => {
		const f = fixture();
		const existing = ["", "[agents.default]", 'config_file = "/one.toml"', 'config_file = "/two.toml"', ""].join(
			"\n",
		);
		seed(f.codexHome, existing);

		await expect(migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" })).rejects.toMatchObject({
			code: "CONFIG_MALFORMED",
		});
		expect(readFileSync(join(f.codexHome, "config.toml"), "utf8")).toBe(existing);
		expect(readdirSync(f.codexHome).filter((file) => file.includes(".litcodex-bak.")).length).toBe(0);
	});

	it("#given quoted semantic duplicate bindings #when migrated #then fails before any config write", async () => {
		const f = fixture();
		const existing = [
			'"agents"."default"."config_file" = "/one.toml"',
			'agents."default"."config_file" = "/two.toml"',
			"",
		].join("\n");
		seed(f.codexHome, existing);

		await expect(migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" })).rejects.toMatchObject({
			code: "CONFIG_MALFORMED",
		});
		expect(readFileSync(join(f.codexHome, "config.toml"), "utf8")).toBe(existing);
		expect(readdirSync(f.codexHome).filter((file) => file.includes(".litcodex-bak.")).length).toBe(0);
	});

	it("#given an existing explicit SOL root without durable ownership #when normally migrated #then preserves it as user-owned", async () => {
		const f = fixture();
		const existing =
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\nmodel_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n';
		seed(f.codexHome, existing);

		const result = await migrateCodexConfig({
			env: f.env,
			cwd: f.root,
			mode: "install",
		});

		const rootPath = join(f.codexHome, "config.toml");
		expect(readFileSync(rootPath, "utf8")).toBe(existing);
		expect(result.skipped).toContainEqual({ path: rootPath, reason: "user-modified" });
	});

	it("#given durable state matching an existing explicit SOL root #when normally migrated #then preserves every byte without backup", async () => {
		const f = fixture();
		const rootPath = join(f.codexHome, "config.toml");
		const existing =
			'# keep me\napproval_policy = "never"\nmodel = "gpt-5.6-sol"\nmodel_reasoning_effort = "xhigh"\nmodel_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n\n[custom]\nvalue = 7\n';
		seed(f.codexHome, existing);
		writeFileSync(
			f.env["LITCODEX_MODEL_CATALOG_STATE_PATH"] ?? "",
			JSON.stringify({
				catalogVersion: "legacy-owned",
				files: {
					[rootPath]: {
						catalogVersion: "legacy-owned",
						managed: true,
						written: {
							model: "gpt-5.6-sol",
							model_reasoning_effort: "xhigh",
							model_context_window: 372_000,
							model_auto_compact_token_limit: 334_800,
						},
					},
				},
			}),
		);

		const result = await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install" });
		expect(readFileSync(rootPath, "utf8")).toBe(existing);
		expect(result.changed).not.toContain(rootPath);
		expect(result.backups).toHaveLength(0);
		expect(result.skipped).toContainEqual({ path: rootPath, reason: "preserved" });
	});

	it("#given an existing explicit SOL root #when explicitly reconfigured #then writes the selected alias without managed limits and backs up", async () => {
		const f = fixture();
		const existing =
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "xhigh"\nmodel_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n';
		seed(f.codexHome, existing);
		const result = await migrateCodexConfig({
			env: f.env,
			cwd: f.root,
			mode: "install",
			reconfigure: true,
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		});
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toContain('model = "gpt-6-astra"');
		expect(root).toContain('model_reasoning_effort = "xhigh"');
		expect(root).not.toContain("model_context_window");
		expect(root).not.toContain("model_auto_compact_token_limit");
		expect(root).toContain(`[agents.default]\nconfig_file = "${join(f.codexHome, "litcodex-default.toml")}"`);
		expect(result.backups).toHaveLength(1);
		expect(result.backups.some((backup) => readFileSync(backup, "utf8") === existing)).toBe(true);
	});

	it("#given a custom root #when migrated #then preserves its bytes and reports the root as preserved", async () => {
		const f = fixture();
		seed(
			f.codexHome,
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "xhigh"\nplan_mode_reasoning_effort = "high"\nmodel_auto_compact_token_limit = 650000\n',
		);

		const result = await migrateCodexConfig({
			env: f.env,
			cwd: f.root,
			mode: "install",
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		});

		const rootPath = join(f.codexHome, "config.toml");
		expect(result.changed).not.toContain(rootPath);
		expect(result.skipped).toContainEqual({ path: rootPath, reason: "user-modified" });
		const root = readFileSync(rootPath, "utf8");
		expect(root).toContain("model_auto_compact_token_limit = 650000");
		expect(root).not.toContain("model_context_window = 372000");
	});

	it("#given a custom root #when explicitly reconfigured #then applies Astra xhigh and preserves unrelated keys", async () => {
		const f = fixture();
		seed(
			f.codexHome,
			'model = "custom/provider-model"\nmodel_reasoning_effort = "xhigh"\napproval_policy = "never"\n',
		);
		await migrateCodexConfig({ env: f.env, cwd: f.root, mode: "install", reconfigure: true });
		const root = readFileSync(join(f.codexHome, "config.toml"), "utf8");
		expect(root).toContain('model = "gpt-6-astra"');
		expect(root).toContain('model_reasoning_effort = "xhigh"');
		expect(root).toContain('approval_policy = "never"');
	});

	it("#given an exact generated explicit SOL profile #when normally installed #then preserves it without backup", async () => {
		const f = fixture();
		mkdirSync(f.codexHome, { recursive: true });
		const path = join(f.codexHome, "gpt56-sol-high.config.toml");
		const existing =
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\nmodel_auto_compact_token_limit = 650000\n';
		writeFileSync(path, existing);
		const result = await ensureGpt56ProfileFiles({
			codexHome: f.codexHome,
			dryRun: false,
			reconfigure: false,
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		});
		expect(readFileSync(path, "utf8")).toBe(existing);
		expect(result.changed).not.toContain(path);
		expect(result.backups).toHaveLength(0);
	});

	it("#given exact generated explicit SOL and Terra profiles #when explicitly reconfigured #then removes limits with backups", async () => {
		const f = fixture();
		mkdirSync(f.codexHome, { recursive: true });
		const solPath = join(f.codexHome, "gpt56-sol-high.config.toml");
		const terraPath = join(f.codexHome, "gpt56-terra-high.config.toml");
		const sol =
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\nmodel_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n';
		const terra =
			'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\nmodel_auto_compact_token_limit = 650000\n';
		writeFileSync(solPath, sol);
		writeFileSync(terraPath, terra);
		const result = await ensureGpt56ProfileFiles({ codexHome: f.codexHome, dryRun: false, reconfigure: true });
		expect(readFileSync(solPath, "utf8")).toBe('model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n');
		expect(readFileSync(terraPath, "utf8")).toBe('model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\n');
		expect(result.backups).toHaveLength(2);
		expect(result.backups.map((backup) => readFileSync(backup, "utf8"))).toEqual(
			expect.arrayContaining([sol, terra]),
		);
	});

	it("#given an edited explicit SOL profile #when normally installed #then preserves it", async () => {
		const f = fixture();
		mkdirSync(f.codexHome, { recursive: true });
		const path = join(f.codexHome, "gpt56-sol-high.config.toml");
		const edited = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n# user edit\n';
		writeFileSync(path, edited);

		const result = await ensureGpt56ProfileFiles({
			codexHome: f.codexHome,
			dryRun: false,
			reconfigure: false,
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		});
		expect(readFileSync(path, "utf8")).toBe(edited);
		expect(result.changed).not.toContain(path);
		expect(result.backups).toHaveLength(0);
	});

	it("#given an edited explicit SOL profile #when explicitly reconfigured #then still protects user edits", async () => {
		const f = fixture();
		mkdirSync(f.codexHome, { recursive: true });
		const path = join(f.codexHome, "gpt56-sol-high.config.toml");
		const edited = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "xhigh"\n';
		writeFileSync(path, edited);
		const result = await ensureGpt56ProfileFiles({
			codexHome: f.codexHome,
			dryRun: false,
			reconfigure: true,
		});
		expect(readFileSync(path, "utf8")).toBe(edited);
		expect(result.changed).not.toContain(path);
	});

	it("#given an exact route for the wrong profile filename #when explicitly reconfigured #then protects the mismatch", async () => {
		const f = fixture();
		mkdirSync(f.codexHome, { recursive: true });
		const path = join(f.codexHome, "gpt56-sol-high.config.toml");
		const mismatched = 'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\n';
		writeFileSync(path, mismatched);
		const result = await ensureGpt56ProfileFiles({
			codexHome: f.codexHome,
			dryRun: false,
			reconfigure: true,
		});
		expect(readFileSync(path, "utf8")).toBe(mismatched);
		expect(result.changed).not.toContain(path);
	});

	it("#given atomic rename failure #when writing config #then removes temp and leaves target to recovery", async () => {
		const f = fixture();
		const target = join(f.codexHome, "config.toml");
		const calls: string[] = [];
		const atomicFs = {
			mkdir: vi.fn(async () => undefined),
			writeFile: vi.fn(async (path: string) => calls.push(`write:${path}`)),
			rename: vi.fn(async () => {
				throw new Error("rename failed");
			}),
			rm: vi.fn(async (path: string) => calls.push(`rm:${path}`)),
		};
		await expect(Reflect.apply(writeConfigFile, undefined, [target, 'model = "x"\n', atomicFs])).rejects.toThrow(
			"Could not write",
		);
		expect(calls.some((call) => call.includes(".litcodex-tmp."))).toBe(true);
		expect(atomicFs.rm).toHaveBeenCalledOnce();
	});

	it("rejects a pre-created temporary symlink before changing its target", async () => {
		const f = fixture();
		mkdirSync(f.codexHome, { recursive: true });
		const outside = join(f.root, "outside-config.toml");
		const target = join(f.codexHome, "config.toml");
		const timestamp = 1_700_000_000_000;
		const temporary = `${target}.litcodex-tmp.${process.pid}.${timestamp}`;
		writeFileSync(outside, "outside canary\n");
		symlinkSync(outside, temporary);
		const now = vi.spyOn(Date, "now").mockReturnValue(timestamp);
		try {
			await expect(writeConfigFile(target, 'model = "x"\n')).rejects.toThrow("Could not write");
			expect(readFileSync(outside, "utf8")).toBe("outside canary\n");
			expect(existsSync(target)).toBe(false);
		} finally {
			now.mockRestore();
		}
	});
});
