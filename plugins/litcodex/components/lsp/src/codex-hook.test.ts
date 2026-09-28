import { describe, expect, it } from "vitest";

import {
	parsePostCompactPayload,
	parsePostToolUsePayload,
	runPostCompactHook,
	runPostToolUseHook,
} from "./codex-hook.js";

describe("lsp hook (inert placeholder)", () => {
	it("#given a PostToolUse edit payload #when the hook runs #then it parses and emits nothing", () => {
		const payload = parsePostToolUsePayload(
			JSON.stringify({
				hook_event_name: "PostToolUse",
				session_id: "s1",
				cwd: "/repo",
				tool_name: "apply_patch",
				tool_input: { path: "a.ts" },
			}),
		);
		if (payload === null) throw new Error("expected a valid PostToolUse payload");
		expect(runPostToolUseHook(payload)).toBe("");
	});

	it("#given a PostCompact payload #when the hook runs #then it parses and emits nothing", () => {
		const payload = parsePostCompactPayload(
			JSON.stringify({ hook_event_name: "PostCompact", session_id: "s1", trigger: "manual" }),
		);
		if (payload === null) throw new Error("expected a valid PostCompact payload");
		expect(runPostCompactHook(payload)).toBe("");
	});

	it("#given malformed / wrong-event input #when parsed #then it returns null (no throw)", () => {
		expect(parsePostToolUsePayload("")).toBeNull();
		expect(parsePostToolUsePayload("{not json")).toBeNull();
		expect(parsePostToolUsePayload(JSON.stringify({ hook_event_name: "SessionStart" }))).toBeNull();
		expect(parsePostCompactPayload(JSON.stringify({ hook_event_name: "PostToolUse" }))).toBeNull();
	});
});
