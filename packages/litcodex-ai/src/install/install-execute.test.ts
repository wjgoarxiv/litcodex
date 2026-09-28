import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { type ExecuteDeps, executeInstallPlan, type WritableFsLike } from "./execute.js";
import { baseOptions, fsWithCodex, makeMemWriteFs, makeSpawnRecorder, REPO_ROOT } from "./install-test-helpers.js";
import { buildInstallPlan } from "./plan.js";
import type { InstallStepResult } from "./types.js";

const VALID_FAKE_AGENT_TOML = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n';

describe("executeInstallPlan — spawns ONLY codex (fake-codex argv capture)", () => {
	const codexBin = "/usr/local/bin/codex";
	const fakeSourceDir = "/fake/agents-src";
	const fakeAgentFile = "litcodex-fake.toml";

	function deps(over: Partial<ExecuteDeps> = {}): ExecuteDeps {
		const rec = makeSpawnRecorder(() => ({ status: 0, stdout: "" }));
		const wfs = makeMemWriteFs({
			initialFiles: new Map([[`${fakeSourceDir}/${fakeAgentFile}`, VALID_FAKE_AGENT_TOML]]),
			sourceDirEntries: new Map([[fakeSourceDir, [fakeAgentFile]]]),
		});
		return {
			spawn: rec.spawn,
			fs: fsWithCodex([codexBin]),
			env: { PATH: "/usr/local/bin", CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
			writeFs: wfs,
			agentsSourceDir: fakeSourceDir,
			codexHome: "/tmp/codex-home",
			...over,
		};
	}

	it("the only command spawned is `codex` (never npx / a harness)", async () => {
		const rec = makeSpawnRecorder(() => ({ status: 0, stdout: "" }));
		const steps = buildInstallPlan(baseOptions({ noTui: true }));
		await executeInstallPlan(steps, deps({ spawn: rec.spawn }));
		expect(rec.calls.length).toBeGreaterThan(0);
		for (const call of rec.calls) {
			expect(call.cmd).toBe(codexBin);
			expect(call.args[0]).toBe("plugin");
		}
		const npx = ["n", "p", "x"].join("");
		const joined = rec.calls.map((c) => `${c.cmd} ${c.args.join(" ")}`).join("\n");
		expect(joined).not.toContain(npx);
	});

	it("aborts with exit 2 when codex binary not found, zero spawns", async () => {
		const rec = makeSpawnRecorder(() => ({ status: 0 }));
		const steps = buildInstallPlan(baseOptions());
		await expect(
			executeInstallPlan(steps, deps({ spawn: rec.spawn, fs: fsWithCodex([]), env: { PATH: "" } })),
		).rejects.toMatchObject({ code: "LITCODEX_INSTALL_CODEX_NOT_FOUND" });
		expect(rec.calls.length).toBe(0);
	});

	it("captures Codex mutation output for the TUI instead of inheriting the spinner line", async () => {
		const rec = makeSpawnRecorder((_cmd, args) => {
			const command = args.join(" ");
			if (command === "plugin marketplace add /tmp/codex-home/marketplaces/litcodex") {
				return { status: 0, stdout: "Added marketplace `litcodex`.\nInstalled marketplace root: /tmp/local\n" };
			}
			if (command === "plugin add litcodex@litcodex") {
				return { status: 0, stdout: "Added plugin `litcodex`.\n" };
			}
			return { status: 0, stdout: "" };
		});
		const result = await executeInstallPlan(buildInstallPlan(baseOptions()), deps({ spawn: rec.spawn }));
		const mutations = rec.calls.filter((call) => call.args.includes("add"));
		expect(mutations.every((call) => call.stdio === "pipe")).toBe(true);
		expect(result.steps.find((step) => step.kind === "marketplace-add")).toMatchObject({
			receipts: ["Added marketplace `litcodex`.", "Installed marketplace root: /tmp/local"],
		});
	});

	it("finishes the active TUI step as failed before propagating a Codex error", async () => {
		const completed: InstallStepResult[] = [];
		const rec = makeSpawnRecorder((_cmd, args) => ({
			status: args.join(" ").startsWith("plugin marketplace add") ? 1 : 0,
			stderr: "permission denied",
		}));
		await expect(
			executeInstallPlan(
				buildInstallPlan(baseOptions()),
				deps({ spawn: rec.spawn, onStepEnd: (step) => completed.push(step) }),
			),
		).rejects.toMatchObject({ code: "LITCODEX_INSTALL_MARKETPLACE_ADD_FAILED" });
		expect(completed).toEqual([
			{
				kind: "marketplace-add",
				status: "failed",
				detail: "codex plugin marketplace add /tmp/codex-home/marketplaces/litcodex failed",
			},
		]);
	});
});

// REGRESSION (npx/global install): execution runs with cwd unrelated to the package. Earlier, every
// executeInstallPlan test injected `verifyHook` + `agentsSourceDir`, so the REAL resolution paths were
// never exercised — and a real `npx litcodex-ai install` died with LITCODEX_INSTALL_HOOKS_MISSING.
// These tests run the REAL defaultVerifyHook + REAL @litcodex/lit-loop resolution from a NEUTRAL
// repoRoot (no dev payload), exactly like the shipped tarball.
describe("published-shape install (neutral repoRoot, no injected verifyHook/agentsSourceDir)", () => {
	const codexBin = "/usr/local/bin/codex";
	const tmpDirs: string[] = [];
	afterAll(() => {
		for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	const realWriteFs: WritableFsLike = {
		existsSync,
		lstatSync,
		mkdirSync: (p, o) => {
			mkdirSync(p, o);
		},
		readdirSync: (p) => readdirSync(p) as string[],
		readFileSync: (p, e) => readFileSync(p, e),
		writeFileSync: (p, d) => {
			writeFileSync(p, d);
		},
	};

	it("completes end-to-end: hook-verify skips, bundled agent roles resolve + install", async () => {
		const neutralRepoRoot = mkdtempSync(join(tmpdir(), "lit-neutral-repo-"));
		const codexHome = mkdtempSync(join(tmpdir(), "lit-neutral-home-"));
		tmpDirs.push(neutralRepoRoot, codexHome);

		const steps = buildInstallPlan(baseOptions({ codexHome }));
		const result = await executeInstallPlan(steps, {
			spawn: makeSpawnRecorder(() => ({ status: 0, stdout: "" })).spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin, PATH: "/usr/local/bin" },
			now: () => 0,
			repoRoot: neutralRepoRoot, // no .agents/, no @litcodex/plugin — like the published tarball
			migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
			writeFs: realWriteFs,
			codexHome,
			// NO verifyHook, NO agentsSourceDir → exercise the real resolution the tarball uses.
		});

		const byKind = new Map(result.steps.map((s) => [s.kind, s.status]));
		// The hook is wired by `codex plugin add` from the marketplace; the local guard must SKIP here.
		expect(byKind.get("hooks-register")).toBe("skipped");
		// The bundled @litcodex/lit-loop roles resolve via THIS package; named roles land in
		// <codexHome>/agents/ while the native generic default stays beside that directory.
		expect(byKind.get("agents-install")).toBe("ok");
		expect(existsSync(join(codexHome, "agents", "litcodex-litwork-reviewer.toml"))).toBe(true);
		expect(existsSync(join(codexHome, "litcodex-default.toml"))).toBe(true);
		expect(existsSync(join(codexHome, "agents", "litcodex-default.toml"))).toBe(false);
	});

	it("the real in-repo defaultVerifyHook still passes the drift check (dev guard intact)", async () => {
		const codexHome = mkdtempSync(join(tmpdir(), "lit-devguard-home-"));
		tmpDirs.push(codexHome);
		const steps = buildInstallPlan(baseOptions({ codexHome }));
		const result = await executeInstallPlan(steps, {
			spawn: makeSpawnRecorder(() => ({ status: 0, stdout: "" })).spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin, PATH: "/usr/local/bin" },
			now: () => 0,
			repoRoot: REPO_ROOT, // real repo: dev payload resolves → strict drift check runs
			migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
			writeFs: realWriteFs,
			codexHome,
		});
		expect(new Map(result.steps.map((s) => [s.kind, s.status])).get("hooks-register")).toBe("skipped");
	});
});

describe("idempotent re-install is probe-gated", () => {
	const codexBin = "/usr/local/bin/codex";
	const fakeSourceDir = "/fake/agents-src";

	it("re-run skips marketplace-add + plugin-add via probes (zero add spawns)", async () => {
		// Probe spawns report the plugin + marketplace ALREADY present; add spawns must never run.
		const calls: Array<{ args: readonly string[] }> = [];
		const spawn: ExecuteDeps["spawn"] = (_cmd, args) => {
			calls.push({ args });
			const sub = args.join(" ");
			if (sub === "plugin marketplace list --json") {
				return {
					status: 0,
					stdout: JSON.stringify([
						{ name: "litcodex", sourceType: "path", source: "/tmp/codex-home/marketplaces/litcodex" },
					]),
				};
			}
			if (sub === "plugin list") {
				return { status: 0, stdout: "litcodex@litcodex  installed, enabled  0.3.8\n" };
			}
			// Any actual add is a contract violation under probe-present state.
			return { status: 0, stdout: "" };
		};
		const wfs = makeMemWriteFs({
			initialFiles: new Map([[`${fakeSourceDir}/litcodex-fake.toml`, VALID_FAKE_AGENT_TOML]]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-fake.toml"]]]),
		});
		const steps = buildInstallPlan(baseOptions({ codexHome: "/tmp/codex-home" }));
		const result = await executeInstallPlan(steps, {
			spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
			writeFs: wfs,
			agentsSourceDir: fakeSourceDir,
			codexHome: "/tmp/codex-home",
		});
		const addCalls = calls.filter((c) => c.args.includes("add"));
		expect(addCalls.length).toBe(0);
		const mk = result.steps.find((s) => s.kind === "marketplace-add");
		const pl = result.steps.find((s) => s.kind === "plugin-add");
		expect(mk?.status).toBe("skipped");
		expect(pl?.status).toBe("skipped");
	});
});

describe("managed marketplace registration migration", () => {
	const codexBin = "/usr/local/bin/codex";

	it("replaces an existing Git marketplace with the managed local marketplace", async () => {
		const calls: string[] = [];
		const managedRoot = "/tmp/codex-home/marketplaces/litcodex";
		let pluginInstalled = true;
		const fakeSourceDir = "/fake/agents-src";
		const writeFs = makeMemWriteFs({
			initialFiles: new Map([[`${fakeSourceDir}/litcodex-fake.toml`, VALID_FAKE_AGENT_TOML]]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-fake.toml"]]]),
		});
		const result = await executeInstallPlan(buildInstallPlan(baseOptions({ repoUrl: managedRoot })), {
			spawn: (_cmd, args) => {
				const command = args.join(" ");
				calls.push(command);
				if (command === "plugin marketplace list --json") {
					return {
						status: 0,
						stdout: JSON.stringify([
							{ name: "litcodex", sourceType: "git", source: "https://github.com/wjgoarxiv/litcodex" },
						]),
					};
				}
				if (command === "plugin list") {
					return {
						status: 0,
						stdout: pluginInstalled ? "litcodex@litcodex  installed, enabled  0.3.28\n" : "",
					};
				}
				if (command === "plugin remove litcodex@litcodex") pluginInstalled = false;
				return { status: 0, stdout: "" };
			},
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
			writeFs,
			agentsSourceDir: fakeSourceDir,
			codexHome: "/tmp/codex-home",
		});

		expect(result.ok).toBe(true);
		expect(calls).toContain("plugin remove litcodex@litcodex");
		expect(calls).toContain("plugin marketplace remove litcodex");
		expect(calls).toContain(`plugin marketplace add ${managedRoot}`);
		expect(calls.join("\n")).not.toContain("github.com/wjgoarxiv/litcodex");
	});

	it("surfaces the modified legacy-skill warning to non-interactive install callers", async () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-legacy-warning-"));
		try {
			const codexHome = join(root, ".codex");
			const sourceRoot = join(root, "source");
			const targetRoot = join(codexHome, "marketplaces", "litcodex");
			const sourcePlugin = join(sourceRoot, "plugins", "litcodex");
			const targetPlugin = join(targetRoot, "plugins", "litcodex");
			mkdirSync(join(sourceRoot, ".agents", "plugins"), { recursive: true });
			mkdirSync(join(sourcePlugin, ".codex-plugin"), { recursive: true });
			mkdirSync(join(sourcePlugin, "skills", "lit-humanizer"), { recursive: true });
			writeFileSync(
				join(sourceRoot, ".agents", "plugins", "marketplace.json"),
				JSON.stringify({ name: "litcodex", plugins: [{ name: "litcodex", source: "./plugins/litcodex" }] }),
			);
			writeFileSync(
				join(sourcePlugin, ".codex-plugin", "plugin.json"),
				JSON.stringify({ name: "litcodex", version: "1.0.6" }),
			);
			writeFileSync(join(sourcePlugin, "skills", "lit-humanizer", "SKILL.md"), "name: lit-humanizer\n");
			mkdirSync(join(targetRoot, ".agents", "plugins"), { recursive: true });
			mkdirSync(join(targetPlugin, ".codex-plugin"), { recursive: true });
			writeFileSync(
				join(targetRoot, ".agents", "plugins", "marketplace.json"),
				JSON.stringify({ name: "litcodex", plugins: [{ name: "litcodex", source: "./plugins/litcodex" }] }),
			);
			writeFileSync(
				join(targetPlugin, ".codex-plugin", "plugin.json"),
				JSON.stringify({ name: "litcodex", version: "1.0.5" }),
			);
			const legacySkill = join(targetPlugin, "skills", "lit-korean");
			cpSync(join(REPO_ROOT, "packages/litcodex-ai/src/install/test-fixtures/legacy-lit-korean"), legacySkill, {
				recursive: true,
			});
			const entrypoint = join(legacySkill, "SKILL.md");
			writeFileSync(entrypoint, `${readFileSync(entrypoint, "utf8")}\nUser modification preserved.\n`);
			const warnings: string[] = [];
			const fakeSourceDir = join(root, "agents-src");
			mkdirSync(fakeSourceDir, { recursive: true });
			writeFileSync(join(fakeSourceDir, "litcodex-fake.toml"), VALID_FAKE_AGENT_TOML);
			const writeFs = makeMemWriteFs({
				initialFiles: new Map([[join(fakeSourceDir, "litcodex-fake.toml"), VALID_FAKE_AGENT_TOML]]),
				sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-fake.toml"]]]),
			});
			const rec = makeSpawnRecorder(() => ({ status: 0, stdout: "" }));
			const installDeps: ExecuteDeps = {
				spawn: rec.spawn,
				fs: fsWithCodex([codexBin]),
				env: { PATH: "/usr/local/bin", CODEX_BIN: codexBin },
				now: () => 0,
				repoRoot: REPO_ROOT,
				migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
				writeFs,
				agentsSourceDir: fakeSourceDir,
				codexHome,
				marketplaceSourceDir: sourceRoot,
				onWarning: (message) => warnings.push(message),
			};

			await executeInstallPlan(buildInstallPlan(baseOptions({ codexHome, repoUrl: targetRoot })), installDeps);

			expect(readFileSync(join(legacySkill, "SKILL.md"), "utf8")).toContain("User modification preserved.");
			expect(existsSync(join(targetPlugin, "skills", "lit-humanizer", "SKILL.md"))).toBe(true);
			expect(warnings).toEqual([
				"LitCodex kept a modified lit-korean skill copy; review or remove it from the managed marketplace.",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
