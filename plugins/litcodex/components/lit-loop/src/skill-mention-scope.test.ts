import { describe, expect, it } from "vitest";
import { scopedTokenForBareLit, suppressesBareLitAfterCodexSkillMention } from "./skill-mention-scope.js";

const laterBareLitIndex = (prompt: string): number => prompt.lastIndexOf("lit");

describe("scopedTokenForBareLit", () => {
	it("routes a later bare lit to the preceding lit-plan skill mention", () => {
		const prompt = "$litcodex:lit-plan build an implementation plan\n\nlit";

		expect(scopedTokenForBareLit(prompt, laterBareLitIndex(prompt))).toBe("lit-plan");
	});

	it("routes a later bare lit to the preceding lit-loop skill mention", () => {
		const prompt = "$litcodex:lit-loop resume the durable loop\n\nlit";

		expect(scopedTokenForBareLit(prompt, laterBareLitIndex(prompt))).toBe("lit-loop");
	});

	it("routes a later bare lit to a preceding deep-interview skill mention", () => {
		const prompt = "$litcodex:deep-interview clarify the request\n\nlit";

		expect(scopedTokenForBareLit(prompt, laterBareLitIndex(prompt))).toBe("deep-interview");
	});

	it("uses the nearest preceding lit-family skill mention", () => {
		const prompt = "$litcodex:lit-loop inspect first\n\n$litcodex:lit-plan then plan\n\nlit";

		expect(scopedTokenForBareLit(prompt, laterBareLitIndex(prompt))).toBe("lit-plan");
	});

	it("ignores non-LitCodex skill mentions", () => {
		const prompt = "$other:lit-plan build an implementation plan\n\nlit";

		expect(scopedTokenForBareLit(prompt, laterBareLitIndex(prompt))).toBeNull();
	});

	it("suppresses later bare lit after a scoped start-work skill mention", () => {
		const prompt = "$litcodex:start-work approved-plan.md lit";
		const index = laterBareLitIndex(prompt);

		expect(scopedTokenForBareLit(prompt, index)).toBeNull();
		expect(suppressesBareLitAfterCodexSkillMention(prompt, index)).toBe(true);
	});
});
