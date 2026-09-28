import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { type CodexSessionStartInput, runSessionStartHook } from "./codex-hook.js";

function sessionStart(): CodexSessionStartInput {
	return {
		session_id: "session-1",
		transcript_path: null,
		cwd: "/repo",
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

describe("runSessionStartHook (inert local stub)", () => {
	it("#given any SessionStart payload #when the hook runs #then it emits no output", async () => {
		expect(await runSessionStartHook(sessionStart())).toBe("");
		expect(await runSessionStartHook({ ...sessionStart(), source: "resume" })).toBe("");
		expect(await runSessionStartHook({ ...sessionStart(), source: "clear" })).toBe("");
	});

	it("#given the shipped source #when scanned #then there is NO network / telemetry machinery", () => {
		// Privacy guard: the stub must carry no network client, no telemetry SDK, and no remote
		// endpoint. Scanning the source bytes makes accidental re-introduction a test failure.
		const hookSrc = readFileSync(fileURLToPath(new URL("./codex-hook.ts", import.meta.url)), "utf8");
		const cliSrc = readFileSync(fileURLToPath(new URL("./cli.ts", import.meta.url)), "utf8");
		const blob = `${hookSrc}\n${cliSrc}`.toLowerCase();
		for (const forbidden of [
			"posthog",
			"fetch(",
			"http://",
			"https://",
			"node:http",
			"node:https",
			"node:net",
			"node:dgram",
		]) {
			expect(blob).not.toContain(forbidden);
		}
	});
});
