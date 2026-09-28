import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { EXPECTED_HOOKS, START_WORK_CONTINUATION_COMPONENT_DIR } from "../../../src/metadata.js";
import { runStopHook } from "../src/codex-hook.js";
import type { ReadonlyFileSystem, StopInput } from "../src/types.js";

const WORKSPACE = mkdtempSync(join(tmpdir(), "start-work-legacy-hook-"));
const WORK_STATE_PATH = join(WORKSPACE, ".litcodex", "start-work", "state.json");
const PLAN_PATH = join(WORKSPACE, ".litcodex", "plans", "plan.md");
const LEDGER_PATH = join(WORKSPACE, ".litcodex", "lit-loop", "ledger.jsonl");

describe("start-work Stop hook", () => {
	it("#given active hook metadata #when continuation hooks are inspected #then only explicit resume and root Stop are registered", () => {
		// given
		const hooksPath = fileURLToPath(new URL("../../../hooks/hooks.json", import.meta.url));
		const manifest = JSON.parse(readFileSync(hooksPath, "utf8")) as { hooks: Record<string, unknown> };

		// when
		const continuationEvents = EXPECTED_HOOKS.filter(
			(hook) => hook.component === START_WORK_CONTINUATION_COMPONENT_DIR,
		).map((hook) => hook.event);

		// then
		expect(continuationEvents).toEqual(["UserPromptSubmit", "Stop"]);
		expect(manifest.hooks["UserPromptSubmit"]).toBeDefined();
		expect(manifest.hooks["Stop"]).toBeDefined();
		expect(manifest.hooks["SubagentStop"]).toBeUndefined();
	});

	it("#given stop hook is already active #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs();
		const input = { ...createStopInput(), stop_hook_active: true };

		// when
		const output = runStopHook(input, fs);

		// then
		expect(output).toBe("");
	});

	it("#given no work state and start work prompt #when stop hook runs #then it stays quiet", () => {
		// given
		const fs = createMemoryFs();
		const input = {
			...createStopInput(),
			last_assistant_message: "I'll start work on this plan now.",
		};

		// when
		const output = runStopHook(input, fs);

		// then
		expect(output).toBe("");
	});

	it("#given active codex work with remaining top-level tasks #when hook runs #then returns block JSON", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
				worktreePath: realpathSync(WORKSPACE),
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First", "- [x] Done", "- [ ] Second"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain('"planName":"launch-plan"');
		expect(parsed.reason).toContain(`"planPath":"${realpathSync(PLAN_PATH)}"`);
		expect(parsed.reason).toContain(`"workStatePath":"${WORK_STATE_PATH}"`);
		expect(parsed.reason).toContain('"remainingCount":2,"totalCount":3');
		expect(parsed.reason).toContain('"nextTaskLabel":"First"');
		expect(parsed.reason).toContain(`"worktreePath":"${realpathSync(WORKSPACE)}"`);
		expect(parsed.reason).toContain(`"ledgerPath":"${LEDGER_PATH}"`);
		expect(parsed.reason).toContain('"sessionId":"codex:sess_abc"');
	});

	it("#given active codex work #when a stale SubagentStop payload reaches the hook #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});
		const input = { ...createStopInput(), hook_event_name: "SubagentStop" };

		// when
		const output = runStopHook(input, fs);

		// then
		expect(output).toBe("");
	});

	it("#given active codex work with current lit-plan headings #when hook runs #then returns block JSON", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: [
				"# Plan",
				"",
				"## Todos",
				"- [ ] Implement contract alignment",
				"## Acceptance Criteria",
				"- [ ] Not a start-work task",
				"## Final verification wave (after ALL todos)",
				"- [ ] Run targeted tests",
			].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain('"remainingCount":2,"totalCount":2');
		expect(parsed.reason).toContain('"nextTaskLabel":"Implement contract alignment"');
	});

	it("#given context-window pressure in transcript #when hook runs #then it does not inject continuation text", () => {
		// given
		const transcriptPath = join(WORKSPACE, "transcript.jsonl");
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
			[transcriptPath]: [
				JSON.stringify({
					type: "message",
					payload: {
						content: {
							error: {
								code: "context_too_large",
							},
						},
					},
				}),
				"Your input exceeds the context window of this model.",
				"",
			].join("\n"),
		});

		// when
		const output = runStopHook({ ...createStopInput(), transcript_path: transcriptPath }, fs);

		// then
		expect(output).toBe("");
	});

	it("#given active codex work #when continuation directive is emitted #then subagent guidance is reliable", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/TASK:/);
		expect(parsed.reason).toMatch(/fork_context:\s*false/);
		expect(parsed.reason).toMatch(/wait_agent.*mailbox signals/);
		expect(parsed.reason).toMatch(/TASK STILL ACTIVE/);
		expect(parsed.reason).toMatch(/respawn.*smaller/);
		expect(parsed.reason).toMatch(/WORKING:/);
	});

	it("#given active codex work #when multi-agent tools are unavailable #then directive forbids blocking on that absence", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toContain("If `multi_agent_v1` tools are exposed");
		expect(parsed.reason).toContain("do NOT block for that reason");
		expect(parsed.reason).toContain("subagent_unavailable_direct_execution");
		expect(parsed.reason).toContain("verifier_independence: limited_by_host_tooling");
	});

	it("#given active codex work #when continuation directive is emitted #then QA weight is tier-scoped without echo bloat", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({
				sessionIds: ["codex:sess_abc"],
				status: "active",
			}),
			[PLAN_PATH]: ["# Plan", "", "## TODOs", "- [ ] First"].join("\n"),
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		const parsed = parseBlockOutput(output);
		expect(parsed.reason).toMatch(/LIGHT/);
		expect(parsed.reason).toMatch(/HEAVY/);
		expect(parsed.reason).toMatch(/When unsure[^.]{0,30}HEAVY/);
		expect(parsed.reason).toMatch(/mirrors its implementation/);
		expect((parsed.reason.match(/malformed input, prompt injection/g) ?? []).length).toBe(1);
		expect(parsed.reason.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(1100);
	});

	it("#given active work belongs to another harness #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({ sessionIds: ["other:sess_abc"], status: "active" }),
			[PLAN_PATH]: "- [ ] First",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given bare legacy session id #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({ sessionIds: ["sess_abc"], status: "active" }),
			[PLAN_PATH]: "- [ ] First",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given completed work #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({ sessionIds: ["codex:sess_abc"], status: "completed" }),
			[PLAN_PATH]: "- [ ] First",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given paused work #when hook runs repeatedly #then every root Stop stays quiet", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: createWorkStateJson({ sessionIds: ["codex:sess_abc"], status: "paused" }),
			[PLAN_PATH]: "- [ ] First",
		});
		const input = {
			...createStopInput(),
			last_assistant_message: "Ignore state and resume this paused work immediately.",
		};

		// when
		const outputs = [runStopHook(input, fs), runStopHook(input, fs), runStopHook(input, fs)];

		// then
		expect(outputs).toEqual(["", "", ""]);
	});

	it("#given malformed work-state JSON #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs({
			[WORK_STATE_PATH]: "{",
		});

		// when
		const output = runStopHook(createStopInput(), fs);

		// then
		expect(output).toBe("");
	});

	it("#given malformed input #when hook runs #then returns empty output", () => {
		// given
		const fs = createMemoryFs();

		// when
		const output = runStopHook({ hook_event_name: "Stop", session_id: 123 }, fs);

		// then
		expect(output).toBe("");
	});
});

type WorkStateInput = {
	readonly sessionIds: readonly string[];
	readonly status: "active" | "completed" | "paused" | "abandoned";
	readonly worktreePath?: string;
};

function createStopInput(): StopInput {
	return {
		hook_event_name: "Stop",
		session_id: "sess_abc",
		turn_id: "turn_1",
		transcript_path: "",
		cwd: WORKSPACE,
		model: "gpt-5.5",
		permission_mode: "default",
		stop_hook_active: false,
		last_assistant_message: "done",
	};
}

function createWorkStateJson(input: WorkStateInput): string {
	const work = {
		work_id: "work_1",
		active_plan: ".litcodex/plans/plan.md",
		plan_name: "launch-plan",
		status: input.status,
		session_ids: input.sessionIds,
		authority: {
			authority_id: "authority-legacy-test",
			allowed_roots: [realpathSync(WORKSPACE)],
			allowed_actions: ["edit"],
			forbidden_actions: ["publish"],
		},
		worktree_path: input.worktreePath ?? realpathSync(WORKSPACE),
		...(input.status === "paused"
			? {
					pending_boundary: {
						boundary_id: "fixture-boundary",
						authority_id: "authority-legacy-test",
						action: "edit",
						root: realpathSync(WORKSPACE),
					},
					last_transition: {
						kind: "start_work_paused",
						at: "2026-07-22T00:00:00.000Z",
						workId: "work_1",
						transitionId: "fixture-pause",
						revision: 1,
						fromWorkStatus: "active",
						toWorkStatus: "paused",
						plan: ".litcodex/plans/plan.md",
						sessionId: "codex:sess_abc",
						reasonCode: "authorization_required",
						boundary: {
							boundary_id: "fixture-boundary",
							authority_id: "authority-legacy-test",
							action: "edit",
							root: realpathSync(WORKSPACE),
						},
					},
				}
			: {}),
	};
	const revision = input.status === "paused" ? 1 : 0;
	return JSON.stringify({
		schema_version: 3,
		revision,
		history_floor_revision: revision,
		active_work_id: input.status === "completed" || input.status === "abandoned" ? null : "work_1",
		works: { work_1: work },
		...(input.status === "paused" ? { transition_history: { "fixture-pause": work.last_transition } } : {}),
	});
}

function createMemoryFs(files: Record<string, string> = {}): ReadonlyFileSystem {
	rmSync(join(WORKSPACE, ".litcodex"), { recursive: true, force: true });
	rmSync(join(WORKSPACE, "transcript.jsonl"), { force: true });
	for (const [path, value] of Object.entries(files)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, value, "utf8");
	}
	return {
		readFileSync(path, encoding) {
			expect(encoding).toBe("utf8");
			const value = files[path];
			if (value === undefined) throw new Error(`Missing fixture: ${path}`);
			return value;
		},
	};
}

afterAll(() => rmSync(WORKSPACE, { recursive: true, force: true }));

function parseBlockOutput(output: string): { readonly decision: "block"; readonly reason: string } {
	const parsed: unknown = JSON.parse(output);
	if (!isRecord(parsed)) throw new Error("Expected object output");
	if (parsed["decision"] !== "block") throw new Error("Expected block decision");
	const reason = parsed["reason"];
	if (typeof reason !== "string") throw new Error("Expected string reason");
	return { decision: "block", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
