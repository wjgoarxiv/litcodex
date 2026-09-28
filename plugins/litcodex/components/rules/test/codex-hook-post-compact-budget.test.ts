import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	type CodexPostCompactInput,
	type CodexSessionStartInput,
	runPostCompactHook,
	runSessionStartHook,
	runUserPromptSubmitHook,
} from "../src/codex-hook.js";

const tempDirectories: string[] = [];
const PROJECT_RULES_ENV = {
	CODEX_RULES_ENABLED_SOURCES: "CONTEXT.md,.litcodex/rules",
	CODEX_RULES_MAX_RESULT_CHARS: "50000",
	CODEX_RULES_MAX_RULE_CHARS: "30000",
	CODEX_HOME: "/nonexistent-codex-home",
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("codex rules post-compaction context budget", () => {
	it("#given a mandatory recovery directive cannot fit the result budget #when static recovery runs #then it emits no context and does not mark the rule as emitted", async () => {
		// given
		const { root, pluginData } = makeOversizedProject();
		await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});
		const transcriptPath = writeCompactedTranscript(root, "summary dropped injected rules");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: {
				...PROJECT_RULES_ENV,
				CODEX_RULES_MAX_RESULT_CHARS: "1",
				CODEX_RULES_MAX_RULE_CHARS: "1",
			},
		});

		// then
		expect(output).toBe("");
		expect(readSessionCache(pluginData).staticDedup).toHaveLength(0);
	});

	it("#given recovery emits no context because of its budget #when a later event has enough budget #then it retries the pending recovery", async () => {
		// given
		const { root, pluginData } = makeOversizedProject();
		await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});
		const transcriptPath = writeCompactedTranscript(root, "summary dropped injected rules");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const blockedOutput = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: {
				...PROJECT_RULES_ENV,
				CODEX_RULES_MAX_RESULT_CHARS: "1",
				CODEX_RULES_MAX_RULE_CHARS: "1",
			},
		});
		const blockedState = readSessionCache(pluginData);
		const adequateOutput = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});

		// then
		expect(blockedOutput).toBe("");
		expect(blockedState.postCompactPending?.static).toBe(true);
		expect(readAdditionalContext(adequateOutput)).toContain("MUST READ");
	});

	it("#given oversized project rules already injected #when static recovery runs after compaction #then it emits a mandatory read directive instead of rule bodies", async () => {
		// given
		const { root, pluginData } = makeOversizedProject();
		const firstOutput = await runSessionStartHook(sessionStartInput(root), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});
		const firstContext = readAdditionalContext(firstOutput);
		const transcriptPath = writeCompactedTranscript(root, "summary dropped injected rules");
		await runPostCompactHook(
			{ ...postCompactInput(root), transcript_path: transcriptPath },
			{ pluginDataRoot: pluginData },
		);

		// when
		const output = await runUserPromptSubmitHook(userPromptSubmitInput(root, transcriptPath), {
			pluginDataRoot: pluginData,
			env: PROJECT_RULES_ENV,
		});

		// then
		expect(firstContext).toContain(`Instructions from: ${path.join(root, "CONTEXT.md")}`);
		expect(firstContext).toContain("Project rule");
		expect(firstContext).toContain("[Truncated. Full:");
		expect(firstContext.length).toBeLessThan(31_000);
		const recoveryContext = readAdditionalContext(output);
		expect(recoveryContext).toContain("MUST READ");
		expect(recoveryContext).toContain("NO EXCUSES");
		expect(recoveryContext).toContain(path.join(root, "CONTEXT.md"));
		expect(recoveryContext).not.toContain("Project rule");
		expect(recoveryContext.length).toBeLessThan(2_000);
	});
});

function makeOversizedProject(): { root: string; pluginData: string } {
	const root = mkdtempSync(path.join(tmpdir(), "codex-rules-post-compact-budget-project-"));
	const pluginData = mkdtempSync(path.join(tmpdir(), "codex-rules-post-compact-budget-data-"));
	tempDirectories.push(root, pluginData);
	writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(path.join(root, "AGENTS.md"), "Project AGENTS.md should stay Codex-native.");
	writeFileSync(path.join(root, "CLAUDE.md"), "Project CLAUDE.md should stay outside rules hook context.");
	writeFileSync(path.join(root, "CONTEXT.md"), `Project rule\n${"A".repeat(30_000)}`);
	mkdirSync(path.join(root, ".litcodex", "rules"), { recursive: true });
	writeFileSync(
		path.join(root, ".litcodex", "rules", "typescript.md"),
		["---", 'globs: "**/*.ts"', "---", "", `TypeScript rule\n${"B".repeat(30_000)}`].join("\n"),
	);
	return { root, pluginData };
}

function sessionStartInput(root: string): CodexSessionStartInput {
	return {
		session_id: "session-post-compact-budget",
		transcript_path: null,
		cwd: root,
		hook_event_name: "SessionStart",
		model: "gpt-5.5",
		permission_mode: "default",
		source: "startup",
	};
}

function postCompactInput(root: string): CodexPostCompactInput {
	return {
		session_id: "session-post-compact-budget",
		turn_id: "turn-compact",
		transcript_path: null,
		cwd: root,
		hook_event_name: "PostCompact",
		model: "gpt-5.5",
		trigger: "auto",
	};
}

function userPromptSubmitInput(root: string, transcriptPath: string): Parameters<typeof runUserPromptSubmitHook>[0] {
	return {
		session_id: "session-post-compact-budget",
		turn_id: "turn-after-compact",
		transcript_path: transcriptPath,
		cwd: root,
		hook_event_name: "UserPromptSubmit",
		model: "gpt-5.5",
		permission_mode: "default",
		prompt: "continue",
	};
}

function writeCompactedTranscript(root: string, retainedText: string): string {
	const transcriptPath = path.join(root, "transcript-compacted.jsonl");
	writeFileSync(
		transcriptPath,
		`${JSON.stringify({
			type: "compacted",
			payload: {
				message: "summary",
				replacement_history: [{ type: "message", role: "user", content: retainedText }],
			},
		})}\n`,
	);
	return transcriptPath;
}

function readAdditionalContext(output: string): string {
	expect(output.trim().length).toBeGreaterThan(0);
	const parsed: unknown = JSON.parse(output);
	if (!isRecord(parsed)) return "";
	const hookSpecificOutput = parsed["hookSpecificOutput"];
	if (!isRecord(hookSpecificOutput)) return "";
	const additionalContext = hookSpecificOutput["additionalContext"];
	return typeof additionalContext === "string" ? additionalContext : "";
}

function readSessionCache(pluginData: string): {
	staticDedup: string[];
	postCompactPending?: { static?: boolean };
} {
	return JSON.parse(readFileSync(path.join(pluginData, "sessions", "session-post-compact-budget.json"), "utf8")) as {
		staticDedup: string[];
		postCompactPending?: { static?: boolean };
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
