// The start-work PreToolUse guard: while this session owns a run, a direct tool call on a secret or a Codex
// setting is denied, and a session whose run was cancelled elsewhere is told to stop. Everything else is silent.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "../src/codex-hook.js";
import { runPreToolUseHook } from "../src/pre-tool-hook.js";
import { cleanupProjects, type Project, project, promptInput, startRun } from "./autopilot-fixture.js";

afterEach(cleanupProjects);

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const call = (cwd: string, tool: string, toolInput: unknown, session = "s1") => ({
	hook_event_name: "PreToolUse",
	session_id: session,
	turn_id: "t1",
	cwd,
	tool_name: tool,
	tool_input: toolInput,
	tool_use_id: "u1",
	transcript_path: null,
	model: "m",
	permission_mode: "default",
});

const guard = (p: Project, tool: string, toolInput: unknown, session = "s1") =>
	runPreToolUseHook(call(p.root, tool, toolInput, session), p.options);

function denial(out: string): string {
	expect(out.endsWith("\n")).toBe(true);
	const parsed = JSON.parse(out) as { hookSpecificOutput: Record<string, string> };
	expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
	expect(Object.keys(parsed.hookSpecificOutput).sort()).toEqual([
		"additionalContext",
		"hookEventName",
		"permissionDecision",
		"permissionDecisionReason",
	]);
	expect(parsed.hookSpecificOutput["hookEventName"]).toBe("PreToolUse");
	expect(parsed.hookSpecificOutput["permissionDecision"]).toBe("deny");
	expect(parsed.hookSpecificOutput["additionalContext"]).toBe(parsed.hookSpecificOutput["permissionDecisionReason"]);
	return parsed.hookSpecificOutput["permissionDecisionReason"] ?? "";
}

const patch = (header: string) => `*** Begin Patch\n*** ${header}\n+x\n*** End Patch\n`;

describe("start-work PreToolUse guard", () => {
	it("29. Bash words naming a secret are denied; a $HOME expansion is not expanded", () => {
		const p = project();
		startRun(p);
		mkdirSync(join(p.root, "x"), { recursive: true });
		for (const command of ["cat ~/.ssh/config", "cat .env", "cd x && cat .env"]) {
			const reason = denial(guard(p, "Bash", { command }));
			expect(reason).toContain("LitCodex start-work refused this call");
			expect(reason).toContain("`lit approve` included");
		}
		expect(guard(p, "Bash", { command: 'cat "$HOME"/.ssh/config' })).toBe("");
	});

	it("30. apply_patch headers, edit-tool path fields and bare key names are checked", () => {
		const p = project();
		startRun(p);
		denial(guard(p, "apply_patch", { input: patch("Update File: .git/config") }));
		denial(guard(p, "apply_patch", patch("Add File: .env")));
		expect(guard(p, "apply_patch", { input: patch("Update File: src/a.ts") })).toBe("");
		denial(guard(p, "Write", { file_path: ".env" }));
		denial(guard(p, "edit", { path: ".env" }));
		denial(guard(p, "mcp__filesystem__write_file", { path: join(p.real, ".env") }));
		denial(guard(p, "Bash", { command: "cat server.pem" }));
		denial(guard(p, "Bash", { cmd: "cat id_ed25519" }));
		expect(guard(p, "Write", { file_path: "src/a.ts" })).toBe("");
		expect(guard(p, "Bash", { command: "cat README.md" })).toBe("");
	});

	it("31. no state, another session and a finished run are silent", () => {
		const none = project();
		expect(guard(none, "Bash", { command: "cat .env" })).toBe("");
		const p = project();
		startRun(p);
		expect(guard(p, "Bash", { command: "cat .env" }, "s2")).toBe("");
		runUserPromptSubmitHook(promptInput(p.root, "lit cancel"), p.options);
		expect(guard(p, "Bash", { command: "cat .env" })).toBe("");
	});

	it("32. a session holding a cancel notice is told to stop on any call", () => {
		const p = project();
		startRun(p);
		runUserPromptSubmitHook(promptInput(p.root, "lit cancel", "s2"), p.options);
		const reason = denial(guard(p, "Bash", { command: "ls" }));
		expect(reason).toContain("was ended by `lit cancel` from another Codex session");
	});

	it("33. the CLI stays silent with exit 0 on malformed or foreign input", () => {
		const p = project();
		startRun(p);
		for (const input of [
			"{not json",
			JSON.stringify({ ...call(p.root, "Bash", { command: "cat .env" }), cwd: undefined }),
			JSON.stringify({ ...call(p.root, "Bash", { command: "cat .env" }), hook_event_name: "PostToolUse" }),
		]) {
			const run = spawnSync(execPath, [CLI_PATH, "hook", "pre-tool-use"], {
				input,
				encoding: "utf8",
				env: { ...process.env, ...p.env },
			});
			expect([run.status, run.stdout, run.stderr]).toEqual([0, "", ""]);
		}
		const run = spawnSync(execPath, [CLI_PATH, "hook", "pre-tool-use"], {
			input: JSON.stringify(call(p.root, "Bash", { command: "cat .env" })),
			encoding: "utf8",
			env: { ...process.env, ...p.env },
		});
		expect(run.status).toBe(0);
		denial(run.stdout);
	});
});
