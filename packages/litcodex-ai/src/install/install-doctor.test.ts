import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexBin, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import { probeMarketplaceRegistration, probePluginInstalled } from "./codex.js";
import { renderDoctorText, runDoctor } from "./doctor.js";

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
				"1.0.7",
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

describe("doctor — Jev skill hint line", () => {
	const fakeKey = "test-key-not-real-0000";
	const withEnv = (deps: ReturnType<typeof doctorDeps>, extra: NodeJS.ProcessEnv) => ({
		...deps,
		env: { ...deps.env, ...extra },
	});

	it("shows off, on, or the missing key, and never the key itself", () => {
		const cases: Array<[NodeJS.ProcessEnv, string]> = [
			[{}, "off"],
			[{ TYPESAFE_API_KEY: fakeKey }, "off"],
			[{ LITCODEX_JEV: "1", TYPESAFE_API_KEY: fakeKey }, "on"],
			[{ LITCODEX_JEV: "1" }, "flag on but TYPESAFE_API_KEY missing"],
			[{ LITCODEX_JEV: "1", TYPESAFE_API_KEY: " " }, "flag on but TYPESAFE_API_KEY missing"],
		];
		for (const files of [[codexBin, sentinelPath], []]) {
			for (const [extra, state] of cases) {
				const report = runDoctor(withEnv(doctorDeps(files), extra));
				const text = renderDoctorText(report);
				expect(report.jevSkillHint).toBe(state);
				expect(text).toContain(`  Jev skill hint: ${state}`);
				expect(`${text}\n${JSON.stringify(report)}`).not.toContain(fakeKey);
			}
		}
	});
});
