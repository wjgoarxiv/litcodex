import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CheckRunner,
	compileCondition,
	consentAnswer,
	GOAL_DIR,
	GOAL_STATUS,
	goalCancelContext,
	lintCondition,
	ownedGoal,
	parseDoneWhen,
	planAnswer,
	proposeGoal,
	sweepGoalState,
} from "./goal-pipeline.js";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";

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
