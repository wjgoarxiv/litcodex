import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";

import type { HostCapabilities } from "../install/host-capabilities.js";

interface Env {
	[key: string]: string;
}

export const CLI_TEST_CAPABILITIES: HostCapabilities = {
	concurrency: { status: "hard", limit: 20, reason: "test fixture", observedSource: "test fixture" },
	autoCompaction: { status: "unavailable", reason: "test fixture", observedSource: "test fixture" },
	modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
};
export const CLI_TEST_DEPS = { preflight: () => CLI_TEST_CAPABILITIES };

export function useConfigMigrationFixture(): {
	readonly fixtureRoot: () => string;
	readonly newDir: () => string;
	readonly isolatedEnv: (codexHome: string, extra?: Env) => NodeJS.ProcessEnv;
	readonly writeConfig: (codexHome: string, body: string) => string;
} {
	let workdir = "";
	const newDir = (): string => mkdtempSync(join(workdir, "case-"));
	beforeEach(() => {
		workdir = mkdtempSync(join(tmpdir(), "litcodex-cfg-"));
	});
	afterEach(() => rmSync(workdir, { recursive: true, force: true }));
	return {
		fixtureRoot: () => workdir,
		newDir,
		isolatedEnv: (codexHome, extra = {}) => ({
			CODEX_HOME: codexHome,
			LITCODEX_MODEL_CATALOG_STATE_PATH: join(newDir(), "state.json"),
			LITCODEX_DATA: newDir(),
			...extra,
		}),
		writeConfig: (codexHome, body) => {
			mkdirSync(codexHome, { recursive: true });
			const path = join(codexHome, "config.toml");
			writeFileSync(path, body);
			return path;
		},
	};
}

export function readMigrationFixture(name: string): string {
	const fixturePath = fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
	return readFileSync(fixturePath, "utf8");
}

export function setProcessEnv(env: NodeJS.ProcessEnv): () => void {
	const saved: Record<string, string | undefined> = {};
	for (const key of [
		"CODEX_HOME",
		"LITCODEX_MODEL_CATALOG_STATE_PATH",
		"LITCODEX_DATA",
		"LITCODEX_MODEL_CATALOG_PATH",
		"LITCODEX_CONFIG_MIGRATION_DISABLED",
	]) {
		saved[key] = process.env[key];
		const value = env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return () => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
}
