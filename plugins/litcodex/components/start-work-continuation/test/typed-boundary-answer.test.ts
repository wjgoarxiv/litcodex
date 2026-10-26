// `lit approve` and `lit deny` as typed answers to the boundary a paused start-work run waits at. The exact
// `start-work … --resume … --grant …` line stays the other way in; these tests pin the typed one.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBoundaryAnswer, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { readLifecycleState } from "../src/lifecycle-store.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(status: "active" | "paused", withBoundary = true): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-answer-"));
	roots.push(root);
	const real = realpathSync(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(join(root, ".litcodex", "plans", "plan.md"), "## Todos\n- [ ] First\n", "utf8");
	const boundary = { boundary_id: "boundary-1", authority_id: "authority-1", action: "edit", root: real };
	const transition = {
		kind: "start_work_paused",
		at: "2026-07-22T00:00:00.000Z",
		workId: "w1",
		transitionId: "fixture-pause",
		revision: 1,
		fromWorkStatus: "active",
		toWorkStatus: "paused",
		plan: ".litcodex/plans/plan.md",
		sessionId: "codex:s1",
		reasonCode: "authorization_required",
		boundary,
	};
	const paused = status === "paused" && withBoundary;
	const work = {
		work_id: "w1",
		active_plan: ".litcodex/plans/plan.md",
		plan_name: "plan",
		session_ids: ["codex:s1"],
		status,
		worktree_path: real,
		authority: {
			authority_id: "authority-1",
			allowed_roots: [real],
			allowed_actions: ["edit"],
			forbidden_actions: ["publish"],
		},
		...(paused ? { pending_boundary: boundary, last_transition: transition } : {}),
	};
	const revision = paused ? 1 : 0;
	writeFileSync(
		join(root, ".litcodex", "start-work", "state.json"),
		`${JSON.stringify({ schema_version: 3, revision, history_floor_revision: revision, active_work_id: "w1", works: { w1: work }, ...(paused ? { transition_history: { "fixture-pause": transition } } : {}) }, null, 2)}\n`,
		"utf8",
	);
	return root;
}

const prompt = (root: string, text: string, session = "s1", turn = "t1") => ({
	hook_event_name: "UserPromptSubmit",
	session_id: session,
	turn_id: turn,
	transcript_path: null,
	cwd: root,
	prompt: text,
});

const contextOf = (out: string): string =>
	(JSON.parse(out) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput
		.additionalContext;

describe("parseBoundaryAnswer", () => {
	it.each([
		["lit approve", "approve"],
		["lit 승인", "approve"],
		["  lit approve  ", "approve"],
		["lit deny", "deny"],
		["lit 거절", "deny"],
	] as const)("%j is %s", (text, answer) => {
		expect(parseBoundaryAnswer(text)).toBe(answer);
	});

	it.each([
		"lit approve it",
		"Lit Approve",
		"approve",
		"lit approves",
		"please lit approve",
		"`lit approve`",
		"lit approve\nand publish",
		`lit approve${" ".repeat(600)}`,
		"lit denying",
	])("%j answers nothing", (text) => {
		expect(parseBoundaryAnswer(text)).toBeNull();
	});
});

describe("lit approve", () => {
	it("resumes the paused run with a grant for exactly the pending boundary and says so", () => {
		const root = workspace("paused");
		const out = runUserPromptSubmitHook(prompt(root, "lit approve"));
		const text = contextOf(out);
		expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
		expect(text).toContain("boundary-1");
		expect(text).toContain("action edit");
		expect(text).toMatch(/active again/u);
		const work = readLifecycleState(root)?.works["w1"];
		expect(work?.status).toBe("active");
		expect(work?.pending_boundary).toBeUndefined();
		expect(work?.authority_grants?.[0]).toMatchObject({
			authority_id: "authority-1",
			boundary_id: "boundary-1",
			action: "edit",
		});
		expect(work?.authority_grants?.[0]?.grant_id.startsWith("typed-approve:")).toBe(true);
	});

	it("takes the Korean word and replays the same turn without a second grant", () => {
		const root = workspace("paused");
		const first = runUserPromptSubmitHook(prompt(root, "lit 승인"));
		expect(contextOf(first)).toMatch(/active again/u);
		runUserPromptSubmitHook(prompt(root, "lit 승인"));
		expect(readLifecycleState(root)?.works["w1"]?.authority_grants).toHaveLength(1);
	});

	it("changes nothing when no run waits, or the run is another session's", () => {
		const running = workspace("active");
		expect(contextOf(runUserPromptSubmitHook(prompt(running, "lit approve")))).toMatch(/nothing changed/u);
		expect(readLifecycleState(running)?.works["w1"]?.status).toBe("active");
		const waiting = workspace("paused");
		expect(contextOf(runUserPromptSubmitHook(prompt(waiting, "lit approve", "other-session")))).toMatch(
			/nothing changed/u,
		);
		expect(readLifecycleState(waiting)?.works["w1"]?.status).toBe("paused");
	});

	it("keeps the forbidden-action denial: a typed approve cannot grant a forbidden boundary", () => {
		const root = workspace("paused");
		const path = join(root, ".litcodex", "start-work", "state.json");
		const text = readFileSync(path, "utf8").replaceAll('"action": "edit"', '"action": "publish"');
		writeFileSync(path, text, "utf8");
		const answer = contextOf(runUserPromptSubmitHook(prompt(root, "lit approve")));
		expect(answer).not.toMatch(/active again/u);
		expect(readLifecycleState(root)?.works["w1"]?.status).not.toBe("active");
	});
});

describe("lit deny", () => {
	it("leaves the run paused and tells the model not to take the action", () => {
		const root = workspace("paused");
		const text = contextOf(runUserPromptSubmitHook(prompt(root, "lit deny")));
		expect(text).toContain("Do not take that action");
		expect(text).toContain("boundary-1");
		const work = readLifecycleState(root)?.works["w1"];
		expect(work?.status).toBe("paused");
		expect(work?.pending_boundary).toMatchObject({ boundary_id: "boundary-1" });
	});

	it("a later approve still works after a deny", () => {
		const root = workspace("paused");
		runUserPromptSubmitHook(prompt(root, "lit deny", "s1", "t1"));
		expect(contextOf(runUserPromptSubmitHook(prompt(root, "lit approve", "s1", "t2")))).toMatch(/active again/u);
	});
});

describe("other prompts", () => {
	it.each(["lit", "go", "lit approve it", "start-work plan"])("%j stays stdout-silent", (text) => {
		const root = workspace("paused");
		expect(runUserPromptSubmitHook(prompt(root, text))).toBe("");
	});
});
