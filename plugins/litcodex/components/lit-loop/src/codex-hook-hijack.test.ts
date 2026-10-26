// src/codex-hook-hijack.test.ts — lit-hijack routing → injection integration.
//
// Drives runUserPromptSubmitHook directly (no process IO). `lit hijack`, `lit hijacking`, `lit 하이재킹`,
// `lit 하이잭` and the glued `lit-hijack` route by token, ahead of the planning, review and research routes
// only when the route word sits directly after `lit`. Near misses and the words without `lit` stay off.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";
import { LIT_HIJACK_DIRECTIVE_MARKER } from "./markers.js";

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

describe("runUserPromptSubmitHook lit-hijack routing #given/#when/#then", () => {
	it.each([
		"lit hijack https://x.com/someone/status/1 into plugins/litcodex/skills/lit-motion",
		"LIT HIJACK this post",
		"lit hijacking these five posts and two PDFs; find what my skill lacks",
		"lit 하이재킹 이 글의 기법을 내 스킬에",
		"lit 하이재킹을 내 스킬에 적용해줘",
		"lit 하이잭 이 레포의 구성 원칙을 새 스킬로",
		"lit-hijack https://github.com/owner/repo",
		"lit hijack the P&ID drawing technique from these posts into lit-schematic",
	])("routes %s to lit-hijack with its banner", (prompt) => {
		const decision = runUserPromptSubmitHook(ups(prompt));
		const ctx = parseInject(decision);
		expect(decision.kind === "inject" && decision.mode).toBe("lit-hijack");
		expect(ctx).toContain(LIT_HIJACK_DIRECTIVE_MARKER);
		expect(ctx).toContain("🔥 **LIT IGNITED · lit-hijack** 🔥");
		expect(ctx).not.toContain("<lit-loop-mode>");
	});

	it("names the installed skill and the route directive as files the model reads", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit hijack this post into my skill")));
		expect(ctx).toMatch(/^skill lit-hijack: \/\S+\/skills\/lit-hijack\/SKILL\.md$/mu);
		expect(ctx).toMatch(/^directive lit-hijack: \/\S+\/directives\/lit-hijack\.md$/mu);
	});

	it("keeps the neighbouring routes on their own tokens when the route word is not directly after lit", () => {
		expect(modeOf("lit plan the hijack report layout")).toBe("lit-plan");
		expect(modeOf("lit review the hijack ledger")).toBe("review-work");
		expect(modeOf("lit research session hijack defences")).toBe("litresearch");
		expect(modeOf("lit brainstorm names for the hijack feature")).toBe("lit-brainstorm");
		expect(modeOf("lit debug the session hijack")).toBe("lit-loop");
	});

	it("puts the porting route ahead of the drawing route, which keeps its own requests", () => {
		expect(modeOf("lit hijack the P&ID drawing technique from these posts into lit-schematic")).toBe("lit-hijack");
		expect(modeOf("lit draw a P&ID of the hijack test rig")).toBe("lit-schematic");
	});

	it("stays off without lit, in code, and for near misses and slash commands", () => {
		for (const prompt of [
			"hijack this post into my skill",
			"하이재킹 기법을 내 스킬에",
			"how do attackers hijack a session cookie?",
			"`lit hijack this`",
			"```\nlit hijack this\n```",
			"lit-hijacker",
			"/lit-hijack",
		]) {
			expect(modeOf(prompt), prompt).not.toBe("lit-hijack");
		}
	});

	it("treats a typed skill mention as a native skill load, not as a hook route", () => {
		for (const prompt of ["$litcodex:lit-hijack port this post", "$litcodex:lit-hijack https://x.com/a/status/1"]) {
			expect(modeOf(prompt), prompt).toBe(false);
		}
	});

	it("never throws and is deterministic on the lit-hijack trigger", () => {
		const prompt = "lit 하이재킹 이 글의 기법을 내 스킬에";
		expect(() => runUserPromptSubmitHook(ups(prompt))).not.toThrow();
		expect(runUserPromptSubmitHook(ups(prompt))).toEqual(runUserPromptSubmitHook(ups(prompt)));
	});
});
