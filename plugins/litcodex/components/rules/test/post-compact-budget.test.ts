import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveModelMetadata } from "../src/model-metadata.js";
import { withPostCompactBudget } from "../src/post-compact-budget.js";
import type { PiRulesConfig } from "../src/rules/types.js";

const tempDirectories: string[] = [];
const CONFIG: PiRulesConfig = {
	disabled: false,
	mode: "both",
	maxRuleChars: 30_000,
	maxResultChars: 50_000,
	postCompactMaxRuleChars: 12_000,
	postCompactMaxResultChars: 20_000,
	dynamicMaxRuleChars: 4_000,
	dynamicMaxResultChars: 10_000,
	promptMaxRuleChars: 6_000,
	promptMaxResultChars: 16_000,
	enabledSources: "auto",
};

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("post-compact context budget", () => {
	it("#given alias-only structured metadata #when public alias resolves #then uses the exact alias row", () => {
		expect(resolveModelMetadata("gpt-5.6", '{"models":[{"slug":"gpt-5.6","context_window":372000}]}')).toEqual({
			state: "available",
			metadata: { slug: "gpt-5.6", contextWindow: 372_000 },
		});
	});

	it("#given explicit-Sol-only structured metadata #when public alias resolves #then accepts it as alias evidence", () => {
		expect(resolveModelMetadata("gpt-5.6", '{"models":[{"slug":"gpt-5.6-sol","context_window":372000}]}')).toEqual({
			state: "available",
			metadata: { slug: "gpt-5.6", contextWindow: 372_000 },
		});
	});

	it.each([
		[
			"conflicting positive rows",
			'{"models":[{"slug":"gpt-5.6","context_window":372000},{"slug":"gpt-5.6-sol","context_window":400000}]}',
		],
		[
			"malformed alias with positive explicit Sol",
			'{"models":[{"slug":"gpt-5.6","context_window":"bad"},{"slug":"gpt-5.6-sol","context_window":372000}]}',
		],
		[
			"positive alias with malformed explicit Sol",
			'{"models":[{"slug":"gpt-5.6","context_window":372000},{"slug":"gpt-5.6-sol","context_window":0}]}',
		],
	])("#given %s #when public alias resolves #then fails closed", (_label, catalog) => {
		expect(resolveModelMetadata("gpt-5.6", catalog)).toEqual({ state: "unavailable", reason: "malformed-metadata" });
	});

	it("#given both equivalent positive rows #when public alias resolves #then prefers the exact alias row", () => {
		const catalog =
			'{"models":[{"slug":"gpt-5.6-sol","context_window":372000},{"slug":"gpt-5.6","context_window":372000}]}';
		expect(resolveModelMetadata("gpt-5.6", catalog)).toEqual({
			state: "available",
			metadata: { slug: "gpt-5.6", contextWindow: 372_000 },
		});
	});

	it.each([
		"openai/gpt-5.6-sol",
		"openai.gpt-5.6-terra",
	])("#given provider-qualified existing form %s #when resolved #then retains terminal-slug behavior", (model) => {
		const slug = model.endsWith("terra") ? "gpt-5.6-terra" : "gpt-5.6-sol";
		expect(resolveModelMetadata(model, `{"models":[{"slug":"${slug}","context_window":372000}]}`)).toEqual({
			state: "available",
			metadata: { slug, contextWindow: 372_000 },
		});
	});

	it("#given build-owned rules dist #when the focused suite starts #then generated metadata runtime enrolls the alias", () => {
		const built = readFileSync(new URL("../dist/model-metadata.js", import.meta.url), "utf8");
		expect(built).toContain('"gpt-5.6"');
	});
	it("#given malformed SOL metadata #when resolved #then it returns an explicit unavailable result", () => {
		// given / when
		const result = resolveModelMetadata("gpt-5.6-sol", '{"models":[{"slug":"gpt-5.6-sol"}]}');

		// then
		expect(result).toEqual({ state: "unavailable", reason: "malformed-metadata" });
	});

	it("#given a false-positive GPT-5.60 name #when resolved #then it is not classified as SOL or TERRA", () => {
		// given / when
		const result = resolveModelMetadata("gpt-5.60", '{"models":[]}');

		// then
		expect(result).toEqual({ state: "unavailable", reason: "model-not-found" });
	});

	it("#given known model near its context window #when resolving post-compact budget #then shrinks projected rule injection", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(760_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.5", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given unknown model near its context window #when resolving post-compact budget #then shrinks projected rule injection conservatively", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(760_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "unknown-model", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given known roomy model #when resolving post-compact budget #then keeps configured post-compact cap", () => {
		// given
		const transcriptPath = writeCompactedTranscript("small compacted summary");

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "openai.gpt-5.5", transcriptPath });

		// then
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
	});

	it("#given pure GPT-5.4 model near the fallback context window #when resolving post-compact budget #then treats it as non-preset metadata", () => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(600_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.4", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given context pressure marker after compaction #when resolving post-compact budget #then shrinks projected rule injection", () => {
		// given
		const transcriptPath = writeCompactedPressureTranscript("small compacted summary");

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.5", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it("#given Codex canonical context-window marker after compaction #when resolving post-compact budget #then shrinks projected rule injection", () => {
		// given
		const transcriptPath = writeCompactedCodexContextWindowTranscript("small compacted summary");

		// when
		const budget = withPostCompactBudget(CONFIG, { model: "gpt-5.5", transcriptPath });

		// then
		expect(budget.maxResultChars).toBeLessThan(1_000);
		expect(budget.maxRuleChars).toBeLessThanOrEqual(budget.maxResultChars);
	});

	it.each([
		"gpt-5.6",
		"gpt-5.6-sol",
		"gpt-5.6-terra",
		"openai/gpt-5.6-sol",
	])("#given %s without authoritative metadata #when resolving post-compact budget #then uses only the minimum guide", (model) => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(100_000));

		// when
		const budget = withPostCompactBudget(CONFIG, { model, transcriptPath, modelMetadata: null });

		// then
		expect(budget.maxResultChars).toBe(500);
		expect(budget.maxRuleChars).toBe(500);
	});

	it.each([
		"gpt-5.6",
		"gpt-5.6-sol",
		"gpt-5.6-terra",
		"openai/gpt-5.6-terra",
	])("#given %s with structured 372K metadata #when resolving post-compact budget #then avoids the legacy fallback", (model) => {
		// given
		const transcriptPath = writeCompactedTranscript("A".repeat(700_000));

		// when
		const budget = withPostCompactBudget(CONFIG, {
			model,
			transcriptPath,
			modelMetadata: {
				slug: model.endsWith("gpt-5.6-terra")
					? "gpt-5.6-terra"
					: model.endsWith("gpt-5.6-sol")
						? "gpt-5.6-sol"
						: "gpt-5.6",
				contextWindow: 372_000,
			},
		});

		// then
		expect(budget.maxResultChars).toBe(CONFIG.postCompactMaxResultChars);
		expect(budget.maxRuleChars).toBe(CONFIG.postCompactMaxRuleChars);
	});
});

function writeCompactedTranscript(retainedText: string): string {
	const root = mkdtempSync(path.join(tmpdir(), "post-compact-budget-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript.jsonl");
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

function writeCompactedPressureTranscript(retainedText: string): string {
	const root = mkdtempSync(path.join(tmpdir(), "post-compact-budget-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript-pressure.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "summary",
					replacement_history: [{ type: "message", role: "user", content: retainedText }],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: {
						error: {
							code: "context_too_large",
							message:
								"Your input exceeds the context window of this model. Please adjust your input and try again.",
						},
					},
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}

function writeCompactedCodexContextWindowTranscript(retainedText: string): string {
	const root = mkdtempSync(path.join(tmpdir(), "post-compact-budget-"));
	tempDirectories.push(root);
	const transcriptPath = path.join(root, "transcript-codex-context-window.jsonl");
	writeFileSync(
		transcriptPath,
		[
			JSON.stringify({
				type: "compacted",
				payload: {
					message: "summary",
					replacement_history: [{ type: "message", role: "user", content: retainedText }],
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content: {
						error: {
							code: "context_length_exceeded",
						},
					},
				},
			}),
			JSON.stringify({
				type: "message",
				payload: {
					content:
						"Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
				},
			}),
			"",
		].join("\n"),
	);
	return transcriptPath;
}
