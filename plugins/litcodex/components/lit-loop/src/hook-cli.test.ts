// src/hook-cli.test.ts — M06/T11 process-adapter suite.
//
// Drives runUserPromptSubmitHookCli with in-memory streams (PassThrough stdin, capturing writable
// stdout/stderr). Asserts the exit map: activation/no-op → 0 (no-op writes zero bytes); unparseable
// stdin → exit 2 + LIT_HOOK_STDIN_INVALID_JSON; oversized stdin → exit 2 + LIT_HOOK_STDIN_TOO_LARGE;
// empty/whitespace/BOM-only → exit 0 silent; BOM-prefixed valid event activates.

import { spawnSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_STDIN_BYTES, runPreToolUseCreateGoalGuardCli, runUserPromptSubmitHookCli } from "./hook-cli.js";

interface Capture {
	stdout: () => string;
	stderr: () => string;
	stdoutBytes: () => number;
}

function captureStreams(): { out: Writable; err: Writable } & Capture {
	const outChunks: Buffer[] = [];
	const errChunks: Buffer[] = [];
	const out = new Writable({
		write(chunk, _enc, cb) {
			outChunks.push(Buffer.from(chunk));
			cb();
		},
	});
	const err = new Writable({
		write(chunk, _enc, cb) {
			errChunks.push(Buffer.from(chunk));
			cb();
		},
	});
	return {
		out,
		err,
		stdout: () => Buffer.concat(outChunks).toString("utf8"),
		stderr: () => Buffer.concat(errChunks).toString("utf8"),
		stdoutBytes: () => Buffer.concat(outChunks).byteLength,
	};
}

async function run(stdinPayload: Buffer | string): Promise<{ code: number } & Capture> {
	const stdin = new PassThrough();
	const cap = captureStreams();
	const codePromise = runUserPromptSubmitHookCli(stdin, cap.out, cap.err);
	stdin.end(typeof stdinPayload === "string" ? Buffer.from(stdinPayload, "utf8") : stdinPayload);
	const code = await codePromise;
	return { code, stdout: cap.stdout, stderr: cap.stderr, stdoutBytes: cap.stdoutBytes };
}

async function runPreToolUse(stdinPayload: Buffer | string): Promise<{ code: number } & Capture> {
	const stdin = new PassThrough();
	const cap = captureStreams();
	const codePromise = runPreToolUseCreateGoalGuardCli(stdin, cap.out, cap.err);
	stdin.end(typeof stdinPayload === "string" ? Buffer.from(stdinPayload, "utf8") : stdinPayload);
	const code = await codePromise;
	return { code, stdout: cap.stdout, stderr: cap.stderr, stdoutBytes: cap.stdoutBytes };
}

const SNAKE_LIT = '{"hook_event_name":"UserPromptSubmit","prompt":"lit"}';
const CAMEL_LIT = '{"hookEventName":"UserPromptSubmit","prompt":"lit"}';
const PUBLIC_BIN = fileURLToPath(new URL("../../../../../packages/litcodex-ai/bin/litcodex.js", import.meta.url));

function runPublicHook(payload: unknown): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [PUBLIC_BIN, "hook", "user-prompt-submit"], {
		input: JSON.stringify(payload),
		encoding: "utf8",
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const LITRESEARCH_ACTIVATE_PROMPTS = [
	"/litresearch",
	"/litresearch current dir",
	"/litresearch 현재 디렉터리",
	"litresearch current dir",
	"lit research current dir",
] as const;
const LITRESEARCH_NOOP_PROMPTS = [
	"/litresearch/current",
	"/litresearcher",
	"/lit research",
	"/tmp/litresearch",
	"https://example.com/litresearch",
	"file:///tmp/litresearch",
	"/litresearch-current",
	"/litresearch?scope=current",
	"/litresearch#current",
] as const;
const LITRESEARCH_INERT_PAYLOADS = [
	{
		hook_event_name: "UserPromptSubmit",
		prompt: "inspect this payload",
		tool_input: { prompt: "/litresearch" },
	},
	{
		hook_event_name: "PreToolUse",
		prompt: "inspect this payload",
		tool_input: { prompt: "/litresearch" },
	},
	{
		hook_event_name: "UserPromptSubmit",
		prompt: JSON.stringify({ prompt: "/litresearch" }),
	},
	{
		hook_event_name: "UserPromptSubmit",
		prompt: "inspect this transcript",
		transcript: [{ role: "user", content: "/litresearch" }],
	},
	{
		hook_event_name: "UserPromptSubmit",
		prompt: "inspect this transcript",
		transcript_path: "/tmp/litresearch.jsonl",
	},
] as const;

describe("runUserPromptSubmitHookCli activation #given/#when/#then", () => {
	it("activates on a snake_case lit event → exit 0, one camelCase JSON line + newline", async () => {
		const r = await run(SNAKE_LIT);
		expect(r.code).toBe(0);
		expect(r.stderr()).toBe("");
		const text = r.stdout();
		expect(text.endsWith("\n")).toBe(true);
		expect(text.trimEnd().split("\n")).toHaveLength(1);
		const parsed = JSON.parse(text) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
		expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(parsed.hookSpecificOutput.additionalContext).toContain("<lit-loop-mode>");
	});

	it("activates on a camelCase INPUT event (dual-accept) and emits camelCase output", async () => {
		const r = await run(CAMEL_LIT);
		expect(r.code).toBe(0);
		const text = r.stdout();
		expect(text).toContain('"hookEventName"');
		expect(text).not.toContain('"hook_event_name"');
		expect(JSON.parse(text).hookSpecificOutput.additionalContext).toContain("<lit-loop-mode>");
	});

	it.each(LITRESEARCH_ACTIVATE_PROMPTS)("activates the exact research route form: %s", async (prompt) => {
		const r = await run(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }));
		expect(r.code).toBe(0);
		expect(r.stderr()).toBe("");
		expect(JSON.parse(r.stdout()).hookSpecificOutput.additionalContext).toContain("<litresearch-mode>");
	});
});

describe("runUserPromptSubmitHookCli no-op branches #given/#when/#then", () => {
	it("no-op on a split substring collision → exit 0, ZERO bytes on stdout", async () => {
		const r = await run('{"hook_event_name":"UserPromptSubmit","prompt":"please split this"}');
		expect(r.code).toBe(0);
		expect(r.stdoutBytes()).toBe(0);
		expect(r.stderr()).toBe("");
	});

	it("no-op on a valid-JSON wrong-shape array → exit 0, empty stdout (NOT an error)", async () => {
		const r = await run("[1,2,3]");
		expect(r.code).toBe(0);
		expect(r.stdoutBytes()).toBe(0);
	});

	it("no-op on json null → exit 0", async () => {
		const r = await run("null");
		expect(r.code).toBe(0);
		expect(r.stdoutBytes()).toBe(0);
	});

	it("no-op on empty stdin → exit 0, empty stdout AND stderr", async () => {
		const r = await run("");
		expect(r.code).toBe(0);
		expect(r.stdoutBytes()).toBe(0);
		expect(r.stderr()).toBe("");
	});

	it("no-op on whitespace-only stdin → exit 0", async () => {
		const r = await run("   \n\t ");
		expect(r.code).toBe(0);
		expect(r.stdoutBytes()).toBe(0);
	});

	it.each(LITRESEARCH_NOOP_PROMPTS)("no-op on a slash research near miss or path: %s", async (prompt) => {
		const r = await run(JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }));
		expect(r).toMatchObject({ code: 0 });
		expect(r.stdout()).toBe("");
		expect(r.stderr()).toBe("");
	});

	it.each(
		LITRESEARCH_INERT_PAYLOADS,
	)("does not activate on research text in inert JSON or transcript fields: %#", async (payload) => {
		const r = await run(JSON.stringify(payload));
		expect(r).toMatchObject({ code: 0 });
		expect(r.stdout()).toBe("");
		expect(r.stderr()).toBe("");
	});
});

describe("public litcodex hook user-prompt-submit litresearch route", () => {
	it("emits the exact research output only for slash exact-token forms and preserves bare forms", () => {
		const expected = runPublicHook({ hook_event_name: "UserPromptSubmit", prompt: LITRESEARCH_ACTIVATE_PROMPTS[0] });
		expect(expected.status).toBe(0);
		expect(expected.stderr).toBe("");
		expect(expected.stdout).toContain("<litresearch-mode>");

		for (const prompt of LITRESEARCH_ACTIVATE_PROMPTS) {
			expect(runPublicHook({ hook_event_name: "UserPromptSubmit", prompt })).toEqual(expected);
		}
	});

	it.each(
		LITRESEARCH_NOOP_PROMPTS,
	)("writes exactly zero stdout bytes for slash near misses and path occurrences: %s", (prompt) => {
		expect(runPublicHook({ hook_event_name: "UserPromptSubmit", prompt })).toEqual({
			status: 0,
			stdout: "",
			stderr: "",
		});
	});

	it.each(
		LITRESEARCH_INERT_PAYLOADS,
	)("writes exactly zero stdout bytes for inert payload occurrences: %#", (payload) => {
		expect(runPublicHook(payload)).toEqual({ status: 0, stdout: "", stderr: "" });
	});
});

describe("runUserPromptSubmitHookCli malformed input #given/#when/#then", () => {
	it("exit 2 + LIT_HOOK_STDIN_INVALID_JSON on unparseable stdin; stdout empty", async () => {
		const r = await run("{not valid json");
		expect(r.code).toBe(2);
		expect(r.stdoutBytes()).toBe(0);
		const err = JSON.parse(r.stderr()) as { ok: boolean; error: { code: string; message: string } };
		expect(err.ok).toBe(false);
		expect(err.error.code).toBe("LIT_HOOK_STDIN_INVALID_JSON");
		expect(typeof err.error.message).toBe("string");
	});

	it("exit 2 + LIT_HOOK_STDIN_TOO_LARGE on a single over-cap chunk; stdout empty", async () => {
		const oversized = Buffer.alloc(MAX_STDIN_BYTES + 1, 0x20); // spaces
		const r = await run(oversized);
		expect(r.code).toBe(2);
		expect(r.stdoutBytes()).toBe(0);
		const err = JSON.parse(r.stderr()) as { ok: boolean; error: { code: string; message: string } };
		expect(err.error.code).toBe("LIT_HOOK_STDIN_TOO_LARGE");
		expect(err.error.message).toContain(String(MAX_STDIN_BYTES));
	});

	it("accepts a payload exactly at the cap (boundary is inclusive-accept at ===)", async () => {
		const pad = " ".repeat(MAX_STDIN_BYTES - Buffer.byteLength(SNAKE_LIT));
		const payload = SNAKE_LIT + pad;
		expect(Buffer.byteLength(payload)).toBe(MAX_STDIN_BYTES);
		const r = await run(payload);
		expect(r.code).toBe(0);
		expect(r.stdout()).toContain("<lit-loop-mode>");
	});
});

describe("runUserPromptSubmitHookCli BOM ordering (A3 A4) #given/#when/#then", () => {
	it("strips a leading BOM before parse → BOM-prefixed valid event activates", async () => {
		const r = await run(`﻿${SNAKE_LIT}`);
		expect(r.code).toBe(0);
		expect(r.stdout()).toContain("<lit-loop-mode>");
	});

	it("BOM-only stdin is a no-op (strip → trim → empty), not invalid JSON", async () => {
		const r = await run("﻿");
		expect(r.code).toBe(0);
		expect(r.stdoutBytes()).toBe(0);
		expect(r.stderr()).toBe("");
	});

	it("double BOM is invalid JSON → exit 2 (only one BOM stripped)", async () => {
		const r = await run(`﻿﻿${SNAKE_LIT}`);
		expect(r.code).toBe(2);
		const err = JSON.parse(r.stderr()) as { error: { code: string } };
		expect(err.error.code).toBe("LIT_HOOK_STDIN_INVALID_JSON");
	});
});

describe("runUserPromptSubmitHookCli determinism #given/#when/#then", () => {
	it("yields the identical exit code + stdout bytes across repeated invocations", async () => {
		const first = await run(SNAKE_LIT);
		const second = await run(SNAKE_LIT);
		expect(first.code).toBe(second.code);
		expect(first.stdout()).toBe(second.stdout());
	});
});

describe("runPreToolUseCreateGoalGuardCli #given/#when/#then", () => {
	it("denies malformed create_goal payloads through the marketplace hook subcommand", async () => {
		const r = await runPreToolUse(
			JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "create_goal",
				tool_input: { objective: "ship it", token_budget: 1000 },
			}),
		);
		expect(r.code).toBe(0);
		expect(r.stderr()).toBe("");
		const parsed = JSON.parse(r.stdout()) as {
			hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };
		};
		expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("objective only");
	});

	it("allows objective-only create_goal payloads with zero stdout bytes", async () => {
		const r = await runPreToolUse(
			JSON.stringify({
				hook_event_name: "PreToolUse",
				tool_name: "create_goal",
				tool_input: { objective: "ship it" },
			}),
		);
		expect(r.code).toBe(0);
		expect(r.stderr()).toBe("");
		expect(r.stdoutBytes()).toBe(0);
	});

	it("reports invalid JSON with the shared malformed-stdin exit map", async () => {
		const r = await runPreToolUse("{not json");
		expect(r.code).toBe(2);
		expect(r.stdoutBytes()).toBe(0);
		expect(JSON.parse(r.stderr()).error.code).toBe("LIT_HOOK_STDIN_INVALID_JSON");
	});
});
