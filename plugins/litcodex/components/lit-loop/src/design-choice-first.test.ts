// src/design-choice-first.test.ts — a design skill asks the user to choose the design before it builds.
//
// The user has the right to choose among the skill's own presets, so each SKILL.md carries a "Choose the design
// first" section that names the question tool (`request_user_input`), the numbered-list fallback for a turn that
// does not offer it, the `codex exec` fallback and the skip rule, offers that skill's real presets, and sits before
// the step that scaffolds, writes or renders the artifact. The routes that hand work to these skills must not tell
// the model to build first.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";

const skillText = (id: string): string =>
	readFileSync(new URL(`../../../skills/${id}/SKILL.md`, import.meta.url), "utf8");
const pluginText = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const HEADING = /^#{2,3} Choose the design first$/mu;

// `build` anchors the first step that scaffolds, writes or renders the artifact; `choices` are tokens only that
// skill ships (a real preset, tonality, template, canvas or path).
const skills: Record<string, { build: RegExp; choices: RegExp[] }> = {
	"lit-pptx": {
		build: /^3\. Draft the Markdown deck/mu,
		choices: [/AZURE-PRO/u, /BOILERPLATE-PRETENDARD/u, /4:3/u, /Learn my own/u, /Compare the three first/u],
	},
	"lit-docx": {
		build: /^3\. Write `doc\.md`/mu,
		choices: [
			/Report/u,
			/Brief/u,
			/Manual/u,
			/Proposal/u,
			/Memo/u,
			/Journal/u,
			/elsevier/u,
			/korean-generic/u,
			/--template/u,
		],
	},
	"frontend-ui-ux": {
		build: /starts from a design lock/u,
		choices: [
			/field-notes/u,
			/graphite/u,
			/meadow/u,
			/computational-brutalism/u,
			/neo-brutalism/u,
			/landing/u,
			/workspace/u,
			/settings/u,
		],
	},
	"lit-schematic": {
		build: /^2\. \*\*Truth first\./mu,
		choices: [
			/P&ID/u,
			/PFD/u,
			/Journal figure/u,
			/Isometric cutaway/u,
			/A3/u,
			/85 mm/u,
			/Interactive web page/u,
			/Quiet grey/u,
		],
	},
	"lit-diagram-drawer": {
		build: /^3\. \*\*Prepare content and layout/mu,
		choices: [/slide-16x9/u, /slide-4x3/u, /doc-inline/u, /doc-wide/u, /light/u, /dark/u, /type-catalog/u],
	},
	"readme-studio": {
		build: /^3\. \*\*Choose the image branch/mu,
		choices: [/Remotion/u, /HyperFrames/u, /poster/iu, /Plain Markdown/u],
	},
	"lit-typographic-motion": {
		build: /^2\. Write `treatment\.json`/mu,
		choices: [/swiss-signal/u, /tidal/u, /terminalcore/u, /9:16/u, /16:9/u, /stage/u, /type path/u],
	},
};

// Two entrypoints sit under a 4,096-byte cap, so their section points at `references/design-choice.md`, which
// carries the questions and mechanics; the checks below read the section together with that file.
const capped = new Set(["frontend-ui-ux", "lit-typographic-motion"]);
const referenceText = (id: string): string =>
	readFileSync(new URL(`../../../skills/${id}/references/design-choice.md`, import.meta.url), "utf8");

const stepBlock = (text: string): string => {
	const at = text.search(HEADING);
	if (at === -1) return "";
	const rest = text.slice(text.indexOf("\n", at) + 1);
	const next = rest.search(/^#{1,3} /mu);
	return next === -1 ? rest : rest.slice(0, next);
};

describe("design skills ask the user to choose the design first", () => {
	for (const [id, spec] of Object.entries(skills)) {
		describe(id, () => {
			const text = skillText(id);
			const section = stepBlock(text);
			const block = capped.has(id) ? `${section}\n${referenceText(id)}` : section;

			it("has a 'Choose the design first' section after the activation contract", () => {
				expect(text.match(new RegExp(HEADING.source, "gmu"))).toHaveLength(1);
				expect(text.search(HEADING)).toBeGreaterThan(text.indexOf("## #contract.activation"));
			});

			if (capped.has(id))
				it("points its capped entrypoint section at references/design-choice.md", () => {
					expect(section).toContain("`references/design-choice.md`");
				});

			it("asks with request_user_input, a recommended first choice and the user's right to choose", () => {
				expect(block).toContain("`request_user_input`");
				expect(block).toContain("(Recommended)");
				expect(block).toMatch(/right to choose/u);
				expect(block).toMatch(/2–4 options/u);
			});

			it("falls back to a numbered list that ends the turn when the tool is not offered", () => {
				expect(block).toMatch(/not offered/u);
				expect(block).toMatch(/numbered list/u);
				expect(block).toMatch(/end the turn to wait/u);
			});

			it("picks the recommended option and says so in one line in a non-interactive codex exec run", () => {
				expect(block).toContain("`codex exec`");
				expect(block).toMatch(/non-interactive/iu);
				expect(block).toMatch(/one line/u);
				expect(block).toContain("Non-interactive run:");
			});

			it("skips only when the prompt names the answer or hands the choice over", () => {
				expect(block).toMatch(/already names its answer/u);
				expect(block).toContain("you choose");
				expect(block).toContain("알아서");
				expect(block).toContain("네가 골라");
			});

			it("offers this skill's real presets, not a generic list", () => {
				for (const token of spec.choices) expect(block, `${id}: missing ${token}`).toMatch(token);
			});

			it("comes before the step that scaffolds, writes or renders the artifact", () => {
				const stepAt = text.search(HEADING);
				const buildAt = text.search(spec.build);
				expect(stepAt, `${id}: no 'Choose the design first' section`).toBeGreaterThan(-1);
				expect(buildAt, `${id}: build anchor ${spec.build} not found`).toBeGreaterThan(-1);
				expect(stepAt, `${id}: the choice (${stepAt}) must precede the build step (${buildAt})`).toBeLessThan(
					buildAt,
				);
			});
		});
	}

	it("keeps the seven steps skill-specific: no two share a body", () => {
		const bodies = Object.keys(skills).map((id) => stepBlock(skillText(id)).replace(/\s+/gu, " "));
		expect(new Set(bodies).size).toBe(bodies.length);
	});
});

describe("the routes that hand work to these skills do not tell the model to build first", () => {
	const parseInject = (decision: HookDecision): string => {
		expect(decision.kind).toBe("inject");
		if (decision.kind !== "inject") throw new Error("not inject");
		return (JSON.parse(decision.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
			.additionalContext;
	};

	it("the lit-schematic route asks the drawing questions before the truth file", () => {
		const ctx = parseInject(
			runUserPromptSubmitHook({
				hook_event_name: "UserPromptSubmit",
				prompt: "lit draw the PFD for the absorber section",
			}),
		);
		expect(ctx).toContain("Choose the design first");
		expect(ctx).toContain("request_user_input");
		expect(ctx.indexOf("Choose the design first")).toBeLessThan(ctx.indexOf("Write the process truth first"));
		const directive = pluginText("components/lit-loop/directives/lit-schematic.md");
		expect(directive).toContain("Choose the design first");
		expect(directive.indexOf("Choose the design first")).toBeLessThan(directive.indexOf("# Step 2"));
	});

	it.each([
		"components/lit-loop/directive.md",
		"components/lit-loop/directives/litwork.md",
		"skills/lit-loop/SKILL.md",
		"skills/litwork/SKILL.md",
	])("%s sends a new page through the design choice before design-lock init", (path) => {
		const body = pluginText(path);
		const choose = body.indexOf("Choose the design first");
		const lock = body.search(/design-lock\.mjs`? init/u);
		expect(choose, `${path}: no design choice`).toBeGreaterThan(-1);
		expect(lock, `${path}: no design-lock init`).toBeGreaterThan(-1);
		expect(choose).toBeLessThan(lock);
	});
});
