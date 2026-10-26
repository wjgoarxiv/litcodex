// A side discipline started in the middle of a loop pauses the loop, and `lit continue` brings it back at
// the stage and count it left. These tests drive the real prompt hook with full events and a real session
// folder; the only state read or written is what the hooks themselves keep under `.litcodex/`.

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";
import { chooseNext, writeNext } from "./rewind.js";
import { breadcrumb, readStack, recordStackEvent, stackRow } from "./workflow-stack.js";

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

function session(id = "sess-interleave"): Session {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-interleave-")));
	roots.push(cwd);
	const home = join(cwd, ".home");
	mkdirSync(home);
	return { cwd, home, id, turn: 0 };
}

async function fire(s: Session, prompt: string): Promise<{ context: string; stdout: string; code: number }> {
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
			session_id: s.id,
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
	return { context, stdout: out, code };
}

const stackOf = (s: Session) => readStack(s.cwd, s.id);

/** lit-loop, then the model records GREEN 2 of 5 criteria. */
async function loopAtGreen(s: Session): Promise<void> {
	await fire(s, "lit fix the bug");
	recordStackEvent(s.cwd, s.id, { type: "record", family: "loop", stage: "GREEN", n: 2, total: 5, unit: "criterion" });
}

describe("lit-loop, an interjected discipline and lit continue", () => {
	it("pauses the loop under the newcomer and shows the breadcrumb", async () => {
		const s = session();
		await loopAtGreen(s);
		const side = await fire(s, "lit brainstorm names for the card");
		expect(side.context.startsWith("<lit-brainstorm-mode>")).toBe(true);
		const stack = stackOf(s);
		expect(stack.frames.map((f) => [f.skill, f.status, f.role])).toEqual([
			["lit-loop", "paused", "spine"],
			["lit-brainstorm", "active", "side"],
		]);
		expect(stack.frames[0]).toMatchObject({ stage: "GREEN", n: 2, total: 5 });
		expect(breadcrumb(stack)).toBe("lit-loop ‖ > lit-brainstorm");
		expect(stackRow(stack)).toContain("lit continue");
	});

	it("lit continue resumes the loop at the same stage and count, without restarting it", async () => {
		const s = session();
		await loopAtGreen(s);
		await fire(s, "lit brainstorm names for the card");
		const back = await fire(s, "lit continue");
		expect(back.code).toBe(0);
		expect(back.context).toContain("already active");
		expect(back.context).toContain("resuming the paused lit-loop at GREEN 2/5");
		expect(back.context).toContain("do not restart it");
		expect(back.context).not.toMatch(/SKILL\.md|Read these files/u);
		const after = stackOf(s);
		expect(after.frames).toHaveLength(1);
		expect(after.frames[0]).toMatchObject({ skill: "lit-loop", status: "active", stage: "GREEN", n: 2, total: 5 });
	});

	it("keeps lit-plan's persistence gate: lit continue stays inside an active lit-plan", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		await fire(s, "lit plan the rollback");
		const carried = await fire(s, "lit continue");
		expect(carried.context).toContain("lit-plan");
		expect(carried.context).not.toContain("resuming the paused lit-loop");
		expect(stackOf(s).frames.at(-1)).toMatchObject({ skill: "lit-plan", status: "active" });
	});

	it("lit adhd is read-only: it neither stacks nor takes the saved route", async () => {
		const s = session();
		await loopAtGreen(s);
		await fire(s, "lit brainstorm names for the card");
		const before = JSON.stringify(stackOf(s).frames);
		const brief = await fire(s, "lit adhd");
		expect(brief.context.startsWith("<lit-adhd-mode>")).toBe(true);
		expect(brief.context).toContain("LIT IGNITED · lit-adhd");
		expect(JSON.stringify(stackOf(s).frames)).toBe(before);
		const back = await fire(s, "lit continue");
		expect(back.context).toContain("resuming the paused lit-loop at GREEN 2/5");
	});

	it("go after a brief becomes lit continue and carries the paused frame back", async () => {
		const s = session();
		await loopAtGreen(s);
		await fire(s, "lit brainstorm names for the card");
		writeNext(s.cwd, s.id, chooseNext(s.cwd, s.id), Date.now());
		const go = await fire(s, "go");
		expect(go.context).toContain("resuming the paused lit-loop at GREEN 2/5");
		expect(go.context).toContain("go: ");
		expect(stackOf(s).frames).toHaveLength(1);
		expect((await fire(s, "go")).stdout).toBe("");
	});

	it("go with no brief is an ordinary prompt and the hook stays silent", async () => {
		const s = session();
		await loopAtGreen(s);
		const go = await fire(s, "go");
		expect(go.stdout).toBe("");
		expect(go.code).toBe(0);
	});

	it("an expired go starts nothing and offers a fresh brief", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		mkdirSync(join(s.cwd, ".litcodex/plans"), { recursive: true });
		writeFileSync(join(s.cwd, ".litcodex/plans/ship.md"), "## Todos\n- [ ] one\n");
		writeNext(s.cwd, s.id, chooseNext(s.cwd, s.id), Date.now() - 31 * 60_000);
		const go = await fire(s, "go");
		expect(go.context).toMatch(/older than 30 minutes/u);
		expect(go.context).toContain("lit adhd");
		expect(go.context).not.toContain("start-work");
	});

	it("leaves lit approve and lit deny to the start-work hook", async () => {
		const s = session();
		await fire(s, "lit fix the bug");
		for (const answer of ["lit approve", "lit deny", "lit 승인", "lit 거절"]) {
			const fired = await fire(s, answer);
			expect(fired.stdout).toBe("");
			expect(fired.code).toBe(0);
		}
		expect(existsSync(join(s.cwd, ".litcodex/adhd"))).toBe(false);
	});
});
