import { describe, expect, it, vi } from "vitest";

import { runCli } from "../cli.js";
import { resolveCodexHome } from "./codex.js";
import { InstallError } from "./errors.js";
import { type ExecuteDeps, executeInstallPlan } from "./execute.js";
import { baseOptions, makeMemWriteFs, REPO_ROOT } from "./install-test-helpers.js";
import { buildInstallPlan } from "./plan.js";

const VALID_FAKE_AGENT_TOML = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n';

describe("config-update seam", () => {
	const codexBin = "/usr/local/bin/codex";
	const fakeSourceDir = "/fake/agents-src";
	const fakeWfs = () =>
		makeMemWriteFs({
			initialFiles: new Map([[`${fakeSourceDir}/litcodex-fake.toml`, VALID_FAKE_AGENT_TOML]]),
			sourceDirEntries: new Map([[fakeSourceDir, ["litcodex-fake.toml"]]]),
		});

	it("calls migrateCodexConfig once with mode:install", async () => {
		const migrate = vi.fn<
			(opts: {
				env?: NodeJS.ProcessEnv;
				cwd?: string;
				mode?: string;
			}) => Promise<{ changed: string[]; backups: string[]; skipped: never[]; stateWritten: boolean }>
		>(async () => ({ changed: ["/h/.codex/config.toml"], backups: [], skipped: [], stateWritten: true }));
		const spawn: ExecuteDeps["spawn"] = (_c, args) => {
			const sub = args.join(" ");
			if (sub.includes("list")) {
				return { status: 0, stdout: "" }; // absent -> add will run
			}
			return { status: 0, stdout: "" };
		};
		const steps = buildInstallPlan(baseOptions({ codexHome: "/h/.codex" }));
		await executeInstallPlan(steps, {
			spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: migrate,
			codexHome: "/h/.codex",
			writeFs: fakeWfs(),
			agentsSourceDir: fakeSourceDir,
		});
		expect(migrate).toHaveBeenCalledTimes(1);
		expect(migrate.mock.calls[0]?.[0]).toMatchObject({ mode: "install", cwd: "/h/.codex" });
	});

	it("maps CodexConfigMigrationError to LITCODEX_INSTALL_CONFIG_WRITE_FAILED exit 3", async () => {
		const { CodexConfigMigrationError } = await import("../config-migration/errors.js");
		const migrate = async () => {
			throw new CodexConfigMigrationError("CONFIG_MALFORMED", "bad", "/h/.codex/config.toml");
		};
		const spawn: ExecuteDeps["spawn"] = (_c, args) => {
			const sub = args.join(" ");
			if (sub.includes("list")) {
				return { status: 0, stdout: "" };
			}
			return { status: 0, stdout: "" };
		};
		const steps = buildInstallPlan(baseOptions({ codexHome: "/h/.codex" }));
		await expect(
			executeInstallPlan(steps, {
				spawn,
				fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
				env: { CODEX_BIN: codexBin },
				now: () => 0,
				repoRoot: REPO_ROOT,
				migrateConfig: migrate,
				writeFs: fakeWfs(),
				agentsSourceDir: fakeSourceDir,
				codexHome: "/h/.codex",
			}),
		).rejects.toMatchObject({ code: "LITCODEX_INSTALL_CONFIG_WRITE_FAILED" });
	});

	it("reports a preserved user-modified config as skipped with explicit reconfigure guidance", async () => {
		const migrate = async () => ({
			changed: [],
			backups: [],
			skipped: [{ path: "/h/.codex/config.toml", reason: "user-modified" as const }],
			stateWritten: true,
		});
		const spawn: ExecuteDeps["spawn"] = (_c, args) => {
			const sub = args.join(" ");
			if (sub.includes("list")) return { status: 0, stdout: "" };
			return { status: 0, stdout: "" };
		};
		const steps = buildInstallPlan(baseOptions({ codexHome: "/h/.codex" }));

		const result = await executeInstallPlan(steps, {
			spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: migrate,
			writeFs: fakeWfs(),
			agentsSourceDir: fakeSourceDir,
			codexHome: "/h/.codex",
		});

		const config = result.steps.find((step) => step.kind === "config-update");
		expect(config).toMatchObject({ status: "skipped", detail: expect.stringContaining("--reconfigure") });
	});

	it("reports a state-recognized explicit Sol config as preserved rather than current alias", async () => {
		const migrate = async () => ({
			changed: [],
			backups: [],
			skipped: [{ path: "/h/.codex/config.toml", reason: "preserved" as const }],
			stateWritten: true,
		});
		const steps = buildInstallPlan(baseOptions({ codexHome: "/h/.codex" }));
		const result = await executeInstallPlan(steps, {
			spawn: () => ({ status: 0, stdout: "" }),
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: migrate,
			writeFs: fakeWfs(),
			agentsSourceDir: fakeSourceDir,
			codexHome: "/h/.codex",
		});
		const config = result.steps.find((step) => step.kind === "config-update");
		expect(config).toMatchObject({ status: "skipped", detail: expect.stringContaining("preserved") });
		expect(config?.detail).toContain("--reconfigure");
		expect(config?.detail).not.toContain("already current");
	});

	it("reports partial application when profile files change but the root config is preserved", async () => {
		const migrate = async () => ({
			changed: ["/h/.codex/gpt56-sol-high.config.toml"],
			backups: [],
			skipped: [{ path: "/h/.codex/config.toml", reason: "user-modified" as const }],
			stateWritten: true,
		});
		const spawn: ExecuteDeps["spawn"] = (_c, args) => {
			const sub = args.join(" ");
			if (sub.includes("list")) return { status: 0, stdout: "" };
			return { status: 0, stdout: "" };
		};
		const steps = buildInstallPlan(baseOptions({ codexHome: "/h/.codex" }));

		const result = await executeInstallPlan(steps, {
			spawn,
			fs: { existsSync: (p) => p === codexBin, readFileSync: () => "" },
			env: { CODEX_BIN: codexBin },
			now: () => 0,
			repoRoot: REPO_ROOT,
			migrateConfig: migrate,
			writeFs: fakeWfs(),
			agentsSourceDir: fakeSourceDir,
			codexHome: "/h/.codex",
		});

		const config = result.steps.find((step) => step.kind === "config-update");
		expect(config).toMatchObject({
			status: "ok",
			detail: expect.stringContaining("partially applied"),
		});
		expect(config?.detail).toContain("--reconfigure");
	});
});

describe("codex home resolution", () => {
	it("trims CODEX_HOME and falls back to ~/.codex when empty", () => {
		expect(resolveCodexHome({ CODEX_HOME: "  /x/.codex  " })).toBe("/x/.codex");
		const home = resolveCodexHome({ CODEX_HOME: "", HOME: "/home/u" });
		expect(home).toContain(".codex");
	});
});

describe("loop/hook routes delegate to the bundled @litcodex/lit-loop", () => {
	it("loop status routes locally (not unknown), exit != 1", async () => {
		const out: string[] = [];
		const err: string[] = [];
		const ws = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
			out.push(String(c));
			return true;
		});
		const we = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
			err.push(String(c));
			return true;
		});
		try {
			const code = await runCli(["loop", "help"]);
			// loop help resolves cleanly off the bundled runtime.
			expect(code).toBe(0);
		} finally {
			ws.mockRestore();
			we.mockRestore();
		}
		expect(out.join("")).not.toBe("");
	});

	it("InstallError carries a typed code", () => {
		const e = new InstallError("LITCODEX_INSTALL_BAD_FLAG", "nope");
		expect(e.code).toBe("LITCODEX_INSTALL_BAD_FLAG");
	});
});
