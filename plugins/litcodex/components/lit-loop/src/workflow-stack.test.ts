// The workflow stack: pure transitions first, then the guarded store.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyStackEvent,
	breadcrumb,
	emptyStack,
	frameLabel,
	frameNote,
	gaugeBar,
	MAX_FRAMES,
	MAX_STACK_BYTES,
	pausedSpine,
	readStack,
	recordStackEvent,
	STACK_DROP_MS,
	type StackEvent,
	stackGauge,
	stackPath,
	type WorkflowStack,
	writeStack,
} from "./workflow-stack.js";

const T0 = new Date("2026-10-26T09:00:00.000Z");
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000);

function run(events: readonly (StackEvent | [StackEvent, number])[]): { stack: WorkflowStack; types: string[] } {
	let stack = emptyStack("s1");
	const types: string[] = [];
	let minute = 0;
	for (const item of events) {
		const [event, when] = Array.isArray(item) ? item : [item, ++minute];
		const result = applyStackEvent(stack, event, at(when));
		stack = result.stack;
		types.push(...result.transitions.map(({ type, skill }) => `${type}:${skill}`));
	}
	return { stack, types };
}

describe("applyStackEvent", () => {
	it("pushes a side frame over the spine and pauses the spine", () => {
		const { stack } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "red", n: 2, total: 5 },
			{ type: "start", skill: "lit-brainstorm" },
		]);
		expect(stack.frames.map((f) => [f.skill, f.role, f.status])).toEqual([
			["lit-loop", "spine", "paused"],
			["lit-brainstorm", "side", "active"],
		]);
		expect(breadcrumb(stack)).toBe("lit-loop ‖ > lit-brainstorm");
	});

	it("keeps the spine's stage and k/n while paused and after `continue` resumes it", () => {
		const { stack, types } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "GREEN", n: 3, total: 5, unit: "criterion" },
			{ type: "start", skill: "lit-brainstorm" },
			{ type: "continue" },
		]);
		expect(types).toEqual([
			"started:lit-loop",
			"paused:lit-loop",
			"started:lit-brainstorm",
			"side.done:lit-brainstorm",
			"resumed:lit-loop",
		]);
		expect(stack.frames).toHaveLength(1);
		expect(stack.frames[0]).toMatchObject({
			skill: "lit-loop",
			family: "loop",
			stage: "GREEN",
			n: 3,
			total: 5,
			unit: "criterion",
			status: "active",
		});
		expect(stack.frames[0]?.pausedAt).toBeUndefined();
	});

	it("resumes a frame that is already in the stack when its skill is asked for again", () => {
		const { stack } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "VERIFY", n: 4, total: 6 },
			{ type: "start", skill: "litresearch" },
			{ type: "start", skill: "lit-loop" },
		]);
		expect(stack.frames.map((f) => f.skill)).toEqual(["lit-loop"]);
		expect(stack.frames[0]).toMatchObject({ stage: "VERIFY", n: 4, total: 6, status: "active" });
	});

	it("lets a higher-rank successor finish the frame below instead of pausing it", () => {
		const { stack, types } = run([
			{ type: "start", skill: "deep-interview" },
			{ type: "start", skill: "lit-plan" },
			{ type: "start", skill: "start-work", ref: { plan: "plans/a.md" } },
		]);
		expect(types).toEqual([
			"started:deep-interview",
			"finished:deep-interview",
			"started:lit-plan",
			"finished:lit-plan",
			"started:start-work",
		]);
		expect(stack.frames).toHaveLength(1);
		expect(stack.frames[0]).toMatchObject({ skill: "start-work", role: "spine", ref: { plan: "plans/a.md" } });
	});

	it("never stacks a read-only discipline", () => {
		for (const skill of ["lit-recap", "lit-comprehend", "lit-handoff", "lit-adhd", "lit-rewind"]) {
			const { stack } = run([
				{ type: "start", skill: "lit-loop" },
				{ type: "start", skill },
			]);
			expect(stack.frames.map((f) => [f.skill, f.status])).toEqual([["lit-loop", "active"]]);
		}
	});

	it("`continue` with no side frame changes nothing", () => {
		const { stack, types } = run([{ type: "start", skill: "lit-loop" }, { type: "continue" }]);
		expect(types).toEqual(["started:lit-loop"]);
		expect(stack.frames[0]?.status).toBe("active");
	});

	it("caps the stack at three frames, dropping the oldest side frame first", () => {
		const { stack, types } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "start", skill: "lit-brainstorm" },
			{ type: "start", skill: "litresearch" },
			{ type: "start", skill: "lit-init" },
		]);
		expect(stack.frames.length).toBeLessThanOrEqual(MAX_FRAMES);
		expect(stack.frames[0]?.skill).toBe("lit-loop");
		expect(types).toContain("dropped:lit-brainstorm");
	});

	it("drops a frame nobody touched for a day", () => {
		const first = applyStackEvent(emptyStack("s1"), { type: "start", skill: "lit-loop" }, T0).stack;
		const later = new Date(T0.getTime() + STACK_DROP_MS + 1000);
		const next = applyStackEvent(first, { type: "start", skill: "lit-plan" }, later).stack;
		expect(next.frames.map((f) => f.skill)).toEqual(["lit-plan"]);
	});

	it("rejects an unknown stage and an out-of-range count", () => {
		const { stack } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "NOPE", n: 1 },
			{ type: "record", family: "loop", stage: "red", n: 99999, total: 3 },
		]);
		expect(stack.frames[0]).toMatchObject({ stage: "RED", total: 3 });
		expect(stack.frames[0]?.n).toBeUndefined();
	});

	it("keeps only a project-relative plan name as a reference", () => {
		const { stack } = run([{ type: "start", skill: "start-work", ref: { plan: "../../etc/passwd" } }]);
		expect(stack.frames[0]?.ref).toBeUndefined();
	});
});

describe("gauges", () => {
	it("draws a gauge only when both counts are real, and says what is known in words otherwise", () => {
		expect(stackGauge({ n: 3, total: 5 })).toBe("[▉▉▉░░] 3/5");
		expect(stackGauge({ n: 2 })).toBeNull();
		expect(stackGauge({})).toBeNull();
		expect(stackGauge({ n: 2, total: 0 })).toBeNull();
		expect(frameNote({ n: 2 })).toBe("step 2");
		expect(frameNote({})).toBe("");
		expect(frameNote({ n: 3, total: 5 })).toBe("");
	});

	it("scales a total above ten cells and never overfills", () => {
		expect(gaugeBar(15, 30)).toBe("[▉▉▉▉▉░░░░░]");
		expect(gaugeBar(40, 30)).toBe("[▉▉▉▉▉▉▉▉▉▉]");
		expect(stackGauge({ n: 40, total: 30 })).toContain("40/30");
	});

	it("labels a frame with its stage and gauge", () => {
		const { stack } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "RED", n: 2, total: 5 },
		]);
		expect(frameLabel(stack.frames[0] as never)).toBe("lit-loop RED [▉▉░░░] 2/5");
	});

	it("names a frame with an unknown total in words, never with a placeholder", () => {
		const { stack } = run([
			{ type: "start", skill: "lit-loop" },
			{ type: "record", family: "loop", stage: "RED", n: 2 },
		]);
		expect(frameLabel(stack.frames[0] as never)).toBe("lit-loop RED step 2");
	});
});

describe("store", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});
	const workspace = (): string => {
		const root = mkdtempSync(join(tmpdir(), "stack-"));
		roots.push(root);
		return root;
	};

	it("round-trips a stack and finds the paused spine", () => {
		const cwd = workspace();
		recordStackEvent(cwd, "sess/1", { type: "start", skill: "lit-loop" }, at(1));
		recordStackEvent(cwd, "sess/1", { type: "record", family: "loop", stage: "RED", n: 1, total: 4 }, at(2));
		const result = recordStackEvent(cwd, "sess/1", { type: "start", skill: "lit-brainstorm" }, at(3));
		expect(result.transitions.map((t) => t.type)).toEqual(["paused", "started"]);
		const read = readStack(cwd, "sess/1");
		expect(read.frames).toHaveLength(2);
		expect(pausedSpine(read)).toMatchObject({ skill: "lit-loop", stage: "RED", n: 1, total: 4 });
		expect(stackPath(cwd, "sess/1")).toContain(".litcodex/workflow-stack/");
	});

	it("reads a link, an oversized file and malformed JSON as empty", () => {
		const cwd = workspace();
		const dir = join(cwd, ".litcodex", "workflow-stack");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(cwd, "real.json"),
			JSON.stringify({
				frames: [{ skill: "x", role: "spine", status: "active", at: T0.toISOString(), verdicts: {} }],
			}),
		);
		symlinkSync(join(cwd, "real.json"), join(dir, "linked.json"));
		writeFileSync(join(dir, "big.json"), `{"frames":[],"pad":"${"a".repeat(MAX_STACK_BYTES)}"}`);
		writeFileSync(join(dir, "bad.json"), "{nope");
		for (const id of ["linked", "big", "bad", "missing"]) expect(readStack(cwd, id).frames).toEqual([]);
	});

	it("refuses to write through a linked state directory", () => {
		const cwd = workspace();
		const elsewhere = workspace();
		mkdirSync(join(cwd, ".litcodex"), { recursive: true });
		symlinkSync(elsewhere, join(cwd, ".litcodex", "workflow-stack"));
		recordStackEvent(cwd, "s1", { type: "start", skill: "lit-loop" }, at(1));
		expect(() => readFileSync(join(elsewhere, "s1.json"))).toThrow();
	});

	it("does not throw when the session id cannot name a file", () => {
		const cwd = workspace();
		expect(() => writeStack(cwd, "///", emptyStack("x"))).not.toThrow();
		expect(readStack(cwd, "///").frames).toEqual([]);
	});

	it("keeps verdict names and plan names only, never a prompt or command", () => {
		const cwd = workspace();
		recordStackEvent(cwd, "s1", { type: "start", skill: "start-work", ref: { plan: "plans/p.md" } }, at(1));
		const text = readFileSync(stackPath(cwd, "s1") as string, "utf8");
		expect(Object.keys(JSON.parse(text).frames[0]).sort()).toEqual([
			"at",
			"family",
			"ref",
			"role",
			"skill",
			"stage",
			"status",
			"verdicts",
		]);
	});
});
