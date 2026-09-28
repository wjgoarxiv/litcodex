import { inspectLifecycleState, ledgerPathFor, resolveCanonicalPlan, selectWorkForSession, statePathFor, } from "./lifecycle-store.js";
import { analyzePlanProgress } from "./plan-progress.js";
export function parsePlanChecklist(markdown) {
    const { remaining, total, nextTaskLabel } = analyzePlanProgress(markdown);
    return { remaining, total, nextTaskLabel };
}
export function readContinuationState(cwd, sessionId, _fs) {
    const inspected = inspectLifecycleState(cwd);
    if (!inspected.ok)
        return null;
    const work = selectWorkForSession(inspected.state, sessionId, ["active"]);
    if (work === null)
        return null;
    let plan;
    try {
        plan = resolveCanonicalPlan(cwd, work.active_plan, inspected.sourceSchema === 2);
    }
    catch (error) {
        if (error instanceof Error)
            return null;
        throw error;
    }
    const checklist = parsePlanChecklist(plan.text);
    if (checklist.total === 0 || checklist.remaining === 0)
        return null;
    if (work.authority === undefined)
        return null;
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
        pendingBoundary: work.pending_boundary ?? null,
        checklist,
    };
}
export function diagnoseLifecycle(cwd) {
    const inspected = inspectLifecycleState(cwd);
    if (!inspected.ok)
        return inspected;
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
        active: inspected.state.active_work_id === null
            ? null
            : {
                workId: inspected.state.active_work_id,
                status: inspected.state.works[inspected.state.active_work_id]?.status ?? "invalid",
            },
        pendingBoundary: inspected.state.active_work_id === null
            ? null
            : (inspected.state.works[inspected.state.active_work_id]?.pending_boundary ?? null),
    };
}
