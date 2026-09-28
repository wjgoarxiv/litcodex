import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogFs, REQUIRED_SKILL_RESOURCES, SKILL_IDS } from "../../test/skill-catalog-fixtures.js";
import { CANONICAL_SKILL_IDS, CANONICAL_SKILL_RESOURCE_PATHS, probeSkillCatalogPayload } from "./skill-catalog.js";

describe("canonical bundled skill catalog", () => {
	it("names every shipped Codex skill exactly once", () => {
		expect(CANONICAL_SKILL_IDS).toEqual(SKILL_IDS);
		expect(new Set(CANONICAL_SKILL_RESOURCE_PATHS)).toEqual(new Set(REQUIRED_SKILL_RESOURCES));
		expect(new Set(CANONICAL_SKILL_IDS).size).toBe(CANONICAL_SKILL_IDS.length);
		const repositorySkillIds = readdirSync(new URL("../../../../plugins/litcodex/skills/", import.meta.url), {
			withFileTypes: true,
		})
			.filter(
				(entry) =>
					entry.isDirectory() &&
					existsSync(new URL(`../../../../plugins/litcodex/skills/${entry.name}/SKILL.md`, import.meta.url)),
			)
			.map((entry) => entry.name)
			.sort();
		expect(CANONICAL_SKILL_IDS).toEqual(repositorySkillIds);
		expect(CANONICAL_SKILL_RESOURCE_PATHS).toContain("lsp/references/runtime-triage.md");
	});

	it("keeps frontend motion guidance and the README A/B slot in its checked resource closure", () => {
		const skill = readFileSync(
			new URL("../../../../plugins/litcodex/skills/frontend-ui-ux/SKILL.md", import.meta.url),
			"utf8",
		);
		const slot = readFileSync(
			new URL("../../../../plugins/litcodex/skills/frontend-ui-ux/examples/readme-ab/README.md", import.meta.url),
			"utf8",
		);
		expect(skill).toContain("references/motion-guide.md");
		expect(CANONICAL_SKILL_RESOURCE_PATHS).toContain("frontend-ui-ux/references/motion-guide.md");
		expect(slot).toContain("without-skill.md");
		expect(slot).toContain("with-skill.md");
		expect(slot).toContain("receipt.json");
	});

	it("accepts only a complete installed catalog", () => {
		const marketplaceRoot = "/tmp/litcodex-marketplace";
		const installed = new Set(
			SKILL_IDS.map((skillId) => join(marketplaceRoot, "plugins", "litcodex", "skills", skillId, "SKILL.md")),
		);
		const complete = probeSkillCatalogPayload({ existsSync: (path) => installed.has(path) }, marketplaceRoot);
		expect(complete.complete).toBe(false);
		expect(complete.missingSkillIds).toEqual([]);
		expect(complete.missingResourcePaths).toEqual(expect.arrayContaining(REQUIRED_SKILL_RESOURCES));

		installed.delete(join(marketplaceRoot, "plugins", "litcodex", "skills", "debugging", "SKILL.md"));
		installed.delete(join(marketplaceRoot, "plugins", "litcodex", "skills", "lit-code", "SKILL.md"));
		const incomplete = probeSkillCatalogPayload({ existsSync: (path) => installed.has(path) }, marketplaceRoot);
		expect(incomplete.complete).toBe(false);
		expect(incomplete.missingSkillIds).toEqual(["debugging", "lit-code"]);
	});

	it("requires readme-studio and its reference closure in an installed catalog", () => {
		expect(CANONICAL_SKILL_IDS).toContain("readme-studio");

		const marketplaceRoot = "/tmp/litcodex-marketplace";
		const skillsRoot = join(marketplaceRoot, "plugins", "litcodex", "skills");
		const readmeResources = CANONICAL_SKILL_RESOURCE_PATHS.filter((path) => path.startsWith("readme-studio/"));
		expect(readmeResources.length).toBeGreaterThan(0);

		const installed = new Set([
			...CANONICAL_SKILL_IDS.map((skillId) => join(skillsRoot, skillId, "SKILL.md")),
			...CANONICAL_SKILL_RESOURCE_PATHS.map((resourcePath) => join(skillsRoot, resourcePath)),
		]);
		const completeFs = catalogFs(installed, marketplaceRoot);
		expect(probeSkillCatalogPayload(completeFs, marketplaceRoot).complete).toBe(true);

		const readmeEntrypoint = join(skillsRoot, "readme-studio", "SKILL.md");
		installed.delete(readmeEntrypoint);
		expect(probeSkillCatalogPayload(catalogFs(installed, marketplaceRoot), marketplaceRoot)).toMatchObject({
			complete: false,
			missingSkillIds: ["readme-studio"],
		});
		installed.add(readmeEntrypoint);

		for (const resourcePath of readmeResources) {
			const installedPath = join(skillsRoot, resourcePath);
			installed.delete(installedPath);
			expect(
				probeSkillCatalogPayload(catalogFs(installed, marketplaceRoot), marketplaceRoot).missingResourcePaths,
			).toContain(resourcePath);
			installed.add(installedPath);
		}
	});
});
