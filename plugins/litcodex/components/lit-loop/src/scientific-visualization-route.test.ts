import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";

const temporaryRoots: string[] = [];

function userPrompt(prompt: string, transcriptPath?: string): unknown {
	return {
		hook_event_name: "UserPromptSubmit",
		prompt,
		...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
	};
}

function injectedContext(decision: HookDecision): string {
	expect(decision.kind).toBe("inject");
	if (decision.kind !== "inject") throw new Error("expected LitCodex hook injection");
	const parsed = JSON.parse(decision.stdout) as {
		readonly hookSpecificOutput: { readonly additionalContext: string };
	};
	return parsed.hookSpecificOutput.additionalContext;
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("exact bare scientific visualization UserPromptSubmit route", () => {
	it("injects the native directive, exact banner, and complete adapter contract", () => {
		// Given: the exact standalone scientific-visualization invocation.
		// When: the real hook decision engine evaluates it.
		const context = injectedContext(runUserPromptSubmitHook(userPrompt("lit-scientific-visualization")));

		// Then: the trusted route and complete installed adapter arrive in one native envelope.
		expect(context).toContain("<lit-scientific-visualization-mode>");
		expect(context).toContain("🔥 **LIT IGNITED · lit-scientific-visualization** 🔥");
		expect(context).toContain('<litcodex-skill-body name="lit-scientific-visualization">');
		expect(context).toContain("authored_skill_root:");
		expect(context).toContain("scripts/dependency-preflight.py --json");
		expect(context).toContain("b1b8f1bf8791daecdbb00dc70631cd955e72976664d302af0bc81e218b9cec3b");
	});

	it("accepts casing and edge whitespace while every non-exact form remains inert", () => {
		// Given: equivalent exact spellings and prompts that only mention or resemble the route.
		const active = [
			"LIT-SCIENTIFIC-VISUALIZATION",
			"  lit-scientific-visualization  ",
			"\nLit-Scientific-Visualization\t",
		];
		const inert = [
			"lit-scientific-visualization now",
			"please lit-scientific-visualization",
			"scientific-visualization",
			"lit scientific visualization",
			"lit-scientific-visualizations",
			"lit-scientific-visualization.md",
			"`lit-scientific-visualization`",
			"> lit-scientific-visualization",
			"$litcodex:lit-scientific-visualization",
			"/lit-scientific-visualization",
			"```\nlit-scientific-visualization\n```",
		];

		// When/Then: only a complete bare invocation activates the hook route.
		for (const prompt of active) expect(runUserPromptSubmitHook(userPrompt(prompt)).kind).toBe("inject");
		for (const prompt of inert) expect(runUserPromptSubmitHook(userPrompt(prompt)).kind).toBe("noop");
	});

	it("does not re-inject when the transcript already contains its mode envelope", () => {
		// Given: a transcript carrying a prior trusted scientific-visualization hook output.
		const root = mkdtempSync(join(tmpdir(), "litcodex-science-route-"));
		temporaryRoots.push(root);
		const transcript = join(root, "transcript.jsonl");
		writeFileSync(
			transcript,
			`${JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "UserPromptSubmit",
					additionalContext:
						"<lit-scientific-visualization-mode>already injected</lit-scientific-visualization-mode>",
				},
			})}\n`,
		);

		// When/Then: the per-mode transcript guard suppresses duplicate activation.
		expect(runUserPromptSubmitHook(userPrompt("lit-scientific-visualization", transcript)).kind).toBe("noop");
	});
});
