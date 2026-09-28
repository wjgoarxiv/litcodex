import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";

const temporaryRoots: string[] = [];

function userPrompt(prompt: string, transcriptPath?: string): unknown {
	return {
		hook_event_name: "UserPromptSubmit",
		prompt,
		...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
	};
}

function injectedContext(decision: HookDecision): string {
	expect(decision.kind).toBe("inject");
	if (decision.kind !== "inject") throw new Error("expected LitCodex hook injection");
	const parsed = JSON.parse(decision.stdout) as {
		readonly hookSpecificOutput: { readonly additionalContext: string };
	};
	return parsed.hookSpecificOutput.additionalContext;
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("exact bare handoff UserPromptSubmit route", () => {
	it("injects the LitCodex handoff directive when the prompt is exactly handoff", () => {
		// Given: the exact standalone handoff invocation.
		// When: the real hook decision engine evaluates it.
		const context = injectedContext(runUserPromptSubmitHook(userPrompt("handoff")));

		// Then: the trusted route, banner, and native adapter are injected together.
		expect(context).toContain("<lit-handoff-mode>");
		expect(context).toContain("🔥 **LIT IGNITED · lit-handoff** 🔥");
		expect(context).toContain('<litcodex-skill-body name="lit-handoff">');
		expect(context).toContain("$litcodex:lit-handoff");
		expect(context).toContain("The handoff is not a status report. It is a reboot packet.");
	});

	it("accepts casing and surrounding whitespace without accepting extra prose", () => {
		// Given: equivalent exact invocations plus prompts that merely discuss handoff.
		const active = ["HANDOFF", "  handoff  ", "\nHandoff\t"];
		const inert = [
			"handoff now",
			"please handoff",
			"HANDOFF.md",
			"`handoff`",
			"> handoff",
			"$litcodex:lit-handoff",
			"```\nhandoff\n```",
		];

		// When/Then: exact forms inject; copied, scoped, path-like, and conversational forms stay inert.
		for (const prompt of active) expect(runUserPromptSubmitHook(userPrompt(prompt)).kind).toBe("inject");
		for (const prompt of inert) expect(runUserPromptSubmitHook(userPrompt(prompt)).kind).toBe("noop");
	});

	it("does not re-inject when the transcript already contains the handoff envelope", () => {
		// Given: a transcript carrying a prior trusted hook output for this exact mode.
		const root = mkdtempSync(join(tmpdir(), "litcodex-handoff-route-"));
		temporaryRoots.push(root);
		const transcript = join(root, "transcript.jsonl");
		writeFileSync(
			transcript,
			`${JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "UserPromptSubmit",
					additionalContext: "<lit-handoff-mode>already injected</lit-handoff-mode>",
				},
			})}\n`,
		);

		// When/Then: the per-mode transcript guard makes the duplicate invocation a no-op.
		expect(runUserPromptSubmitHook(userPrompt("handoff", transcript)).kind).toBe("noop");
	});

	it("injects a redaction contract rather than copying workspace secrets into context", () => {
		// Given/When: the exact handoff route activates.
		const context = injectedContext(runUserPromptSubmitHook(userPrompt("handoff")));

		// Then: the contract requires secret-value redaction before any continuation document is written.
		expect(context).toContain("secret values");
		expect(context).toContain("redact");
		expect(context).toContain("credential locations");
	});
});
