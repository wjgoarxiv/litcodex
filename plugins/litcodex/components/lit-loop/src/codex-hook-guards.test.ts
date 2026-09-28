import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
	applyPreToolUseCreateGoalGuard,
	formatAdditionalContextOutput,
	type HookDecision,
	runUserPromptSubmitHook,
} from "./codex-hook.js";
import { activationMessage } from "./lit-mark.js";
import { LIT_LOOP_DIRECTIVE_MARKER } from "./markers.js";

const tmpDir = mkdtempSync(join(tmpdir(), "lit-codex-hook-guards-"));
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));
const upsSnake = (prompt: string, transcriptPath?: string | null): unknown => {
	const base: Record<string, unknown> = { hook_event_name: "UserPromptSubmit", prompt };
	if (transcriptPath !== undefined) base["transcript_path"] = transcriptPath;
	return base;
};
const parseInject = (decision: HookDecision): { hookEventName: unknown; additionalContext: unknown } => {
	expect(decision.kind).toBe("inject");
	if (decision.kind !== "inject") throw new Error("not inject");
	const parsed = JSON.parse(decision.stdout) as {
		hookSpecificOutput: { hookEventName: unknown; additionalContext: unknown };
	};
	return parsed.hookSpecificOutput;
};

describe("runUserPromptSubmitHook no-op branches #given/#when/#then", () => {
	it("is a no-op on a wrong-shape parsed value (array/null/string)", () => {
		expect(runUserPromptSubmitHook([1, 2, 3]).kind).toBe("noop");
		expect(runUserPromptSubmitHook(null).kind).toBe("noop");
		expect(runUserPromptSubmitHook("UserPromptSubmit").kind).toBe("noop");
	});

	it("is a no-op on a non-UserPromptSubmit event", () => {
		expect(runUserPromptSubmitHook({ hook_event_name: "PreToolUse", prompt: "lit" }).kind).toBe("noop");
	});

	it("is a no-op on an empty prompt", () => {
		expect(runUserPromptSubmitHook(upsSnake("")).kind).toBe("noop");
	});

	it("is a no-op on a substring collision (split / literal do not activate)", () => {
		expect(runUserPromptSubmitHook(upsSnake("please split this")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("literal value")).kind).toBe("noop");
	});

	it("is a no-op for slash-command-style mentions except explicit slash litresearch, and for code spans/fences", () => {
		expect(runUserPromptSubmitHook(upsSnake("/lit review this")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("/lit-crucible lit")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("please `lit review` this")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("please `lit-crucible this`")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("```\nlit start work\n```")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("```\nlit-crucible this\n```")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("/tmp/repo then lit review")).kind).toBe("inject");
	});

	it("keeps ordinary Codex skill mentions inert while accepting the canonical scoped start-work route", () => {
		expect(runUserPromptSubmitHook(upsSnake("$litcodex:lit-plan build a plan")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("$litcodex:lit-loop build a loop")).kind).toBe("noop");
		expect(runUserPromptSubmitHook(upsSnake("$litcodex:start-work approved-plan.md")).kind).toBe("inject");
		expect(
			parseInject(runUserPromptSubmitHook(upsSnake("$litcodex:lit-plan build a plan\n\nlit"))).additionalContext,
		).toContain("<lit-plan-mode>");
		expect(
			parseInject(runUserPromptSubmitHook(upsSnake("$litcodex:lit-plan build a plan\n\nlit plan")))
				.additionalContext,
		).toContain("<lit-plan-mode>");
	});

	it.each([
		"structural-search",
		"$litcodex:structural-search find calls",
		"refactor",
		"$litcodex:refactor rename this symbol",
		"rules",
		"$litcodex:lsp inspect diagnostics",
	])("leaves picker-only skill text inert in UserPromptSubmit: %s", (prompt) => {
		expect(runUserPromptSubmitHook(upsSnake(prompt)).kind).toBe("noop");
	});

	it("is a no-op when the prompt is a context-pressure recovery message (guard suppresses)", () => {
		expect(runUserPromptSubmitHook(upsSnake("context compacted, please lit")).kind).toBe("noop");
	});

	it("is a no-op when the transcript already carries a prior hook envelope (idempotency guard)", () => {
		const transcript = join(tmpDir, "dup-transcript.jsonl");
		writeFileSync(
			transcript,
			`${JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "UserPromptSubmit",
					additionalContext: `${LIT_LOOP_DIRECTIVE_MARKER}x</lit-loop-mode>`,
				},
			})}\n`,
		);
		expect(runUserPromptSubmitHook(upsSnake("lit", transcript)).kind).toBe("noop");
	});
});

describe("formatAdditionalContextOutput #given/#when/#then", () => {
	it("wraps non-empty context in the camelCase envelope with a trailing newline", () => {
		const line = formatAdditionalContextOutput("<lit-loop-mode>\nhi\n</lit-loop-mode>", "lit-loop");
		expect(line.endsWith("\n")).toBe(true);
		expect(line.trimEnd().split("\n")).toHaveLength(1);
		const parsed = JSON.parse(line) as {
			systemMessage: string;
			hookSpecificOutput: { hookEventName: string; additionalContext: string };
		};
		expect(parsed.systemMessage).toBe(activationMessage("lit-loop", { NO_COLOR: "1" }));
		expect(parsed.hookSpecificOutput).toStrictEqual({
			hookEventName: "UserPromptSubmit",
			additionalContext: "<lit-loop-mode>\nhi\n</lit-loop-mode>",
		});
	});

	it("keeps the activation systemMessage plain when truecolor is advertised", () => {
		const env = { LANG: "en_US.UTF-8", TERM: "xterm-256color", COLORTERM: "truecolor" };
		const parsed = JSON.parse(
			formatAdditionalContextOutput("<lit-loop-mode>\nhi\n</lit-loop-mode>", "lit-loop", env),
		) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
		expect(parsed.systemMessage).not.toContain("\x1b");
		expect(parsed.systemMessage).toBe(activationMessage("lit-loop", env));
		expect(parsed.hookSpecificOutput.additionalContext).not.toContain("\x1b");
	});

	it("honors NO_COLOR in the activation systemMessage", () => {
		const parsed = JSON.parse(
			formatAdditionalContextOutput("<lit-loop-mode>\nhi\n</lit-loop-mode>", "lit-loop", { NO_COLOR: "1" }),
		) as { systemMessage: string };
		expect(parsed.systemMessage).not.toContain("\x1b");
		expect(parsed.systemMessage).toBe(activationMessage("lit-loop", { NO_COLOR: "1" }));
	});

	it("normalizes CRLF and trims, then returns no \\r", () => {
		const line = formatAdditionalContextOutput("\r\n<lit-loop-mode>\r\nhi\r\n</lit-loop-mode>\r\n", "lit-loop");
		const parsed = JSON.parse(line);
		expect(parsed.hookSpecificOutput.additionalContext).not.toContain("\r");
		expect(parsed.hookSpecificOutput.additionalContext.startsWith("<lit-loop-mode>")).toBe(true);
	});

	it("returns '' for an empty / whitespace-only context (caller treats as noop)", () => {
		expect(formatAdditionalContextOutput("", "lit-loop")).toBe("");
		expect(formatAdditionalContextOutput("   \n\t ", "lit-loop")).toBe("");
	});
});

describe("applyPreToolUseCreateGoalGuard #given/#when/#then", () => {
	it("denies create_goal payloads that try to set a numeric budget", () => {
		const out = applyPreToolUseCreateGoalGuard({
			hook_event_name: "PreToolUse",
			tool_name: "create_goal",
			tool_input: { objective: "ship it", token_budget: 1000 },
		});
		expect(out.kind).toBe("deny");
		if (out.kind !== "deny") throw new Error("expected deny");
		expect(out.stdout).toContain("permissionDecision");
		expect(out.stdout).toContain("objective only");
		expect(out.stdout).toContain("native-goal-unavailable");
	});

	it("allows objective-only create_goal payloads", () => {
		expect(
			applyPreToolUseCreateGoalGuard({
				hook_event_name: "PreToolUse",
				tool_name: "create_goal",
				tool_input: { objective: "ship it" },
			}).kind,
		).toBe("noop");
	});

	it("ignores unrelated tools and malformed pre-tool payloads", () => {
		expect(
			applyPreToolUseCreateGoalGuard({
				hook_event_name: "PreToolUse",
				tool_name: "update_goal",
				tool_input: { status: "complete" },
			}).kind,
		).toBe("noop");
		expect(applyPreToolUseCreateGoalGuard({ hook_event_name: "UserPromptSubmit", tool_name: "create_goal" })).toEqual(
			{
				kind: "noop",
			},
		);
	});
});

describe("engine totality + determinism #given/#when/#then", () => {
	it("never throws on a fuzz corpus of arbitrary unknown values", () => {
		const corpus: unknown[] = [
			undefined,
			null,
			0,
			NaN,
			"",
			"lit",
			[],
			{},
			{ hook_event_name: 1 },
			{ hook_event_name: "UserPromptSubmit" },
			{ hook_event_name: "UserPromptSubmit", prompt: null },
			{ hookEventName: "UserPromptSubmit", prompt: "lit", transcript_path: 9 },
			Symbol("x"),
			() => 1,
		];
		for (const value of corpus) {
			expect(() => runUserPromptSubmitHook(value)).not.toThrow();
			const decision = runUserPromptSubmitHook(value);
			expect(decision.kind === "inject" || decision.kind === "noop").toBe(true);
		}
	});

	it("is deterministic: identical input yields identical stdout bytes", () => {
		const first = runUserPromptSubmitHook(upsSnake("lit"));
		const second = runUserPromptSubmitHook(upsSnake("lit"));
		expect(first).toEqual(second);
	});
});

describe("directive load is fail-silent #given/#when/#then", () => {
	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("./directive.js");
	});

	it("returns noop (never throws) when the directive loader throws", async () => {
		vi.resetModules();
		vi.doMock("./directive.js", () => ({
			loadLitLoopDirective: () => {
				throw new Error("LIT_LOOP_DIRECTIVE_UNREADABLE: simulated missing dist/directive.md");
			},
			LIT_LOOP_DIRECTIVE_MARKER: "<lit-loop-mode>",
		}));
		const mod = (await import("./codex-hook.js")) as typeof import("./codex-hook.js");
		let decision: HookDecision | undefined;
		expect(() => {
			decision = mod.runUserPromptSubmitHook(upsSnake("lit"));
		}).not.toThrow();
		expect(decision?.kind).toBe("noop");
	});
});
