import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { useConfigMigrationFixture } from "./config-migration-test-helpers.js";
import { migrateCodexConfig } from "./index.js";

const { fixtureRoot, newDir, isolatedEnv, writeConfig } = useConfigMigrationFixture();

describe("#given symlinked project config #when discovering #then it is skipped", () => {
	it("skips symlinked codex dir", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, "");
		const project = newDir();
		const realDir = newDir();
		mkdirSync(join(realDir, ".codex"), { recursive: true });
		writeFileSync(join(realDir, ".codex", "config.toml"), 'model_reasoning_effort = "low"\n');
		let symlinked = false;
		try {
			symlinkSync(join(realDir, ".codex"), join(project, ".codex"), "dir");
			symlinked = true;
		} catch {
			symlinked = false;
		}
		if (!symlinked) {
			return; // self-skip when the OS forbids symlink creation.
		}
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: project, mode: "install" });
		expect(result.changed).not.toContain(join(project, ".codex", "config.toml"));
	});
});

describe("#given a malformed catalog/state #when migrating #then it falls back", () => {
	it("falls back on a malformed catalog and still upgrades", async () => {
		const codexHome = newDir();
		writeConfig(
			codexHome,
			'model = "gpt-5.5"\nmodel_context_window = 272000\nmodel_reasoning_effort = "high"\nplan_mode_reasoning_effort = "xhigh"\n',
		);
		const badCatalog = join(newDir(), "catalog.json");
		writeFileSync(badCatalog, "{not json");
		const env = isolatedEnv(codexHome, { LITCODEX_MODEL_CATALOG_PATH: badCatalog });
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install", reconfigure: true });
		expect(result.changed).toContain(join(codexHome, "config.toml"));
		const out = readFileSync(join(codexHome, "config.toml"), "utf8");
		expect(out).toContain('model = "gpt-6-astra"');
		expect(out).not.toContain("model_context_window");
	});

	it("ignores malformed state (managed flag still recorded)", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, "");
		const statePath = join(newDir(), "state.json");
		writeFileSync(statePath, "[broken-json");
		const env = isolatedEnv(codexHome, { LITCODEX_MODEL_CATALOG_STATE_PATH: statePath });
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		expect(result.stateWritten).toBe(true);
		const state = JSON.parse(readFileSync(statePath, "utf8")) as { files: Record<string, { managed: boolean }> };
		expect(state.files[join(codexHome, "config.toml")]?.managed).toBe(true);
	});
});

describe("#given the opt-out env #when migrating #then it is an immediate no-op", () => {
	it("respects LITCODEX_CONFIG_MIGRATION_DISABLED=1", async () => {
		const codexHome = newDir();
		const path = writeConfig(codexHome, "untouched = true\n");
		const env = isolatedEnv(codexHome, { LITCODEX_CONFIG_MIGRATION_DISABLED: "1" });
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		expect(result.changed).toEqual([]);
		expect(readFileSync(path, "utf8")).toBe("untouched = true\n");
	});
});

describe("#given unicode/space/hash paths #when migrating #then discovery + write succeed", () => {
	it("handles unicode/space/hash paths", async () => {
		const weird = join(fixtureRoot(), "Lit Path # 한글", "proj");
		mkdirSync(weird, { recursive: true });
		const codexHome = join(weird, ".codex");
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: weird, mode: "install" });
		expect(result.changed).toContain(join(codexHome, "config.toml"));
		expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain('model = "gpt-6-astra"');
	});
});

describe("#given install mode + an existing config #when migrating #then a backup is taken before write", () => {
	it("install mode backs up before write with the pre-migration bytes", async () => {
		const codexHome = newDir();
		const before = 'approval_policy = "never"\n';
		writeConfig(codexHome, before);
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		expect(result.backups.length).toBe(1);
		const backupPath = result.backups[0] ?? "";
		expect(readFileSync(backupPath, "utf8")).toBe(before); // pre-migration bytes
	});
});
