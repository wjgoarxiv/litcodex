import { Buffer } from "node:buffer";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFs, EXACT_PAYLOADS, REQUIRED_SKILL_RESOURCES, SKILL_IDS } from "../../test/skill-catalog-fixtures.js";
import { probeSkillCatalogPayload } from "./skill-catalog.js";

describe("installed skill catalog payload integrity", () => {
	it("rejects entrypoint-only installs and missing resources from every exact payload family", () => {
		const marketplaceRoot = "/tmp/litcodex-marketplace";
		const installed = new Set(
			SKILL_IDS.map((skillId) => join(marketplaceRoot, "plugins", "litcodex", "skills", skillId, "SKILL.md")),
		);
		const entrypointsOnly = probeSkillCatalogPayload({ existsSync: (path) => installed.has(path) }, marketplaceRoot);
		expect(entrypointsOnly.complete, "SKILL.md-only install must not pass nested-resource integrity").toBe(false);

		for (const resourcePath of REQUIRED_SKILL_RESOURCES) {
			installed.add(join(marketplaceRoot, "plugins", "litcodex", "skills", resourcePath));
		}
		expect(probeSkillCatalogPayload(catalogFs(installed, marketplaceRoot), marketplaceRoot).complete).toBe(true);

		const missingResourceProbes = [
			"lsp/references/runtime-triage.md",
			...Object.entries(EXACT_PAYLOADS).flatMap(([skillId, hashes]) => {
				if (skillId === "lit-diagram-drawer") {
					return [
						"lit-diagram-drawer/agents/openai.yaml",
						"lit-diagram-drawer/scripts/visual-quality-geometry.mjs",
					];
				}
				const nestedPath = Object.keys(hashes).find((path) => path !== "SKILL.md");
				return nestedPath ? [`${skillId}/${nestedPath}`] : [];
			}),
		];
		for (const resourcePath of missingResourceProbes) {
			const installedPath = join(marketplaceRoot, "plugins", "litcodex", "skills", resourcePath);
			installed.delete(installedPath);
			expect(
				probeSkillCatalogPayload(catalogFs(installed, marketplaceRoot), marketplaceRoot).complete,
				`installed integrity must fail when ${resourcePath} is absent`,
			).toBe(false);
			installed.add(installedPath);
		}
	}, 15_000);

	it("rejects entrypoint loss, byte tampering, and orphan runtime files", () => {
		const marketplaceRoot = "/tmp/litcodex-marketplace";
		const installed = new Set(
			SKILL_IDS.map((skillId) => join(marketplaceRoot, "plugins", "litcodex", "skills", skillId, "SKILL.md")),
		);
		for (const resourcePath of REQUIRED_SKILL_RESOURCES) {
			installed.add(join(marketplaceRoot, "plugins", "litcodex", "skills", resourcePath));
		}
		const completeFs = catalogFs(installed, marketplaceRoot);
		expect(probeSkillCatalogPayload(completeFs, marketplaceRoot).complete).toBe(true);

		const frontendSkill = join(marketplaceRoot, "plugins", "litcodex", "skills", "frontend-ui-ux", "SKILL.md");
		installed.delete(frontendSkill);
		expect(probeSkillCatalogPayload(catalogFs(installed, marketplaceRoot), marketplaceRoot)).toMatchObject({
			complete: false,
			missingSkillIds: ["frontend-ui-ux"],
		});
		installed.add(frontendSkill);

		expect(
			probeSkillCatalogPayload(
				{
					...completeFs,
					readFileBufferSync: (path: string) =>
						path.endsWith("visual-qa/scripts/cli.mjs")
							? Buffer.from("tampered")
							: completeFs.readFileBufferSync(path),
				},
				marketplaceRoot,
			).complete,
		).toBe(false);
		const diagramGeometry = join(
			marketplaceRoot,
			"plugins",
			"litcodex",
			"skills",
			"lit-diagram-drawer",
			"scripts",
			"visual-quality-geometry.mjs",
		);
		expect(
			probeSkillCatalogPayload(
				{
					...completeFs,
					readFileBufferSync: (path: string) =>
						path === diagramGeometry ? Buffer.from("tampered") : completeFs.readFileBufferSync(path),
				},
				marketplaceRoot,
			).complete,
		).toBe(false);
		expect(
			probeSkillCatalogPayload(
				{
					...completeFs,
					listFilesRecursive: (root: string) => [...completeFs.listFilesRecursive(root), "scripts/orphan.mjs"],
				},
				marketplaceRoot,
			).complete,
		).toBe(false);
	});

	it("rejects a one-byte strict-input tamper and accepts the restored source", () => {
		const marketplaceRoot = "/tmp/litcodex-marketplace";
		const skillsRoot = join(marketplaceRoot, "plugins", "litcodex", "skills");
		const installed = new Set(SKILL_IDS.map((id) => join(skillsRoot, id, "SKILL.md")));
		for (const resourcePath of REQUIRED_SKILL_RESOURCES) installed.add(join(skillsRoot, resourcePath));
		const completeFs = catalogFs(installed, marketplaceRoot);
		const strictInput = join(skillsRoot, "visual-qa", "scripts", "strict-input.mjs");
		const tamperedBytes = Buffer.from(completeFs.readFileBufferSync(strictInput));
		tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0x01;

		expect(
			probeSkillCatalogPayload(
				{
					...completeFs,
					readFileBufferSync: (path: string) =>
						path === strictInput ? tamperedBytes : completeFs.readFileBufferSync(path),
				},
				marketplaceRoot,
			).complete,
		).toBe(false);
		expect(probeSkillCatalogPayload(completeFs, marketplaceRoot).complete).toBe(true);
	});

	it.each([
		["frontend-ui-ux", "scripts/validate-design-contract.mjs"],
		["visual-qa", "scripts/evidence-bytes.mjs"],
	])("packaged %s rejects symmetric missing, tampered, and orphan bytes", (skillId, probePath) => {
		const marketplaceRoot = "/tmp/litcodex-marketplace";
		const skillsRoot = join(marketplaceRoot, "plugins", "litcodex", "skills");
		const installed = new Set(SKILL_IDS.map((id) => join(skillsRoot, id, "SKILL.md")));
		for (const resourcePath of REQUIRED_SKILL_RESOURCES) installed.add(join(skillsRoot, resourcePath));
		const completeFs = catalogFs(installed, marketplaceRoot);
		expect(probeSkillCatalogPayload(completeFs, marketplaceRoot).complete).toBe(true);

		const selected = join(skillsRoot, skillId, probePath);
		installed.delete(selected);
		expect(probeSkillCatalogPayload(catalogFs(installed, marketplaceRoot), marketplaceRoot).complete).toBe(false);
		installed.add(selected);

		expect(
			probeSkillCatalogPayload(
				{
					...completeFs,
					readFileBufferSync: (path: string) =>
						path === selected ? Buffer.from("tampered") : completeFs.readFileBufferSync(path),
				},
				marketplaceRoot,
			).complete,
		).toBe(false);
		expect(
			probeSkillCatalogPayload(
				{
					...completeFs,
					listFilesRecursive: (root: string) =>
						root.endsWith(`/${skillId}`)
							? [...completeFs.listFilesRecursive(root), "scripts/orphan.mjs"]
							: completeFs.listFilesRecursive(root),
				},
				marketplaceRoot,
			).complete,
		).toBe(false);
	});
});
