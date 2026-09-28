import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analyzePlanProgress } from "../../start-work-continuation/src/plan-progress.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const directive = read("../directives/start-work.md");
const skill = read("../../../skills/start-work/SKILL.md");
const continuationDirective = read("../../start-work-continuation/directive.md");
const planDirective = read("../directives/lit-plan.md");
const planAgent = read("../agents/litcodex-plan.toml");
const planSkill = read("../../../skills/lit-plan/SKILL.md");
const planWorkflow = read("../../../skills/lit-plan/references/full-workflow.md");
const executablePlanSample = [
	"## Todos",
	"- [ ] 1. Implement the bounded change",
	"",
	"## Final verification wave",
	"- [ ] F1. Verify the real surface",
].join("\n");

describe("lit-plan to start-work contract", () => {
	it("activates same-session Codex execution with a collision-safe skill body", () => {
		expect(directive.trim().startsWith("<start-work-mode>")).toBe(true);
		expect(directive.trim().endsWith("</start-work-mode>")).toBe(true);
		expect(directive).toContain("🔥 **LIT IGNITED · start-work** 🔥");
		expect(directive).toContain("same-named skill from another harness");
		expect(directive.replace(/\s+/g, " ")).toContain("execute the approved plan in the current Codex session");
		expect(directive).not.toContain("🔥 START-WORK BLOCKED 🔥");
	});

	it("advertises collision-safe invocations", () => {
		expect(skill).toContain("start-work [plan-name]");
		expect(skill).toContain("$start-work [plan-name]");
		expect(skill).toContain("lit start work [plan-name]");
		expect(skill).toContain("$litcodex:start-work [plan-name]");
	});

	it("hands the approved plan to start-work without a stale executor contract", () => {
		for (const text of [planDirective, planSkill, planWorkflow]) expect(text).toContain("lit start work <plan-name>");
		expect(planDirective).not.toMatch(/lit-loop (?:executes|is the execution counterpart)/);
		expect(planDirective).not.toContain("# How lit-loop consumes this plan");
		expect(planDirective).toContain("`.litcodex/start-work/state.json`");
		expect(planDirective).toContain("`.litcodex/lit-loop/ledger.jsonl`");
		expect(planDirective).not.toContain("brief.md");
	});

	it("gives every planner surface the executable checkbox grammar consumed by start-work", () => {
		for (const [surface, text] of [
			["hook directive and native Plan Mode template", planDirective],
			["selectable planner agent", planAgent],
			["direct skill and file-backed path", planSkill],
			["full-workflow reference", planWorkflow],
		] as const) {
			expect(text, surface).toContain("## Todos\n- [ ] N. <title>");
			expect(text, surface).toContain("## Final verification wave\n- [ ] F1. <verification title>");
			expect(analyzePlanProgress(executablePlanSample), surface).toMatchObject({
				contractValid: true,
				todoTotal: 1,
				finalVerificationTotal: 1,
			});
		}
	});

	it("requires the planner to run the shared structural check before execution handoff", () => {
		for (const [surface, text] of [
			["hook directive", planDirective],
			["selectable planner agent", planAgent],
			["direct skill", planSkill],
			["full-workflow reference", planWorkflow],
		] as const) {
			expect(text, surface).toContain("analyzePlanProgress");
			expect(text, surface).toContain("progress.contractValid === true");
			expect(text, surface).toMatch(/before `lit start work <plan-name>`/i);
			expect(text, surface).toContain(
				"node <plugin-root>/components/start-work-continuation/dist/cli.js analyze-plan",
			);
		}
	});

	it("exposes the create-only publisher before the structural handoff", () => {
		for (const [surface, text] of [
			["hook directive", planDirective],
			["selectable planner agent", planAgent],
			["direct skill", planSkill],
			["full-workflow reference", planWorkflow],
		] as const) {
			expect(text, surface).toContain("publish-plan --cwd <path> --slug <slug>");
			expect(text, surface).toContain("start-work-continuation/dist/cli.js publish-plan");
		}
		expect(skill).toContain("start-work never publishes or edits plan files");
		expect(planDirective).not.toContain("Otherwise write ONE plan to `.litcodex/plans/<slug>.md`");
		expect(planDirective).not.toContain("Write the plan so start-work can");
		expect(planAgent).not.toContain("You may write a plan file (markdown)");
		expect(planAgent).not.toContain("READ + plan-file write only");
	});

	it("pauses hard blockers so root Stop cannot recreate them", () => {
		expect(continuationDirective).toContain("transition pause");
		expect(continuationDirective).toContain("start_work_paused");
		expect(continuationDirective).toContain("pending_boundary");
		expect(continuationDirective).toContain("non-mutating replay");
		expect(continuationDirective).toContain("must not parse assistant text");
		expect(continuationDirective).not.toContain('event: "work-paused"');
	});

	it("resumes paused work only through explicit start-work activation", () => {
		expect(skill).toContain("`start-work`, `$start-work`, `lit start work`, or `$litcodex:start-work`");
		expect(skill).toContain("transition resume");
		expect(skill).toContain("--resume <boundary-id> --grant <grant-id>");
		expect(skill).toContain("start_work_resumed");
		expect(skill).toContain("The root `Stop` hook never resumes paused work");
		expect(skill).toContain('"schema_version": 3');
		expect(skill).not.toContain('event: "work-resumed"');
		expect(skill).not.toMatch(/^\/start-work(?:\s|$)/m);
	});

	it("requires code-owned init, work-bound transitions, reason codes, and normalized checkbox progress", () => {
		expect(skill).toContain(" init");
		expect(skill).toContain("init_id");
		expect(skill).toContain("work_id");
		expect(skill).toContain("reason_code");
		expect(skill).toContain("normalized checkbox progress");
		expect(skill).toContain("Unchanged progress never pauses work");
		expect(skill).toContain("Never hand-edit");
		expect(skill).not.toContain("Create `.litcodex/start-work/state.json`");
	});
});
