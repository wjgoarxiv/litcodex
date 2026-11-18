import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runUserPromptSubmitHook } from "./codex-hook.js";
import {
	buildSkillPlan,
	installedExtensions,
	naturalCompanions,
	PLAN_CAP,
	parsePlanHatch,
	READ_ONLY_SKILLS,
	skillPlanContext,
	skillPlanLine,
} from "./skill-plan.js";

const homes: string[] = [];
const codexHome = (installed: readonly string[] = []): NodeJS.ProcessEnv => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-plan-"));
	homes.push(root);
	for (const id of installed) {
		mkdirSync(join(root, "skills", id), { recursive: true });
		writeFileSync(join(root, "skills", id, "SKILL.md"), `---\nname: ${id}\n---\n`);
	}
	return { CODEX_HOME: root, HOME: root };
};
afterEach(() => {
	for (const root of homes.splice(0)) rmSync(root, { recursive: true, force: true });
});

const contextOf = (prompt: string, env: NodeJS.ProcessEnv = codexHome()): string => {
	const previous = process.env["CODEX_HOME"];
	process.env["CODEX_HOME"] = env["CODEX_HOME"];
	try {
		const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt });
		if (decision.kind !== "inject") return "";
		const parsed = JSON.parse(decision.stdout) as { hookSpecificOutput: { additionalContext: string } };
		return parsed.hookSpecificOutput.additionalContext;
	} finally {
		if (previous === undefined) delete process.env["CODEX_HOME"];
		else process.env["CODEX_HOME"] = previous;
	}
};

describe("skill plan (S1)", () => {
	it("collects every matching route in priority order, deduplicated", () => {
		expect(
			naturalCompanions("lit make a dashboard with charts of the measured data and an architecture diagram"),
		).toEqual(["frontend-ui-ux", "lit-scientific-visualization", "lit-diagram-drawer"]);
		expect(naturalCompanions("lit 측정 데이터 그래프를 넣은 발표자료 만들어줘")).toEqual([
			"lit-pptx",
			"lit-scientific-visualization",
		]);
	});

	it("leaves a plain prompt on one route", () => {
		expect(naturalCompanions("lit fix the flaky retry test")).toEqual([]);
		expect(buildSkillPlan({ primary: "lit-loop", companions: [], text: "lit fix the flaky retry test" })).toBeNull();
		expect(contextOf("lit fix the flaky retry test")).not.toContain("Skill plan:");
	});

	it("ignores route words inside code spans, fences and quotes", () => {
		expect(naturalCompanions("lit rename `dashboard chart diagram` in the parser")).toEqual([]);
		expect(naturalCompanions('lit grep for "make a slide deck" in the logs')).toEqual([]);
		expect(naturalCompanions("lit fix this\n```\nmake a landing page with charts of data\n```\n")).toEqual([]);
	});

	it("caps the plan at three and records what was left out", () => {
		const plan = buildSkillPlan({
			primary: "lit-loop",
			companions: ["frontend-ui-ux", "lit-scientific-visualization", "lit-diagram-drawer", "lit-docx"],
			text: "",
		});
		expect(plan?.entries).toHaveLength(PLAN_CAP);
		// Four deliverables make it a large ask, so lit-crucible joins first and the rest wait over the cap.
		expect(plan?.entries.map((e) => e.id)).toEqual(["lit-loop", "lit-crucible", "frontend-ui-ux"]);
		expect(plan?.dropped.map((item) => item.id)).toEqual([
			"lit-scientific-visualization",
			"lit-diagram-drawer",
			"lit-docx",
		]);
	});

	it("names a missing extension once with its install line, an installed one plainly", () => {
		const plan = buildSkillPlan({
			primary: "lit-loop",
			companions: ["lit-scientific-visualization", "lit-diagram-drawer"],
			text: "",
			installed: new Set(["lit-diagram-drawer"]),
		});
		expect(plan).not.toBeNull();
		const line = skillPlanLine(plan as NonNullable<typeof plan>);
		expect(line).toBe(
			"Skill plan: 1 lit-loop (primary) → 2 lit-scientific-visualization (not installed: litcodex extensions install lit-scientific-visualization --yes) → 3 lit-diagram-drawer",
		);
		const context = skillPlanContext(plan as NonNullable<typeof plan>, new Set(["lit-diagram-drawer"]));
		expect(context).toContain("Catalog (installed here):");
		expect(context).not.toMatch(/Catalog[^\n]*lit-pptx/u);
	});

	it("reads installed extensions from CODEX_HOME/skills only when the skill file is there", () => {
		const env = codexHome(["lit-pptx"]);
		expect([...installedExtensions(env)]).toEqual(["lit-pptx"]);
		expect([...installedExtensions(codexHome())]).toEqual([]);
	});

	it("adds lit-crucible first for a large or risky design ask, never for an explanation", () => {
		expect(
			buildSkillPlan({ primary: "lit-loop", companions: [], text: "lit redesign the storage layer" })?.entries.map(
				(e) => e.id,
			),
		).toEqual(["lit-loop", "lit-crucible"]);
		expect(
			buildSkillPlan({ primary: "lit-loop", companions: [], text: "lit 인증 모듈 재설계" })?.entries[1]?.id,
		).toBe("lit-crucible");
		expect(buildSkillPlan({ primary: "lit-loop", companions: [], text: "lit explain the architecture" })).toBeNull();
	});

	it("keeps read-only routes free of companions that write", () => {
		const plan = buildSkillPlan({
			primary: "review-work",
			companions: ["frontend-ui-ux", "litresearch"],
			text: "",
		});
		expect(plan?.entries.map((e) => e.id)).toEqual(["review-work", "litresearch"]);
		expect(plan?.dropped).toEqual([{ id: "frontend-ui-ux", why: "review-work is read-only" }]);
	});

	it("takes `lit +viz +ui <task>` as the exact plan", () => {
		const hatch = parsePlanHatch("lit +viz +ui +nope build the results page");
		expect(hatch).toEqual({
			skills: ["lit-scientific-visualization", "frontend-ui-ux"],
			unknown: ["nope"],
			extra: [],
		});
		const plan = buildSkillPlan({ primary: "lit-loop", companions: ["lit-docx"], forced: hatch, text: "" });
		expect(plan?.entries.map((e) => e.id)).toEqual(["lit-loop", "lit-scientific-visualization", "frontend-ui-ux"]);
		const context = skillPlanContext(plan as NonNullable<typeof plan>);
		expect(context).toContain("keep it exactly");
		expect(context).toContain("Ignored unknown plan names: +nope.");
		expect(parsePlanHatch("lit fix a + b overflow")).toBeNull();
	});

	it("reaches the hook: a bare-lit prompt carries the plan block after the route head", () => {
		const context = contextOf("lit build a landing page with a chart of the experiment results");
		expect(context).toContain("<litcodex-skill-plan>");
		expect(context).toContain(
			"Skill plan: 1 lit-loop (primary) → 2 frontend-ui-ux (not installed: litcodex extensions install frontend-ui-ux --yes) → 3 lit-scientific-visualization (not installed: litcodex extensions install lit-scientific-visualization --yes)",
		);
		expect(Buffer.byteLength(context, "utf8")).toBeLessThan(9_832);
		const forced = contextOf("lit +crucible +plan move the queue to the new broker");
		expect(forced).toContain("Skill plan: 1 lit-loop (primary) → 2 lit-crucible → 3 lit-plan");
	});

	it("does not touch a route reached without `lit`", () => {
		expect(contextOf("litresearch compare chart libraries for a dashboard")).not.toContain("Skill plan:");
	});
});

describe("read-only skills never set a goal (S4)", () => {
	it.each([...READ_ONLY_SKILLS])("%s carries goal: never in its frontmatter", (id) => {
		const text = readFileSync(fileURLToPath(new URL(`../../../skills/${id}/SKILL.md`, import.meta.url)), "utf8");
		const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(text)?.[1] ?? "";
		expect(frontmatter).toMatch(/^goal: never$/mu);
	});
});
