import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexBin, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import { probeMarketplaceRegistered, probeMarketplaceRegistration, probePluginInstalled } from "./codex.js";
import { doctorScopeFor, renderDoctorText, runDoctor } from "./doctor.js";
import { runDoctorCli } from "./index.js";

describe("doctor — agentsInstalled probe", () => {
	it("agentsInstalled is true when the complete desired agent bundle is present", () => {
		const report = runDoctor(doctorDeps([codexBin, sentinelPath]));
		expect(report.agentsInstalled).toBe(true);
		const agentIssues = report.issues.filter((i) => i.includes("agent roles"));
		expect(agentIssues.length).toBe(0);
	});

	it("agentsInstalled is false and issue pushed when sentinel absent", () => {
		const report = runDoctor(doctorDeps([codexBin]));
		expect(report.agentsInstalled).toBe(false);
		expect(report.issues.some((i) => i.includes("litwork agent roles"))).toBe(true);
	});

	it("agentsInstalled is false in codex-not-found early return", () => {
		const report = runDoctor(doctorDeps([])); // codex binary not found either
		expect(report.codexBinaryFound).toBe(false);
		expect(report.agentsInstalled).toBe(false);
		expect(report.skillCatalogComplete).toBe(false);
		expect(report.handoffInstalled).toBe(false);
		expect(report.scientificVisualizationInstalled).toBe(false);
	});

	it("reports current host-default root limits separately from host capability support", () => {
		const report = runDoctor(
			doctorDeps([codexBin, sentinelPath], 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n'),
		);
		expect(report.effectiveConfig).toMatchObject({
			state: "applied",
			detail: expect.stringContaining("gpt-5.6 · high"),
		});
	});

	it("fails health when V2 exposes metadata that violates the reserved spawn schema", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\n[features.multi_agent_v2]\nenabled = true\nhide_spawn_agent_metadata = false\nmax_concurrent_threads_per_session = 20\n',
			),
		);
		expect(report.ok).toBe(false);
		expect(report.effectiveConfig).toMatchObject({
			state: "unavailable",
			detail: expect.stringContaining("reserved"),
		});
	});

	it("reports preserved root limits without downgrading healthy installation status", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				'model = "gpt-5.6"\nmodel_reasoning_effort = "xhigh"\nmodel_auto_compact_token_limit = 650000\n',
			),
		);
		expect(report.effectiveConfig).toMatchObject({
			state: "preserved",
			detail: expect.stringContaining("gpt-5.6 · xhigh"),
		});
		expect(report.ok).toBe(true);
	});

	it("labels context and compaction numbers as probe-only rather than effective config", () => {
		const text = renderDoctorText(
			runDoctor(doctorDeps([codexBin, sentinelPath], 'model = "gpt-5.6"\nmodel_reasoning_effort = "high"\n')),
		);
		expect(text).toContain("probe-only explicit context/auto-compaction override");
		expect(text).toContain("managed config remains unset");
		expect(text).not.toContain("context 372K / compact 90%");
	});

	it("keeps a newer stable probed host healthy and reports advisory concurrency as a warning", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
				undefined,
				"1.0.28",
				"0.145.0",
			),
		);
		expect(report.ok).toBe(true);
		expect(report.issues).toEqual([]);
		expect(report.warnings).toEqual([expect.stringContaining("advisory"), expect.stringContaining("auth mode")]);
	});

	it("rejects a same-name marketplace that still points at the private Git source", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
				"https://github.com/wjgoarxiv/litcodex",
			),
		);
		expect(report.marketplaceRegistered).toBe(false);
		expect(report.issues.some((issue) => issue.includes("managed local marketplace"))).toBe(true);
	});

	it("rejects a managed payload whose plugin version is stale", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
				undefined,
				"0.3.28",
			),
		);
		expect(report.hooksWired).toBe(false);
		expect(report.issues.some((issue) => issue.includes("payload"))).toBe(true);
	});

	it("fails health closed when the foreground updater receipt reports unknown state", () => {
		const stateRoot = mkdtempSync(join(tmpdir(), "litcodex-doctor-update-unknown-"));
		try {
			writeFileSync(join(stateRoot, "receipt.json"), JSON.stringify({ status: "unknown-state" }));
			const deps = doctorDeps([codexBin, sentinelPath]);
			const report = runDoctor({
				...deps,
				env: { ...deps.env, LITCODEX_AUTO_UPDATE_STATE_ROOT: stateRoot },
			});
			expect(report.ok).toBe(false);
			expect(report.autoUpdate?.status).toBe("unknown-state");
			expect(report.issues).toContainEqual(expect.stringContaining("installation state is unknown"));
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	});

	describe("auto-update state and remedies", () => {
		const doctorWithReceipt = (receipt: Record<string, unknown>, config?: string, hooksJson?: string) => {
			const stateRoot = mkdtempSync(join(tmpdir(), "litcodex-doctor-update-state-"));
			try {
				writeFileSync(
					join(stateRoot, "receipt.json"),
					JSON.stringify({
						schemaVersion: 1,
						packageName: "@litfamily/litcodex",
						source: "session-start",
						...receipt,
					}),
				);
				const deps = doctorDeps([codexBin, sentinelPath], config);
				const hooksPath = `${deps.env["CODEX_HOME"]}/marketplaces/litcodex/plugins/litcodex/hooks/hooks.json`;
				const fs =
					hooksJson === undefined
						? deps.fs
						: {
								...deps.fs,
								readFileSync: (path: string, encoding: "utf8") =>
									path === hooksPath ? hooksJson : deps.fs.readFileSync(path, encoding),
							};
				return runDoctor({ ...deps, fs, env: { ...deps.env, LITCODEX_AUTO_UPDATE_STATE_ROOT: stateRoot } });
			} finally {
				rmSync(stateRoot, { recursive: true, force: true });
			}
		};

		it("says an installed update takes effect in the next Codex session", () => {
			const report = doctorWithReceipt({
				status: "updated",
				currentVersion: "1.0.24",
				latestVersion: "1.0.25",
				finishedAt: "2026-10-17T10:00:00.000Z",
			});
			const text = renderDoctorText(report);
			expect(text).toContain("updated; 1.0.24 → 1.0.25 at 2026-10-17T10:00:00.000Z");
			expect(text).toContain("takes effect in the next Codex session");
			expect(text).toContain("cannot see which version an open Codex session runs");
		});

		it.each([
			[{ status: "skipped", reason: "unknown-latest" }, "registry.npmjs.org", "Check the network"],
			[{ status: "throttled", reason: "retry-throttled" }, "last attempt failed", "30 minutes"],
			[
				{ status: "failed", reason: "spawnSync npm ETIMEDOUT", latestVersion: "1.0.26" },
				"60-second limit",
				"npm install -g @litfamily/litcodex@1.0.26",
			],
			[
				{ status: "failed", reason: "exit:243", latestVersion: "1.0.26" },
				"npm could not install 1.0.26",
				"npm install -g @litfamily/litcodex@1.0.26",
			],
			[{ status: "skipped", reason: "disabled" }, "LITCODEX_NO_AUTO_UPDATE", "update by hand"],
			[{ status: "skipped", reason: "existing-opt-out" }, "LITCODEX_NO_UPDATE_CHECK", "update by hand"],
			[{ status: "skipped", reason: "marketplace-flow" }, "Codex marketplace", "marketplace"],
			[{ status: "locked", reason: "locked" }, "another session", "Wait"],
		] as const)("names the cause and the remedy for %o", (receipt, cause, remedy) => {
			const text = renderDoctorText(doctorWithReceipt(receipt));
			expect(text).toContain(cause);
			expect(text).toContain(remedy);
		});

		const realHooks = readFileSync(new URL("../../../../plugins/litcodex/hooks/hooks.json", import.meta.url), "utf8");

		it("says when Codex has no approval recorded for the auto-update hook", () => {
			const text = renderDoctorText(doctorWithReceipt({ status: "up-to-date" }, 'model = "gpt-5.6"\n', realHooks));
			expect(text).toContain("auto-update hook: not approved in Codex");
			expect(text).toContain("codex exec never asks");
		});

		it("stays quiet about the hook once Codex recorded an approval for it", () => {
			const config =
				'model = "gpt-5.6"\n[hooks.state."litcodex@litcodex:hooks/hooks.json:session_start:1:0"]\ntrusted_hash = "sha256:00"\n';
			const text = renderDoctorText(doctorWithReceipt({ status: "up-to-date" }, config, realHooks));
			expect(text).not.toContain("auto-update hook:");
		});

		it("says when the auto-update hook is turned off in Codex", () => {
			const config =
				'model = "gpt-5.6"\n[hooks.state."litcodex@litcodex:hooks/hooks.json:session_start:1:0"]\ntrusted_hash = "sha256:00"\nenabled = false\n';
			const text = renderDoctorText(doctorWithReceipt({ status: "up-to-date" }, config, realHooks));
			expect(text).toContain("auto-update hook: turned off in Codex");
		});

		it("names a plugin and command version split instead of a generic payload error", () => {
			const report = runDoctor(
				doctorDeps(
					[codexBin, sentinelPath],
					"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
					undefined,
					"999.0.0",
				),
			);
			expect(report.issues).toContainEqual(expect.stringContaining("payload is LitCodex 999.0.0"));
			expect(report.issues).toContainEqual(expect.stringContaining("another npm global folder"));
		});
	});

	describe("stale foreground updater receipt", () => {
		const staleReceipt = {
			schemaVersion: 1,
			packageName: "@litfamily/litcodex",
			status: "unknown-state",
			reason: "rollback-failed:190",
			currentVersion: "1.0.7",
			latestVersion: "1.0.8",
			rollbackAttempted: true,
			rollbackStatus: 190,
			verificationDetail: "npm install exited 190",
		};
		const doctorWithReceipt = (receipt: Record<string, unknown>) => {
			const stateRoot = mkdtempSync(join(tmpdir(), "litcodex-doctor-update-stale-"));
			try {
				writeFileSync(join(stateRoot, "receipt.json"), JSON.stringify(receipt));
				const deps = doctorDeps(
					[codexBin, sentinelPath],
					"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
					undefined,
					"1.0.28",
					"0.145.0",
				);
				return runDoctor({ ...deps, env: { ...deps.env, LITCODEX_AUTO_UPDATE_STATE_ROOT: stateRoot } });
			} finally {
				rmSync(stateRoot, { recursive: true, force: true });
			}
		};

		it("stops warning once the installed version has passed the receipt's target", () => {
			const report = doctorWithReceipt(staleReceipt);
			expect(report.ok).toBe(true);
			expect(report.issues).toEqual([]);
			expect(report.autoUpdate?.status).toBe("resolved");
			expect(report.autoUpdate?.detail).toContain("1.0.8");
			expect(renderDoctorText(report)).toContain("an earlier update to 1.0.8 did not finish");
		});

		it("also stops warning when the target equals the installed version", () => {
			const report = doctorWithReceipt({ ...staleReceipt, currentVersion: "1.0.18", latestVersion: "1.0.28" });
			expect(report.issues).toEqual([]);
			expect(report.autoUpdate?.status).toBe("resolved");
		});

		it("keeps warning when the receipt targets a version newer than the installed one", () => {
			const report = doctorWithReceipt({ ...staleReceipt, currentVersion: "1.0.28", latestVersion: "999.0.0" });
			expect(report.ok).toBe(false);
			expect(report.autoUpdate?.status).toBe("unknown-state");
			expect(report.issues).toContainEqual(expect.stringContaining("installation state is unknown"));
		});

		it("keeps warning when the installed version is older than the version the update started from", () => {
			const report = doctorWithReceipt({ ...staleReceipt, currentVersion: "998.0.0", latestVersion: "999.0.0" });
			expect(report.ok).toBe(false);
			expect(report.issues).toContainEqual(expect.stringContaining("installation state is unknown"));
		});

		it("keeps warning when the receipt carries no readable target version", () => {
			const report = doctorWithReceipt({ ...staleReceipt, latestVersion: "not-a-version" });
			expect(report.issues).toContainEqual(expect.stringContaining("installation state is unknown"));
		});
	});
});

describe("probePluginInstalled — parses the status column (VERIFY-LIVE codex 0.139.x)", () => {
	const codexBin = "/fake/codex";
	const listing = (stdout: string) => probePluginInstalled(codexBin, () => ({ status: 0, stdout }));

	it("is FALSE for an available-but-not-installed row (the false-positive bug)", () => {
		// After `codex plugin marketplace add`, the ref appears as 'not installed' BEFORE plugin add.
		expect(listing("Marketplace `litcodex`\nlitcodex@litcodex  not installed           /path\n")).toBe(false);
	});

	it("is TRUE only when the ref row shows an installed status", () => {
		expect(listing("litcodex@litcodex  installed, enabled  0.3.8    /path\n")).toBe(true);
	});

	it("is FALSE when the plugin ref is absent entirely", () => {
		expect(listing("documents@openai-primary-runtime  installed, enabled  1.0\n")).toBe(false);
	});

	it("is FALSE when `codex plugin list` errors", () => {
		expect(probePluginInstalled(codexBin, () => ({ status: 1, stdout: "" }))).toBe(false);
	});

	it("reads a listing larger than spawnSync's 1 MiB default buffer (codex 0.159 remote catalog)", () => {
		const catalog = "someone@openai-curated-remote  not installed  1.0.0  plugin_x\n".repeat(20_000);
		const stdout = `${catalog}litcodex@litcodex  installed, enabled  1.0.16  /path\n`;
		expect(stdout.length).toBeGreaterThan(1024 * 1024);
		// Like spawnSync: output past maxBuffer (default 1 MiB) fails with ENOBUFS and no status.
		const spawn = (_cmd: string, _args: readonly string[], opts: { maxBuffer?: number }) =>
			stdout.length > (opts.maxBuffer ?? 1024 * 1024)
				? { status: null, error: Object.assign(new Error("spawnSync codex ENOBUFS"), { code: "ENOBUFS" }) }
				: { status: 0, stdout };
		expect(probePluginInstalled(codexBin, spawn)).toBe(true);
	});
});

describe("Codex list probes — a slow first listing is not read as absent", () => {
	// The first `codex plugin list` after an install refreshes the remote catalog and can take seconds.
	// Like spawnSync: a child still running past opts.timeout is killed and fails with ETIMEDOUT.
	const slowSpawn =
		(stdout: string, elapsedMs = 6_000) =>
		(_cmd: string, _args: readonly string[], opts: { timeout?: number }) =>
			opts.timeout !== undefined && elapsedMs > opts.timeout
				? { status: null, error: Object.assign(new Error("spawnSync codex ETIMEDOUT"), { code: "ETIMEDOUT" }) }
				: { status: 0, stdout };

	it("plugin list: a 6 s listing still reports the installed plugin", () => {
		const spawn = slowSpawn("litcodex@litcodex  installed, enabled  1.0.17  /path\n");
		expect(probePluginInstalled("/fake/codex", spawn)).toBe(true);
	});

	it("marketplace list: a 6 s listing still reports the registration", () => {
		expect(probeMarketplaceRegistered("/fake/codex", slowSpawn("litcodex  /path\n"))).toBe(true);
	});

	it("marketplace list --json: a 6 s listing still returns the registered source", () => {
		const stdout = JSON.stringify([{ name: "litcodex", source: "/path", sourceType: "local" }]);
		expect(probeMarketplaceRegistration("/fake/codex", slowSpawn(stdout))).toEqual({
			name: "litcodex",
			source: "/path",
			sourceType: "local",
		});
	});

	it("still gives up on a listing that never finishes", () => {
		const spawn = slowSpawn("litcodex@litcodex  installed, enabled  1.0.17  /path\n", 120_000);
		expect(probePluginInstalled("/fake/codex", spawn)).toBe(false);
	});
});

describe("probeMarketplaceRegistration — parses Codex 0.144 structured source", () => {
	it("uses nested marketplaceSource rather than the temporary checkout root", () => {
		const report = probeMarketplaceRegistration("/fake/codex", () => ({
			status: 0,
			stdout: JSON.stringify({
				marketplaces: [
					{
						name: "litcodex",
						root: "/tmp/codex-checkout",
						marketplaceSource: { sourceType: "git", source: "https://github.com/wjgoarxiv/litcodex.git" },
					},
				],
			}),
		}));
		expect(report).toEqual({
			name: "litcodex",
			sourceType: "git",
			source: "https://github.com/wjgoarxiv/litcodex.git",
		});
	});
});

describe("doctor — the check that runs right after an automatic update", () => {
	const withRecorder = (deps: ReturnType<typeof doctorDeps>) => {
		const calls: string[][] = [];
		const spawn: typeof deps.spawn = (command, args, options) => {
			calls.push([command, ...args]);
			return deps.spawn(command, args, options);
		};
		return { deps: { ...deps, spawn, scope: "post-install" as const }, calls };
	};

	it("skips the Codex host probes that the update's own litcodex install has just run", () => {
		const healthy = doctorDeps(
			[codexBin, sentinelPath],
			'model = "gpt-5.6"\nmodel_reasoning_effort = "xhigh"\nmodel_auto_compact_token_limit = 650000\n',
		);
		const { deps, calls } = withRecorder(healthy);
		const report = runDoctor(deps);
		expect(report.issues).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.scope).toBe("post-install");
		expect(calls.some((call) => call.includes("--strict-config"))).toBe(false);
		expect(calls.some((call) => call.includes("debug"))).toBe(false);
		expect(calls.some((call) => call.includes("--version"))).toBe(false);
		expect(calls).toContainEqual([codexBin, "plugin", "list"]);
		expect(calls).toContainEqual([codexBin, "plugin", "marketplace", "list", "--json"]);
	});

	it("still fails a broken install: stale payload, missing agent roles, or a missing skill", () => {
		const config = "model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n";
		const broken = [
			doctorDeps([codexBin, sentinelPath], config, undefined, "0.3.28"),
			doctorDeps([codexBin]),
			doctorDeps([codexBin, sentinelPath], undefined, undefined, undefined, undefined, true, true, {
				missing: "lit-diagram-drawer",
			}),
		];
		for (const deps of broken) {
			const report = runDoctor(withRecorder(deps).deps);
			expect(report.ok).toBe(false);
			expect(report.issues.length).toBeGreaterThan(0);
		}
	});

	it("is chosen by the marker every updater sets on its children, and only by it", () => {
		expect(doctorScopeFor({ LITCODEX_AUTO_UPDATE_IN_PROGRESS: "1" })).toBe("post-install");
		expect(doctorScopeFor({})).toBe("full");
	});

	it("leaves the optional office and film runtimes out of the post-install JSON", () => {
		const codexHomeDir = mkdtempSync(join(tmpdir(), "litcodex-doctor-post-install-"));
		try {
			let out = "";
			const io = {
				stdout: {
					write: (chunk: string) => {
						out += chunk;
						return true;
					},
				} as unknown as NodeJS.WritableStream,
				stderr: { write: () => true } as unknown as NodeJS.WritableStream,
				env: { PATH: "", CODEX_HOME: codexHomeDir, LITCODEX_AUTO_UPDATE_IN_PROGRESS: "1" },
				repoRoot: codexHomeDir,
			};
			runDoctorCli(["--json", "--no-auto-update"], io);
			const parsed = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
			expect(parsed["scope"]).toBe("post-install");
			expect(parsed).not.toHaveProperty("officeRuntime");
			expect(parsed).not.toHaveProperty("motionRuntime");
		} finally {
			rmSync(codexHomeDir, { recursive: true, force: true });
		}
	});
});
