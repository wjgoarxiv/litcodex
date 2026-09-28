import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAgentsInstall } from "./agents-install.js";
import { type ExecuteDeps, executeInstallPlan, type WritableFsLike } from "./execute.js";
import { baseOptions, findLegacyTokens, makeMemWriteFs, makeSpawnRecorder, REPO_ROOT } from "./install-test-helpers.js";
import { buildInstallPlan } from "./plan.js";
import { renderInstallPlan } from "./render-plan.js";

describe("agents-install step — runAgentsInstall", () => {
	const codexBin = "/usr/local/bin/codex";
	const fakeSourceDir = "/fake/src/agents";
	const codexHome = "/tmp/codex-home-agents-test";
	const agentToml = (name: string) =>
		`model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n[agent]\nname="${name}"\n`;

	function agentStep() {
		const step = buildInstallPlan(baseOptions({ codexHome })).find((s) => s.kind === "agents-install");
		if (!step) throw new Error("agents-install step not found in plan");
		return step;
	}

	function baseAgentDeps(wfs: WritableFsLike, over: Partial<ExecuteDeps> = {}): ExecuteDeps {
		return {
			spawn: makeSpawnRecorder(() => ({ status: 0 })).spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => new Date("2024-06-14T12:00:00Z").getTime(),
			repoRoot: REPO_ROOT,
			migrateConfig: async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }),
			writeFs: wfs,
			agentsSourceDir: fakeSourceDir,
			codexHome,
			...over,
		};
	}

	it("fresh install: two toml files written; result detail mentions installed count", async () => {
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-alpha.toml`, agentToml("alpha")],
				[`${fakeSourceDir}/litcodex-beta.toml`, agentToml("beta")],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-alpha.toml", "litcodex-beta.toml"]]]),
		});
		const steps = [agentStep()];
		const result = await executeInstallPlan(steps, baseAgentDeps(wfs));
		const step = result.steps[0];
		expect(step?.status).toBe("ok");
		expect(step?.detail).toMatch(/2 agent role\(s\) installed/);
		// Both files written to <codexHome>/agents/
		expect(wfs.written.has(`${codexHome}/agents/litcodex-alpha.toml`)).toBe(true);
		expect(wfs.written.has(`${codexHome}/agents/litcodex-beta.toml`)).toBe(true);
		// Nothing written outside codexHome/agents
		for (const key of wfs.written.keys()) {
			expect(key.startsWith(`${codexHome}/agents/`)).toBe(true);
		}
	});

	it("fresh install applies an explicit Astra helper selection to the native default role header", async () => {
		const source = [
			'name = "default"',
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			'developer_instructions = """',
			"Keep the generic helper contract and tools.",
			'"""',
		].join("\n");
		const wfs = makeMemWriteFs({
			initialFiles: new Map([[`${fakeSourceDir}/litcodex-default.toml`, source]]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-default.toml"]]]),
		});

		await executeInstallPlan(
			[agentStep()],
			baseAgentDeps(wfs, {
				subagentModel: "gpt-6-astra",
				subagentEffort: "xhigh",
			}),
		);

		const installed = wfs.written.get(`${codexHome}/litcodex-default.toml`) ?? "";
		expect(installed).toContain('model = "gpt-6-astra"');
		expect(installed).toContain('model_reasoning_effort = "xhigh"');
		expect(installed).toContain("Keep the generic helper contract and tools.");
		expect(wfs.written.has(`${codexHome}/agents/litcodex-default.toml`)).toBe(false);
	});

	it("ordinary reinstall preserves the existing generic route even when Astra is selected", async () => {
		const source = [
			'name = "default"',
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			'developer_instructions = """',
			"Keep the generic helper contract and tools.",
			'"""',
		].join("\n");
		const existing = [
			'name = "user-owned-default"',
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			'developer_instructions = """',
			"User instructions remain byte-for-byte intact.",
			'"""',
		].join("\n");
		const target = `${codexHome}/litcodex-default.toml`;
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-default.toml`, source],
				[target, existing],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-default.toml"]]]),
		});

		const result = await executeInstallPlan(
			[agentStep()],
			baseAgentDeps(wfs, {
				subagentModel: "gpt-6-astra",
				subagentEffort: "xhigh",
			}),
		);

		expect(wfs.written.has(target)).toBe(false);
		expect(result.steps[0]?.detail).toContain("1 preserved");
		expect(result.steps[0]?.agentRoutes).toEqual([expect.objectContaining({ model: "gpt-5.6-luna", effort: "max" })]);
	});

	it("explicit reconfigure updates only the outside default header and backs up beside it", async () => {
		const source = [
			'name = "default"',
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			'developer_instructions = """',
			"Bundled generic instructions.",
			'"""',
		].join("\n");
		const existing = [
			'name = "user-owned-default"',
			'model = "gpt-5.6-luna"',
			'model_reasoning_effort = "max"',
			'developer_instructions = """',
			"User body must remain byte-for-byte intact.",
			'"""',
		].join("\n");
		const target = `${codexHome}/litcodex-default.toml`;
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-default.toml`, source],
				[target, existing],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-default.toml"]]]),
		});

		const result = await executeInstallPlan(
			[agentStep()],
			baseAgentDeps(wfs, {
				subagentModel: "gpt-6-astra",
				subagentEffort: "low",
				reconfigure: true,
			}),
		);

		const updated = wfs.written.get(target) ?? "";
		expect(updated).toContain('model = "gpt-6-astra"');
		expect(updated).toContain('model_reasoning_effort = "low"');
		expect(updated).toContain("User body must remain byte-for-byte intact.");
		const backup = [...wfs.written.keys()].find((path) => path.startsWith(`${target}.litcodex-bak.`));
		expect(backup).toBeDefined();
		expect(wfs.written.get(backup ?? "")).toBe(existing);
		expect([...wfs.written.keys()].every((path) => path.startsWith(codexHome))).toBe(true);
		expect(result.steps[0]?.agentRoutes).toEqual([expect.objectContaining({ model: "gpt-6-astra", effort: "low" })]);
	});

	it("refuses to create a second native default when the legacy autodiscovered role remains", async () => {
		const source = [
			'name = "default"',
			'model = "gpt-6-astra"',
			'model_reasoning_effort = "xhigh"',
			'developer_instructions = """',
			"User-owned bytes stay at the legacy path.",
			'"""',
		].join("\n");
		const legacy = `${codexHome}/agents/litcodex-default.toml`;
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-default.toml`, source],
				[legacy, source],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-default.toml"]]]),
		});

		await expect(
			executeInstallPlan(
				[agentStep()],
				baseAgentDeps(wfs, {
					subagentModel: "gpt-6-astra",
					subagentEffort: "low",
				}),
			),
		).rejects.toMatchObject({
			code: "LITCODEX_INSTALL_AGENTS_MISSING",
			details: expect.objectContaining({ path: legacy }),
		});
		expect(wfs.written.size).toBe(0);
	});

	it("rejects an existing role symlink before explicit reconfigure can follow it", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-agent-symlink-"));
		try {
			const sourceDir = join(root, "source");
			const codexHome = join(root, "home");
			const targetDir = join(codexHome, "agents");
			const victim = join(root, "victim.toml");
			const target = join(codexHome, "litcodex-default.toml");
			mkdirSync(sourceDir, { recursive: true });
			mkdirSync(targetDir, { recursive: true });
			const source = [
				'name = "default"',
				'model = "gpt-6-astra"',
				'model_reasoning_effort = "xhigh"',
				'developer_instructions = """',
				"bundled instructions",
				'"""',
			].join("\n");
			const originalVictim = [
				'name = "user-owned-default"',
				'model = "custom/provider-model"',
				'model_reasoning_effort = "medium"',
				'developer_instructions = """',
				"user-owned bytes",
				'"""',
			].join("\n");
			writeFileSync(join(sourceDir, "litcodex-default.toml"), source);
			writeFileSync(victim, originalVictim);
			symlinkSync(victim, target);

			expect(() =>
				runAgentsInstall(agentStep(), {
					now: () => 0,
					repoRoot: REPO_ROOT,
					codexHome,
					agentsSourceDir: sourceDir,
					reconfigure: true,
				}),
			).toThrow(expect.objectContaining({ code: "LITCODEX_INSTALL_AGENTS_MISSING" }));
			expect(readFileSync(victim, "utf8")).toBe(originalVictim);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a directory collision at the outside native default target before writing", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-agent-default-directory-"));
		try {
			const sourceDir = join(root, "source");
			const codexHome = join(root, "home");
			mkdirSync(sourceDir, { recursive: true });
			mkdirSync(codexHome, { recursive: true });
			mkdirSync(join(codexHome, "agents"), { recursive: true });
			mkdirSync(join(codexHome, "litcodex-default.toml"), { recursive: true });
			writeFileSync(
				join(sourceDir, "litcodex-default.toml"),
				[
					'name = "default"',
					'model = "gpt-6-astra"',
					'model_reasoning_effort = "low"',
					'developer_instructions = """generic"""',
				].join("\n"),
			);

			expect(() =>
				runAgentsInstall(agentStep(), {
					now: () => 0,
					repoRoot: REPO_ROOT,
					codexHome,
					agentsSourceDir: sourceDir,
				}),
			).toThrow(expect.objectContaining({ code: "LITCODEX_INSTALL_AGENTS_MISSING" }));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("idempotent: second run with same content writes nothing new (unchanged == 2)", async () => {
		const content1 = agentToml("alpha");
		const content2 = agentToml("beta");
		// Pre-seed target with same content as source.
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-alpha.toml`, content1],
				[`${fakeSourceDir}/litcodex-beta.toml`, content2],
				[`${codexHome}/agents/litcodex-alpha.toml`, content1],
				[`${codexHome}/agents/litcodex-beta.toml`, content2],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-alpha.toml", "litcodex-beta.toml"]]]),
		});
		const steps = [agentStep()];
		const result = await executeInstallPlan(steps, baseAgentDeps(wfs));
		const step = result.steps[0];
		expect(step?.status).toBe("ok");
		expect(step?.detail).toMatch(/0 agent role\(s\) installed, 2 unchanged/);
		// Second run should write nothing.
		expect(wfs.written.size).toBe(0);
	});

	it("explicit reconfigure: pre-existing file gets a header-only update and backup", async () => {
		const sourceContent = agentToml("alpha-v2");
		const oldContent = 'model = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\n[agent]\nname="alpha-v1"\n';
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-alpha.toml`, sourceContent],
				[`${codexHome}/agents/litcodex-alpha.toml`, oldContent],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-alpha.toml"]]]),
		});
		const steps = [agentStep()];
		await executeInstallPlan(steps, baseAgentDeps(wfs, { reconfigure: true }));
		// Explicit reconfigure updates only the native route header and keeps user body fields.
		const updated = wfs.written.get(`${codexHome}/agents/litcodex-alpha.toml`) ?? "";
		expect(updated).toContain('model = "gpt-5.6-sol"');
		expect(updated).toContain('model_reasoning_effort = "high"');
		expect(updated).toContain('name="alpha-v1"');
		expect(updated).not.toBe(sourceContent);
		// A backup file matching the pattern should exist.
		const backupKeys = [...wfs.written.keys()].filter((k) =>
			k.startsWith(`${codexHome}/agents/litcodex-alpha.toml.litcodex-bak.`),
		);
		expect(backupKeys.length).toBe(1);
		// Backup contains the OLD content.
		expect(wfs.written.get(backupKeys[0] ?? "")).toBe(oldContent);
		// All writes are inside codexHome/agents/.
		for (const key of wfs.written.keys()) {
			expect(key.startsWith(`${codexHome}/agents/`)).toBe(true);
		}
	});

	it("ordinary reinstall preserves a user-owned role byte-for-byte without a backup or overwrite", async () => {
		const sourceContent = agentToml("alpha-managed-v2");
		const userContent = [
			'model = "custom/provider-model"',
			'model_reasoning_effort = "medium"',
			'name = "user-owned-default"',
			'developer_instructions = """',
			"Keep this user instruction and tool policy.",
			'"""',
		].join("\n");
		const target = `${codexHome}/agents/litcodex-alpha.toml`;
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-alpha.toml`, sourceContent],
				[target, userContent],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-alpha.toml"]]]),
		});

		const result = await executeInstallPlan([agentStep()], baseAgentDeps(wfs));

		expect(wfs.written.has(target)).toBe(false);
		expect([...wfs.written.keys()].some((path) => path.includes(".litcodex-bak."))).toBe(false);
		expect(result.steps[0]?.detail).toContain("1 preserved");
		expect(result.steps[0]?.agentRoutes).toEqual([
			expect.objectContaining({ model: "custom/provider-model", effort: "medium" }),
		]);
	});

	it.each([
		["unsafe Astra", 'model = "gpt-6-astra"\nmodel_reasoning_effort = "invalid"\n', "UNSAFE_MODEL_ROUTE"],
		["malformed TOML", 'model = "gpt-6-astra\nmodel_reasoning_effort = "xhigh"\n', "AGENTS_MISSING"],
	])("preflights an existing %s before any agent write", (_label, existing, code) => {
		const target = `${codexHome}/agents/litcodex-alpha.toml`;
		const wfs = makeMemWriteFs({
			initialFiles: new Map([
				[`${fakeSourceDir}/litcodex-alpha.toml`, agentToml("alpha-managed")],
				[target, existing],
			]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-alpha.toml"]]]),
		});

		expect(() =>
			runAgentsInstall(agentStep(), {
				now: () => 0,
				repoRoot: REPO_ROOT,
				codexHome,
				writeFs: wfs,
				agentsSourceDir: fakeSourceDir,
			}),
		).toThrow(expect.objectContaining({ code: `LITCODEX_INSTALL_${code}` }));
		expect(wfs.written.size).toBe(0);
	});

	it("missing source dir → throws LITCODEX_INSTALL_AGENTS_MISSING", async () => {
		const wfs = makeMemWriteFs(); // empty — no source dir
		const steps = [agentStep()];
		await expect(executeInstallPlan(steps, baseAgentDeps(wfs))).rejects.toMatchObject({
			code: "LITCODEX_INSTALL_AGENTS_MISSING",
		});
	});

	it("dry-run plan includes agents-install step with the expected title; renderInstallPlan output contains it", () => {
		const steps = buildInstallPlan(baseOptions({ dryRun: true }));
		const agentsStep = steps.find((s) => s.kind === "agents-install");
		expect(agentsStep).toBeDefined();
		expect(agentsStep?.title).toBe("Install litwork subagent roles and native default route (backup-safe)");
		const text = renderInstallPlan(steps);
		expect(text).toContain("Install litwork subagent roles and native default route (backup-safe)");
		// No legacy tokens in the plan.
		expect(findLegacyTokens(text)).toEqual([]);
	});

	it("all writes confined to codexHome/agents/ sandbox (hermeticity assertion)", async () => {
		const wfs = makeMemWriteFs({
			initialFiles: new Map([[`${fakeSourceDir}/litcodex-gamma.toml`, agentToml("gamma")]]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-gamma.toml"]]]),
		});
		const steps = [agentStep()];
		await executeInstallPlan(steps, baseAgentDeps(wfs));
		for (const key of wfs.written.keys()) {
			expect(key.startsWith(`${codexHome}/agents/`), `Write escaped sandbox: ${key}`).toBe(true);
		}
	});
});
