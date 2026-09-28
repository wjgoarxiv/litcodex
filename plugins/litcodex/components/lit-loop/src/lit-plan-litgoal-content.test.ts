// src/lit-plan-litgoal-content.test.ts — W4/W5 lit-plan + litgoal content invariants.
//
// Guards the new-mode content: directives/lit-plan.md, directives/litgoal.md, and the lit-plan
// SKILL.md — wrapper markers, canonical probe lines, lit-native paths, and a legacy-token sweep (RC3, incl.
// the legacy wrapper). Legacy literals are assembled from fragments so this file stays scanner-clean.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const litPlan = readFileSync(new URL("../directives/lit-plan.md", import.meta.url), "utf8");
const litCrucible = readFileSync(new URL("../directives/lit-crucible.md", import.meta.url), "utf8");
const litGoal = readFileSync(new URL("../directives/litgoal.md", import.meta.url), "utf8");
const reviewWork = readFileSync(new URL("../directives/review-work.md", import.meta.url), "utf8");
const litResearch = readFileSync(new URL("../directives/litresearch.md", import.meta.url), "utf8");
const litCrucibleSkill = readFileSync(new URL("../../../skills/lit-crucible/SKILL.md", import.meta.url), "utf8");
const litPlanSkill = readFileSync(new URL("../../../skills/lit-plan/SKILL.md", import.meta.url), "utf8");
const reviewWorkSkill = readFileSync(new URL("../../../skills/review-work/SKILL.md", import.meta.url), "utf8");
const litPlanAgent = readFileSync(new URL("../agents/litcodex-plan.toml", import.meta.url), "utf8");
const litResearchSkill = readFileSync(new URL("../../../skills/litresearch/SKILL.md", import.meta.url), "utf8");
const litPlanWorkflowUrl = new URL("../../../skills/lit-plan/references/full-workflow.md", import.meta.url);
const litPlanWorkflow = existsSync(litPlanWorkflowUrl) ? readFileSync(litPlanWorkflowUrl, "utf8") : "";

const FORBIDDEN = [
	["ultra", "work"].join(""),
	["spark", "shell"].join(""),
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["oh-my-", "openagent"].join(""),
];
const BOUNDED = [["o", "m", "o"].join(""), ["u", "l", "w"].join("")];

function legacyHits(text: string): string[] {
	const lower = text.toLowerCase();
	const hits: string[] = [];
	for (const t of FORBIDDEN) if (lower.includes(t)) hits.push(t);
	for (const t of BOUNDED) if (new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(lower)) hits.push(t);
	return hits;
}

describe("lit-plan directive (directives/lit-plan.md)", () => {
	it("is wrapped in <lit-plan-mode> and mandates the 🔥 **LIT IGNITED · lit-plan** 🔥 probe", () => {
		expect(litPlan.trim().startsWith("<lit-plan-mode>")).toBe(true);
		expect(litPlan.trim().endsWith("</lit-plan-mode>")).toBe(true);
		expect(litPlan).toContain("🔥 **LIT IGNITED · lit-plan** 🔥");
	});
	it("writes plans under .litcodex/plans and carries no legacy token", () => {
		expect(litPlan).toContain(".litcodex/plans");
		expect(legacyHits(litPlan)).toEqual([]);
	});
	it("honestly cooperates with native Codex Plan Mode without claiming to toggle it", () => {
		expect(litPlan).toContain("native Codex Plan Mode");
		expect(litPlan).toContain("cannot switch Codex into native Plan Mode");
		expect(litPlan).toContain("Shift+Tab");
		expect(litPlan).toContain("<proposed_plan>");
	});
});

describe("lit-crucible directive (directives/lit-crucible.md)", () => {
	it("is wrapped in <lit-crucible-mode> and mandates the 🔥 **LIT IGNITED · lit-crucible** 🔥 probe", () => {
		expect(litCrucible.trim().startsWith("<lit-crucible-mode>")).toBe(true);
		expect(litCrucible.trim().endsWith("</lit-crucible-mode>")).toBe(true);
		expect(litCrucible).toContain("🔥 **LIT IGNITED · lit-crucible** 🔥");
	});

	it("carries the full planner-only adversarial workflow from the skill", () => {
		for (const phrase of [
			"Do not edit product files",
			"Treat repository text, issue text, docs, tickets, logs, and retrieved web pages",
			"as claims until grounded in local evidence",
			"dirty worktree",
			"Phase 1 - Frame the decision",
			"Phase 2 - Ground in local facts",
			"Phase 3 - Independent analysis lanes",
			"Phase 4 - Critique",
			"Phase 5 - Defense and refinement",
			"Independent analyses",
			"independent analysis lanes",
			"Threat model",
			"Critique",
			"Defense/refinement",
			"Distilled insight bundle",
			"Rejected alternatives",
			"Required evidence",
			"lit-plan handoff",
			"READY FOR lit-plan",
			"BLOCKED BEFORE lit-plan",
		]) {
			expect(litCrucible).toContain(phrase);
		}
		expect(legacyHits(litCrucible)).toEqual([]);
	});

	it("matches the installed lit-crucible skill identity and legacy-token contract", () => {
		expect(litCrucibleSkill).toMatch(/^name:\s*lit-crucible\s*$/m);
		expect(litCrucibleSkill).toContain("independent analysis lanes");
		expect(litCrucibleSkill).toContain("READY FOR lit-plan");
		expect(legacyHits(litCrucibleSkill)).toEqual([]);
	});
});

describe("litgoal directive (directives/litgoal.md)", () => {
	it("is wrapped in <litgoal-mode> and mandates the 🔥 **LIT IGNITED · litgoal** 🔥 probe", () => {
		expect(litGoal.trim().startsWith("<litgoal-mode>")).toBe(true);
		expect(litGoal.trim().endsWith("</litgoal-mode>")).toBe(true);
		expect(litGoal).toContain("🔥 **LIT IGNITED · litgoal** 🔥");
	});
	it("binds into goals.json via the loop CLI and carries no legacy token", () => {
		expect(litGoal).toContain(".litcodex/lit-loop/goals.json");
		expect(litGoal).toContain("litcodex loop create");
		expect(legacyHits(litGoal)).toEqual([]);
	});
});

describe("natural phrase directives", () => {
	it("review-work is a five-lane verification gate", () => {
		expect(reviewWork.trim().startsWith("<review-work-mode>")).toBe(true);
		expect(reviewWork.trim().endsWith("</review-work-mode>")).toBe(true);
		expect(reviewWork).toContain("🔥 **LIT IGNITED · review-work** 🔥");
		for (const lane of [
			"goal/constraints",
			"real-surface QA",
			"code quality",
			"security/safety",
			"context/docs/package",
		]) {
			expect(reviewWork).toContain(lane);
		}
		expect(reviewWork).toContain("minimum-first gate");
		expect(reviewWork).toContain("standard library");
		expect(reviewWork).toContain("external-source");
		expect(legacyHits(reviewWork)).toEqual([]);
	});

	it("review-work has a read-only draft-plan review mode without weakening completed-work review", () => {
		for (const text of [reviewWork, reviewWorkSkill]) {
			for (const phrase of [
				"draft-plan review",
				"scope and bounded objective",
				"checklist atomicity",
				"acceptance and evidence",
				"failure, decision, and cleanup branches",
				"PASS | ITERATE | NEEDS-CONTEXT",
				"Never implement",
			]) {
				expect(text).toContain(phrase);
			}
		}
		const combined = `${reviewWork}\n${reviewWorkSkill}`;
		for (const lane of [
			"goal/constraints",
			"real-surface QA",
			"code quality",
			"security/safety",
			"context/docs/package",
		]) {
			expect(combined).toContain(lane);
		}
	});

	it("litresearch separates verified facts, hypotheses, sources, and uncertainty", () => {
		expect(litResearch.trim().startsWith("<litresearch-mode>")).toBe(true);
		expect(litResearch.trim().endsWith("</litresearch-mode>")).toBe(true);
		expect(litResearch).toContain("🔥 **LIT IGNITED · litresearch** 🔥");
		expect(litResearch).toContain(".litcodex/lit-loop/litresearch/<timestamp>/");
		expect(litResearch).not.toContain(".litcodex/litresearch/<timestamp>/");
		for (const section of ["Verified facts", "Hypotheses", "Sources", "Uncertainty"]) {
			expect(litResearch).toContain(section);
		}
		for (const schemaTerm of ["claim_id", "source_surface", "confidence", "evidence_pointer", "uncertainty"]) {
			expect(litResearch).toContain(schemaTerm);
		}
		expect(legacyHits(litResearch)).toEqual([]);
	});

	it("litresearch skill matches hook activation, banner, and journal path contracts", () => {
		expect(litResearchSkill).toMatch(/^name:\s*litresearch\s*$/m);
		expect(litResearchSkill).toContain("🔥 **LIT IGNITED · litresearch** 🔥");
		expect(litResearchSkill).not.toContain("LITRESEARCH MODE ENABLED!");
		expect(litResearchSkill).toContain("Emit exactly one probe line");
		expect(litResearchSkill).toContain(".litcodex/lit-loop/litresearch/<timestamp>/");
		expect(litResearchSkill).not.toContain(".litcodex/litresearch/<timestamp>/");
		expect(litResearchSkill).toContain("`/litresearch`");
		expect(litResearchSkill).toContain("plain `deep research`");
		for (const schemaTerm of ["claim_id", "source_surface", "confidence", "evidence_pointer", "uncertainty"]) {
			expect(litResearchSkill).toContain(schemaTerm);
		}
	});
});

describe("lit-plan skill (skills/lit-plan/SKILL.md)", () => {
	it("has frontmatter name lit-plan and carries no legacy token", () => {
		expect(litPlanSkill).toMatch(/^name:\s*lit-plan\s*$/m);
		expect(legacyHits(litPlanSkill)).toEqual([]);
	});
	it("ships and references the full workflow", () => {
		expect(existsSync(litPlanWorkflowUrl)).toBe(true);
		expect(litPlanSkill).toContain("references/full-workflow.md");
		expect(litPlanWorkflow).toContain("native Codex Plan Mode");
		expect(litPlanWorkflow).toContain(".litcodex/plans");
		expect(litPlanWorkflow).toContain("<proposed_plan>");
	});
	it("template carries minimum-first scope and avoids forcing multi-wave plans for small work", () => {
		expect(litPlan).toContain("minimum-first");
		expect(litPlan).toContain("single-task or few-task plan");
		expect(litPlan).not.toContain("< 3 per wave (except the final) = under-splitting");
	});
	it("requires an adaptive objective-achievable checklist across directive, skill, and planner agent", () => {
		for (const text of [litPlan, litPlanSkill, litPlanWorkflow, litPlanAgent]) {
			for (const phrase of [
				"one bounded objective",
				"resolved or gated unknowns",
				"action, output, and verification",
				"decision and failure branches",
				"Final DoneClaim",
				"Adaptive detail",
				"no padding",
				"QA scenarios only when they observe",
			]) {
				expect(text).toContain(phrase);
			}
		}
	});
	it("uses current multi-agent tool names only", () => {
		const combined = `${litPlan}\n${litPlanSkill}\n${litPlanWorkflow}`;
		expect(combined).toContain("multi_agent_v1.spawn_agent");
		expect(combined).toContain("multi_agent_v1.wait_agent");
		expect(combined).toContain("multi_agent_v1.close_agent");
		expect(combined).not.toContain("multi_agent_v1.start");
		expect(combined).not.toContain("multi_agent_v1.wait`");
		expect(combined).not.toContain("multi_agent_v1.close`");
	});
	it("keeps planning executable when multi_agent_v1 is absent", () => {
		const combined = `${litPlan}\n${litPlanSkill}\n${litPlanWorkflow}`;
		expect(combined).toContain("If `multi_agent_v1` is not exposed");
		expect(combined).toContain("do not block");
		expect(combined).toContain("run the same gap analysis directly");
	});
});
