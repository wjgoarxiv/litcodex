import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { capabilityPreflightError } from "./capability-preflight-error.js";
import type { SpawnLike } from "./codex.js";
import { modelContextsForWrites, probeHostCapabilities } from "./host-capabilities.js";

function spawnFor(context: number | null, strictStatus: "ok" | "fail" = "ok", version = "0.144.0"): SpawnLike {
	return (_cmd, args) => {
		if (args.join(" ") === "--version") return { status: 0, stdout: `codex-cli ${version}\n` };
		if (args.join(" ") === "debug models --bundled") {
			const models =
				context === null
					? [{ slug: "gpt-5.6", context_window: "malformed" }]
					: [
							{ slug: "gpt-5.6", context_window: context },
							{ slug: "gpt-5.6-terra", context_window: context },
							{ slug: "gpt-5.6-luna", context_window: context },
						];
			return { status: 0, stdout: JSON.stringify({ models }) };
		}
		return {
			status: strictStatus === "ok" ? 0 : 1,
			stdout: JSON.stringify({ checks: { "config.load": { status: strictStatus } } }),
		};
	};
}

function timeoutError(): Error {
	return Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
}

describe("Codex GPT-5.6 host capabilities", () => {
	it("uses a Windows codex.cmd version reported on stderr without changing argv safety", () => {
		const calls: { readonly command: string; readonly args: readonly string[]; readonly options: unknown }[] = [];
		const base = spawnFor(372_000, "ok", "0.144.1");
		const spawn: SpawnLike = (command, args, options) => {
			calls.push({ command, args: [...args], options });
			if (args.join(" ") === "--version") {
				return { status: 0, stdout: "", stderr: "codex-cli 0.144.1\r\n" };
			}
			return base(command, args, options);
		};

		const result = probeHostCapabilities("C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd", spawn);

		expect(result.concurrency).toMatchObject({ status: "hard", limit: 20 });
		expect(result.concurrency.observedSource).toContain("0.144.1");
		expect(result.concurrency.observedSource).not.toContain("codex-cli unknown");
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every(({ command }) => command.endsWith("codex.cmd"))).toBe(true);
		expect(calls.every(({ args }) => Array.isArray(args))).toBe(true);
		expect(calls.every(({ options }) => !Object.hasOwn(options as object, "shell"))).toBe(true);
	});

	it.each(["spawn error", "empty output"])("reports %s as unrecognized output, not stable policy", (failure) => {
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			if (args.join(" ") === "--version") {
				return failure === "spawn error"
					? { status: null, error: new Error("ENOENT"), stdout: "", stderr: "" }
					: { status: 0, stdout: "", stderr: "" };
			}
			return base(command, args, options);
		};
		const capabilities = probeHostCapabilities("/fake/codex", spawn);
		const error = capabilityPreflightError(capabilities);

		expect(capabilities.concurrency.reason).toBe("codex-version-unrecognized");
		expect(error.message).toMatch(/could not determine the Codex CLI version/i);
		expect(error.message).not.toContain("supported stable release");
	});

	it("reports metadata-aligned context limits and hard concurrency for 372K", () => {
		const context = 372_000;
		const result = probeHostCapabilities("/fake/codex", spawnFor(context));
		expect(result.concurrency).toMatchObject({
			status: "hard",
			limit: 20,
			reason: expect.stringContaining("reserved collaboration schema"),
			observedSource: expect.stringContaining("0.144.0"),
		});
		expect(result.autoCompaction).toEqual({
			status: "hard",
			limit: 334_800,
			reason:
				"probe-only explicit override acceptance for context 372000 and auto-compaction 334800; managed config remains unset",
			observedSource: "codex debug models + strict-config",
		});
	});

	it("strict-probes the SOL selector through the public alias", () => {
		const calls: string[][] = [];
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			calls.push([...args]);
			return base(command, args, options);
		};
		probeHostCapabilities("/fake/codex", spawn, { profile: "sol", effort: "high" });
		const strict = calls
			.filter((args) => args.includes("doctor"))
			.flat()
			.join(" ");
		expect(strict).toContain('model="gpt-5.6"');
		expect(strict).not.toContain('model="gpt-5.6-sol"');
	});

	it("strict-probes Astra without inventing context metadata", () => {
		const calls: string[][] = [];
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			calls.push([...args]);
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn, { profile: "astra", effort: "low" });
		const joined = calls.flat().join(" ");
		expect(joined).toContain('model="gpt-6-astra"');
		expect(joined).toContain('model_reasoning_effort="low"');
		expect(result.modelContexts).toEqual({ "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 });
		expect(result.autoCompaction).toMatchObject({ status: "unavailable", reason: "model-metadata-unavailable" });
	});

	it("does not infer alias metadata from the existing explicit Sol representation", () => {
		const calls: string[][] = [];
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			calls.push([...args]);
			if (args.join(" ") === "debug models --bundled") {
				return {
					status: 0,
					stdout: JSON.stringify({
						models: [
							{ slug: "gpt-5.6-sol", context_window: 372_000 },
							{ slug: "gpt-5.6-terra", context_window: 372_000 },
						],
					}),
				};
			}
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn, { profile: "sol" });
		expect(result.modelContexts["gpt-5.6"]).toBeNull();
		expect(result.autoCompaction).toMatchObject({ status: "unavailable", reason: "model-metadata-unavailable" });
		expect(calls.flat().join(" ")).toContain('model="gpt-5.6"');
	});

	it("proves Terra metadata independently when alias metadata is absent", () => {
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) =>
			args.join(" ") === "debug models --bundled"
				? {
						status: 0,
						stdout: JSON.stringify({ models: [{ slug: "gpt-5.6-terra", context_window: 372_000 }] }),
					}
				: base(command, args, options);
		const result = probeHostCapabilities("/fake/codex", spawn, { profile: "terra" });
		expect(result.autoCompaction).toMatchObject({ status: "hard", limit: 334_800 });
	});

	it("never authorizes managed context writes from discovered metadata", () => {
		const result = probeHostCapabilities("/fake/codex", spawnFor(372_000));
		expect(Object.values(result.modelContexts)).toEqual([372_000, 372_000, 372_000]);
		expect(modelContextsForWrites()).toEqual({ "gpt-5.6": null, "gpt-5.6-terra": null, "gpt-5.6-luna": null });
	});

	it("strict-probes selected model/effort, stable depth-one hard-20, and metadata-aligned context limits", () => {
		const calls: string[][] = [];
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			calls.push([...args]);
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn, { profile: "terra", effort: "xhigh" });
		expect(result.autoCompaction).toMatchObject({
			status: "hard",
			limit: 334_800,
			observedSource: expect.stringContaining("strict-config"),
		});
		const joined = calls.flat().join(" ");
		expect(joined).toContain('model="gpt-5.6-terra"');
		expect(joined).toContain('model_reasoning_effort="xhigh"');
		expect(joined).toContain("features.multi_agent=true");
		expect(joined).toContain("features.multi_agent_v2.enabled=true");
		expect(joined).toContain("features.multi_agent_v2.hide_spawn_agent_metadata=true");
		expect(joined).toContain("features.multi_agent_v2.max_concurrent_threads_per_session=20");
		expect(joined).not.toContain("agents.max_threads");
		expect(joined).toContain("agents.max_depth=1");
		expect(joined).toContain("model_context_window=372000");
		expect(joined).toContain("model_auto_compact_token_limit=334800");
		expect(joined).not.toContain("model_auto_compact_token_limit=650000");
	});

	it("reports malformed metadata with source", () => {
		const result = probeHostCapabilities("/fake/codex", spawnFor(null));
		expect(result.autoCompaction).toMatchObject({
			status: "unavailable",
			reason: "model-metadata-unavailable",
			observedSource: "codex debug models",
		});
	});

	it("reports strict rejection with source", () => {
		// The override probe is rejected while the no-override baseline is accepted, so
		// the managed settings really are the cause. `spawnFor(..., "fail")` rejects every
		// probe including the baseline, which is the host-config case covered below.
		const base = spawnFor(372_000, "fail");
		const overridesOnlyRejected: SpawnLike = (command, args, options) =>
			args.includes("--strict-config") && !args.includes("-c")
				? { status: 0, stdout: JSON.stringify({ checks: { "config.load": { status: "ok" } } }) }
				: base(command, args, options);
		const result = probeHostCapabilities("/fake/codex", overridesOnlyRejected);
		expect(result.concurrency).toMatchObject({
			status: "unavailable",
			reason: "strict-config-rejected",
			observedSource: expect.stringContaining("strict-config"),
		});
	});

	it("reports an incompatible host config when every probe including the baseline is rejected", () => {
		const result = probeHostCapabilities("/fake/codex", spawnFor(372_000, "fail"));
		expect(result.concurrency).toMatchObject({
			status: "unavailable",
			reason: "host-config-incompatible",
			observedSource: expect.stringContaining("strict-config"),
		});
	});

	it("bounds hung probes and reports timeout", () => {
		const timeouts: number[] = [];
		const spawn: SpawnLike = (_command, _args, options) => {
			if (options.timeout !== undefined) timeouts.push(options.timeout);
			return { status: null, error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) };
		};
		const result = probeHostCapabilities("/fake/codex", spawn);
		expect(timeouts.length).toBeGreaterThan(0);
		expect(timeouts.every((timeout) => timeout <= 60_000)).toBe(true);
		expect(result.concurrency).toMatchObject({ status: "unavailable", reason: "host-probe-timeout" });
	});

	it("reports a strict probe timeout when spawnSync retains status zero", () => {
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			if (args.includes("doctor")) return { status: 0, error: timeoutError() };
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn);
		expect(result.concurrency).toMatchObject({ status: "unavailable", reason: "host-probe-timeout" });
	});

	it("keeps strict concurrency available when only model metadata times out", () => {
		const base = spawnFor(372_000, "ok", "0.144.6");
		const spawn: SpawnLike = (command, args, options) =>
			args.join(" ") === "debug models --bundled"
				? { status: null, error: timeoutError() }
				: base(command, args, options);
		const result = probeHostCapabilities("/fake/codex", spawn);
		expect(result.concurrency).toMatchObject({ status: "advisory", limit: 20 });
		expect(result.autoCompaction).toMatchObject({
			status: "unavailable",
			reason: "host-probe-timeout",
		});
	});

	it("uses two bounded strict probes for separate concurrency and context proof", () => {
		const calls: { readonly args: readonly string[]; readonly timeout: number | undefined }[] = [];
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			calls.push({ args, timeout: options.timeout });
			return base(command, args, options);
		};
		probeHostCapabilities("/fake/codex", spawn);
		const strictCalls = calls.filter(({ args }) => args.includes("doctor"));
		expect(strictCalls.map(({ timeout }) => timeout)).toEqual([60_000, 60_000]);
		const strictArgs = strictCalls.flatMap(({ args }) => args).join(" ");
		expect(strictArgs).toContain("features.multi_agent_v2.max_concurrent_threads_per_session=20");
		expect(strictArgs).toContain("agents.max_depth=1");
		expect(strictArgs).toContain("model_context_window=372000");
		expect(strictArgs).toContain("model_auto_compact_token_limit=334800");
		expect(calls.some(({ args }) => args.join(" ") === "debug models --bundled")).toBe(true);
	});

	it("uses one strict probe when bundled metadata does not authorize context overrides", () => {
		const calls: string[][] = [];
		const base = spawnFor(272_000, "ok", "0.144.6");
		const spawn: SpawnLike = (command, args, options) => {
			calls.push([...args]);
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn);
		expect(calls.filter((args) => args.includes("doctor"))).toHaveLength(1);
		expect(result.concurrency).toMatchObject({ status: "advisory", limit: 20 });
		expect(result.autoCompaction).toMatchObject({
			status: "unavailable",
			reason: "model-context-not-verified-at-372000",
		});
	});

	it("uses the caller environment while isolating strict validation from populated rollout state", () => {
		const sourceHome = mkdtempSync(join(tmpdir(), "litcodex-populated-home-"));
		const config = 'model = "gpt-5.6"\n';
		writeFileSync(join(sourceHome, "config.toml"), config);
		writeFileSync(join(sourceHome, "state_5.sqlite"), "large rollout inventory");
		let probeHome: string | undefined;
		const base = spawnFor(272_000, "ok", "0.144.6");
		const spawn: SpawnLike = (command, args, options) => {
			if (args.includes("doctor")) {
				probeHome = options.env?.["CODEX_HOME"];
				expect(probeHome).toBeDefined();
				expect(probeHome).not.toBe(sourceHome);
				expect(readFileSync(join(probeHome ?? "", "config.toml"), "utf8")).toBe(config);
				expect(existsSync(join(probeHome ?? "", "state_5.sqlite"))).toBe(false);
				// The probe must not inherit the caller's real cwd either: a config.toml that
				// trusts the caller's cwd as a project would otherwise change how it parses.
				expect(options.cwd).toBe(probeHome);
			} else {
				expect(options.env?.["CODEX_HOME"]).toBe(sourceHome);
			}
			return base(command, args, options);
		};
		try {
			const result = probeHostCapabilities("/fake/codex", spawn, {
				env: { CODEX_HOME: sourceHome },
			});
			expect(result.concurrency).toMatchObject({ status: "advisory", limit: 20 });
			expect(probeHome).toBeDefined();
			expect(existsSync(probeHome ?? "")).toBe(false);
		} finally {
			rmSync(sourceHome, { recursive: true, force: true });
		}
	});

	it("recognizes the verified Codex 0.144.1 patch release", () => {
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			if (args.join(" ") === "--version") return { status: 0, stdout: "codex-cli 0.144.1\n" };
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn);
		expect(result.concurrency).toMatchObject({ status: "hard", limit: 20 });
	});

	it("reports newer stable Codex as advisory when every behavioral probe passes", () => {
		const result = probeHostCapabilities("/fake/codex", spawnFor(372_000, "ok", "0.145.0"));
		expect(result.concurrency).toMatchObject({
			status: "advisory",
			limit: 20,
			reason: expect.stringContaining("newer stable Codex"),
			observedSource: expect.stringContaining("0.145.0"),
		});
	});

	it.each([
		["older stable", "0.143.9", "codex-version-too-old"],
		["prerelease", "0.145.0-alpha.4", "codex-version-prerelease"],
		["unrecognized", "development-build", "codex-version-unrecognized"],
	])("reports %s Codex as unavailable with an actionable reason", (_label, version, reason) => {
		const result = probeHostCapabilities("/fake/codex", spawnFor(372_000, "ok", version));
		expect(result.concurrency).toMatchObject({ status: "unavailable", reason });
	});

	it("accepts config.load when unrelated doctor health checks make the process exit nonzero", () => {
		const base = spawnFor(372_000);
		const spawn: SpawnLike = (command, args, options) => {
			if (args.join(" ") === "--version") return { status: 0, stdout: "codex-cli 0.144.1\n" };
			if (args.includes("doctor")) {
				return {
					status: 1,
					stdout: JSON.stringify({
						overallStatus: "fail",
						checks: {
							"config.load": { status: "ok" },
							installation: { status: "fail" },
						},
					}),
				};
			}
			return base(command, args, options);
		};
		const result = probeHostCapabilities("/fake/codex", spawn);
		expect(result.concurrency).toMatchObject({ status: "hard", limit: 20 });
	});
});

describe("baseline probe separates an incompatible host config from rejected managed settings", () => {
	// Reproduced on codex-cli 0.144.0 against a real ~/.codex/config.toml: `config.load`
	// fails with LitCodex's overrides AND with none at all, while an empty CODEX_HOME
	// accepts the same overrides. Exit-code and override content were never the signal.
	function spawnWithConfigLoad(withOverrides: "ok" | "fail", withoutOverrides: "ok" | "fail"): SpawnLike {
		return (_cmd, args) => {
			if (args.join(" ") === "--version") return { status: 0, stdout: "codex-cli 0.144.0\n" };
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
			const hasOverrides = args.includes("-c");
			const status = hasOverrides ? withOverrides : withoutOverrides;
			return { status: status === "ok" ? 0 : 1, stdout: JSON.stringify({ checks: { "config.load": { status } } }) };
		};
	}

	it("reports host-config-incompatible when the no-override baseline also fails", () => {
		const capabilities = probeHostCapabilities("codex", spawnWithConfigLoad("fail", "fail"));
		expect(capabilities.concurrency.reason).toBe("host-config-incompatible");
	});

	it("still reports strict-config-rejected when the baseline accepts the host config", () => {
		const capabilities = probeHostCapabilities("codex", spawnWithConfigLoad("fail", "ok"));
		expect(capabilities.concurrency.reason).toBe("strict-config-rejected");
	});

	it("does not run a baseline probe when the override probe already succeeded", () => {
		const seen: string[][] = [];
		const base = spawnWithConfigLoad("ok", "ok");
		const spawn: SpawnLike = (command, args, options) => {
			seen.push([...args]);
			return base(command, args, options);
		};
		probeHostCapabilities("codex", spawn);
		const baselineCalls = seen.filter((args) => args.includes("--strict-config") && !args.includes("-c"));
		expect(baselineCalls).toEqual([]);
	});

	// Q2: a `warning` config.load status whose config.toml still parsed is accepted, not
	// treated as a rejection. Reproduced against a real ~/.codex/config.toml that trusts
	// $HOME as a project: strict-config returns `warning` (not `ok`) purely because of an
	// ignored project-local key, and the install must still succeed.
	it("accepts an override probe that reports warning with a parsed config.toml, and surfaces the startup warning", () => {
		const spawn: SpawnLike = (_cmd, args) => {
			if (args.join(" ") === "--version") return { status: 0, stdout: "codex-cli 0.144.1\n" };
			if (args.join(" ") === "debug models --bundled") return { status: 0, stdout: JSON.stringify({ models: [] }) };
			return {
				status: 0,
				stdout: JSON.stringify({
					checks: {
						"config.load": {
							status: "warning",
							details: {
								"config.toml parse": "ok",
								"startup warning": "Ignored unsupported project-local config keys: notify.",
							},
						},
					},
				}),
			};
		};
		const capabilities = probeHostCapabilities("codex", spawn);
		expect(capabilities.concurrency.status).toBe("hard");
		expect(capabilities.concurrency.detail).toBe("Ignored unsupported project-local config keys: notify.");
	});

	it("carries Codex's own doctor detail onto the host-config-incompatible report", () => {
		const spawn: SpawnLike = (_cmd, args) => {
			if (args.join(" ") === "--version") return { status: 0, stdout: "codex-cli 0.144.0\n" };
			if (args.join(" ") === "debug models --bundled") return { status: 0, stdout: JSON.stringify({ models: [] }) };
			return {
				status: 1,
				stdout: JSON.stringify({
					checks: {
						"config.load": {
							status: "fail",
							summary: "config could not be loaded",
							notes: ["failed to load bootstrap configuration"],
							details: {},
						},
					},
				}),
			};
		};
		const capabilities = probeHostCapabilities("codex", spawn);
		expect(capabilities.concurrency.reason).toBe("host-config-incompatible");
		expect(capabilities.concurrency.detail).toBe(
			"config could not be loaded: failed to load bootstrap configuration",
		);
	});
});
