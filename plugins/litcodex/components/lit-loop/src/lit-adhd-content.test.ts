// src/lit-adhd-content.test.ts — lit-adhd content and enrollment invariants.
//
// Guards the directive, the installed skill, its references, the route head and the neighbouring skills against a
// placeholder rewrite or an orphaned route. The lit-loop head itself carries no lit-adhd row: the first activation
// is byte-budgeted, and the route head, directive and skill text do the work.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_HEADS } from "./route-heads.js";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

const directive = read("../directives/lit-adhd.md");
const skill = read("../../../skills/lit-adhd/SKILL.md");
const metadata = read("../../../skills/lit-adhd/agents/openai.yaml");
const loopSkill = read("../../../skills/lit-loop/SKILL.md");
const startWorkSkill = read("../../../skills/start-work/SKILL.md");
const flat = (text: string): string => text.replace(/\s+/gu, " ");
const words = (text: string): number => text.trim().split(/\s+/u).length;

describe("lit-adhd directive and skill", () => {
	it("stays a dense workflow rather than a placeholder", () => {
		expect(words(skill)).toBeGreaterThanOrEqual(1_800);
		expect(words(directive)).toBeGreaterThanOrEqual(1_000);
		expect(Buffer.byteLength(skill)).toBeGreaterThanOrEqual(12_000);
	});

	it("wraps the directive in <lit-adhd-mode> and mandates the banner", () => {
		expect(directive.trim().startsWith("<lit-adhd-mode>")).toBe(true);
		expect(directive.trim().endsWith("</lit-adhd-mode>")).toBe(true);
		expect(directive).toContain("🔥 **LIT IGNITED · lit-adhd** 🔥");
	});

	it("declares its frontmatter, banner, alias and explicit-only invocation", () => {
		expect(skill).toMatch(/^name:\s*lit-adhd\s*$/mu);
		expect(skill).toContain("🔥 **LIT IGNITED · lit-adhd** 🔥");
		expect(skill).toContain('skill_name: "lit-adhd"');
		expect(skill).toContain("lit-rewind");
		expect(metadata).toContain('default_prompt: "Use $litcodex:lit-adhd');
		expect(metadata).toMatch(/allow_implicit_invocation:\s*false/u);
	});

	it("keeps the read-only boundary, the collector and the no-guess rule in the directive and the route head", () => {
		for (const text of [directive, ROUTE_HEADS["lit-adhd"]]) {
			expect(text).toContain("rewind --json");
			expect(text).toContain("BLOCKED:");
			expect(text).toMatch(/read-only/iu);
			expect(text).toContain("go");
		}
		expect(flat(directive)).toMatch(/never advance the work|You report;\s*you never advance/iu);
		expect(flat(directive)).toMatch(/Never fill an unknown from memory/u);
		expect(flat(directive)).toMatch(/\[\?\?\?\]|unknown:/u);
		expect(flat(directive)).toContain("lit approve");
	});

	it("keeps both references, and each one is named by the skill", () => {
		for (const file of ["card-examples.md", "status-taxonomy.md"]) {
			expect(existsSync(new URL(`../../../skills/lit-adhd/references/${file}`, import.meta.url))).toBe(true);
			expect(skill).toContain(`references/${file}`);
		}
	});

	it("keeps host and source vocabulary out of the shipped text", () => {
		const shipped = [
			directive,
			skill,
			read("../../../skills/lit-adhd/references/card-examples.md"),
			read("../../../skills/lit-adhd/references/status-taxonomy.md"),
		].join("\n");
		for (const banned of ["CLAUDE_PLUGIN_ROOT", ".litclaude", "Claude Code", "LitClaude", "herdr", "claude -p"]) {
			expect(shipped).not.toContain(banned);
		}
	});
});

describe("lit-adhd is reachable from its own repo surfaces", () => {
	it("has its own route head that names the installed skill, while the size-budgeted lit-loop head stays unchanged", () => {
		const head = ROUTE_HEADS["lit-adhd"];
		expect(head).toContain("🔥 **LIT IGNITED · lit-adhd** 🔥");
		expect(head).toContain("{skill:lit-adhd}");
		expect(ROUTE_HEADS["lit-loop"]).not.toContain("lit-adhd");
	});

	it("is named by the lit-loop skill, with lit continue and go", () => {
		expect(flat(loopSkill)).toMatch(/lit continue/u);
		expect(loopSkill).toContain("lit adhd");
		expect(flat(loopSkill)).toMatch(/workflow stack/u);
	});

	it("is distinguished from lit-recap in both directions and defers a boundary answer to start-work", () => {
		expect(skill).toContain("lit-recap");
		expect(flat(skill)).toMatch(/lit approve/u);
		expect(startWorkSkill).toContain("lit approve");
		expect(startWorkSkill).toContain("lit deny");
		expect(flat(startWorkSkill)).toMatch(/`go` after a `lit-adhd` brief never answers a boundary/u);
	});
});
