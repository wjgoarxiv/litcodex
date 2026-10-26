// src/codex-hook-schematic.test.ts — lit-schematic routing → injection integration.
//
// Drives runUserPromptSubmitHook directly (no process IO). `lit schematic` and the glued `lit-schematic`
// route by token; a bare `lit` that asks for a P&ID, PFD, apparatus figure or isometric cutaway routes
// through the classifier. Documents, decks, charts and interfaces keep the generic lit-loop route, and the
// words never route without `lit` in front of them.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";
import { LIT_SCHEMATIC_DIRECTIVE_MARKER } from "./markers.js";

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

describe("runUserPromptSubmitHook lit-schematic routing #given/#when/#then", () => {
	it.each([
		"lit schematic of the reactor loop",
		"LIT SCHEMATIC of the reactor loop",
		"lit-schematic hydrate reactor loop",
		"lit 고압 하이드레이트 반응기 루프 P&ID 그려줘",
		"lit draw a two-panel journal figure of the experimental setup",
		"lit isometric cutaway of a stirred autoclave",
		"lit 논문용 실험 장치 모식도 만들어줘",
		"lit draw the PFD for the absorber section",
		"lit 공정 계통도",
		"lit draw the plot plan for the tank farm",
		"lit 오토클레이브 컷어웨이를 모션 영상으로 만들어줘",
	])("routes %s to lit-schematic with its banner", (prompt) => {
		const decision = runUserPromptSubmitHook(ups(prompt));
		const ctx = parseInject(decision);
		expect(decision.kind === "inject" && decision.mode).toBe("lit-schematic");
		expect(ctx).toContain(LIT_SCHEMATIC_DIRECTIVE_MARKER);
		expect(ctx).toContain("🔥 **LIT IGNITED · lit-schematic** 🔥");
		expect(ctx).not.toContain("<lit-loop-mode>");
		expect(ctx).not.toContain("Film context");
	});

	it("names the installed skill and the route directive as files the model reads", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit draw the PFD for the absorber section")));
		expect(ctx).toMatch(/^skill lit-schematic: \/\S+\/skills\/lit-schematic\/SKILL\.md$/mu);
		expect(ctx).toMatch(/^directive lit-schematic: \/\S+\/directives\/lit-schematic\.md$/mu);
	});

	it("keeps documents, decks, charts, interfaces and software diagrams on the generic route", () => {
		for (const prompt of [
			"lit 도면 검토 보고서 작성해줘",
			"lit 배치도 설명 발표자료 만들어줘",
			"lit build a dashboard showing the P&ID of the reactor",
			"lit 단면도 데이터로 그래프 그려줘",
			"lit 도면 번호 체계 정리해줘",
			"lit draw a flowchart of the login flow",
		]) {
			expect(modeOf(prompt), prompt).toBe("lit-loop");
		}
	});

	it("keeps the neighbouring routes on their own tokens", () => {
		expect(modeOf("lit plan the P&ID review")).toBe("lit-plan");
		expect(modeOf("lit brainstorm names for the PFD")).toBe("lit-brainstorm");
		expect(modeOf("lit review the diff")).toBe("review-work");
		expect(modeOf("lit make a launch video")).toBe("lit-loop");
	});

	it("keeps the film context for a film that is not a drawing", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit 우리 제품 소개 영상 만들어줘")));
		expect(ctx).toContain("Film context: this is a film request.");
		expect(ctx).not.toContain(LIT_SCHEMATIC_DIRECTIVE_MARKER);
	});

	it("stays off without lit, in code, and for near misses and slash commands", () => {
		for (const prompt of [
			"draw a P&ID of the reactor",
			"공정도 그려줘",
			"`lit draw a P&ID`",
			"```\nlit draw a P&ID\n```",
			"lit-schematicer",
			"/lit-schematic",
			"lit-diagram-drawer draw the service deployment boundary",
		]) {
			expect(modeOf(prompt), prompt).not.toBe("lit-schematic");
		}
	});

	it("treats typed skill mentions as native skill loads, not as a hook route", () => {
		for (const prompt of [
			"$litcodex:lit-schematic draw the PFD",
			"$litcodex:lit-scientific-visualization plot the isotherm",
			"$litcodex:lit-diagram-drawer draw the deployment",
		]) {
			expect(modeOf(prompt), prompt).toBe(false);
		}
	});

	it("never throws and is deterministic on the lit-schematic trigger", () => {
		const prompt = "lit draw the PFD for the absorber section";
		expect(() => runUserPromptSubmitHook(ups(prompt))).not.toThrow();
		expect(runUserPromptSubmitHook(ups(prompt))).toEqual(runUserPromptSubmitHook(ups(prompt)));
	});
});
