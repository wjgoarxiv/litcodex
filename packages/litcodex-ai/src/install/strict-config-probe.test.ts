import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SpawnLike } from "./codex.js";
import { probeStrictConfig } from "./strict-config-probe.js";

function jsonResult(body: unknown): { status: number; stdout: string } {
	return { status: 0, stdout: JSON.stringify(body) };
}

describe("probeStrictConfig cwd isolation", () => {
	// Reproduced on this machine: a real ~/.codex/config.toml marks $HOME as a trusted
	// project. Inheriting the caller's cwd (== $HOME) into the probe spawn made Codex
	// treat the copied config as project-local and reject it, even though the same
	// config loads cleanly from any other cwd. The probe must never depend on where
	// the caller happened to invoke `litcodex install` from.
	it("spawns doctor with cwd pinned to the disposable probe home, not the caller's cwd", () => {
		const sourceHome = mkdtempSync(join(tmpdir(), "litcodex-cwd-source-"));
		writeFileSync(join(sourceHome, "config.toml"), 'model = "gpt-5.6"\n');
		const seenCwds: (string | undefined)[] = [];
		const spawn: SpawnLike = (_cmd, args, options) => {
			if (args.includes("doctor")) seenCwds.push(options.cwd);
			return jsonResult({ checks: { "config.load": { status: "ok" } } });
		};
		try {
			probeStrictConfig({ codexBin: "codex", spawn, overrides: [], env: { CODEX_HOME: sourceHome } });
			expect(seenCwds).toHaveLength(1);
			expect(seenCwds[0]).toBeDefined();
			expect(seenCwds[0]).not.toBe(sourceHome);
			expect(seenCwds[0]).not.toBe(process.cwd());
		} finally {
			rmSync(sourceHome, { recursive: true, force: true });
		}
	});
});

describe("probeStrictConfig warning acceptance (Q2)", () => {
	it("accepts a warning config.load status when config.toml still parsed and surfaces the startup warning", () => {
		const spawn: SpawnLike = () =>
			jsonResult({
				checks: {
					"config.load": {
						status: "warning",
						details: {
							"config.toml parse": "ok",
							"startup warning": "Ignored unsupported project-local config keys: model_providers, notify.",
						},
					},
				},
			});
		const result = probeStrictConfig({ codexBin: "codex", spawn, overrides: [] });
		expect(result).toEqual({
			kind: "accepted",
			warning: "Ignored unsupported project-local config keys: model_providers, notify.",
		});
	});

	it("still rejects a warning status when config.toml parse did not succeed", () => {
		const spawn: SpawnLike = () =>
			jsonResult({
				checks: {
					"config.load": {
						status: "warning",
						summary: "config loaded with issues",
						details: { "config.toml parse": "fail" },
					},
				},
			});
		const result = probeStrictConfig({ codexBin: "codex", spawn, overrides: [] });
		expect(result.kind).toBe("rejected");
	});

	it("rejects a hard fail and carries Codex's own reported detail instead of nothing", () => {
		const spawn: SpawnLike = () =>
			jsonResult({
				checks: {
					"config.load": {
						status: "fail",
						summary: "config could not be loaded",
						notes: ["failed to load bootstrap configuration"],
						details: {},
					},
				},
			});
		const result = probeStrictConfig({ codexBin: "codex", spawn, overrides: [] });
		expect(result).toEqual({
			kind: "rejected",
			detail: "config could not be loaded: failed to load bootstrap configuration",
		});
	});

	it("still accepts a plain ok status without inventing a warning", () => {
		const spawn: SpawnLike = () => jsonResult({ checks: { "config.load": { status: "ok", details: {} } } });
		const result = probeStrictConfig({ codexBin: "codex", spawn, overrides: [] });
		expect(result).toEqual({ kind: "accepted" });
	});
});
