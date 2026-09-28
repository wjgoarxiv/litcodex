import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	DEFAULT_AUTO_UPDATE_TIMEOUT_MS,
	resolveAutoUpdatePlan,
	resolveNpmCommand,
	resolveNpmInvocation,
	runForegroundAutoUpdate,
	sanitizeNpmEnvironment,
	verifyInstalledVersion,
} from "./auto-update.js";

describe("foreground auto-update plan", () => {
	it("resolves the Windows npm shim through an injected platform", () => {
		expect(resolveNpmCommand("win32")).toBe("npm.cmd");
		expect(resolveNpmCommand("linux")).toBe("npm");
		expect(
			resolveNpmInvocation(["run", "build"], {
				platform: "win32",
				npmExecPath: "C:\\Program Files\\nodejs\\npm-cli.js",
				nodePath: "C:\\Program Files\\nodejs\\node.exe",
			}),
		).toEqual({
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: ["C:\\Program Files\\nodejs\\npm-cli.js", "run", "build"],
		});
	});

	it("is default-on and pins the exact stable version", () => {
		const plan = resolveAutoUpdatePlan({
			env: {},
			now: 100,
			currentVersion: "1.2.3",
			latestVersion: "1.2.4",
			source: "session-start",
		});
		expect(plan).toMatchObject({ shouldRun: true, currentVersion: "1.2.3", latestVersion: "1.2.4" });
		expect(plan.args).toEqual(["install", "--global", "--no-fund", "--no-audit", "@litfamily/litcodex@1.2.4"]);
	});

	it.each([
		["flag", ["doctor", "--no-auto-update"], {}],
		["environment", [], { LITCODEX_NO_AUTO_UPDATE: "1" }],
		["existing notifier opt-out", [], { NO_UPDATE_NOTIFIER: "1" }],
		["existing check opt-out", [], { LITCODEX_NO_UPDATE_CHECK: "1" }],
		["recursion guard", [], { LITCODEX_AUTO_UPDATE_IN_PROGRESS: "1" }],
	] as const)("honors %s before scheduling", (_label, argv, env) => {
		expect(
			resolveAutoUpdatePlan({
				env,
				now: 100,
				argv,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "management-command",
			}).shouldRun,
		).toBe(false);
	});

	it("rejects prerelease, build, and malformed versions", () => {
		for (const latestVersion of ["1.2.4-beta.1", "1.2.4+build", "latest", "01.2.4"]) {
			expect(
				resolveAutoUpdatePlan({
					env: {},
					now: 100,
					currentVersion: "1.2.3",
					latestVersion,
					source: "session-start",
				}).shouldRun,
			).toBe(false);
		}
	});
});

describe("foreground auto-update transaction", () => {
	it("waits for npm, writes journal and receipt, and never detaches", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-"));
		try {
			const calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
			const result = runForegroundAutoUpdate({
				env: { PATH: "/bin", NPM_TOKEN: "secret", LITCODEX_LATEST_VERSION: "1.2.4" },
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "session-start",
				stateRoot: root,
				spawn: (command, args, options) => {
					calls.push({ command, args, env: options.env ?? {} });
					return { status: 0, signal: null, error: undefined };
				},
				verifyInstalled: (expectedVersion) => ({
					status: "verified",
					expectedVersion,
					observedVersion: expectedVersion,
					doctorStatus: "passed",
					doctorDetail: "target litcodex doctor --json passed",
					detail: `global litcodex resolved exact ${expectedVersion}`,
				}),
			});
			expect(result.status).toBe("updated");
			expect(calls).toHaveLength(1);
			expect(calls[0]?.args).toContain("@litfamily/litcodex@1.2.4");
			expect(calls[0]?.env["NPM_TOKEN"]).toBeUndefined();
			expect(calls[0]?.env["LITCODEX_AUTO_UPDATE_IN_PROGRESS"]).toBe("1");
			expect(result.receiptPath).toBe(join(root, "receipt.json"));
			expect(existsSync(result.receiptPath)).toBe(true);
			expect(JSON.parse(readFileSync(result.receiptPath, "utf8"))).toMatchObject({
				status: "updated",
				verificationStatus: "verified",
				verifiedVersion: "1.2.4",
			});
			expect(DEFAULT_AUTO_UPDATE_TIMEOUT_MS).toBeGreaterThan(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a misleading npm exit 0 when the global version remains stale", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-misleading-"));
		try {
			let installAttempt = 0;
			const calls: readonly (readonly string[])[] = [];
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "session-start",
				stateRoot: root,
				spawn: (_command, args) => {
					(calls as (readonly string[])[]).push(args);
					if (args[0] === "install" && args.at(-1) === "@litfamily/litcodex@1.2.4") {
						installAttempt += 1;
						return { status: 0, signal: null, error: undefined };
					}
					if (args[0] === "exec") return { status: 0, stdout: "1.2.3\n", signal: null, error: undefined };
					return { status: 0, signal: null, error: undefined };
				},
			});
			expect(result.status).toBe("failed");
			expect(result.rollbackAttempted).toBe(true);
			expect(result.verificationStatus).toBe("mismatch");
			expect(result.verifiedVersion).toBe("1.2.3");
			expect(result.reason).toContain("post-install-verification:mismatch");
			expect(installAttempt).toBe(1);
			expect(calls).toHaveLength(3);
			expect(JSON.parse(readFileSync(join(root, "journal.json"), "utf8"))).toMatchObject({
				phase: "rolled-back",
				verificationStatus: "mismatch",
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports an unavailable version probe without treating npm exit 0 as committed", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-unavailable-"));
		try {
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "management-command",
				stateRoot: root,
				spawn: (_command, args) =>
					args[0] === "exec"
						? { status: 1, signal: null, error: undefined }
						: { status: 0, signal: null, error: undefined },
			});
			expect(result.status).toBe("failed");
			expect(result.verificationStatus).toBe("unavailable");
			expect(result.rollbackAttempted).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not steal a live lock and recovers a lock older than the bounded transaction", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-lock-"));
		try {
			const lockPath = join(root, "lock");
			writeFileSync(lockPath, "live\n");
			let calls = 0;
			const locked = runForegroundAutoUpdate({
				env: { LITCODEX_AUTO_UPDATE_LOCK_STALE_MS: "1" },
				now: Date.now(),
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "session-start",
				stateRoot: root,
				timeoutMs: 60_000,
				spawn: () => {
					calls += 1;
					return { status: 0, signal: null, error: undefined };
				},
			});
			expect(locked.status).toBe("locked");
			expect(calls).toBe(0);

			const now = Date.now();
			utimesSync(lockPath, new Date(now - 360_000), new Date(now - 360_000));
			let attempt = 0;
			const recovered = runForegroundAutoUpdate({
				env: { LITCODEX_AUTO_UPDATE_LOCK_STALE_MS: "1" },
				now,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "session-start",
				stateRoot: root,
				timeoutMs: 1,
				spawn: () => {
					attempt += 1;
					return { status: attempt === 1 ? 1 : 0, signal: null, error: undefined };
				},
			});
			expect(recovered.status).toBe("failed");
			expect(recovered.rollbackAttempted).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("falls back from a zero timeout so npm cannot run without a bound", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-zero-timeout-"));
		try {
			const timeouts: number[] = [];
			let attempt = 0;
			const result = runForegroundAutoUpdate({
				env: { LITCODEX_AUTO_UPDATE_TIMEOUT_MS: "0" },
				now: 100,
				timeoutMs: 0,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "session-start",
				stateRoot: root,
				spawn: (_command, _args, options) => {
					timeouts.push(options.timeout);
					attempt += 1;
					return { status: attempt === 1 ? 1 : 0, signal: null, error: undefined };
				},
			});
			expect(result.status).toBe("failed");
			expect(timeouts.length).toBe(2);
			expect(timeouts.every((value) => value >= 1)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not remove a replacement lock owned by a newer transaction", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-lock-owner-"));
		try {
			let attempt = 0;
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "management-command",
				stateRoot: root,
				spawn: (_command, _args, _options) => {
					attempt += 1;
					if (attempt === 1) writeFileSync(join(root, "lock"), "new-owner-token\n");
					return { status: attempt === 1 ? 1 : 0, signal: null, error: undefined };
				},
			});
			expect(result.status).toBe("failed");
			expect(readFileSync(join(root, "lock"), "utf8")).toBe("new-owner-token\n");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("verifies the exact global CLI version and rejects a stale executable", () => {
		const calls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
		const result = verifyInstalledVersion("1.2.4", {
			command: "npm",
			cwd: process.cwd(),
			env: { NO_UPDATE_NOTIFIER: "1" },
			timeout: 1000,
			spawn: (_command, args, options) => {
				calls.push({ args, env: options.env });
				return { status: 0, stdout: "1.2.3\n", signal: null, error: undefined };
			},
		});
		expect(result).toMatchObject({ status: "mismatch", expectedVersion: "1.2.4", observedVersion: "1.2.3" });
		expect(calls[0]?.args).toEqual(["exec", "--global", "--", "litcodex", "--version"]);
	});

	it("requires a healthy target-package doctor after the exact version probe", () => {
		const calls: readonly (readonly string[])[] = [];
		const result = verifyInstalledVersion("1.2.4", {
			command: "npm",
			cwd: process.cwd(),
			env: {},
			timeout: 1000,
			spawn: (_command, args) => {
				(calls as (readonly string[])[]).push(args);
				return args.at(-1) === "--version"
					? { status: 0, stdout: "1.2.4\n", signal: null, error: undefined }
					: { status: 0, stdout: '{"ok":true}\n', signal: null, error: undefined };
			},
		});
		expect(result).toMatchObject({ status: "verified", doctorStatus: "passed", observedVersion: "1.2.4" });
		expect(calls).toEqual([
			["exec", "--global", "--", "litcodex", "--version"],
			["exec", "--global", "--", "litcodex", "doctor", "--json", "--no-auto-update"],
		]);
	});

	it("rejects a doctor exit 0 that reports unhealthy JSON", () => {
		const result = verifyInstalledVersion("1.2.4", {
			command: "npm",
			cwd: process.cwd(),
			env: {},
			timeout: 1000,
			spawn: (_command, args) =>
				args.at(-1) === "--version"
					? { status: 0, stdout: "1.2.4\n", signal: null, error: undefined }
					: { status: 0, stdout: '{"ok":false}\n', signal: null, error: undefined },
		});
		expect(result).toMatchObject({ status: "unavailable", doctorStatus: "failed", observedVersion: "1.2.4" });
	});

	it("fails closed when npm reports exit 0 together with an error", () => {
		const result = verifyInstalledVersion("1.2.4", {
			command: "npm",
			cwd: process.cwd(),
			env: {},
			timeout: 1000,
			spawn: () => ({ status: 0, stdout: "1.2.4\n", signal: null, error: new Error("synthetic spawn error") }),
		});
		expect(result).toMatchObject({ status: "unavailable", doctorStatus: "not-run" });
	});

	it("records rollback on an npm failure and leaves a durable receipt", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-fail-"));
		try {
			const calls: readonly (readonly string[])[] = [];
			let attempt = 0;
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "management-command",
				stateRoot: root,
				spawn: (_command, args) => {
					(calls as (readonly string[])[]).push(args);
					const status = attempt === 0 ? 1 : 0;
					attempt += 1;
					return { status, signal: null, error: undefined };
				},
			});
			expect(result.status).toBe("failed");
			expect(result.rollbackAttempted).toBe(true);
			expect(calls).toHaveLength(2);
			expect(calls[1]).toContain("@litfamily/litcodex@1.2.3");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails closed with unknown-state when exact-version rollback also fails", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-unknown-"));
		try {
			let attempt = 0;
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "session-start",
				stateRoot: root,
				spawn: () => {
					attempt += 1;
					return { status: attempt === 1 ? 1 : 2, signal: null, error: undefined };
				},
			});
			expect(result.status).toBe("unknown-state");
			expect(result.rollbackAttempted).toBe(true);
			expect(result.rollbackStatus).toBe(2);
			expect(JSON.parse(readFileSync(join(root, "journal.json"), "utf8"))).toMatchObject({
				phase: "rollback-failed",
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails closed when rollback reports status zero with an error", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-rollback-error-"));
		try {
			let attempt = 0;
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				latestVersion: "1.2.4",
				source: "management-command",
				stateRoot: root,
				spawn: () => {
					attempt += 1;
					return attempt === 1
						? { status: 1, signal: null, error: undefined }
						: { status: 0, signal: null, error: new Error("rollback synthetic error") };
				},
			});
			expect(result.status).toBe("unknown-state");
			expect(result.rollbackStatus).toBe(0);
			expect(result.reason).toContain("rollback-failed:rollback synthetic error");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps only explicitly safe npm environment variables", () => {
		const filtered = sanitizeNpmEnvironment({
			PATH: "/bin",
			HOME: "/tmp",
			NPM_TOKEN: "secret",
			NODE_OPTIONS: "--import evil",
			npm_config_registry: "https://evil.example/registry",
			NPM_CONFIG_USERCONFIG: "/tmp/hostile.npmrc",
			npm_config_cache: "/tmp/hostile-cache",
			HTTPS_PROXY: "http://user:pass@proxy.example",
			"npm_config_//authToken": "secret",
		});
		try {
			expect(filtered).toMatchObject({
				PATH: "/bin",
				HOME: "/tmp",
				npm_config_registry: "https://registry.npmjs.org/",
				NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
			});
			expect(filtered["npm_config_userconfig"]).not.toBe("/tmp/hostile.npmrc");
			expect(filtered["npm_config_cache"]).not.toBe("/tmp/hostile-cache");
			expect(filtered["npm_config_userconfig"]).toBeTruthy();
			expect(filtered["npm_config_cache"]).toBeTruthy();
			expect(existsSync(filtered["npm_config_userconfig"] as string)).toBe(true);
			expect(existsSync(filtered["npm_config_cache"] as string)).toBe(true);
		} finally {
			const userconfig = filtered["npm_config_userconfig"];
			if (userconfig) rmSync(dirname(userconfig), { recursive: true, force: true });
		}
		expect(filtered).not.toHaveProperty("NPM_TOKEN");
		expect(filtered).not.toHaveProperty("NODE_OPTIONS");
		expect(filtered).not.toHaveProperty("HTTPS_PROXY");
		expect(filtered).not.toHaveProperty("npm_config_//authToken");
	});
});
