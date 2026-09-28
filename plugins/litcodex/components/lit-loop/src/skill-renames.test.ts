import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runUserPromptSubmitHook } from "./codex-hook.js";

const RENAMES = [
	["hyperplan", "lit-crucible"],
	["init-deep", "lit-init"],
	["git-master", "lit-commit"],
	["teammode", "lit-team"],
	["remove-ai-slops", "lit-burnoff"],
	["ai-slop-remover", "lit-burnoff-file"],
	["lit-korean", "lit-humanizer"],
	["text-naturalization", "lit-humanizer"],
	["korean-ai-slop-remover", "lit-humanizer"],
	["public-page-reader", "lit-fetch"],
	["programming", "lit-code"],
] as const;

describe("one-release skill rename aliases", () => {
	it.each(RENAMES)("alias %s routes to %s with one deprecation note", (oldId, newId) => {
		// Given: an old bare invocation with a fresh transcript.
		const prompt = `${oldId} perform the requested task`;
		// When: the real hook selects its installed skill body.
		const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt });
		// Then: the canonical body and one exact note reach the host.
		expect(decision.kind).toBe("inject");
		if (decision.kind !== "inject") return;
		const output = JSON.parse(decision.stdout);
		const context: string = output.hookSpecificOutput.additionalContext;
		const note = `Note: \`${oldId}\` was renamed to \`${newId}\`; the old name is removed in the next minor.`;
		expect(context.split("\n").filter((line) => line === note)).toHaveLength(1);
		expect(context).toContain(`<litcodex-skill-body name="${newId}">`);
		expect(context).toContain(
			readFileSync(new URL(`../../../skills/${newId}/SKILL.md`, import.meta.url), "utf8").trim(),
		);
		expect(existsSync(new URL(`../../../skills/${oldId}/`, import.meta.url))).toBe(false);
	});

	it.each(RENAMES)("canonical %s replacement %s has no deprecation note", (_oldId, newId) => {
		// Given / When: the canonical bare invocation reaches the hook.
		const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt: newId });
		// Then
		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") expect(decision.stdout).not.toContain("was renamed to");
	});

	it.each(RENAMES)("scoped alias %s redirects to %s", (oldId, newId) => {
		// Given / When: a removed picker id is explicitly mentioned.
		const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt: `$litcodex:${oldId}` });
		// Then
		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") expect(decision.mode).toBe(newId);
	});

	it.each(RENAMES)("embedded scoped alias %s redirects to %s", (oldId, newId) => {
		// Given / When: native scoped mention syntax inside a sentence.
		const decision = runUserPromptSubmitHook({
			hook_event_name: "UserPromptSubmit",
			prompt: `Please use $litcodex:${oldId} for this task.`,
		});
		// Then: removing the picker directory does not strand the old mention.
		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") expect(decision.mode).toBe(newId);
	});

	it.each(RENAMES)("canonical scoped mention %s replacement %s remains native", (_oldId, newId) => {
		// Given / When / Then: the hook leaves canonical scoped mentions to Codex discovery.
		expect(
			runUserPromptSubmitHook({
				hook_event_name: "UserPromptSubmit",
				prompt: `Please use $litcodex:${newId} for this task.`,
			}),
		).toEqual({ kind: "noop" });
	});

	it("routes the removed slash command /lit-korean to lit-humanizer", () => {
		const decision = runUserPromptSubmitHook({
			hook_event_name: "UserPromptSubmit",
			prompt: "/lit-korean revise this paragraph",
		});
		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") expect(decision.mode).toBe("lit-humanizer");
	});

	it.each([
		"/lit-korean",
		"/text-naturalization",
		"/korean-ai-slop-remover",
	])("routes the former prose alias %s to lit-humanizer", (prompt) => {
		const decision = runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt });
		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") expect(decision.mode).toBe("lit-humanizer");
	});

	it("preserves the earlier bounded route ahead of a later scoped alias", () => {
		// Given / When: the user first selects the planning route.
		const decision = runUserPromptSubmitHook({
			hook_event_name: "UserPromptSubmit",
			prompt: "lit-plan consider $litcodex:programming later",
		});
		// Then
		expect(decision.kind).toBe("inject");
		if (decision.kind === "inject") expect(decision.mode).toBe("lit-plan");
	});

	it.each([
		"`programming`",
		"```\nprogramming\n```",
		"discuss programming languages",
		"/git-master",
		"git-master-extra",
		"$other:git-master",
		"Please discuss `$litcodex:git-master` as syntax",
		"```\n$litcodex:programming\n```",
	])("keeps non-invocation %s inert", (prompt) => {
		// Given / When / Then: code, discussion, other plugins and slash forms are not routes.
		expect(runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt })).toEqual({ kind: "noop" });
	});
});
