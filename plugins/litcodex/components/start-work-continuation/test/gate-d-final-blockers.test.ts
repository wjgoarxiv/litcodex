import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	initializeWork,
	inspectLifecycleState,
	readLifecycleState,
	statePathFor,
	transitionWork,
} from "../src/lifecycle-store.js";
import { diagnoseLifecycle } from "../src/work-state-reader.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Gate D null worktree contract", () => {
	it("keeps schema-3 active and paused null worktrees readable as canonical cwd", () => {
		const root = workspace();
		const initialized = initializeWork(root, init(root, null));

		expect(Object.hasOwn(initialized.state.works["w1"] ?? {}, "worktree_path")).toBe(true);
		expect(initialized.state.works["w1"]?.worktree_path).toBeNull();
		expect(inspectLifecycleState(root)).toMatchObject({ ok: true });
		expect(diagnoseLifecycle(root)).toMatchObject({ ok: true, active: { status: "active" } });

		const external = externalRoot("null-paused");
		transitionWork(root, pause(1, "pause-null", boundary(external, "pause-null", "deploy")));
		expect(inspectLifecycleState(root)).toMatchObject({ ok: true });
		expect(diagnoseLifecycle(root)).toMatchObject({ ok: true, active: { status: "paused" } });
		expect(readLifecycleState(root)?.works["w1"]?.worktree_path).toBeNull();
	});

	it("migrates a schema-2 null worktree to readable schema 3 without an invalid intermediate write", () => {
		const root = workspace();
		writeFileSync(
			statePathFor(root),
			`${JSON.stringify({
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
			})}\n`,
			"utf8",
		);
		const external = externalRoot("null-migration");

		const migrated = transitionWork(root, {
			...pause(0, "migrate-null", boundary(external, "migrate-null", "deploy")),
			authority: inputAuthority(root),
		});

		expect(migrated.state).toMatchObject({ schema_version: 3, revision: 1 });
		expect(migrated.state.works["w1"]?.worktree_path).toBeNull();
		expect(inspectLifecycleState(root)).toMatchObject({ ok: true, sourceSchema: 3 });
		expect(readLifecycleState(root)?.works["w1"]?.status).toBe("paused");
	});
});

describe("Gate D effective boundary authorization", () => {
	it("returns the canonical prior result without mutation when base authority already covers action and root", () => {
		const root = workspace();
		initializeWork(root, init(root, root));

		const result = transitionWork(root, pause(1, "redundant-base", boundary(root, "renamed-base", "edit")));

		expect(result).toMatchObject({
			changed: false,
			state: { revision: 1, works: { w1: { status: "active" } } },
			event: { kind: "start_work_initialized", transitionId: "init-1" },
		});
	});

	it("treats a relabeled boundary inside a persisted grant as already authorized", () => {
		const root = workspace();
		initializeWork(root, init(root, root));
		const external = externalRoot("granted-root");
		const child = join(external, "child");
		mkdirSync(child);
		const requested = boundary(external, "external-deploy", "deploy");
		transitionWork(root, pause(1, "pause-external", requested));
		transitionWork(root, resume(2, "resume-external", requested, "grant-external"));

		const result = transitionWork(
			root,
			pause(3, "relabeled-pause", boundary(child, "different-boundary-id", "deploy")),
		);

		expect(result).toMatchObject({
			changed: false,
			state: { revision: 3, works: { w1: { status: "active" } } },
			event: { kind: "start_work_resumed", transitionId: "resume-external" },
		});
	});

	it("keeps persisted grant authorization after its resume event is compacted", () => {
		const root = workspace();
		initializeWork(root, init(root, root));
		const firstRoot = externalRoot("oldest-grant");
		const firstBoundary = boundary(firstRoot, "oldest-boundary", "deploy-0");
		transitionWork(root, pause(1, "pause-0", firstBoundary));
		transitionWork(root, resume(2, "resume-0", firstBoundary, "grant-0"));
		let revision = 3;
		for (let index = 1; index <= 32; index += 1) {
			const requested = boundary(externalRoot(`grant-${index}`), `boundary-${index}`, `deploy-${index}`);
			transitionWork(root, pause(revision, `pause-${index}`, requested));
			revision += 1;
			transitionWork(root, resume(revision, `resume-${index}`, requested, `grant-${index}`));
			revision += 1;
		}
		const before = readLifecycleState(root);
		expect(before?.history_floor_revision).toBeGreaterThan(0);
		expect(before?.transition_history?.["resume-0"]).toBeUndefined();
		expect(before?.works["w1"]?.authority_grants).toContainEqual(expect.objectContaining({ grant_id: "grant-0" }));

		const result = transitionWork(
			root,
			pause(revision, "relabeled-after-compaction", boundary(firstRoot, "relabeled-oldest", "deploy-0")),
		);

		expect(result.changed).toBe(false);
		expect(result.state.revision).toBe(revision);
		expect(result.state.works["w1"]?.status).toBe("active");
	}, 15_000);

	it("pauses and accepts a grant for a distinct external action and root", () => {
		const root = workspace();
		initializeWork(root, init(root, root));
		const external = externalRoot("distinct-root");
		const requested = boundary(external, "distinct-boundary", "deploy");

		const paused = transitionWork(root, pause(1, "pause-distinct", requested));
		const resumed = transitionWork(root, resume(2, "resume-distinct", requested, "grant-distinct"));

		expect(paused).toMatchObject({ changed: true, state: { revision: 2 }, event: { kind: "start_work_paused" } });
		expect(resumed).toMatchObject({ changed: true, state: { revision: 3 }, event: { kind: "start_work_resumed" } });
		expect(resumed.state.works["w1"]?.authority_grants).toContainEqual(
			expect.objectContaining({ grant_id: "grant-distinct", action: "deploy", root: realpathSync(external) }),
		);
	});

	it("still rejects permanently forbidden actions before any pause", () => {
		const root = workspace();
		initializeWork(root, init(root, root));
		expect(() => transitionWork(root, pause(1, "pause-forbidden", boundary(root, "forbidden", "publish")))).toThrow(
			/permanently forbidden/i,
		);
		expect(readLifecycleState(root)?.revision).toBe(1);
	});
});

function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "gate-d-final-"));
	roots.push(root);
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	mkdirSync(join(root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(
		join(root, ".litcodex", "plans", "plan.md"),
		"## Todos\n- [ ] 1. Task\n\n## Final verification wave\n- [ ] F1. Verify\n",
		"utf8",
	);
	return root;
}

function externalRoot(label: string): string {
	const root = mkdtempSync(join(tmpdir(), `${label}-`));
	roots.push(root);
	return root;
}

function init(root: string, worktreePath: string | null) {
	return {
		initId: "init-1",
		expectedRevision: 0,
		workId: "w1",
		plan: ".litcodex/plans/plan.md",
		planName: "plan",
		sessionId: "s1",
		worktreePath,
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

function boundary(root: string, boundaryId: string, action: string) {
	return {
		boundary_id: boundaryId,
		authority_id: "authority-1",
		action,
		root: realpathSync(root),
	};
}

function pause(expectedRevision: number, transitionId: string, requested: ReturnType<typeof boundary>) {
	return {
		action: "pause" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId: "w1",
		reasonCode: "authorization_required" as const,
		boundary: requested,
	};
}

function resume(
	expectedRevision: number,
	transitionId: string,
	requested: ReturnType<typeof boundary>,
	grantId: string,
) {
	return {
		action: "resume" as const,
		expectedRevision,
		sessionId: "s1",
		transitionId,
		workId: "w1",
		reasonCode: "explicit_user_resume" as const,
		boundary: requested,
		grant: {
			grant_id: grantId,
			authority_id: requested.authority_id,
			boundary_id: requested.boundary_id,
			action: requested.action,
			root: requested.root,
		},
	};
}
