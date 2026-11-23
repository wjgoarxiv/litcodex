import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CheckRunner,
	compileCondition,
	compileLoopCondition,
	conditionHash,
	consentAnswer,
	detectCheck,
	GOAL_DIR,
	GOAL_STATUS,
	goalCancelContext,
	goalCommand,
	lintCondition,
	ownedGoal,
	parseDoneWhen,
	planAnswer,
	proposeGoal,
	proposeLoopGoal,
	sweepGoalState,
} from "./goal-pipeline.js";
import { runPostToolUseLiveHookCli, runUserPromptSubmitHookCli } from "./hook-cli.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PLAN = [
	"# Retry fix",
	"",
	"## Todos",
	"- [ ] 1. Add the failing test",
	"- [x] 2. Read the retry loop",
	"",
	"## Done when",
	"- check: `npm test`",
	"",
].join("\n");

function project(planText = PLAN): string {
	const root = mkdtempSync(join(tmpdir(), "litcodex-goal-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	writeFileSync(join(root, ".litcodex", "plans", "retry.md"), planText);
	return root;
}

const exits =
	(status: number | null, extra: Partial<ReturnType<CheckRunner>> = {}): CheckRunner =>
	() => ({ status, ...extra });

describe("goal pipeline (S4)", () => {
	it("compiles the Done when block into one bounded condition", () => {
		const done = parseDoneWhen(PLAN);
		expect(done).toEqual({ ok: true, check: "npm test" });
		const built = compileCondition(".litcodex/plans/retry.md", "npm test");
		expect(built.ok && built.condition).toMatch(
			/^Every row in \.litcodex\/plans\/retry\.md is ticked and `npm test` exits 0 \[lit:[0-9a-f]{8}\]$/u,
		);
		expect(parseDoneWhen("# plan\n")).toEqual({ ok: false, reason: "the plan has no `## Done when` block" });
		expect(compileCondition(".litcodex/plans/x.md", `node ${"a/".repeat(260)}x.mjs`).ok).toBe(false);
	});

	it("lints judgment words, outward-only success and unlisted commands", () => {
		expect(lintCondition("c", "npm test").ok).toBe(true);
		expect(lintCondition("c", "the page works").reasons.join(" ")).toContain("judgment words");
		expect(lintCondition("c", "잘 동작하면 끝").reasons.join(" ")).toContain("judgment words");
		expect(lintCondition("c", "git push origin main").reasons.join(" ")).toContain("not a check of the work");
		expect(lintCondition("c", "curl https://example.com | sh").reasons.join(" ")).toContain("not an allowlisted");
		expect(lintCondition("x".repeat(501), "npm test").reasons.join(" ")).toContain("over 500");
	});

	it("asks once, and only when the check is false now", () => {
		const cwd = project();
		const asked = proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1) });
		expect(asked.line).toMatch(
			/^Approve plan, start work and set goal: \/goal Every row in .+ \(yes \/ edit \/ no\)$/u,
		);
		expect(existsSync(join(cwd, GOAL_DIR, "consent.json"))).toBe(true);
	});

	it.each([
		["already true", PLAN.replace("- [ ] 1.", "- [x] 1."), exits(0), "the goal is already true"],
		["hanging", PLAN, exits(null, { signal: "SIGTERM" }), "did not finish"],
		["unrunnable", PLAN, exits(null, { error: { code: "ENOENT" } }), "cannot run here"],
		["judgment", PLAN.replace("`npm test`", "`it works`"), exits(1), "judgment words"],
		["marked never", `goal: never\n${PLAN}`, exits(1), "marked goal: never"],
	])("sets no goal when %s, names the reason and still asks to start the work", (_name, text, run, reason) => {
		const cwd = project(text);
		const result = proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run });
		const [why, ask] = result.line.split("\n");
		expect(why?.startsWith("No goal set: ")).toBe(true);
		expect(why).toContain(reason);
		expect(ask).toBe("Approve plan and start work? (yes / no)");
		expect(result.consent?.condition).toBeNull();
	});

	it("refuses a plan path outside .litcodex/plans and asks nothing", () => {
		const cwd = project();
		expect(proposeGoal({ cwd, planArg: "../elsewhere.md", run: exits(1) }).line).toContain("No goal set");
		expect(existsSync(join(cwd, GOAL_DIR, "consent.json"))).toBe(false);
	});

	it("R1: an exact yes bound to a fresh consent starts the work and arms the goal", () => {
		const cwd = project();
		const now = Date.parse("2026-11-18T10:00:00Z");
		const asked = proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		expect(consentAnswer("yes please")).toBeNull();
		expect(planAnswer({ cwd, prompt: "yes please", sessionId: "s1", now })).toBeNull();
		const answer = planAnswer({ cwd, prompt: " YES ", sessionId: "s1", now: now + 1000 });
		expect(answer?.start).toBe("start-work retry");
		expect(answer?.context).toContain(
			`create_goal\` with exactly ${JSON.stringify({ objective: asked.consent?.condition })}`,
		);
		expect(answer?.context).toContain(GOAL_STATUS.yours);
		expect(ownedGoal(cwd)?.condition).toBe(asked.consent?.condition);
		// The consent is spent: a second yes starts and arms nothing.
		expect(planAnswer({ cwd, prompt: "yes", sessionId: "s1", now: now + 2000 })).toBeNull();
	});

	it("R1: yes on a plan with no goal starts the work alone", () => {
		const cwd = project(PLAN.replace("`npm test`", "`it works`"));
		const now = Date.parse("2026-11-18T10:00:00Z");
		proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		const answer = planAnswer({ cwd, prompt: "yes", sessionId: "s1", now });
		expect(answer?.start).toBe("start-work retry");
		expect(answer?.context).not.toContain("create_goal");
		expect(ownedGoal(cwd)).toBeNull();
	});

	it("R1: when the work cannot start, the goal is not armed either", () => {
		const cwd = project();
		const now = Date.parse("2026-11-18T10:00:00Z");
		proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		const answer = planAnswer({
			cwd,
			prompt: "yes",
			sessionId: "s1",
			now,
			startCheck: () => "another start-work run is active; finish or cancel it first",
		});
		expect(answer?.start).toBeNull();
		expect(answer?.context).toContain(
			"Work not started and no goal set: another start-work run is active; finish or cancel it first",
		);
		expect(ownedGoal(cwd)).toBeNull();
	});

	it("R1: the real start check refuses a plan whose rows are all ticked", () => {
		const cwd = project();
		const now = Date.parse("2026-11-18T10:00:00Z");
		proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		writeFileSync(join(cwd, ".litcodex", "plans", "retry.md"), PLAN.replace("- [ ] 1.", "- [x] 1."));
		const answer = planAnswer({ cwd, prompt: "yes", sessionId: "s1", now });
		expect(answer?.start).toBeNull();
		expect(answer?.context).toContain("is not an open plan");
		expect(ownedGoal(cwd)).toBeNull();
	});

	it("R1: no, edit, silence, a stale consent and a tampered consent start and arm nothing", () => {
		const now = Date.parse("2026-11-18T10:00:00Z");
		const no = project();
		proposeGoal({ cwd: no, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		const said = planAnswer({ cwd: no, prompt: "no", sessionId: null, now });
		expect(said).toMatchObject({ start: null });
		expect(said?.context).toContain("No goal set: you said no");
		expect(ownedGoal(no)).toBeNull();
		const edit = project();
		proposeGoal({ cwd: edit, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		const edited = planAnswer({ cwd: edit, prompt: "edit", sessionId: null, now });
		expect(edited?.start).toBeNull();
		expect(edited?.context).toContain("goal propose");
		const silent = project();
		proposeGoal({ cwd: silent, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		expect(
			planAnswer({ cwd: silent, prompt: "let me think about the cache first", sessionId: null, now }),
		).toBeNull();
		expect(ownedGoal(silent)).toBeNull();
		const stale = project();
		proposeGoal({ cwd: stale, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		expect(planAnswer({ cwd: stale, prompt: "yes", sessionId: null, now: now + 31 * 60_000 })).toBeNull();
		sweepGoalState(stale, now + 31 * 60_000);
		expect(readdirSync(join(stale, GOAL_DIR))).toEqual([]);
		const tampered = project();
		proposeGoal({ cwd: tampered, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		const path = join(tampered, GOAL_DIR, "consent.json");
		writeFileSync(path, readFileSync(path, "utf8").replace("retry.md", "other.md"));
		expect(planAnswer({ cwd: tampered, prompt: "yes", sessionId: null, now })).toBeNull();
	});

	it("gives the user the clear line on cancel only for a goal LitCodex owns", () => {
		const cwd = project();
		expect(goalCancelContext(cwd)).toBeNull();
		const now = Date.now();
		proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1), now });
		planAnswer({ cwd, prompt: "yes", sessionId: "s1", now });
		const cancel = goalCancelContext(cwd);
		expect(cancel).toContain("Codex lets only you clear it: /goal clear");
		expect(cancel).toContain("Any other goal is the user's own");
		expect(ownedGoal(cwd)).toBeNull();
	});

	it("R1 reaches the prompt hook: `yes` routes the start-work route and injects the native goal steps", async () => {
		const cwd = project();
		proposeGoal({ cwd, planArg: ".litcodex/plans/retry.md", run: exits(1) });
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		let out = "";
		stdout.on("data", (chunk) => {
			out += chunk.toString();
		});
		stdin.end(JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd, prompt: "yes" }));
		expect(await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), cwd)).toBe(0);
		expect(out).toContain("create_goal");
		expect(out).toContain("LIT IGNITED · start-work");
		expect(ownedGoal(cwd)).not.toBeNull();
	});

	it("removes every 'continue without the goal tools' fallback sentence", () => {
		const sources = ["./codex-goal-instruction.ts", "./codex-hook.ts", "../directive.md"].map((rel) =>
			readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"),
		);
		for (const text of sources) {
			expect(text).not.toContain("native-goal-unavailable");
			expect(text).not.toMatch(/not exposed (?:by|in) (?:this|the current) Codex session/u);
		}
	});
});

// ── lit-loop's own goal question: no plan, and a `yes` starts no start-work run ──────────────────────────

function loopProject(
	files: Record<string, string> = { "package.json": JSON.stringify({ scripts: { test: "vitest" } }) },
): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-loopgoal-")));
	roots.push(root);
	for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
	return root;
}

async function firePrompt(
	cwd: string,
	prompt: string,
	turn = 1,
	sessionId = "loop-s1",
): Promise<{ stdout: string; context: string; message: string }> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: sessionId, turn_id: `t${turn}`, cwd, prompt }),
	);
	const home = join(cwd, ".home");
	mkdirSync(home, { recursive: true });
	await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), cwd, { env: { CODEX_HOME: home } });
	const parsed =
		out === ""
			? {}
			: (JSON.parse(out) as { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } });
	return {
		stdout: out,
		context: parsed.hookSpecificOutput?.additionalContext ?? "",
		message: parsed.systemMessage ?? "",
	};
}

const consentFile = (cwd: string): Record<string, unknown> | null => {
	try {
		return JSON.parse(readFileSync(join(cwd, GOAL_DIR, "consent.json"), "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
};

describe("lit-loop goal question", () => {
	it("compiles `<check> exits 0 and this is done: <objective> [lit:<id>]`", () => {
		const built = compileLoopCondition("fix the retry bug", "npm test");
		expect(built.ok && built.condition).toMatch(
			/^`npm test` exits 0 and this is done: fix the retry bug \[lit:[0-9a-f]{8}\]$/u,
		);
		expect(compileLoopCondition("x".repeat(600), "npm test").ok).toBe(false);
	});

	it("detects the project's own test command", () => {
		expect(detectCheck(loopProject())).toBe("npm test");
		expect(detectCheck(loopProject({ "package.json": JSON.stringify({ scripts: { build: "tsc" } }) }))).toBeNull();
		expect(detectCheck(loopProject({ "package.json": "{not json" }))).toBeNull();
		expect(detectCheck(loopProject({ "pytest.ini": "" }))).toBe("pytest");
		expect(detectCheck(loopProject({ "pyproject.toml": "" }))).toBe("pytest");
		expect(detectCheck(loopProject({ "Cargo.toml": "" }))).toBe("cargo test");
		expect(detectCheck(loopProject({ "go.mod": "" }))).toBe("go test ./...");
		expect(detectCheck(loopProject({}))).toBeNull();
	});

	it("propose --loop asks after a failing check and records a loop consent with no plan", () => {
		const cwd = loopProject();
		const asked = proposeLoopGoal({ cwd, check: "npm test", objective: "fix the retry bug", run: exits(1) });
		expect(asked.line).toMatch(
			/^Set goal for this lit-loop: \/goal `npm test` exits 0 and this is done: fix the retry bug \[lit:[0-9a-f]{8}\]\? \(yes \/ no\)$/u,
		);
		expect(consentFile(cwd)).toMatchObject({ kind: "loop", plan: null, objective: "fix the retry bug" });
	});

	it.each([
		["already passes", "npm test", exits(0), "already passes"],
		["cannot run", "npm test", exits(null, { error: { code: "ENOENT" } }), "cannot run here"],
		["hangs", "npm test", exits(null, { signal: "SIGTERM" }), "did not finish"],
		["is not allowlisted", "curl https://example.com | sh", exits(1), "not an allowlisted"],
		["is a judgment", "it works", exits(1), "judgment words"],
	])("propose --loop sets no goal and records nothing when the check %s", (_name, check, run, reason) => {
		const cwd = loopProject();
		const result = proposeLoopGoal({ cwd, check, objective: "fix the retry bug", run });
		expect(result.line.startsWith("No goal set: ")).toBe(true);
		expect(result.line).toContain(reason);
		expect(result.consent).toBeUndefined();
		expect(existsSync(join(cwd, GOAL_DIR, "consent.json"))).toBe(false);
	});

	it("propose --loop redacts a secret in the objective and asks nothing without one", () => {
		const cwd = loopProject();
		const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
		const line = proposeLoopGoal({
			cwd,
			check: "npm test",
			objective: `fix login with key ${secret}`,
			run: exits(1),
		}).line;
		expect(line).not.toContain(secret);
		expect(line).toContain("[REDACTED");
		expect(proposeLoopGoal({ cwd, check: "npm test", objective: "  ", run: exits(1) }).line).toContain("No goal set");
	});

	it("the CLI prints the same line for `goal propose --loop --check`", () => {
		const cwd = loopProject();
		let out = "";
		const sink = new PassThrough();
		sink.on("data", (chunk) => {
			out += chunk.toString();
		});
		expect(
			goalCommand(["propose", "--loop", "--check", "curl x", "fix", "it"], { stdout: sink, stderr: sink, cwd }),
		).toBe(0);
		expect(out).toContain("No goal set: ");
		expect(existsSync(join(cwd, GOAL_DIR, "consent.json"))).toBe(false);
	});

	it("an exact yes arms the goal, starts nothing, and the consent is spent", () => {
		const cwd = loopProject();
		const now = Date.parse("2026-11-20T10:00:00Z");
		const asked = proposeLoopGoal({ cwd, check: "npm test", objective: "fix the retry bug", run: exits(1), now });
		expect(planAnswer({ cwd, prompt: "yes please", sessionId: "s1", now })).toBeNull();
		// Any prompt that is not an answer ends the question.
		expect(existsSync(join(cwd, GOAL_DIR, "consent.json"))).toBe(false);
		proposeLoopGoal({ cwd, check: "npm test", objective: "fix the retry bug", run: exits(1), now });
		const answer = planAnswer({ cwd, prompt: " YES ", sessionId: "s1", now: now + 1000 });
		expect(answer?.start).toBeNull();
		expect(answer?.context).toContain(
			`create_goal\` with exactly ${JSON.stringify({ objective: asked.consent?.condition })}`,
		);
		expect(answer?.context).toContain(GOAL_STATUS.yours);
		expect(answer?.context).not.toContain("start-work run below");
		expect(ownedGoal(cwd)?.condition).toBe(asked.consent?.condition);
		expect(planAnswer({ cwd, prompt: "yes", sessionId: "s1", now: now + 2000 })).toBeNull();
	});

	it("no, edit, a stale and a tampered question arm nothing", () => {
		const now = Date.parse("2026-11-20T10:00:00Z");
		const ask = (): string => {
			const cwd = loopProject();
			proposeLoopGoal({ cwd, check: "npm test", objective: "fix the retry bug", run: exits(1), now });
			return cwd;
		};
		const no = ask();
		expect(planAnswer({ cwd: no, prompt: "no", sessionId: null, now })?.context).toContain(
			"No goal set: you said no",
		);
		expect(ownedGoal(no)).toBeNull();
		const edit = ask();
		expect(planAnswer({ cwd: edit, prompt: "edit", sessionId: null, now })).toBeNull();
		expect(ownedGoal(edit)).toBeNull();
		expect(existsSync(join(edit, GOAL_DIR, "consent.json"))).toBe(false);
		const stale = ask();
		expect(planAnswer({ cwd: stale, prompt: "yes", sessionId: null, now: now + 31 * 60_000 })).toBeNull();
		expect(ownedGoal(stale)).toBeNull();
		const tampered = ask();
		const path = join(tampered, GOAL_DIR, "consent.json");
		writeFileSync(path, readFileSync(path, "utf8").replace("npm test", "rm -rf x"));
		expect(planAnswer({ cwd: tampered, prompt: "yes", sessionId: null, now })).toBeNull();
		expect(ownedGoal(tampered)).toBeNull();
		const asPlan = ask();
		writeFileSync(
			join(asPlan, GOAL_DIR, "consent.json"),
			readFileSync(join(asPlan, GOAL_DIR, "consent.json"), "utf8").replace(
				'"plan":null',
				'"plan":".litcodex/plans/x.md"',
			),
		);
		expect(planAnswer({ cwd: asPlan, prompt: "yes", sessionId: null, now })).toBeNull();
	});

	it("the first lit-loop prompt shows the question and tells the model not to ask again", async () => {
		const cwd = loopProject();
		const first = await firePrompt(cwd, "lit-loop fix the retry bug");
		expect(first.message).toContain("LIT IGNITED · lit-loop");
		expect(first.message).toMatch(
			/Set goal for this lit-loop: \/goal `npm test` exits 0 and this is done: fix the retry bug \[lit:[0-9a-f]{8}\]\? \(yes \/ no\)/u,
		);
		expect(first.context).toContain("Do not ask it again");
		expect(first.context).toContain("Never call `create_goal` or type `/goal` yourself");
		expect(first.context).not.toContain("goal propose --loop");
		expect(consentFile(cwd)).toMatchObject({ kind: "loop", plan: null });
		// A repeat of the same route is a continue: no second question.
		const repeat = await firePrompt(cwd, "lit-loop and add a test", 2);
		expect(repeat.message).not.toContain("Set goal for this lit-loop");
	});

	it("a request that ends with lit asks the goal question with the words before it", async () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["fix the retry bug lit", "fix the retry bug"],
			["로그인 버튼 고쳐줘 lit", "로그인 버튼 고쳐줘"],
			["로그인 버튼 고쳐줘. 부탁해 lit", "로그인 버튼 고쳐줘. 부탁해"],
		];
		for (const [prompt, objective] of cases) {
			const fired = await firePrompt(loopProject(), prompt);
			expect(fired.message, prompt).toContain("LIT IGNITED · lit-loop");
			expect(fired.message, prompt).toContain(`\`npm test\` exits 0 and this is done: ${objective} [lit:`);
			expect(fired.context, prompt).toContain("Do not ask it again");
		}
	});

	it("a trailing lit-loop or litwork routes like a leading one and asks with the words before it", async () => {
		const cases: ReadonlyArray<readonly [string, string, string]> = [
			["로그인 버튼 고쳐줘 lit-loop", "lit-loop", "로그인 버튼 고쳐줘"],
			["fix the retry bug lit-loop", "lit-loop", "fix the retry bug"],
			["fix the retry bug litwork", "litwork", "fix the retry bug"],
		];
		for (const [prompt, route, objective] of cases) {
			const fired = await firePrompt(loopProject(), prompt);
			expect(fired.message, prompt).toContain(`LIT IGNITED · ${route}`);
			expect(fired.message, prompt).toContain(`\`npm test\` exits 0 and this is done: ${objective} [lit:`);
		}
	});

	it("a leading lit-loop, litwork, lit loop or lit work carries its task into the question", async () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["lit-loop fix the retry bug", "lit-loop"],
			["litwork fix the retry bug", "litwork"],
			["lit loop fix the retry bug", "lit-loop"],
			// `lit work` (space) is a bare `lit`, so it runs lit-loop; only the glued `litwork` is the work mode.
			["lit work fix the retry bug", "lit-loop"],
		];
		for (const [prompt, route] of cases) {
			const fired = await firePrompt(loopProject(), prompt);
			expect(fired.message, prompt).toContain(`LIT IGNITED · ${route}`);
			expect(fired.message, prompt).toContain("`npm test` exits 0 and this is done: fix the retry bug [lit:");
		}
	});

	it("lit continue, lit resume and a question about the word ask no goal", async () => {
		for (const prompt of ["lit continue", "lit resume", "lit 계속", "lit-loop continue", "what does lit-loop do?"]) {
			const cwd = loopProject();
			const fired = await firePrompt(cwd, prompt);
			expect(fired.message, prompt).not.toContain("Set goal for this");
			expect(fired.context, prompt).not.toContain("goal propose --loop");
			expect(consentFile(cwd), prompt).toBeNull();
		}
	});

	it("litwork gets the question; its yes arms the goal without start-work, and the prompt is not a lit route", async () => {
		const cwd = loopProject({ "pytest.ini": "" });
		const first = await firePrompt(cwd, "litwork ship the parser fix");
		expect(first.message).toContain("`pytest` exits 0 and this is done: ship the parser fix");
		const yes = await firePrompt(cwd, "yes", 2);
		expect(yes.context).toContain("create_goal");
		expect(yes.context).toContain("starts no start-work run");
		expect(yes.stdout).not.toContain("LIT IGNITED");
		expect(ownedGoal(cwd)).not.toBeNull();
	});

	it("no answer, no question: bare lit, litgoal, lit-plan, review-work, an owned goal and a pending plan question", async () => {
		const noTest = loopProject({});
		const fallback = await firePrompt(noTest, "lit-loop fix the retry bug");
		expect(fallback.message).not.toContain("Set goal for this lit-loop");
		expect(fallback.context).toContain("goal propose --loop");
		expect(consentFile(noTest)).toBeNull();
		for (const prompt of ["lit", "litgoal fix the retry bug", "lit-plan fix the retry bug", "review-work the diff"]) {
			const cwd = loopProject();
			const fired = await firePrompt(cwd, prompt);
			expect(fired.message, prompt).not.toContain("Set goal for this lit-loop");
			expect(fired.context, prompt).not.toContain("goal propose --loop");
			expect(consentFile(cwd), prompt).toBeNull();
		}
		const owned = loopProject();
		mkdirSync(join(owned, GOAL_DIR), { recursive: true });
		const condition = "`npm test` exits 0 and this is done: x [lit:00000000]";
		writeFileSync(
			join(owned, GOAL_DIR, "owner.json"),
			JSON.stringify({ version: 1, condition, hash: conditionHash(condition), id: "00000000", plan: null }),
		);
		expect((await firePrompt(owned, "lit-loop fix the retry bug")).message).not.toContain(
			"Set goal for this lit-loop",
		);
		// A plan's approval question stays open until answered, so it blocks a second question.
		const pending = project();
		writeFileSync(join(pending, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
		proposeGoal({ cwd: pending, planArg: ".litcodex/plans/retry.md", run: exits(1) });
		const before = readFileSync(join(pending, GOAL_DIR, "consent.json"), "utf8");
		expect((await firePrompt(pending, "lit-loop fix the retry bug")).message).not.toContain(
			"Set goal for this lit-loop",
		);
		expect(readFileSync(join(pending, GOAL_DIR, "consent.json"), "utf8")).toBe(before);
	});

	it("a secret in the activating prompt never reaches the question or the consent file", async () => {
		const cwd = loopProject();
		const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
		const fired = await firePrompt(cwd, `lit-loop fix login using ${secret}`);
		expect(fired.message).not.toContain(secret);
		expect(readFileSync(join(cwd, GOAL_DIR, "consent.json"), "utf8")).not.toContain(secret);
		expect(fired.message).toContain("[REDACTED");
	});

	it("a goal that update_goal marked complete no longer blocks the next question, and a clear line is no longer due", async () => {
		const cwd = loopProject();
		await firePrompt(cwd, "lit-loop fix the retry bug", 1, "done-s1");
		await firePrompt(cwd, "yes", 2, "done-s1");
		expect(ownedGoal(cwd)).not.toBeNull();
		const toolEvent = (tool_input: unknown, tool_name = "update_goal"): string =>
			JSON.stringify({
				hook_event_name: "PostToolUse",
				session_id: "done-s1",
				turn_id: "t3",
				cwd,
				tool_name,
				tool_input,
				tool_response: "ok",
			});
		const post = async (payload: string): Promise<void> => {
			const stdin = new PassThrough();
			stdin.end(payload);
			await runPostToolUseLiveHookCli(stdin, new PassThrough(), new PassThrough());
		};
		// Another tool, or another status, closes nothing.
		await post(toolEvent({ status: "complete" }, "create_goal"));
		await post(toolEvent({ status: "paused" }));
		expect(ownedGoal(cwd)).not.toBeNull();
		await post(toolEvent({ status: "complete" }));
		expect(ownedGoal(cwd)).toBeNull();
		expect(goalCancelContext(cwd)).toBeNull();
		const next = await firePrompt(cwd, "lit-loop fix the parser too", 4, "done-s2");
		expect(next.message).toContain("Set goal for this lit-loop");
	});
});
