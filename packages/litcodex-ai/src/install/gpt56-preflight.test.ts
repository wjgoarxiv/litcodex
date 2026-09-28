import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runConfigMigrateCli } from "../config-migration/cli.js";
import type { SpawnLike } from "./codex.js";
import { type ExecuteDeps, executeInstallPlan } from "./execute.js";
import { renderCapability } from "./index.js";
import { buildInstallPlan } from "./plan.js";
import { renderInstallPlan } from "./render-plan.js";
import type { InstallOptions } from "./types.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function acceptedSpawn(calls: string[][], version = "0.144.0"): SpawnLike {
	return (_command, args) => {
		calls.push([...args]);
		if (args.join(" ") === "--version") return { status: 0, stdout: `codex-cli ${version}\n` };
		if (args.join(" ") === "debug models --bundled") {
			return {
				status: 0,
				stdout: JSON.stringify({
					models: [
						{ slug: "gpt-5.6", context_window: 372_000 },
						{ slug: "gpt-5.6-terra", context_window: 372_000 },
						{ slug: "gpt-5.6-luna", context_window: 372_000 },
					],
				}),
			};
		}
		return { status: 0, stdout: JSON.stringify({ checks: { "config.load": { status: "ok" } } }) };
	};
}

function deps(spawn: SpawnLike, migrateConfig: ExecuteDeps["migrateConfig"]): ExecuteDeps {
	return {
		spawn,
		fs: { existsSync: () => true, readFileSync: () => "" },
		env: { CODEX_BIN: "/fake/codex" },
		now: () => 0,
		repoRoot: "/repo",
		codexHome: "/tmp/codex-home",
		profile: "luna",
		effort: "max",
		reconfigure: true,
		enforceCapabilityPreflight: true,
		migrateConfig,
	};
}

describe("GPT-5.6 installer preflight", () => {
	it("renders selected migration intent and complete capability provenance", () => {
		const options: InstallOptions = {
			dryRun: true,
			noTui: true,
			autonomous: false,
			force: false,
			json: false,
			yes: false,
			profile: "luna",
			leadModel: "gpt-5.6-luna",
			subagentModel: "gpt-5.6-luna",
			subagentEffort: "max",
			effort: "max",
			reconfigure: true,
			codexHome: "/tmp/codex-home",
			repoUrl: "/repo",
			repoRoot: "/repo",
		};
		expect(renderInstallPlan(buildInstallPlan(options))).toContain("LUNA / max, explicit managed reconfigure");
		expect(renderCapability({ status: "hard", limit: 20, reason: "verified", observedSource: "codex 0.144.0" })).toBe(
			"hard; reason=verified; source=codex 0.144.0",
		);
	});

	it("strict-validates final selection and dry-runs migration before returning any executable plan result", async () => {
		const calls: string[][] = [];
		const migrate = vi.fn(async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }));
		const result = await executeInstallPlan([], deps(acceptedSpawn(calls), migrate));
		expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, profile: "luna", effort: "max" }));
		expect(result.capabilities?.concurrency).toMatchObject({ status: "hard", observedSource: expect.any(String) });
		const strict = calls.flat().join(" ");
		expect(strict).toContain('model="gpt-5.6-luna"');
		expect(strict).toContain("features.multi_agent=true");
		expect(strict).toContain("features.multi_agent_v2.enabled=true");
		expect(strict).toContain("features.multi_agent_v2.hide_spawn_agent_metadata=true");
		expect(strict).toContain("features.multi_agent_v2.max_concurrent_threads_per_session=20");
		expect(strict).not.toContain("agents.max_threads");
		expect(strict).toContain("agents.max_depth=1");
		expect(strict).toContain("model_context_window=372000");
		expect(strict).toContain("model_auto_compact_token_limit=334800");
	});

	it("strict rejection stops before dry-run migration or plugin mutation", async () => {
		const calls: string[][] = [];
		const base = acceptedSpawn(calls);
		// Reject only the probe that carries LitCodex overrides. The no-override baseline
		// still loads, so the managed settings really are the cause and the code stays
		// CONFIG_WRITE_FAILED. Rejecting every doctor call is the host-config case below.
		const rejected: SpawnLike = (command, args, options) => {
			const result = base(command, args, options);
			return args.includes("doctor") && args.includes("-c") ? { status: 1, stdout: "{}" } : result;
		};
		const migrate = vi.fn(async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }));
		await expect(executeInstallPlan([], deps(rejected, migrate))).rejects.toMatchObject({
			code: "LITCODEX_INSTALL_CONFIG_WRITE_FAILED",
		});
		expect(migrate).not.toHaveBeenCalled();
		expect(calls.some((args) => args.includes("add"))).toBe(false);
	});

	it("an incompatible host config also stops before dry-run migration or plugin mutation", async () => {
		const calls: string[][] = [];
		const base = acceptedSpawn(calls);
		const rejected: SpawnLike = (command, args, options) => {
			const result = base(command, args, options);
			return args.includes("doctor") ? { status: 1, stdout: "{}" } : result;
		};
		const migrate = vi.fn(async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }));
		await expect(executeInstallPlan([], deps(rejected, migrate))).rejects.toMatchObject({
			code: "LITCODEX_INSTALL_HOST_CONFIG_INCOMPATIBLE",
		});
		expect(migrate).not.toHaveBeenCalled();
		expect(calls.some((args) => args.includes("add"))).toBe(false);
	});

	it("continues safely on a newer stable host when strict probes pass with advisory proof", async () => {
		const calls: string[][] = [];
		const migrate = vi.fn(async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }));
		const result = await executeInstallPlan([], deps(acceptedSpawn(calls, "0.145.0"), migrate));
		expect(result.capabilities?.concurrency).toMatchObject({ status: "advisory", limit: 20 });
		expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
	});

	it("rejects an older host before migration with a version-specific install error", async () => {
		const calls: string[][] = [];
		const migrate = vi.fn(async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }));
		await expect(executeInstallPlan([], deps(acceptedSpawn(calls, "0.143.9"), migrate))).rejects.toMatchObject({
			code: "LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED",
			message: expect.stringContaining("0.144.0 or newer"),
		});
		expect(migrate).not.toHaveBeenCalled();
	});

	it("direct config migrate accepts an advisory newer stable host", async () => {
		const capabilities = {
			concurrency: { status: "advisory" as const, limit: 20, reason: "newer stable Codex", observedSource: "test" },
			autoCompaction: { status: "hard" as const, limit: 334_800, reason: "verified", observedSource: "test" },
			modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
		};
		const root = mkdtempSync(join(tmpdir(), "litcodex-advisory-preflight-"));
		roots.push(root);
		const output: string[] = [];
		const previousCodexHome = process.env["CODEX_HOME"];
		process.env["CODEX_HOME"] = join(root, "codex-home");
		let code: number;
		try {
			code = await runConfigMigrateCli(
				["--json", "--dry-run", "--cwd", root],
				(text) => output.push(text),
				() => undefined,
				{ preflight: () => capabilities },
			);
		} finally {
			if (previousCodexHome === undefined) delete process.env["CODEX_HOME"];
			else process.env["CODEX_HOME"] = previousCodexHome;
		}
		expect(code).toBe(0);
		expect(JSON.parse(output.join("")).capabilities.concurrency.status).toBe("advisory");
	});

	it("direct config migrate fails read-only when host proof is unavailable", async () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-direct-preflight-"));
		roots.push(root);
		const codexHome = join(root, "codex-home");
		const saved = { CODEX_HOME: process.env["CODEX_HOME"], CODEX_BIN: process.env["CODEX_BIN"] };
		process.env["CODEX_HOME"] = codexHome;
		process.env["CODEX_BIN"] = join(root, "missing-codex");
		try {
			const errors: string[] = [];
			const code = await runConfigMigrateCli(
				["--json"],
				() => undefined,
				(text) => errors.push(text),
			);
			expect(code).not.toBe(0);
			expect(errors.join("")).toContain("preflight");
			expect(existsSync(join(codexHome, "config.toml"))).toBe(false);
		} finally {
			if (saved.CODEX_HOME === undefined) delete process.env["CODEX_HOME"];
			else process.env["CODEX_HOME"] = saved.CODEX_HOME;
			if (saved.CODEX_BIN === undefined) delete process.env["CODEX_BIN"];
			else process.env["CODEX_BIN"] = saved.CODEX_BIN;
		}
	});

	it.each([
		["unknown model", ["--model", "mercury"]],
		["excluded effort before model", ["--effort", "medium", "--model", "luna"]],
		["excluded effort after model", ["--model", "luna", "--effort", "medium"]],
		["missing model", ["--model"]],
		["missing effort", ["--effort"]],
		["unknown option", ["--unknown"]],
	])("direct config migrate rejects %s before preflight or mutation", async (_label, args) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-invalid-option-"));
		roots.push(root);
		const preflight = vi.fn(() => {
			throw new Error("preflight must not run");
		});
		const errors: string[] = [];
		const code = await runConfigMigrateCli(
			args,
			() => undefined,
			(text) => errors.push(text),
			{ preflight },
		);
		expect(code).toBe(2);
		expect(JSON.parse(errors.join(""))).toMatchObject({ ok: false, code: "CONFIG_INVALID_OPTION" });
		expect(preflight).not.toHaveBeenCalled();
		expect(existsSync(join(root, "config.toml"))).toBe(false);
	});
});
