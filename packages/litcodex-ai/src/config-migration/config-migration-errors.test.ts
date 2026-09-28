import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { backupConfigFile } from "./backup.js";
import { runConfigMigrateCli } from "./cli.js";
import {
	CLI_TEST_DEPS,
	readMigrationFixture,
	setProcessEnv,
	useConfigMigrationFixture,
} from "./config-migration-test-helpers.js";
import { CodexConfigMigrationError, migrateCodexConfig } from "./index.js";

const { newDir, isolatedEnv, writeConfig } = useConfigMigrationFixture();

describe("#given a malformed config #when migrating in install mode #then backup + non-zero throw", () => {
	it("malformed config backs up and throws CONFIG_MALFORMED (CLI exit 2), original unchanged", async () => {
		const codexHome = newDir();
		const malformed = readMigrationFixture("malformed-config.toml");
		const path = writeConfig(codexHome, malformed);
		const env = isolatedEnv(codexHome);
		let caught: unknown;
		try {
			await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(CodexConfigMigrationError);
		expect((caught as CodexConfigMigrationError).code).toBe("CONFIG_MALFORMED");
		// A backup was created (the file existed).
		const backups = readdirSync(codexHome).filter((f) => f.includes(".litcodex-bak."));
		expect(backups.length).toBe(1);
		// Original bytes unchanged.
		expect(readFileSync(path, "utf8")).toBe(malformed);
	});

	it("CLI route returns exit 2 for a malformed config in install mode", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, readMigrationFixture("malformed-config.toml"));
		const env = isolatedEnv(codexHome);
		// Drive the CLI seam with an explicit env via process.env override.
		const restore = setProcessEnv(env);
		try {
			const code = await runConfigMigrateCli(
				["--json", "--cwd", newDir()],
				() => {},
				() => {},
				CLI_TEST_DEPS,
			);
			expect(code).toBe(2);
		} finally {
			restore();
		}
	});
});

describe("#given session-start mode #when the config is malformed/unwritable #then exit 0", () => {
	it("malformed config in session-start exits 0, path skipped, original unchanged", async () => {
		const codexHome = newDir();
		const malformed = readMigrationFixture("malformed-config.toml");
		const path = writeConfig(codexHome, malformed);
		const env = isolatedEnv(codexHome);
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "session-start" });
		expect(result.skipped.some((s) => s.path === path)).toBe(true);
		expect(readFileSync(path, "utf8")).toBe(malformed);
	});

	it("session-start CLI never throws and returns exit 0 on a malformed config", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, readMigrationFixture("malformed-config.toml"));
		const env = isolatedEnv(codexHome);
		const restore = setProcessEnv(env);
		try {
			const code = await runConfigMigrateCli(
				["--session-start", "--cwd", newDir()],
				() => {},
				() => {},
				CLI_TEST_DEPS,
			);
			expect(code).toBe(0);
		} finally {
			restore();
		}
	});
});

describe("#given a state write failure after a config write #when migrating #then the config survives", () => {
	it("config success survives a state-write failure (stateWritten:false, no throw)", async () => {
		const codexHome = newDir();
		writeConfig(codexHome, "");
		// Point the state path at a location whose parent is a FILE → mkdir fails.
		const fileNode = join(newDir(), "not-a-dir");
		writeFileSync(fileNode, "x");
		const env = isolatedEnv(codexHome, { LITCODEX_MODEL_CATALOG_STATE_PATH: join(fileNode, "state.json") });
		const result = await migrateCodexConfig({ env, cwd: newDir(), mode: "install" });
		expect(result.changed).toContain(join(codexHome, "config.toml"));
		expect(result.stateWritten).toBe(false);
		expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain('model = "gpt-6-astra"');
	});
});

describe("#given a backup target #when the source is absent #then backupConfigFile returns null", () => {
	it("returns null when there is nothing to back up", async () => {
		const result = await backupConfigFile(join(newDir(), "absent.toml"));
		expect(result).toBeNull();
	});
});
