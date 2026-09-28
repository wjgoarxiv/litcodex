// src/codex-hook-comprehend.test.ts — lit-comprehend routing → injection integration.
//
// Drives runUserPromptSubmitHook directly (no process IO): a lit-comprehend trigger injects the
// <lit-comprehend-mode> directive with the banner, near-miss prose and natural-language phrases
// ("explain", "설명해줘") stay a noop. Conservative activation: the bounded token
// `lit-comprehend` and the bare `comprehend` alias.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";
import { LIT_COMPREHEND_DIRECTIVE_MARKER } from "./markers.js";

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

describe("runUserPromptSubmitHook lit-comprehend routing #given/#when/#then", () => {
	it("injects the lit-comprehend directive on a bare comprehend prompt", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("comprehend")));
		expect(ctx).toContain(LIT_COMPREHEND_DIRECTIVE_MARKER);
		expect(ctx).toContain("🔥 **LIT IGNITED · lit-comprehend** 🔥");
	});

	it("injects on lit-comprehend direct token", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit-comprehend")));
		expect(ctx).toContain(LIT_COMPREHEND_DIRECTIVE_MARKER);
	});

	it("injects on lit comprehend natural phrase", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit comprehend this module")));
		expect(ctx).toContain(LIT_COMPREHEND_DIRECTIVE_MARKER);
	});

	it("injects for case-insensitive variants", () => {
		for (const prompt of ["Comprehend", "COMPREHEND", "comprehend HEAD~5..HEAD", "LIT-COMPREHEND"]) {
			expect(parseInject(runUserPromptSubmitHook(ups(prompt)))).toContain(LIT_COMPREHEND_DIRECTIVE_MARKER);
		}
	});

	it("injects with --en and --md flags", () => {
		const ctxEn = parseInject(runUserPromptSubmitHook(ups("comprehend --en")));
		expect(ctxEn).toContain(LIT_COMPREHEND_DIRECTIVE_MARKER);
		expect(ctxEn).toContain("--en");

		const ctxMd = parseInject(runUserPromptSubmitHook(ups("comprehend --md")));
		expect(ctxMd).toContain(LIT_COMPREHEND_DIRECTIVE_MARKER);
		expect(ctxMd).toContain("--md");
	});

	it("stays a noop for morphological near-misses", () => {
		for (const prompt of [
			"comprehends",
			"comprehended",
			"comprehending",
			"comprehension",
			"comprehensive",
			"incomprehensible",
		]) {
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("noop");
		}
	});

	it("stays a noop for natural-language explain phrases (conservative activation)", () => {
		for (const prompt of [
			"explain this function to me",
			"설명해줘",
			"이해가 안 돼요",
			"what did you do in this session?",
		]) {
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("noop");
		}
	});

	it("stays a noop for code fences and slash commands", () => {
		expect(runUserPromptSubmitHook(ups("`comprehend`")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(ups("```\ncomprehend\n```")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(ups("/comprehend")).kind).toBe("noop");
	});

	it("never throws and is deterministic on the lit-comprehend trigger", () => {
		expect(() => runUserPromptSubmitHook(ups("comprehend"))).not.toThrow();
		expect(runUserPromptSubmitHook(ups("comprehend"))).toEqual(runUserPromptSubmitHook(ups("comprehend")));
	});
});
