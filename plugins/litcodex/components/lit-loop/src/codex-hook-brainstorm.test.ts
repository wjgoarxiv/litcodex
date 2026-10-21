// src/codex-hook-brainstorm.test.ts — lit-brainstorm routing → injection integration.
//
// Drives runUserPromptSubmitHook directly (no process IO). `lit` followed by an ideation word
// (brainstorm, brainstorming, ideation, ideate, idea, ideas) routes to lit-brainstorm, not to lit-loop,
// deep-interview or lit-plan; the neighbouring routes keep their own tokens. The words never route
// without `lit` in front of them, so ordinary sentences stay inert.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";
import { LIT_BRAINSTORM_DIRECTIVE_MARKER } from "./markers.js";

const ups = (prompt: string): unknown => ({ hook_event_name: "UserPromptSubmit", prompt });

const parseInject = (decision: HookDecision): string => {
	expect(decision.kind).toBe("inject");
	if (decision.kind !== "inject") throw new Error("not inject");
	const parsed = JSON.parse(decision.stdout) as {
		hookSpecificOutput: { hookEventName: unknown; additionalContext: string };
	};
	expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
	return parsed.hookSpecificOutput.additionalContext;
};

describe("runUserPromptSubmitHook lit-brainstorm routing #given/#when/#then", () => {
	it.each([
		"lit brainstorm a name for my app",
		"lit brainstorming launch names",
		"lit ideation for the onboarding flow",
		"lit ideate on pricing",
		"lit idea for a weekend project",
		"lit ideas for a weekend project",
		"LIT BRAINSTORM a name for my app",
		"lit-brainstorm a name for my app",
	])("routes %s to lit-brainstorm with its banner", (prompt) => {
		const decision = runUserPromptSubmitHook(ups(prompt));
		const ctx = parseInject(decision);
		expect(decision.kind === "inject" && decision.mode).toBe("lit-brainstorm");
		expect(ctx).toContain(LIT_BRAINSTORM_DIRECTIVE_MARKER);
		expect(ctx).toContain("🔥 **LIT IGNITED · lit-brainstorm** 🔥");
		expect(ctx).not.toContain("<lit-loop-mode>");
		expect(ctx).not.toContain("<deep-interview-mode>");
		expect(ctx).not.toContain("<lit-plan-mode>");
	});

	it("names the installed skill and the route directive as files the model reads", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit brainstorm a name for my app")));
		expect(ctx).toMatch(/^skill lit-brainstorm: \/\S+\/skills\/lit-brainstorm\/SKILL\.md$/mu);
		expect(ctx).toMatch(/^directive lit-brainstorm: \/\S+\/directives\/lit-brainstorm\.md$/mu);
	});

	it("keeps the neighbouring routes on their own tokens", () => {
		const modeOf = (prompt: string): string | false => {
			const decision = runUserPromptSubmitHook(ups(prompt));
			return decision.kind === "inject" && decision.mode;
		};
		expect(modeOf("lit plan the brainstorm session")).toBe("lit-plan");
		expect(modeOf("lit plan X")).toBe("lit-plan");
		expect(modeOf("lit interview X")).toBe("lit-loop");
		expect(modeOf("lit deep interview a habit tracker")).toBe("deep-interview");
		expect(modeOf("deep-interview a habit tracker")).toBe("deep-interview");
		expect(modeOf("lit-crucible this release")).toBe("lit-crucible");
		expect(modeOf("lit review plan")).toBe("review-work");
		expect(modeOf("lit review work")).toBe("review-work");
		expect(modeOf("lit goal bind the release objective")).toBe("litgoal");
		expect(modeOf("lit fix the typo in README.md")).toBe("lit-loop");
	});

	it("stays inert for the same words without lit, near misses, code and slash commands", () => {
		for (const prompt of [
			"brainstorm",
			"brainstorm a name for my app",
			"any ideas for my app?",
			"ideation",
			"lit ideal",
			"lit ideated",
			"lit-brainstormer",
			"`lit brainstorm a name`",
			"```\nlit brainstorm a name\n```",
			"/lit-brainstorm",
		]) {
			const decision = runUserPromptSubmitHook(ups(prompt));
			expect(decision.kind === "inject" && decision.mode, prompt).not.toBe("lit-brainstorm");
		}
	});

	it("never throws and is deterministic on the lit-brainstorm trigger", () => {
		const prompt = "lit brainstorm a name for my app";
		expect(() => runUserPromptSubmitHook(ups(prompt))).not.toThrow();
		expect(runUserPromptSubmitHook(ups(prompt))).toEqual(runUserPromptSubmitHook(ups(prompt)));
	});
});
