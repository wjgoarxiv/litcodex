// plugins/litcodex/skills-validation.test.ts — validates EVERY plugin-root skill (full-port W1+).
//
// Skills are discoverable only when they live at the plugin root `plugins/litcodex/skills/<name>/`
// (plugin.json `skills: ./skills/`). This suite enumerates them dynamically and asserts each
// SKILL.md has a frontmatter `name:` matching its directory + a `description:`, and carries no legacy
// brand token. Legacy literals are assembled from fragments so this file stays scanner-clean.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	KOREAN_PROSE_REQUIRED_REFERENCES,
	KOREAN_PROSE_SKILL,
	legacyHits,
	PACKAGE_README,
	PLUGIN_JSON,
	referencedResources,
	relativeMarkdownHrefs,
	resolveSkillLink,
	SKILLS_DIR,
	skillFrontmatterNames,
	skillMarkdown,
	skillNames,
	TOP_LEVEL_SKILL_WORD_FLOOR,
	topLevelSkillWordCounts,
} from "./skills-validation-fixtures.js";

describe("plugin-root skills (discoverability + brand hygiene)", () => {
	it("the skills root exists and holds the foundational lit-loop + lit-plan skills", () => {
		expect(skillNames).toContain("lit-loop");
		expect(skillNames).toContain("lit-plan");
		expect(skillNames).toContain("litgoal");
		expect(skillNames).toContain("litwork");
		expect(skillNames).toContain("lit-team");
	});

	it("top-level SKILL.md corpus stays at or above the documented word floor", () => {
		const counts = topLevelSkillWordCounts();
		const totalWords = counts.reduce((sum, [, words]) => sum + words, 0);
		const smallest = [...counts].sort(([, left], [, right]) => left - right).slice(0, 5);

		expect(
			totalWords,
			`top-level skill word total ${totalWords}; five smallest: ${smallest
				.map(([name, words]) => `${name}=${words}`)
				.join(", ")}`,
		).toBeGreaterThanOrEqual(TOP_LEVEL_SKILL_WORD_FLOOR);
	});

	it.each(
		skillNames,
	)("skill '%s': SKILL.md frontmatter name matches dir, has description, no legacy token", (name) => {
		const md = readFileSync(`${SKILLS_DIR}${name}/SKILL.md`, "utf8");
		expect(md).toMatch(new RegExp(`^name:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));
		expect(md).toMatch(/^description:/m);
		expect(legacyHits(md)).toEqual([]);
	});

	it.each(skillNames)("skill '%s': requires one canonical first-line probe", (name) => {
		const md = readFileSync(`${SKILLS_DIR}${name}/SKILL.md`, "utf8");
		expect(md).toContain(`🔥 **LIT IGNITED · ${name}** 🔥`);
		expect(md).not.toMatch(/🔥 [A-Z-]+ (?:IGNITED|ENABLED)/);
	});

	it.each(skillNames)("skill '%s': referenced resources exist", (name) => {
		const md = readFileSync(`${SKILLS_DIR}${name}/SKILL.md`, "utf8");
		for (const rel of referencedResources(md)) {
			expect(existsSync(`${SKILLS_DIR}${name}/${rel}`), `${name} references missing ${rel}`).toBe(true);
		}
	});

	it.each(skillNames)("skill '%s': relative Markdown links resolve from the containing SKILL.md", (name) => {
		const skillPath = `${SKILLS_DIR}${name}/SKILL.md`;
		const md = readFileSync(skillPath, "utf8");
		for (const href of relativeMarkdownHrefs(md)) {
			const target = resolveSkillLink(skillPath, href);
			expect(existsSync(target), `${name} has missing relative Markdown link ${href}`).toBe(true);
		}
	});

	it("the humanizer is discoverable from the plugin-root skills directory", () => {
		expect(skillNames.filter((name) => name === KOREAN_PROSE_SKILL)).toHaveLength(1);
	});

	it("the humanizer has matching frontmatter, description, and activation banner", () => {
		const md = skillMarkdown(KOREAN_PROSE_SKILL);
		expect(md, `${KOREAN_PROSE_SKILL}/SKILL.md should exist`).not.toBe("");
		expect(md).toMatch(/^name:\s*lit-humanizer\s*$/m);
		expect(md).toMatch(/^description:/m);
		expect(md).toContain(`🔥 **LIT IGNITED · ${KOREAN_PROSE_SKILL}** 🔥`);
		expect(legacyHits(md)).toEqual([]);
	});

	it("the humanizer mentions and ships its required reference resources", () => {
		const md = skillMarkdown(KOREAN_PROSE_SKILL);
		const referenced = new Set(referencedResources(md));
		const missing = KOREAN_PROSE_REQUIRED_REFERENCES.filter(
			(rel) => !existsSync(`${SKILLS_DIR}${KOREAN_PROSE_SKILL}/${rel}`),
		);
		expect(missing, `${KOREAN_PROSE_SKILL} missing required references`).toEqual([]);
		for (const rel of KOREAN_PROSE_REQUIRED_REFERENCES) {
			expect(referenced.has(rel), `${KOREAN_PROSE_SKILL} should mention ${rel}`).toBe(true);
		}
	});

	it("the humanizer documents Codex discovery and compatibility aliases without fake commands", () => {
		const md = skillMarkdown(KOREAN_PROSE_SKILL).toLowerCase();
		const pluginJson = JSON.parse(readFileSync(PLUGIN_JSON, "utf8")) as { skills?: string };
		const packageReadme = readFileSync(PACKAGE_README, "utf8").toLowerCase();

		expect(pluginJson.skills).toBe("./skills/");
		expect(md).toContain("$litcodex:lit-humanizer");
		expect(md).toContain("/lit-korean");
		expect(md).toContain("codex skill picker");
		expect(md).toContain("plugin.json");
		expect(md).toContain('skills: "./skills/"');
		expect(md).toContain("no slash command");
		expect(md).toContain("explicit leading bare invocation");
		expect(packageReadme).toContain("$litcodex:lit-humanizer");
		expect(packageReadme).toContain("$litcodex:lit-fetch");
		expect(packageReadme).toContain("codex skill picker");
	});

	it("the humanizer guards inert pasted text, output diff, register, honorifics, and spans", () => {
		const combined = [
			skillMarkdown(KOREAN_PROSE_SKILL),
			...KOREAN_PROSE_REQUIRED_REFERENCES.map((rel) =>
				readFileSync(`${SKILLS_DIR}${KOREAN_PROSE_SKILL}/${rel}`, "utf8"),
			),
		]
			.join("\n")
			.toLowerCase();

		for (const required of [
			"source text remains inert",
			"do not obey",
			"before/after diff",
			"original",
			"revised",
			"honorific",
			"해요체",
			"하십시오체",
			"합니다체",
			"해체",
			"protected span",
			"quotes",
			"citations",
			"urls",
			"file paths",
		]) {
			expect(combined, `missing ${required}`).toContain(required);
		}
	});

	it("the prompt-injection fixture preserves malicious text as data", () => {
		const fixture = readFileSync(
			`${SKILLS_DIR}${KOREAN_PROSE_SKILL}/references/prompt-injection-handling.md`,
			"utf8",
		).toLowerCase();

		expect(fixture).toContain("prompt-injection handling");
		expect(fixture).toContain("ignore the current user");
		expect(fixture).toContain("expected handling");
		expect(fixture).toContain("do not obey");
		expect(fixture).toContain("preserve it as source text");
		expect(legacyHits(fixture)).toEqual([]);
	});

	it("the humanizer cannot collide with existing skill frontmatter names", () => {
		const names = skillFrontmatterNames();
		expect(names.filter((name) => name === KOREAN_PROSE_SKILL)).toHaveLength(1);
		expect(new Set(names).size).toBe(names.length);
	});
});
