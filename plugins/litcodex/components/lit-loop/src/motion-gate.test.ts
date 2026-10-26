import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	type AutoHandoffHookOptions,
	runPostToolUseLiveHookCli,
	runStopPlanPersistenceHookCli,
	runUserPromptSubmitHookCli,
} from "./hook-cli.js";
import {
	armMotionTurn,
	disarmMotionTurn,
	evaluateMotionStop,
	exitCodeOf,
	findMotionTurnRoot,
	installedEvaluator,
	MOTION_MAX_BLOCKS,
	type MotionVerdict,
	motionTurnPath,
	parseMotionCommand,
	recordMotionTool,
} from "./motion-gate.js";

const dir = (): string => realpathSync(mkdtempSync(join(tmpdir(), "litcodex-motion-gate-")));
const RENDER = "/opt/skills/lit-typographic-motion/scripts/render.mjs";
const SESSION = "s-film";
const readTurn = (root: string) => JSON.parse(readFileSync(motionTurnPath(root), "utf8"));

describe("parseMotionCommand: shell variables", () => {
	it("expands a variable the same command set", () => {
		const parsed = parseMotionCommand(`D=/work/film && node ${RENDER} stage --out "$D" --round 2`, "/cwd");
		expect(parsed).toEqual({ mode: "stage", out: "/work/film", round: 2, stillsOnly: false });
	});

	it("expands the braced form and a variable that names the script", () => {
		const parsed = parseMotionCommand(
			`R=${RENDER}; D='/work/my film'; node "$R" film --out "\${D}" --stills-only`,
			"/cwd",
		);
		expect(parsed).toEqual({ mode: "film", out: "/work/my film", round: null, stillsOnly: true });
	});

	it("expands one variable through another", () => {
		const parsed = parseMotionCommand(`B=/work; D="$B/film"; node ${RENDER} gate --out $D`, "/cwd");
		expect(parsed?.out).toBe("/work/film");
	});

	it("handles a quoted path and the --out=value form", () => {
		expect(parseMotionCommand(`node "${RENDER}" sound --out "/work/a b/film"`, "/cwd")?.out).toBe("/work/a b/film");
		expect(parseMotionCommand(`node ${RENDER} sound --out=/work/c`, "/cwd")?.out).toBe("/work/c");
	});

	it("treats a variable the command never set as an unknown folder, not a guess", () => {
		const parsed = parseMotionCommand(`node ${RENDER} stage --out "$UNSET_DIR"`, "/cwd");
		expect(parsed).toEqual({ mode: "stage", out: null, round: null, stillsOnly: false });
		expect(parseMotionCommand(`node ${RENDER} stage --out "$(mktemp -d)"`, "/cwd")?.out).toBeNull();
	});

	it("resolves a relative folder against the hook's cwd, and a leading cd", () => {
		expect(parseMotionCommand(`node ${RENDER} stage --out film`, "/work")?.out).toBe("/work/film");
		expect(parseMotionCommand(`node ${RENDER} stage --out .`, "/work/film")?.out).toBe("/work/film");
		expect(parseMotionCommand(`cd film && node ${RENDER} look --out . --round 1`, "/work")?.out).toBe("/work/film");
		expect(parseMotionCommand(`cd "$ELSEWHERE" && node ${RENDER} look --out .`, "/work")?.out).toBeNull();
	});

	it("ignores a command that does not run the renderer, and keeps a cover-gate out of the render list", () => {
		expect(parseMotionCommand("ls -la && echo render.mjs", "/work")).toBeNull();
		expect(parseMotionCommand(`node ${RENDER} cover-gate --file /x/cover.webp --strict`, "/work")).toEqual({
			mode: "cover-gate",
			out: null,
			round: null,
			stillsOnly: false,
		});
	});
});

describe("exitCodeOf", () => {
	it("reads a numeric field, an exit line, and the blocked name the renderer prints", () => {
		expect(exitCodeOf({ exit_code: 13, stdout: "" })).toBe(13);
		expect(exitCodeOf({ metadata: { exit_code: 22 } })).toBe(22);
		expect(exitCodeOf("render done\nexit 11 BLOCKED_NO_WEBGL2\n")).toBe(11);
		expect(exitCodeOf({ stdout: "BLOCKED_NO_CHROME: no chrome found\n" })).toBe(10);
		expect(exitCodeOf({ output: "BLOCKED_ASSET_MISSING: nothing reachable" })).toBe(22);
		expect(exitCodeOf("QA gate: PASS")).toBeNull();
		expect(exitCodeOf(undefined)).toBeNull();
	});
});

describe("turn record", () => {
	it("arms a fresh record and a non-film prompt removes it", () => {
		const root = dir();
		expect(armMotionTurn(root, SESSION, 5)).toBe(true);
		expect(readTurn(root)).toEqual({
			sessionId: SESSION,
			promptAt: 5,
			runs: [],
			blockCount: 0,
			warned: false,
			notified: false,
		});
		disarmMotionTurn(root, "another-session");
		expect(existsSync(motionTurnPath(root))).toBe(true);
		disarmMotionTurn(root, SESSION);
		expect(existsSync(motionTurnPath(root))).toBe(false);
	});

	it("finds the armed turn from a folder below it, only for its own session", () => {
		const root = dir();
		const film = join(root, "film", "stage");
		mkdirSync(film, { recursive: true });
		armMotionTurn(root, SESSION);
		const found = findMotionTurnRoot(film, SESSION);
		expect(found).not.toBeNull();
		expect(found).not.toBe("bad");
		expect(found === null || found === "bad" ? "" : found.root).toBe(root);
		expect(findMotionTurnRoot(film, "other")).toBeNull();
		disarmMotionTurn(film, SESSION);
		expect(existsSync(motionTurnPath(root))).toBe(false);
	});

	it("records a renderer run from a shell call made inside the film folder", () => {
		const root = dir();
		const film = join(root, "motion-x");
		mkdirSync(film);
		armMotionTurn(root, SESSION);
		const turn = recordMotionTool(
			{
				session_id: SESSION,
				cwd: film,
				tool_name: "Bash",
				tool_input: { command: `D=. && node ${RENDER} stage --out "$D" --round 1` },
				tool_response: { stdout: "BLOCKED_NO_CHROME: no chrome\n" },
			},
			99,
		);
		expect(turn?.runs).toEqual([{ mode: "stage", out: film, round: 1, stillsOnly: false, exitCode: 10, at: 99 }]);
		expect(readTurn(root).runs).toHaveLength(1);
	});

	it("records nothing for another session, another tool, a non-renderer command or an unarmed folder", () => {
		const root = dir();
		const call = (over: Record<string, unknown>) => ({
			session_id: SESSION,
			cwd: root,
			tool_name: "Bash",
			tool_input: { command: `node ${RENDER} stage --out ${root}/film` },
			tool_response: "",
			...over,
		});
		expect(recordMotionTool(call({}))).toBeNull();
		armMotionTurn(root, SESSION);
		expect(recordMotionTool(call({ session_id: "other" }))).toBeNull();
		expect(recordMotionTool(call({ tool_name: "Read" }))).toBeNull();
		expect(recordMotionTool(call({ tool_input: { command: "ls" } }))).toBeNull();
		expect(recordMotionTool(call({ cwd: "relative" }))).toBeNull();
		expect(readTurn(root).runs).toHaveLength(0);
		expect(recordMotionTool(call({}))?.runs).toHaveLength(1);
	});
});

const COMPLETE: MotionVerdict = { status: "complete", reason: "gate PASS", downgraded: [], openItems: [] };
const stub = (verdict: MotionVerdict | null) => () => verdict;

function armedWithRun(exitCode: number | null = 0): string {
	const root = dir();
	armMotionTurn(root, SESSION);
	recordMotionTool(
		{
			session_id: SESSION,
			cwd: root,
			tool_name: "Bash",
			tool_input: { command: `node ${RENDER} film --out ${root}/film` },
			tool_response: exitCode === null ? "" : { exit_code: exitCode },
		},
		1,
	);
	return root;
}

describe("evaluateMotionStop", () => {
	it("allows a turn that was never armed", async () => {
		const root = dir();
		expect(await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate: stub(COMPLETE) })).toEqual({
			action: "allow",
			why: "not-a-motion-turn",
		});
	});

	it("blocks with a named reason when no render ran in the turn", async () => {
		const root = dir();
		armMotionTurn(root, SESSION);
		const decision = await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate: stub(COMPLETE) });
		expect(decision.action).toBe("block");
		expect(decision.action === "block" ? decision.reason : "").toContain("no render command ran in this turn");
		expect(readTurn(root).blockCount).toBe(1);
	});

	it("allows once the last output folder is done and carries nothing to say", async () => {
		const root = armedWithRun();
		const seen: string[] = [];
		const decision = await evaluateMotionStop({
			cwd: root,
			sessionId: SESSION,
			evaluate: (out) => {
				seen.push(out);
				return COMPLETE;
			},
		});
		expect(decision).toEqual({ action: "allow", why: "done" });
		expect(seen).toEqual([join(root, "film")]);
	});

	it("blocks a not-complete film, then names it in a final notice after the reminder cap, then lets the turn end", async () => {
		const root = armedWithRun();
		const evaluate = stub({ status: "not complete", reason: "the last look round did not view poster.png" });
		for (let i = 1; i <= MOTION_MAX_BLOCKS; i++) {
			const reminder = await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate });
			expect(reminder).toMatchObject({ action: "block", why: "not-done" });
			expect(readTurn(root).blockCount).toBe(i);
		}
		const notice = await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate });
		expect(notice).toMatchObject({ action: "block", why: "not-done-notice" });
		expect(notice.action === "block" ? notice.reason : "").toMatch(
			/say in the reply, in plain words, that the film is not done and why/u,
		);
		expect(await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate })).toEqual({
			action: "allow",
			why: "notified",
		});
	});

	it.each([
		10, 11, 12, 14, 15, 21, 22,
	])("a blocked exit %i goes straight to the notice without judging the folder", async (code) => {
		const root = armedWithRun(code);
		const decision = await evaluateMotionStop({
			cwd: root,
			sessionId: SESSION,
			evaluate: () => {
				throw new Error("must not be called");
			},
		});
		expect(decision).toMatchObject({ action: "block", why: "not-done-notice" });
		expect(decision.action === "block" ? decision.reason : "").toContain(`exit ${code}`);
	});

	it("a finished film with a downgrade, a label or an open look item blocks once so the reply says so", async () => {
		const root = armedWithRun();
		const verdict: MotionVerdict = {
			status: "complete",
			reason: "gate PASS",
			downgraded: ["durationSec dropped 40% (10 s to 6 s)"],
			openItems: ["Q3: the turn lands late"],
			labels: ["the score is generated"],
		};
		const decision = await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate: stub(verdict) });
		expect(decision).toMatchObject({ action: "block", why: "complete" });
		const reason = decision.action === "block" ? decision.reason : "";
		expect(reason).toContain("downgraded: durationSec dropped 40%");
		expect(reason).toContain("open item: Q3: the turn lands late");
		expect(reason).toContain("the score is generated");
		expect(await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate: stub(verdict) })).toMatchObject({
			action: "allow",
		});
	});

	it("a film nobody viewed blocks once with the done-check's own words", async () => {
		const root = armedWithRun();
		const decision = await evaluateMotionStop({
			cwd: root,
			sessionId: SESSION,
			evaluate: stub({
				status: "DONE_UNVIEWED",
				reason: "no image tool was reachable: nobody viewed the frames",
				downgraded: [],
				openItems: [],
			}),
		});
		expect(decision.action === "block" ? decision.reason : "").toContain("nobody viewed the frames");
	});

	it("finds the armed turn from inside the film folder", async () => {
		const root = armedWithRun();
		const decision = await evaluateMotionStop({
			cwd: join(root, "film"),
			sessionId: SESSION,
			evaluate: stub(COMPLETE),
		});
		expect(decision).toEqual({ action: "allow", why: "done" });
		mkdirSync(join(root, "film"), { recursive: true });
		const nested = await evaluateMotionStop({ cwd: join(root, "film"), sessionId: SESSION, evaluate: stub(null) });
		expect(nested).toEqual({ action: "allow", why: "done-check-unavailable" });
	});

	it("fails open on an unreadable record of its own", async () => {
		const root = dir();
		mkdirSync(join(root, ".litcodex", "motion"), { recursive: true });
		writeFileSync(motionTurnPath(root), "{not json");
		expect(await evaluateMotionStop({ cwd: root, sessionId: SESSION, evaluate: stub(COMPLETE) })).toEqual({
			action: "allow",
			why: "unreadable-turn-state",
		});
		writeFileSync(motionTurnPath(root), JSON.stringify({ sessionId: SESSION, blockCount: "x" }));
		expect((await evaluateMotionStop({ cwd: root, sessionId: SESSION })).action).toBe("allow");
		expect(
			recordMotionTool({
				session_id: SESSION,
				cwd: root,
				tool_name: "Bash",
				tool_input: { command: `node ${RENDER} stage --out ${root}/f` },
			}),
		).toBeNull();
	});

	it("the installed done-check judges a folder with no render as not complete", async () => {
		const root = dir();
		const verdict = await installedEvaluator(root);
		expect(verdict?.status).toBe("not complete");
		expect(verdict?.reason).toMatch(/nothing verified was rendered/u);
	});
});

const FILM_PROMPT = "make a short video that explains how composting works lit";

function drive<T extends unknown[]>(
	entry: (
		stdin: NodeJS.ReadableStream,
		stdout: NodeJS.WritableStream,
		stderr: NodeJS.WritableStream,
		...rest: T
	) => Promise<number>,
	payload: unknown,
	...rest: T
): Promise<{ code: number; stdout: string }> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(JSON.stringify(payload));
	return entry(stdin, stdout, stderr, ...rest).then((code) => ({ code, stdout: out }));
}

describe("the three hook entries together", () => {
	const options = (root: string, extra: Partial<AutoHandoffHookOptions> = {}): AutoHandoffHookOptions => ({
		env: { CODEX_HOME: join(root, ".codex-home") },
		now: 1_000,
		...extra,
	});
	const prompt = (root: string, text: string) => ({
		hook_event_name: "UserPromptSubmit",
		session_id: SESSION,
		cwd: root,
		prompt: text,
	});

	it("arms on a film prompt, records the renderer run, blocks Stop until the done-check passes", async () => {
		const root = dir();
		const armed = await drive(runUserPromptSubmitHookCli, prompt(root, FILM_PROMPT), root, options(root));
		expect(armed.code).toBe(0);
		expect(armed.stdout).toContain("this is a film request");
		expect(readTurn(root)).toMatchObject({ sessionId: SESSION, runs: [], blockCount: 0 });

		const stopEvent = {
			hook_event_name: "Stop",
			session_id: SESSION,
			turn_id: "t1",
			cwd: root,
			stop_hook_active: false,
		};
		const early = await drive(
			runStopPlanPersistenceHookCli,
			stopEvent,
			root,
			options(root, { evaluateMotion: stub(COMPLETE) }),
		);
		expect(JSON.parse(early.stdout)).toMatchObject({ decision: "block" });
		expect(JSON.parse(early.stdout).reason).toContain("no render command ran in this turn");

		const posted = await drive(
			runPostToolUseLiveHookCli,
			{
				hook_event_name: "PostToolUse",
				session_id: SESSION,
				cwd: root,
				tool_name: "Bash",
				tool_use_id: "c1",
				tool_input: { command: `D=${root}/film && node "${RENDER}" film --out "$D"` },
				tool_response: { stdout: "QA gate: PASS\n" },
			},
			options(root),
		);
		expect(posted).toEqual({ code: 0, stdout: "" });
		expect(readTurn(root).runs[0]).toMatchObject({ mode: "film", out: join(root, "film") });

		const done = await drive(
			runStopPlanPersistenceHookCli,
			stopEvent,
			root,
			options(root, { evaluateMotion: stub(COMPLETE) }),
		);
		expect(done.stdout).not.toContain('"decision":"block"');
	});

	it("a prompt that is not a film prompt disarms the gate", async () => {
		const root = dir();
		await drive(runUserPromptSubmitHookCli, prompt(root, FILM_PROMPT), root, options(root));
		expect(existsSync(motionTurnPath(root))).toBe(true);
		await drive(
			runUserPromptSubmitHookCli,
			prompt(root, "refactor the parser and add tests lit"),
			root,
			options(root),
		);
		expect(existsSync(motionTurnPath(root))).toBe(false);
		await drive(runUserPromptSubmitHookCli, prompt(root, FILM_PROMPT), root, options(root));
		await drive(runUserPromptSubmitHookCli, prompt(root, "thanks, that is all"), root, options(root));
		expect(existsSync(motionTurnPath(root))).toBe(false);
	});

	it("a subagent's Stop never ends or blocks the parent's film turn", async () => {
		const root = dir();
		armMotionTurn(root, SESSION);
		const event = { hook_event_name: "Stop", session_id: SESSION, agent_id: "child-1", cwd: root };
		const result = await drive(
			runStopPlanPersistenceHookCli,
			event,
			root,
			options(root, { evaluateMotion: stub(COMPLETE) }),
		);
		expect(result.stdout).not.toContain('"decision":"block"');
		expect(readTurn(root).blockCount).toBe(0);
	});
});
