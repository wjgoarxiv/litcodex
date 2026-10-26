// The thread rows on the text HUD and the card status: one thread keeps the old layout, three lanes get a
// fork line, a paused parent keeps its gauge and its way back, a long list collapses to `+N more`, a stale
// session drops out, no row ever prints a placeholder, and the same input repaints to the same bytes.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cardStatusText, readCardStatus } from "./card-status.js";
import { type HudView, renderHud } from "./hud.js";
import { type LaneEvent, recordLaneEvent } from "./lane-state.js";
import { writeThreadPointer } from "./live-step.js";
import { evaluatePlanPersistence, recordLitPlanActivation } from "./plan-persistence.js";
import { readThreads, THREAD_ROWS, threadLines } from "./threads.js";
import { recordWorkflowTurn, type WorkflowSignals } from "./workflow-map.js";
import { OTHER_SESSION_MS, readStack, recordStackEvent, type StackEvent } from "./workflow-stack.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const T0 = 1_800_000_000_000;
const SID = "019a0000-cccc-7000-8000-000000000001";
const PLACEHOLDER = /\?\/|\/\?|\[\?+\]|\?\?/u;

function thread(mode = "lit-loop"): { root: string; env: NodeJS.ProcessEnv } {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-threads-home-")));
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-threads-ws-")));
	roots.push(home, root);
	mkdirSync(join(root, ".litcodex"), { recursive: true });
	const env = { CODEX_HOME: home };
	recordWorkflowTurn(root, SID, "turn-1", mode, T0 - 60_000);
	writeThreadPointer(env, SID, root, T0 - 60_000);
	return { root, env };
}

function stack(root: string, events: readonly StackEvent[], sid = SID, at = T0 - 30_000): void {
	for (const [index, event] of events.entries()) recordStackEvent(root, sid, event, new Date(at + index * 1_000));
}

function lane(root: string, n: number, name: string, extra: readonly LaneEvent[] = [], at = T0 - 20_000): string {
	const agentId = `0a1772b0-0000-7000-8000-00000000000${n}`;
	const events: LaneEvent[] = [
		{ type: "spawned", agentId, name },
		{ type: "started", agentId, kind: "default" },
		...extra.map((event) => ("agentId" in event ? { ...event, agentId } : event)),
	];
	for (const [index, event] of events.entries()) recordLaneEvent(root, SID, event, at + index);
	return agentId;
}

function steps(root: string, agentId: string, count: number): void {
	for (let i = 0; i < count; i++) recordLaneEvent(root, SID, { type: "tool", agentId }, T0 - 10_000 + i);
}

function text(env: NodeJS.ProcessEnv): string {
	return cardStatusText(readCardStatus(SID, env, T0));
}

function hud(env: NodeJS.ProcessEnv): string {
	const status = readCardStatus(SID, env, T0, { rollout: false });
	const view: HudView = {
		wanted: null,
		session: { id: SID, folder: "~/work/alpha", lastSeen: T0 - 5_000 },
		status,
		unreadable: [],
	};
	return renderHud(view, { width: 110, color: false, now: T0 });
}

const LOOP_GREEN: readonly StackEvent[] = [
	{ type: "start", skill: "lit-loop" },
	{ type: "record", family: "loop", stage: "GREEN", n: 2, total: 5 },
];

describe("one thread", () => {
	it("keeps the old layout: no thread rows, and the paused-work row still reads as before", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		const status = readCardStatus(SID, env, T0);
		expect(status.threads).toBeNull();
		expect(text(env)).not.toMatch(/lanes? in parallel|other session/u);
		stack(root, [{ type: "start", skill: "lit-brainstorm" }], SID, T0 - 20_000);
		expect(readCardStatus(SID, env, T0).threads).toBeNull();
		expect(text(env)).toContain("⏸ lit-loop GREEN [▉▉░░░] 2/5 ‖ ▶ lit-brainstorm interview · back: lit continue");
	});

	it("a lane that has not started, or has stopped, adds no row", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		recordLaneEvent(
			root,
			SID,
			{ type: "spawned", agentId: "0a1772b0-0000-7000-8000-000000000009", name: "Hume" },
			T0 - 5_000,
		);
		expect(readCardStatus(SID, env, T0).threads).toBeNull();
	});
});

describe("three lanes", () => {
	it("draws a fork line and one row per lane, names kept apart, each with a state word", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		lane(root, 1, "Aquinas", [{ type: "plan", agentId: "", counts: { done: 2, total: 5 } }]);
		steps(root, lane(root, 2, "Lagrange"), 3);
		lane(root, 3, "Hume");
		const lines = text(env).split("\n");
		const start = lines.findIndex((line) => line.startsWith("● lit-loop"));
		expect(lines.slice(start, start + 5)).toEqual([
			"● lit-loop GREEN [▉▉░░░] 2/5 running",
			"┬ 3 lanes in parallel",
			"├─ ● Aquinas  [▉▉░░░] 2/5 running",
			"├─ ● Lagrange 3 steps running",
			"└─ ● Hume     starting running",
		]);
	});

	it("shows on the HUD frame too", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		lane(root, 1, "Aquinas");
		lane(root, 2, "Lagrange");
		const frame = hud(env);
		expect(frame).toContain("┬ 2 lanes in parallel");
		expect(frame).toContain("Aquinas");
		expect(frame).toContain("Lagrange");
	});

	it("a lane with no plan list says its steps in words and never draws a gauge", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		steps(root, lane(root, 1, "Aquinas"), 1);
		lane(root, 2, "Lagrange");
		const out = text(env);
		expect(out).toContain("● Aquinas  1 step running");
		expect(out).toContain("● Lagrange starting running");
		expect(out).not.toMatch(/Aquinas.*\[/u);
	});

	it("a lane gone quiet reads idle, then leaves when its stop event arrives", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		const quiet = lane(root, 1, "Aquinas", [], T0 - 11 * 60_000);
		lane(root, 2, "Lagrange");
		expect(text(env)).toContain("- Aquinas");
		expect(text(env)).toMatch(/- Aquinas\s+starting idle/u);
		recordLaneEvent(root, SID, { type: "stopped", agentId: quiet }, T0 - 1);
		expect(text(env)).not.toContain("Aquinas");
	});
});

describe("paused parent", () => {
	it("keeps the parent's gauge and the way back above a side frame with lanes", () => {
		const { root, env } = thread("lit-brainstorm");
		stack(root, [...LOOP_GREEN, { type: "start", skill: "lit-brainstorm" }], SID, T0 - 40_000);
		lane(root, 1, "Aquinas");
		lane(root, 2, "Lagrange");
		const lines = text(env).split("\n");
		const first = lines.findIndex((line) => line.startsWith("| lit-loop"));
		expect(lines[first]).toBe("| lit-loop       GREEN [▉▉░░░] 2/5 paused");
		expect(lines[first + 1]).toBe("└─ ● lit-brainstorm interview running · back: lit continue");
		expect(lines[first + 2]).toBe("   ┬ 2 lanes in parallel");
		expect(lines[first + 3]).toBe("   ├─ ● Aquinas        starting running");
		expect(lines[first + 4]).toBe("   └─ ● Lagrange       starting running");
	});
});

describe("overflow", () => {
	it("keeps THREAD_ROWS rows, counts the rest and keeps the fork line honest", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		for (let n = 1; n <= 6; n++) lane(root, n, `Agent ${n}`);
		const view = readCardStatus(SID, env, T0).threads;
		expect(view?.lanes).toHaveLength(3);
		expect(view?.more).toBe(3);
		const lines = threadLines(view as NonNullable<typeof view>);
		expect(lines).toContain("┬ 6 lanes in parallel");
		expect(lines.at(-1)).toMatch(/ \+3 more$/u);
		expect(lines.filter((line) => line.includes("Agent "))).toHaveLength(3);
		expect(THREAD_ROWS).toBe(4);
	});

	it("a deep chain still leaves three rows for lanes", () => {
		const { root } = thread();
		stack(root, [...LOOP_GREEN, { type: "start", skill: "lit-brainstorm" }, { type: "start", skill: "lit-hijack" }]);
		for (let n = 1; n <= 4; n++) lane(root, n, `Agent ${n}`);
		const view = readThreads(root, SID, T0, null);
		expect(view?.lanes).toHaveLength(3);
		expect(view?.more).toBe(1);
	});
});

describe("other sessions", () => {
	it("shows a session that moved lately and drops one that did not", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		stack(root, [{ type: "start", skill: "lit-plan" }], "019a0000-dddd-7000-8000-000000000002", T0 - 60_000);
		stack(
			root,
			[{ type: "start", skill: "litresearch" }],
			"019a0000-eeee-7000-8000-000000000003",
			T0 - OTHER_SESSION_MS - 60_000,
		);
		const out = text(env);
		expect(out).toContain("● lit-plan");
		expect(out).toContain("other session 019a0000");
		expect(out).not.toContain("litresearch");
		const view = readCardStatus(SID, env, T0).threads;
		expect(view?.others).toHaveLength(1);
		expect(view?.others[0]?.session).toBe("019a0000");
	});

	it("is the only thread beside this session's own frame: no lane, no fork line", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN);
		stack(root, [{ type: "start", skill: "lit-plan" }], "019a0000-dddd-7000-8000-000000000002", T0 - 60_000);
		expect(text(env)).not.toContain("in parallel");
	});
});

describe("count chain", () => {
	const none: WorkflowSignals = { work: null, goals: null, plan: null, research: null };

	function plan(root: string, name: string, done: number, total: number): string {
		const rel = `.litcodex/plans/${name}.md`;
		mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
		const rows = Array.from({ length: total }, (_, i) => `- [${i < done ? "x" : " "}] ${i + 1}. Task ${i + 1}`);
		writeFileSync(join(root, rel), `# Plan\n\n## Todos\n${rows.join("\n")}\n`);
		return rel;
	}

	function topRow(root: string, signals: WorkflowSignals | null): { gauge: string | null; note: string } {
		lane(root, 1, "Aquinas");
		const view = readThreads(root, SID, T0, signals);
		const row = view?.chain.at(-1);
		return { gauge: row?.gauge ?? null, note: row?.note ?? "" };
	}

	it("takes a recorded count before anything else", () => {
		const { root } = thread();
		const rel = plan(root, "p", 1, 4);
		stack(root, [
			{ type: "start", skill: "start-work", ref: { plan: rel } },
			{ type: "record", family: "main", stage: "work", n: 3, total: 9 },
		]);
		recordLaneEvent(root, SID, { type: "plan", agentId: null, counts: { done: 1, total: 2 } }, T0 - 5_000);
		const signals: WorkflowSignals = { ...none, work: { done: 2, total: 6, next: null, status: "active" } };
		expect(topRow(root, signals).gauge).toBe("[▉▉▉░░░░░░] 3/9");
	});

	it("then the start-work run", () => {
		const { root } = thread();
		stack(root, [{ type: "start", skill: "start-work" }]);
		const signals: WorkflowSignals = { ...none, work: { done: 2, total: 6, next: null, status: "active" } };
		expect(topRow(root, signals).gauge).toBe("[▉▉░░░░] 2/6");
	});

	it("then the checkboxes of the plan the frame carries", () => {
		const { root } = thread();
		const rel = plan(root, "p", 1, 4);
		stack(root, [{ type: "start", skill: "lit-loop", ref: { plan: rel } }]);
		expect(topRow(root, none).gauge).toBe("[▉░░░] 1/4");
	});

	it("then the open goal's criteria, for a loop", () => {
		const { root } = thread();
		stack(root, [{ type: "start", skill: "lit-loop" }]);
		const signals: WorkflowSignals = { ...none, goals: { done: 1, total: 3, next: null } };
		expect(topRow(root, signals).gauge).toBe("[▉░░] 1/3");
	});

	it("then the main thread's own update_plan list, on the top frame only", () => {
		const { root } = thread();
		stack(root, [{ type: "start", skill: "lit-brainstorm" }]);
		recordLaneEvent(root, SID, { type: "plan", agentId: null, counts: { done: 2, total: 4 } }, T0 - 5_000);
		expect(topRow(root, none).gauge).toBe("[▉▉░░] 2/4");
	});

	it("without a total says what it knows in words and draws no gauge", () => {
		const { root } = thread();
		stack(root, [
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "RED", n: 4 },
		]);
		expect(topRow(root, none)).toEqual({ gauge: null, note: "step 4" });
	});

	it("a frame that knows nothing says nothing, rather than a placeholder", () => {
		const { root } = thread();
		stack(root, [{ type: "start", skill: "lit-loop" }]);
		expect(topRow(root, none)).toEqual({ gauge: null, note: "" });
	});
});

describe("plan hand-off", () => {
	it("a saved plan's name rides on the plan frame, so the work after it counts the plan's checkboxes", () => {
		const { root } = thread("lit-plan");
		stack(root, [{ type: "start", skill: "lit-plan" }]);
		recordLitPlanActivation(root, SID, Date.now() - 5_000);
		mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
		writeFileSync(
			join(root, ".litcodex/plans/ship.md"),
			"# P\n\n## Todos\n- [x] 1. a\n- [ ] 2. b\n- [ ] 3. c\n- [ ] 4. d\n",
		);
		expect(evaluatePlanPersistence(root, SID).decision).toBe("pass");
		const planned = readStack(root, SID).frames.at(-1);
		expect(planned).toMatchObject({ skill: "lit-plan", done: true, ref: { plan: ".litcodex/plans/ship.md" } });
		stack(root, [{ type: "start", skill: "start-work" }], SID, Date.now());
		const frames = readStack(root, SID).frames;
		expect(frames).toHaveLength(1);
		expect(frames[0]).toMatchObject({ skill: "start-work", ref: { plan: ".litcodex/plans/ship.md" } });
		lane(root, 1, "Aquinas");
		expect(readThreads(root, SID, T0, null)?.chain[0]?.gauge).toBe("[▉░░░] 1/4");
	});

	it("a lit-loop that follows the plan carries it too", () => {
		const { root } = thread("lit-plan");
		stack(root, [
			{ type: "start", skill: "lit-plan" },
			{
				type: "move",
				family: "main",
				stage: "plan",
				scope: "nearest",
				done: true,
				ref: { plan: ".litcodex/plans/ship.md" },
			},
			{ type: "start", skill: "lit-loop" },
		]);
		expect(readStack(root, SID).frames.at(-1)?.ref).toEqual({ plan: ".litcodex/plans/ship.md" });
	});

	it("refuses a plan name that climbs out of the project", () => {
		const { root } = thread("lit-plan");
		stack(root, [
			{ type: "start", skill: "lit-plan" },
			{
				type: "move",
				family: "main",
				stage: "plan",
				scope: "nearest",
				done: true,
				ref: { plan: ".litcodex/plans/../../etc/passwd.md" },
			},
		]);
		expect(readStack(root, SID).frames.at(-1)?.ref).toBeUndefined();
	});
});

describe("no placeholder, stable repaint", () => {
	function everyCase(): { name: string; render: () => string }[] {
		const cases: { name: string; render: () => string }[] = [];
		const one = thread();
		stack(one.root, [
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "RED", n: 4 },
		]);
		cases.push({ name: "one thread, count without total", render: () => text(one.env) });
		const three = thread();
		stack(three.root, [
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "RED", n: 1 },
		]);
		steps(three.root, lane(three.root, 1, "Aquinas"), 2);
		lane(three.root, 2, "Lagrange");
		lane(three.root, 3, "Hume");
		cases.push({ name: "three lanes, no totals", render: () => text(three.env) });
		cases.push({ name: "three lanes on the HUD", render: () => hud(three.env) });
		const paused = thread("lit-brainstorm");
		stack(paused.root, [...LOOP_GREEN, { type: "start", skill: "lit-brainstorm" }], SID, T0 - 40_000);
		lane(paused.root, 1, "Aquinas");
		lane(paused.root, 2, "Lagrange");
		cases.push({ name: "paused parent", render: () => text(paused.env) });
		const many = thread();
		stack(many.root, [{ type: "start", skill: "lit-loop" }]);
		for (let n = 1; n <= 6; n++) lane(many.root, n, `Agent ${n}`);
		stack(many.root, [{ type: "start", skill: "lit-plan" }], "019a0000-dddd-7000-8000-000000000002", T0 - 60_000);
		cases.push({ name: "overflow with another session", render: () => text(many.env) });
		const bare = thread();
		lane(bare.root, 1, "Aquinas");
		lane(bare.root, 2, "Lagrange");
		cases.push({ name: "lanes with no frame at all", render: () => text(bare.env) });
		return cases;
	}

	it("prints no placeholder in any case", () => {
		for (const { name, render } of everyCase()) {
			const out = render();
			expect(out, name).not.toMatch(PLACEHOLDER);
			expect(out, name).not.toContain("NaN");
			expect(out, name).not.toContain("undefined");
		}
	});

	it("repaints to the same bytes for the same input", () => {
		for (const { name, render } of everyCase()) expect(render(), name).toBe(render());
	});

	it("never draws a bar without both numbers", () => {
		for (const { name, render } of everyCase()) {
			for (const line of render().split("\n")) {
				if (line.includes("[")) expect(line, name).toMatch(/\[[▉░]+\] \d+\/\d+/u);
			}
		}
	});
});

describe("hook routes", () => {
	const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
	const route = (subcommand: string, payload: unknown): { code: number | null; out: string; err: string } => {
		const body = typeof payload === "string" ? payload : JSON.stringify(payload);
		const run = spawnSync(process.execPath, [CLI, "hook", subcommand], { input: body, encoding: "utf8" });
		return { code: run.status, out: run.stdout, err: run.stderr };
	};
	const AGENT = "0a1772b0-0000-7000-8000-0000000000aa";

	it("the SubagentStart and SubagentStop commands draw and remove a lane, and print nothing", () => {
		const { root, env } = thread();
		stack(root, LOOP_GREEN, SID, 30_000);
		const base = { session_id: SID, cwd: root, agent_id: AGENT, agent_type: "default" };
		const live = {
			...base,
			hook_event_name: "PostToolUse",
			tool_name: "spawn_agent",
			tool_response: JSON.stringify({ agent_id: AGENT, nickname: "Plato" }),
		};
		expect(route("post-tool-use-live", live)).toEqual({ code: 0, out: "", err: "" });
		expect(route("subagent-start", { ...base, hook_event_name: "SubagentStart" })).toEqual({
			code: 0,
			out: "",
			err: "",
		});
		const withLane = cardStatusText(readCardStatus(SID, env, Date.now()));
		expect(withLane).toMatch(/● Plato\s+starting running/u);
		expect(route("subagent-stop", { ...base, hook_event_name: "SubagentStop" })).toEqual({
			code: 0,
			out: "",
			err: "",
		});
		expect(cardStatusText(readCardStatus(SID, env, Date.now()))).not.toContain("Plato");
	});

	it("a payload of another shape, or a session LIT never activated, leaves no file and no output", () => {
		const { root } = thread();
		const lanes = join(root, ".litcodex", "lane-state");
		for (const payload of [
			"not json",
			"{}",
			{ session_id: SID, cwd: "relative/dir", agent_id: AGENT },
			{ session_id: SID, cwd: root, agent_id: 5 },
		]) {
			for (const sub of ["subagent-start", "subagent-stop"])
				expect(route(sub, payload)).toEqual({ code: 0, out: "", err: "" });
		}
		const stranger = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-threads-none-")));
		roots.push(stranger);
		route("subagent-start", { session_id: SID, cwd: stranger, agent_id: AGENT, agent_type: "default" });
		expect(existsSync(lanes)).toBe(false);
		expect(existsSync(join(stranger, ".litcodex", "lane-state"))).toBe(false);
	});
});
