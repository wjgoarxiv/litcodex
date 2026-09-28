import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_SKILL_IDS, CANONICAL_SKILL_RESOURCE_PATHS } from "./skill-catalog.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const VERIFY_ALL = fileURLToPath(
	new URL("../../../../plugins/litcodex/skills/lit-diagram-drawer/scripts/verify-all.mjs", import.meta.url),
);

describe("lit-diagram-drawer bundled skill", () => {
	it("registers its Codex entry point and complete runtime resources", () => {
		expect(CANONICAL_SKILL_IDS).toContain("lit-diagram-drawer");
		expect(CANONICAL_SKILL_RESOURCE_PATHS).toEqual(
			expect.arrayContaining([
				"lit-diagram-drawer/references/type-catalog.json",
				"lit-diagram-drawer/assets/fonts/PretendardVariable.woff2",
				"lit-diagram-drawer/assets/fonts/OFL.txt",
				"lit-diagram-drawer/scripts/verify-all.mjs",
				"lit-diagram-drawer/scripts/import-drawio.mjs",
				"lit-diagram-drawer/examples/07-deployment-boundary/after.html",
			]),
		);
	});

	it("runs all packed template, after-example, and foil checks", () => {
		const result = spawnSync(process.execPath, [VERIFY_ALL], { cwd: REPOSITORY_ROOT, encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout) as {
			templates: number;
			afterExamples: number;
			foilsChecked: number;
			foilResults: Array<{ expectedReason: string; matched: boolean }>;
			failures: unknown[];
		};
		expect(report).toMatchObject({
			templates: 183,
			afterExamples: 8,
			foilsChecked: 8,
			failures: [],
		});
		const expectedReasonsMatch = report.foilResults.every(
			(foil) => foil.expectedReason === "method-metadata-footer" && foil.matched,
		);
		expect(report.foilResults).toHaveLength(8);
		expect(expectedReasonsMatch).toBe(true);
	}, 15_000);
});
