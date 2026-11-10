// Shared fixtures for the cancel, parked-step, protected-path and host-read tests: a throwaway project with a
// real plan, a disposable HOME and CODEX_HOME, and a start-work run created through the real store.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type AuthorityBoundary,
	initializeWork,
	readLifecycleState,
	type StoreOptions,
	statePathFor,
	transitionWork,
} from "../src/lifecycle-store.js";

export const PLAN =
	"## Todos\n- [ ] 1. First task\n- [ ] 2. Second task\n\n## Final verification wave\n- [ ] F1. Verify\n";

export interface Project {
	readonly root: string;
	readonly real: string;
	readonly home: string;
	readonly codexHome: string;
	readonly env: NodeJS.ProcessEnv;
	readonly options: StoreOptions;
}

const roots: string[] = [];

export function cleanupProjects(): void {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A temp folder holding `home/`, `home/.codex/` and `project/` with an empty plans folder. */
export function project(plan: string | null = PLAN): Project {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "start-work-autopilot-")));
	roots.push(base);
	const home = join(base, "home");
	const codexHome = join(home, ".codex");
	const root = join(base, "project");
	mkdirSync(codexHome, { recursive: true });
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	if (plan !== null) writeFileSync(join(root, ".litcodex", "plans", "plan.md"), plan, "utf8");
	const env = { HOME: home, CODEX_HOME: codexHome };
	return { root, real: realpathSync(root), home, codexHome, env, options: { env } };
}

/** Start a run for `session` through the real store; the authority covers the project for `edit` and `read`. */
export function startRun(
	p: Project,
	session = "s1",
	forbidden: readonly string[] = ["publish"],
	extraRoots: readonly string[] = [],
): void {
	initializeWork(
		p.root,
		{
			initId: `init-${session}`,
			expectedRevision: readLifecycleState(p.root)?.revision ?? 0,
			workId: "w1",
			plan: ".litcodex/plans/plan.md",
			planName: "plan",
			sessionId: session,
			worktreePath: null,
			authority: {
				authorityId: "authority-1",
				allowedRoots: [p.real, ...extraRoots],
				allowedActions: ["edit", "read"],
				forbiddenActions: forbidden,
			},
		},
		p.options,
	);
}

export function boundaryFor(
	root: string,
	action = "edit",
	id = `b-${shortHash(`${action}:${root}`)}`,
): AuthorityBoundary {
	return { boundary_id: id, authority_id: "authority-1", action, root };
}

export function pause(p: Project, target: AuthorityBoundary, session = "s1", id = `pause-${target.boundary_id}`) {
	const revision = readLifecycleState(p.root)?.revision ?? 0;
	return transitionWork(
		p.root,
		{
			action: "pause",
			expectedRevision: revision,
			sessionId: session,
			transitionId: id,
			workId: "w1",
			reasonCode: "authorization_required",
			boundary: target,
		},
		p.options,
	);
}

/** An outside folder or file the run's authority does not cover. */
export function outside(p: Project, name: string, file = false): string {
	const path = join(p.real, "..", name);
	if (file) writeFileSync(path, "x\n", "utf8");
	else mkdirSync(path, { recursive: true });
	return realpathSync(path);
}

export function stateBytes(p: Project): string {
	return readFileSync(statePathFor(p.root), "utf8");
}

export function sha(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function shortHash(text: string): string {
	return sha(text).slice(0, 10);
}

/** A schema-3 state written by an older version: one work paused at one boundary. */
export function legacyPaused(p: Project, action = "edit", target = p.real): AuthorityBoundary {
	const boundary = boundaryFor(target, action, "legacy-boundary");
	const transition = {
		kind: "start_work_paused",
		at: "2026-07-22T00:00:00.000Z",
		workId: "w1",
		transitionId: "legacy-pause",
		revision: 1,
		fromWorkStatus: "active",
		toWorkStatus: "paused",
		plan: ".litcodex/plans/plan.md",
		sessionId: "codex:s1",
		reasonCode: "authorization_required",
		boundary,
	};
	const work = {
		work_id: "w1",
		active_plan: ".litcodex/plans/plan.md",
		plan_name: "plan",
		session_ids: ["codex:s1"],
		status: "paused",
		worktree_path: p.real,
		authority: {
			authority_id: "authority-1",
			allowed_roots: [p.real],
			allowed_actions: ["edit", "read"],
			forbidden_actions: ["publish"],
		},
		pending_boundary: boundary,
		last_transition: transition,
	};
	mkdirSync(join(p.root, ".litcodex", "start-work"), { recursive: true });
	writeFileSync(
		statePathFor(p.root),
		`${JSON.stringify(
			{
				schema_version: 3,
				revision: 1,
				history_floor_revision: 1,
				active_work_id: "w1",
				works: { w1: work },
				transition_history: { "legacy-pause": transition },
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return boundary;
}

export const promptInput = (cwd: string, prompt: string, session = "s1", turn = "t1") => ({
	hook_event_name: "UserPromptSubmit",
	session_id: session,
	turn_id: turn,
	transcript_path: null,
	cwd,
	prompt,
});

export const contextOf = (out: string): string =>
	(JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
