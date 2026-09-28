import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { migrateCodexConfig } from "../config-migration/index.js";
import { desiredAgentRoutes, installedAgentPath } from "./agent-routing.js";
import { runDoctor } from "./doctor.js";

const CODEX_HOME = "/tmp/doctor-routing-home";
const CODEX_BIN = "/usr/local/bin/codex";
const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const DOCTOR_BOUNDARY_DOCS = [
	fileURLToPath(new URL("./index.ts", import.meta.url)),
	fileURLToPath(new URL("../../README.md", import.meta.url)),
	fileURLToPath(new URL("../../../../README.md", import.meta.url)),
	fileURLToPath(new URL("../../../../plugins/litcodex/skills/litcodex-doctor/SKILL.md", import.meta.url)),
] as const;

describe("doctor model-routing health", () => {
	it("treats a safe preserved old role route as healthy and reports the mismatch as preserved", () => {
		const routes = completeAgentFiles();
		routes.set("litcodex-explorer.toml", 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
		const report = doctorReport({ agentFiles: routes });

		expect(report.agentsInstalled).toBe(true);
		expect(report.agentRouting.issues).not.toEqual(
			expect.arrayContaining([expect.stringContaining("does not match desired config")]),
		);
		expect(report.agentRouting.installedTomls).toContain("explorer=gpt-5.6-sol/high");
	});

	it("fails agent health when only the historical sentinel TOML is readable", () => {
		const report = doctorReport({
			agentFiles: new Map([
				["litcodex-litwork-reviewer.toml", 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n'],
			]),
		});

		expect(report.agentsInstalled).toBe(false);
		expect(report.issues).toEqual(expect.arrayContaining([expect.stringContaining("incomplete")]));
	});

	it("keeps agent health when a SOL role uses the existing explicit Sol representation", () => {
		const routes = completeAgentFiles();
		routes.set("litcodex-plan.toml", 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
		const report = doctorReport({ agentFiles: routes });
		expect(report.agentsInstalled).toBe(true);
		expect(report.agentRouting.preservedRoutes).toContain("plan=gpt-5.6-sol/high");
	});

	it("keeps agent health when an installed TOML differs from the desired catalog route", () => {
		const routes = completeAgentFiles();
		routes.set("litcodex-explorer.toml", 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n');
		const report = doctorReport({ agentFiles: routes });

		expect(report.agentsInstalled).toBe(true);
		expect(report.agentRouting.preservedRoutes).toContain("explorer=gpt-5.6-sol/high");
	});

	it("reports an unreadable agent TOML as unhealthy instead of throwing", () => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			unreadableAgent: "litcodex-explorer.toml",
		});

		expect(report.agentsInstalled).toBe(false);
		expect(report.issues).toEqual(expect.arrayContaining([expect.stringContaining("unreadable")]));
	});

	it("reports a legacy autodiscovered default collision instead of blessing duplicate native roles", () => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			legacyDefault: 'name = "default"\nmodel = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\n',
		});

		expect(report.agentsInstalled).toBe(false);
		expect(report.agentRouting.issues).toEqual(
			expect.arrayContaining([expect.stringMatching(/autodiscovered agents directory.*duplicate/i)]),
		);
	});

	it.each([
		[
			"duplicate route keys",
			'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "xhigh"\nmodel = "openai/gpt-5.6-luna"\n',
		],
		["an unparseable route value", 'model = "gpt-5.6-terra\nmodel_reasoning_effort = "xhigh"\n'],
	])("fails agent health for %s", (_label, content) => {
		const routes = completeAgentFiles();
		routes.set("litcodex-explorer.toml", content);
		const report = doctorReport({ agentFiles: routes });

		expect(report.agentsInstalled).toBe(false);
		expect(report.issues).toEqual(expect.arrayContaining([expect.stringMatching(/ambiguous|unparseable/i)]));
	});

	it("reports the public alias without explicit limits as current managed config", () => {
		const report = doctorReport({ agentFiles: completeAgentFiles() });
		expect(report.configManaged).toBe(true);
		expect(report.effectiveConfig).toEqual({
			state: "applied",
			detail: "gpt-5.6 · high; context/auto-compaction unset; host defaults apply",
		});
	});

	it("reports an existing explicit Sol root as valid preserved config", () => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			config: 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n',
		});
		expect(report.configManaged).toBe(true);
		expect(report.effectiveConfig).toMatchObject({
			state: "preserved",
			detail: expect.stringMatching(/explicit Sol/i),
		});
		expect(report.issues).not.toEqual(expect.arrayContaining([expect.stringContaining("config unavailable")]));
	});

	it("keeps migration and doctor parity for preserved explicit Sol and reviewed alias reconfiguration", async () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-doctor-migration-parity-"));
		tempRoots.push(root);
		const codexHome = join(root, "codex-home");
		mkdirSync(codexHome, { recursive: true });
		const configPath = join(codexHome, "config.toml");
		const explicitSol =
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\nmodel_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n';
		writeFileSync(configPath, explicitSol);
		const env = {
			CODEX_HOME: codexHome,
			LITCODEX_DATA: join(root, "data"),
			LITCODEX_MODEL_CATALOG_STATE_PATH: join(root, "state.json"),
		};

		await migrateCodexConfig({ env, cwd: root, mode: "install" });
		expect(readFileSync(configPath, "utf8")).toBe(explicitSol);
		expect(doctorReport({ agentFiles: completeAgentFiles(), config: explicitSol }).effectiveConfig.state).toBe(
			"preserved",
		);

		await migrateCodexConfig({ env, cwd: root, mode: "install", reconfigure: true });
		const alias = readFileSync(configPath, "utf8");
		expect(alias).toContain('model = "gpt-6-astra"');
		expect(alias).toContain(`[agents.default]\nconfig_file = "${join(codexHome, "litcodex-default.toml")}"`);
		expect(alias).not.toContain("model_context_window");
		expect(alias).not.toContain("model_auto_compact_token_limit");
		expect(doctorReport({ agentFiles: completeAgentFiles(), config: alias }).effectiveConfig.state).toBe("applied");
	});

	it.each([
		["openai/gpt-5.6-luna", "medium"],
		["custom/gpt-5.6-terra", "medium"],
	])("fails config health for unsafe effective root %s/%s", (model, effort) => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			config: `model = "${model}"\nmodel_reasoning_effort = "${effort}"\n`,
		});

		expect(report.configManaged).toBe(false);
		expect(report.effectiveConfig).toMatchObject({ state: "unavailable", detail: expect.stringContaining("unsafe") });
		expect(report.issues).toEqual(expect.arrayContaining([expect.stringContaining("unsafe")]));
	});
});

describe("doctor chatgpt-subscription auth advisory", () => {
	it("warns when chatgpt auth and sol-role agents use the public alias", () => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			authJson: JSON.stringify({
				tokens: { id_token: "fake", access_token: "fake", refresh_token: "fake", account_id: "acct" },
				auth_mode: "chatgpt",
			}),
		});
		const aliasWarnings = [...report.issues, ...report.warnings].filter((m) => m.includes("gpt-5.6"));
		expect(aliasWarnings.length).toBeGreaterThan(0);
		expect(aliasWarnings.some((w) => /chatgpt/i.test(w) && /gpt-5\.6[^-]/.test(w))).toBe(true);
	});

	it("does not warn when chatgpt auth and config uses explicit Sol", () => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			config: 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n',
			authJson: JSON.stringify({
				tokens: { id_token: "fake", access_token: "fake", refresh_token: "fake", account_id: "acct" },
				auth_mode: "chatgpt",
			}),
		});
		const aliasWarnings = [...report.issues, ...report.warnings].filter(
			(m) => /chatgpt/i.test(m) && /gpt-5\.6[^-]/.test(m),
		);
		expect(aliasWarnings).toEqual([]);
	});

	it("warns about unknown auth mode risk when auth.json is absent", () => {
		const report = doctorReport({ agentFiles: completeAgentFiles() });
		const unknownWarnings = report.warnings.filter((w) => /auth/i.test(w));
		expect(unknownWarnings.length).toBeGreaterThan(0);
	});

	it("does not warn for api-key auth with public alias", () => {
		const report = doctorReport({
			agentFiles: completeAgentFiles(),
			authJson: JSON.stringify({ OPENAI_API_KEY: "sk-fake" }),
		});
		const chatgptWarnings = [...report.issues, ...report.warnings].filter((m) => /chatgpt/i.test(m));
		expect(chatgptWarnings).toEqual([]);
	});
});

describe("doctor mutation-boundary documentation", () => {
	it.each(DOCTOR_BOUNDARY_DOCS)("distinguishes the diagnostic core from the post-success notifier in %s", (path) => {
		const text = readFileSync(path, "utf8");
		expect(text).toMatch(
			/doctor diagnostic(?:s| core)?[^.]*never (?:writes?|modif(?:y|ies))[^.]*Codex config[^.]*install[^.]*plugin/is,
		);
		expect(text).toMatch(/eligible[^.]*interactive[^.]*doctor[^.]*cached advisory notice/is);
		expect(text).toMatch(/detached[^.]*fixed[^.]*registry[^.]*refresh/is);
		expect(text).toContain("~/.litcodex/update-check.json");
		expect(text).toMatch(/failed[^.]*--json[^.]*--dry-run[^.]*non-TTY[^.]*CI[^.]*opt-out[^.]*side-effect-free/is);
	});
});

function completeAgentFiles(): Map<string, string> {
	return new Map(
		desiredAgentRoutes().map((route) => [
			route.file,
			`model = "${route.model}"\nmodel_reasoning_effort = "${route.effort}"\n`,
		]),
	);
}

function doctorReport(options: {
	readonly agentFiles: ReadonlyMap<string, string>;
	readonly config?: string;
	readonly unreadableAgent?: string;
	readonly authJson?: string;
	readonly legacyDefault?: string;
}) {
	const configPath = `${CODEX_HOME}/config.toml`;
	const authPath = `${CODEX_HOME}/auth.json`;
	const managedRoot = `${CODEX_HOME}/marketplaces/litcodex`;
	const marketplaceManifest = `${managedRoot}/.agents/plugins/marketplace.json`;
	const pluginManifest = `${managedRoot}/plugins/litcodex/.codex-plugin/plugin.json`;
	const hooksManifest = `${managedRoot}/plugins/litcodex/hooks/hooks.json`;
	const files = new Map<string, string>([
		[configPath, options.config ?? 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n'],
		[marketplaceManifest, '{"name":"litcodex"}'],
		[pluginManifest, '{"name":"litcodex","version":"0.3.44"}'],
		[hooksManifest, '{"hooks":{"UserPromptSubmit":[]}}'],
	]);
	if (options.authJson !== undefined) files.set(authPath, options.authJson);
	for (const [file, content] of options.agentFiles) files.set(installedAgentPath(CODEX_HOME, file), content);
	if (options.legacyDefault !== undefined) {
		files.set(`${CODEX_HOME}/agents/litcodex-default.toml`, options.legacyDefault);
	}
	return runDoctor({
		env: { CODEX_BIN, CODEX_HOME },
		repoRoot: "/repo",
		verifyHook: () => undefined,
		fs: {
			existsSync: (path) => path === CODEX_BIN || files.has(path),
			readFileSync: (path) => {
				if (path.endsWith(`/${options.unreadableAgent}`)) throw new Error("permission denied");
				return files.get(path) ?? "";
			},
			listFilesRecursive: () => [],
			readFileBufferSync: () => new Uint8Array(),
		},
		spawn: (_command, args) => {
			const command = args.join(" ");
			if (command === "--version") return { status: 0, stdout: "codex-cli 0.144.0\n" };
			if (command === "debug models --bundled") {
				return {
					status: 0,
					stdout: JSON.stringify({
						models: [
							{ slug: "gpt-5.6", context_window: 372_000 },
							{ slug: "gpt-5.6-terra", context_window: 372_000 },
						],
					}),
				};
			}
			if (command === "plugin marketplace list --json") {
				return {
					status: 0,
					stdout: JSON.stringify([{ name: "litcodex", sourceType: "path", source: managedRoot }]),
				};
			}
			if (command === "plugin list") return { status: 0, stdout: "litcodex@litcodex  installed, enabled  0.3.44\n" };
			return { status: 0, stdout: '{"checks":{"config.load":{"status":"ok"}}}' };
		},
	});
}
