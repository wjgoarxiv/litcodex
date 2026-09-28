import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { formatAdditionalContextOutput } from "../src/hook-output.js";
import { loadOutputStyleText } from "../src/output-style-injection.js";

describe("formatAdditionalContextOutput", () => {
	it("#given context with outer whitespace and CRLF #when serializing hook JSON #then additional context is newline-normalized", () => {
		// given
		const context = "\r\n\r\nFirst line\r\nSecond line\rThird line\r\n";

		// when
		const output = formatAdditionalContextOutput("PostToolUse", context);
		const parsed: unknown = JSON.parse(output);

		// then
		expect(readAdditionalContext(parsed)).toBe("First line\nSecond line\nThird line");
		expect(output.endsWith("\n")).toBe(true);
	});

	it("#given blank context #when serializing hook JSON #then it emits no hook output", () => {
		// given
		const context = "\r\n \n";

		// when
		const output = formatAdditionalContextOutput("SessionStart", context);

		// then
		expect(output).toBe("");
	});

	it("#given oversized context #when serializing hook JSON #then it keeps additional context under the safety cap", () => {
		// given
		const context = `first\n${"x".repeat(50_000)}\nlast`;

		// when
		const output = formatAdditionalContextOutput("SessionStart", context);
		const parsed: unknown = JSON.parse(output);
		const additionalContext = readAdditionalContext(parsed);

		// then
		expect(additionalContext.length).toBeLessThanOrEqual(32_000);
		expect(additionalContext).toContain("first");
		expect(additionalContext).not.toContain("last");
		expect(additionalContext).toContain("[Truncated hook additional context to 32000 chars");
	});
});

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCodexHome(styleId: string): { env: NodeJS.ProcessEnv; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "hook-output-style-"));
	tempDirs.push(dir);
	writeFileSync(join(dir, "config.toml"), `litcodex_output_style = "${styleId}"\n`);
	return { env: { CODEX_HOME: dir }, dir };
}

describe("output-style injection in hook output", () => {
	it("#given style asd-ste100 #when loadOutputStyleText #then style text is non-empty and appears in formatAdditionalContextOutput", () => {
		const { env } = makeCodexHome("asd-ste100");

		const styleText = loadOutputStyleText(env);
		expect(styleText.length).toBeGreaterThan(0);
		expect(styleText).toContain("ASD-STE100");

		const output = formatAdditionalContextOutput("SessionStart", styleText);
		const parsed: unknown = JSON.parse(output);
		expect(readAdditionalContext(parsed)).toContain("ASD-STE100");
	});

	it("#given style off #when loadOutputStyleText #then result is empty and formatAdditionalContextOutput emits nothing", () => {
		const { env } = makeCodexHome("off");

		const styleText = loadOutputStyleText(env);
		expect(styleText).toBe("");

		const output = formatAdditionalContextOutput("SessionStart", styleText);
		expect(output).toBe("");
	});

	it("#given no CODEX_HOME config #when loadOutputStyleText #then result is empty", () => {
		const styleText = loadOutputStyleText({ CODEX_HOME: "/nonexistent-path-that-does-not-exist" });
		expect(styleText).toBe("");
	});
});

function readAdditionalContext(value: unknown): string {
	if (!isRecord(value)) throw new TypeError("Expected hook output object");
	const hookSpecificOutput = value["hookSpecificOutput"];
	if (!isRecord(hookSpecificOutput)) throw new TypeError("Expected hookSpecificOutput object");
	const additionalContext = hookSpecificOutput["additionalContext"];
	if (typeof additionalContext !== "string") throw new TypeError("Expected additionalContext string");
	return additionalContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
