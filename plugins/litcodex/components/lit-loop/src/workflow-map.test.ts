import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runStopHook } from "../../start-work-continuation/src/codex-hook.js";
import { analyzePlanProgress } from "../../start-work-continuation/src/plan-progress.js";
import { runStopPlanPersistenceHookCli, runUserPromptSubmitHookCli } from "./hook-cli.js";
import { activationMessage } from "./lit-mark.js";
import {
	countPlanRows,
	progressBar,
	readWorkflowSignals,
	recordWorkflowTurn,
	renderWorkflowMap,
	safeTitle,
	workflowMapLine,
	workflowStopLine,
} from "./workflow-map.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-workflow-map-")));
	roots.push(root);
	return root;
}

const PLAN = [
	"# Plan",
	"## Todos",
	"- [x] 1. Wire the store",
	"- [x] 2. Add the reader",
	"- [x] 3. Render the map",
	"- [ ] 4. Show the map in `codex` via /tmp/x --flag",
	"- [ ] 5. Write the docs",
	"```",
	"- [ ] 9. fenced rows never count",
	"```",
	"## Final verification wave",
	"- [ ] F1. Plan compliance audit",
	"- [ ] F2. Code quality review",
	"## Notes",
	"- [ ] stray row outside the contract",
	"",
].join("\n");

function writePlan(root: string, body = PLAN, name = "boost.md"): void {
	mkdirSync(join(root, ".litcodex/plans"), { recursive: true });
	writeFileSync(join(root, ".litcodex/plans", name), body);
}

function writeWork(
	root: string,
	status: "active" | "paused" | "completed" | "abandoned",
	sessions = ["codex:s1"],
): void {
	mkdirSync(join(root, ".litcodex/start-work"), { recursive: true });
	const terminal = status === "completed" || status === "abandoned";
	writeFileSync(
		join(root, ".litcodex/start-work/state.json"),
		JSON.stringify({
			schema_version: 3,
			revision: 4,
			active_work_id: terminal ? null : "w1",
			works: {
				w1: {
					work_id: "w1",
					active_plan: ".litcodex/plans/boost.md",
					plan_name: "boost",
					session_ids: sessions,
					status,
					worktree_path: null,
					last_transition: { kind: "start_work_initialized", at: "2026-10-12T00:00:00.000Z" },
				},
			},
		}),
	);
}

function writeGoals(root: string, statuses: string[], session: string | null = "s1"): void {
	const dir = session === null ? join(root, ".litcodex/lit-loop") : join(root, ".litcodex/lit-loop", session);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "goals.json"),
		JSON.stringify({
			version: 1,
			goals: statuses.map((status, index) => ({ id: `G00${index + 1}`, title: `Goal ${index + 1}`, status })),
		}),
	);
}

function writePlanRecord(root: string, satisfied: boolean, session = "s1"): void {
	mkdirSync(join(root, ".litcodex/lit-plan"), { recursive: true });
	writeFileSync(
		join(root, ".litcodex/lit-plan", `${session}.json`),
		JSON.stringify({ version: 1, sessionId: session, activatedAt: 1, blocks: 0, satisfied }),
	);
}

describe("plan rows", () => {
	it("counts the same rows as the start-work progress reader", () => {
		const progress = analyzePlanProgress(PLAN);
		const rows = countPlanRows(PLAN);
		expect(rows.total).toBe(progress.total);
		expect(rows.total - rows.done).toBe(progress.remaining);
		expect(rows.next).toBe(progress.nextTaskLabel);
		expect(rows).toMatchObject({ done: 3, total: 7 });
	});

	it("counts every row when the plan has no contract sections", () => {
		expect(countPlanRows("- [x] a\n- [ ] b\n")).toEqual({ done: 1, total: 2, next: "b" });
	});
});

describe("progress bar and titles", () => {
	it("draws one cell per task up to ten cells", () => {
		expect(progressBar(3, 7)).toBe("▰▰▰▱▱▱▱");
		expect(progressBar(0, 4)).toBe("▱▱▱▱");
		expect(progressBar(4, 4)).toBe("▰▰▰▰");
		expect([...progressBar(1, 40)]).toHaveLength(10);
		expect(progressBar(1, 40)).toBe("▰▱▱▱▱▱▱▱▱▱");
		expect(progressBar(39, 40)).toBe("▰▰▰▰▰▰▰▰▰▱");
	});

	it("keeps commands, paths and arguments out of a next-task title", () => {
		expect(safeTitle("F2. Code quality review")).toBe("Code quality review");
		expect(safeTitle("\u001b[31mred\u0007 text")).toBe("[31mred text");
		expect(safeTitle("a".repeat(80))).toBe(`${"a".repeat(47)}…`);
		expect(safeTitle("`only code`")).toBeNull();
	});

	it("cuts a title at its first code span, path, variable or flag instead of deleting words mid-sentence", () => {
		expect(safeTitle("4. Show the map in `codex` via /tmp/x --flag")).toBe("Show the map in …");
		expect(safeTitle("2. Add the stop line to hooks/hooks.json and the README")).toBe("Add the stop line to …");
		expect(safeTitle("3. Teach the doctor about the --status-line flag")).toBe("Teach the doctor about the …");
		expect(safeTitle("5. Read the journal from $SESSION_DIR before synthesis")).toBe("Read the journal from …");
		expect(safeTitle("6. Retake the README pictures: `npm run qa:tmux`")).toBe("Retake the README pictures …");
		expect(safeTitle("1. LitCodex plain-text workflow map")).toBe("LitCodex plain-text workflow map");
		expect(safeTitle("7. Keep opt-in notify off - default stays quiet")).toBe(
			"Keep opt-in notify off - default stays quiet",
		);
	});

	it("drops a title when too little is left before the cut", () => {
		expect(safeTitle("8. Fix `safeTitle` truncation")).toBeNull();
		expect(safeTitle("run $HOME C:\\x\\y now")).toBeNull();
		expect(safeTitle("Update plugins/litcodex/hooks/hooks.json")).toBeNull();
		expect(safeTitle("Add --json to doctor")).toBeNull();
	});
});

describe("workflow map", () => {
	it("shows the work stage with the plan bar for an active start-work", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		expect(workflowMapLine(root, "s1", "start-work")).toBe("🧭 ✓ › 📝 ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·");
	});

	it("derives the stage from saved state when the skill is outside the main chain", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "paused");
		expect(workflowMapLine(root, "s9", "lit-humanizer")).toBe("🧭 ✓ › 📝 ✓ › 🔨 PAUSED ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·");
	});

	it("draws no map for an outside skill when nothing is saved", () => {
		expect(workflowMapLine(repo(), "s1", "lit-humanizer")).toBeNull();
	});

	it("omits earlier stages that have no saved signal", () => {
		const root = repo();
		expect(workflowMapLine(root, "s1", "deep-interview")).toBe("🧭 INTERVIEW › 📝 · › 🔨 · › 🔍 · › 🏁 ·");
		expect(workflowMapLine(root, "s1", "lit-plan")).toBe("📝 PLAN › 🔨 · › 🔍 · › 🏁 ·");
		expect(workflowMapLine(root, "s1", "review-work")).toBe("🔍 REVIEW › 🏁 ·");
		expect(workflowMapLine(root, "s1", "lit-loop")).toBe("🔨 WORK › 🔍 · › 🏁 ·");
	});

	it("ignores later-stage state while the user is back in planning", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		expect(workflowMapLine(root, "s1", "lit-plan")).toBe("🧭 ✓ › 📝 PLAN › 🔨 · › 🔍 · › 🏁 ·");
	});

	it("reads the lit-plan record: drafting is the plan stage, a published plan is ready for work", () => {
		const root = repo();
		writePlanRecord(root, false);
		expect(workflowMapLine(root, "s1", null)).toBe("📝 PLAN › 🔨 · › 🔍 · › 🏁 ·");
		writePlanRecord(root, true);
		expect(workflowMapLine(root, "s1", null)).toBe("🧭 ✓ › 📝 ✓ › 🔨 · › 🔍 · › 🏁 ·");
		expect(workflowMapLine(root, "other", null)).toBeNull();
	});

	it("counts lit-loop goals when no start-work is running", () => {
		const root = repo();
		writeGoals(root, ["complete", "in_progress", "pending"]);
		expect(workflowMapLine(root, "s1", "lit-loop")).toBe("🔨 WORK ▰▱▱ 1/3 › 🔍 · › 🏁 ·");
		expect(workflowMapLine(root, "s2", "lit-loop")).toBe("🔨 WORK › 🔍 · › 🏁 ·");
	});

	it("uses unscoped goals only while one is still open", () => {
		const root = repo();
		writeGoals(root, ["complete", "pending"], null);
		expect(workflowMapLine(root, "s2", "lit-loop")).toBe("🔨 WORK ▰▱ 1/2 › 🔍 · › 🏁 ·");
		writeGoals(root, ["complete", "complete"], null);
		expect(workflowMapLine(root, "s2", "lit-loop")).toBe("🔨 WORK › 🔍 · › 🏁 ·");
	});

	it("marks a finished plan as done only for the session that ran it", () => {
		const root = repo();
		writePlan(root, PLAN.replaceAll("- [ ]", "- [x]"));
		writeWork(root, "completed");
		expect(workflowMapLine(root, "s1", null)).toBe("🧭 ✓ › 📝 ✓ › 🔨 ✓ › 🔍 ✓ › 🏁 DONE");
		expect(workflowMapLine(root, "s2", null)).toBeNull();
	});

	it("shows unfinished work beside the review stage", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		expect(workflowMapLine(root, "s1", "review-work")).toBe("🧭 ✓ › 📝 ✓ › 🔨 ▰▰▰▱▱▱▱ 3/7 › 🔍 REVIEW › 🏁 ·");
		writePlan(root, PLAN.replaceAll("- [ ]", "- [x]"));
		expect(workflowMapLine(root, "s1", "review-work")).toBe("🧭 ✓ › 📝 ✓ › 🔨 ✓ › 🔍 REVIEW › 🏁 ·");
	});

	it("starts the research family at decomposition when no journal is open", () => {
		expect(workflowMapLine(repo(), "s1", "litresearch")).toBe("🔎 DECOMPOSE › 🌊 · › 🔬 · › 🏁 ·");
	});

	it("follows the saved research journal: waves, expansion, verification and synthesis", () => {
		const root = repo();
		const journal = join(root, ".litcodex/lit-loop/litresearch/20261012-101010");
		mkdirSync(journal, { recursive: true });
		expect(workflowMapLine(root, "s1", "litresearch")).toBe("🔎 DECOMPOSE › 🌊 · › 🔬 · › 🏁 ·");
		writeFileSync(join(journal, "wave-1-codebase-hooks.md"), "x");
		expect(workflowMapLine(root, "s1", "litresearch")).toBe("🔎 ✓ › 🌊 WAVE 1 › 🔬 · › 🏁 ·");
		writeFileSync(join(journal, "wave-3-expand-lease.md"), "x");
		expect(workflowMapLine(root, "s1", "litresearch")).toBe("🔎 ✓ › 🌊 WAVE 3 EXPAND › 🔬 · › 🏁 ·");
		writeFileSync(join(journal, "verify-lease-race.md"), "x");
		expect(workflowMapLine(root, "s1", "litresearch")).toBe("🔎 ✓ › 🌊 ✓ 3 waves › 🔬 VERIFY › 🏁 ·");
	});

	it("starts a new research at decomposition once the newest journal is synthesized or stale", () => {
		const root = repo();
		const journal = join(root, ".litcodex/lit-loop/litresearch/20261012-101010");
		mkdirSync(journal, { recursive: true });
		writeFileSync(join(journal, "wave-2-expand-a.md"), "x");
		writeFileSync(join(journal, "SYNTHESIS.md"), "x");
		expect(workflowMapLine(root, "s1", "litresearch")).toBe("🔎 DECOMPOSE › 🌊 · › 🔬 · › 🏁 ·");
		rmSync(join(journal, "SYNTHESIS.md"));
		const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
		utimesSync(join(journal, "wave-2-expand-a.md"), old, old);
		utimesSync(journal, old, old);
		expect(workflowMapLine(root, "s1", "litresearch")).toBe("🔎 DECOMPOSE › 🌊 · › 🔬 · › 🏁 ·");
	});

	it("fails open on unreadable or hostile state", () => {
		const root = repo();
		mkdirSync(join(root, ".litcodex/start-work"), { recursive: true });
		writeFileSync(join(root, ".litcodex/start-work/state.json"), "{not json");
		mkdirSync(join(root, ".litcodex/lit-loop/s1"), { recursive: true });
		writeFileSync(join(root, ".litcodex/lit-loop/s1/goals.json"), '{"goals":"nope"}');
		expect(readWorkflowSignals(root, "s1")).toEqual({ work: null, goals: null, plan: null, research: null });
		const outside = repo();
		writePlan(outside);
		mkdirSync(join(root, ".litcodex/plans"), { recursive: true });
		symlinkSync(join(outside, ".litcodex/plans/boost.md"), join(root, ".litcodex/plans/boost.md"));
		writeWork(root, "active");
		expect(readWorkflowSignals(root, "s1").work).toBeNull();
		expect(workflowMapLine("relative/path", "s1", "lit-loop")).toBe("🔨 WORK › 🔍 · › 🏁 ·");
	});

	it("never carries escape codes", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		const map = renderWorkflowMap("start-work", readWorkflowSignals(root, "s1"));
		expect(map).not.toMatch(/[\u0000-\u001f\u007f]/u);
	});
});

describe("stop line", () => {
	it("reports the tasks finished during the LIT turn and the next one", () => {
		const root = repo();
		writePlan(root, PLAN.replace("- [x] 2.", "- [ ] 2.").replace("- [x] 3.", "- [ ] 3."));
		writeWork(root, "active");
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		writePlan(root);
		expect(workflowStopLine(root, "s1", "t1")).toBe("✨ turn done · 2 tasks ✓ · next ▸ Show the map in …");
	});

	it("says nothing for a turn that was not a LIT activation", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		expect(workflowStopLine(root, "s1", "t2")).toBeNull();
		expect(workflowStopLine(root, "s2", "t1")).toBeNull();
	});

	it("keeps the plain finish line when nothing is saved", () => {
		const root = repo();
		recordWorkflowTurn(root, "s1", "t1", "lit-humanizer", 1000);
		expect(workflowStopLine(root, "s1", "t1")).toBe("✨ turn done");
	});

	it("counts goals and singular units", () => {
		const root = repo();
		writeGoals(root, ["pending", "pending"]);
		recordWorkflowTurn(root, "s1", "t1", "lit-loop", 1000);
		writeGoals(root, ["complete", "pending"]);
		expect(workflowStopLine(root, "s1", "t1")).toBe("✨ turn done · 1 goal ✓ · next ▸ Goal 2");
	});

	it("reports a finished plan", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		writePlan(root, PLAN.replaceAll("- [ ]", "- [x]"));
		expect(workflowStopLine(root, "s1", "t1")).toBe("✨ turn done · 4 tasks ✓ · all 7 tasks ✓");
	});

	it("names the newest research wave written during the turn", () => {
		const root = repo();
		recordWorkflowTurn(root, "s1", "t1", "litresearch", 0);
		const journal = join(root, ".litcodex/lit-loop/litresearch/20261012-101010");
		mkdirSync(journal, { recursive: true });
		writeFileSync(join(journal, "wave-1-codebase-a.md"), "x");
		writeFileSync(join(journal, "wave-2-expand-b.md"), "x");
		expect(workflowStopLine(root, "s1", "t1")).toBe("✨ turn done · 🌊 wave 2");
	});
});

/** A start-work record the real continuation hook accepts: active, owned by s1, with authority. */
function writeContinuableWork(root: string, extra: Record<string, unknown> = {}): void {
	mkdirSync(join(root, ".litcodex/start-work"), { recursive: true });
	mkdirSync(join(root, ".litcodex/lit-loop"), { recursive: true });
	writeFileSync(
		join(root, ".litcodex/start-work/state.json"),
		JSON.stringify({
			schema_version: 3,
			revision: 0,
			history_floor_revision: 0,
			active_work_id: "w1",
			works: {
				w1: {
					work_id: "w1",
					active_plan: ".litcodex/plans/boost.md",
					plan_name: "boost",
					status: "active",
					session_ids: ["codex:s1"],
					authority: {
						authority_id: "authority-test",
						allowed_roots: [root],
						allowed_actions: ["edit"],
						forbidden_actions: ["publish"],
					},
					worktree_path: root,
					...extra,
				},
			},
		}),
	);
}

function stopInput(root: string, turnId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		hook_event_name: "Stop",
		session_id: "s1",
		turn_id: turnId,
		transcript_path: null,
		cwd: root,
		model: "gpt-5.6",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
		...extra,
	};
}

describe("stop line while start-work keeps the turn going", () => {
	const quiet = { stopHookActive: false, transcriptPath: null };

	it("says the turn continues at a checkpoint the continuation hook will block", () => {
		const root = repo();
		writePlan(root);
		writeContinuableWork(root);
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		expect(workflowStopLine(root, "s1", "t1", quiet)).toBe("⏳ 3/7 tasks ✓ · continuing ▸ Show the map in …");
		expect(runStopHook(stopInput(root, "t1"))).toContain('"decision":"block"');
		// The same turn replays its lease, so a hook that runs after the continuation still agrees.
		expect(workflowStopLine(root, "s1", "t1", quiet)).toBe("⏳ 3/7 tasks ✓ · continuing ▸ Show the map in …");
		expect(runStopHook(stopInput(root, "t1"))).toContain('"decision":"block"');
	});

	it("says the turn is done once the continuation has already nudged this progress", () => {
		const root = repo();
		writePlan(root);
		writeContinuableWork(root);
		expect(runStopHook(stopInput(root, "t0"))).toContain('"decision":"block"');
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		expect(runStopHook(stopInput(root, "t1"))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", quiet)).toBe("✨ turn done · next ▸ Show the map in …");
	});

	it("says the turn is done when the host is already inside a continuation", () => {
		const root = repo();
		writePlan(root);
		writeContinuableWork(root);
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		const active = { stopHookActive: true, transcriptPath: null };
		expect(runStopHook(stopInput(root, "t1", { stop_hook_active: true }))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", active)).toBe("✨ turn done · next ▸ Show the map in …");
	});

	it("says the turn is done under context pressure or an oversized transcript", () => {
		const root = repo();
		writePlan(root);
		writeContinuableWork(root);
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		const pressured = join(root, "pressured.jsonl");
		writeFileSync(pressured, `${JSON.stringify({ type: "error", error: { code: "context_length_exceeded" } })}\n`);
		expect(runStopHook(stopInput(root, "t1", { transcript_path: pressured }))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", { stopHookActive: false, transcriptPath: pressured })).toMatch(
			/^✨ turn done/u,
		);
		const large = join(root, "large.jsonl");
		writeFileSync(large, `${JSON.stringify({ type: "message", text: "x".repeat(2_100_000) })}\n`);
		expect(runStopHook(stopInput(root, "t1", { transcript_path: large }))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", { stopHookActive: false, transcriptPath: large })).toMatch(
			/^✨ turn done/u,
		);
		const clean = join(root, "clean.jsonl");
		writeFileSync(clean, `${JSON.stringify({ type: "message", text: "fine" })}\n`);
		expect(workflowStopLine(root, "s1", "t1", { stopHookActive: false, transcriptPath: clean })).toMatch(/^⏳/u);
		expect(runStopHook(stopInput(root, "t1", { transcript_path: clean }))).toContain('"decision":"block"');
	});

	it("says the turn is done when the work lacks authority, belongs to another session or is finished", () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		recordWorkflowTurn(root, "s1", "t1", "start-work", 1000);
		expect(runStopHook(stopInput(root, "t1"))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", quiet)).toMatch(/^✨ turn done/u);
		writeContinuableWork(root, { session_ids: ["codex:other"] });
		expect(runStopHook(stopInput(root, "t1"))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", quiet)).toMatch(/^✨ turn done/u);
		writeContinuableWork(root);
		writePlan(root, PLAN.replaceAll("- [ ]", "- [x]"));
		expect(runStopHook(stopInput(root, "t1"))).toBe("");
		expect(workflowStopLine(root, "s1", "t1", quiet)).toBe("✨ turn done · 4 tasks ✓ · all 7 tasks ✓");
	});
});

async function drive(
	entry: typeof runStopPlanPersistenceHookCli,
	payload: Record<string, unknown>,
	root: string,
): Promise<{ code: number; stdout: string }> {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(JSON.stringify(payload));
	const code = await entry(stdin, stdout, new PassThrough(), root, { env: {} });
	return { code, stdout: out };
}

async function submit(root: string, prompt: string, extra: Record<string, unknown> = {}) {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: "s1",
			turn_id: "t1",
			transcript_path: null,
			cwd: root,
			model: "gpt-5.6",
			permission_mode: "default",
			prompt,
			...extra,
		}),
	);
	const code = await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), root, { env: {} });
	return { code, stdout: out };
}

function stopEvent(root: string, turnId = "t1"): Record<string, unknown> {
	return {
		hook_event_name: "Stop",
		session_id: "s1",
		turn_id: turnId,
		transcript_path: null,
		cwd: root,
		model: "gpt-5.6",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
	};
}

describe("hook surfaces", () => {
	it("puts the map under the activation banner as plain text", async () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		const result = await submit(root, "$start-work boost");
		expect(result.code).toBe(0);
		const output = JSON.parse(result.stdout) as { systemMessage: string };
		expect(output.systemMessage).toBe(
			`${activationMessage("start-work")}\n🧭 ✓ › 📝 ✓ › 🔨 WORK ▰▰▰▱▱▱▱ 3/7 › 🔍 · › 🏁 ·`,
		);
		expect(output.systemMessage).not.toContain("\u001b");
	});

	it("leaves the banner alone when the event has no absolute cwd", async () => {
		const root = repo();
		writePlan(root);
		writeWork(root, "active");
		const result = await submit(root, "$start-work boost", { cwd: undefined });
		expect((JSON.parse(result.stdout) as { systemMessage: string }).systemMessage).toBe(
			activationMessage("start-work"),
		);
	});

	it("ends a LIT turn with a summary line and stays quiet after an ordinary turn", async () => {
		const root = repo();
		writePlan(root, PLAN.replace("- [x] 3.", "- [ ] 3."));
		writeWork(root, "active");
		await submit(root, "$start-work boost");
		writePlan(root);
		const stop = await drive(runStopPlanPersistenceHookCli, stopEvent(root), root);
		expect(stop.code).toBe(0);
		expect(JSON.parse(stop.stdout)).toEqual({
			systemMessage: "✨ turn done · 1 task ✓ · next ▸ Show the map in …",
		});
		const later = await drive(runStopPlanPersistenceHookCli, stopEvent(root, "t9"), root);
		expect(later.stdout).toBe("");
	});

	it("prints the continuing line from the real Stop hook at a start-work checkpoint", async () => {
		const root = repo();
		writePlan(root, PLAN.replace("- [x] 3.", "- [ ] 3."));
		writeContinuableWork(root);
		await submit(root, "$start-work boost");
		writePlan(root);
		const stop = await drive(runStopPlanPersistenceHookCli, stopEvent(root), root);
		expect(JSON.parse(stop.stdout)).toEqual({ systemMessage: "⏳ 3/7 tasks ✓ · continuing ▸ Show the map in …" });
		const last = await drive(runStopPlanPersistenceHookCli, { ...stopEvent(root), stop_hook_active: true }, root);
		expect(JSON.parse(last.stdout)).toEqual({ systemMessage: "✨ turn done · 1 task ✓ · next ▸ Show the map in …" });
	});

	it("lets a blocking lit-plan guard win over the summary line", async () => {
		const root = repo();
		await submit(root, "lit-plan the boost");
		const stop = await drive(runStopPlanPersistenceHookCli, stopEvent(root), root);
		const output = JSON.parse(stop.stdout) as Record<string, unknown>;
		expect(output["decision"]).toBe("block");
		expect(output["systemMessage"]).toBeUndefined();
	});
});
