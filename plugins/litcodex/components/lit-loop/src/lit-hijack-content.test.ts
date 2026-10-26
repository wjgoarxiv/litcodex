// src/lit-hijack-content.test.ts — lit-hijack content and enrollment invariants.
//
// Guards the directive, the installed skill, the route head and the neighbouring skills against a
// placeholder rewrite or an orphaned route: the skill has its own route head, is reachable from the
// lit-loop directive and skill, and from the three skills it borders. The lit-loop head itself carries no
// hijack row: the first activation is byte-budgeted and the directive and skill text do the hand-off.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_HEADS } from "./route-heads.js";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

const directive = read("../directives/lit-hijack.md");
const skill = read("../../../skills/lit-hijack/SKILL.md");
const metadata = read("../../../skills/lit-hijack/agents/openai.yaml");
const loopDirective = read("../directive.md");
const loopSkill = read("../../../skills/lit-loop/SKILL.md");
const flat = (text: string): string => text.replace(/\s+/gu, " ");
const neighbours: Readonly<Record<string, string>> = {
	litresearch: read("../../../skills/litresearch/SKILL.md"),
	"lit-plan": read("../../../skills/lit-plan/SKILL.md"),
	"start-work": read("../../../skills/start-work/SKILL.md"),
};

describe("lit-hijack directive and skill", () => {
	it("stays a dense workflow rather than a placeholder", () => {
		const words = (text: string): number => text.trim().split(/\s+/u).length;
		expect(words(skill)).toBeGreaterThanOrEqual(3_000);
		expect(words(directive)).toBeGreaterThanOrEqual(900);
		expect(Buffer.byteLength(skill)).toBeGreaterThanOrEqual(18_000);
	});

	it("wraps the directive in <lit-hijack-mode> and mandates the banner", () => {
		expect(directive.trim().startsWith("<lit-hijack-mode>")).toBe(true);
		expect(directive.trim().endsWith("</lit-hijack-mode>")).toBe(true);
		expect(directive).toContain("🔥 **LIT IGNITED · lit-hijack** 🔥");
	});

	it("declares its frontmatter, banner and explicit-only invocation", () => {
		expect(skill).toMatch(/^name:\s*lit-hijack\s*$/mu);
		expect(skill).toContain("🔥 **LIT IGNITED · lit-hijack** 🔥");
		expect(skill).toContain('skill_name: "lit-hijack"');
		expect(metadata).toContain('default_prompt: "Use $litcodex:lit-hijack');
		expect(metadata).toMatch(/allow_implicit_invocation:\s*false/u);
	});

	it("keeps the gates, the fence and the release boundary in the directive and the route head", () => {
		for (const text of [directive, ROUTE_HEADS["lit-hijack"]]) {
			expect(text).toContain("hijack.mjs");
			expect(text).toContain("fork_context");
			expect(text).toContain("BLOCKED:");
			expect(text).toContain(".litcodex/hijack/");
		}
		expect(flat(directive)).toMatch(/single-context/u);
		expect(flat(directive)).toMatch(/independently re-expressed/iu);
		expect(flat(directive)).toMatch(/wait for explicit approval/iu);
		expect(flat(directive)).toMatch(/inert data/iu);
	});

	it("names its neighbours and the route words", () => {
		for (const neighbour of [
			"litresearch",
			"lit-brainstorm",
			"lit-plan",
			"start-work",
			"review-work",
			"lit-crucible",
		]) {
			expect(directive).toContain(neighbour);
		}
		for (const word of ["hijack", "hijacking", "하이재킹", "하이잭", "$litcodex:lit-hijack"]) {
			expect(directive).toContain(word);
		}
	});
});

describe("lit-hijack is reachable from its own repo surfaces", () => {
	it("has its own route head that names the installed skill, while the size-budgeted lit-loop head stays unchanged", () => {
		const head = ROUTE_HEADS["lit-hijack"];
		expect(head).toContain("🔥 **LIT IGNITED · lit-hijack** 🔥");
		expect(head).toContain("{skill:lit-hijack}");
		expect(ROUTE_HEADS["lit-loop"]).not.toContain("lit-hijack");
	});

	it("is named by the lit-loop directive and skill, which send a port request to it", () => {
		for (const text of [loopDirective, loopSkill]) {
			expect(flat(text)).toMatch(/port[^.]*published[^.]*\.\.\/lit-hijack\/SKILL\.md/iu);
		}
	});

	it("is pointed to from the three skills it borders, and they are pointed to from it", () => {
		for (const [name, text] of Object.entries(neighbours)) {
			expect(text, `${name} points to lit-hijack`).toContain("lit-hijack");
			expect(skill, `lit-hijack points to ${name}`).toContain(`\`${name}\``);
		}
	});
});
