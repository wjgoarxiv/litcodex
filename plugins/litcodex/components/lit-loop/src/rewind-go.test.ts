// `go` after a lit-adhd brief: the note is read once, bound to its session, good for thirty minutes, and
// checked again against the saved state before it starts anything. State lives in a scratch workspace only.

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chooseNext, GO_WINDOW_MS, writeNext } from "./rewind.js";
import { isBoundaryAnswer, isGoPrompt, takeGo } from "./rewind-go.js";
import { recordStackEvent } from "./workflow-stack.js";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const MIN = 60_000;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-go-")));
	roots.push(cwd);
	return cwd;
}

/** One open plan, which is a `start-plan` next step. */
function withPlan(cwd: string, body = "## Todos\n- [x] one\n- [ ] two\n"): void {
	mkdirSync(join(cwd, ".litcodex/plans"), { recursive: true });
	writeFileSync(join(cwd, ".litcodex/plans/ship.md"), body);
}

/** A paused lit-loop under a running lit-brainstorm, which is a `resume-frame` next step. */
function withPausedLoop(cwd: string, sid: string): void {
	recordStackEvent(cwd, sid, { type: "start", skill: "lit-loop" }, new Date(NOW - 5000));
	recordStackEvent(cwd, sid, { type: "start", skill: "lit-brainstorm" }, new Date(NOW - 4000));
}

const brief = (cwd: string, sid: string, at: number): void => writeNext(cwd, sid, chooseNext(cwd, sid), at);
const notePath = (cwd: string, sid: string): string => join(cwd, `.litcodex/adhd/next-${sid}.json`);

describe("the go words", () => {
	it.each(["go", "Go", "lit go", "LIT GO!", "ㄱㄱ", "고", "진행", "  go.  ", "go?"])("%j is a go", (prompt) => {
		expect(isGoPrompt(prompt)).toBe(true);
	});

	it.each([
		"go ahead and fix it",
		"go to the settings page",
		"lit goal",
		"litgoal",
		"let it go",
		"고쳐줘",
		"진행해줘",
		"ㄱㄱㄱ",
		"gopher",
		"lit go now",
		"",
	])("%j is an ordinary prompt", (prompt) => {
		expect(isGoPrompt(prompt)).toBe(false);
	});
});

describe("takeGo", () => {
	it("starts the briefed plan as an ordinary start-work prompt", () => {
		const cwd = workspace();
		withPlan(cwd);
		brief(cwd, "sess-1", NOW);
		const go = takeGo(cwd, "sess-1", NOW + MIN);
		expect(go).toMatchObject({ kind: "run", prompt: "start-work ship" });
	});

	it("resumes a paused frame by turning go into lit continue", () => {
		const cwd = workspace();
		withPausedLoop(cwd, "sess-1");
		brief(cwd, "sess-1", NOW);
		expect(takeGo(cwd, "sess-1", NOW + MIN)).toMatchObject({ kind: "run", prompt: "lit continue" });
	});

	it("is good at 29 minutes and expired at 31, and says so once", () => {
		const cwd = workspace();
		withPlan(cwd);
		brief(cwd, "sess-1", NOW);
		expect(takeGo(cwd, "sess-1", NOW + 29 * MIN)?.kind).toBe("run");
		brief(cwd, "sess-1", NOW);
		const late = takeGo(cwd, "sess-1", NOW + 31 * MIN);
		expect(late).toMatchObject({ kind: "hint" });
		expect(late?.kind === "hint" && late.text).toMatch(/older than 30 minutes/u);
		expect(takeGo(cwd, "sess-1", NOW + 31 * MIN)).toBeNull();
		expect(GO_WINDOW_MS).toBe(30 * MIN);
	});

	it("is consumed by the first go", () => {
		const cwd = workspace();
		withPlan(cwd);
		brief(cwd, "sess-1", NOW);
		expect(takeGo(cwd, "sess-1", NOW)?.kind).toBe("run");
		expect(existsSync(notePath(cwd, "sess-1"))).toBe(false);
		expect(takeGo(cwd, "sess-1", NOW)).toBeNull();
	});

	it("belongs to the session that was briefed", () => {
		const cwd = workspace();
		withPlan(cwd);
		brief(cwd, "sess-1", NOW);
		expect(takeGo(cwd, "sess-2", NOW)).toBeNull();
		expect(existsSync(notePath(cwd, "sess-1"))).toBe(true);
		expect(takeGo(cwd, "sess-1", NOW)?.kind).toBe("run");
	});

	it("is nothing at all without a brief", () => {
		expect(takeGo(workspace(), "sess-1", NOW)).toBeNull();
	});

	it("checks the step again and starts nothing when it no longer holds", () => {
		const cwd = workspace();
		withPlan(cwd);
		brief(cwd, "sess-1", NOW);
		writeFileSync(join(cwd, ".litcodex/plans/ship.md"), "## Todos\n- [x] one\n- [x] two\n");
		const stale = takeGo(cwd, "sess-1", NOW + MIN);
		expect(stale).toMatchObject({ kind: "hint" });
		expect(stale?.kind === "hint" && stale.text).toMatch(/no longer holds/u);
	});

	it("never approves a boundary: go over an approve-boundary note only points at lit approve", () => {
		const cwd = workspace();
		mkdirSync(join(cwd, ".litcodex/start-work"), { recursive: true });
		writeFileSync(
			join(cwd, ".litcodex/start-work/state.json"),
			JSON.stringify({
				active_work_id: "w1",
				works: { w1: { work_id: "w1", status: "paused", pending_boundary: { boundary_id: "b1" } } },
			}),
		);
		brief(cwd, "sess-1", NOW);
		const go = takeGo(cwd, "sess-1", NOW + MIN);
		expect(go).toMatchObject({ kind: "hint" });
		expect(go?.kind === "hint" && go.text).toMatch(/lit approve/u);
	});

	it("rejects a note forged for another session or with an unknown kind", () => {
		const cwd = workspace();
		mkdirSync(join(cwd, ".litcodex/adhd"), { recursive: true });
		writeFileSync(
			notePath(cwd, "sess-1"),
			JSON.stringify({ sessionId: "sess-2", kind: "start-plan", at: NOW, plan: "ship.md" }),
		);
		expect(takeGo(cwd, "sess-1", NOW)).toBeNull();
		writeFileSync(notePath(cwd, "sess-1"), JSON.stringify({ sessionId: "sess-1", kind: "rm-rf", at: NOW }));
		expect(takeGo(cwd, "sess-1", NOW)).toBeNull();
		writeFileSync(notePath(cwd, "sess-1"), "{not json");
		expect(takeGo(cwd, "sess-1", NOW)).toBeNull();
	});
});

describe("boundary answers", () => {
	it.each(["lit approve", "lit deny", "lit 승인", "lit 거절", "  lit approve  "])("%j is an answer", (prompt) => {
		expect(isBoundaryAnswer(prompt)).toBe(true);
	});

	it.each([
		"lit approve it",
		"Lit Approve",
		"approve",
		"lit approves",
		"lit approve\nrm -rf",
		`lit approve${" ".repeat(600)}`,
	])("%j is not", (prompt) => {
		expect(isBoundaryAnswer(prompt)).toBe(false);
	});
});
