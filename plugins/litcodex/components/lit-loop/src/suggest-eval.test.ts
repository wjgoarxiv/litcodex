// The suggestion tier's eval gate (S-B-05) and its prompt-side contract (S-B-01..04, S-B-06, S-B-08). Only the dev
// half is scored here. The held-out half is sealed by its sha256 and this suite checks only that digest; it is scored
// once, outside the dev loop, by `npm run eval:suggest-heldout`, and a rule that fails there is dropped.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	CANDIDATE_RULES,
	CATALOG_SKILLS,
	firedSkills,
	SHIPPED_SKILLS,
	SUGGESTION_BYTE_BUDGET,
	suggestionContext,
} from "./suggest.js";

interface Case {
	readonly id: string;
	readonly prompt: string;
	readonly lang: "en" | "ko";
	readonly expect: readonly string[];
	readonly near_miss_of: readonly string[];
}

const FIXTURES = fileURLToPath(new URL("../test/fixtures/suggest-eval/", import.meta.url));

function loadDev(): readonly Case[] {
	return JSON.parse(readFileSync(`${FIXTURES}dev.json`, "utf8")) as Case[];
}

/** The held-out half's bytes are hashed, never parsed, here. */
function heldoutSealed(): boolean {
	const sealed = readFileSync(`${FIXTURES}heldout.sha256`, "utf8").trim();
	return (
		createHash("sha256")
			.update(readFileSync(`${FIXTURES}heldout.json`))
			.digest("hex") === sealed
	);
}

function score(cases: readonly Case[], skill: string): { recall: number; nearMissFp: number } {
	const rule = CANDIDATE_RULES.filter((candidate) => candidate.skill === skill);
	const positives = cases.filter((item) => item.expect.includes(skill));
	const nearMisses = cases.filter((item) => item.near_miss_of.includes(skill));
	const hits = positives.filter((item) => firedSkills(item.prompt, rule).includes(skill)).length;
	const false_ = nearMisses.filter((item) => firedSkills(item.prompt, rule).includes(skill)).length;
	return {
		recall: positives.length === 0 ? 0 : hits / positives.length,
		nearMissFp: nearMisses.length === 0 ? 0 : false_ / nearMisses.length,
	};
}

const passes = (result: { recall: number; nearMissFp: number }): boolean =>
	result.recall >= 0.85 && result.nearMissFp <= 0.1;

describe("suggestion eval gate", () => {
	it("S-B-05: the held-out half still matches its sealed digest; it is not scored in this suite", () => {
		expect(heldoutSealed()).toBe(true);
		expect(loadDev().length).toBeGreaterThanOrEqual(40);
	});

	it("S-B-05: every shipped rule passes on the dev half; a rule failing it is not shipped", () => {
		const dev = loadDev();
		for (const rule of CANDIDATE_RULES) {
			if (SHIPPED_SKILLS.includes(rule.skill))
				expect(passes(score(dev, rule.skill)), `${rule.skill} ${JSON.stringify(score(dev, rule.skill))}`).toBe(
					true,
				);
		}
	});

	it("the dev half carries English and Korean prompts", () => {
		const dev = loadDev();
		expect(dev.some((item) => item.lang === "ko")).toBe(true);
		expect(dev.some((item) => item.lang === "en")).toBe(true);
	});
});

describe("suggestion context", () => {
	it("S-B-01: a fired rule offers its skill plus none and loads nothing", () => {
		const text = suggestionContext("plot this csv");
		expect(text).toContain("`lit-scientific-visualization`, or none");
		expect(text).toContain("nothing loads by itself");
	});

	it("S-B-02: a prompt naming lit, a slash command or a $skill gets no suggestion", () => {
		for (const prompt of [
			"lit plot this csv",
			"plot this csv with lit",
			"/review plot this csv",
			"$lit-plan plot this csv",
		]) {
			expect(suggestionContext(prompt), prompt).toBe("");
		}
	});

	it("S-B-03: code fences, inline code and host blocks are stripped before rules run", () => {
		expect(firedSkills("```\nplot this csv\n```\nthanks")).toEqual([]);
		expect(firedSkills("see `plot this csv` in the docs")).toEqual([]);
		expect(firedSkills("<environment_context>plot this csv</environment_context> hello")).toEqual([]);
	});

	it("S-B-04: no rule firing gives one compact catalog line inside the byte budget", () => {
		const line = suggestionContext("please tidy the wording of this Korean paragraph");
		expect(line.split("\n")).toHaveLength(1);
		for (const skill of CATALOG_SKILLS) expect(line).toContain(skill);
		expect(CATALOG_SKILLS.length).toBeGreaterThanOrEqual(12);
		expect(Buffer.byteLength(line)).toBeLessThanOrEqual(SUGGESTION_BYTE_BUDGET);
		expect(
			Buffer.byteLength(suggestionContext("Draw an architecture diagram and plot the data")),
		).toBeLessThanOrEqual(SUGGESTION_BYTE_BUDGET);
	});

	it("S-B-06: Korean stems match as bare substrings", () => {
		expect(firedSkills("시스템 다이어그램으로 그려줘")).toContain("lit-diagram-drawer");
		expect(firedSkills("결과를시각화해줘")).toContain("lit-scientific-visualization");
	});

	it("S-B-07: a P&ID noun goes to the schematic, not the diagram drawer", () => {
		expect(firedSkills("Draw a P&ID of the cooling loop")).toEqual(["lit-schematic"]);
		expect(firedSkills("Draw an architecture diagram of the API")).toEqual(["lit-diagram-drawer"]);
	});

	it("S-B-08: a noun used as a verb fires nothing", () => {
		expect(firedSkills("excel at writing a docx report")).toEqual([]);
	});
});
