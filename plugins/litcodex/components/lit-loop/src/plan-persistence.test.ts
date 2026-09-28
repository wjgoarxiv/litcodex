import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runStopPlanPersistenceHookCli, runUserPromptSubmitHookCli } from "./hook-cli.js";
import {
	evaluatePlanPersistence,
	PLAN_PERSISTENCE_MAX_BLOCKS,
	PLAN_PUBLISHER_COMMAND,
	recordLitPlanActivation,
} from "./plan-persistence.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-plan-persistence-")));
	roots.push(root);
	return root;
}

function writePlan(root: string, name: string, body: string, mtimeMs: number): string {
	const dir = join(root, ".litcodex", "plans");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, body);
	utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
	return path;
}

const CHECKBOX_PLAN =
	"# Plan\n\n## Todos\n- [ ] 1. First task\n- [ ] 2. Second task\n\n## Final verification wave\n- [ ] F1. Verify\n";
const PROSE_PLAN = "# Plan\n\nWe will do things.\n\n## Todos\n- First task (no checkbox)\n";

function stopInput(root: string, sessionId = "sess_plan"): string {
	return JSON.stringify({
		hook_event_name: "Stop",
		session_id: sessionId,
		turn_id: "turn_1",
		transcript_path: null,
		cwd: root,
		model: "gpt-5.6-luna",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
	});
}

async function run(
	entry: typeof runStopPlanPersistenceHookCli | typeof runUserPromptSubmitHookCli,
	root: string,
	input: string,
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
	stdin.end(input);
	const code = await entry(stdin, stdout, stderr, root);
	return { code, stdout: out, stderr: err };
}

describe("lit-plan persistence guard (pure evaluator)", () => {
	it("passes when no lit-plan activation was recorded for the session", () => {
		const root = workspace();
		expect(evaluatePlanPersistence(root, "sess_plan")).toEqual({ decision: "pass" });
	});

	it("blocks when the lit-plan mode is active and no .litcodex/plans/*.md was written after the prompt", () => {
		const root = workspace();
		writePlan(root, "older.md", CHECKBOX_PLAN, 1_000);
		recordLitPlanActivation(root, "sess_plan", 5_000);
		const result = evaluatePlanPersistence(root, "sess_plan");
		expect(result).toMatchObject({ decision: "block" });
		const reason = result.decision === "block" ? result.reason : "";
		expect(reason).toContain(".litcodex/plans/<slug>.md");
		expect(reason).toContain(PLAN_PUBLISHER_COMMAND);
		expect(reason).toContain("publish-plan");
	});

	it("blocks with a checkbox reason when the newest plan has zero top-level `- [ ] N.` rows", () => {
		const root = workspace();
		recordLitPlanActivation(root, "sess_plan", 5_000);
		writePlan(root, "prose.md", PROSE_PLAN, 6_000);
		const result = evaluatePlanPersistence(root, "sess_plan");
		expect(result).toMatchObject({ decision: "block" });
		const reason = result.decision === "block" ? result.reason : "";
		expect(reason).toContain("- [ ] N.");
		expect(reason).toContain("prose.md");
		expect(reason).toContain(PLAN_PUBLISHER_COMMAND);
	});

	it("passes once a checkbox plan exists after the prompt and stays satisfied on later turns", () => {
		const root = workspace();
		recordLitPlanActivation(root, "sess_plan", 5_000);
		expect(evaluatePlanPersistence(root, "sess_plan").decision).toBe("block");
		writePlan(root, "feature.md", CHECKBOX_PLAN, 7_000);
		expect(evaluatePlanPersistence(root, "sess_plan")).toEqual({ decision: "pass" });
		// A later turn in the same session (no new plan write) is not blocked again.
		expect(evaluatePlanPersistence(root, "sess_plan")).toEqual({ decision: "pass" });
	});

	it("caps at two blocks per session, then passes", () => {
		const root = workspace();
		recordLitPlanActivation(root, "sess_plan", 5_000);
		for (let index = 0; index < PLAN_PERSISTENCE_MAX_BLOCKS; index += 1) {
			expect(evaluatePlanPersistence(root, "sess_plan").decision).toBe("block");
		}
		expect(evaluatePlanPersistence(root, "sess_plan")).toEqual({ decision: "pass" });
	});

	it("scopes the guard per session id", () => {
		const root = workspace();
		recordLitPlanActivation(root, "sess_a", 5_000);
		expect(evaluatePlanPersistence(root, "sess_b")).toEqual({ decision: "pass" });
		expect(evaluatePlanPersistence(root, "sess_a").decision).toBe("block");
	});
});

describe("lit-plan persistence guard (hook CLI)", () => {
	it("records the activation on a lit-plan UserPromptSubmit and blocks the Stop until a checkbox plan exists", async () => {
		const root = workspace();
		const submit = await run(
			runUserPromptSubmitHookCli,
			root,
			JSON.stringify({
				hook_event_name: "UserPromptSubmit",
				session_id: "sess_plan",
				turn_id: "turn_1",
				cwd: root,
				prompt: "lit-plan: add a README badge",
			}),
		);
		expect(submit.code).toBe(0);
		expect(submit.stdout).toContain("<lit-plan-mode>");

		const blocked = await run(runStopPlanPersistenceHookCli, root, stopInput(root));
		expect(blocked.code).toBe(0);
		expect(blocked.stderr).toBe("");
		const decision = JSON.parse(blocked.stdout) as { decision: string; reason: string };
		expect(decision.decision).toBe("block");
		expect(decision.reason).toContain(PLAN_PUBLISHER_COMMAND);

		writePlan(root, "readme-badge.md", CHECKBOX_PLAN, Date.now() + 5_000);
		const passed = await run(runStopPlanPersistenceHookCli, root, stopInput(root));
		expect(passed).toEqual({ code: 0, stdout: "", stderr: "" });
	});

	it("does not block a Stop for a session that never activated lit-plan", async () => {
		const root = workspace();
		await run(
			runUserPromptSubmitHookCli,
			root,
			JSON.stringify({
				hook_event_name: "UserPromptSubmit",
				session_id: "sess_loop",
				turn_id: "turn_1",
				cwd: root,
				prompt: "litwork: fix the flaky test",
			}),
		);
		const result = await run(runStopPlanPersistenceHookCli, root, stopInput(root, "sess_loop"));
		expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
	});
});
