import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "../src/codex-hook.js";
import {
	advanceStopLease,
	initializeWork,
	inspectLifecycleState,
	readLifecycleState,
	statePathFor,
	transitionWork,
} from "../src/lifecycle-store.js";
import { diagnoseLifecycle, readContinuationState } from "../src/work-state-reader.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("second-review lifecycle invariants", () => {
	it("binds a prompt resume event to the exact host session and turn", () => {
		const root = initializedRoot();
		const pending = boundary(root, "approval-boundary");
		transitionWork(root, pause(1, "pause", pending));

		runUserPromptSubmitHook(
			prompt(root, "resume-turn-7", "start-work plan --resume approval-boundary --grant approval"),
		);

		const event = readLifecycleState(root)?.works["w1"]?.last_transition;
		const expected = digest(["w1", "approval-boundary", "approval", "s1", "resume-turn-7"].join("\0"));
		expect(event).toMatchObject({
			kind: "start_work_resumed",
			turnId: "resume-turn-7",
			transitionId: `prompt-resume:${expected}`,
		});
	});

	it("orders numeric-like transition ids by revision rather than object enumeration", () => {
		const root = rootWithPlan("## Todos\n- [x] 1. Done\n\n## Final verification wave\n- [x] F1. Verified\n");
		initializeWork(root, init(root, "9", "w1", 0));
		transitionWork(root, complete("w1", 1, "1"));

		expect(diagnoseLifecycle(root)).toMatchObject({ ok: true, revision: 2 });
	});

	it("requires an own live worktree for nonterminal schema 3 but retains a removed terminal worktree", () => {
		const root = rootWithPlan("## Todos\n- [x] 1. Done\n\n## Final verification wave\n- [x] F1. Verified\n");
		const worktree = join(root, "worktree-one");
		mkdirSync(worktree);
		initializeWork(root, { ...init(root, "init-1", "w1", 0), worktreePath: worktree });
		transitionWork(root, complete("w1", 1, "complete-1"));
		rmSync(worktree, { recursive: true });

		expect(diagnoseLifecycle(root)).toMatchObject({ ok: true, activeWorkId: null });
		const nextWorktree = join(root, "worktree-two");
		mkdirSync(nextWorktree);
		expect(
			initializeWork(root, { ...init(root, "init-2", "w2", 2), worktreePath: nextWorktree }).state.active_work_id,
		).toBe("w2");

		const missing = rootWithPlan();
		writeState(missing, {
			schema_version: 3,
			revision: 0,
			history_floor_revision: 0,
			active_work_id: "w1",
			works: { w1: activeWork(missing, { worktree_path: undefined }) },
		});
		expect(inspectLifecycleState(missing)).toMatchObject({ ok: false, code: "WORKTREE_INVALID" });
	});

	it("rejects malformed paused state and ambiguous schema-2 migration without mutation", () => {
		for (const malformed of [
			{},
			{
				pending_boundary: boundaryPlaceholder("pending"),
				last_transition: lifecycleEvent("start_work_paused", "pause", 1),
			},
		]) {
			const root = rootWithPlan();
			writeState(root, {
				schema_version: 3,
				revision: Object.keys(malformed).length === 0 ? 0 : 1,
				history_floor_revision: Object.keys(malformed).length === 0 ? 0 : 1,
				active_work_id: "w1",
				works: { w1: { ...activeWork(root), status: "paused", ...malformed } },
				...(Object.keys(malformed).length === 0
					? {}
					: { transition_history: { pause: lifecycleEvent("start_work_paused", "pause", 1) } }),
			});
			expect(inspectLifecycleState(root).ok).toBe(false);
		}

		const legacy = rootWithPlan();
		writeState(legacy, {
			schema_version: 2,
			active_work_id: "w1",
			works: {
				w1: legacyWork("w1", "s1"),
				w2: legacyWork("w2", "s2"),
			},
		});
		const before = readFileSync(statePathFor(legacy), "utf8");
		expect(() =>
			transitionWork(legacy, {
				...pause(0, "legacy-pause", boundary(legacy, "legacy-boundary")),
				authority: inputAuthority(legacy),
			}),
		).toThrow(/exactly one nonterminal|active_work_id/i);
		expect(readFileSync(statePathFor(legacy), "utf8")).toBe(before);
	});

	it("fails a stale stop lease closed when a later work has the same progress token", () => {
		const root = initializedRoot();
		const observed = readContinuationState(root, "s1");
		expect(observed).not.toBeNull();
		transitionWork(root, cancel("w1", 1, "cancel-w1"));
		initializeWork(root, init(root, "init-w2", "w2", 2));

		const result = advanceStopLease(root, {
			sessionId: "s1",
			turnId: "stale-turn",
			progressToken: observed?.progressToken ?? "",
			workId: observed?.workId ?? "",
			expectedRevision: observed?.revision ?? -1,
		});

		expect(result.outcome).toBe("silent");
		expect(readLifecycleState(root)?.revision).toBe(3);
		expect(readLifecycleState(root)?.works["w2"]?.continuation_lease).toBeUndefined();
	});

	it("consumes a granted boundary once and scopes a distinct external authority extension", () => {
		const root = initializedRoot();
		const first = boundary(root, "first-boundary");
		transitionWork(root, pause(1, "pause-first", first));
		runUserPromptSubmitHook(
			prompt(root, "grant-turn-1", "start-work plan --resume first-boundary --grant grant-first"),
		);
		const afterResume = readLifecycleState(root);
		const repeated = transitionWork(root, pause(afterResume?.revision ?? -1, "pause-first-again", first));
		expect(repeated.changed).toBe(false);
		expect(repeated.state.works["w1"]?.status).toBe("active");

		const external = mkdtempSync(join(tmpdir(), "start-work-external-authority-"));
		roots.push(external);
		const distinct = {
			boundary_id: "external-boundary",
			authority_id: "authority-1",
			action: "deploy",
			root: realpathSync(external),
		};
		transitionWork(root, pause(repeated.state.revision, "pause-external", distinct));
		runUserPromptSubmitHook(
			prompt(root, "grant-turn-2", "start-work plan --resume external-boundary --grant grant-external"),
		);
		const continuation = readContinuationState(root, "s1");
		expect(continuation?.authorityGrants).toContainEqual(
			expect.objectContaining({ boundary_id: "external-boundary", action: "deploy", root: realpathSync(external) }),
		);
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("active");

		expect(() =>
			transitionWork(root, {
				...pause(readLifecycleState(root)?.revision ?? -1, "pause-forbidden", {
					...distinct,
					boundary_id: "forbidden-boundary",
					action: "publish",
				}),
			}),
		).toThrow(/forbidden|authority|boundary/i);
	});

	it("compacts terminal works with pruned history and expires replay while allowing later init", () => {
		const root = rootWithPlan("## Todos\n- [x] 1. Done\n\n## Final verification wave\n- [x] F1. Verified\n");
		let revision = 0;
		for (let index = 0; index < 90; index += 1) {
			initializeWork(root, init(root, `i-${index * 2 + 9}`, `w${index}`, revision));
			revision += 1;
			transitionWork(root, complete(`w${index}`, revision, `c-${index * 2 + 1}`));
			revision += 1;
		}
		const state = readLifecycleState(root);
		expect(Object.keys(state?.works ?? {}).length).toBeLessThanOrEqual(33);
		expect(Buffer.byteLength(readFileSync(statePathFor(root), "utf8"))).toBeLessThan(150_000);
		expect(() => initializeWork(root, init(root, "i-9", "w0", 0))).toThrow(/replay expired/i);
		const later = initializeWork(root, init(root, "later-init", "later-work", revision));
		expect(later.state.active_work_id).toBe("later-work");
	}, 15_000);
});

function rootWithPlan(plan = "## Todos\n- [ ] 1. Task\n\n## Final verification wave\n- [ ] F1. Verify\n"): string {
	const root = mkdtempSync(join(tmpdir(), "start-work-second-review-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	writeFileSync(join(root, ".litcodex", "plans", "plan.md"), plan, "utf8");
	return root;
}

function initializedRoot(): string {
	const root = rootWithPlan();
	initializeWork(root, init(root, "init-1", "w1", 0));
	return root;
}

function init(root: string, initId: string, workId: string, expectedRevision: number) {
	return {
		initId,
		expectedRevision,
		workId,
		plan: ".litcodex/plans/plan.md",
		planName: "plan",
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

function activeWork(root: string, extra: Record<string, unknown> = {}) {
	const base: Record<string, unknown> = {
		work_id: "w1",
		active_plan: ".litcodex/plans/plan.md",
		plan_name: "plan",
		session_ids: ["codex:s1"],
		status: "active",
		worktree_path: realpathSync(root),
		authority: storedAuthority(root),
	};
	for (const [key, value] of Object.entries(extra)) {
		if (value === undefined) delete base[key];
		else base[key] = value;
	}
	return base;
}

function legacyWork(workId: string, sessionId: string) {
	return {
		work_id: workId,
		active_plan: ".litcodex/plans/plan.md",
		plan_name: workId,
		session_ids: [`codex:${sessionId}`],
		status: "active",
		worktree_path: null,
	};
}

function boundary(root: string, boundaryId: string) {
	return {
		boundary_id: boundaryId,
		authority_id: "authority-1",
		action: "deploy",
		root: realpathSync(root),
	};
}

function boundaryPlaceholder(boundaryId: string) {
	return { boundary_id: boundaryId, authority_id: "authority-1", action: "deploy", root: "/tmp" };
}

function pause(expectedRevision: number, transitionId: string, authorityBoundary: ReturnType<typeof boundary>) {
	return {
		action: "pause" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId: "w1",
		reasonCode: "authorization_required" as const,
		boundary: authorityBoundary,
	};
}

function cancel(workId: string, expectedRevision: number, transitionId: string) {
	return {
		action: "cancel" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId,
		reasonCode: "user_cancelled" as const,
	};
}

function complete(workId: string, expectedRevision: number, transitionId: string) {
	return {
		action: "complete" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId,
		reasonCode: "completed" as const,
	};
}

function prompt(root: string, turnId: string, value: string) {
	return {
		hook_event_name: "UserPromptSubmit",
		session_id: "s1",
		turn_id: turnId,
		transcript_path: null,
		cwd: root,
		prompt: value,
	};
}

function lifecycleEvent(kind: string, transitionId: string, revision: number) {
	return {
		kind,
		at: `2026-07-22T00:00:${String(revision).padStart(2, "0")}.000Z`,
		workId: "w1",
		transitionId,
		revision,
		toWorkStatus: "active",
		plan: ".litcodex/plans/plan.md",
		sessionId: "codex:s1",
	};
}

function writeState(root: string, state: unknown): void {
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(statePathFor(root), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
