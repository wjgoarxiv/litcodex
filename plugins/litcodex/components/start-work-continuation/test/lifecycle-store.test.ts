import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	initializeWork,
	readLifecycleState,
	reconcileLifecycleState,
	statePathFor,
	transitionWork,
} from "../src/lifecycle-store.js";

const roots: string[] = [];
let requestRoot = "";

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("start-work lifecycle store", () => {
	it("applies CAS transitions with global revisions, canonical events, and idempotent transition ids", () => {
		const root = workspace("active", 7);

		const first = transitionWork(root, {
			action: "pause",
			expectedRevision: 7,
			sessionId: "s1",
			transitionId: "pause-1",
			workId: "w1",
			reasonCode: "authorization_required",
			boundary: boundary(realpathSync(root)),
		});
		const replay = transitionWork(root, {
			action: "pause",
			expectedRevision: 7,
			sessionId: "s1",
			transitionId: "pause-1",
			workId: "w1",
			reasonCode: "authorization_required",
			boundary: boundary(realpathSync(root)),
		});

		expect(first.changed).toBe(true);
		expect(first.state.revision).toBe(8);
		expect(first.event).toMatchObject({
			kind: "start_work_paused",
			workId: "w1",
			transitionId: "pause-1",
			revision: 8,
			fromWorkStatus: "active",
			toWorkStatus: "paused",
		});
		expect(replay.changed).toBe(false);
		expect(readLifecycleState(root)?.revision).toBe(8);
		expect(ledger(root)).toHaveLength(1);
		expect(() =>
			transitionWork(root, {
				action: "resume",
				expectedRevision: 7,
				sessionId: "s1",
				transitionId: "resume-stale",
				workId: "w1",
				reasonCode: "explicit_user_resume",
				boundary: boundary(realpathSync(root)),
				grant: grant(realpathSync(root)),
			}),
		).toThrow(/revision/i);
	});

	it("recovers the canonical event after interruption between state and ledger", () => {
		const root = workspace("active", 0);
		expect(() =>
			transitionWork(
				root,
				{
					action: "pause",
					expectedRevision: 0,
					sessionId: "s1",
					transitionId: "interrupted",
					workId: "w1",
					reasonCode: "authorization_required",
					boundary: boundary(realpathSync(root)),
				},
				{
					afterStateWrite: () => {
						throw new Error("fault-after-state");
					},
				},
			),
		).toThrow("fault-after-state");
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("paused");
		expect(ledger(root)).toEqual([]);

		const replay = transitionWork(root, {
			action: "pause",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "interrupted",
			workId: "w1",
			reasonCode: "authorization_required",
			boundary: boundary(realpathSync(root)),
		});

		expect(replay.changed).toBe(false);
		expect(ledger(root)).toHaveLength(1);
		expect(ledger(root)[0]).toMatchObject({ kind: "start_work_paused", transitionId: "interrupted" });
	});

	it("tolerates malformed and duplicate ledger fragments during state-first recovery", () => {
		const root = workspace("active", 0);
		expect(() =>
			transitionWork(
				root,
				{
					action: "pause",
					expectedRevision: 0,
					sessionId: "s1",
					transitionId: "once",
					workId: "w1",
					reasonCode: "authorization_required",
					boundary: boundary(realpathSync(root)),
				},
				{
					afterStateWrite: () => {
						throw new Error("interrupt");
					},
				},
			),
		).toThrow("interrupt");
		const ledgerPath = join(root, ".litcodex", "lit-loop", "ledger.jsonl");
		mkdirSync(join(root, ".litcodex", "lit-loop"), { recursive: true });
		writeFileSync(ledgerPath, "{partial\n{}\n", "utf8");

		transitionWork(root, {
			action: "pause",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "once",
			workId: "w1",
			reasonCode: "authorization_required",
			boundary: boundary(realpathSync(root)),
		});
		transitionWork(root, {
			action: "pause",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "once",
			workId: "w1",
			reasonCode: "authorization_required",
			boundary: boundary(realpathSync(root)),
		});

		expect(ledger(root).filter((entry) => entry["transitionId"] === "once")).toHaveLength(1);
	});

	it("lazily migrates valid schema 2 on its first mutation", () => {
		const root = workspace("paused", undefined, 2);

		const result = transitionWork(root, {
			action: "resume",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "migrate-resume",
			workId: "w1",
			reasonCode: "explicit_user_resume",
			boundary: boundary(realpathSync(root)),
			grant: grant(realpathSync(root)),
			authority: inputAuthority(realpathSync(root)),
		});

		expect(result.state.schema_version).toBe(3);
		expect(result.state.revision).toBe(1);
		expect(result.state.works["w1"]?.status).toBe("active");
		expect(readFileSync(join(root, ".litcodex", "start-work", "state.json"), "utf8")).toContain(
			'"schema_version": 3',
		);
	});

	it("maps cancel to abandoned and complete to completed without prose event aliases", () => {
		const cancelled = workspace("active", 0);
		const cancel = transitionWork(cancelled, {
			action: "cancel",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "cancel-1",
			workId: "w1",
			reasonCode: "user_cancelled",
		});
		expect(cancel.state.works["w1"]?.status).toBe("abandoned");
		expect(cancel.event.kind).toBe("start_work_cancelled");
		expect(
			transitionWork(cancelled, {
				action: "cancel",
				expectedRevision: 0,
				sessionId: "s1",
				transitionId: "cancel-1",
				workId: "w1",
				reasonCode: "user_cancelled",
			}).changed,
		).toBe(false);

		const completed = workspace("active", 0);
		writeFileSync(join(completed, ".litcodex", "plans", "plan.md"), "## Todos\n- [x] Task\n", "utf8");
		const complete = transitionWork(completed, {
			action: "complete",
			expectedRevision: 0,
			sessionId: "s1",
			transitionId: "complete-1",
			workId: "w1",
			reasonCode: "completed",
		});
		expect(complete.state.works["w1"]?.status).toBe("completed");
		expect(complete.event.kind).toBe("start_work_completed");
		expect(JSON.stringify(ledger(completed))).not.toContain("work-completed");
	});

	it("uses a bounded lock, reclaims a stale token without sleeping, and never releases a replacement token", () => {
		const busy = workspace("active", 0);
		const busyLock = `${statePathFor(busy)}.lock`;
		writeFileSync(busyLock, JSON.stringify({ token: "busy", createdAt: 10_000 }), "utf8");
		expect(() =>
			transitionWork(
				busy,
				{
					action: "pause",
					expectedRevision: 0,
					sessionId: "s1",
					transitionId: "busy",
					workId: "w1",
					reasonCode: "authorization_required",
					boundary: boundary(realpathSync(busy)),
				},
				{ nowMs: () => 10_001 },
			),
		).toThrow(/lock is busy/i);
		expect(readLifecycleState(busy)?.revision).toBe(0);

		const stale = workspace("active", 0);
		const staleLock = `${statePathFor(stale)}.lock`;
		writeFileSync(staleLock, JSON.stringify({ token: "stale", createdAt: 0 }), "utf8");
		const replacement = JSON.stringify({ token: "replacement", createdAt: 40_000 });
		transitionWork(
			stale,
			{
				action: "pause",
				expectedRevision: 0,
				sessionId: "s1",
				transitionId: "stale",
				workId: "w1",
				reasonCode: "authorization_required",
				boundary: boundary(realpathSync(stale)),
			},
			{
				nowMs: () => 40_000,
				afterStateWrite: () => writeFileSync(staleLock, replacement, "utf8"),
			},
		);
		expect(readFileSync(staleLock, "utf8")).toBe(replacement);
	});

	it("initializes fresh schema 3 state atomically with authority and an idempotent init id", () => {
		const root = initWorkspace();
		const request = initRequest(root, "init-1");

		const created = initializeWork(root, request);
		const replay = initializeWork(root, request);

		expect(created.changed).toBe(true);
		expect(created.state).toMatchObject({ schema_version: 3, revision: 1, active_work_id: "w1" });
		expect(created.state.works["w1"]).toMatchObject({
			active_plan: ".litcodex/plans/plan.md",
			plan_name: "Display plan",
			session_ids: ["codex:s1"],
			status: "active",
			authority: {
				authority_id: "approval-1",
				allowed_actions: ["start-work"],
				forbidden_actions: ["publish"],
			},
		});
		expect(created.event.kind).toBe("start_work_initialized");
		expect(replay.changed).toBe(false);
		expect(ledger(root).filter((entry) => entry["transitionId"] === "init-1")).toHaveLength(1);
		expect(() => initializeWork(root, { ...request, planName: "Different" })).toThrow(/init/i);
		expect(() => initializeWork(root, { ...request, initId: "init-2" })).toThrow(/nonterminal|active/i);
	});

	it("requires explicit workId and rejects X/Y/X transition-id reuse with conflicting canonical payload", () => {
		const root = workspace("active", 0);
		transitionWork(root, transition("pause", 0, "X", "authorization_required"));
		transitionWork(root, transition("resume", 1, "Y", "explicit_user_resume"));
		const before = readFileSync(statePathFor(root), "utf8");

		expect(() => transitionWork(root, transition("cancel", 2, "X", "user_cancelled"))).toThrow(/transition id/i);
		expect(readFileSync(statePathFor(root), "utf8")).toBe(before);

		appendFileSync(
			join(root, ".litcodex", "lit-loop", "ledger.jsonl"),
			`${JSON.stringify({ ...ledger(root)[0], kind: "start_work_cancelled" })}\n`,
			"utf8",
		);
		expect(() => transitionWork(root, transition("pause", 0, "X", "authorization_required"))).toThrow(
			/conflicting.*ledger|ledger.*conflict/i,
		);
	});

	it("sets active_work_id null for terminal work while exact terminal replay stays idempotent", () => {
		const root = workspace("active", 0);
		const request = transition("cancel", 0, "terminal", "user_cancelled");
		const first = transitionWork(root, request);
		const replay = transitionWork(root, request);
		expect(first.state.active_work_id).toBeNull();
		expect(first.state.works["w1"]?.status).toBe("abandoned");
		expect(replay.changed).toBe(false);
	});

	it("rejects malformed fresh-plan shapes before creating lifecycle state", () => {
		for (const [label, plan] of [
			["no rows", "## Todos\nDescribe work in prose.\n\n## Final verification wave\nNone.\n"],
			["incidental", "# Notes\n- [ ] 1. Incidental checkbox\n"],
			["final only", "## Final verification wave\n- [ ] F1. Final-only row\n"],
			["todos only", "## Todos\n- [ ] 1. Missing final wave\n"],
			["placeholders", "## Todos\n- [ ] N. <title>\n\n## Final verification wave\n- [ ] F1. <verification title>\n"],
			[
				"final placeholder",
				"## Todos\n- [ ] 1. Implement\n\n## Final verification wave\n- [ ] F1. <verification title>\n",
			],
			["whitespace label", "## Todos\n- [ ]    \n\n## Final verification wave\n- [ ] F1. Verify\n"],
			[
				"mixed final placeholder",
				"## Todos\n- [ ] 1. Implement\n\n## Final verification wave\n- [ ] F1. <verification title>\n- [ ] F2. Verify\n",
			],
			[
				"mixed N placeholder",
				"## Todos\n- [ ] N. <title>\n- [ ] 1. Implement\n\n## Final verification wave\n- [ ] F1. Verify\n",
			],
			[
				"mixed numbered placeholder",
				"## Todos\n- [ ] 1. Implement\n- [ ] 2. <title>\n\n## Final verification wave\n- [ ] F1. Verify\n",
			],
		] as const) {
			const root = initWorkspace(plan);
			let failure: unknown;
			try {
				initializeWork(root, initRequest(root, `invalid-${label}`));
			} catch (error) {
				failure = error;
			}
			expect(failure, label).toMatchObject({ code: "PLAN_EMPTY" });
			expect(existsSync(statePathFor(root)), label).toBe(false);
			expect(existsSync(join(root, ".litcodex", "lit-loop", "ledger.jsonl")), label).toBe(false);
		}
	});

	it("rejects complete while recognized work remains", () => {
		const incomplete = workspace("active", 0);
		expect(() => transitionWork(incomplete, transition("complete", 0, "too-early", "completed"))).toThrow(
			/zero remaining|incomplete/i,
		);
		expect(readLifecycleState(incomplete)?.works["w1"]?.status).toBe("active");
	});

	it("preserves unknown schema-2 root, work, and sibling fields while normalizing a proven in-repo absolute plan", () => {
		const root = workspace("paused", undefined, 2);
		const statePath = statePathFor(root);
		const raw = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
		const works = raw["works"] as Record<string, Record<string, unknown>>;
		raw["unknown_root"] = { keep: true };
		works["w1"] = {
			...works["w1"],
			active_plan: join(root, ".litcodex", "plans", "plan.md"),
			started_at: "2026-07-01T00:00:00.000Z",
			unknown_work: { keep: "yes" },
		};
		works["sibling"] = {
			work_id: "sibling",
			active_plan: ".litcodex/plans/plan.md",
			plan_name: "sibling",
			session_ids: ["codex:other"],
			status: "completed",
			worktree_path: null,
			unknown_sibling: 42,
		};
		writeFileSync(statePath, JSON.stringify(raw), "utf8");

		transitionWork(root, transition("resume", 0, "migrate", "explicit_user_resume"));
		const migrated = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
		const migratedWorks = migrated["works"] as Record<string, Record<string, unknown>>;
		expect(migrated["unknown_root"]).toEqual({ keep: true });
		expect(migratedWorks["w1"]?.["started_at"]).toBe("2026-07-01T00:00:00.000Z");
		expect(migratedWorks["w1"]?.["unknown_work"]).toEqual({ keep: "yes" });
		expect(migratedWorks["w1"]?.["active_plan"]).toBe(".litcodex/plans/plan.md");
		expect(migratedWorks["sibling"]?.["unknown_sibling"]).toBe(42);
	});

	it("fails schema-2 migration closed for an absolute plan outside the canonical plans root", () => {
		const root = workspace("paused", undefined, 2);
		const statePath = statePathFor(root);
		const raw = JSON.parse(readFileSync(statePath, "utf8")) as { works: { w1: Record<string, unknown> } };
		raw.works.w1["active_plan"] = join(root, "outside.md");
		writeFileSync(join(root, "outside.md"), "## Todos\n- [ ] Outside\n", "utf8");
		writeFileSync(statePath, JSON.stringify(raw), "utf8");
		const before = readFileSync(statePath, "utf8");
		expect(() => transitionWork(root, transition("resume", 0, "outside", "explicit_user_resume"))).toThrow(/plan/i);
		expect(readFileSync(statePath, "utf8")).toBe(before);
	});

	it("rejects symlinked managed ancestors and state, ledger, and plan leaves", () => {
		const parent = mkdtempSync(join(tmpdir(), "start-work-managed-parent-"));
		roots.push(parent);
		const outside = join(parent, "outside");
		mkdirSync(join(outside, "plans"), { recursive: true });
		writeFileSync(join(outside, "plans", "plan.md"), "## Todos\n- [ ] Task\n", "utf8");
		const linkedRoot = join(parent, "linked-root");
		mkdirSync(linkedRoot);
		symlinkSync(outside, join(linkedRoot, ".litcodex"));
		expect(() => initializeWork(linkedRoot, initRequest(linkedRoot, "parent-link"))).toThrow(/symbolic link/i);

		for (const leaf of ["state", "ledger", "plan"] as const) {
			const root = leaf === "state" || leaf === "ledger" ? workspace("active", 0) : initWorkspace();
			const target = join(root, `outside-${leaf}`);
			writeFileSync(target, leaf === "plan" ? "## Todos\n- [ ] Task\n" : "{}\n", "utf8");
			const path =
				leaf === "state"
					? statePathFor(root)
					: leaf === "ledger"
						? join(root, ".litcodex", "lit-loop", "ledger.jsonl")
						: join(root, ".litcodex", "plans", "plan.md");
			rmSync(path, { force: true });
			mkdirSync(dirname(path), { recursive: true });
			symlinkSync(target, path);
			const action =
				leaf === "plan"
					? () => initializeWork(root, initRequest(root, "leaf-link"))
					: () => transitionWork(root, transition("pause", 0, `leaf-${leaf}`, "authorization_required"));
			expect(action).toThrow(/symbolic link|managed path/i);
		}
	});

	it("rejects symlinked plans, start-work, and lit-loop parent directories", () => {
		for (const label of ["plans", "start-work", "lit-loop"] as const) {
			const root = mkdtempSync(join(tmpdir(), `start-work-parent-${label}-`));
			roots.push(root);
			const litcodex = join(root, ".litcodex");
			const outside = join(root, `outside-${label}`);
			mkdirSync(litcodex);
			mkdirSync(outside);
			if (label !== "plans") {
				mkdirSync(join(litcodex, "plans"));
				writeFileSync(join(litcodex, "plans", "plan.md"), "## Todos\n- [ ] Task\n", "utf8");
			} else {
				writeFileSync(join(outside, "plan.md"), "## Todos\n- [ ] Task\n", "utf8");
			}
			symlinkSync(outside, join(litcodex, label));
			expect(() => initializeWork(root, initRequest(root, `parent-${label}`))).toThrow(/symbolic link/i);
		}
	});

	it("recovers only stale empty or truncated locks by mtime and keeps fresh or future malformed locks busy", () => {
		for (const [body, id] of [
			["", "empty"],
			["{partial", "partial"],
		] as const) {
			const root = workspace("active", 0);
			const lock = `${statePathFor(root)}.lock`;
			writeFileSync(lock, body, "utf8");
			utimesSync(lock, 1, 1);
			expect(
				transitionWork(root, transition("pause", 0, id, "authorization_required"), { nowMs: () => 40_000 }).changed,
			).toBe(true);
		}

		for (const [mtime, id] of [
			[39, "fresh"],
			[50, "future"],
		] as const) {
			const root = workspace("active", 0);
			const lock = `${statePathFor(root)}.lock`;
			writeFileSync(lock, "{bad", "utf8");
			utimesSync(lock, mtime, mtime);
			expect(() =>
				transitionWork(root, transition("pause", 0, id, "authorization_required"), { nowMs: () => 40_000 }),
			).toThrow(/lock is busy/i);
		}
	});

	it("holds lock inode ownership and never removes a replacement path", () => {
		const root = workspace("active", 0);
		const lock = `${statePathFor(root)}.lock`;
		const displaced = `${lock}.old`;
		const replacement = JSON.stringify({ token: "replacement", createdAt: 40_000 });
		transitionWork(root, transition("pause", 0, "replace", "authorization_required"), {
			afterStateWrite: () => {
				renameSync(lock, displaced);
				writeFileSync(lock, replacement, "utf8");
			},
		});
		expect(readFileSync(lock, "utf8")).toBe(replacement);
	});

	it("preserves unterminated malformed ledger bytes and appends a parseable recovered event with fsync", () => {
		const root = workspace("active", 0);
		expect(() =>
			transitionWork(root, transition("pause", 0, "recover-line", "authorization_required"), {
				afterStateWrite: () => {
					throw new Error("interrupt");
				},
			}),
		).toThrow("interrupt");
		const path = join(root, ".litcodex", "lit-loop", "ledger.jsonl");
		mkdirSync(join(root, ".litcodex", "lit-loop"), { recursive: true });
		writeFileSync(path, "{unterminated", "utf8");

		reconcileLifecycleState(root);

		const raw = readFileSync(path, "utf8");
		expect(raw.startsWith("{unterminated\n")).toBe(true);
		expect(raw.trimEnd().split(/\r?\n/).at(-1)).toContain('"transitionId":"recover-line"');
	});

	it("reads only a bounded FD ledger tail even when the ledger exceeds two megabytes", () => {
		const root = workspace("active", 0);
		const path = join(root, ".litcodex", "lit-loop", "ledger.jsonl");
		mkdirSync(join(root, ".litcodex", "lit-loop"), { recursive: true });
		writeFileSync(path, `${"x".repeat(2_200_000)}\n`, "utf8");
		const reads: number[] = [];
		transitionWork(root, transition("pause", 0, "tail", "authorization_required"), {
			onLedgerRead: (bytes) => reads.push(bytes),
		});
		expect(reads.length).toBeGreaterThan(0);
		expect(Math.max(...reads)).toBeLessThanOrEqual(2_000_000);
	});
});

function workspace(status: "active" | "paused", revision = 0, schema = 3): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-lifecycle-"));
	requestRoot = realpathSync(root);
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(join(root, ".litcodex", "plans", "plan.md"), "## Todos\n- [ ] Task\n", "utf8");
	const work = {
		work_id: "w1",
		active_plan: ".litcodex/plans/plan.md",
		plan_name: "plan",
		session_ids: ["codex:s1"],
		status,
		worktree_path: requestRoot,
		...(schema === 3
			? {
					authority: storedAuthority(requestRoot),
					...(status === "paused" ? { pending_boundary: boundary(requestRoot) } : {}),
				}
			: {}),
	};
	const fixtureEvent =
		revision > 0
			? {
					kind: status === "paused" ? "start_work_paused" : "start_work_resumed",
					at: "2026-07-01T00:00:00.000Z",
					workId: "w1",
					transitionId: "fixture-revision",
					revision,
					fromWorkStatus: status === "paused" ? "active" : "paused",
					toWorkStatus: status,
					plan: ".litcodex/plans/plan.md",
					sessionId: "codex:s1",
					...(status === "paused"
						? { reasonCode: "authorization_required", boundary: boundary(requestRoot) }
						: {
								reasonCode: "explicit_user_resume",
								boundary: boundary(requestRoot),
								grant: grant(requestRoot),
							}),
				}
			: undefined;
	const state =
		schema === 2
			? { schema_version: 2, active_work_id: "w1", works: { w1: work } }
			: {
					schema_version: 3,
					revision,
					active_work_id: "w1",
					works: { w1: work },
					...(fixtureEvent === undefined
						? { history_floor_revision: 0 }
						: {
								transition_history: { "fixture-revision": fixtureEvent },
								history_floor_revision: revision,
							}),
				};
	writeFileSync(join(root, ".litcodex", "start-work", "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return root;
}

function ledger(root: string): Array<Record<string, unknown>> {
	try {
		return readFileSync(join(root, ".litcodex", "lit-loop", "ledger.jsonl"), "utf8")
			.split(/\r?\n/)
			.flatMap((line) => {
				try {
					const parsed: unknown = JSON.parse(line);
					return typeof parsed === "object" && parsed !== null ? [parsed as Record<string, unknown>] : [];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

function initWorkspace(plan = "## Todos\n- [ ] 1. Task\n\n## Final verification wave\n- [ ] F1. Verify\n"): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-init-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	writeFileSync(join(root, ".litcodex", "plans", "plan.md"), plan, "utf8");
	return root;
}

function initRequest(root: string, initId: string) {
	return {
		initId,
		expectedRevision: 0,
		workId: "w1",
		plan: ".litcodex/plans/plan.md",
		planName: "Display plan",
		sessionId: "s1",
		worktreePath: root,
		authority: {
			authorityId: "approval-1",
			allowedRoots: [root],
			allowedActions: ["start-work"],
			forbiddenActions: ["publish"],
		},
	};
}

function transition(
	action: "pause" | "resume" | "cancel" | "complete",
	expectedRevision: number,
	transitionId: string,
	reasonCode:
		| "authorization_required"
		| "credential_required"
		| "host_capability_required"
		| "explicit_user_resume"
		| "user_cancelled"
		| "completed",
) {
	return {
		action,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId: "w1",
		reasonCode,
		...(action === "pause" ? { boundary: boundary(requestRoot) } : {}),
		...(action === "resume" ? { boundary: boundary(requestRoot), grant: grant(requestRoot) } : {}),
		authority: inputAuthority(requestRoot),
	};
}

function storedAuthority(root: string) {
	return {
		authority_id: "authority-1",
		allowed_roots: [root],
		allowed_actions: ["edit"],
		forbidden_actions: ["publish"],
	};
}

function inputAuthority(root: string) {
	return {
		authorityId: "authority-1",
		allowedRoots: [root],
		allowedActions: ["edit"],
		forbiddenActions: ["publish"],
	};
}

function boundary(root: string) {
	return { boundary_id: "boundary-1", authority_id: "authority-1", action: "deploy", root };
}

function grant(root: string) {
	return {
		grant_id: "grant-1",
		authority_id: "authority-1",
		boundary_id: "boundary-1",
		action: "deploy",
		root,
	};
}
