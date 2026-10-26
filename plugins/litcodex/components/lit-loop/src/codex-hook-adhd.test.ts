// src/codex-hook-adhd.test.ts — lit-adhd routing → injection integration.
//
// Drives runUserPromptSubmitHook directly (no process IO). `lit adhd`, `lit rewind` and the glued `lit-adhd` and
// `lit-rewind` route by token; the word has to end at a boundary, and quoted, slash or mid-sentence mentions stay off.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";
import { LIT_ADHD_DIRECTIVE_MARKER } from "./markers.js";

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

const modeOf = (prompt: string): string | false => {
	const decision = runUserPromptSubmitHook(ups(prompt));
	return decision.kind === "inject" && decision.mode;
};

describe("runUserPromptSubmitHook lit-adhd routing #given/#when/#then", () => {
	it.each([
		"lit adhd",
		"LIT ADHD where was I",
		"lit rewind",
		"lit rewind --here",
		"lit-adhd",
		"lit-rewind --since 2d",
		"lit lit-adhd",
	])("routes %s to lit-adhd with its banner", (prompt) => {
		const decision = runUserPromptSubmitHook(ups(prompt));
		const ctx = parseInject(decision);
		expect(decision.kind === "inject" && decision.mode).toBe("lit-adhd");
		expect(ctx).toContain(LIT_ADHD_DIRECTIVE_MARKER);
		expect(ctx).toContain("🔥 **LIT IGNITED · lit-adhd** 🔥");
		expect(ctx).not.toContain("<lit-loop-mode>");
	});

	it("names the installed skill, the route directive and the collector command", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit adhd")));
		expect(ctx).toMatch(/^skill lit-adhd: \/\S+\/skills\/lit-adhd\/SKILL\.md$/mu);
		expect(ctx).toMatch(/^directive lit-adhd: \/\S+\/directives\/lit-adhd\.md$/mu);
		expect(ctx).toMatch(/components\/lit-loop\/dist\/cli\.js rewind --json/u);
	});

	it.each([
		["lit adhder", "lit-loop"],
		["lit rewinding the tape", "lit-loop"],
		["lit plan the rewind button", "lit-plan"],
	])("keeps %s on %s", (prompt, mode) => {
		expect(modeOf(prompt)).toBe(mode);
	});

	it.each([
		"lit-adhder",
		"/lit-adhd",
		"`lit adhd`",
		"```\nlit adhd\n```",
		"adhd and rewind notes",
		"please rewind the loop",
	])("leaves %j alone", (prompt) => {
		expect(modeOf(prompt)).not.toBe("lit-adhd");
	});

	it("is deterministic and never throws", () => {
		const a = runUserPromptSubmitHook(ups("lit adhd"));
		const b = runUserPromptSubmitHook(ups("lit adhd"));
		expect(a).toEqual(b);
	});
});
