import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runStopHook, runUserPromptSubmitHook } from "../src/codex-hook.js";
import {
	initializeWork,
	inspectLifecycleState,
	readLifecycleState,
	START_WORK_MAX_HISTORY_EVENTS,
	statePathFor,
	transitionWork,
} from "../src/lifecycle-store.js";
import { diagnoseLifecycle } from "../src/work-state-reader.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Gate D terminal lifecycle and replay bounds", () => {
	it("starts a new work after terminal state with global CAS revision while preserving terminal replay", () => {
		const root = initRoot(["one.md", "two.md"]);
		const firstRequest = initRequest(root, "init-1", "w1", "one.md", 0);
		initializeWork(root, firstRequest);
		expect(() => initializeWork(root, initRequest(root, "init-blocked", "w2", "two.md", 1))).toThrow(
			/nonterminal|active/i,
		);
		transitionWork(root, cancelRequest("w1", 1, "cancel-1"));

		const second = initializeWork(root, initRequest(root, "init-2", "w2", "two.md", 2));
		const replay = initializeWork(root, firstRequest);

		expect(second.state).toMatchObject({ revision: 3, active_work_id: "w2" });
		expect(second.state.works["w1"]?.status).toBe("abandoned");
		expect(second.state.works["w2"]?.status).toBe("active");
		expect(Object.keys(second.state.transition_history ?? {})).toEqual(["init-1", "cancel-1", "init-2"]);
		expect(replay.changed).toBe(false);
		expect(replay.event.transitionId).toBe("init-1");
		expect(readLifecycleState(root)?.revision).toBe(3);
	});

	it("compacts replay history below the state ceiling and reports expired replay explicitly", () => {
		const root = initRoot(["one.md"]);
		initializeWork(root, initRequest(root, "init-1", "w1", "one.md", 0));
		let revision = 1;
		for (let index = 0; index < START_WORK_MAX_HISTORY_EVENTS + 4; index += 1) {
			const boundary = { ...boundaryFor(root, `boundary-${index}`), action: `deploy-${index}` };
			transitionWork(root, {
				action: "pause",
				expectedRevision: revision,
				sessionId: "s1",
				transitionId: `pause-${index}`,
				workId: "w1",
				reasonCode: "authorization_required",
				boundary,
			});
			revision += 1;
			transitionWork(root, {
				action: "resume",
				expectedRevision: revision,
				sessionId: "s1",
				transitionId: `resume-${index}`,
				workId: "w1",
				reasonCode: "explicit_user_resume",
				boundary,
				grant: grantFor(boundary, `grant-${index}`),
			});
			revision += 1;
		}
		const state = readLifecycleState(root);
		expect(Object.keys(state?.transition_history ?? {})).toHaveLength(START_WORK_MAX_HISTORY_EVENTS);
		expect(state?.history_floor_revision).toBeGreaterThan(1);
		expect(Buffer.byteLength(readFileSync(statePathFor(root)))).toBeLessThanOrEqual(1_000_000);

		appendFileSync(join(root, ".litcodex", "lit-loop", "ledger.jsonl"), `${"x".repeat(2_100_000)}\n`, "utf8");
		expect(() =>
			transitionWork(root, {
				action: "pause",
				expectedRevision: 1,
				sessionId: "s1",
				transitionId: "pause-0",
				workId: "w1",
				reasonCode: "authorization_required",
				boundary: { ...boundaryFor(root, "boundary-0"), action: "deploy-0" },
			}),
		).toThrow(/replay expired/i);
	}, 15_000);

	it("fails closed when history regresses from revision 9 to revision 1", () => {
		const root = initRoot(["one.md"]);
		const authority = storedAuthority(root);
		const event9 = event("e9", 9, "active");
		const event1 = event("e1", 1, "active");
		writeState(root, {
			schema_version: 3,
			revision: 9,
			active_work_id: "w1",
			works: { w1: activeWork(root, authority, { last_transition: event1 }) },
			transition_history: { e9: event9, e1: event1 },
		});
		expect(inspectLifecycleState(root)).toMatchObject({ ok: false, code: "STATE_REVISION_INVALID" });
	});
});

describe("Gate D strict authority and boundary ownership", () => {
	it("requires canonical authority for schema 3 active work but permits immutable terminal history without it", () => {
		const root = initRoot(["one.md"]);
		writeState(root, {
			schema_version: 3,
			revision: 0,
			active_work_id: "w1",
			works: { w1: activeWork(root, undefined) },
		});
		expect(inspectLifecycleState(root)).toMatchObject({ ok: false, code: "AUTHORITY_INVALID" });

		const outside = initRoot(["outside.md"]);
		writeState(root, {
			schema_version: 3,
			revision: 0,
			active_work_id: "w1",
			works: {
				w1: { ...activeWork(root, storedAuthority(root)), worktree_path: realpathSync(outside) },
			},
		});
		expect(inspectLifecycleState(root)).toMatchObject({ ok: false, code: "WORKTREE_INVALID" });

		writeState(root, {
			schema_version: 3,
			revision: 0,
			active_work_id: null,
			works: { w1: { ...activeWork(root, undefined), status: "completed" } },
		});
		expect(inspectLifecycleState(root)).toMatchObject({ ok: true });

		const noncanonicalRoot = join(root, "authority-root-alias");
		symlinkSync(root, noncanonicalRoot, "dir");
		writeState(root, {
			schema_version: 3,
			revision: 0,
			active_work_id: "w1",
			works: {
				w1: activeWork(root, { ...storedAuthority(root), allowed_roots: [noncanonicalRoot] }),
			},
		});
		expect(inspectLifecycleState(root)).toMatchObject({ ok: false, code: "AUTHORITY_INVALID" });
	});

	it("migrates schema 2 only when the mutation supplies valid authority", () => {
		const root = initRoot(["one.md"]);
		writeState(root, {
			schema_version: 2,
			active_work_id: "w1",
			works: { w1: activeWork(root, undefined) },
		});
		const boundary = boundaryFor(root, "migration-boundary");
		expect(() =>
			transitionWork(root, {
				...pauseRequest(root, 0, "pause-without-authority", boundary),
			}),
		).toThrow(/migration authority/i);

		const migrated = transitionWork(root, {
			...pauseRequest(root, 0, "pause-with-authority", boundary),
			authority: inputAuthority(root),
		});
		expect(migrated.state.schema_version).toBe(3);
		expect(migrated.state.works["w1"]?.authority).toEqual(storedAuthority(root));
	});

	it("stores one matching pending boundary and requires a matching persisted grant to resume", () => {
		const root = initialized(rootWithPlan());
		const boundary = boundaryFor(root, "credential-boundary");
		const paused = transitionWork(root, pauseRequest(root, 1, "pause-1", boundary));
		expect(paused.state.works["w1"]?.pending_boundary).toEqual(boundary);
		expect(() =>
			transitionWork(root, {
				...resumeRequest(boundary, 2, "resume-bad", grantFor(boundary, "grant-bad")),
				grant: { ...grantFor(boundary, "grant-bad"), action: "publish" },
			}),
		).toThrow(/grant|authority/i);
		expect(() =>
			transitionWork(root, {
				action: "complete",
				expectedRevision: 2,
				sessionId: "s1",
				transitionId: "paused-complete",
				workId: "w1",
				reasonCode: "completed",
			}),
		).toThrow(/paused/i);

		const request = resumeRequest(boundary, 2, "resume-1", grantFor(boundary, "grant-1"));
		const resumed = transitionWork(root, request);
		const replay = transitionWork(root, request);
		expect(resumed.state.works["w1"]?.pending_boundary).toBeUndefined();
		expect(resumed.state.works["w1"]?.authority_grants).toContainEqual(grantFor(boundary, "grant-1"));
		expect(replay.changed).toBe(false);
	});

	it("does not mutate or reprompt when the same boundary is reported twice", () => {
		const root = initialized(rootWithPlan());
		const boundary = boundaryFor(root, "same-boundary");
		const first = transitionWork(root, pauseRequest(root, 1, "pause-1", boundary));
		const repeated = transitionWork(root, pauseRequest(root, 1, "pause-2", boundary));
		expect(first.state.revision).toBe(2);
		expect(repeated.changed).toBe(false);
		expect(repeated.state.revision).toBe(2);
		expect(repeated.event.transitionId).toBe("pause-1");
	});
});

describe("Gate D stop, route, transcript, and diagnostics", () => {
	it("issues once per progress, replays the same turn, and leaves later unchanged Stops silent", () => {
		const root = initialized(
			rootWithPlan("## Todos\n- [ ] 1. First\n- [ ] 2. Second\n\n## Final verification wave\n- [ ] F1. Verify\n"),
		);
		const first = runStopHook(stopInput(root, "turn-1"));
		const replay = runStopHook(stopInput(root, "turn-1"));
		const later = runStopHook(stopInput(root, "turn-2"));
		expect(replay).toBe(first);
		expect(later).toBe("");
		expect(readLifecycleState(root)?.revision).toBe(2);
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");

		writeFileSync(planPath(root), "## Todos\n- [x] First\n- [ ] Second\n", "utf8");
		expect(runStopHook(stopInput(root, "turn-3"))).not.toBe("");
		expect(readLifecycleState(root)?.revision).toBe(3);
	});

	it("resumes only with paired matching flags and a matching canonical worktree", () => {
		const root = initialized(rootWithPlan());
		const boundary = boundaryFor(root, "route-boundary");
		transitionWork(root, pauseRequest(root, 1, "pause-route", boundary));
		for (const malformed of [
			"lit start work one",
			"lit start work one --resume route-boundary",
			`lit start work one --grant grant-1 --resume route-boundary --worktree ${root}`,
			"lit start work one --resume route-boundary --grant grant-1 --worktree relative",
			`lit start work one --worktree ${root} --resume route-boundary --grant grant-1`,
		]) {
			expect(runUserPromptSubmitHook(promptInput(root, malformed))).toBe("");
			expect(readLifecycleState(root)?.works["w1"]?.status).toBe("paused");
		}

		const prompt = `$litcodex:start-work one --resume route-boundary --grant grant-1 --worktree ${root}`;
		expect(runUserPromptSubmitHook(promptInput(root, prompt))).toBe("");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");
		expect(runUserPromptSubmitHook(promptInput(root, prompt))).toBe("");
		expect(readLifecycleState(root)?.revision).toBe(3);
	});

	it("embeds validated authority and pending-boundary fields in continuation context", () => {
		const root = initialized(rootWithPlan());
		const output = JSON.parse(runStopHook(stopInput(root, "turn-context"))) as { reason: string };
		expect(output.reason).toContain('"authority":{"authority_id":"authority-1"');
		expect(output.reason).toContain('"forbidden_actions":["publish"]');
		expect(output.reason).toContain('"pendingBoundary":null');
	});

	it("fails silent for symlinked, malformed, and oversized transcript inputs", () => {
		for (const kind of ["symlink", "malformed", "oversized"] as const) {
			const root = initialized(rootWithPlan());
			const transcript = join(root, "transcript.jsonl");
			if (kind === "symlink") {
				const target = join(root, "target.jsonl");
				writeFileSync(target, `${JSON.stringify({ type: "message", role: "user", content: "safe" })}\n`, "utf8");
				symlinkSync(target, transcript);
			} else if (kind === "malformed") writeFileSync(transcript, "{not-json\n", "utf8");
			else writeFileSync(transcript, "x".repeat(2_000_001), "utf8");
			expect(runStopHook({ ...stopInput(root, `turn-${kind}`), transcript_path: transcript })).toBe("");
			expect(readLifecycleState(root)?.revision).toBe(1);
		}
	});

	it("rejects authority input whose total budget would create unreadable state", () => {
		const root = rootWithPlan();
		const huge = "a".repeat(7_000);
		expect(() =>
			initializeWork(root, {
				...initRequest(root, "huge", "w1", "one.md", 0),
				authority: {
					...inputAuthority(root),
					allowedActions: Array.from({ length: 5 }, (_, index) => `${index}-${huge}`),
					forbiddenActions: Array.from({ length: 5 }, (_, index) => `${index + 5}-${huge}`),
				},
			}),
		).toThrow(/authority.*budget/i);
		expect(readLifecycleState(root)).toBeNull();
	});

	it("rejects a mutation whose atomic state would exceed the read ceiling", () => {
		const root = initialized(rootWithPlan());
		const statePath = statePathFor(root);
		const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
		state["padding"] = "";
		state["padding"] = "x".repeat(1_000_000 - Buffer.byteLength(JSON.stringify(state), "utf8") - 10);
		writeFileSync(statePath, JSON.stringify(state), "utf8");
		const before = readFileSync(statePath, "utf8");
		expect(() => transitionWork(root, cancelRequest("w1", 1, "too-large"))).toThrow(/state.*readable.*limit/i);
		expect(readFileSync(statePath, "utf8")).toBe(before);
	});

	it("doctor exposes revision, retained history, state, active work, and pending boundary", () => {
		const root = initialized(rootWithPlan());
		const boundary = boundaryFor(root, "doctor-boundary");
		transitionWork(root, pauseRequest(root, 1, "pause-doctor", boundary));
		expect(diagnoseLifecycle(root)).toMatchObject({
			ok: true,
			revision: 2,
			state: "valid",
			history: { retained: 2, floorRevision: 1 },
			active: { workId: "w1", status: "paused" },
			pendingBoundary: boundary,
		});
	});
});

function rootWithPlan(plan = "## Todos\n- [ ] 1. First\n\n## Final verification wave\n- [ ] F1. Verify\n"): string {
	return initRoot(["one.md"], plan);
}

function initialized(root: string): string {
	initializeWork(root, initRequest(root, "init-1", "w1", "one.md", 0));
	return root;
}

function initRoot(
	names: readonly string[],
	plan = "## Todos\n- [ ] 1. First\n\n## Final verification wave\n- [ ] F1. Verify\n",
): string {
	const root = mkdtempSync(join(tmpdir(), "gate-d-hardening-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	for (const name of names) writeFileSync(join(root, ".litcodex", "plans", name), plan, "utf8");
	return root;
}

function initRequest(root: string, initId: string, workId: string, plan: string, expectedRevision: number) {
	return {
		initId,
		expectedRevision,
		workId,
		plan: `.litcodex/plans/${plan}`,
		planName: plan.replace(/\.md$/, ""),
		sessionId: "s1",
		worktreePath: root,
		authority: inputAuthority(root),
	};
}

function inputAuthority(root: string) {
	return {
		authorityId: "authority-1",
		allowedRoots: [root],
		allowedActions: ["edit", "test"],
		forbiddenActions: ["publish"],
	};
}

function storedAuthority(root: string) {
	return {
		authority_id: "authority-1",
		allowed_roots: [realpathSync(root)],
		allowed_actions: ["edit", "test"],
		forbidden_actions: ["publish"],
	};
}

function boundaryFor(root: string, id: string) {
	return { boundary_id: id, authority_id: "authority-1", action: "deploy", root: realpathSync(root) };
}

function grantFor(boundary: ReturnType<typeof boundaryFor>, id: string) {
	return {
		grant_id: id,
		authority_id: boundary.authority_id,
		boundary_id: boundary.boundary_id,
		action: boundary.action,
		root: boundary.root,
	};
}

function pauseRequest(
	_root: string,
	expectedRevision: number,
	transitionId: string,
	boundary: ReturnType<typeof boundaryFor>,
) {
	return {
		action: "pause" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId: "w1",
		reasonCode: "authorization_required" as const,
		boundary,
	};
}

function resumeRequest(
	boundary: ReturnType<typeof boundaryFor>,
	expectedRevision: number,
	transitionId: string,
	grant: ReturnType<typeof grantFor>,
) {
	return {
		action: "resume" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId: "w1",
		reasonCode: "explicit_user_resume" as const,
		boundary,
		grant,
	};
}

function cancelRequest(workId: string, expectedRevision: number, transitionId: string) {
	return {
		action: "cancel" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId,
		reasonCode: "user_cancelled" as const,
	};
}

function activeWork(
	root: string,
	authority: ReturnType<typeof storedAuthority> | undefined,
	extra: Record<string, unknown> = {},
) {
	return {
		work_id: "w1",
		active_plan: ".litcodex/plans/one.md",
		plan_name: "one",
		session_ids: ["codex:s1"],
		status: "active",
		worktree_path: realpathSync(root),
		...(authority === undefined ? {} : { authority }),
		...extra,
	};
}

function event(transitionId: string, revision: number, status: "active" | "paused") {
	return {
		kind: revision === 1 ? "start_work_initialized" : "start_work_resumed",
		at: `2026-07-22T00:00:0${revision}.000Z`,
		workId: "w1",
		transitionId,
		revision,
		toWorkStatus: status,
		plan: ".litcodex/plans/one.md",
		sessionId: "codex:s1",
	};
}

function writeState(root: string, value: unknown): void {
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(statePathFor(root), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function planPath(root: string): string {
	return join(root, ".litcodex", "plans", "one.md");
}

function stopInput(root: string, turnId: string) {
	return {
		hook_event_name: "Stop",
		session_id: "s1",
		turn_id: turnId,
		transcript_path: "",
		cwd: root,
		model: "gpt-5.6-sol",
		permission_mode: "default",
		stop_hook_active: false,
	};
}

function promptInput(root: string, prompt: string) {
	return {
		hook_event_name: "UserPromptSubmit",
		session_id: "s1",
		turn_id: "resume-turn",
		transcript_path: null,
		cwd: root,
		prompt,
	};
}
