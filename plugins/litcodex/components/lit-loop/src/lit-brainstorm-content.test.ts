// src/lit-brainstorm-content.test.ts — lit-brainstorm content invariants, plus the one-line meanings of
// litgoal and review-work that the same release sharpens.
//
// Guards the directive, the installed skill and the route head against a placeholder rewrite, and checks
// that the neighbouring skills point at each other: deep-interview sends open brainstorming here,
// litgoal says it sets the finish line that lit-loop and start-work run toward, and review-work names its
// plan review and work review with the rule that picks between them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_HEADS } from "./route-heads.js";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

const directive = read("../directives/lit-brainstorm.md");
const skill = read("../../../skills/lit-brainstorm/SKILL.md");
const metadata = read("../../../skills/lit-brainstorm/agents/openai.yaml");
const interviewSkill = read("../../../skills/deep-interview/SKILL.md");
const interviewDirective = read("../directives/deep-interview.md");
const goalSkill = read("../../../skills/litgoal/SKILL.md");
const goalDirective = read("../directives/litgoal.md");
const reviewSkill = read("../../../skills/review-work/SKILL.md");
const reviewDirective = read("../directives/review-work.md");

const ROUTE_WORDS = ["brainstorm", "brainstorming", "ideation", "ideate", "idea", "ideas"];
const flat = (text: string): string => text.replace(/\s+/gu, " ");

describe("lit-brainstorm directive and skill", () => {
	it("stays a dense workflow rather than a placeholder", () => {
		const words = (text: string): number => text.trim().split(/\s+/u).length;
		expect(words(skill)).toBeGreaterThanOrEqual(2_600);
		expect(words(directive)).toBeGreaterThanOrEqual(1_500);
		expect(Buffer.byteLength(skill)).toBeGreaterThanOrEqual(15_000);
	});

	it("wraps the directive in <lit-brainstorm-mode> and mandates the banner", () => {
		expect(directive.trim().startsWith("<lit-brainstorm-mode>")).toBe(true);
		expect(directive.trim().endsWith("</lit-brainstorm-mode>")).toBe(true);
		expect(directive).toContain("🔥 **LIT IGNITED · lit-brainstorm** 🔥");
	});

	it("declares its frontmatter, banner and explicit-only invocation", () => {
		expect(skill).toMatch(/^name:\s*lit-brainstorm\s*$/mu);
		expect(skill).toContain("🔥 **LIT IGNITED · lit-brainstorm** 🔥");
		expect(skill).toContain('skill_name: "lit-brainstorm"');
		expect(metadata).toContain('default_prompt: "Use $litcodex:lit-brainstorm');
		expect(metadata).toMatch(/allow_implicit_invocation:\s*false/u);
	});

	it("says when to use it and how it differs from its three neighbours", () => {
		const section = /## When to use([\s\S]*?)\n## /u.exec(skill)?.[1] ?? "";
		for (const neighbour of ["deep-interview", "lit-plan", "lit-crucible"]) expect(section).toContain(neighbour);
		expect(flat(section)).toMatch(/the ask is open/iu);
		expect(flat(section)).toMatch(/what could we do/iu);
		expect(flat(section)).toMatch(/names for this/iu);
	});

	it("runs a divergent then convergent flow in named phases", () => {
		for (const text of [skill, directive]) {
			for (const phase of ["Frame", "Diverge", "Cluster", "Score", "Converge", "Pick or combine", "Hand off"]) {
				expect(text, phase).toMatch(new RegExp(`^#+ Phase \\d — ${phase}`, "mu"));
			}
			expect(flat(text)).toMatch(/quantity before judg(?:e)?ment/iu);
			expect(flat(text)).toMatch(/no early filtering/iu);
		}
		expect(skill).toMatch(/lens/iu);
		expect(flat(skill)).toMatch(/trade-offs?/iu);
	});

	it("hands off to deep-interview when the pick is vague and to lit-plan when it is concrete, and never implements", () => {
		for (const text of [skill, directive]) {
			expect(text).toMatch(/deep-interview/u);
			expect(text).toMatch(/lit-plan/u);
			expect(text).toMatch(/Never implement/u);
		}
	});

	it("lists every route word and the invocation forms for Codex", () => {
		for (const word of ROUTE_WORDS) expect(skill, word).toContain(`\`lit ${word}`);
		expect(skill).toContain("$litcodex:lit-brainstorm");
		expect(skill).toContain("lit-brainstorm");
	});

	it("keeps session notes in its own state directory and nowhere else", () => {
		for (const text of [skill, directive]) expect(text).toContain(".litcodex/lit-brainstorm/");
		expect(flat(skill)).toMatch(/write nothing outside/iu);
	});

	it("uses the Codex subagent mechanism for optional idea lanes and falls back when it is absent", () => {
		expect(skill).toContain("multi_agent_v1.spawn_agent");
		expect(skill).toContain("fork_context");
		expect(flat(skill)).toMatch(/without .*multi_agent_v1.*(sequential|root)/iu);
	});

	it("states stop rules, release boundaries and the report shape", () => {
		expect(skill).toMatch(/stop rules/iu);
		expect(flat(skill)).toMatch(/publish, push, tag/iu);
		expect(skill).toContain("BLOCKED:");
		expect(skill).toMatch(/Brainstorm report/u);
		expect(skill).toMatch(/inert data/iu);
	});

	it("carries the head the hook sends in front of the model", () => {
		const head = ROUTE_HEADS["lit-brainstorm"];
		expect(head).toContain("🔥 **LIT IGNITED · lit-brainstorm** 🔥");
		for (const needle of ["deep-interview", "lit-plan", "Never implement", "Diverge", "Converge"]) {
			expect(head, needle).toContain(needle);
		}
	});
});

describe("deep-interview points open brainstorming at lit-brainstorm", () => {
	it("says so in the skill, the directive and the route head", () => {
		for (const text of [interviewSkill, interviewDirective, ROUTE_HEADS["deep-interview"]]) {
			expect(flat(text)).toMatch(/open.{0,40}brainstorming.{0,80}lit-brainstorm/iu);
		}
	});
});

const FINISH_LINE = "litgoal sets and keeps the finish line; lit-loop and start-work run toward it.";

describe("litgoal sets and keeps the finish line", () => {
	it("states the one-line meaning in the skill, the directive and the route head", () => {
		for (const text of [goalSkill, goalDirective, ROUTE_HEADS.litgoal]) expect(flat(text)).toContain(FINISH_LINE);
	});

	it("keeps its real mechanics: the loop ledger and who drives the native goal", () => {
		for (const text of [goalSkill, goalDirective, ROUTE_HEADS.litgoal]) {
			expect(text).toContain("litcodex loop create");
			expect(text).toMatch(/lit-loop[^.]*(?:\/goal|goal tools)/iu);
		}
	});
});

describe("review-work names a plan review and a work review", () => {
	const texts = (): string[] => [reviewSkill, reviewDirective, ROUTE_HEADS["review-work"]];

	it("names both modes in the skill, the directive and the route head", () => {
		for (const text of texts()) {
			expect(text).toContain("Plan review");
			expect(text).toContain("Work review");
		}
	});

	it("says when each applies: plan review after lit-plan and before start-work, work review after lit-loop or start-work", () => {
		for (const text of texts()) {
			const t = flat(text);
			expect(t).toMatch(/plan review[^.]*after lit-plan[^.]*before start-work/iu);
			expect(t).toMatch(/work review[^.]*after lit-loop[^.]*start-work/iu);
		}
	});

	it("auto-picks from what exists and asks when neither exists", () => {
		for (const text of texts()) {
			const t = flat(text);
			expect(t).toMatch(/named PR or diff/iu);
			expect(t).toMatch(/ticked/iu);
			expect(t).toMatch(/plan with no ticked rows and no diff/iu);
			expect(t).toMatch(/neither[^.]*ask/iu);
		}
	});

	it("lets the user force a mode and reports the picked mode in the first line", () => {
		for (const text of texts()) {
			const t = flat(text);
			expect(t).toContain("lit review plan");
			expect(t).toContain("lit review work");
			expect(t).toMatch(/first (?:report )?line[^.]*mode/iu);
		}
		expect(reviewSkill).toContain("$litcodex:review-work plan");
		expect(reviewSkill).toContain("$litcodex:review-work work");
	});

	it("keeps the plan verdict and the five blocking lanes", () => {
		for (const text of texts()) {
			expect(text).toContain("PASS | ITERATE | NEEDS-CONTEXT");
			for (const lane of [
				"goal/constraints",
				"real-surface QA",
				"code quality",
				"security/safety",
				"context/docs/package",
			]) {
				expect(`${reviewSkill}\n${reviewDirective}`).toContain(lane);
			}
		}
	});
});
