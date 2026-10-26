// src/lit-schematic-content.test.ts — lit-schematic content and enrollment invariants.
//
// Guards the directive, the installed skill, the route head and the neighbouring skills against a
// placeholder rewrite or an orphaned route: the skill has its own route head, is reachable from the
// lit-loop directive and skill, and from the two skills it borders. The lit-loop head itself carries no
// schematic row: the first activation is byte-budgeted and the bare-lit classifier does the routing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_HEADS } from "./route-heads.js";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

const directive = read("../directives/lit-schematic.md");
const skill = read("../../../skills/lit-schematic/SKILL.md");
const metadata = read("../../../skills/lit-schematic/agents/openai.yaml");
const loopDirective = read("../directive.md");
const loopSkill = read("../../../skills/lit-loop/SKILL.md");
const drawerSkill = read("../../../skills/lit-diagram-drawer/SKILL.md");
const sciviz = read("../../../skills/lit-scientific-visualization/SKILL.md");
const flat = (text: string): string => text.replace(/\s+/gu, " ");

describe("lit-schematic directive and skill", () => {
	it("stays a dense workflow rather than a placeholder", () => {
		const words = (text: string): number => text.trim().split(/\s+/u).length;
		expect(words(skill)).toBeGreaterThanOrEqual(1_500);
		expect(words(directive)).toBeGreaterThanOrEqual(900);
		expect(Buffer.byteLength(skill)).toBeGreaterThanOrEqual(15_000);
	});

	it("wraps the directive in <lit-schematic-mode> and mandates the banner", () => {
		expect(directive.trim().startsWith("<lit-schematic-mode>")).toBe(true);
		expect(directive.trim().endsWith("</lit-schematic-mode>")).toBe(true);
		expect(directive).toContain("🔥 **LIT IGNITED · lit-schematic** 🔥");
	});

	it("declares its frontmatter, banner and explicit-only invocation", () => {
		expect(skill).toMatch(/^name:\s*lit-schematic\s*$/mu);
		expect(skill).toContain("🔥 **LIT IGNITED · lit-schematic** 🔥");
		expect(skill).toContain('skill_name: "lit-schematic"');
		expect(metadata).toContain('default_prompt: "Use $litcodex:lit-schematic');
		expect(metadata).toMatch(/allow_implicit_invocation:\s*false/u);
	});

	it("keeps the truth-first, QA-gate and user-directory rules in the directive and the route head", () => {
		for (const text of [directive, ROUTE_HEADS["lit-schematic"]]) {
			expect(flat(text)).toMatch(/process truth/iu);
			expect(text).toContain("QA PASS");
			expect(text).toContain("scaffold.mjs");
		}
		expect(flat(directive)).toMatch(/never inside the installed LitCodex files/iu);
		expect(flat(directive)).toMatch(/every invented value/iu);
		expect(directive).toContain("BLOCKED:");
	});

	it("names its three neighbours and the route words", () => {
		for (const neighbour of ["lit-diagram-drawer", "lit-scientific-visualization", "frontend-ui-ux"]) {
			expect(directive).toContain(neighbour);
		}
		for (const word of ["P&ID", "PFD", "cutaway", "공정도", "계통도", "$litcodex:lit-schematic"]) {
			expect(directive).toContain(word);
		}
	});
});

describe("lit-schematic is reachable from its own repo surfaces", () => {
	it("has its own route head that names the installed skill, while the size-budgeted lit-loop head stays unchanged", () => {
		const head = ROUTE_HEADS["lit-schematic"];
		expect(head).toContain("🔥 **LIT IGNITED · lit-schematic** 🔥");
		expect(head).toContain("{skill:lit-schematic}");
		expect(ROUTE_HEADS["lit-loop"]).not.toContain("lit-schematic");
	});

	it("is named by the lit-loop directive and skill, which send equipment drawings to it", () => {
		for (const text of [loopDirective, loopSkill]) {
			expect(flat(text)).toMatch(/drawing of real equipment[^.]*\.\.\/lit-schematic\/SKILL\.md/iu);
		}
	});

	it("is pointed to by the two skills it borders, and they are pointed to from it", () => {
		expect(drawerSkill).toContain("`lit-schematic`");
		expect(sciviz).toContain("../lit-schematic/SKILL.md");
		expect(skill).toContain("`lit-diagram-drawer`");
		expect(skill).toContain("`lit-scientific-visualization`");
	});
});
