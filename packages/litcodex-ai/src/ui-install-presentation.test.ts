import { describe, expect, it } from "vitest";

import type { InstallResult, InstallStep, InstallStepResult } from "./install/types.js";
import { renderInstallFailure, renderInstallReceipt, renderStepIntro, renderStepResult } from "./ui.js";

describe("verbose installer presentation", () => {
	const marketplaceStep: InstallStep = {
		kind: "marketplace-add",
		title: "Add LitCodex marketplace",
		command: ["codex", "plugin", "marketplace", "add", "/tmp/home/marketplaces/litcodex"],
		skippable: true,
	};
	const marketplaceResult: InstallStepResult = {
		kind: "marketplace-add",
		status: "ok",
		detail: "litcodex marketplace registered",
		receipts: ["Removed legacy marketplace.", "Added local marketplace."],
	};

	it("explains step number, purpose, and target before work begins", () => {
		const output = renderStepIntro(marketplaceStep, 0, 6, "/tmp/home", false);
		expect(output).toContain("01 / 06");
		expect(output).toContain("MARKETPLACE");
		expect(output).toContain("stable local plugin source");
		expect(output).toContain("/tmp/home/marketplaces/litcodex");
	});

	it("renders captured Codex receipts on clean lines after the spinner finishes", () => {
		const output = renderStepResult(marketplaceResult, false);
		expect(output).toContain("Removed legacy marketplace.");
		expect(output).toContain("Added local marketplace.");
		expect(output).not.toContain("\r");
	});

	it("renders an easy-to-read final receipt with config and host limits", () => {
		const result: InstallResult = {
			ok: true,
			codexHome: "/tmp/home",
			steps: [
				marketplaceResult,
				{ kind: "plugin-add", status: "ok", detail: "litcodex@litcodex plugin registered" },
				{ kind: "hooks-register", status: "skipped", detail: "hook wired" },
				{ kind: "agents-install", status: "ok", detail: "0 agent role(s) installed, 6 unchanged" },
				{ kind: "config-update", status: "skipped", detail: "config preserved (user-modified)" },
				{ kind: "verify", status: "ok", detail: "doctor passed" },
			],
			capabilities: {
				concurrency: {
					status: "hard",
					limit: 20,
					reason: "strict",
					observedSource: "codex-cli 0.144.1 strict-config + runtime schema",
				},
				autoCompaction: { status: "hard", limit: 334_800, reason: "90%", observedSource: "Codex models" },
				modelContexts: { "gpt-5.6": 372_000, "gpt-5.6-terra": 372_000, "gpt-5.6-luna": 372_000 },
			},
		};
		const output = renderInstallReceipt(result, { model: "gpt-5.6-luna", effort: "max", color: false });
		expect(output).toContain("INSTALL RECEIPT");
		expect(output).toContain("codex-cli 0.144.1");
		expect(output).toContain("gpt-5.6-luna · max");
		expect(output).toContain("Installed TOMLs");
		expect(output).toContain("Spawn override");
		expect(output).toContain("not exposed by the verified host schema");
		expect(output).toContain("Effective child");
		expect(output).toContain("unverified without a child JSONL receipt");
		expect(output).toContain("20 threads · hard");
		expect(output).toContain("host default (unset) · probe-only explicit override accepted at 372,000 tokens");
		expect(output).toContain("host default (unset) · probe-only explicit override accepted · hard");
		expect(output).not.toContain("334,800 tokens");
		expect(output).toContain("config preserved (user-modified)");
		expect(output).toContain("Ready for Codex");
		expect(output).not.toContain("\x1b");
	});

	it("renders a human failure receipt without dumping machine JSON", () => {
		const output = renderInstallFailure(
			{
				ok: false,
				error: {
					code: "LITCODEX_INSTALL_MARKETPLACE_ADD_FAILED",
					message: "marketplace registration failed",
					details: { stderr: "permission denied\n" },
				},
			},
			false,
		);
		expect(output).toContain("INSTALL STOPPED");
		expect(output).toContain("LITCODEX_INSTALL_MARKETPLACE_ADD_FAILED");
		expect(output).toContain("permission denied");
		expect(output).toContain("No later install steps were run");
		expect(output).not.toContain('{"ok"');
	});

	it("does not print a success footer for an incomplete result", () => {
		const output = renderInstallReceipt(
			{
				ok: false,
				codexHome: "/tmp/home",
				steps: [{ kind: "agents-install", status: "failed", detail: "agent route rejected" }],
			},
			{ model: "gpt-5.6-luna", effort: "max", color: false },
		);

		expect(output).toContain("Action required");
		expect(output).not.toContain("Installation complete");
	});

	it("does not claim override acceptance when metadata exists but the strict probe is unavailable", () => {
		const result: InstallResult = {
			ok: true,
			codexHome: "/tmp/home",
			steps: [{ kind: "config-update", status: "skipped", detail: "config.toml already current" }],
			capabilities: {
				concurrency: { status: "hard", limit: 20, reason: "strict", observedSource: "codex-cli 0.144.0" },
				autoCompaction: {
					status: "unavailable",
					reason: "model-context-not-verified-at-372000",
					observedSource: "codex debug models",
				},
				modelContexts: { "gpt-5.6": 272_000, "gpt-5.6-terra": 272_000, "gpt-5.6-luna": 272_000 },
			},
		};
		const output = renderInstallReceipt(result, { model: "gpt-5.6-luna", effort: "max", color: false });
		expect(output).toContain("metadata observed at 272,000 tokens");
		expect(output).toContain("override probe unavailable");
		expect(output).not.toContain("override accepted");
	});

	it("explains strict capability rejection when Codex emits no stderr", () => {
		const output = renderInstallFailure(
			{
				ok: false,
				error: {
					code: "LITCODEX_INSTALL_CONFIG_WRITE_FAILED",
					message: "strict config rejected concurrency",
					details: {
						capabilities: {
							concurrency: {
								status: "unavailable",
								reason: "strict-config-rejected",
								observedSource: "codex-cli 0.144.0 strict-config",
							},
						},
					},
				},
			},
			false,
		);
		expect(output).toContain("unavailable · strict-config-rejected · codex-cli 0.144.0");
		expect(output).not.toContain("No additional host output");
	});
});
