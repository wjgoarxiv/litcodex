// src/modes.test.ts — multi-mode router table (RC1/RC2). Pure; no I/O.

import { describe, expect, it } from "vitest";
import {
	DEEP_INTERVIEW_DIRECTIVE_CLOSE,
	DEEP_INTERVIEW_DIRECTIVE_MARKER,
	LIT_CRUCIBLE_DIRECTIVE_CLOSE,
	LIT_CRUCIBLE_DIRECTIVE_MARKER,
	LIT_INIT_DIRECTIVE_CLOSE,
	LIT_INIT_DIRECTIVE_MARKER,
	LIT_LOOP_DIRECTIVE_CLOSE,
	LIT_LOOP_DIRECTIVE_MARKER,
	LIT_PLAN_DIRECTIVE_CLOSE,
	LIT_PLAN_DIRECTIVE_MARKER,
	LIT_RECAP_DIRECTIVE_CLOSE,
	LIT_RECAP_DIRECTIVE_MARKER,
	LITGOAL_DIRECTIVE_CLOSE,
	LITGOAL_DIRECTIVE_MARKER,
	LITWORK_DIRECTIVE_CLOSE,
	LITWORK_DIRECTIVE_MARKER,
} from "./markers.js";
import { MODE_BY_TOKEN, modeForToken } from "./modes.js";
import { LIT_TRIGGER_TOKENS } from "./trigger.js";

describe("MODE_BY_TOKEN routing table", () => {
	it("maps the three lit-loop-family tokens to the single lit-loop mode + root directive.md", () => {
		for (const token of ["lit-loop", "litcodex", "lit"] as const) {
			const spec = modeForToken(token);
			expect(spec.mode).toBe("lit-loop");
			expect(spec.openMarker).toBe(LIT_LOOP_DIRECTIVE_MARKER);
			expect(spec.closeMarker).toBe(LIT_LOOP_DIRECTIVE_CLOSE);
			expect(spec.directivePath.endsWith("/directive.md")).toBe(true);
			expect(spec.directivePath).not.toContain("/directives/");
		}
		// all three share the SAME frozen spec object (single source).
		expect(modeForToken("lit")).toBe(modeForToken("lit-loop"));
		expect(modeForToken("litcodex")).toBe(modeForToken("lit-loop"));
	});

	it("maps litwork → litwork mode + directives/litwork.md", () => {
		const spec = modeForToken("litwork");
		expect(spec.mode).toBe("litwork");
		expect(spec.openMarker).toBe(LITWORK_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(LITWORK_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/litwork.md")).toBe(true);
	});

	it("maps lit-plan → lit-plan mode + directives/lit-plan.md", () => {
		const spec = modeForToken("lit-plan");
		expect(spec.mode).toBe("lit-plan");
		expect(spec.openMarker).toBe(LIT_PLAN_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(LIT_PLAN_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/lit-plan.md")).toBe(true);
	});

	it("maps litgoal → litgoal mode + directives/litgoal.md", () => {
		const spec = modeForToken("litgoal");
		expect(spec.mode).toBe("litgoal");
		expect(spec.openMarker).toBe(LITGOAL_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(LITGOAL_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/litgoal.md")).toBe(true);
	});

	it("maps lit-recap → lit-recap mode + directives/lit-recap.md", () => {
		const spec = modeForToken("lit-recap");
		expect(spec.mode).toBe("lit-recap");
		expect(spec.openMarker).toBe(LIT_RECAP_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(LIT_RECAP_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/lit-recap.md")).toBe(true);
	});

	it("maps lit-crucible → lit-crucible mode + directives/lit-crucible.md", () => {
		const spec = modeForToken("lit-crucible");
		expect(spec.mode).toBe("lit-crucible");
		expect(spec.openMarker).toBe(LIT_CRUCIBLE_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(LIT_CRUCIBLE_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/lit-crucible.md")).toBe(true);
		expect(spec.skillPath.endsWith("/skills/lit-crucible/SKILL.md")).toBe(true);
	});

	it("maps lit-init → lit-init mode + directives/lit-init.md", () => {
		const spec = modeForToken("lit-init");
		expect(spec.mode).toBe("lit-init");
		expect(spec.openMarker).toBe(LIT_INIT_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(LIT_INIT_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/lit-init.md")).toBe(true);
		expect(spec.skillPath.endsWith("/skills/lit-init/SKILL.md")).toBe(true);
	});

	it("maps deep-interview → dedicated Codex planning directive", () => {
		const spec = modeForToken("deep-interview" as never);
		expect(spec.mode).toBe("deep-interview");
		expect(spec.openMarker).toBe(DEEP_INTERVIEW_DIRECTIVE_MARKER);
		expect(spec.closeMarker).toBe(DEEP_INTERVIEW_DIRECTIVE_CLOSE);
		expect(spec.directivePath.endsWith("/directives/deep-interview.md")).toBe(true);
		expect(spec.skillPath.endsWith("/skills/deep-interview/SKILL.md")).toBe(true);
	});

	it("maps natural phrase modes to their dedicated directives", () => {
		expect(modeForToken("review-work" as never).mode).toBe("review-work");
		expect(modeForToken("review-work" as never).directivePath.endsWith("/directives/review-work.md")).toBe(true);
		expect(modeForToken("litresearch" as never).mode).toBe("litresearch");
		expect(modeForToken("litresearch" as never).directivePath.endsWith("/directives/litresearch.md")).toBe(true);
		expect(modeForToken("start-work" as never).mode).toBe("start-work");
		expect(modeForToken("start-work" as never).directivePath.endsWith("/directives/start-work.md")).toBe(true);
	});

	it("covers EVERY trigger token (no token can route nowhere) and is frozen", () => {
		for (const token of LIT_TRIGGER_TOKENS) {
			expect(MODE_BY_TOKEN[token]).toBeDefined();
			expect(typeof MODE_BY_TOKEN[token].directivePath).toBe("string");
			expect(typeof MODE_BY_TOKEN[token].skillName).toBe("string");
			expect(MODE_BY_TOKEN[token].skillPath.endsWith(`/skills/${MODE_BY_TOKEN[token].skillName}/SKILL.md`)).toBe(
				true,
			);
		}
		expect(Object.isFrozen(MODE_BY_TOKEN)).toBe(true);
	});

	it("every mode's open/close markers are a distinct, well-formed <mode>/</mode> pair", () => {
		const seen = new Set<string>();
		for (const token of LIT_TRIGGER_TOKENS) {
			const { openMarker, closeMarker } = MODE_BY_TOKEN[token];
			expect(openMarker.startsWith("<") && openMarker.endsWith("-mode>")).toBe(true);
			expect(closeMarker).toBe(openMarker.replace("<", "</"));
			seen.add(openMarker);
		}
		// 12 modes → 12 distinct markers (lit/litcodex/lit-loop share one).
		expect(seen.size).toBe(12);
	});
});
