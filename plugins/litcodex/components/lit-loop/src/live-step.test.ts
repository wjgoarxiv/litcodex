import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	runPostToolUseLiveHookCli,
	runPreToolUseLiveHookCli,
	runStopPlanPersistenceHookCli,
	runUserPromptSubmitHookCli,
} from "./hook-cli.js";
import {
	liveStepPath,
	readLiveStep,
	readThreadPointer,
	recordLiveStepEnd,
	recordLiveStepStart,
	recordTurnStart,
	threadPointerPath,
	writeThreadPointer,
} from "./live-step.js";
import { recordLitPlanActivation } from "./plan-persistence.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dir(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(root);
	return root;
}

function event(cwd: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		hook_event_name: "PreToolUse",
		session_id: "s1",
		turn_id: "t1",
		cwd,
		tool_name: "Bash",
		tool_use_id: "call-1",
		tool_input: { command: "npm test" },
		...extra,
	};
}

async function runHook(
	entry: typeof runPreToolUseLiveHookCli,
	payload: unknown,
	env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let out = "";
	let err = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stderr.on("data", (chunk) => {
		err += chunk.toString();
	});
	stdin.end(typeof payload === "string" ? payload : JSON.stringify(payload));
	const code = await entry(stdin, stdout, stderr, { env, now: 1_000 });
	return { code, stdout: out, stderr: err };
}

describe("test isolation", () => {
	it("points every test at a temporary Codex home, so no hook test writes into the real one", () => {
		const home = process.env["CODEX_HOME"] ?? "";
		expect(home.startsWith(realpathSync(tmpdir()))).toBe(true);
	});
});

describe("live step record", () => {
	it("records the running tool with its start time and clears it when the tool ends", () => {
		const root = dir("litcodex-live-");
		recordLiveStepStart(root, "s1", { tool: "Bash", toolUseId: "call-1" }, 5_000);
		expect(readLiveStep(root, "s1")).toEqual({
			tool: "Bash",
			toolUseId: "call-1",
			startedAt: 5_000,
			endedAt: null,
			turnStartedAt: null,
			turnEndedAt: null,
			lastTool: null,
		});
		recordLiveStepEnd(root, "s1", { tool: "Bash", toolUseId: "call-1" }, 9_000);
		expect(readLiveStep(root, "s1")).toEqual({
			tool: null,
			toolUseId: null,
			startedAt: null,
			endedAt: 9_000,
			turnStartedAt: null,
			turnEndedAt: null,
			lastTool: "Bash",
		});
	});

	it("keeps a newer step when an older parallel call ends", () => {
		const root = dir("litcodex-live-");
		recordLiveStepStart(root, "s1", { tool: "Bash", toolUseId: "call-1" }, 1_000);
		recordLiveStepStart(root, "s1", { tool: "apply_patch", toolUseId: "call-2" }, 2_000);
		recordLiveStepEnd(root, "s1", { tool: "Bash", toolUseId: "call-1" }, 3_000);
		expect(readLiveStep(root, "s1")?.tool).toBe("apply_patch");
	});

	it("keeps each session's step in its own file and never escapes the state folder", () => {
		const root = dir("litcodex-live-");
		expect(liveStepPath(root, "../../etc/passwd")).toBe(join(root, ".litcodex/live-step/etc-passwd.json"));
		expect(liveStepPath(root, "")).toBeNull();
		expect(liveStepPath("relative/dir", "s1")).toBeNull();
		recordLiveStepStart(root, "s1", { tool: "Bash", toolUseId: null }, 1);
		recordLiveStepStart(root, "s2", { tool: "Read", toolUseId: null }, 2);
		expect(readLiveStep(root, "s1")?.tool).toBe("Bash");
		expect(readLiveStep(root, "s2")?.tool).toBe("Read");
	});

	it("cuts a long or odd tool name to a short printable label", () => {
		const root = dir("litcodex-live-");
		recordLiveStepStart(root, "s1", { tool: `mcp__x__${"y".repeat(200)}\u001b[31m`, toolUseId: null }, 1);
		const tool = readLiveStep(root, "s1")?.tool ?? "";
		expect(tool.length).toBeLessThanOrEqual(64);
		expect(tool).not.toContain("\u001b");
	});

	it("does not write through a symlinked state folder", () => {
		const root = dir("litcodex-live-");
		const elsewhere = dir("litcodex-elsewhere-");
		mkdirSync(join(root, ".litcodex"), { recursive: true });
		symlinkSync(elsewhere, join(root, ".litcodex/live-step"));
		recordLiveStepStart(root, "s1", { tool: "Bash", toolUseId: null }, 1);
		expect(existsSync(join(elsewhere, "s1.json"))).toBe(false);
	});
});

describe("thread pointer", () => {
	it("maps a session id to its workspace under the Codex home the hook sees", () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const env = { CODEX_HOME: home };
		writeThreadPointer(env, "01a1-thread", root, 10);
		expect(threadPointerPath(env, "01a1-thread")).toBe(join(home, "litcodex/lit-loop/threads/01a1-thread.json"));
		expect(readThreadPointer(env, "01a1-thread")).toEqual({
			cwd: root,
			updatedAt: 10,
			cardOfferedAt: null,
			cardOpenedAt: null,
		});
	});

	it("falls back to HOME/.codex and writes nothing when neither is known", () => {
		const home = dir("litcodex-home-");
		const root = dir("litcodex-ws-");
		expect(threadPointerPath({ HOME: home }, "t")).toBe(join(home, ".codex/litcodex/lit-loop/threads/t.json"));
		expect(threadPointerPath({}, "t")).toBeNull();
		writeThreadPointer({}, "t", root, 1);
		expect(readThreadPointer({}, "t")).toBeNull();
	});

	it("rejects a relative cwd, a symlinked pointer and an oversized pointer", () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const env = { CODEX_HOME: home };
		writeThreadPointer(env, "t", "relative", 1);
		expect(readThreadPointer(env, "t")).toBeNull();
		const threads = join(home, "litcodex/lit-loop/threads");
		mkdirSync(threads, { recursive: true });
		writeFileSync(join(root, "target.json"), JSON.stringify({ version: 1, cwd: root, updatedAt: 1 }));
		symlinkSync(join(root, "target.json"), join(threads, "linked.json"));
		expect(readThreadPointer(env, "linked")).toBeNull();
		writeFileSync(
			join(threads, "big.json"),
			JSON.stringify({ version: 1, cwd: root, updatedAt: 1, pad: "x".repeat(9000) }),
		);
		expect(readThreadPointer(env, "big")).toBeNull();
	});
});

describe("live step hooks", () => {
	it("writes the step and the pointer before a tool runs and clears the step after, printing nothing", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const env = { CODEX_HOME: home };
		recordWorkflowTurn(root, "s1", "t1", "lit-loop");
		const pre = await runHook(runPreToolUseLiveHookCli, event(root), env);
		expect(pre).toEqual({ code: 0, stdout: "", stderr: "" });
		expect(readLiveStep(root, "s1")).toEqual({
			tool: "Bash",
			toolUseId: "call-1",
			startedAt: 1_000,
			endedAt: null,
			turnStartedAt: null,
			turnEndedAt: null,
			lastTool: null,
		});
		expect(readThreadPointer(env, "s1")?.cwd).toBe(root);
		const post = await runHook(runPostToolUseLiveHookCli, event(root, { hook_event_name: "PostToolUse" }), env);
		expect(post).toEqual({ code: 0, stdout: "", stderr: "" });
		expect(readLiveStep(root, "s1")?.tool).toBeNull();
	});

	it("does not show the card's own tools as the live step", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const env = { CODEX_HOME: home };
		recordWorkflowTurn(root, "s1", "t1", "lit-loop");
		await runHook(runPreToolUseLiveHookCli, event(root), env);
		for (const tool_name of ["mcp__litcodex__lit_card", "mcp__litcodex__lit_card_status"]) {
			await runHook(runPreToolUseLiveHookCli, event(root, { tool_name, tool_use_id: "call-9" }), env);
			expect(readLiveStep(root, "s1")?.tool).toBe("Bash");
		}
	});

	it("leaves the workspace untouched in a thread without a LIT activation", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const env = { CODEX_HOME: home };
		await runHook(runPreToolUseLiveHookCli, event(root), env);
		await runHook(runPostToolUseLiveHookCli, event(root, { hook_event_name: "PostToolUse" }), env);
		expect(existsSync(join(root, ".litcodex"))).toBe(false);
		expect(readThreadPointer(env, "s1")).toBeNull();
	});

	it("never blocks the tool: malformed, empty or partial input exits 0 silently", async () => {
		const home = dir("litcodex-codex-home-");
		const env = { CODEX_HOME: home };
		for (const payload of ["{not json", "", "[]", JSON.stringify({ hook_event_name: "PreToolUse" })]) {
			expect(await runHook(runPreToolUseLiveHookCli, payload, env)).toEqual({ code: 0, stdout: "", stderr: "" });
			expect(await runHook(runPostToolUseLiveHookCli, payload, env)).toEqual({ code: 0, stdout: "", stderr: "" });
		}
	});

	it("points a thread at its workspace on a LIT prompt and never on an ordinary one", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const submit = async (session: string, prompt: string): Promise<void> => {
			const stdin = new PassThrough();
			stdin.end(
				JSON.stringify({
					hook_event_name: "UserPromptSubmit",
					session_id: session,
					turn_id: "t",
					cwd: root,
					prompt,
				}),
			);
			const code = await runUserPromptSubmitHookCli(stdin, new PassThrough(), new PassThrough(), root, {
				env: { CODEX_HOME: home },
			});
			expect(code).toBe(0);
		};
		await submit("plain", "hello there");
		expect(existsSync(join(home, "litcodex/lit-loop/threads/plain.json"))).toBe(false);
		await submit("lit", "lit add a flag");
		expect(JSON.parse(readFileSync(join(home, "litcodex/lit-loop/threads/lit.json"), "utf8")).cwd).toBe(root);
	});

	it("ends a step that never got its PostToolUse when the turn stops", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const env = { CODEX_HOME: home };
		recordWorkflowTurn(root, "s1", "t1", "lit-loop");
		await runHook(runPreToolUseLiveHookCli, event(root), env);
		expect(readLiveStep(root, "s1")?.tool).toBe("Bash");
		const stdin = new PassThrough();
		stdin.end(
			JSON.stringify({
				hook_event_name: "Stop",
				session_id: "s1",
				turn_id: "t1",
				cwd: root,
				stop_hook_active: false,
			}),
		);
		expect(await runStopPlanPersistenceHookCli(stdin, new PassThrough(), new PassThrough(), root, { env: {} })).toBe(
			0,
		);
		expect(readLiveStep(root, "s1")?.tool).toBeNull();
	});

	it("opens the turn on a LIT prompt and closes it when the turn stops, even with no tool run", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const prompt = new PassThrough();
		prompt.end(
			JSON.stringify({
				hook_event_name: "UserPromptSubmit",
				session_id: "s1",
				turn_id: "t1",
				cwd: root,
				prompt: "lit add a flag",
			}),
		);
		expect(
			await runUserPromptSubmitHookCli(prompt, new PassThrough(), new PassThrough(), root, {
				env: { CODEX_HOME: home },
				now: 2_000,
			}),
		).toBe(0);
		expect(readLiveStep(root, "s1")).toMatchObject({ tool: null, turnStartedAt: 2_000, turnEndedAt: null });
		await runHook(runPreToolUseLiveHookCli, event(root), { CODEX_HOME: home });
		expect(readLiveStep(root, "s1")).toMatchObject({ tool: "Bash", turnStartedAt: 2_000, turnEndedAt: null });
		await runHook(runPostToolUseLiveHookCli, event(root, { hook_event_name: "PostToolUse" }), { CODEX_HOME: home });
		expect(readLiveStep(root, "s1")).toMatchObject({ tool: null, turnStartedAt: 2_000, turnEndedAt: null });
		const stop = new PassThrough();
		stop.end(
			JSON.stringify({
				hook_event_name: "Stop",
				session_id: "s1",
				turn_id: "t1",
				cwd: root,
				stop_hook_active: false,
			}),
		);
		expect(
			await runStopPlanPersistenceHookCli(stop, new PassThrough(), new PassThrough(), root, { env: {}, now: 3_000 }),
		).toBe(0);
		expect(readLiveStep(root, "s1")).toMatchObject({
			tool: null,
			turnStartedAt: 2_000,
			turnEndedAt: 3_000,
			lastTool: "Bash",
		});
		recordTurnStart(root, "s1", 4_000);
		expect(readLiveStep(root, "s1")).toMatchObject({ lastTool: null, turnStartedAt: 4_000 });
	});

	it("keeps the turn open when LIT's own Stop guard sends the model back to work", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		recordWorkflowTurn(root, "s1", "t1", "lit-plan", 500);
		recordLitPlanActivation(root, "s1", 500);
		recordTurnStart(root, "s1", 600);
		await runHook(runPreToolUseLiveHookCli, event(root), { CODEX_HOME: home });
		const stop = new PassThrough();
		const out = new PassThrough();
		let printed = "";
		out.on("data", (chunk) => {
			printed += chunk.toString();
		});
		stop.end(
			JSON.stringify({
				hook_event_name: "Stop",
				session_id: "s1",
				turn_id: "t1",
				cwd: root,
				stop_hook_active: false,
			}),
		);
		expect(await runStopPlanPersistenceHookCli(stop, out, new PassThrough(), root, { env: {}, now: 3_000 })).toBe(0);
		expect(printed).toContain('"decision":"block"');
		expect(readLiveStep(root, "s1")).toMatchObject({ tool: null, turnEndedAt: null, turnStartedAt: 600 });
	});

	it("keeps a running tool when a prompt arrives in the middle of a turn", () => {
		const root = dir("litcodex-live-");
		recordTurnStart(root, "s1", 1_000);
		recordLiveStepStart(root, "s1", { tool: "Bash", toolUseId: "call-1" }, 2_000);
		recordTurnStart(root, "s1", 3_000);
		expect(readLiveStep(root, "s1")).toMatchObject({ tool: "Bash", startedAt: 2_000, turnStartedAt: 3_000 });
	});

	it.skipIf(process.platform === "win32")(
		"never waits on a named pipe planted where a record or a git file belongs",
		() => {
			const root = dir("litcodex-live-");
			const home = dir("litcodex-codex-home-");
			mkdirSync(join(root, ".litcodex/live-step"), { recursive: true });
			execFileSync("mkfifo", [join(root, ".litcodex/live-step/s1.json"), join(root, ".git")]);
			recordWorkflowTurn(root, "s1", "t1", "lit-loop");
			writeThreadPointer({ CODEX_HOME: home }, "s1", root, 1_000);
			const dist = (name: string): string => new URL(`../dist/${name}`, import.meta.url).href;
			const script = `const l=await import(${JSON.stringify(dist("live-step.js"))});const c=await import(${JSON.stringify(dist("card-status.js"))});console.log(JSON.stringify([l.readLiveStep(${JSON.stringify(root)},"s1"),c.readCardStatus("s1",{CODEX_HOME:${JSON.stringify(home)}}).branch]));`;
			const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
				encoding: "utf8",
				timeout: 5_000,
			});
			expect(run.signal).toBeNull();
			expect(run.stdout.trim()).toBe("[null,null]");
		},
	);

	it("writes records through a fresh temp file, never through a planted temp symlink", () => {
		const root = dir("litcodex-live-");
		const victim = join(dir("litcodex-victim-"), "victim.txt");
		writeFileSync(victim, "keep");
		mkdirSync(join(root, ".litcodex/live-step"), { recursive: true });
		symlinkSync(victim, join(root, `.litcodex/live-step/s1.json.${process.pid}.tmp`));
		recordLiveStepStart(root, "s1", { tool: "Bash", toolUseId: null }, 1);
		expect(readFileSync(victim, "utf8")).toBe("keep");
		expect(readLiveStep(root, "s1")?.tool).toBe("Bash");
		const turnDir = join(root, ".litcodex/workflow-map");
		mkdirSync(turnDir, { recursive: true });
		symlinkSync(victim, join(turnDir, `s1.json.${process.pid}.tmp`));
		recordWorkflowTurn(root, "s1", "t1", "lit-loop");
		expect(readFileSync(victim, "utf8")).toBe("keep");
	});

	it("asks the model to open a fresh LIT card on every LIT activation, and never on a plain prompt", async () => {
		const home = dir("litcodex-codex-home-");
		const root = dir("litcodex-ws-");
		const contextOf = async (prompt: string): Promise<string> => {
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			let out = "";
			stdout.on("data", (chunk) => {
				out += chunk.toString();
			});
			stdin.end(
				JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s5", turn_id: "t", cwd: root, prompt }),
			);
			await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), root, { env: { CODEX_HOME: home } });
			if (out === "") return "";
			return (
				(JSON.parse(out) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput
					?.additionalContext ?? ""
			);
		};
		expect(await contextOf("hello there")).not.toContain("lit_card");
		const first = await contextOf("lit add a flag");
		expect(first).toContain("call the `lit_card` tool once now");
		expect(await contextOf("thanks, looks good")).not.toContain("lit_card");
		const second = await contextOf("lit add another flag");
		expect(second).toContain("call the `lit_card` tool once now");
		expect(second).toContain("folds");
		expect(second).not.toContain("in this thread");
		expect(readThreadPointer({ CODEX_HOME: home }, "s5")?.cardOfferedAt).toEqual(expect.any(Number));
	});
});
