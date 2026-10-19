import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { displayWidth } from "./hud.js";
import { recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { statuslineCommand } from "./statusline.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const roots: string[] = [];
const NOW = 1_800_000_000_000;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = mkdtempSync(join(tmpdir(), "litcodex-statusline-"));
	roots.push(root);
	return root;
}

/** A LIT session in its own project folder, with a running tool when `tool` is given. */
function session(env: NodeJS.ProcessEnv, id: string, mode: string, at: number, tool?: string): string {
	const cwd = join(temp(), id);
	mkdirSync(cwd, { recursive: true });
	recordWorkflowTurn(cwd, id, "t1", mode, at);
	recordTurnStart(cwd, id, at);
	if (tool !== undefined) recordLiveStepStart(cwd, id, { tool, toolUseId: "u1" }, at);
	writeThreadPointer(env, id, cwd, at);
	return cwd;
}

async function run(
	env: NodeJS.ProcessEnv,
	input: string | null,
): Promise<{ code: number; stdout: string; lines: string[] }> {
	const stdin = new PassThrough();
	if (input !== null) stdin.end(input);
	let stdout = "";
	const code = await statuslineCommand([], {
		stdin,
		stdout: { write: (text: string) => (stdout += text) },
		env,
		now: () => NOW,
	});
	return {
		code,
		stdout,
		lines: stdout
			.split("\n")
			.slice(0, -1)
			.filter((line) => line !== ""),
	};
}

describe("litcodex statusline", () => {
	it("prints the session named on stdin: route, stage map and the running step with its clock", async () => {
		const env = { CODEX_HOME: join(temp(), "codex"), NO_COLOR: "1" };
		const cwd = session(env, "s-one", "lit-loop", NOW - 12_000, "Bash");
		session(env, "s-two", "litresearch", NOW - 1_000);
		const result = await run(env, JSON.stringify({ session_id: "s-one", cwd }));
		expect(result.code).toBe(0);
		expect(result.lines).toEqual(["🔥 LIT · lit-loop  🔨 WORK › 🔍 REVIEW › 🏁 DONE  ⠹ Bash 0:12"]);
	});

	it("falls back to a session in the same folder, then to the newest session", async () => {
		const env = { CODEX_HOME: join(temp(), "codex"), NO_COLOR: "1" };
		const older = session(env, "s-old", "lit-loop", NOW - 60_000);
		session(env, "s-new", "litresearch", NOW - 1_000);
		const byFolder = await run(env, JSON.stringify({ session_id: "not-lit", workspace: { current_dir: older } }));
		expect(byFolder.lines[0]).toMatch(/^🔥 LIT · lit-loop/u);
		const newest = await run(env, "");
		expect(newest.lines[0]).toMatch(/^🔥 LIT · litresearch {2}🔎 DECOMPOSE/u);
	});

	it("cuts the line to COLUMNS display cells", async () => {
		const env = { CODEX_HOME: join(temp(), "codex"), NO_COLOR: "1", COLUMNS: "30" };
		session(env, "s-one", "lit-loop", NOW - 5_000, "mcp__files__read_a_rather_long_tool_name");
		const result = await run(env, null);
		expect(result.lines).toHaveLength(1);
		expect(displayWidth(result.lines[0] ?? "")).toBeLessThanOrEqual(30);
		expect(result.lines[0]).toMatch(/…$/u);
	});

	it("colours the route unless NO_COLOR is set", async () => {
		const home = join(temp(), "codex");
		session({ CODEX_HOME: home }, "s-one", "lit-loop", NOW - 5_000);
		const coloured = await run({ CODEX_HOME: home }, null);
		expect(coloured.lines[0]).toContain("\u001b[1m");
		const plain = await run({ CODEX_HOME: home, NO_COLOR: "1" }, null);
		expect(plain.lines[0]).not.toContain("\u001b");
	});

	it("prints an empty line and exits 0 on bad stdin or with no LIT session", async () => {
		const env = { CODEX_HOME: join(temp(), "codex") };
		expect(await run(env, "{not json")).toEqual({ code: 0, stdout: "\n", lines: [] });
		expect(await run(env, "x".repeat(70 * 1024))).toEqual({ code: 0, stdout: "\n", lines: [] });
		expect(await run({}, JSON.stringify({ session_id: "s" }))).toEqual({ code: 0, stdout: "\n", lines: [] });
	});

	it("does not wait for stdin that never ends", async () => {
		const env = { CODEX_HOME: join(temp(), "codex"), NO_COLOR: "1" };
		session(env, "s-one", "lit-loop", NOW - 5_000);
		const stdin = new PassThrough();
		let stdout = "";
		const started = performance.now();
		const code = await statuslineCommand([], {
			stdin,
			stdout: { write: (text: string) => (stdout += text) },
			env,
			now: () => NOW,
		});
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(code).toBe(0);
		expect(stdout).toMatch(/^🔥 LIT · lit-loop/u);
	});
});
