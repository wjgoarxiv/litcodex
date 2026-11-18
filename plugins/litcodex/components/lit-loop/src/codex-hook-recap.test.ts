// src/codex-hook-recap.test.ts — the recap words after lit-recap moved into lit-adhd (S5).
//
// Drives runUserPromptSubmitHook directly (no process IO): every old recap word routes to lit-adhd and names
// the recap view with the one-line moved note; `lit adhd recap [session]` names the view without the note;
// the bare brief names the verdict card, `detail` the board. Near-miss prose stays a noop.

import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";

const ups = (prompt: string): unknown => ({ hook_event_name: "UserPromptSubmit", prompt });

const parseInject = (decision: HookDecision): string => {
	expect(decision.kind).toBe("inject");
	if (decision.kind !== "inject") throw new Error("not inject");
	expect(decision.mode).toBe("lit-adhd");
	return (JSON.parse(decision.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
		.additionalContext;
};

describe("recap words open the lit-adhd recap view", () => {
	it.each(["recap", "lit-recap", "litrecap", "리캡", "lit recap this session", "recap --brief"])(
		"%s routes to lit-adhd with the moved note",
		(prompt) => {
			const ctx = parseInject(runUserPromptSubmitHook(ups(prompt)));
			expect(ctx).toContain(
				"lit-adhd view: recap. Run the collector with exactly these flags: `--recap --moved --lang ko`.",
			);
			expect(ctx).not.toContain("<lit-recap-mode>");
		},
	);

	it("lit adhd recap [session] opens the view without the note", () => {
		const ctx = parseInject(runUserPromptSubmitHook(ups("lit adhd recap 019a3f")));
		expect(ctx).toContain("`--recap 019a3f --lang ko`");
		expect(ctx).not.toContain("--moved");
	});

	it("the bare brief gets the card and detail gets the board", () => {
		expect(parseInject(runUserPromptSubmitHook(ups("lit adhd")))).toContain("lit-adhd view: card");
		expect(parseInject(runUserPromptSubmitHook(ups("lit adhd 자세히")))).toContain("`--detail --lang ko`");
	});

	it.each([
		["lit adhd", "ko"],
		["lit adhd what did I do yesterday", "ko"],
		["lit adhd show me where I left off", "ko"],
		["lit adhd --en", "en"],
		["lit adhd in English please", "en"],
		["lit adhd 영어로", "en"],
	])("R5: the code picks the language for %s (%s)", (prompt, lang) => {
		expect(parseInject(runUserPromptSubmitHook(ups(prompt)))).toContain(`--lang ${lang}\``);
	});

	it("stays a noop for near-miss prose and slash commands", () => {
		expect(runUserPromptSubmitHook(ups("recapture the flag")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(ups("/recap")).kind).toBe("noop");
	});
});
