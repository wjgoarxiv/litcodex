import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useConfigMigrationFixture } from "./config-migration-test-helpers.js";
import { configPaths } from "./config-paths.js";
import { migrateCodexConfig } from "./index.js";

const { newDir, isolatedEnv } = useConfigMigrationFixture();
afterEach(() => vi.unstubAllEnvs());

it("installer migration cannot write an enclosing home profile or create its backups", async () => {
	const home = newDir();
	vi.stubEnv("HOME", home);
	const protectedHome = join(home, ".codex");
	mkdirSync(protectedHome);
	const config = join(protectedHome, "config.toml");
	const before = 'litcodex_output_style = "eli5"\n';
	writeFileSync(config, before);
	const codexHome = join(home, "checkout", ".litcodex", "qa", "codex");
	mkdirSync(codexHome, { recursive: true });
	await migrateCodexConfig({
		env: isolatedEnv(codexHome, { HOME: home }),
		cwd: codexHome,
		style: "eli5-ko",
	});
	expect(readFileSync(config, "utf8")).toBe(before);
	expect(readdirSync(protectedHome)).toEqual(["config.toml"]);
	expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain('litcodex_output_style = "eli5-ko"');
});

it("an explicit CODEX_HOME replaces the enclosing home config without losing project configs", async () => {
	const home = newDir();
	vi.stubEnv("HOME", home);
	const project = join(home, "project");
	for (const directory of [home, project]) {
		mkdirSync(join(directory, ".codex"), { recursive: true });
		writeFileSync(join(directory, ".codex", "config.toml"), "");
	}
	const codexHome = newDir();
	expect(await configPaths({ env: { HOME: home, CODEX_HOME: codexHome }, cwd: project })).toEqual([
		join(codexHome, "config.toml"),
		join(project, ".codex", "config.toml"),
	]);
});
