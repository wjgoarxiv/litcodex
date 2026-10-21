import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	type AutoUpdateSpawn,
	autoUpdateWorstCaseMs,
	DEFAULT_AUTO_UPDATE_TIMEOUT_MS,
	resolveAutoUpdatePlan,
	resolveNpmCommand,
	resolveNpmInvocation,
	runForegroundAutoUpdate,
	sanitizeNpmEnvironment,
	shellSafeInvocation,
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

	it("finds the npm beside node.exe when a session hook has no npm_execpath", () => {
		expect(
			resolveNpmInvocation(["view"], {
				platform: "win32",
				npmExecPath: undefined,
				nodePath: "C:\\Program Files\\nodejs\\node.exe",
				exists: (path) => path === "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
			}),
		).toEqual({
			command: "C:\\Program Files\\nodejs\\node.exe",
			args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "view"],
		});
	});

	it("never spawns a .cmd shim without a shell on Windows (spawnSync npm.cmd EINVAL)", () => {
		expect(shellSafeInvocation("npm.cmd", ["install", "--global", "@litfamily/litcodex@1.2.4"], "win32")).toEqual({
			command: "npm.cmd install --global @litfamily/litcodex@1.2.4",
			args: [],
			shell: true,
		});
		expect(shellSafeInvocation("C:\\My Tools\\npm.CMD", ["view", "a b"], "win32").command).toBe(
			'"C:\\My Tools\\npm.CMD" view "a b"',
		);
		expect(() => shellSafeInvocation("npm.cmd", ["x&calc"], "win32")).toThrow(/refusing to pass/u);
		expect(shellSafeInvocation("npm.cmd", ["view"], "linux")).toEqual({
			command: "npm.cmd",
			args: ["view"],
			shell: false,
		});
		expect(shellSafeInvocation("C:\\node.exe", ["npm-cli.js"], "win32").shell).toBe(false);
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
		["CI", [], { CI: "true" }],
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
			expect(existsSync(join(root, "lock"))).toBe(false);
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

	it("installs the exact target into Codex, then requires its healthy doctor", () => {
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
			["exec", "--global", "--", "litcodex", "install", "--no-auto-update"],
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

	it("installs the new plugin into Codex before the target doctor verifies it", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-codex-install-"));
		try {
			const host = statefulHost({ globalVersion: "1.2.3", marketplaceVersion: "1.2.3", registryVersion: "1.2.4" });
			const result = runForegroundAutoUpdate({
				env: { PATH: "/bin", CODEX_HOME: "/codex-home" },
				now: 100,
				currentVersion: "1.2.3",
				source: "session-start",
				stateRoot: root,
				spawn: host.spawn,
			});
			expect(result.reason).toBeUndefined();
			expect(result.status).toBe("updated");
			expect(host.globalVersion).toBe("1.2.4");
			expect(host.marketplaceVersion).toBe("1.2.4");
			const codexInstall = host.calls.find(
				(call) => call.args.includes("litcodex") && call.args.includes("install"),
			);
			expect(codexInstall?.args).toEqual(["exec", "--global", "--", "litcodex", "install", "--no-auto-update"]);
			// The target package must manage the same Codex home as the session that started the update.
			expect(codexInstall?.env["CODEX_HOME"]).toBe("/codex-home");
			expect(codexInstall?.env["LITCODEX_NO_AUTO_UPDATE"]).toBe("1");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("gives installs a measured limit and keeps short probes on the probe limit", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-limits-"));
		try {
			const host = statefulHost({ globalVersion: "1.2.3", marketplaceVersion: "1.2.3", registryVersion: "1.2.4" });
			runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				source: "session-start",
				stateRoot: root,
				spawn: host.spawn,
			});
			const installs = host.calls.filter((call) => call.args.includes("install"));
			const probes = host.calls.filter((call) => !call.args.includes("install"));
			expect(installs).toHaveLength(2);
			expect(probes.map((call) => call.args.at(-1))).toEqual(["--json", "--version", "--no-auto-update"]);
			for (const call of installs) expect(call.timeout).toBeGreaterThanOrEqual(60_000);
			for (const call of probes) expect(call.timeout).toBe(DEFAULT_AUTO_UPDATE_TIMEOUT_MS);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rolls the Codex plugin back with the package when the target doctor fails", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-codex-rollback-"));
		try {
			const host = statefulHost({
				globalVersion: "1.2.3",
				marketplaceVersion: "1.2.3",
				registryVersion: "1.2.4",
				unhealthyVersion: "1.2.4",
			});
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				source: "session-start",
				stateRoot: root,
				spawn: host.spawn,
			});
			expect(result.status).toBe("failed");
			expect(result.rollbackAttempted).toBe(true);
			expect(result.reason).toContain("post-install-verification:unavailable");
			expect(host.globalVersion).toBe("1.2.3");
			expect(host.marketplaceVersion).toBe("1.2.3");
			expect(JSON.parse(readFileSync(join(root, "journal.json"), "utf8"))).toMatchObject({ phase: "rolled-back" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("leaves state unknown when the old Codex plugin cannot be restored", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-codex-restore-fail-"));
		try {
			const host = statefulHost({
				globalVersion: "1.2.3",
				marketplaceVersion: "1.2.3",
				registryVersion: "1.2.4",
				unhealthyVersion: "1.2.4",
				codexInstallFailsFor: "1.2.3",
			});
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				source: "management-command",
				stateRoot: root,
				spawn: host.spawn,
			});
			expect(result.status).toBe("unknown-state");
			expect(result.reason).toContain("rollback-failed");
			expect(host.marketplaceVersion).toBe("1.2.4");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("checks the throttle before it asks the registry", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-throttle-first-"));
		try {
			writeFileSync(join(root, "state.json"), JSON.stringify({ lastCheckedAt: 50, lastStatus: "success" }));
			const host = statefulHost({ globalVersion: "1.2.3", marketplaceVersion: "1.2.3", registryVersion: "1.2.4" });
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				source: "session-start",
				stateRoot: root,
				spawn: host.spawn,
			});
			expect(result.status).toBe("throttled");
			expect(host.calls).toHaveLength(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps an earlier failure visible through later throttled and up-to-date checks", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-failure-visible-"));
		try {
			const failing = statefulHost({
				globalVersion: "1.2.3",
				marketplaceVersion: "1.2.3",
				registryVersion: "1.2.4",
				npmInstallFails: true,
			});
			const run = (now: number, spawn: AutoUpdateSpawn, currentVersion = "1.2.3") =>
				runForegroundAutoUpdate({ env: {}, now, currentVersion, source: "session-start", stateRoot: root, spawn });
			expect(run(100, failing.spawn).status).toBe("failed");
			const receipt = () => JSON.parse(readFileSync(join(root, "receipt.json"), "utf8")) as Record<string, unknown>;
			const state = () => JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as Record<string, unknown>;

			expect(run(200, failing.spawn).status).toBe("throttled");
			expect(receipt()).toMatchObject({ status: "failed", latestVersion: "1.2.4" });

			// The registry briefly reports the installed version: still short of the failed 1.2.4 target.
			const retreated = statefulHost({
				globalVersion: "1.2.3",
				marketplaceVersion: "1.2.3",
				registryVersion: "1.2.3",
			});
			expect(run(100 + 31 * 60 * 1000, retreated.spawn).status).toBe("up-to-date");
			expect(receipt()).toMatchObject({ status: "failed", latestVersion: "1.2.4" });
			expect(state()).toMatchObject({ lastStatus: "failed" });

			// Once the failed target is installed, the failure is history and up-to-date may replace it.
			const reached = statefulHost({
				globalVersion: "1.2.4",
				marketplaceVersion: "1.2.4",
				registryVersion: "1.2.4",
			});
			expect(run(100 + 62 * 60 * 1000, reached.spawn, "1.2.4").status).toBe("up-to-date");
			expect(receipt()).toMatchObject({ status: "up-to-date" });
			expect(state()).toMatchObject({ lastStatus: "success" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps an update receipt through the throttled sessions that follow it", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-keeps-updated-"));
		try {
			const host = statefulHost({ globalVersion: "1.2.3", marketplaceVersion: "1.2.3", registryVersion: "1.2.4" });
			const offline: AutoUpdateSpawn = (command, args, options) =>
				args[0] === "view" ? { status: 1, signal: null, error: undefined } : host.spawn(command, args, options);
			const run = (now: number, currentVersion: string, spawn = host.spawn) =>
				runForegroundAutoUpdate({ env: {}, now, currentVersion, source: "session-start", stateRoot: root, spawn });
			const receipt = () => JSON.parse(readFileSync(join(root, "receipt.json"), "utf8")) as Record<string, unknown>;
			const dayLater = 100 + 25 * 60 * 60 * 1000;
			expect(run(100, "1.2.3").status).toBe("updated");
			// The next session is throttled; the doctor must still be able to say an update happened.
			expect(run(200, "1.2.4").status).toBe("throttled");
			expect(receipt()).toMatchObject({ status: "updated", currentVersion: "1.2.3", latestVersion: "1.2.4" });
			// A day later a check that cannot reach the registry is news, so it replaces the update receipt.
			expect(run(dayLater, "1.2.4", offline)).toMatchObject({ status: "skipped", reason: "unknown-latest" });
			expect(receipt()).toMatchObject({ status: "skipped", reason: "unknown-latest" });
			expect(run(dayLater + 1, "1.2.4").status).toBe("up-to-date");
			expect(receipt()).toMatchObject({ status: "up-to-date" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("records when the update finished, not only when it started", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-finish-time-"));
		try {
			const host = statefulHost({ globalVersion: "1.2.3", marketplaceVersion: "1.2.3", registryVersion: "1.2.4" });
			let tick = 1_000;
			const result = runForegroundAutoUpdate({
				env: {},
				currentVersion: "1.2.3",
				source: "session-start",
				stateRoot: root,
				spawn: host.spawn,
				clock: () => {
					tick += 5_000;
					return tick;
				},
			});
			expect(result.status).toBe("updated");
			expect(Date.parse(result.finishedAt)).toBeGreaterThan(Date.parse(result.startedAt));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("puts back the plugin folder the running session started from when Codex removes it", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-foreground-update-keep-root-"));
		try {
			const cache = join(root, "codex", "plugins", "cache", "litcodex", "litcodex");
			const running = join(cache, "1.2.3");
			mkdirSync(join(running, "skills", "lit-loop"), { recursive: true });
			writeFileSync(join(running, "skills", "lit-loop", "SKILL.md"), "old skill\n");
			const host = statefulHost({ globalVersion: "1.2.3", marketplaceVersion: "1.2.3", registryVersion: "1.2.4" });
			const spawn: AutoUpdateSpawn = (command, args, options) => {
				const result = host.spawn(command, args, options);
				// The real host replaces the whole cache folder when the new plugin is installed.
				if (args.includes("install") && args.includes("litcodex") && result.status === 0) {
					rmSync(cache, { recursive: true, force: true });
					mkdirSync(join(cache, host.marketplaceVersion), { recursive: true });
				}
				return result;
			};
			const result = runForegroundAutoUpdate({
				env: {},
				now: 100,
				currentVersion: "1.2.3",
				source: "session-start",
				stateRoot: join(root, "state"),
				spawn,
				keepPluginRoot: running,
			});
			expect(result.status).toBe("updated");
			expect(readFileSync(join(running, "skills", "lit-loop", "SKILL.md"), "utf8")).toBe("old skill\n");
			expect(existsSync(join(cache, "1.2.4"))).toBe(true);
			expect(existsSync(join(root, "state", "kept-plugin"))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps the auto-update hook entry and its place stable, so Codex keeps trusting it", () => {
		// Codex stores a trust hash per hook under `session_start:<group>:<hook>`. Changing this entry or moving it
		// makes every user's earlier approval stale, and Codex then skips the updater without a word.
		const { hooks } = JSON.parse(readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8")) as {
			hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
		};
		const groups = hooks["SessionStart"] ?? [];
		const index = groups.findIndex((group) =>
			group.hooks.some((entry) => String(entry["command"]).includes("components/auto-update/dist/cli.js")),
		);
		expect(index).toBe(1);
		expect(groups[index]?.hooks).toEqual([
			{
				type: "command",
				command: `node "\${PLUGIN_ROOT}/components/auto-update/dist/cli.js" hook session-start`,
				timeout: 300,
				statusMessage: "🔥 LIT IGNITED · auto-update 🔥",
			},
		]);
	});

	it("lets the SessionStart hook and the CLI wait out the longest transaction", () => {
		const { hooks } = JSON.parse(readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8")) as {
			hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>;
		};
		const hook = hooks["SessionStart"]
			?.flatMap((group) => group.hooks)
			.find((entry) => entry.command.includes("components/auto-update/dist/cli.js"));
		expect((hook?.timeout ?? 0) * 1000).toBeGreaterThan(autoUpdateWorstCaseMs());
		const cliSource = readFileSync(
			new URL("../../../../../packages/litcodex-ai/src/auto-update.ts", import.meta.url),
			"utf8",
		);
		const cliTimeout = Number(
			/FOREGROUND_AUTO_UPDATE_TIMEOUT_MS = ([\d_]+)/u.exec(cliSource)?.[1]?.replaceAll("_", ""),
		);
		expect(cliTimeout).toBeGreaterThan(autoUpdateWorstCaseMs());
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

interface HostCall {
	readonly args: readonly string[];
	readonly env: NodeJS.ProcessEnv;
	readonly timeout: number;
}

/**
 * A fake host that remembers what npm installed globally and which version the Codex marketplace
 * holds. The target doctor is healthy only when both agree, as the real doctor's version check is.
 */
function statefulHost(options: {
	readonly globalVersion: string;
	readonly marketplaceVersion: string;
	readonly registryVersion: string;
	readonly unhealthyVersion?: string;
	readonly codexInstallFailsFor?: string;
	readonly npmInstallFails?: boolean;
}) {
	const host = {
		globalVersion: options.globalVersion,
		marketplaceVersion: options.marketplaceVersion,
		calls: [] as HostCall[],
		spawn: undefined as unknown as AutoUpdateSpawn,
	};
	host.spawn = (_command, args, spawnOptions) => {
		host.calls.push({ args, env: spawnOptions.env, timeout: spawnOptions.timeout });
		const ok = (stdout = "") => ({ status: 0, stdout, signal: null, error: undefined });
		const fail = { status: 1, signal: null, error: undefined };
		if (args[0] === "view") return ok(`${JSON.stringify(options.registryVersion)}\n`);
		if (args[0] === "install") {
			if (options.npmInstallFails && args.at(-1) !== `@litfamily/litcodex@${options.globalVersion}`) return fail;
			host.globalVersion = String(args.at(-1)).split("@").at(-1) as string;
			return ok();
		}
		const litcodex = args[0] === "exec" ? args.slice(args.indexOf("litcodex") + 1) : [];
		if (litcodex[0] === "--version") return ok(`${host.globalVersion}\n`);
		if (litcodex[0] === "install") {
			if (options.codexInstallFailsFor === host.globalVersion) return fail;
			host.marketplaceVersion = host.globalVersion;
			return ok();
		}
		if (litcodex[0] === "doctor") {
			const healthy =
				host.marketplaceVersion === host.globalVersion && host.globalVersion !== options.unhealthyVersion;
			return healthy ? ok('{"ok":true}\n') : { ...fail, stdout: '{"ok":false}\n' };
		}
		return fail;
	};
	return host;
}
