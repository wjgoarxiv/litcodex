import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { runSessionStartHook, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { formatAdditionalContextOutput } from "../src/hook-output.js";

type HookOutput = {
	readonly hookSpecificOutput?: {
		readonly additionalContext?: string;
	};
};

function parseAdditionalContext(output: string): string {
	expect(output.trim().length).toBeGreaterThan(0);
	const parsed = parseHookOutput(JSON.parse(output));
	return parsed.hookSpecificOutput?.additionalContext ?? "";
}

function parseHookOutput(value: unknown): HookOutput {
	if (typeof value !== "object" || value === null) {
		return {};
	}
	const record = value;
	if (!("hookSpecificOutput" in record)) {
		return {};
	}
	const hookSpecificOutput = record.hookSpecificOutput;
	if (typeof hookSpecificOutput !== "object" || hookSpecificOutput === null) {
		return {};
	}
	if (!("additionalContext" in hookSpecificOutput)) {
		return { hookSpecificOutput: {} };
	}
	const additionalContext = hookSpecificOutput.additionalContext;
	if (typeof additionalContext !== "string") {
		return { hookSpecificOutput: {} };
	}
	return {
		hookSpecificOutput: {
			additionalContext,
		},
	};
}

const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-shell-awareness-litcodex-bin-"));
const litcodexOnPathDir = join(fixtureRoot, "path-bin");
const emptyHomeDir = join(fixtureRoot, "empty-home");
const localBinHomeDir = join(fixtureRoot, "local-bin-home");
mkdirSync(litcodexOnPathDir, { recursive: true });
mkdirSync(emptyHomeDir, { recursive: true });
mkdirSync(join(localBinHomeDir, ".local", "bin"), { recursive: true });
writeFileSync(join(litcodexOnPathDir, "litcodex"), "#!/bin/sh\n");
writeFileSync(join(localBinHomeDir, ".local", "bin", "litcodex"), "#!/bin/sh\n");

const componentRoot = fileURLToPath(new URL("..", import.meta.url));

describe("Codex Shell awareness", () => {
	afterAll(() => {
		rmSync(fixtureRoot, { recursive: true, force: true });
	});

	it("#given active Codex app server env with litcodex on PATH #when SessionStart runs #then emits Shell guidance", async () => {
		// given
		const env = {
			CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
			CODEX_SHELL: "1",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
			PATH: litcodexOnPathDir,
			HOME: emptyHomeDir,
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-active",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		expect(parseAdditionalContext(output)).toContain("litcodex shell <command>");
		expect(parseAdditionalContext(output)).toContain("LITCODEX_SHELL_SESSION_CONTEXT");
		expect(parseAdditionalContext(output)).toContain("LITCODEX_SHELL_CONDENSE");
		expect(parseAdditionalContext(output)).toContain("LITCODEX_SHELL_SPARK");
		expect(parseAdditionalContext(output)).toContain("[shell caption]");
		expect(parseAdditionalContext(output)).not.toContain("[REDACTED]");
	});

	it("#given inactive env #when SessionStart runs #then emits no Shell guidance", async () => {
		// given
		const env = {
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-inactive",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		expect(output).toBe("");
	});

	it("#given Codex CLI appserver socket env #when SessionStart runs #then emits Shell guidance", async () => {
		// given
		const env = {
			LITCODEX_SHELL_APP_SERVER_SOCKET: "/tmp/app-server-control.sock",
			CODEX_THREAD_ID: "thread-shell-cli",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
			PATH: litcodexOnPathDir,
			HOME: emptyHomeDir,
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-cli-wrapper",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		expect(parseAdditionalContext(output)).toContain("litcodex shell <command>");
	});

	it("#given active Codex app env without a resolvable litcodex command #when SessionStart runs #then emits no Shell guidance", async () => {
		// given
		const env = {
			CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
			CODEX_SHELL: "1",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
			PATH: join(fixtureRoot, "missing-path-entry"),
			HOME: emptyHomeDir,
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-unresolvable",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		expect(output).toBe("");
	});

	it("#given litcodex only under HOME/.local/bin #when SessionStart runs #then emits guidance with the absolute litcodex path", async () => {
		// given
		const env = {
			CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
			CODEX_SHELL: "1",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
			PATH: join(fixtureRoot, "missing-path-entry"),
			HOME: localBinHomeDir,
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-local-bin",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		const context = parseAdditionalContext(output);
		expect(context).toContain(`${join(localBinHomeDir, ".local", "bin", "litcodex")} shell <command>`);
		expect(context).not.toContain("`litcodex shell <command>`");
	});

	it("#given explicit force-on env #when SessionStart runs #then emits Shell guidance", async () => {
		// given
		const env = {
			LITCODEX_SHELL_AWARENESS: "1",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-force-on",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		expect(parseAdditionalContext(output)).toContain("litcodex shell <command>");
	});

	it("#given explicit force-off env with active Codex app context #when SessionStart runs #then emits no Shell guidance", async () => {
		// given
		const env = {
			LITCODEX_SHELL_AWARENESS: "0",
			CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
			CODEX_SHELL: "1",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
		};

		// when
		const output = await runSessionStartHook(
			{
				session_id: "session-shell-force-off",
				transcript_path: null,
				cwd: componentRoot,
				hook_event_name: "SessionStart",
				model: "gpt-5.5",
				permission_mode: "default",
				source: "startup",
			},
			{ env },
		);

		// then
		expect(output).toBe("");
	});

	it("#given Shell awareness already emitted for a session #when UserPromptSubmit runs #then emits no duplicate guidance", async () => {
		// given
		const pluginDataRoot = mkdtempSync(join(tmpdir(), "codex-shell-awareness-"));
		const env = {
			CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Desktop",
			CODEX_SHELL: "1",
			CODEX_RULES_ENABLED_SOURCES: ".litcodex/rules",
			CODEX_HOME: "/nonexistent-codex-home",
			PATH: litcodexOnPathDir,
			HOME: emptyHomeDir,
		};
		try {
			const firstOutput = await runSessionStartHook(
				{
					session_id: "session-shell-dedupe",
					transcript_path: null,
					cwd: componentRoot,
					hook_event_name: "SessionStart",
					model: "gpt-5.5",
					permission_mode: "default",
					source: "startup",
				},
				{ env, pluginDataRoot },
			);
			expect(parseAdditionalContext(firstOutput)).toContain("litcodex shell <command>");

			// when
			const secondOutput = await runUserPromptSubmitHook(
				{
					session_id: "session-shell-dedupe",
					turn_id: "turn-1",
					transcript_path: null,
					cwd: componentRoot,
					hook_event_name: "UserPromptSubmit",
					model: "gpt-5.5",
					permission_mode: "default",
					prompt: "continue",
				},
				{ env, pluginDataRoot },
			);

			// then
			expect(secondOutput).toBe("");
		} finally {
			rmSync(pluginDataRoot, { recursive: true, force: true });
		}
	});

	it("#given explicit force-on env #when hook output is formatted #then awareness remains valid hook JSON", () => {
		// given
		const context = ["## Shell Runtime", "", "- Prefer `litcodex shell <command>` for shell-native inspection."].join(
			"\n",
		);

		// when
		const output = formatAdditionalContextOutput("SessionStart", context);

		// then
		expect(parseAdditionalContext(output)).toContain("## Shell Runtime");
	});
});
