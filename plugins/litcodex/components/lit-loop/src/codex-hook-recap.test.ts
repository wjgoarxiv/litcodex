// src/codex-hook-recap.test.ts — lit-recap routing → injection integration (SC2).
//
// Drives runUserPromptSubmitHook directly (no process IO): a recap trigger injects the
// <lit-recap-mode> directive with the locked Korean title, a --brief prompt still injects
// (the model branches to the digest at runtime), and near-miss prose stays a noop. Read-only
// is structural: the engine only loads the static directive behind the fail-silent boundary.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";
import { LIT_RECAP_DIRECTIVE_MARKER } from "./markers.js";

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

describe("runUserPromptSubmitHook lit-recap routing #given/#when/#then", () => {
	it("injects the lit-recap directive on a bare recap prompt (SC2)", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("recap")));
		expect(ctx).toContain(LIT_RECAP_DIRECTIVE_MARKER);
		expect(ctx).toContain("# 작업 리캡 (lit-recap)");
	});

	it("injects for every recap surface form (lit-recap / litrecap / 리캡 / lit recap)", () => {
		for (const prompt of ["lit-recap", "litrecap", "리캡", "lit recap this session"]) {
			expect(parseInject(runUserPromptSubmitHook(ups(prompt)))).toContain(LIT_RECAP_DIRECTIVE_MARKER);
		}
	});

	it("still injects with the --brief flag and surfaces the English/brief switches (SC5)", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("recap --brief")));
		expect(ctx).toContain(LIT_RECAP_DIRECTIVE_MARKER);
		expect(ctx).toContain("--brief");
		expect(ctx).toContain("--en");
	});

	it("stays a noop for near-miss prose and slash commands", () => {
		expect(runUserPromptSubmitHook(ups("recapture the flag")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(ups("/recap")).kind).toBe("noop");
	});

	it("never throws and is deterministic on the recap trigger", () => {
		expect(() => runUserPromptSubmitHook(ups("recap"))).not.toThrow();
		expect(runUserPromptSubmitHook(ups("recap"))).toEqual(runUserPromptSubmitHook(ups("recap")));
	});
});
