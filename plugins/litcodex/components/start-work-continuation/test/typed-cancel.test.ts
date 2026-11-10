// `lit cancel` / `lit 취소` typed as the whole prompt ends the project's start-work run from any Codex session of
// the project, subfolders and linked worktrees included; the owner hears about it on its next prompt.

import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseTypedRunCommand, runUserPromptSubmitHook } from "../src/codex-hook.js";
import { findLifecycleRoot } from "../src/lifecycle-root.js";
import { ledgerPathFor, readLifecycleState, statePathFor } from "../src/lifecycle-store.js";
import { runPreToolUseHook } from "../src/pre-tool-hook.js";
import {
	cleanupProjects,
	contextOf,
	legacyPaused,
	type Project,
	project,
	promptInput,
	sha,
	startRun,
	stateBytes,
} from "./autopilot-fixture.js";

afterEach(cleanupProjects);

const cancel = (p: Project, cwd = p.root, session = "s1", turn = "t1") =>
	runUserPromptSubmitHook(promptInput(cwd, "lit cancel", session, turn), p.options);

const bash = (cwd: string, session: string, command: string) => ({
	hook_event_name: "PreToolUse",
	session_id: session,
	turn_id: "t9",
	cwd,
	tool_name: "Bash",
	tool_input: { command },
	tool_use_id: "u1",
	transcript_path: null,
	model: "m",
	permission_mode: "default",
});

describe("parseTypedRunCommand", () => {
	it("1. reads only the whole, bare, case-sensitive prompt", () => {
		expect(parseTypedRunCommand("lit cancel")).toBe("cancel");
		expect(parseTypedRunCommand("lit 취소")).toBe("cancel");
		expect(parseTypedRunCommand("  lit cancel  ")).toBe("cancel");
		expect(parseTypedRunCommand("lit approve")).toBe("approve");
		expect(parseTypedRunCommand("lit 거절")).toBe("deny");
		for (const text of [
			'"lit cancel"',
			"`lit cancel`",
			"```\nlit cancel\n```",
			"please lit cancel now",
			"lit  cancel x",
			"Lit cancel",
			`lit cancel${" ".repeat(520)}`,
		])
			expect(parseTypedRunCommand(text)).toBeNull();
	});
});

describe("lit cancel ends the run", () => {
	it("2. the owner session cancels: abandoned, one cancel event, a ledger line, a reply naming the work", () => {
		const p = project();
		startRun(p);
		const out = contextOf(cancel(p));
		const state = readLifecycleState(p.root);
		expect(state?.active_work_id).toBeNull();
		expect(state?.works["w1"]?.status).toBe("abandoned");
		const events = Object.values(state?.transition_history ?? {}).filter((e) => e.kind === "start_work_cancelled");
		expect(events).toHaveLength(1);
		expect(events[0]?.sessionId).toBe("codex:s1");
		expect(readFileSync(ledgerPathFor(p.root), "utf8")).toContain('"kind":"start_work_cancelled"');
		expect(out).toContain("w1");
		expect(out).toContain("abandoned");
		expect(out).not.toContain("another Codex session");
		expect(state?.["cancel_notices"]).toBeUndefined();
	});

	it("3. a second session cancels another session's run and the owner gets a notice", () => {
		const p = project();
		startRun(p);
		const out = contextOf(cancel(p, p.root, "s2"));
		expect(out).toContain("another Codex session");
		const notices = readLifecycleState(p.root)?.["cancel_notices"] as Record<string, unknown>;
		expect(Object.keys(notices)).toEqual(["codex:s1"]);
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("abandoned");
	});

	it("2b. cancels even when the plan file was deleted or emptied", () => {
		for (const damage of ["delete", "empty"] as const) {
			const p = project();
			startRun(p);
			const plan = join(p.root, ".litcodex", "plans", "plan.md");
			if (damage === "delete") rmSync(plan);
			else writeFileSync(plan, "nothing to tick\n", "utf8");
			cancel(p);
			const state = readLifecycleState(p.root);
			expect(state?.works["w1"]?.status).toBe("abandoned");
			const event = Object.values(state?.transition_history ?? {}).find((e) => e.kind === "start_work_cancelled");
			expect(event?.plan).toBe(".litcodex/plans/plan.md");
			expect(event?.progressToken).toBeUndefined();
		}
	});

	it("4. a legacy paused run is cancelled", () => {
		const p = project();
		legacyPaused(p);
		cancel(p);
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("abandoned");
	});

	it("4b. a schema-2 run with no authority is cancelled", () => {
		const p = project();
		mkdirSync(join(p.root, ".litcodex", "start-work"), { recursive: true });
		writeFileSync(
			statePathFor(p.root),
			JSON.stringify({
				schema_version: 2,
				active_work_id: "w1",
				works: {
					w1: {
						work_id: "w1",
						active_plan: ".litcodex/plans/plan.md",
						plan_name: "plan",
						session_ids: ["codex:s1"],
						status: "active",
						worktree_path: null,
					},
				},
			}),
			"utf8",
		);
		const out = contextOf(cancel(p));
		expect(out).toContain("abandoned");
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("abandoned");
	});

	it("5. a subfolder cwd and a linked-worktree cwd both reach the main project's run", () => {
		const p = project();
		startRun(p);
		const deep = join(p.root, "src", "deep");
		mkdirSync(deep, { recursive: true });
		expect(findLifecycleRoot(deep, { wantSession: "s1" })).toBe(p.real);
		const wt = join(p.real, "..", "wt");
		mkdirSync(join(p.real, ".git", "worktrees", "x"), { recursive: true });
		writeFileSync(join(p.real, ".git", "worktrees", "x", "commondir"), "../..\n", "utf8");
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, ".git"), `gitdir: ${join(p.real, ".git", "worktrees", "x")}\n`, "utf8");
		expect(findLifecycleRoot(wt, { wantSession: "s2" })).toBe(p.real);
		contextOf(cancel(p, wt, "s2"));
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("abandoned");
	});

	it("5b. a nested project's own run wins; with it ended, the outer run is cancelled and named", () => {
		const outer = project();
		startRun(outer);
		const inner = join(outer.root, "b");
		mkdirSync(join(inner, ".litcodex", "plans"), { recursive: true });
		writeFileSync(
			join(inner, ".litcodex", "plans", "plan.md"),
			readFileSync(join(outer.root, ".litcodex/plans/plan.md")),
		);
		const innerProject: Project = { ...outer, root: inner, real: realpathSync(inner) };
		startRun(innerProject, "si");
		mkdirSync(join(inner, "src"), { recursive: true });
		cancel(outer, join(inner, "src"), "s3");
		expect(readLifecycleState(inner)?.works["w1"]?.status).toBe("abandoned");
		expect(readLifecycleState(outer.root)?.works["w1"]?.status).toBe("active");
		const out = contextOf(cancel(outer, join(inner, "src"), "s3", "t2"));
		expect(out).toContain("w1");
		expect(readLifecycleState(outer.root)?.works["w1"]?.status).toBe("abandoned");
	});

	it("6. with no run in progress nothing changes, byte for byte", () => {
		const p = project();
		startRun(p);
		cancel(p);
		const before = sha(stateBytes(p));
		const out = contextOf(cancel(p, p.root, "s1", "t2"));
		expect(out).toContain("no start-work in progress");
		expect(sha(stateBytes(p))).toBe(before);
	});

	it("7. a held lock answers busy and changes nothing", () => {
		const p = project();
		startRun(p);
		const before = stateBytes(p);
		writeFileSync(
			join(p.root, ".litcodex/start-work/state.json.lock"),
			JSON.stringify({ token: "x", createdAt: Date.now(), pid: process.pid }),
		);
		expect(contextOf(cancel(p))).toContain("held the start-work state lock");
		expect(stateBytes(p)).toBe(before);
	});

	it("8. the same turn twice records one cancel event", () => {
		const p = project();
		startRun(p);
		cancel(p);
		cancel(p);
		const events = Object.values(readLifecycleState(p.root)?.transition_history ?? {}).filter(
			(e) => e.kind === "start_work_cancelled",
		);
		expect(events).toHaveLength(1);
	});

	it("9. a non-prompt payload carrying `lit cancel` cancels nothing", () => {
		const p = project();
		startRun(p);
		for (const event of ["Stop", "PreToolUse", "SubagentStart"])
			runUserPromptSubmitHook({ ...promptInput(p.root, "lit cancel"), hook_event_name: event }, p.options);
		expect(readLifecycleState(p.root)?.works["w1"]?.status).toBe("active");
	});

	it("10. the owner's next prompt lifts the notice; the canceller holds none and is not denied", () => {
		const p = project();
		startRun(p);
		cancel(p, p.root, "s2");
		const revision = readLifecycleState(p.root)?.revision;
		expect(runPreToolUseHook(bash(p.root, "s1", "ls"), p.options)).toContain('"permissionDecision":"deny"');
		const lifted = contextOf(runUserPromptSubmitHook(promptInput(p.root, "what next?", "s1", "t5"), p.options));
		expect(lifted.startsWith("Before this prompt, the user ended start-work w1")).toBe(true);
		expect(readLifecycleState(p.root)?.["cancel_notices"]).toEqual({});
		expect(readLifecycleState(p.root)?.revision).toBe(revision);
		expect(runPreToolUseHook(bash(p.root, "s1", "ls"), p.options)).toBe("");
		const own = project();
		startRun(own);
		cancel(own);
		expect(runPreToolUseHook(bash(own.root, "s1", "ls"), own.options)).toBe("");
	});

	it("11. a corrupt state answers BLOCKED and stays as it was", () => {
		const p = project();
		startRun(p);
		writeFileSync(statePathFor(p.root), "{not json", "utf8");
		const out = contextOf(cancel(p));
		expect(out.startsWith("BLOCKED:")).toBe(true);
		expect(out).toContain("STATE_INVALID");
		expect(readFileSync(statePathFor(p.root), "utf8")).toBe("{not json");
		const q = project();
		startRun(q);
		const state = JSON.parse(stateBytes(q)) as Record<string, unknown>;
		writeFileSync(statePathFor(q.root), JSON.stringify({ ...state, revision: "x" }), "utf8");
		const before = stateBytes(q);
		const blocked = contextOf(cancel(q));
		expect(blocked.startsWith("BLOCKED:")).toBe(true);
		expect(stateBytes(q)).toBe(before);
	});

	it("12. a cancel writes no parked or denied entry and no other lit-loop file", () => {
		const p = project();
		startRun(p);
		cancel(p);
		const work = readLifecycleState(p.root)?.works["w1"];
		expect(work?.["parked_boundaries"]).toBeUndefined();
		expect(work?.["denied_boundaries"]).toBeUndefined();
		const loop = join(p.root, ".litcodex", "lit-loop");
		expect(readFileSync(join(loop, "ledger.jsonl"), "utf8").length).toBeGreaterThan(0);
		expect(readdirSync(loop)).toEqual(["ledger.jsonl"]);
	});
});
