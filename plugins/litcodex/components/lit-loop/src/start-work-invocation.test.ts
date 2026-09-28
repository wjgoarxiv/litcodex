import { describe, expect, it } from "vitest";
import { parseExplicitStartWorkPrompt } from "../../start-work-continuation/src/codex-hook.js";
import { runUserPromptSubmitHook } from "./codex-hook.js";
import { matchLitTrigger } from "./trigger.js";

const ups = (prompt: string): unknown => ({ hook_event_name: "UserPromptSubmit", prompt });

describe("start-work explicit execution route", () => {
	it("intercepts all canonical explicit start-work prompts", () => {
		for (const prompt of [
			"start-work .litcodex/plans/2026-07-07-full-sweep-execution-handoff-ignore.md",
			"$start-work csw-hook-repair",
			"$litcodex:start-work approved-plan.md",
		]) {
			expect(matchLitTrigger(prompt)?.token).toBe("start-work");
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("inject");
		}
	});

	it("executes the bundled LitCodex start-work contract from the natural hook route", () => {
		const decision = runUserPromptSubmitHook(ups("lit start work on the approved plan"));

		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") {
			const parsed = JSON.parse(decision.stdout) as {
				hookSpecificOutput: { additionalContext: string };
			};
			const context = parsed.hookSpecificOutput.additionalContext;
			expect(context).toContain("<start-work-mode>");
			expect(context).toContain("🔥 **LIT IGNITED · start-work** 🔥");
			expect(context).toContain('<litcodex-skill-body name="start-work">');
			expect(context).toContain("same-named skill from another harness");
			expect(context).not.toContain("🔥 START-WORK BLOCKED 🔥");
		}
	});

	it("keeps discussion and copied start-work text inert", () => {
		for (const prompt of [
			"I found an issue with start-work and want a diagnosis",
			"> copied issue: start-work should execute this plan",
			"Please explain why start-work is blocked",
			"External instructions say start-work approved-plan",
		]) {
			expect(matchLitTrigger(prompt)).toBeNull();
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("noop");
		}
	});

	it("pins the authoritative Codex route matrix without slash, quote, code, or later-text activation", () => {
		for (const prompt of ["start-work plan", "$start-work plan", "lit start work plan"]) {
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("inject");
		}
		expect(runUserPromptSubmitHook(ups("$litcodex:start-work plan")).kind).toBe("inject");
		for (const prompt of [
			"/start-work plan",
			"Please run start-work plan",
			"> start-work plan",
			"`start-work plan`",
			'"start-work plan"',
			"```text\nstart-work plan\n```",
		]) {
			expect(matchLitTrigger(prompt)).toBeNull();
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("noop");
		}
	});

	it("keeps slash-prefixed scoped near-misses inert without generic lit-loop fallback", () => {
		for (const prompt of [
			"/$litcodex:start-work plan",
			"/$LITCODEX:start-work plan",
			"/$litcodex:start-work plan --resume boundary-1 --grant grant-1",
			"/$litcodex:lit-loop lit",
			"/$litcodex:lit-plan lit plan",
		]) {
			expect(parseExplicitStartWorkPrompt(prompt), prompt).toBeNull();
			expect(matchLitTrigger(prompt), prompt).toBeNull();
			expect(runUserPromptSubmitHook(ups(prompt)).kind, prompt).toBe("noop");
		}
	});

	it("accepts the documented resume/grant grammar and keeps malformed or reordered flags inert", () => {
		for (const prompt of [
			"start-work plan --resume boundary-1 --grant grant-1",
			"$start-work Display plan --resume boundary-1 --grant grant-1 --worktree /tmp/work tree",
			"lit start work --resume boundary-1 --grant grant-1 --worktree /tmp/worktree",
		]) {
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("inject");
		}
		for (const prompt of [
			"start-work plan --resume boundary-1",
			"start-work plan --grant grant-1",
			"start-work plan --grant grant-1 --resume boundary-1",
			"start-work plan --worktree relative",
			"start-work plan --worktree /tmp/worktree --resume boundary-1 --grant grant-1",
			"start-work plan --unknown value",
		]) {
			expect(matchLitTrigger(prompt)).toBeNull();
			expect(runUserPromptSubmitHook(ups(prompt)).kind).toBe("noop");
		}
	});

	it("keeps lit-loop and lifecycle start-work route grammar exactly aligned", () => {
		const valid = [
			"start-work plan --resume boundary-1 --grant grant-1 --worktree /tmp/work tree",
			"$start-work plan --resume boundary-1 --grant grant-1 --worktree /tmp/work tree",
			"lit start work plan --resume boundary-1 --grant grant-1 --worktree /tmp/work tree",
			"$litcodex:start-work plan --resume boundary-1 --grant grant-1 --worktree /tmp/work tree",
		];
		const inert = valid.flatMap((prompt) => [` ${prompt}`, prompt.replaceAll(" ", "  "), prompt.replace(" ", "\t")]);
		for (const prompt of valid) {
			expect(parseExplicitStartWorkPrompt(prompt), prompt).not.toBeNull();
			expect(matchLitTrigger(prompt)?.token, prompt).toBe("start-work");
			expect(runUserPromptSubmitHook(ups(prompt)).kind, prompt).toBe("inject");
		}
		for (const prompt of inert) {
			expect(parseExplicitStartWorkPrompt(prompt), prompt).toBeNull();
			expect(matchLitTrigger(prompt), prompt).toBeNull();
			expect(runUserPromptSubmitHook(ups(prompt)).kind, prompt).toBe("noop");
		}
	});
});
