// src/codex-hook-ultra-brainstorm.test.ts — ultra-brainstorm routing (S2).
//
// A leading `ultra-brainstorm <topic>`, `lit ultra-brainstorm <topic>` or `$litcodex:ultra-brainstorm <topic>`
// names the installed ultra-brainstorm skill; the plain brainstorm route keeps its own words, and the
// route word anywhere later in a sentence stays inert.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type HookDecision, runUserPromptSubmitHook } from "./codex-hook.js";

const ups = (prompt: string): unknown => ({ hook_event_name: "UserPromptSubmit", prompt });

const contextOf = (decision: HookDecision): string => {
	if (decision.kind !== "inject") return "";
	return (JSON.parse(decision.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
		.additionalContext;
};

describe("ultra-brainstorm route", () => {
	it.each([
		"ultra-brainstorm names for the new CLI",
		"lit ultra-brainstorm names for the new CLI",
		"lit ultra brainstorm names for the new CLI",
		"$litcodex:ultra-brainstorm names for the new CLI",
		"LIT Ultra-Brainstorm names",
	])("routes %s to the ultra-brainstorm skill", (prompt) => {
		const decision = runUserPromptSubmitHook(ups(prompt));
		expect(decision.kind === "inject" && decision.mode).toBe("ultra-brainstorm");
		const context = contextOf(decision);
		expect(context).toContain("🔥 **LIT IGNITED · ultra-brainstorm** 🔥");
		expect(context).toMatch(/^skill ultra-brainstorm: \/\S+\/skills\/ultra-brainstorm\/SKILL\.md$/mu);
		expect(context).not.toContain("<lit-brainstorm-mode>");
	});

	it("leaves the plain brainstorm route and later mentions alone", () => {
		expect(runUserPromptSubmitHook(ups("lit brainstorm names for the new CLI"))).toMatchObject({
			mode: "lit-brainstorm",
		});
		expect(runUserPromptSubmitHook(ups("should I run ultra-brainstorm later?"))).toEqual({ kind: "noop" });
		expect(runUserPromptSubmitHook(ups("`ultra-brainstorm` is a skill name"))).toEqual({ kind: "noop" });
	});

	it("R5: prints the launch question's cost line as a range from measured per-agent costs", async () => {
		const script = fileURLToPath(new URL("../../../skills/ultra-brainstorm/scripts/estimate.mjs", import.meta.url));
		expect(execFileSync(process.execPath, [script, "100"], { encoding: "utf8" })).toBe(
			"100 idea agents (luna, low) + 4 reducers (terra, medium) + this session judging ≈ 4.0M–9.3M tokens\n",
		);
		expect(() => execFileSync(process.execPath, [script, "901"], { stdio: "pipe" })).toThrow();
		// The formula is pinned: every idea agent pays the host's ~31k first-turn prompt at least once.
		const { estimate } = (await import(script)) as {
			estimate: (n: number) => { reducers: number; low: number; high: number };
		};
		expect(estimate(300)).toEqual({
			agents: 300,
			reducers: 10,
			low: 300 * 35_000 + 10 * 110_000 + 100_000,
			high: 300 * 80_000 + 10 * 270_000 + 180_000,
		});
		expect(estimate(100).low).toBeGreaterThan(100 * 31_000);
	});
});

describe("ultra-brainstorm launch answer (R2, R6, R7)", () => {
	const skillDir = fileURLToPath(new URL("../../../skills/ultra-brainstorm/", import.meta.url));
	const script = `${skillDir}scripts/launch-answer.mjs`;
	const read = (reply: string): { action: string; agents?: number } =>
		JSON.parse(execFileSync(process.execPath, [script], { input: reply, encoding: "utf8" })) as {
			action: string;
			agents?: number;
		};

	it.each([
		["100", 100],
		["300", 300],
		["(Recommended) 100 (recommended minimum)", 100],
		["300명 (Recommended)", 300],
		["100 (recommended minimum)", 100],
		["250 agents", 250],
		["  42\n", 42],
	])("R6: reads the count from %j", (reply, agents) => {
		expect(read(reply)).toEqual({ action: "launch", agents });
	});

	it.each(["100 or 300?", "100? 300?", "maybe", "", "yes", "sure, go", "900000", "0"])(
		"R6: %j is not a count, so it asks again and launches nothing",
		(reply) => {
			expect(read(reply).action).toBe("ask-again");
		},
	);

	it.each(["no", "No.", "아니", "아니요", "stop", "cancel", "취소"])("R2: a plain %j ends it at once", (reply) => {
		expect(read(reply)).toEqual({ action: "stop" });
	});

	it("R7: a reply that looks like shell is inert data read from stdin; nothing runs", () => {
		const dir = mkdtempSync(join(tmpdir(), "ub-reply-"));
		try {
			const marker = join(dir, "x");
			const reply = `$(touch ${marker}) \`touch ${marker}\` 100`;
			execFileSync("/bin/sh", ["-c", `node "${script}" <<'LIT_REPLY_END_9Q7'\n${reply}\nLIT_REPLY_END_9Q7\n`], {
				cwd: dir,
				encoding: "utf8",
			});
			expect(existsSync(marker)).toBe(false);
			expect(read(reply).action).toBe("ask-again");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("R7: the argument form is gone; any argument is an error", () => {
		for (const args of [["--answer", "100"], ["100"], ["--answer=100"]]) {
			expect(() => execFileSync(process.execPath, [script, ...args], { input: "", stdio: "pipe" })).toThrow();
		}
	});

	it("R7: the skill passes the reply only through the quoted heredoc and refuses a reply holding its delimiter", () => {
		const skill = readFileSync(`${skillDir}SKILL.md`, "utf8");
		expect(skill).toContain("<<'LIT_REPLY_END_9Q7'");
		expect(skill).toMatch(/any line of the\s+reply equals `LIT_REPLY_END_9Q7`, do not run the command/u);
		expect(skill).not.toContain("--answer");
	});
});

describe("lit team route (S3)", () => {
	it.each(["lit team ship the parser rewrite", "lit team mode audit the docs", "lit-team audit the docs"])(
		"routes %s to the lit-team orchestrator",
		(prompt) => {
			const decision = runUserPromptSubmitHook(ups(prompt));
			expect(decision.kind === "inject" && decision.mode).toBe("lit-team");
			expect(contextOf(decision)).toMatch(/^skill lit-team: \/\S+\/skills\/lit-team\/SKILL\.md$/mu);
			expect(contextOf(decision)).toContain("this session becomes the orchestrator");
		},
	);

	it("keeps `lit teams` and a later mention on their own routes", () => {
		expect(runUserPromptSubmitHook(ups("lit teams of four are fine"))).toMatchObject({ mode: "lit-loop" });
	});
});
