import { describe, expect, it } from "vitest";
import { codexBin, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import { renderDoctorText, runDoctor } from "./doctor.js";
import { CANONICAL_SKILL_RESOURCE_PATHS } from "./skill-catalog.js";

describe("doctor — bundled skill payloads", () => {
	it("models the exact clean-room payload resources in the doctor fixture", () => {
		const deps = doctorDeps([codexBin, sentinelPath]);
		const skillsRoot = "/tmp/test-codex-home/marketplaces/litcodex/plugins/litcodex/skills";
		for (const skillId of [
			"browser-drive",
			"lit-humanizer",
			"lit-diagram-drawer",
			"readme-studio",
			"structural-search",
			"coding-session-audit",
		]) {
			const root = `${skillsRoot}/${skillId}`;
			expect(deps.fs.listFilesRecursive?.(root), skillId).not.toEqual([]);
		}
	});

	it("fails health when the diagram skill is missing or its files drift", () => {
		for (const payloadMutation of [{ missing: "lit-diagram-drawer" }, { tamper: "lit-diagram-drawer" }] as const) {
			const report = runDoctor(
				doctorDeps(
					[codexBin, sentinelPath],
					undefined,
					undefined,
					undefined,
					undefined,
					true,
					true,
					payloadMutation,
				),
			);
			expect(report.skillCatalogComplete).toBe(false);
			expect(report.ok).toBe(false);
			if ("tamper" in payloadMutation) {
				expect(report.missingSkillResourcePaths).toContain("<lit-diagram-drawer-payload-integrity>");
			} else {
				expect(report.missingSkillIds).toContain("lit-diagram-drawer");
			}
		}
	});

	it("reports the complete bundled lit-handoff payload as installed", () => {
		const report = runDoctor(doctorDeps([codexBin, sentinelPath]));
		expect(report.skillCatalogComplete, JSON.stringify(report, null, 2)).toBe(true);
		expect(report.missingSkillIds).toEqual([]);
		expect(report.handoffInstalled).toBe(true);
		expect(report.issues.some((issue) => issue.includes("lit-handoff"))).toBe(false);
	});

	it("fails health and names a missing canonical skill entry point", () => {
		const deps = doctorDeps([codexBin, sentinelPath]);
		const existsSync = deps.fs.existsSync;
		const report = runDoctor({
			...deps,
			fs: {
				...deps.fs,
				existsSync: (path) =>
					path.endsWith("/plugins/litcodex/skills/debugging/SKILL.md") ? false : existsSync(path),
			},
		});
		expect(report.skillCatalogComplete).toBe(false);
		expect(report.missingSkillIds).toEqual(["debugging"]);
		expect(report.ok).toBe(false);
		expect(report.issues).toContainEqual(expect.stringContaining("debugging"));
	});

	it("keeps fresh diagnostics empty and bounds a damaged family summary while retaining exact paths", () => {
		const rootConfig = 'model = "gpt-5.6"\nmodel_reasoning_effort = "medium"\n';
		const fresh = runDoctor(doctorDeps([codexBin, sentinelPath], rootConfig));
		expect(fresh.issues).toEqual([]);

		const deps = doctorDeps([codexBin, sentinelPath], rootConfig);
		const familyRoot = "/tmp/test-codex-home/marketplaces/litcodex/plugins/litcodex/skills/frontend-ui-ux";
		const damaged = runDoctor({
			...deps,
			fs: {
				...deps.fs,
				existsSync: (path) => (path.startsWith(`${familyRoot}/`) ? false : deps.fs.existsSync(path)),
				listFilesRecursive: (root) => (root === familyRoot ? [] : (deps.fs.listFilesRecursive?.(root) ?? [])),
			},
		});
		const catalogIssues = damaged.issues.filter((issue) => issue.includes("Bundled skill catalog is incomplete"));
		expect(catalogIssues).toHaveLength(1);
		const catalogIssue = catalogIssues[0];
		if (!catalogIssue) throw new Error("expected one bounded catalog issue");
		expect(catalogIssue.length).toBeLessThanOrEqual(600);
		expect(catalogIssue).toMatch(/frontend-ui-ux: \d+ missing/);
		expect(catalogIssue).toContain("frontend-ui-ux/SKILL.md");
		expect(catalogIssue).toMatch(/\+\d+ more/);
		expect(damaged.missingSkillResourcePaths.length).toBeGreaterThan(100);
		expect(JSON.stringify(damaged.missingSkillResourcePaths).length).toBeGreaterThan(10_000);
	});

	it("bounds human rendering for all canonical missing exact resources while preserving the structured report", () => {
		const deps = doctorDeps([codexBin, sentinelPath], 'model = "gpt-5.6"\nmodel_reasoning_effort = "medium"\n');
		const skillsRoot = "/tmp/test-codex-home/marketplaces/litcodex/plugins/litcodex/skills";
		const report = runDoctor({
			...deps,
			fs: {
				...deps.fs,
				existsSync: (path) => (path.startsWith(`${skillsRoot}/`) ? false : deps.fs.existsSync(path)),
				listFilesRecursive: (root) =>
					root.startsWith(`${skillsRoot}/`) ? [] : (deps.fs.listFilesRecursive?.(root) ?? []),
			},
		});
		const exactResourcePaths = report.missingSkillResourcePaths.filter(
			(path) => !/^<.+-payload-integrity>$/u.test(path),
		);
		expect(exactResourcePaths).toEqual([...CANONICAL_SKILL_RESOURCE_PATHS]);
		const exactReport = { ...report, missingSkillResourcePaths: exactResourcePaths };
		const lastPath = exactResourcePaths.at(-1);
		expect(lastPath).toBeDefined();
		if (!lastPath) throw new Error("expected exact missing resource paths");
		expect(JSON.stringify(exactReport)).toContain(lastPath);
		const familyCounts = new Map<string, number>();
		for (const path of exactResourcePaths) {
			const family = path.split("/", 1)[0];
			if (!family) throw new Error(`missing family for ${path}`);
			familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
		}
		const firstFamily = [...familyCounts].sort(([left], [right]) => left.localeCompare(right))[0];
		if (!firstFamily) throw new Error("expected missing resource families");

		const rendered = renderDoctorText(exactReport);
		expect(Buffer.byteLength(rendered, "utf8")).toBeLessThanOrEqual(2_400);
		expect(rendered).toContain(
			`missing skill resources: ${CANONICAL_SKILL_RESOURCE_PATHS.length} across ${familyCounts.size} families`,
		);
		expect(rendered).toContain(`${firstFamily[0]}: ${firstFamily[1]} missing`);
		expect(rendered).toMatch(/\+\d+ more families/u);
		expect(exactResourcePaths.filter((path) => rendered.includes(path))).toHaveLength(4);
		expect(rendered).not.toContain(lastPath);
	});

	it("fails health when the bundled lit-handoff payload is incomplete", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
				undefined,
				"0.3.44",
				"0.144.0",
				false,
			),
		);
		expect(report.handoffInstalled).toBe(false);
		expect(report.ok).toBe(false);
		expect(report.issues.some((issue) => issue.includes("lit-handoff"))).toBe(true);
	});

	it("fails health when a picker-native UI resource is tampered", () => {
		for (const payloadMutation of [{ tamper: "uiux-visual-qa" }, { extra: "uiux-visual-qa" }] as const) {
			const report = runDoctor(
				doctorDeps(
					[codexBin, sentinelPath],
					undefined,
					undefined,
					undefined,
					undefined,
					true,
					true,
					payloadMutation,
				),
			);
			expect(report.skillCatalogComplete).toBe(false);
			expect(report.ok).toBe(false);
			expect(report.issues).toContainEqual(expect.stringContaining("skill catalog"));
		}
	});

	it("fails health when the humanizer payload is tampered", () => {
		const report = runDoctor(
			doctorDeps([codexBin, sentinelPath], undefined, undefined, undefined, undefined, true, true, {
				tamper: "humanizer",
			}),
		);
		expect(report.skillCatalogComplete).toBe(false);
		expect(report.missingSkillResourcePaths).toContain("<lit-humanizer-payload-integrity>");
		expect(report.ok).toBe(false);
	});

	it("fails health when lit-handoff source bytes drift or an extra file appears", () => {
		for (const payloadMutation of [{ tamper: "handoff" }, { extra: "handoff" }] as const) {
			const report = runDoctor(
				doctorDeps(
					[codexBin, sentinelPath],
					undefined,
					undefined,
					undefined,
					undefined,
					true,
					true,
					payloadMutation,
				),
			);
			expect(report.handoffInstalled).toBe(false);
			expect(report.ok).toBe(false);
		}
	});

	it("reports the bundled picker-native scientific-visualization payload as installed", () => {
		const report = runDoctor(doctorDeps([codexBin, sentinelPath]));
		expect(report.scientificVisualizationInstalled).toBe(true);
		expect(report.issues.some((issue) => issue.includes("lit-scientific-visualization"))).toBe(false);
	});

	it("fails health when the scientific-visualization payload is incomplete", () => {
		const report = runDoctor(
			doctorDeps(
				[codexBin, sentinelPath],
				"model_context_window = 372000\nmodel_auto_compact_token_limit = 334800\n",
				undefined,
				"0.3.44",
				"0.144.0",
				true,
				false,
			),
		);
		expect(report.scientificVisualizationInstalled).toBe(false);
		expect(report.ok).toBe(false);
		expect(report.issues.some((issue) => issue.includes("lit-scientific-visualization"))).toBe(true);
	});

	it("fails health when scientific-visualization source bytes drift or a pyc appears", () => {
		for (const payloadMutation of [
			{ tamper: "scientific-visualization" },
			{ extra: "scientific-visualization" },
		] as const) {
			const report = runDoctor(
				doctorDeps(
					[codexBin, sentinelPath],
					undefined,
					undefined,
					undefined,
					undefined,
					true,
					true,
					payloadMutation,
				),
			);
			expect(report.scientificVisualizationInstalled).toBe(false);
			expect(report.ok).toBe(false);
		}
	});
});
