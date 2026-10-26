// Lane records: the hook payload parser, the per-child store and the hook routes that feed them. The
// payloads are the ones codex-cli 0.164.0 sent to a probe hook (2026-10-26); anything else yields no lane.

import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runPostToolUseLiveHookCli, runSubagentHookCli } from "./hook-cli.js";
import { laneScope, planCounts, subagentEvent, toolLaneEvents } from "./lane-events.js";
import {
	applyLaneEvent,
	LANE_STALE_MS,
	type LaneRecord,
	readLanes,
	readMainPlan,
	recordLaneEvent,
} from "./lane-state.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-lanes-")));
	roots.push(root);
	mkdirSync(join(root, ".litcodex"), { recursive: true });
	return root;
}

const SESSION = "01a1772b-666e-7423-8183-ffa7e1ef9956";
const CHILD = "01a1772b-6926-7a73-a76f-bd0aab8ca19c";

function start(cwd: string, agent = CHILD): Record<string, unknown> {
	return {
		session_id: SESSION,
		turn_id: "01a1772b-6991-74b3-bf6a-a3bdbd4513e1",
		transcript_path: "/x/rollout.jsonl",
		cwd,
		hook_event_name: "SubagentStart",
		model: "fake-model",
		permission_mode: "bypassPermissions",
		agent_id: agent,
		agent_type: "default",
	};
}

function stop(cwd: string, agent = CHILD): Record<string, unknown> {
	return {
		...start(cwd, agent),
		hook_event_name: "SubagentStop",
		agent_transcript_path: "/x/child.jsonl",
		stop_hook_active: false,
		last_assistant_message: "private words",
	};
}

function spawned(cwd: string, nickname = "Aquinas", agent = CHILD): Record<string, unknown> {
	return {
		session_id: SESSION,
		cwd,
		hook_event_name: "PostToolUse",
		tool_name: "spawn_agent",
		tool_input: { message: "private task text" },
		tool_response: JSON.stringify({ agent_id: agent, nickname }),
		tool_use_id: "call_spawn1",
	};
}

function childTool(cwd: string, tool = "Bash", extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		session_id: SESSION,
		cwd,
		hook_event_name: "PostToolUse",
		agent_id: CHILD,
		agent_type: "default",
		tool_name: tool,
		tool_input: { command: "echo child-step" },
		tool_response: "child-step\n",
		tool_use_id: "call_child1",
		...extra,
	};
}

describe("lane payload parser", () => {
	it("reads a SubagentStart and a SubagentStop into started and stopped", () => {
		expect(subagentEvent(start("/w"), "start")).toEqual({ type: "started", agentId: CHILD, kind: "default" });
		expect(subagentEvent(stop("/w"), "stop")).toEqual({ type: "stopped", agentId: CHILD });
	});

	it("reads the nickname from the spawn_agent reply, as JSON text or as an object", () => {
		expect(toolLaneEvents(spawned("/w"))).toEqual([{ type: "spawned", agentId: CHILD, name: "Aquinas" }]);
		const asObject = { ...spawned("/w"), tool_response: { agent_id: CHILD, nickname: "Hume" } };
		expect(toolLaneEvents(asObject)).toEqual([{ type: "spawned", agentId: CHILD, name: "Hume" }]);
	});

	it("counts a child's tool call as a step and never keeps its input", () => {
		const events = toolLaneEvents(childTool("/w"));
		expect(events).toEqual([{ type: "tool", agentId: CHILD }]);
		expect(JSON.stringify(events)).not.toContain("child-step");
	});

	it("turns an update_plan list into done and total, for a child or for the main thread", () => {
		const plan = {
			plan: [
				{ step: "a", status: "completed" },
				{ step: "b", status: "in_progress" },
				{ step: "c", status: "pending" },
			],
		};
		expect(planCounts(plan)).toEqual({ done: 1, total: 3 });
		expect(toolLaneEvents(childTool("/w", "update_plan", { tool_input: plan }))).toEqual([
			{ type: "plan", agentId: CHILD, counts: { done: 1, total: 3 } },
			{ type: "tool", agentId: CHILD },
		]);
		const main = { session_id: SESSION, cwd: "/w", tool_name: "update_plan", tool_input: plan };
		expect(toolLaneEvents(main)).toEqual([{ type: "plan", agentId: null, counts: { done: 1, total: 3 } }]);
	});

	it("fails open: a payload of another shape yields no event", () => {
		for (const bad of [null, 7, "x", [], {}, { agent_id: 5 }, { agent_id: "" }, { agent_id: "a".repeat(200) }]) {
			expect(subagentEvent(bad, "start")).toBeNull();
			expect(toolLaneEvents(bad)).toEqual([]);
		}
		expect(planCounts({ plan: [] })).toBeNull();
		expect(planCounts({ plan: [{ status: "bogus" }] })).toBeNull();
		expect(planCounts({ plan: "no" })).toBeNull();
		expect(laneScope({ session_id: SESSION, cwd: "relative/path" })).toBeNull();
		expect(toolLaneEvents({ tool_name: "spawn_agent", tool_response: "{not json" })).toEqual([]);
	});

	it("drops a nickname that is not plain text", () => {
		for (const nickname of ["", "a?b", "x".repeat(40), "\u001b[31mred", "../etc"]) {
			expect(toolLaneEvents(spawned("/w", nickname))).toEqual([{ type: "spawned", agentId: CHILD, name: null }]);
		}
	});
});

describe("lane store", () => {
	it("opens at start, counts steps and plan, and leaves at stop", () => {
		const cwd = workspace();
		const t = 1_000_000;
		recordLaneEvent(cwd, SESSION, { type: "spawned", agentId: CHILD, name: "Aquinas" }, t);
		expect(readLanes(cwd, SESSION, t)).toEqual([]);
		recordLaneEvent(cwd, SESSION, { type: "started", agentId: CHILD, kind: "default" }, t + 1);
		recordLaneEvent(cwd, SESSION, { type: "tool", agentId: CHILD }, t + 2);
		recordLaneEvent(cwd, SESSION, { type: "tool", agentId: CHILD }, t + 3);
		recordLaneEvent(cwd, SESSION, { type: "plan", agentId: CHILD, counts: { done: 1, total: 4 } }, t + 4);
		expect(readLanes(cwd, SESSION, t + 5)).toMatchObject([
			{ agentId: CHILD, name: "Aquinas", kind: "default", steps: 2, plan: { done: 1, total: 4 } },
		]);
		recordLaneEvent(cwd, SESSION, { type: "stopped", agentId: CHILD }, t + 6);
		expect(readLanes(cwd, SESSION, t + 7)).toEqual([]);
	});

	it("takes the nickname whether the spawn reply or the start event comes first", () => {
		const cwd = workspace();
		recordLaneEvent(cwd, SESSION, { type: "started", agentId: CHILD, kind: null }, 10);
		recordLaneEvent(cwd, SESSION, { type: "spawned", agentId: CHILD, name: "Hume" }, 11);
		expect(readLanes(cwd, SESSION, 12)[0]?.name).toBe("Hume");
	});

	it("ignores a step or a plan for a child that never started, and a stop that arrives first", () => {
		const cwd = workspace();
		recordLaneEvent(cwd, SESSION, { type: "tool", agentId: CHILD }, 10);
		recordLaneEvent(cwd, SESSION, { type: "plan", agentId: CHILD, counts: { done: 1, total: 2 } }, 11);
		recordLaneEvent(cwd, SESSION, { type: "stopped", agentId: CHILD }, 12);
		expect(readLanes(cwd, SESSION, 13)).toEqual([]);
		expect(readdirSync(join(cwd, ".litcodex")).includes("lane-state")).toBe(false);
	});

	it("drops a lane nobody touched for the stale window", () => {
		const cwd = workspace();
		recordLaneEvent(cwd, SESSION, { type: "started", agentId: CHILD, kind: null }, 1_000);
		expect(readLanes(cwd, SESSION, 1_000 + LANE_STALE_MS - 1)).toHaveLength(1);
		expect(readLanes(cwd, SESSION, 1_000 + LANE_STALE_MS + 1)).toEqual([]);
	});

	it("keeps the main thread's plan count apart from the lanes", () => {
		const cwd = workspace();
		recordLaneEvent(cwd, SESSION, { type: "plan", agentId: null, counts: { done: 2, total: 5 } }, 10);
		expect(readMainPlan(cwd, SESSION)).toEqual({ done: 2, total: 5 });
		expect(readLanes(cwd, SESSION, 11)).toEqual([]);
	});

	it("is pure: applyLaneEvent never mutates the record it was given", () => {
		const lane: LaneRecord = {
			agentId: CHILD,
			name: null,
			kind: null,
			started: true,
			startedAt: 1,
			at: 1,
			steps: 0,
			plan: null,
		};
		const frozen = Object.freeze({ ...lane });
		expect(applyLaneEvent(frozen, { type: "tool", agentId: CHILD }, 5)).toMatchObject({ steps: 1, at: 5 });
		expect(frozen.steps).toBe(0);
		expect(applyLaneEvent(frozen, { type: "stopped", agentId: CHILD }, 5)).toBeNull();
	});

	it("never writes through a symlinked lane folder and never throws", () => {
		const cwd = workspace();
		const away = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-lanes-away-")));
		roots.push(away);
		mkdirSync(join(cwd, ".litcodex", "lane-state"), { recursive: true });
		symlinkSync(away, join(cwd, ".litcodex", "lane-state", SESSION));
		recordLaneEvent(cwd, SESSION, { type: "started", agentId: CHILD, kind: null }, 10);
		expect(readdirSync(away)).toEqual([]);
		expect(readLanes(cwd, SESSION, 11)).toEqual([]);
		expect(lstatSync(join(cwd, ".litcodex", "lane-state", SESSION)).isSymbolicLink()).toBe(true);
	});

	it("skips an oversized or malformed lane file", () => {
		const cwd = workspace();
		recordLaneEvent(cwd, SESSION, { type: "started", agentId: CHILD, kind: null }, 10);
		const dir = join(cwd, ".litcodex", "lane-state", SESSION);
		writeFileSync(join(dir, "lane-bad.json"), "{not json");
		writeFileSync(join(dir, "lane-big.json"), `{"agentId":"big","pad":"${"x".repeat(5000)}"}`);
		expect(readLanes(cwd, SESSION, 11).map((lane) => lane.agentId)).toEqual([CHILD]);
	});
});

async function feed(route: (stdin: PassThrough) => Promise<number>, payload: string): Promise<{ code: number }> {
	const stdin = new PassThrough();
	const code = route(stdin);
	stdin.end(payload);
	return { code: await code };
}

describe("lane hook routes", () => {
	function litThread(cwd: string): void {
		recordWorkflowTurn(cwd, SESSION, "turn-1", "lit-loop", 100_000);
	}

	it("a SubagentStart in a LIT thread opens a lane; the SubagentStop closes it; nothing is printed", async () => {
		const cwd = workspace();
		litThread(cwd);
		expect((await feed((s) => runSubagentHookCli("start", s, { now: 1_000 }), JSON.stringify(start(cwd)))).code).toBe(
			0,
		);
		expect(readLanes(cwd, SESSION, 1_001)).toHaveLength(1);
		expect((await feed((s) => runSubagentHookCli("stop", s, { now: 2_000 }), JSON.stringify(stop(cwd)))).code).toBe(
			0,
		);
		expect(readLanes(cwd, SESSION, 2_001)).toEqual([]);
	});

	it("a thread without a LIT activation leaves no lane folder", async () => {
		const cwd = workspace();
		await feed((s) => runSubagentHookCli("start", s, { now: 1_000 }), JSON.stringify(start(cwd)));
		expect(readdirSync(join(cwd, ".litcodex"))).toEqual([]);
	});

	it("exits 0 and stays silent on malformed, empty and oversized-shape payloads", async () => {
		const cwd = workspace();
		litThread(cwd);
		for (const payload of [
			"",
			"   ",
			"{not json",
			"[]",
			"null",
			JSON.stringify({ agent_id: 7 }),
			JSON.stringify(start("relative")),
		]) {
			expect((await feed((s) => runSubagentHookCli("start", s), payload)).code).toBe(0);
			expect((await feed((s) => runSubagentHookCli("stop", s), payload)).code).toBe(0);
		}
		expect(readLanes(cwd, SESSION, Date.now())).toEqual([]);
	});

	it("the catch-all PostToolUse names the lane from spawn_agent and counts the child's tools", async () => {
		const cwd = workspace();
		litThread(cwd);
		const post = (payload: unknown, now: number) =>
			feed(
				(s) => runPostToolUseLiveHookCli(s, new PassThrough(), new PassThrough(), { now }),
				JSON.stringify(payload),
			);
		await post(spawned(cwd), 1_000);
		await feed((s) => runSubagentHookCli("start", s, { now: 1_001 }), JSON.stringify(start(cwd)));
		await post(childTool(cwd), 1_002);
		await post(childTool(cwd), 1_003);
		expect(readLanes(cwd, SESSION, 1_004)).toMatchObject([{ name: "Aquinas", steps: 2 }]);
	});
});
