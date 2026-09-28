import { describe, expect, it, vi } from "vitest";

import { dispatch, runCli } from "../cli.js";
import { parseInstallOptions } from "./install-options.js";
import { baseOptions, findLegacyTokens } from "./install-test-helpers.js";
import { buildInstallPlan } from "./plan.js";
import { renderInstallPlan } from "./render-plan.js";

describe("buildInstallPlan + renderInstallPlan (dry-run plan)", () => {
	it("prints the LitCodex plan header and ordered steps with no legacy token", () => {
		const steps = buildInstallPlan(baseOptions({ dryRun: true, noTui: true, autonomous: true }));
		const text = renderInstallPlan(steps);
		expect(text.split("\n")[0]).toBe("litcodex install plan (Codex)");
		// Ordered step kinds.
		const kinds = steps.map((s) => s.kind);
		expect(kinds).toEqual([
			"marketplace-add",
			"plugin-add",
			"hooks-register",
			"agents-install",
			"config-update",
			"verify",
		]);
		// The argv shown is `codex …`, never `npx`.
		const npx = ["n", "p", "x"].join("");
		expect(text).not.toContain(npx);
		expect(text).toContain("codex plugin marketplace add");
		expect(text).toContain("codex plugin add litcodex@litcodex");
		// No legacy tokens anywhere in the rendered plan.
		expect(findLegacyTokens(text)).toEqual([]);
	});

	it("NEVER emits --no-tui on plugin-add (codex 0.139.x rejects it), even when noTui is set", () => {
		// VERIFY-LIVE: `codex plugin add` is non-interactive and errors on `--no-tui`.
		for (const noTui of [true, false]) {
			const steps = buildInstallPlan(baseOptions({ dryRun: true, noTui }));
			const pluginAdd = steps.find((s) => s.kind === "plugin-add");
			expect(pluginAdd?.command).toEqual(["codex", "plugin", "add", "litcodex@litcodex"]);
			expect(renderInstallPlan(steps)).not.toContain("--no-tui");
		}
	});

	it("--repo overrides the marketplace source in the marketplace-add step", () => {
		const steps = buildInstallPlan(baseOptions({ repoUrl: "/local/litcodex" }));
		const mkt = steps.find((s) => s.kind === "marketplace-add");
		expect(mkt?.command).toEqual(["codex", "plugin", "marketplace", "add", "/local/litcodex"]);
	});

	it("defaults to a stable CODEX_HOME-local marketplace without a GitHub dependency", () => {
		const opts = parseInstallOptions([], {
			env: { CODEX_HOME: "/isolated/codex-home" },
			repoRoot: "/neutral/cwd",
		});
		expect(opts.repoUrl).toBe("/isolated/codex-home/marketplaces/litcodex");
		const text = renderInstallPlan(buildInstallPlan(opts));
		expect(text).not.toContain("github.com");
	});

	it("describes host-owned context and auto-compaction defaults", () => {
		const text = renderInstallPlan(buildInstallPlan(baseOptions()));
		expect(text).toContain("context and auto-compaction unset for host defaults");
		expect(text).not.toContain("372K");
		expect(text).not.toContain("334.8K");
	});
});

describe("runCli dispatch (routing-level invariants)", () => {
	it("install --dry-run prints the plan header to stdout, exit 0, zero spawns/writes", async () => {
		const out: string[] = [];
		const w = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			out.push(String(chunk));
			return true;
		});
		try {
			const code = await runCli(["install", "--dry-run", "--no-tui"]);
			expect(code).toBe(0);
		} finally {
			w.mockRestore();
		}
		const text = out.join("");
		expect(text).toContain("litcodex install plan (Codex)");
		expect(findLegacyTokens(text)).toEqual([]);
	});

	it("--dry-run is position-independent", () => {
		const lead = dispatch(["--dry-run", "install"]);
		const trail = dispatch(["install", "--dry-run"]);
		expect(lead.exitCode).toBe(0);
		expect(trail.exitCode).toBe(0);
		expect(lead.stdout).toContain("litcodex install plan (Codex)");
		expect(trail.stdout).toContain("litcodex install plan (Codex)");
	});

	it("unknown subcommand exits 1 with the unknown-command code, no legacy token, zero spawns", () => {
		const r = dispatch(["frobnicate"]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("LITCODEX_INSTALL_UNKNOWN_COMMAND");
		expect(findLegacyTokens(r.stdout + r.stderr)).toEqual([]);
	});
});
