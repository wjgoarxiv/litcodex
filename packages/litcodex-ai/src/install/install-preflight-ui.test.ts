import { describe, expect, it, vi } from "vitest";

import { renderInstallReceipt, renderPreflightIntro } from "../ui.js";
import type { SpawnLike } from "./codex.js";
import { type ExecuteDeps, executeInstallPlan } from "./execute.js";
import type { InstallPreflightResult, InstallPreflightStage } from "./types.js";

function acceptedSpawn(): SpawnLike {
	return (_command, args) => {
		if (args.join(" ") === "--version") return { status: 0, stdout: "codex-cli 0.144.1\n" };
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

describe("installer preparation progress", () => {
	it("labels a preserved root model as requested rather than effective", () => {
		const output = renderInstallReceipt(
			{
				ok: true,
				codexHome: "/tmp/codex-home",
				steps: [{ kind: "config-update", status: "skipped", detail: "config preserved (user-modified)" }],
			},
			{ model: "gpt-5.6-luna", effort: "max", color: false },
		);

		expect(output).toContain("Requested model");
		expect(output).not.toContain("│ Model        gpt-5.6");
	});

	it("explains the visible work that happens before install step 01", () => {
		const output = renderPreflightIntro("/tmp/codex-home", false);
		expect(output).toContain("PREPARING INSTALL");
		expect(output).toContain("Each strict host probe may take up to 60 seconds.");
		expect(output).toContain("host compatibility");
		expect(output).toContain("read-only config validation");
		expect(output).toContain("package staging");
		expect(output).toContain("may take");
	});

	it("reports all preparation stages before the executable install plan", async () => {
		const started: InstallPreflightStage[] = [];
		const completed: InstallPreflightResult[] = [];
		const migrateConfig = vi.fn(async () => ({ changed: [], backups: [], skipped: [], stateWritten: false }));
		const deps: ExecuteDeps = {
			spawn: acceptedSpawn(),
			fs: { existsSync: () => true, readFileSync: () => "" },
			env: { CODEX_BIN: "/fake/codex" },
			now: () => 0,
			repoRoot: "/repo",
			codexHome: "/tmp/codex-home",
			profile: "luna",
			effort: "max",
			enforceCapabilityPreflight: true,
			migrateConfig,
			onPreflightStart: (stage) => started.push(stage),
			onPreflightEnd: (result) => completed.push(result),
		};

		await executeInstallPlan([], deps);

		expect(started).toEqual(["host-capabilities", "config-dry-run", "marketplace-payload"]);
		expect(completed.map(({ stage, status }) => ({ stage, status }))).toEqual([
			{ stage: "host-capabilities", status: "ok" },
			{ stage: "config-dry-run", status: "ok" },
			{ stage: "marketplace-payload", status: "skipped" },
		]);
	});
});
