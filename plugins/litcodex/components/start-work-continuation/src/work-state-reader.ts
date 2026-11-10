import type { AuthorityBoundary, AuthorityEnvelope, AuthorityGrant, CanonicalPlan } from "./lifecycle-store.js";
import {
	inspectLifecycleState,
	ledgerPathFor,
	resolveCanonicalPlan,
	selectWorkForSession,
	statePathFor,
} from "./lifecycle-store.js";
import { analyzePlanProgress } from "./plan-progress.js";
import type { ReadonlyFileSystem } from "./types.js";

export type PlanChecklist = {
	readonly remaining: number;
	readonly total: number;
	readonly nextTaskLabel: string | null;
};

export type ContinuationState = {
	readonly workId: string;
	readonly revision: number;
	readonly planName: string;
	readonly planPath: string;
	readonly progressToken: string;
	readonly workStatePath: string;
	readonly ledgerPath: string;
	readonly worktreePath: string | null;
	readonly authority: AuthorityEnvelope;
	readonly authorityGrants: readonly AuthorityGrant[];
	/** Steps waiting on the user's optional `lit approve`; the run keeps going meanwhile. */
	readonly parkedBoundaries: readonly ParkedStep[];
	/** Steps the user refused with `lit deny` for the rest of this run. */
	readonly deniedBoundaries: readonly DeniedStep[];
	readonly checklist: PlanChecklist;
};

export type ParkedStep = { readonly id: string; readonly action: string; readonly root: string };
export type DeniedStep = { readonly action: string; readonly root: string };

export function parsePlanChecklist(markdown: string): PlanChecklist {
	const { remaining, total, nextTaskLabel } = analyzePlanProgress(markdown);
	return { remaining, total, nextTaskLabel };
}

export function readContinuationState(
	cwd: string,
	sessionId: string,
	_fs?: ReadonlyFileSystem,
): ContinuationState | null {
	const inspected = inspectLifecycleState(cwd);
	if (!inspected.ok) return null;
	const work = selectWorkForSession(inspected.state, sessionId, ["active"]);
	if (work === null) return null;
	let plan: CanonicalPlan;
	try {
		plan = resolveCanonicalPlan(cwd, work.active_plan, inspected.sourceSchema === 2);
	} catch (error) {
		if (error instanceof Error) return null;
		throw error;
	}
	const checklist = parsePlanChecklist(plan.text);
	if (checklist.total === 0 || checklist.remaining === 0) return null;
	if (work.authority === undefined) return null;
	return {
		workId: work.work_id,
		revision: inspected.state.revision,
		planName: work.plan_name,
		planPath: plan.absolutePath,
		progressToken: plan.progress.progressToken,
		workStatePath: statePathFor(cwd),
		ledgerPath: ledgerPathFor(cwd),
		worktreePath: work.worktree_path,
		authority: work.authority,
		authorityGrants: work.authority_grants ?? [],
		parkedBoundaries: (work.parked_boundaries ?? []).map((entry) => ({
			id: entry.boundary_id,
			action: entry.action,
			root: entry.root,
		})),
		deniedBoundaries: (work.denied_boundaries ?? []).map((entry) => ({ action: entry.action, root: entry.root })),
		checklist,
	};
}

export type LifecycleDiagnostic =
	| {
			readonly ok: true;
			readonly schemaVersion: 2 | 3;
			readonly revision: number;
			readonly activeWorkId: string | null;
			readonly state: "valid";
			readonly history: { readonly retained: number; readonly floorRevision: number };
			readonly active: { readonly workId: string; readonly status: string } | null;
			readonly parkedBoundaries: readonly AuthorityBoundary[];
	  }
	| { readonly ok: false; readonly code: string; readonly message: string };

export function diagnoseLifecycle(cwd: string): LifecycleDiagnostic {
	const inspected = inspectLifecycleState(cwd);
	if (!inspected.ok) return inspected;
	return {
		ok: true,
		schemaVersion: inspected.sourceSchema,
		revision: inspected.state.revision,
		activeWorkId: inspected.state.active_work_id,
		state: "valid",
		history: {
			retained: Object.keys(inspected.state.transition_history ?? {}).length,
			floorRevision: inspected.state.history_floor_revision ?? 0,
		},
		active:
			inspected.state.active_work_id === null
				? null
				: {
						workId: inspected.state.active_work_id,
						status: inspected.state.works[inspected.state.active_work_id]?.status ?? "invalid",
					},
		parkedBoundaries:
			inspected.state.active_work_id === null
				? []
				: (inspected.state.works[inspected.state.active_work_id]?.parked_boundaries ?? []).map((entry) => ({
						boundary_id: entry.boundary_id,
						authority_id: entry.authority_id,
						action: entry.action,
						root: entry.root,
					})),
	};
}
