// A second `lit …` in a session continues the discipline that is already active instead of sending the
// whole activation again. These tests drive the real hook entries with a full event and a real session
// folder; the only state they read or write is what the hooks themselves keep under `.litcodex/`.

import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runPostCompactHookCli, runUserPromptSubmitHookCli } from "./hook-cli.js";
import { evaluatePlanPersistence } from "./plan-persistence.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONTINUE_MAX_BYTES = 600;
/** Anything that sends the model back to a skill file or directive. */
const REREAD = /SKILL\.md|Read these files|directive lit-|skill lit-/u;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Session {
	readonly cwd: string;
	readonly home: string;
	readonly id: string;
	turn: number;
}

function session(id = "sess-reentry"): Session {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-reentry-")));
	roots.push(cwd);
	const home = join(cwd, ".home");
	mkdirSync(home);
	return { cwd, home, id, turn: 0 };
}

interface Fired {
	readonly context: string;
	readonly bytes: number;
	readonly stdout: string;
	readonly code: number;
}

async function fire(s: Session, prompt: string, id = s.id): Promise<Fired> {
	s.turn += 1;
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: id,
			turn_id: `t${s.turn}`,
			cwd: s.cwd,
			prompt,
		}),
	);
	const code = await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), s.cwd, {
		env: { CODEX_HOME: s.home },
	});
	const context =
		out === ""
			? ""
			: ((JSON.parse(out) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput
					?.additionalContext ?? "");
	return { context, bytes: Buffer.byteLength(context), stdout: out, code };
}

async function compact(s: Session): Promise<void> {
	const stdin = new PassThrough();
	stdin.end(JSON.stringify({ hook_event_name: "PostCompact", session_id: s.id, cwd: s.cwd }));
	await runPostCompactHookCli(stdin, new PassThrough(), new PassThrough(), s.cwd, { env: { CODEX_HOME: s.home } });
}

const isFull = (fired: Fired, route: string): boolean =>
	fired.context.startsWith(`<${route}-mode>`) && REREAD.test(fired.context) && fired.bytes > 1_500;

function expectContinue(fired: Fired, route: string): void {
	expect(fired.code).toBe(0);
	expect(fired.bytes).toBeGreaterThan(0);
	expect(fired.bytes).toBeLessThanOrEqual(CONTINUE_MAX_BYTES);
	expect(fired.context).toContain("already active");
	expect(fired.context).toContain(route);
	expect(fired.context).toContain(`🔥 **LIT IGNITED · ${route}** 🔥`);
	expect(fired.context).not.toMatch(REREAD);
}

const PLAN = ["# Plan", "## Todos", "- [x] 1. First step", "- [ ] 2. Second step", ""].join("\n");

function writeActiveWork(root: string, status: "active" | "paused" | "completed" = "active"): void {
	mkdirSync(join(root, ".litcodex/plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex/start-work"), { recursive: true });
	writeFileSync(join(root, ".litcodex/plans/boost.md"), PLAN);
	writeFileSync(
		join(root, ".litcodex/start-work/state.json"),
		JSON.stringify({
			schema_version: 3,
			revision: 4,
			active_work_id: status === "completed" ? null : "w1",
			works: {
				w1: {
					work_id: "w1",
					active_plan: ".litcodex/plans/boost.md",
					plan_name: "boost",
					session_ids: ["codex:other"],
					status,
					worktree_path: null,
					last_transition: { kind: "start_work_initialized", at: "2026-10-12T00:00:00.000Z" },
				},
			},
		}),
	);
}

const planFiles = (root: string): string[] => {
	try {
		return readdirSync(join(root, ".litcodex/plans")).sort();
	} catch {
		return [];
	}
};

describe("a repeated lit prompt continues the active discipline", () => {
	it("sends the full activation once, then at most 600 bytes with no skill re-read", async () => {
		const s = session();
		const prompts = [
			"lit fix the bug",
			"lit add a test",
			"lit also cover the edge case",
			"lit one more thing",
			"lit last",
		];
		const fired: Fired[] = [];
		for (const prompt of prompts) fired.push(await fire(s, prompt));
		const first = fired[0] as Fired;
		expect(isFull(first, "lit-loop")).toBe(true);
		for (const next of fired.slice(1)) expectContinue(next, "lit-loop");
	});

	it("keeps the banner in the visible message on a continue", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		const second = await fire(s, "lit add a test");
		const message = (JSON.parse(second.stdout) as { systemMessage: string }).systemMessage;
		expect(message).toContain("LIT IGNITED · lit-loop");
	});

	it("keeps asking the model to open the LIT card, in a short form", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		const second = await fire(s, "lit add a test");
		expect(second.context).toContain("`lit_card`");
	});

	it("does not echo the user's prompt into the note", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		const second = await fire(s, "lit add a test");
		expect(second.context).not.toContain("add a test");
	});

	it("works the same for another discipline: lit-plan continues as lit-plan", async () => {
		const s = session();
		const first = await fire(s, "lit plan the migration");
		expect(isFull(first, "lit-plan")).toBe(true);
		const second = await fire(s, "lit plan the rollback too");
		expectContinue(second, "lit-plan");
		expect(second.context).toMatch(/planning only/i);
	});

	it("leaves the lit-plan persistence gate exactly as it was", async () => {
		const s = session();
		await fire(s, "lit plan the migration");
		const gate = join(s.cwd, ".litcodex/lit-plan", `${s.id}.json`);
		const armed = JSON.parse(readFileSync(gate, "utf8")) as Record<string, unknown>;
		expect(armed["satisfied"]).toBe(false);
		await fire(s, "lit plan the rollback too");
		expect(JSON.parse(readFileSync(gate, "utf8"))).toEqual(armed);
	});

	it("re-arms the gate when a new plan starts after one was saved", async () => {
		const s = session();
		await fire(s, "lit plan the migration");
		const gate = join(s.cwd, ".litcodex/lit-plan", `${s.id}.json`);
		const armed = JSON.parse(readFileSync(gate, "utf8")) as Record<string, unknown>;
		writeFileSync(gate, `${JSON.stringify({ ...armed, satisfied: true, blocks: 1 })}\n`);
		const bare = await fire(s, "lit");
		expect(bare.context).toContain("continuing lit-plan");
		expect((JSON.parse(readFileSync(gate, "utf8")) as Record<string, unknown>)["satisfied"]).toBe(true);
		const next = await fire(s, "lit plan a third part");
		expectContinue(next, "lit-plan");
		const rearmed = JSON.parse(readFileSync(gate, "utf8")) as Record<string, unknown>;
		expect(rearmed["satisfied"]).toBe(false);
		expect(rearmed["blocks"]).toBe(0);
		expect(evaluatePlanPersistence(s.cwd, s.id).decision).toBe("block");
	});

	it("creates no plan file and no goals on a continue", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		const before = planFiles(s.cwd);
		await fire(s, "lit add a test");
		expect(planFiles(s.cwd)).toEqual(before);
		expect(readdirSync(join(s.cwd, ".litcodex"))).not.toContain("lit-loop");
	});
});

describe("a different discipline switches with its full activation", () => {
	it("gives lit plan its full activation after lit-loop, and arms the plan gate", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		const plan = await fire(s, "lit plan X");
		expect(isFull(plan, "lit-plan")).toBe(true);
		const gate = JSON.parse(readFileSync(join(s.cwd, ".litcodex/lit-plan", `${s.id}.json`), "utf8")) as {
			satisfied: boolean;
		};
		expect(gate.satisfied).toBe(false);
	});

	it("switches back to lit-loop in full once, then continues", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		await fire(s, "lit plan X");
		const back = await fire(s, "lit now fix the bug");
		expect(isFull(back, "lit-loop")).toBe(true);
		expectContinue(await fire(s, "lit and the next one"), "lit-loop");
	});

	it("never continues start-work: its prompt carries the write grant", async () => {
		const s = session();
		const first = await fire(s, "start-work approved-plan");
		const second = await fire(s, "start-work approved-plan");
		expect(first.context).toContain("directive start-work:");
		expect(second.context).toContain("directive start-work:");
		expect(second.context).not.toContain("already active");
	});
});

describe("a bare lit carries on whichever discipline is active", () => {
	it.each(["lit", "lit continue"])("%s after lit plan continues lit-plan and never switches", async (bare) => {
		const s = session();
		await fire(s, "lit fix the bug");
		await fire(s, "lit plan X");
		const gate = join(s.cwd, ".litcodex/lit-plan", `${s.id}.json`);
		const armed = readFileSync(gate, "utf8");
		const carried = await fire(s, bare);
		expectContinue(carried, "lit-plan");
		expect(carried.context).not.toContain("<lit-loop");
		expect(carried.context).not.toMatch(/ask the user one question/iu);
		expect(readFileSync(gate, "utf8")).toBe(armed);
		expectContinue(await fire(s, "lit plan the rollback too"), "lit-plan");
		expect(isFull(await fire(s, "lit now fix the bug"), "lit-loop")).toBe(true);
	});

	it("a bare lit over a published plan while lit-plan is active resumes inside lit-plan", async () => {
		const s = session();
		await fire(s, "lit plan the migration");
		const gate = join(s.cwd, ".litcodex/lit-plan", `${s.id}.json`);
		const armed = JSON.parse(readFileSync(gate, "utf8")) as Record<string, unknown>;
		writeFileSync(gate, `${JSON.stringify({ ...armed, satisfied: true })}\n`);
		const resumed = await fire(s, "lit");
		expect(resumed.bytes).toBeLessThanOrEqual(CONTINUE_MAX_BYTES);
		expect(resumed.context).toContain("continuing lit-plan");
		expect(resumed.context).toMatch(/resum/iu);
		expect(resumed.context).not.toMatch(REREAD);
	});

	it("a bare lit after a one-shot route carries that route on, not the loop", async () => {
		const s = session();
		await fire(s, "litresearch heat pumps");
		expectContinue(await fire(s, "lit"), "litresearch");
	});
});

describe("approved work resumes instead of starting over", () => {
	it("bare lit with an active start-work plan says it resumes and creates no plan", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		writeActiveWork(s.cwd);
		const before = planFiles(s.cwd);
		const resumed = await fire(s, "lit");
		expect(resumed.bytes).toBeLessThanOrEqual(CONTINUE_MAX_BYTES);
		expect(resumed.context).toMatch(/resum/iu);
		expect(resumed.context).toMatch(/do not (?:create|start) a new plan/iu);
		expect(resumed.context).not.toMatch(REREAD);
		expect(resumed.context).not.toMatch(/did they mean|ask the user one question/iu);
		expect(planFiles(s.cwd)).toEqual(before);
		const again = await fire(s, "lit continue");
		expect(again.context).toMatch(/resum/iu);
		expect(again.bytes).toBeLessThanOrEqual(CONTINUE_MAX_BYTES);
	});

	it("a fresh session with active work resumes and still carries the activation", async () => {
		const s = session();
		writeActiveWork(s.cwd, "paused");
		const resumed = await fire(s, "lit");
		expect(resumed.context).toMatch(/resum/iu);
		expect(resumed.context).toMatch(/do not (?:create|start) a new plan/iu);
		expect(isFull(resumed, "lit-loop")).toBe(true);
		expect(planFiles(s.cwd)).toEqual(["boost.md"]);
	});

	it("a published lit-plan plan counts as approved work", async () => {
		const s = session();
		await fire(s, "lit plan the migration");
		const gate = join(s.cwd, ".litcodex/lit-plan", `${s.id}.json`);
		const armed = JSON.parse(readFileSync(gate, "utf8")) as Record<string, unknown>;
		writeFileSync(gate, `${JSON.stringify({ ...armed, satisfied: true })}\n`);
		const resumed = await fire(s, "lit");
		expect(resumed.context).toMatch(/resum/iu);
		expect(resumed.context).toMatch(/do not (?:create|start) a new plan/iu);
	});

	it("a finished plan does not make a bare lit resume", async () => {
		const s = session();
		writeActiveWork(s.cwd, "completed");
		const bare = await fire(s, "lit");
		expect(bare.context).not.toMatch(/resuming/iu);
		expect(bare.context).toMatch(/ask the user one question/iu);
	});

	it("lit with a task never resumes", async () => {
		const s = session();
		writeActiveWork(s.cwd);
		const task = await fire(s, "lit fix the typo in README.md");
		expect(task.context).not.toMatch(/resuming/iu);
	});
});

describe("restart words start fresh", () => {
	it("lit new … gives the full activation even while lit-loop is active", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		await fire(s, "lit add a test");
		const fresh = await fire(s, "lit new Y");
		expect(isFull(fresh, "lit-loop")).toBe(true);
		expectContinue(await fire(s, "lit and then Z"), "lit-loop");
	});

	it("lit restart … does the same, and a word that only starts with new does not", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		expect(isFull(await fire(s, "lit restart the server"), "lit-loop")).toBe(true);
		expectContinue(await fire(s, "lit newsletter signup form"), "lit-loop");
	});
});

describe("only a bare idle lit asks for confirmation", () => {
	it("asks one question for a bare lit with no task and no active work", async () => {
		const s = session();
		const bare = await fire(s, "lit");
		expect(bare.context).toMatch(/ask the user one question/iu);
		const task = await fire(session("sess-other"), "lit fix X");
		expect(task.context).not.toMatch(/ask the user one question/iu);
	});

	it("never asks once a discipline is active: a bare lit just continues it", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		for (const bare of ["lit", "lit continue"]) {
			const carried = await fire(s, bare);
			expectContinue(carried, "lit-loop");
			expect(carried.context, bare).not.toMatch(/ask the user one question/iu);
			expect(carried.bytes).toBeLessThanOrEqual(CONTINUE_MAX_BYTES);
		}
	});

	it("does not ask for lit with a task, a sibling route or a restart", async () => {
		const s = session();
		for (const prompt of ["lit fix X", "lit plan X", "lit new Y", "litwork ship it"]) {
			const fired = await fire(s, prompt);
			expect(fired.context, prompt).not.toMatch(/ask the user one question/iu);
		}
	});
});

describe("state belongs to one session and fails safe", () => {
	it("a different session id starts fresh", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		expectContinue(await fire(s, "lit add a test"), "lit-loop");
		const other = await fire(s, "lit fix the bug", "sess-two");
		expect(isFull(other, "lit-loop")).toBe(true);
		expectContinue(await fire(s, "lit one more"), "lit-loop");
	});

	it("a compaction drops the loaded contract, so the next lit is full again", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		expectContinue(await fire(s, "lit add a test"), "lit-loop");
		await compact(s);
		expect(isFull(await fire(s, "lit keep going"), "lit-loop")).toBe(true);
		expectContinue(await fire(s, "lit and again"), "lit-loop");
	});

	it.each([
		["not JSON", "[[["],
		["wrong version", JSON.stringify({ version: 9, mode: "lit-loop" })],
		["wrong shape", JSON.stringify({ version: 1, mode: 7 })],
		["an array", "[]"],
		["empty", ""],
	])("falls back to the full activation when the saved state is %s", async (_label, body) => {
		const s = session();
		await fire(s, "lit fix the bug");
		const dir = join(s.cwd, ".litcodex/lit-reentry");
		const [file] = readdirSync(dir);
		expect(file).toBeDefined();
		writeFileSync(join(dir, file ?? ""), body);
		const next = await fire(s, "lit add a test");
		expect(next.code).toBe(0);
		expect(isFull(next, "lit-loop")).toBe(true);
	});

	it("never reads a saved state that sits behind a linked folder", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		const dir = join(s.cwd, ".litcodex/lit-reentry");
		const outside = join(s.cwd, "outside");
		mkdirSync(outside);
		for (const file of readdirSync(dir)) writeFileSync(join(outside, file), readFileSync(join(dir, file)));
		rmSync(dir, { recursive: true });
		symlinkSync(outside, dir);
		expect(isFull(await fire(s, "lit add a test"), "lit-loop")).toBe(true);
	});
});

describe("the first activation keeps its content and drops its duplication", () => {
	it("names the skills folder once instead of six absolute skill paths", async () => {
		const s = session();
		const first = await fire(s, "lit fix the bug");
		for (const skill of [
			"lit-code",
			"lit-typographic-motion",
			"frontend-ui-ux",
			"lit-diagram-drawer",
			"lit-docx",
			"lit-pptx",
		]) {
			expect(first.context, skill).toContain(`| ${skill} |`);
			expect(first.context, skill).not.toContain(`/skills/${skill}/SKILL.md`);
		}
		expect(first.context).toContain("덱 N장");
		expect(first.context).toContain("화면 만들어줘");
		expect(first.context).toContain("scripts/design-lock.mjs");
		expect(first.context.split(PLUGIN_ROOT).length - 1).toBeLessThanOrEqual(3);
		expect(first.context).toContain(`${PLUGIN_ROOT}skills`);
		expect(first.context).toContain("### Bounded task");
		expect(first.context).toContain("### Durable task");
		expect(first.context).toContain("BLOCKED:");
	});

	it("is smaller than before for the same prompt", async () => {
		const s = session();
		const first = await fire(s, "lit fix the bug");
		// The context names the checkout's absolute paths, so measure it with each path swapped for a fixed-length
		// stand-in; otherwise the budget passes or fails by where the repository happens to be checked out.
		const sized = first.context
			.split(PLUGIN_ROOT)
			.join(`/${"p".repeat(98)}/`)
			.split(s.cwd)
			.join(`/${"c".repeat(40)}`);
		expect(Buffer.byteLength(sized)).toBeLessThan(4_600);
	});
});

describe("lit brainstorm follows the same re-entry rules", () => {
	it("sends the full activation once, then a short note that keeps it ideation only", async () => {
		const s = session();
		const first = await fire(s, "lit brainstorm a name for my app");
		expect(isFull(first, "lit-brainstorm")).toBe(true);
		const second = await fire(s, "lit brainstorm more names, shorter ones");
		expectContinue(second, "lit-brainstorm");
		expect(second.context).toMatch(/implement nothing/iu);
	});

	it.each([
		"lit",
		"lit continue",
	])("%s after lit brainstorm carries on lit-brainstorm and never switches", async (bare) => {
		const s = session();
		await fire(s, "lit brainstorm a name for my app");
		const carried = await fire(s, bare);
		expectContinue(carried, "lit-brainstorm");
		expect(carried.context).not.toContain("<lit-loop");
		expect(carried.context).not.toMatch(/ask the user one question/iu);
	});

	it("switches to lit-plan in full, and back to lit-brainstorm in full, only on an explicit route", async () => {
		const s = session();
		await fire(s, "lit brainstorm a name for my app");
		expect(isFull(await fire(s, "lit plan the rename"), "lit-plan")).toBe(true);
		expect(isFull(await fire(s, "lit ideas for the logo"), "lit-brainstorm")).toBe(true);
	});

	it("starts again in full after a compaction", async () => {
		const s = session();
		await fire(s, "lit brainstorm a name for my app");
		await compact(s);
		expect(isFull(await fire(s, "lit brainstorm a name for my app"), "lit-brainstorm")).toBe(true);
	});
});

describe("lit schematic follows the same re-entry rules", () => {
	it("sends the full activation once, then a short note that keeps it a drawing in the user's directory", async () => {
		const s = session();
		const first = await fire(s, "lit schematic of the reactor loop");
		expect(isFull(first, "lit-schematic")).toBe(true);
		const second = await fire(s, "lit draw the PFD for the absorber section");
		expectContinue(second, "lit-schematic");
		expect(second.context).toMatch(/never inside the installed LitCodex files/iu);
	});

	it.each([
		"lit",
		"lit continue",
	])("%s after lit schematic carries on lit-schematic and never switches", async (bare) => {
		const s = session();
		await fire(s, "lit schematic of the reactor loop");
		const carried = await fire(s, bare);
		expectContinue(carried, "lit-schematic");
		expect(carried.context).not.toContain("<lit-loop");
		expect(carried.context).not.toMatch(/ask the user one question/iu);
	});

	it("switches to lit-plan in full, and back to lit-schematic in full, only on an explicit route", async () => {
		const s = session();
		await fire(s, "lit schematic of the reactor loop");
		expect(isFull(await fire(s, "lit plan the rig upgrade"), "lit-plan")).toBe(true);
		expect(isFull(await fire(s, "lit draw the P&ID of the rig"), "lit-schematic")).toBe(true);
	});

	it("starts again in full after a compaction", async () => {
		const s = session();
		await fire(s, "lit schematic of the reactor loop");
		await compact(s);
		expect(isFull(await fire(s, "lit schematic of the reactor loop"), "lit-schematic")).toBe(true);
	});
});

describe("lit hijack follows the same re-entry rules", () => {
	it("sends the full activation once, then a short note that keeps it a mechanism-only port", async () => {
		const s = session();
		const first = await fire(s, "lit hijack https://x.com/someone/status/1 into my skill");
		expect(isFull(first, "lit-hijack")).toBe(true);
		const second = await fire(s, "lit 하이재킹 이 글도 같은 스킬에");
		expectContinue(second, "lit-hijack");
		expect(second.context).toMatch(/Port mechanisms only/iu);
	});

	it.each(["lit", "lit continue"])("%s after lit hijack carries on lit-hijack and never switches", async (bare) => {
		const s = session();
		await fire(s, "lit hijack https://x.com/someone/status/1 into my skill");
		const carried = await fire(s, bare);
		expectContinue(carried, "lit-hijack");
		expect(carried.context).not.toContain("<lit-loop");
		expect(carried.context).not.toMatch(/ask the user one question/iu);
	});

	it("switches to lit-plan in full, and back to lit-hijack in full, only on an explicit route", async () => {
		const s = session();
		await fire(s, "lit hijack https://x.com/someone/status/1 into my skill");
		expect(isFull(await fire(s, "lit plan the build from the spec"), "lit-plan")).toBe(true);
		expect(isFull(await fire(s, "lit hijack another post into the same skill"), "lit-hijack")).toBe(true);
	});

	it("starts again in full after a compaction", async () => {
		const s = session();
		await fire(s, "lit hijack https://x.com/someone/status/1 into my skill");
		await compact(s);
		expect(isFull(await fire(s, "lit hijack https://x.com/someone/status/1 into my skill"), "lit-hijack")).toBe(true);
	});
});
