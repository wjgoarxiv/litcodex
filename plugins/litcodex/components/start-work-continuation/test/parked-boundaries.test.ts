// A step outside the run's authority is parked and the run keeps going; `lit approve` / `lit deny` settle the whole
// queue at once, and release-class or protected steps are never parked or granted.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runStopHook, runUserPromptSubmitHook } from "../src/codex-hook.js";
import {
	advanceStopLease,
	LifecycleStoreError,
	readLifecycleState,
	statePathFor,
	transitionWork,
} from "../src/lifecycle-store.js";
import { diagnoseLifecycle, readContinuationState } from "../src/work-state-reader.js";
import {
	boundaryFor,
	cleanupProjects,
	contextOf,
	legacyPaused,
	outside,
	type Project,
	pause,
	project,
	promptInput,
	sha,
	startRun,
	stateBytes,
} from "./autopilot-fixture.js";

afterEach(cleanupProjects);

const CLI_PATH = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function cliPause(p: Project, target: ReturnType<typeof boundaryFor>, revision: number, id: string) {
	return spawnSync(execPath, [CLI_PATH, "transition", "pause"], {
		input: JSON.stringify({
			cwd: p.root,
			session_id: "s1",
			expected_revision: revision,
			transition_id: id,
			work_id: "w1",
			reason_code: "authorization_required",
			boundary: target,
		}),
		encoding: "utf8",
		env: { ...process.env, ...p.env },
	});
}

const stopInput = (cwd: string, turn = "t1") => ({
	hook_event_name: "Stop",
	session_id: "s1",
	turn_id: turn,
	transcript_path: null,
	cwd,
	model: "m",
	permission_mode: "default",
	stop_hook_active: false,
});

const codeOf = (run: () => unknown): string => {
	try {
		run();
	} catch (error) {
		if (error instanceof LifecycleStoreError) return error.code;
		throw error;
	}
	return "no error";
};

const parkedOf = (p: Project) => readLifecycleState(p.root)?.works["w1"]?.parked_boundaries ?? [];
const kinds = (p: Project) => Object.values(readLifecycleState(p.root)?.transition_history ?? {}).map((e) => e.kind);
const say = (p: Project, text: string, turn = "t1") =>
	contextOf(runUserPromptSubmitHook(promptInput(p.root, text, "s1", turn), p.options));

describe("park instead of pause", () => {
	it("13. transition pause parks: status stays active, one entry, a parked event, CLI outcome and count", () => {
		const p = project();
		startRun(p);
		const target = boundaryFor(outside(p, "other"));
		const revision = readLifecycleState(p.root)?.revision ?? 0;
		const run = cliPause(p, target, revision, "pause-1");
		expect(run.status).toBe(0);
		expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, status: "active", outcome: "parked", parked: 1 });
		const work = readLifecycleState(p.root)?.works["w1"];
		expect(work?.status).toBe("active");
		expect(work?.parked_boundaries).toHaveLength(1);
		expect(work?.last_transition?.kind).toBe("start_work_boundary_parked");
		expect(work?.last_transition?.toWorkStatus).toBe("active");
	});

	it("14. after a park the continuation still runs and lists the parked step", () => {
		const p = project();
		startRun(p);
		const target = boundaryFor(outside(p, "other"));
		pause(p, target);
		expect(readContinuationState(p.root, "s1")).not.toBeNull();
		const out = runStopHook(stopInput(p.root));
		expect(out).toContain('"decision":"block"');
		expect(out).toContain("parkedBoundaries");
		expect(out).toContain(target.boundary_id);
	});

	it("15. two boundaries queue in order; the same action and root again is already_parked", () => {
		const p = project();
		startRun(p);
		const a = boundaryFor(outside(p, "a"));
		const b = boundaryFor(outside(p, "b"));
		pause(p, a);
		pause(p, b);
		expect(parkedOf(p).map((entry) => entry.boundary_id)).toEqual([a.boundary_id, b.boundary_id]);
		const before = readLifecycleState(p.root)?.revision ?? 0;
		const again = transitionWork(
			p.root,
			{
				action: "pause",
				expectedRevision: before - 1,
				sessionId: "s1",
				transitionId: "pause-again",
				workId: "w1",
				reasonCode: "authorization_required",
				boundary: { ...a, boundary_id: "another-id" },
			},
			p.options,
		);
		expect(again.changed).toBe(false);
		expect(again.outcome).toBe("already_parked");
		expect(readLifecycleState(p.root)?.revision).toBe(before);
		const run = cliPause(p, boundaryFor(outside(p, "c")), before, "pause-c");
		expect(run.status).toBe(0);
	});

	it("16. the 17th distinct boundary is PARKED_LIMIT, state unchanged, code on CLI stderr", () => {
		const p = project();
		startRun(p);
		for (let index = 0; index < 16; index += 1) pause(p, boundaryFor(outside(p, `d${index}`)));
		const before = stateBytes(p);
		const revision = readLifecycleState(p.root)?.revision ?? 0;
		const run = cliPause(p, boundaryFor(outside(p, "d16")), revision, "pause-17");
		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain('"code":"PARKED_LIMIT"');
		expect(stateBytes(p)).toBe(before);
	});

	it("16b. a parked file that disappears keeps the state readable and is dropped as gone by lit approve", () => {
		const p = project();
		startRun(p);
		const file = outside(p, "temp.txt", true);
		const keep = boundaryFor(outside(p, "keep"));
		pause(p, boundaryFor(file));
		pause(p, keep);
		rmSync(file);
		expect(readLifecycleState(p.root)).not.toBeNull();
		expect(diagnoseLifecycle(p.root).ok).toBe(true);
		expect(runStopHook(stopInput(p.root))).toContain('"decision":"block"');
		const out = say(p, "lit approve");
		expect(out).toContain("no longer exists");
		expect(out).toContain(keep.root);
		expect(parkedOf(p)).toEqual([]);
		expect(readLifecycleState(p.root)?.works["w1"]?.authority_grants?.map((g) => g.root)).toContain(keep.root);
	});

	it("16c. a read of the project's .env is protected, not authorized by the project root", () => {
		const p = project();
		startRun(p);
		writeFileSync(join(p.root, ".env"), "TOKEN=x\n", "utf8");
		expect(codeOf(() => pause(p, boundaryFor(join(p.real, ".env"), "read")))).toBe("BOUNDARY_PROTECTED");
		expect(parkedOf(p)).toEqual([]);
	});

	it("17. a forbidden action is BOUNDARY_MISMATCH and is not parked", () => {
		const p = project();
		startRun(p);
		expect(codeOf(() => pause(p, boundaryFor(p.real, "publish")))).toBe("BOUNDARY_MISMATCH");
		expect(parkedOf(p)).toEqual([]);
	});
});

describe("settling the queue", () => {
	it("18. lit approve grants both parked steps; the same turn again replays", () => {
		const p = project();
		startRun(p);
		const a = boundaryFor(outside(p, "a"));
		const b = boundaryFor(outside(p, "b"));
		pause(p, a);
		pause(p, b);
		const out = say(p, "lit approve");
		expect(out).toContain(a.root);
		expect(out).toContain(b.root);
		expect(parkedOf(p)).toEqual([]);
		expect(kinds(p).filter((kind) => kind === "start_work_resumed")).toHaveLength(2);
		const revision = readLifecycleState(p.root)?.revision;
		say(p, "lit approve");
		expect(kinds(p).filter((kind) => kind === "start_work_resumed")).toHaveLength(2);
		expect(readLifecycleState(p.root)?.revision).toBe(revision);
	});

	it("19. with 63 grants held, approve grants one, leaves one parked and drops nothing", () => {
		const p = project();
		startRun(p);
		const state = JSON.parse(stateBytes(p)) as { works: { w1: Record<string, unknown> } };
		const grants = Array.from({ length: 63 }, (_, index) => ({
			grant_id: `g${index}`,
			authority_id: "authority-1",
			boundary_id: `old${index}`,
			action: "edit",
			root: p.real,
		}));
		state.works.w1["authority_grants"] = grants;
		writeFileSync(statePathFor(p.root), JSON.stringify(state), "utf8");
		const a = boundaryFor(outside(p, "a"));
		const b = boundaryFor(outside(p, "b"));
		pause(p, a);
		pause(p, b);
		const out = say(p, "lit approve");
		expect(out).toContain("Still parked");
		const work = readLifecycleState(p.root)?.works["w1"];
		expect(work?.authority_grants).toHaveLength(64);
		expect(work?.authority_grants?.[0]?.grant_id).toBe("g0");
		expect(work?.parked_boundaries).toHaveLength(1);
	});

	it("20. lit deny refuses both; a later pause of a covered root is BOUNDARY_DENIED", () => {
		const p = project();
		startRun(p);
		const a = boundaryFor(outside(p, "a"));
		const b = boundaryFor(outside(p, "b"));
		pause(p, a);
		pause(p, b);
		const out = say(p, "lit deny");
		expect(out).toContain("refused for the rest of this run");
		const work = readLifecycleState(p.root)?.works["w1"];
		expect(work?.status).toBe("active");
		expect(work?.parked_boundaries ?? []).toEqual([]);
		expect(work?.denied_boundaries).toHaveLength(2);
		const event = Object.values(readLifecycleState(p.root)?.transition_history ?? {}).find(
			(e) => e.kind === "start_work_boundary_denied",
		);
		expect(event?.boundaryIds).toEqual([a.boundary_id, b.boundary_id]);
		expect(codeOf(() => pause(p, { ...a, boundary_id: "retry" }, "s1", "pause-retry"))).toBe("BOUNDARY_DENIED");
	});
});

describe("old paused states", () => {
	it("21. a legacy paused run reads as active with one parked entry, and every route works on it", () => {
		const p = project();
		const legacy = legacyPaused(p, "edit", outside(p, "legacy"));
		const work = readLifecycleState(p.root)?.works["w1"];
		expect(work?.status).toBe("active");
		expect(work?.parked_boundaries?.map((entry) => entry.boundary_id)).toEqual([legacy.boundary_id]);
		expect(work?.pending_boundary).toBeUndefined();
		expect(diagnoseLifecycle(p.root)).toMatchObject({ ok: true, parkedBoundaries: [legacy] });
		say(p, "lit approve");
		const raw = JSON.parse(stateBytes(p)) as { works: { w1: Record<string, unknown> } };
		expect(raw.works.w1["pending_boundary"]).toBeUndefined();
		expect(raw.works.w1["status"]).toBe("active");

		const q = project();
		legacyPaused(q, "edit", outside(q, "legacy"));
		expect(contextOf(runUserPromptSubmitHook(promptInput(q.root, "lit deny"), q.options))).toContain("refused");
		expect(readLifecycleState(q.root)?.works["w1"]?.denied_boundaries).toHaveLength(1);

		const r = project();
		const route = legacyPaused(r, "edit", outside(r, "legacy"));
		runUserPromptSubmitHook(promptInput(r.root, `start-work --resume ${route.boundary_id} --grant g-1`), r.options);
		expect(readLifecycleState(r.root)?.works["w1"]?.authority_grants?.map((g) => g.grant_id)).toEqual(["g-1"]);
	});

	it("22. a new parked step at unchanged progress earns one continuation; no parked keeps today's lease id", () => {
		const p = project();
		startRun(p);
		const progress = readContinuationState(p.root, "s1");
		if (progress === null) throw new Error("no continuation");
		const first = advanceStopLease(p.root, {
			sessionId: "s1",
			turnId: "t1",
			progressToken: progress.progressToken,
			workId: "w1",
			expectedRevision: progress.revision,
		});
		expect(first.outcome).toBe("issued");
		expect(first.state.works["w1"]?.last_transition?.transitionId).toBe(
			`stop-continue:${sha("s1").slice(0, 16)}:${sha("t1").slice(0, 16)}:${progress.progressToken}`,
		);
		expect(runStopHook(stopInput(p.root, "t2"))).toBe("");
		pause(p, boundaryFor(outside(p, "late")));
		expect(runStopHook(stopInput(p.root, "t3"))).toContain('"decision":"block"');
		expect(runStopHook(stopInput(p.root, "t4"))).toBe("");
	});

	it("23. replaying a stored start_work_paused transition id is not a conflict", () => {
		const p = project();
		const legacy = legacyPaused(p);
		const replay = transitionWork(
			p.root,
			{
				action: "pause",
				expectedRevision: 1,
				sessionId: "s1",
				transitionId: "legacy-pause",
				workId: "w1",
				reasonCode: "authorization_required",
				boundary: legacy,
			},
			p.options,
		);
		expect(replay.changed).toBe(false);
	});

	it("24. release-class actions are refused in every state and never granted", () => {
		const actions = [
			"commit",
			"publish",
			"push",
			"tag",
			"release",
			"version-bump",
			"vcs-destructive",
			"Git_Push",
			"host-config-write",
		];
		for (const stage of ["fresh", "parked", "approved"] as const) {
			const p = project();
			startRun(p);
			if (stage !== "fresh") {
				pause(p, boundaryFor(outside(p, "a")));
				pause(p, boundaryFor(outside(p, "b")));
			}
			if (stage === "approved") say(p, "lit approve");
			const before = parkedOf(p).length;
			for (const action of actions)
				expect(codeOf(() => pause(p, boundaryFor(p.real, action), "s1", `rc-${action}`))).toBe("BOUNDARY_MISMATCH");
			expect(parkedOf(p)).toHaveLength(before);
		}
		const legacy = project();
		const push = legacyPaused(legacy, "push", outside(legacy, "remote"));
		const out = contextOf(runUserPromptSubmitHook(promptInput(legacy.root, "lit approve"), legacy.options));
		expect(out).toContain("refused");
		expect(parkedOf(legacy).map((entry) => entry.boundary_id)).toEqual([push.boundary_id]);
		expect(readLifecycleState(legacy.root)?.works["w1"]?.authority_grants ?? []).toEqual([]);
		expect(readFileSync(statePathFor(legacy.root), "utf8")).toContain('"pending_boundary"');
	});
});
