// The start-work autopilot: turn-end decisions, parked steps, the inbox and its answers, the run charter, the native
// goal opt-in and the tier table. Scenario ids (S-A1-01 …, S-SEC-01 …) name the family acceptance list.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	ANSWER_MAX_CHARS,
	CHECK_CAP_MS,
	checkArgv,
	driveStop,
	INBOX_MAX_CHARS,
	inboxText,
	loadRun,
	parseRunWord,
	REPLAY_BUDGET_MS,
} from "../src/autopilot.js";
import { parkStep, readAutopilot, updateAutopilot, withWork, workOf } from "../src/autopilot-store.js";
import { runStopHook, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { readLifecycleState } from "../src/lifecycle-store.js";
import { readPlanFacts } from "../src/plan-rows.js";
import { runPreToolUseFallback, runPreToolUseHook, uncheckedDecision } from "../src/pre-tool-hook.js";
import { assessCommand, parkedTier, type ShellContext } from "../src/shell-tier.js";
import {
	startRun as baseStart,
	boundaryFor,
	cleanupProjects,
	contextOf,
	PLAN,
	type Project,
	pause,
	project,
	promptInput,
} from "./autopilot-fixture.js";

afterEach(cleanupProjects);

/**
 * A path as a POSIX shell word. The guard reads commands the way `sh` does, where a Windows path's backslashes are
 * escapes; forward slashes name the same place there.
 */
const posix = (path: string): string => path.replaceAll("\\", "/");

/** The store only starts a run on a plan with Todos and a final wave; the test's own plan replaces it afterwards. */
function startRun(p: Project): void {
	const wanted = readFileSync(planFile(p), "utf8");
	writePlan(p, PLAN);
	baseStart(p);
	writePlan(p, wanted);
}

const TWO_ROWS = "## Todos\n- [ ] 1. First\n- [ ] 2. Second\n\n## Done when\ncheck: `node check.mjs`\n";
const TICKED = "## Todos\n- [x] 1. First\n- [x] 2. Second\n\n## Done when\ncheck: `node check.mjs`\n";

function planFile(p: Project): string {
	return join(p.root, ".litcodex", "plans", "plan.md");
}

function writePlan(p: Project, text: string): void {
	writeFileSync(planFile(p), text, "utf8");
}

function check(p: Project, body = "process.exit(0);\n"): void {
	writeFileSync(join(p.root, "check.mjs"), body, "utf8");
}

const stop = (p: Project, turn: string, reentry = false, message?: string) => ({
	hook_event_name: "Stop",
	session_id: "s1",
	turn_id: turn,
	transcript_path: null,
	cwd: p.root,
	model: "gpt",
	permission_mode: "default",
	stop_hook_active: reentry,
	...(message === undefined ? {} : { last_assistant_message: message }),
});

function bash(p: Project, command: string, cwd = p.real): string {
	return runPreToolUseHook(
		{
			hook_event_name: "PreToolUse",
			session_id: "s1",
			turn_id: "t",
			cwd,
			tool_name: "Bash",
			tool_input: { command },
		},
		p.options,
	);
}

function denied(out: string): string {
	const parsed = JSON.parse(out) as {
		hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
	};
	expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
	return parsed.hookSpecificOutput.permissionDecisionReason;
}

function ctx(p: Project, cwd = p.real, extra: Partial<ShellContext> = {}): ShellContext {
	return { cwd, project: p.real, roots: [p.real], env: p.env, ...extra };
}

function tierOf(p: Project, command: string, cwd = p.real, roots: readonly string[] = [p.real]) {
	return parkedTier(command, ctx(p, cwd, { roots }));
}

function steps(p: Project) {
	return workOf(readAutopilot(p.root), "w1", "codex:s1").steps;
}

function answer(p: Project, prompt: string, turn = "u1"): string {
	return contextOf(runUserPromptSubmitHook(promptInput(p.root, prompt, "s1", turn), p.options));
}

/** Drive plain turn-ends until the inbox is drawn; returns its text. */
function drawInbox(p: Project): string {
	for (let turn = 1; turn <= 4; turn += 1) {
		const out = runStopHook(stop(p, `inbox-${turn}-${Math.random()}`));
		if (out.includes('"systemMessage"')) return (JSON.parse(out) as { systemMessage: string }).systemMessage;
	}
	throw new Error("the inbox was never drawn");
}

/**
 * Store parked steps the way the guard does. The LitCodex store always grants the run's own project, so a B-shaped
 * call never needs parking there; B steps reach the list only from narrower grants, which these stored steps stand in for.
 */
function store(p: Project, commands: readonly string[], tier: "B" | "X" = "B", cwd = p.real): void {
	updateAutopilot(p.root, (file) => {
		let work = workOf(file, "w1", "codex:s1");
		for (const command of commands) {
			work = parkStep(
				work,
				{ command, cwd, tier, held: null, outward: false, row: "1" },
				`${command}-${Math.random()}`,
			).work;
		}
		return { next: withWork(file, "w1", work), result: undefined };
	});
}

function outsideDir(p: Project, name: string): string {
	const path = join(p.real, "..", name);
	mkdirSync(path, { recursive: true });
	return realpathSync(path);
}

describe("A1 turn-end decision", () => {
	it("S-A1-01: every row ticked and the check passing closes the run with one line, no typed word", () => {
		const p = project(TICKED);
		check(p);
		startRun(p);
		const out = runStopHook(stop(p, "t1"));
		const message = (JSON.parse(out) as { systemMessage: string }).systemMessage;
		expect(message).toBe("plan is complete: every row is ticked and `node check.mjs` passed.");
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("completed");
		expect(runStopHook(stop(p, "t2"))).toBe("");
	});

	it("S-A1-02: no Done-when check and every row ticked completes and says there is no check", () => {
		const p = project("## Todos\n- [x] 1. First\n");
		startRun(p);
		expect(runStopHook(stop(p, "t1"))).toContain("the plan has no Done-when check");
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("completed");
	});

	it("S-A1-03 / S-A6-02: the last row ticked during a continuation closes the run on the re-entry turn-end", () => {
		const p = project(TWO_ROWS);
		check(p);
		startRun(p);
		expect(JSON.parse(runStopHook(stop(p, "t1")))).toMatchObject({ decision: "block" });
		writePlan(p, TICKED);
		const reentry = runStopHook(stop(p, "t1", true));
		expect(reentry).toContain("is complete");
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("completed");
	});

	it("S-A1-04: a failing check keeps the run going and names the exit code", () => {
		const p = project(TICKED);
		check(p, "process.exit(3);\n");
		startRun(p);
		const reason = (JSON.parse(runStopHook(stop(p, "t1"))) as { reason: string }).reason;
		expect(reason).toContain("`node check.mjs` exited 3");
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("active");
	});

	it("S-A1-05 / S-A1-06: a check past its cap is killed, kept for this turn, and rerun on a new turn", () => {
		const p = project(TICKED);
		check(p, "setTimeout(() => {}, 5000);\n");
		startRun(p);
		const env = { ...process.env, LITCODEX_START_WORK_CHECK_TIMEOUT_MS: "300" };
		const run = loadRun(p.root, "s1");
		if (run === null) throw new Error("no run");
		const first = driveStop(run, { sessionId: "s1", turnId: "t1", cwd: p.root, reentry: false }, () => "d", { env });
		expect(first.stdout).toContain("timed out");
		const started = Date.now();
		const again = driveStop(
			loadRun(p.root, "s1") ?? run,
			{ sessionId: "s1", turnId: "t1", cwd: p.root, reentry: true },
			() => "d",
			{
				env,
			},
		);
		expect(Date.now() - started).toBeLessThan(250);
		expect(again.stdout).toContain("timed out");
		check(p);
		const next = driveStop(
			loadRun(p.root, "s1") ?? run,
			{ sessionId: "s1", turnId: "t2", cwd: p.root, reentry: false },
			() => "d",
			{
				env,
			},
		);
		expect(next.decision).toBe("done");
		expect(env.LITCODEX_START_WORK_CHECK_TIMEOUT_MS).toBe("300");
	});

	it("C-6: a check past its cap is killed with everything it started", async () => {
		const p = project(TICKED);
		check(
			p,
			'import { spawn } from "node:child_process";\nspawn(process.execPath, ["-e", "setTimeout(() => require(\\"node:fs\\").writeFileSync(\\"late.txt\\", \\"x\\"), 1200)"], { stdio: "ignore" });\nsetTimeout(() => {}, 5000);\n',
		);
		startRun(p);
		const run = loadRun(p.root, "s1");
		if (run === null) throw new Error("no run");
		const env = { ...process.env, LITCODEX_START_WORK_CHECK_TIMEOUT_MS: "400" };
		const first = driveStop(run, { sessionId: "s1", turnId: "t1", cwd: p.root, reentry: false }, () => "d", { env });
		expect(first.stdout).toContain("timed out");
		await new Promise((done) => setTimeout(done, 1800));
		expect(existsSync(join(p.root, "late.txt"))).toBe(false);
	});

	it("S-A1-07 / S-SEC-36: a check with shell syntax or an unlisted program is never run", () => {
		for (const line of [
			"node a.mjs; touch x",
			"node a.mjs | cat",
			"node $(x)",
			"rm -rf x",
			"bash -c x",
			"node 'a'",
		]) {
			expect(checkArgv(line)).toBeNull();
		}
		expect(checkArgv("node /abs/check.mjs --flag")).toEqual(["node", "/abs/check.mjs", "--flag"]);
		const p = project("## Todos\n- [x] 1. First\n\n## Done when\ncheck: `node check.mjs; touch pwned`\n");
		check(p);
		startRun(p);
		expect(runStopHook(stop(p, "t1"))).toContain("is not an allowlisted check");
		expect(existsSync(join(p.root, "pwned"))).toBe(false);
	});

	it("S-A1-08: only local parked steps are set aside at completion and named", () => {
		const p = project(TICKED);
		check(p);
		startRun(p);
		store(p, ["touch fresh.txt"]);
		const out = runStopHook(stop(p, "t1"));
		expect(out).toContain("is complete");
		expect(out).toContain("1 set-aside step was not run: `touch fresh.txt`");
		expect(existsSync(join(p.root, "fresh.txt"))).toBe(false);
	});

	it("S-A1-09 / S-SEC-22 / S-SEC-24: a parked outward step keeps a green run in wrap-up", () => {
		for (const command of ["git push origin main", "git pu", "rm -rf ../dist-old", "make ship"]) {
			const p = project(TICKED);
			check(p);
			startRun(p);
			denied(bash(p, command));
			const out = runStopHook(stop(p, "t1"));
			expect(out).toContain('"systemMessage"');
			expect(out).toContain("needs your answer");
			expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("active");
		}
	});

	it("S-A1-10 / S-A6-06: a running lane keeps the run open; a lane silent 30+ minutes is named", () => {
		const p = project(TICKED);
		check(p);
		startRun(p);
		const lanes = join(p.root, ".litcodex", "lane-state", "s1");
		mkdirSync(lanes, { recursive: true });
		writeFileSync(join(lanes, "lane-a1.json"), JSON.stringify({ started: true, at: Date.now(), name: "lane-a" }));
		expect(runStopHook(stop(p, "t1"))).toContain("its lanes are still running (lane-a)");
		writeFileSync(
			join(lanes, "lane-a1.json"),
			JSON.stringify({ started: true, at: Date.now() - 40 * 60 * 1000, name: "lane-a" }),
		);
		writePlan(p, TWO_ROWS);
		const run = loadRun(p.root, "s1");
		if (run === null) throw new Error("no run");
		expect(inboxText(run, readAutopilot(p.root), ["lane-a"])).toContain(
			"Lane lane-a has sent nothing for 30+ minutes",
		);
	});

	it("S-A1-11 / S-A3-13: every open row impossible gives the impossible decision with each reason", () => {
		const p = project("## Todos\n- [x] 1. First\n- [ ] 2. Second\n  IMPOSSIBLE: the API was removed\n");
		startRun(p);
		const out = runStopHook(stop(p, "t1"));
		const message = (JSON.parse(out) as { systemMessage: string }).systemMessage;
		expect(message).toContain("2. Second: IMPOSSIBLE: the API was removed");
		expect(message).toContain("lit skip-row");
		expect(runStopHook(stop(p, "t2"))).toBe("");
	});
});

describe("A2 park instead of stop", () => {
	it("S-A2-01: a refused shell call is parked with its text, folder, tier and row, and the model continues", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const out = bash(p, "git push origin main");
		const reason = denied(out);
		expect(reason).toContain("parked this call (tier X");
		expect(reason).toContain("Continue with the next row now");
		expect(reason).not.toMatch(/stop and ask|lit cancel/u);
		expect((JSON.parse(out) as { systemMessage: string }).systemMessage).toContain(
			"LIT parked (tier X): git push origin main",
		);
		expect(steps(p)).toMatchObject([
			{ command: "git push origin main", cwd: p.real, tier: "X", outward: true, row: "1" },
		]);
	});

	it("S-A2-02: the same command refused again says it is already parked, with no duplicate", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		bash(p, "git push origin main");
		bash(p, "git push origin main");
		expect(denied(bash(p, "git push origin main"))).toContain("already parked (asked 3 times)");
		expect(steps(p)).toHaveLength(1);
	});

	it("S-A2-03: at most 16 X steps are kept; the overflow is reported, not stored silently", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		for (let index = 0; index < 16; index += 1) denied(bash(p, `git push origin b${index}`));
		const out = bash(p, "git push origin b16");
		expect(denied(out)).toContain("the parked list is full");
		expect(steps(p)).toHaveLength(16);
		expect(workOf(readAutopilot(p.root), "w1", "codex:s1").overflow).toBe(1);
	});

	it("S-A2-04: tier B is the allowlist only, with every path fresh and inside the project", () => {
		const p = project(TWO_ROWS);
		mkdirSync(join(p.real, "src"), { recursive: true });
		writeFileSync(join(p.real, "src", "a.mjs"), "x\n");
		const narrow = [join(p.real, "src")];
		for (const command of [
			"touch fresh.txt",
			"mkdir -p out/dir",
			"cp src/a.mjs src/copy.mjs",
			"mv src/a.mjs src/renamed.mjs",
			"cd src && touch b.txt",
			"git add src/a.mjs",
		]) {
			expect(tierOf(p, command, p.real, narrow), command).toMatchObject({ kind: "tier", tier: "B", held: null });
		}
		expect(assessCommand("touch fresh.txt", ctx(p, p.real, { roots: narrow }))).toMatchObject({
			kind: "park",
			tier: "B",
		});
	});

	it("S-A2-05 / S-SEC-18 / S-SEC-19 / S-SEC-20 / S-SEC-21: everything else parked is X", () => {
		const p = project(TWO_ROWS);
		for (const command of [
			"node ok.mjs --write x",
			"python3 x.py",
			"bash run.sh",
			"./run.sh",
			"npm run build",
			"npm test",
			"npx x",
			"make all",
			"gh pr merge 12",
			"npm unpublish x",
			"curl -X POST https://example.invalid/a",
			"ssh host ls",
			"docker push x",
			"rm -rf build",
			"git push origin b",
			"git tag v1",
			"npm publish",
			"git reset --hard",
			"git clean -fd",
			"git config x y",
			"npm version patch",
		]) {
			expect(tierOf(p, command), command).toMatchObject({ kind: "tier", tier: "X" });
		}
		for (const command of [
			"git push origin b",
			"npm publish",
			"git tag v1",
			"curl -X POST https://example.invalid/a",
			"make ship",
			"npm run clean",
			"pnpm exec x",
			"yarn dlx x",
			"bun x y",
			"npm run-script x",
		]) {
			expect(tierOf(p, command), command).toMatchObject({ outward: true });
		}
	});

	it("S-A2-06: a held step is listed as held and survives lit approve, lit approve x and a second lit approve", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		denied(bash(p, 'cat "$HOME"/notes.txt'));
		denied(bash(p, "git push origin main"));
		expect(drawInbox(p)).toContain("held, never replayed: an expansion");
		answer(p, "lit approve");
		answer(p, "lit approve x", "u2");
		answer(p, "lit approve", "u3");
		expect(steps(p).map((step) => step.command)).toContain('cat "$HOME"/notes.txt');
	});

	it("S-A2-07 / S-SEC-25..28: refused steps are denied, never stored and never listed", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.home, ".aws"), { recursive: true });
		for (const command of [
			"cat .env",
			`cd ${posix(p.home)} && cat .aws/credentials`,
			`cat ${posix(p.home)}/.co""dex/config.toml`,
			`cat ${posix(p.home)}/.c'o'dex/config.toml`,
			"cd ~someone && ls",
			"cd",
			"cat ~/.ssh/config",
			`cat ${posix(p.codexHome)}/config.toml`,
		]) {
			const out = bash(p, command);
			expect(out, command).not.toBe("");
			expect(denied(out), command).toContain("refused this call");
		}
		expect(steps(p)).toHaveLength(0);
	});

	it("S-A2-08 / S-A2-09: a shape-only self-check runs; a mixed one with a mutating part parks", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		for (const command of ['node check.mjs; echo "exit=$?"', "node ok.mjs 2>&1; echo $?", "cat src/a.mjs || true"]) {
			expect(bash(p, command), command).toBe("");
		}
		expect(denied(bash(p, "node ok.mjs || git push"))).toContain("parked");
		expect(denied(bash(p, "node ok.mjs; rm -rf ../zz"))).toContain("parked");
		expect(steps(p)).toHaveLength(2);
	});

	it("S-A2-10: ordinary project work passes with no output", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		for (const command of ["npm test", "node scripts/build.mjs", "touch notes.txt", "git status", "rg foo src"]) {
			expect(bash(p, command), command).toBe("");
		}
	});
});

describe("A3 one inbox and its answers", () => {
	it("S-A3-01 / S-A3-02 / S-A3-03: only waiting rows and parked steps left: one inbox with a snapshot, then silence", () => {
		const p = project("## Todos\n- [ ] 1. First\n  BLOCKED: needs the API key\n- [x] 2. Second\n");
		startRun(p);
		denied(bash(p, "git push origin main"));
		const inbox = runStopHook(stop(p, "t3"));
		const message = (JSON.parse(inbox) as { systemMessage: string }).systemMessage;
		expect(message).toContain("1. First: BLOCKED: needs the API key");
		expect(message).toContain("[X] in");
		expect(message).toContain("`git push origin main`");
		expect(message).toContain("`lit approve x`, typed exactly");
		expect(runStopHook(stop(p, "t4"))).toBe("");
		const snapshot = workOf(readAutopilot(p.root), "w1", "codex:s1").snapshot;
		expect(snapshot?.steps).toMatchObject([{ command: "git push origin main", cwd: p.real, tier: "X" }]);
	});

	it("S-A3-04 / S-A3-08 / S-SEC-34: approve words are parsed from the whole typed prompt only", () => {
		expect(parseRunWord("lit approve")).toEqual({ kind: "approve" });
		expect(parseRunWord("  lit\tapprove ")).toEqual({ kind: "approve" });
		expect(parseRunWord("LIT approve")).toBeNull();
		expect(parseRunWord("lit 승인")).toEqual({ kind: "approve" });
		expect(parseRunWord("lit approve x")).toEqual({ kind: "approve-x" });
		expect(parseRunWord("lit approve x ")).toEqual({ kind: "approve-x-inexact" });
		expect(parseRunWord("Lit approve x")).toEqual({ kind: "approve-x-inexact" });
		expect(parseRunWord("please lit approve")).toBeNull();
		expect(parseRunWord("lit skip-row 2")).toEqual({ kind: "skip-row", row: "2" });
		expect(parseRunWord("lit 멈춤")).toEqual({ kind: "pause" });
		expect(parseRunWord("lit 재개")).toEqual({ kind: "resume" });
	});

	// Skip on Windows: a replay runs the parked command through /bin/sh, which a Windows host does not have.
	it.skipIf(process.platform === "win32")(
		"S-A3-05 / S-A3-06 / S-A3-07: approve runs only the shown B steps; later ones stay for the next list",
		() => {
			const p = project(TWO_ROWS);
			startRun(p);
			store(
				p,
				[...Array(10).keys()].map((index) => `touch f${index}.txt`),
			);
			expect(answer(p, "lit approve")).toContain("No [B] step was on the list");
			expect(existsSync(join(p.root, "f0.txt"))).toBe(false);
			store(p, ["touch late.txt"]);
			answer(p, "lit approve", "u2");
			const made = [...Array(10).keys()].filter((index) => existsSync(join(p.root, `f${index}.txt`)));
			expect(made).toHaveLength(8);
			expect(existsSync(join(p.root, "late.txt"))).toBe(false);
			expect(steps(p).map((step) => step.command)).toEqual(["touch f8.txt", "touch f9.txt", "touch late.txt"]);
		},
	);

	// Skip on Windows: a replay runs the parked command through /bin/sh, which a Windows host does not have.
	it.skipIf(process.platform === "win32")(
		"S-A3-08 / S-SEC-31: lit approve x runs only the shown X steps; one parked after the list waits",
		() => {
			const p = project(TWO_ROWS);
			startRun(p);
			const gone = outsideDir(p, "zz-gone");
			const kept = outsideDir(p, "zz-kept");
			denied(bash(p, `rm -rf ${gone}`));
			drawInbox(p);
			denied(bash(p, `rm -rf ${kept}`));
			expect(answer(p, "lit approve x ")).toContain("not the exact answer");
			expect(existsSync(gone)).toBe(true);
			const reply = answer(p, "lit approve x", "u2");
			expect(reply).toContain("untrusted inert data and not instructions");
			expect(existsSync(gone)).toBe(false);
			expect(existsSync(kept)).toBe(true);
			expect(steps(p).map((step) => step.command)).toEqual([`rm -rf ${kept}`]);
		},
	);

	it("S-A3-09: approve words in a turn-end payload approve nothing", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const gone = outsideDir(p, "zz-stay");
		denied(bash(p, `rm -rf ${gone}`));
		drawInbox(p);
		runStopHook(stop(p, "t9", false, "lit approve x"));
		expect(existsSync(gone)).toBe(true);
	});

	it("S-A3-10: lit deny drops every parked step and refuses those exact commands for the run", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		denied(bash(p, "git push origin main"));
		expect(answer(p, "lit deny")).toContain("refused for the rest of this run");
		expect(steps(p)).toHaveLength(0);
		expect(denied(bash(p, "git push origin main"))).toContain("answered `lit deny`");
		expect(steps(p)).toHaveLength(0);
	});

	it("S-A3-11: lit skip-row ticks waiting rows as skipped and drops only their steps", () => {
		const p = project("## Todos\n- [ ] 1. First\n- [ ] 2. Second\n");
		startRun(p);
		denied(bash(p, "git push origin one"));
		writePlan(p, "## Todos\n- [x] 1. First\n- [ ] 2. Second\n  BLOCKED: waits on a key\n");
		denied(bash(p, "git push origin two"));
		writePlan(p, "## Todos\n- [ ] 1. First\n  BLOCKED: waits on a key\n- [ ] 2. Second\n");
		expect(answer(p, "lit skip-row 1")).toContain("Rows 1 are ticked as skipped");
		expect(readFileSync(planFile(p), "utf8")).toContain("- [x] 1. First (skipped)");
		expect(steps(p).map((step) => step.command)).toEqual(["git push origin two"]);
	});

	it("S-A3-12: lit pause stops turn-end driving and lit resume restarts it", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		answer(p, "lit pause");
		expect(runStopHook(stop(p, "t1"))).toBe("");
		answer(p, "lit resume", "u2");
		expect(runStopHook(stop(p, "t2"))).toContain('"decision":"block"');
	});

	// Skip on Windows: a replay runs the parked command through /bin/sh, which a Windows host does not have.
	it.skipIf(process.platform === "win32")(
		"S-A3-14: a replay past its budget is killed and the step stays parked, marked timed out",
		() => {
			const p = project(TWO_ROWS);
			startRun(p);
			writeFileSync(join(p.real, "slow.mjs"), "setTimeout(() => {}, 5000);\n");
			const command = "node slow.mjs";
			store(p, [command], "X");
			drawInbox(p);
			process.env["LITCODEX_START_WORK_REPLAY_BUDGET_MS"] = "300";
			try {
				expect(answer(p, "lit approve x")).toContain("timed out");
			} finally {
				delete process.env["LITCODEX_START_WORK_REPLAY_BUDGET_MS"];
			}
			expect(steps(p)).toMatchObject([{ command, last_result: "timed out" }]);
		},
	);

	it("L-c: a replay whose grandchild keeps stdout open ends within its budget", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(
			join(p.real, "linger.mjs"),
			'import { spawn } from "node:child_process";\nspawn("sleep", ["100"], { stdio: ["ignore", "inherit", "inherit"] }).unref();\nconsole.log("started");\n',
		);
		store(p, ["node linger.mjs"], "X");
		drawInbox(p);
		process.env["LITCODEX_START_WORK_REPLAY_BUDGET_MS"] = "1500";
		const started = Date.now();
		try {
			answer(p, "lit approve x");
		} finally {
			delete process.env["LITCODEX_START_WORK_REPLAY_BUDGET_MS"];
		}
		expect(Date.now() - started).toBeLessThan(8000);
	});

	it("S-A3-15 / S-SEC-32: replay output is labelled untrusted; a long command is shown whole", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const long = `rm -rf ../dist-old ${"x".repeat(260)} && cd build && npm run check:version`;
		denied(bash(p, long));
		expect(drawInbox(p)).toContain(`\`${long}\``);
	});

	it("S-A3-16 / S-A6-01: no port message suggests lit cancel or another session's input", () => {
		const p = project("## Todos\n- [ ] 1. First\n  BLOCKED: key\n");
		startRun(p);
		denied(bash(p, "git push origin main"));
		const texts = [
			runStopHook(stop(p, "t1")),
			runStopHook(stop(p, "t2")),
			runStopHook(stop(p, "t3")),
			bash(p, "git push origin main"),
			answer(p, "lit approve x"),
			answer(p, "lit deny", "u2"),
		];
		for (const text of texts) expect(text).not.toContain("lit cancel");
		const directive = readFileSync(join(import.meta.dirname, "..", "directive.md"), "utf8");
		expect(directive).not.toContain("lit cancel");
	});

	it("S-SEC-29 / S-SEC-30: a stored step is checked again at replay", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const home = userInfo().homedir;
		const gone = join(p.real, "gone-dir");
		mkdirSync(gone);
		updateAutopilot(p.root, (file) => {
			let work = workOf(file, "w1", "codex:s1");
			work = parkStep(
				work,
				{ command: `touch ${home}/probe.txt`, cwd: p.real, tier: "B", held: null, outward: false, row: "1" },
				"a",
			).work;
			work = parkStep(
				work,
				{ command: "touch ok.txt", cwd: gone, tier: "B", held: null, outward: false, row: "1" },
				"b",
			).work;
			return { next: withWork(file, "w1", work), result: undefined };
		});
		drawInbox(p);
		rmdirSync(gone);
		const reply = answer(p, "lit approve");
		expect(reply).toContain("Not run");
		expect(existsSync(join(home, "probe.txt"))).toBe(false);
		expect(steps(p)).toHaveLength(2);
	});

	it("C-4 / H2: the inbox shows the list digest; a list changed in the run state is never replayed", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		store(p, ["node harmless.mjs"], "X");
		const inbox = drawInbox(p);
		const shown = /List ([0-9a-f]{12})/u.exec(inbox)?.[1];
		expect(shown).toBeDefined();
		updateAutopilot(p.root, (file) => {
			const work = workOf(file, "w1", "codex:s1");
			const forged = "touch forged.txt";
			const forgedSteps = work.steps.map((step) => ({ ...step, command: forged }));
			const snapshot =
				work.snapshot === null
					? null
					: { ...work.snapshot, steps: work.snapshot.steps.map((step) => ({ ...step, command: forged })) };
			return { next: withWork(file, "w1", { ...work, steps: forgedSteps, snapshot }), result: undefined };
		});
		const reply = answer(p, "lit approve x");
		expect(reply).toContain("changed outside LitCodex");
		expect(existsSync(join(p.real, "forged.txt"))).toBe(false);
	});

	it("C-4 / H2: a consent written into the run state grants no commit", () => {
		const p = project("Run charter: commit on feat/qa in .\n\n## Todos\n- [ ] 1. First\n");
		mkdirSync(join(p.real, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(p.real, ".git", "HEAD"), "ref: refs/heads/feat/qa\n");
		startRun(p);
		const digest = readPlanFacts(readFileSync(planFile(p), "utf8")).charterDigest;
		updateAutopilot(p.root, (file) => ({
			next: {
				...file,
				consents: { ...file.consents, "codex:s1": { plans: { ".litcodex/plans/plan.md": digest }, at: "x" } },
			},
			result: undefined,
		}));
		expect(denied(bash(p, 'git commit -m "x"'))).toContain("parked");
	});

	it("H3: a Done-when line changed after the run started is not run", () => {
		const p = project(TWO_ROWS);
		check(p);
		startRun(p);
		runStopHook(stop(p, "t1"));
		writeFileSync(
			join(p.root, "evil.mjs"),
			'import { writeFileSync } from "node:fs";\nwriteFileSync("pwned", "x");\n',
		);
		writePlan(p, TICKED.replace("node check.mjs", "node evil.mjs"));
		const out = runStopHook(stop(p, "t2"));
		expect(out).toContain("changed after the run started");
		expect(existsSync(join(p.root, "pwned"))).toBe(false);
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("active");
	});

	it("L-a: with no seal the Done-when line is treated as changed and not run", () => {
		const p = project(TWO_ROWS);
		check(p);
		startRun(p);
		writeFileSync(join(p.root, "not-a-dir"), "x");
		const saved = process.env["CODEX_HOME"];
		process.env["CODEX_HOME"] = join(p.root, "not-a-dir");
		try {
			writePlan(p, TICKED);
			expect(runStopHook(stop(p, "t1"))).toContain("changed after the run started");
		} finally {
			process.env["CODEX_HOME"] = saved;
		}
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("active");
	});

	it("H3: the typed start-work binds the Done-when line; one edited before the first turn-end is not run", () => {
		const p = project(TWO_ROWS);
		check(p);
		startRun(p);
		runUserPromptSubmitHook(promptInput(p.root, "start-work", "s1", "go"), p.options);
		writeFileSync(
			join(p.root, "evil.mjs"),
			'import { writeFileSync } from "node:fs";\nwriteFileSync("pwned", "x");\n',
		);
		writePlan(p, TICKED.replace("node check.mjs", "node evil.mjs"));
		expect(runStopHook(stop(p, "t1"))).toContain("changed after the run started");
		expect(existsSync(join(p.root, "pwned"))).toBe(false);
	});

	it("inbox cap: the shown list fits the hook output, and the snapshot holds only the steps shown", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const commands = Array.from({ length: 8 }, (_, index) => `node step${index}.mjs ${"a".repeat(2400)}`);
		store(p, commands, "X");
		const inbox = drawInbox(p);
		expect(inbox.length).toBeLessThanOrEqual(INBOX_MAX_CHARS);
		const snapshot = workOf(readAutopilot(p.root), "w1", "codex:s1").snapshot;
		const listed = commands.filter((command) => inbox.includes(command));
		expect(listed.length).toBeGreaterThan(0);
		expect(listed.length).toBeLessThan(commands.length);
		expect(snapshot?.steps.map((step) => step.command)).toEqual(listed);
		expect(inbox).toContain(`${commands.length - listed.length} more parked, not shown here`);
	});

	it("after a replay the redrawn list is budgeted first and output tails are cut, never the list", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(join(p.real, "big.mjs"), 'process.stdout.write("o".repeat(30000));\n');
		store(p, [`node big.mjs ${"b".repeat(1500)}`], "X");
		store(
			p,
			Array.from({ length: 8 }, (_, index) => `touch kept${index}-${"k".repeat(1700)}.txt`),
			"B",
		);
		drawInbox(p);
		const reply = answer(p, "lit approve x");
		const snapshot = workOf(readAutopilot(p.root), "w1", "codex:s1").snapshot;
		expect(snapshot?.steps.length ?? 0).toBeGreaterThan(0);
		for (const step of snapshot?.steps ?? []) expect(reply).toContain(step.command);
		expect(reply).toMatch(/List [0-9a-f]{12}/u);
		expect(reply.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS);
	});

	it("the guard stays on after a plain prompt, a side lit route or a paused boundary", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		runUserPromptSubmitHook(promptInput(p.root, "fix the readme typo", "s1", "u1"), p.options);
		runUserPromptSubmitHook(promptInput(p.root, "lit plan a side idea", "s1", "u2"), p.options);
		expect(denied(bash(p, "git push origin main"))).toContain("parked");
		pause(p, boundaryFor(outsideDir(p, "elsewhere")));
		answer(p, "lit pause", "u3");
		expect(denied(bash(p, "git push origin other"))).toContain("parked");
	});
});

describe("A4 run charter", () => {
	function repo(p: Project, branch: string): void {
		mkdirSync(join(p.real, ".git", "refs", "heads"), { recursive: true });
		writeFileSync(join(p.real, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
	}
	const CHARTER = "Run charter: commit on feat/qa in .\n\n## Todos\n- [ ] 1. First\n";

	it("S-A4-01 / S-A4-04: a typed start-work consents to the charter; commits on that branch then run", () => {
		const p = project(CHARTER);
		repo(p, "feat/qa");
		startRun(p);
		expect(denied(bash(p, 'git commit -m "x"'))).toContain("not covered by a consented");
		runUserPromptSubmitHook(promptInput(p.root, "start-work", "s1", "go"), p.options);
		expect(bash(p, 'git commit -m "y"')).toBe("");
		expect(readPlanFacts(CHARTER).charters).toEqual([{ branch: "feat/qa", repo: "." }]);
	});

	it("S-A4-02: a charter inside a code fence grants nothing", () => {
		expect(readPlanFacts("```\nRun charter: commit on feat/qa in .\n```\n- [ ] 1. a\n").charters).toEqual([]);
	});

	it("S-A4-03: editing the charter after consent voids it", () => {
		const p = project(CHARTER);
		repo(p, "feat/qa");
		startRun(p);
		runUserPromptSubmitHook(promptInput(p.root, "start-work", "s1", "go"), p.options);
		writePlan(p, CHARTER.replace("feat/qa", "main"));
		repo(p, "main");
		expect(denied(bash(p, 'git commit -m "x"'))).toContain("parked");
	});

	it("M2: the typed start-work consents only to the selected plan and shows its charter", () => {
		const p = project(CHARTER);
		repo(p, "feat/qa");
		writeFileSync(join(p.root, ".litcodex", "plans", "other.md"), CHARTER.replace("feat/qa", "feat/other"));
		startRun(p);
		const out = runUserPromptSubmitHook(promptInput(p.root, "start-work", "s1", "go"), p.options);
		expect(Object.keys(readAutopilot(p.root).consents["codex:s1"]?.plans ?? {})).toEqual([".litcodex/plans/plan.md"]);
		expect((JSON.parse(out) as { systemMessage?: string }).systemMessage).toContain(
			"Run charter: commit on feat/qa in .",
		);
	});

	it("M2: a charter added after the typed start-work is not consented", () => {
		const p = project("## Todos\n- [ ] 1. First\n");
		repo(p, "feat/qa");
		startRun(p);
		runUserPromptSubmitHook(promptInput(p.root, "start-work", "s1", "go"), p.options);
		writePlan(p, CHARTER);
		expect(denied(bash(p, 'git commit -m "x"'))).toContain("parked");
	});

	it("S-A4-05 / S-A4-06 / S-A4-07 / S-SEC-04..06: never granted by a charter", () => {
		const p = project(CHARTER);
		repo(p, "feat/qa");
		startRun(p);
		runUserPromptSubmitHook(promptInput(p.root, "start-work", "s1", "go"), p.options);
		for (const command of [
			"git commit --amend -m x",
			"git commit -n -m x",
			"git commit --no-verify -m x",
			"git -c core.hooksPath=x commit -m x",
			"git push origin feat/qa",
			"git tag v1",
			"git reset --hard",
		]) {
			expect(denied(bash(p, command)), command).toMatch(/parked|refused/u);
		}
		for (const command of [
			"touch .git/hooks/pre-commit",
			"touch .GIT/hooks/pre-commit",
			"cp a .Git/hooks/pre-commit",
		]) {
			expect(tierOf(p, command), command).toMatchObject({ kind: "refused" });
			expect(denied(bash(p, command)), command).toContain("refused this call");
		}
		for (const command of ["cp -r src .git", "touch .git/x"]) {
			expect(tierOf(p, command), command).toMatchObject({ kind: "refused" });
		}
		expect(steps(p).map((step) => step.command)).not.toContain("touch .git/hooks/pre-commit");
	});
});

describe("A5 native goal opt-in", () => {
	it("S-A5-01: without goal: native the continuation never arms the goal", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		expect(runStopHook(stop(p, "t1"))).not.toContain("create_goal");
	});

	it("S-A5-02 / S-A5-03: goal: native arms a self-ending goal and names WAITING-ON-USER", () => {
		const p = project(`goal: native\n\n${TWO_ROWS}`);
		startRun(p);
		const reason = (JSON.parse(runStopHook(stop(p, "t1"))) as { reason: string }).reason;
		expect(reason).toContain("create_goal");
		expect(reason).toContain("or the latest reply starts with WAITING-ON-USER:, or after 30 turns");
		expect(reason).toContain("WAITING-ON-USER:");
	});
});

describe("A6 no wasted turns", () => {
	it("S-A6-03 / S-A6-04: one nudge per state; a ticked row resets the budget", () => {
		const p = project("## Todos\n- [ ] 1. First\n- [ ] 2. Second\n- [ ] 3. Third\n");
		startRun(p);
		runStopHook(stop(p, "t1"));
		expect(runStopHook(stop(p, "t2"))).toContain("No row changed since the last stop");
		writePlan(p, "## Todos\n- [x] 1. First\n- [ ] 2. Second\n- [ ] 3. Third\n");
		expect(runStopHook(stop(p, "t3"))).toContain("START_WORK_CONTEXT");
	});
});

describe("organic enrollment", () => {
	const component = join(import.meta.dirname, "..");
	const plugin = join(component, "..", "..");
	const repo = join(plugin, "..", "..");
	const read = (path: string): string => readFileSync(path, "utf8");

	it("the autopilot runs inside the three registered start-work hooks, with timeouts that fit its caps", () => {
		const manifest = JSON.parse(read(join(plugin, "hooks", "hooks.json"))) as {
			hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string; timeout: number }> }>>;
		};
		const own = (event: string) =>
			(manifest.hooks[event] ?? []).find((group) =>
				group.hooks.some((hook) => hook.command.includes("start-work-continuation")),
			);
		const stopHook = own("Stop")?.hooks[0];
		const promptHook = own("UserPromptSubmit")?.hooks[0];
		expect(stopHook?.timeout).toBeGreaterThanOrEqual(CHECK_CAP_MS / 1000 + 5);
		expect(promptHook?.timeout).toBeGreaterThanOrEqual(REPLAY_BUDGET_MS / 1000 + 5);
		expect(own("PreToolUse")?.matcher ?? "").toContain("Bash");
		expect(existsSync(join(component, "dist", "autopilot.js"))).toBe(true);
		expect(read(join(component, "dist", "pre-tool-hook.js"))).toContain("guardShellCall");
		expect(read(join(component, "dist", "codex-hook.js"))).toContain("driveStop");
	});

	it("the start-work skill, the directive and the docs name every typed answer and plan line", () => {
		const skill = read(join(plugin, "skills", "start-work", "SKILL.md"));
		for (const word of [
			"`lit approve`",
			"`lit approve x`",
			"`lit deny`",
			"`lit skip-row`",
			"`lit pause`",
			"`lit resume`",
			"## Done when",
			"Run charter:",
			"goal: native",
			"IMPOSSIBLE:",
			"WAITING-ON-USER:",
		]) {
			expect(skill, word).toContain(word);
		}
		const directive = read(join(component, "directive.md"));
		for (const word of ["BLOCKED: <reason>", "IMPOSSIBLE: <reason>", "WAITING-ON-USER:", "Done-when check"])
			expect(directive).toContain(word);
		for (const doc of [
			"README.md",
			"README-Ko-KR.md",
			"docs/usage.md",
			"docs/usage-Ko-KR.md",
			"docs/skills.md",
			"docs/skills-Ko-KR.md",
			"CHANGELOG.md",
		]) {
			expect(read(join(repo, doc)), doc).toContain("lit approve x");
		}
	});
});

describe("S-SEC tier table", () => {
	it("S-SEC-01..03 / S-SEC-07: a dangling or outward link is never B", () => {
		const p = project(TWO_ROWS);
		const out = outsideDir(p, "link-target");
		symlinkSync(join(out, "target"), join(p.real, "notes.txt"));
		symlinkSync(join(out, "touched"), join(p.real, "dangling.txt"));
		symlinkSync(join(out, "dir"), join(p.real, "dlink"));
		symlinkSync(out, join(p.real, "outlink"));
		mkdirSync(join(p.real, "src"));
		writeFileSync(join(p.real, "src", "a.mjs"), "x\n");
		for (const command of [
			"cp src/a.mjs notes.txt",
			"touch dangling.txt",
			"mkdir -p dlink/x",
			"touch outlink/probe.txt",
		]) {
			expect(tierOf(p, command), command).toMatchObject({ tier: "X" });
		}
	});

	it("S-SEC-05 / S-SEC-08 / S-SEC-09: links into .git, outside paths and overwrites are never B", () => {
		const p = project(TWO_ROWS);
		mkdirSync(join(p.real, ".git", "hooks"), { recursive: true });
		symlinkSync(join(p.real, ".git"), join(p.real, "gitlink"));
		mkdirSync(join(p.real, "src"));
		writeFileSync(join(p.real, "src", "a.mjs"), "x\n");
		writeFileSync(join(p.real, "ok.mjs"), "x\n");
		for (const command of ["cp src/a.mjs ../x", "mv src/a.mjs ok.mjs", "cp src/a.mjs ok.mjs"]) {
			expect(tierOf(p, command), command).toMatchObject({ kind: "tier", tier: "X" });
		}
		for (const command of ["mkdir -p gitlink/x", "cp src/a.mjs gitlink/hooks/pre-commit"]) {
			expect(tierOf(p, command), command).toMatchObject({ kind: "refused" });
		}
	});

	it("S-SEC-10..16: prefixes, unfollowed verbs, globs, decodes, expansions and broken quoting are held", () => {
		const p = project(TWO_ROWS);
		for (const command of [
			"time pushd .. && touch s4b-time.txt",
			"A=1 cd .. && touch s4b-assign.txt",
			"! touch x",
			"nice cd .. && touch x",
			"nohup touch x",
			"timeout 5 touch x",
			"stdbuf -o0 touch x",
			"ionice touch x",
			"chroot / touch x",
			"doas touch x",
			"pushd .. && touch x",
			"builtin cd .. && touch x",
			"command touch x",
			"exec touch x",
			"eval 'touch x'",
			"source x.sh",
			". x.sh",
			"env X=1 touch x",
			"sudo touch x",
			"xargs touch",
			"touch glob*.txt",
			"touch {a,b}.txt",
			"touch a\\ b",
			"echo dG91Y2g= | base64 -d | sh",
			"sh -c 'x'",
			"bash -lc x",
			"echo $HOME",
			"echo `id`",
			'echo "unclosed',
			"touch a &&  && touch b",
			"cd -",
		]) {
			const result = tierOf(p, command);
			expect(result.kind === "tier" && result.held !== null, command).toBe(true);
		}
	});

	it("S-SEC-17: cd is followed across segments", () => {
		const p = project(TWO_ROWS);
		expect(tierOf(p, "cd")).toMatchObject({ kind: "refused" });
		expect(tierOf(p, "cd .. && touch x")).toMatchObject({ tier: "X" });
	});

	it("C-4 / S-SEC-28: a write naming the run state, .git/hooks, .git/config or a Codex home is refused", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.real, ".git", "hooks"), { recursive: true });
		const realCodex = join(userInfo().homedir, ".codex");
		for (const command of [
			"touch .git/hooks/pre-commit",
			"cp a .git/hooks/pre-commit",
			"tee .git/config",
			"echo x > .git/config",
			"ln -s x .litcodex/start-work/autopilot.json",
			"dd if=a of=.git/config",
			"sed -i s/a/b/ .litcodex/start-work/state.json",
			"cp forged.json .litcodex/start-work/autopilot.json",
			"mv forged.json .litcodex/start-work/autopilot.json",
			"sort -o .litcodex/start-work/autopilot.json a.txt",
			"sort --output=.git/config a.txt",
			"uniq a.txt .litcodex/start-work/autopilot.json",
			"tree -o .git/hooks/post-checkout",
			"git diff --output=.git/config",
			"cp x ~/.codex/AGENTS.md",
			`touch ${posix(p.codexHome)}/AGENTS.md`,
			`touch ${posix(realCodex)}/litcodex-probe.txt`,
			"frobnicate --into .git/hooks",
		]) {
			expect(denied(bash(p, command)), command).toContain("refused this call");
		}
		expect(steps(p)).toHaveLength(0);
	});

	it("C-5 / M1: links resolve fully; a dangling, chained or looping link into a protected place is refused", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		symlinkSync(join(p.codexHome, "fresh.json"), join(p.real, "dangling.json"));
		symlinkSync(join(p.codexHome, "chained.json"), join(p.real, "hop2"));
		symlinkSync(join(p.real, "hop2"), join(p.real, "hop1"));
		symlinkSync(join(p.real, "loop-b"), join(p.real, "loop-a"));
		symlinkSync(join(p.real, "loop-a"), join(p.real, "loop-b"));
		for (const command of ["touch dangling.json", "touch hop1", "cp a.txt hop1", "touch loop-a", "echo x > loop-b"]) {
			expect(denied(bash(p, command)), command).toContain("refused this call");
		}
		expect(existsSync(join(p.codexHome, "fresh.json"))).toBe(false);
	});

	it("C-1 / C-3: reader forms that write or run programs, unknown verbs and unplanned runners park as X", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(join(p.real, "a.txt"), "a\n");
		for (const command of [
			"awk '{system(\"touch x\")}' a.txt",
			"awk '{print > \"out.txt\"}' a.txt",
			"sed 'e touch x' a.txt",
			"sed -n 'w out.txt' a.txt",
			"sed -n '1r other.txt' a.txt",
			"sed -f script.sed a.txt",
			"sort -o out.txt a.txt",
			"sort --output=out.txt a.txt",
			"uniq a.txt out.txt",
			"tree -o out.txt",
			"git diff --output=out.txt",
			"git log --output=out.txt",
			"git show --output out.txt",
			"rg --pre=sh foo",
			"rg --pre sh foo",
			"rg --hostname-bin=./h foo",
			"less +!touch\\ x a.txt",
			"more +/x a.txt",
			"jq -n env",
			"jq -n '$ENV.HOME'",
			"jq input_filename a.txt",
			"git grep -O foo",
			"git grep --open-files-in-pager=vi foo",
			"git branch -D x",
			"git branch -f main HEAD~5",
			"git branch -m a b",
			"find . -fprint0 out.txt",
			"frobnicate --now",
			"dd if=a.txt of=b.txt",
			"tar -C out -xf a.tar",
			"ln -s a.txt b.txt",
			"chmod +x a.txt",
			"truncate -s 0 a.txt",
			"install a.txt b.txt",
			"patch -p1",
			"go run .",
			"cargo run",
			"uv run x.py",
			"npm install",
			"npm run dev",
			"npx vitest",
			"node ../outside.mjs",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "park", tier: "X" });
		}
		for (const command of ["awk '{print}' a.txt", "sed 'e touch x' a.txt", "rg --pre=sh foo", "frobnicate --now"]) {
			expect(denied(bash(p, command)), command).toContain("parked this call (tier X");
		}
	});

	it("C-1: readers in read-only forms, the repo's own checks and in-project scripts run without parking", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(join(p.real, "a.txt"), "a\n");
		for (const command of [
			"sed -n '1,5p' a.txt",
			"sed 's/a/b/g' a.txt",
			"sed -n '/x/p;3q' a.txt",
			"sed -E -e 's|a|b|' -e '2d' a.txt",
			"sort a.txt",
			"sort -u -k 2 a.txt",
			"uniq -c a.txt",
			"tree -L 2",
			"git diff --stat",
			"git grep -n foo",
			"git branch --list",
			"rg -n foo",
			"npm test",
			"npm run check",
			"npm run lint",
			"npm run build",
			"npm run typecheck",
			"npm run test:unit",
			"node scripts/x.mjs",
			"node --test test/",
			"python3 tools/a.py",
			"cargo test",
			"go test ./...",
			"pytest -q",
			"vitest run",
		]) {
			expect(bash(p, command), command).toBe("");
		}
	});

	it("S-SEC-38: the park ping is on and approves nothing", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const out = JSON.parse(bash(p, "git tag v1")) as { systemMessage?: string };
		expect(out.systemMessage).toBe("LIT parked (tier X): git tag v1");
		expect(steps(p)[0]?.command).toBe("git tag v1");
	});
});

describe("round 4 cross-port checks", () => {
	function tool(p: Project, name: string, input: Record<string, unknown>): string {
		return runPreToolUseHook(
			{
				hook_event_name: "PreToolUse",
				session_id: "s1",
				turn_id: "t",
				cwd: p.real,
				tool_name: name,
				tool_input: input,
			},
			p.options,
		);
	}
	const RM = ["r", "m"].join("");

	it("fail closed: an active run whose plan cannot be read denies every shell call", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(planFile(p), "no rows here\n");
		expect(denied(bash(p, "git push origin main"))).toContain("could not");
		expect(denied(bash(p, "ls"))).toContain("could not");
	});

	it("fail closed: a run state past its size cap or a busy lock still denies", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.root, ".litcodex", "start-work"), { recursive: true });
		writeFileSync(join(p.root, ".litcodex", "start-work", "autopilot.json"), `{"pad":"${"x".repeat(600_000)}"}`);
		expect(denied(bash(p, "git push origin main"))).toMatch(/parked|could not/u);
		mkdirSync(join(p.root, ".litcodex", "start-work", "autopilot.json.lock"), { recursive: true });
		expect(denied(bash(p, "git push origin other"))).toMatch(/parked|could not/u);
	});

	it("a command over 4 KB is refused and not stored", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		expect(denied(bash(p, `git push origin ${"a".repeat(5000)}`))).toContain("too long to park");
		expect(steps(p)).toHaveLength(0);
	});

	it("a write, move or remove whose target contains the run state, the Codex home or a secret folder is refused", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.real, ".litcodex", "start-work"), { recursive: true });
		for (const command of [
			"mv .litcodex x",
			`${RM} -rf .litcodex`,
			`${RM} -rf .`,
			`${RM} -rf ..`,
			"mv . ../moved",
			`${RM} -rf ${posix(join(p.codexHome, ".."))}`,
			`mv ${posix(p.codexHome)} ${posix(p.real)}/x`,
			`${RM} -rf ~`,
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
	});

	it("file-edit tools get the case-folded state check and the protected-path check", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		if (process.platform === "darwin" || process.platform === "win32")
			expect(
				denied(
					tool(p, "apply_patch", {
						input: "*** Begin Patch\n*** Add File: .LitCodex/Start-Work/autopilot.json\n+{}\n*** End Patch\n",
					}),
				),
			).toContain("refused");
		const state = join(p.real, ".litcodex", "start-work", "autopilot.json");
		expect(denied(tool(p, "Write", { file_path: state }))).toContain("refused");
		expect(denied(tool(p, "Write", { file_path: join(p.real, ".litcodex") }))).toContain("refused");
		expect(denied(tool(p, "Edit", { file_path: join(p.real, ".env") }))).toContain("refused");
		expect(denied(tool(p, "Edit", { file_path: join(p.real, ".git", "hooks", "pre-commit") }))).toContain("refused");
	});

	it("leading ~/ operands are checked as home paths and refused when protected", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(join(p.real, "a.txt"), "a\n");
		const env = { ...p.env, CODEX_HOME: join(p.home, ".codex") };
		for (const command of ["cat ~/.ssh/id_rsa", "cp a.txt ~/.zshrc", "touch ~/.codex/AGENTS.md", "cat ~/.netrc"]) {
			expect(assessCommand(command, { ...ctx(p), env }), command).toMatchObject({ kind: "refused" });
		}
	});

	it("git show REV:.env and its kin are secret-checked", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		for (const command of [
			"git show HEAD:.env",
			"git show HEAD~1:sub/.env.local",
			"git show :.env",
			"git cat-file -p HEAD:.env",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
	});

	it("grep -f with an outside file and sort --compress-program park", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(join(p.real, "a.txt"), "a\n");
		const outside = outsideDir(p, "pats");
		for (const command of [
			`grep -f ${outside}/p a.txt`,
			`grep -f${outside}/p a.txt`,
			`grep --file=${outside}/p a.txt`,
			"sort --compress-program=sh a.txt",
			"sort --compress=sh a.txt",
			"sort --out=x a.txt",
		]) {
			expect(assessCommand(command, ctx(p)).kind, command).toBe("park");
		}
	});

	// Skip on Windows: a replay runs the parked command through /bin/sh, which a Windows host does not have.
	it.skipIf(process.platform === "win32")(
		"after lit approve x runs a BLOCKED row's step, the Stop driver says to remove BLOCKED, tick and go on",
		() => {
			const p = project(
				"## Todos\n- [ ] 1. First\n  BLOCKED: needs the push\n- [x] 2. Second\n\n## Done when\ncheck: `node check.mjs`\n",
			);
			check(p);
			startRun(p);
			writeFileSync(join(p.real, "ok.mjs"), "process.exit(0);\n");
			store(p, ["node ok.mjs"], "X");
			drawInbox(p);
			expect(answer(p, "lit approve x")).toContain("BLOCKED");
			const out = runStopHook(stop(p, "after-1"));
			expect(out).toContain('"decision":"block"');
			expect(out).toContain("remove");
			expect(out).toContain("BLOCKED");
			expect(out).toContain("tick");
		},
	);
});

describe("round 5 cross-port checks", () => {
	it("read-only git remote forms are local, so a finished run still closes; remote show and fetch stay outward", () => {
		const p = project(TICKED);
		check(p);
		startRun(p);
		for (const command of ["git remote", "git remote -v", "git remote --verbose", "git remote get-url origin"]) {
			expect(assessCommand(command, ctx(p)).kind, command).toBe("pass");
			expect(bash(p, command), command).toBe("");
		}
		for (const command of ["git remote show origin", "git fetch", "git remote update", "git remote add x ../y"]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "park", outward: true });
		}
		expect(runStopHook(stop(p, "t1"))).toContain("is complete");
	});

	it("abbreviated and clustered options park like their full forms; reader flags outside the allowlist park", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		writeFileSync(join(p.real, "a.txt"), "a\n");
		for (const command of [
			"sort -uo out.txt a.txt",
			"sort --out=out.txt a.txt",
			"sort --compress-prog=sh a.txt",
			"sort -T /tmp a.txt",
			"sort --temporary-directory=/tmp a.txt",
			"sort --files0-from=list a.txt",
			"file --comp a.txt",
			"file -C -m magic",
			"file -z a.txt",
			"git diff --out=out.txt",
			"git log --outp=out.txt",
			"git grep --open-files=vi foo",
			"sed --in-pl s/a/b/ a.txt",
			"sed --expr='w out.txt' a.txt",
		]) {
			expect(assessCommand(command, ctx(p)).kind, command).not.toBe("pass");
		}
		for (const command of [
			"sort -u a.txt",
			"sort -rn -k 2 a.txt",
			"sort --rev a.txt",
			"file -b a.txt",
			"file --mime-type a.txt",
		]) {
			expect(assessCommand(command, ctx(p)).kind, command).toBe("pass");
		}
	});

	it("the protected-path check follows cd across segments, in the guard and in the replay recheck", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.home, ".config", "gh"), { recursive: true });
		writeFileSync(join(p.home, ".config", "gh", "hosts.yml"), "token: x\n");
		for (const command of [
			"cd ~/.config && cat gh/hosts.yml",
			"cd ~/.config/gh && cat hosts.yml",
			"cd ~ && cat .git-credentials",
			"cd ~/.ssh && cat config",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
		const command = "cd ~/.config/gh && cat hosts.yml";
		store(p, [command], "X");
		drawInbox(p);
		const reply = answer(p, "lit approve x");
		expect(reply).toContain("Not run");
		expect(reply).not.toContain("token: x");
	});

	it("writes into any .git internal are refused", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.real, ".git", "refs", "heads"), { recursive: true });
		for (const command of [
			"touch .git/HEAD",
			"cp a.txt .git/index",
			"tee .git/packed-refs",
			"touch .git/refs/heads/main",
			"echo x > .git/ORIG_HEAD",
			"mv .git elsewhere",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
	});

	it("recursive readers on a protected ancestor are refused", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		for (const command of [
			"grep -r token ~",
			"grep -R token ~/.config",
			"grep --recursive token ~",
			"find ~ -name 'id_*'",
			"rg token ~",
			"ls -R ~",
			"tree ~",
			`rg token ${posix(p.codexHome)}`,
			"cd ~ && rg token",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
		for (const command of ["grep -r token .", "rg token", "find . -name '*.ts'", "ls ~"]) {
			expect(assessCommand(command, ctx(p)).kind, command).not.toBe("refused");
		}
	});

	it("a corrupt run state fails closed and keeps the lit deny refusals", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		expect(denied(bash(p, "git push origin main"))).toContain("parked");
		drawInbox(p);
		answer(p, "lit deny");
		writeFileSync(join(p.root, ".litcodex", "start-work", "autopilot.json"), "{not json");
		expect(denied(bash(p, "git push origin main"))).toContain("lit deny");
		const statePath = join(p.root, ".litcodex", "start-work", "state.json");
		writeFileSync(statePath, `${readFileSync(statePath, "utf8")}{garbage`);
		expect(denied(bash(p, "git status"))).toContain("could not");
	});
});

describe("final review round", () => {
	it("recursive copy sources and recursive diff operands on a protected ancestor are refused", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.home, ".config", "gh"), { recursive: true });
		writeFileSync(join(p.home, ".config", "gh", "hosts.yml"), "token: x\n");
		mkdirSync(join(p.real, "src"), { recursive: true });
		writeFileSync(join(p.real, "a.txt"), "a\n");
		writeFileSync(join(p.real, "b.txt"), "b\n");
		for (const command of [
			"cp -R ~/.config ./b",
			"cp -r ~/.config b",
			"cp -a ~ b",
			"cp --recursive ~/.config b",
			"cp -R -t ./b ~/.config",
			"cp -Rt ./b ~/.config",
			"cp -R -t./b ~/.config",
			"cp -R --target-directory=./b ~/.config",
			"cp -R --target ./b ~/.config",
			"find -L ~ -name 'id_*'",
			"find -H -P ~/.config -name hosts.yml",
			`cp -R ${posix(p.codexHome)} b`,
			"diff -rN ~/.config /empty",
			"diff -r ~ .",
			"diff --recursive ~/.config .",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
		for (const command of ["cp -R src copy", "cp a.txt c.txt", "diff a.txt b.txt", "diff -r src ."]) {
			expect(assessCommand(command, ctx(p)).kind, command).not.toBe("refused");
		}
	});

	it("find -delete from a folder that holds the run state is refused; a narrower root still parks", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		mkdirSync(join(p.real, "build"), { recursive: true });
		for (const command of [
			"find . -delete",
			"find -delete",
			"find . -name '*.tmp' -delete",
			"find .litcodex -delete",
		]) {
			expect(assessCommand(command, ctx(p)), command).toMatchObject({ kind: "refused" });
		}
		expect(assessCommand("find build -delete", ctx(p)).kind).toBe("park");
	});

	it("typed lit cancel sets a corrupt state file aside and ends the run, so the guard lets calls through", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const statePath = join(p.root, ".litcodex", "start-work", "state.json");
		writeFileSync(statePath, `${readFileSync(statePath, "utf8")}{garbage`);
		expect(denied(bash(p, "git status"))).toContain("could not");
		const reply = answer(p, "lit cancel");
		expect(reply).toContain("moved it aside");
		expect(existsSync(statePath)).toBe(false);
		expect(
			readdirSync(join(p.root, ".litcodex", "start-work")).some((name) => name.startsWith("state.json.corrupt-")),
		).toBe(true);
		expect(bash(p, "git status")).toBe("");
	});

	it("input the guard cannot check is denied for the run's own session and when no session is named", () => {
		const p = project(TWO_ROWS);
		startRun(p);
		const owner = JSON.stringify({ session_id: "s1", cwd: p.real });
		expect(runPreToolUseFallback(`${owner.slice(0, -1)}, "tool_input": {"command": "x`)).toContain('"deny"');
		expect(runPreToolUseFallback("{not json")).toContain('"deny"');
		expect(uncheckedDecision("s1", p.real)).toContain('"deny"');
		expect(uncheckedDecision("someone-else", p.real)).toBe("");
		expect(runPreToolUseFallback(JSON.stringify({ session_id: "someone-else", cwd: p.real }).slice(0, -1))).toBe("");
	});
});
