import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CATALOG_TRIGGER_LEXEMES,
	DESCRIPTION_BYTE_CEILING,
	EXPLICIT_ONLY_CANDIDATES,
	PINNED_IMPLICIT,
	SKILLS_DIR,
	skillDescription,
	skillMarkdown,
	skillNames,
} from "./skills-validation-fixtures.js";

describe("plugin-root skill activation policy", () => {
	it("freezes the 43-skill implicit and explicit-only candidate policy matrix", () => {
		expect(skillNames).toHaveLength(43);
		expect(Object.keys(CATALOG_TRIGGER_LEXEMES).sort()).toEqual([...skillNames].sort());
		expect([...EXPLICIT_ONLY_CANDIDATES]).toHaveLength(12);
		expect([...PINNED_IMPLICIT]).toHaveLength(5);
		for (const name of skillNames) {
			const description = skillDescription(skillMarkdown(name)).toLowerCase();
			expect(Buffer.byteLength(description), `${name} description exceeds the catalog budget`).toBeLessThanOrEqual(
				DESCRIPTION_BYTE_CEILING,
			);
			for (const lexeme of CATALOG_TRIGGER_LEXEMES[name] ?? []) expect(description).toContain(lexeme);
			const metadataPath = `${SKILLS_DIR}${name}/agents/openai.yaml`;
			const metadata = existsSync(metadataPath) ? readFileSync(metadataPath, "utf8") : "";
			const explicitOnly = /allow_implicit_invocation:\s*false/u.test(metadata);
			if (!EXPLICIT_ONLY_CANDIDATES.has(name)) expect(explicitOnly, `${name} must remain implicit`).toBe(false);
			if (PINNED_IMPLICIT.has(name)) expect(explicitOnly, `${name} is pinned implicit`).toBe(false);
			if (explicitOnly) {
				const shortDescription = metadata.match(/^\s*short_description:\s*"([^"]+)"\s*$/mu)?.[1] ?? "";
				const defaultPrompt = metadata.match(/^\s*default_prompt:\s*"([^"]+)"\s*$/mu)?.[1] ?? "";
				expect(EXPLICIT_ONLY_CANDIDATES.has(name), `${name} is outside the explicit-only candidate set`).toBe(true);
				expect(shortDescription.length, `${name} short_description length`).toBeGreaterThanOrEqual(25);
				expect(shortDescription.length, `${name} short_description length`).toBeLessThanOrEqual(64);
				expect(defaultPrompt, `${name} default_prompt route`).toContain(`$litcodex:${name}`);
			}
		}
	});
});
