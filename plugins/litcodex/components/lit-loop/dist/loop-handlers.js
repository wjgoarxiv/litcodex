// src/loop-handlers.ts — M09/T14 subcommand handlers (split out of loop-cli for the LOC ceiling).
//
// The five mutating/reading handlers (create/status/run/checkpoint/record-evidence) plus their
// tiny arg helpers and shared plan helpers. Each is one read→mutate→writePlan→appendLedger critical
// section under the store's withMutationLock. All fs I/O is delegated to the M08 store via flat
// `./state-store.js` (A3 C9) — this module never touches node:fs. Errors are the CLI's
// `LitLoopError` (mapped on `.code` by loop-cli's exitCodeForLoop) or re-thrown store errors.
import { buildCodexGoalCheckpoint, buildCodexGoalInstruction } from "./codex-goal-instruction.js";
import { aggregateCodexObjective, isLitLoopDone } from "./goal-status.js";
import { LitLoopError } from "./loop-errors.js";
import { buildRunInstruction, deriveGoalCandidates, normalizeGoalId, pickNextRunnableGoal, requireAllCriteriaPass, seedDefaultSuccessCriteria, summarizePlan, titleFromObjective, } from "./loop-model.js";
import { LOOP_CREATE_STDOUT } from "./loop-stdout.js";
import { redactSecrets } from "./redaction.js";
import { repoRelative } from "./state-paths.js";
import { appendLedger, readBrief, readBriefFile, readPlan, resolveLoopStateDir, withMutationLock, writeBrief, writePlan, } from "./state-store.js";
// ── tiny arg helpers (no I/O) ────────────────────────────────────────────────
export function hasFlag(argv, flag) {
    return argv.includes(flag);
}
function readValue(argv, flag) {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === flag) {
            return argv[i + 1];
        }
        if (a?.startsWith(`${flag}=`)) {
            return a.slice(flag.length + 1);
        }
    }
    return undefined;
}
function requireValue(argv, flag) {
    const v = readValue(argv, flag);
    if (v === undefined || v === "") {
        throw new LitLoopError(`Missing ${flag}.`, "LIT_LOOP_ARGUMENT_MISSING", { flag });
    }
    return v;
}
function requireNonEmpty(value, flag) {
    if (value.trim() === "") {
        throw new LitLoopError(`Missing ${flag}.`, "LIT_LOOP_ARGUMENT_MISSING", { flag });
    }
    return value;
}
function positionalText(argv) {
    return argv.filter((a) => !a.startsWith("-")).join(" ");
}
// ── create ───────────────────────────────────────────────────────────────────
async function resolveBrief(argv, repoRoot) {
    const inline = readValue(argv, "--brief");
    if (inline !== undefined && inline.trim() !== "") {
        return inline;
    }
    const briefFile = readValue(argv, "--brief-file");
    if (briefFile !== undefined && briefFile !== "") {
        try {
            return await readBriefFile(repoRoot, briefFile);
        }
        catch {
            throw new LitLoopError(`Cannot read --brief-file: ${briefFile}.`, "LIT_LOOP_BRIEF_FILE_UNREADABLE", {
                path: briefFile,
            });
        }
    }
    return positionalText(argv);
}
export async function handleCreate(argv, ctx) {
    const brief = redactSecrets(await resolveBrief(argv, ctx.repoRoot));
    if (brief.trim() === "") {
        throw new LitLoopError("Missing brief text.", "LIT_LOOP_BRIEF_REQUIRED");
    }
    const force = hasFlag(argv, "--force");
    return withMutationLock(ctx.repoRoot, ctx.scope, async () => {
        const existing = await readPlanOrNull(ctx);
        if (existing !== null && !force) {
            if (isLitLoopDone(existing)) {
                throw new LitLoopError(`Existing lit-loop plan is already complete at ${existing.goalsPath}. Start fresh with litcodex loop create --session <new-id> or use --force to overwrite intentionally.`, "LIT_LOOP_PLAN_EXISTS_COMPLETE", { goalsPath: existing.goalsPath });
            }
            const existingBrief = await readBriefOrNull(ctx);
            if (existingBrief !== brief) {
                throw new LitLoopError(`Existing lit-loop plan at ${existing.goalsPath} was created from a different brief. Start fresh with litcodex loop create --session <new-id> or use --force to overwrite intentionally.`, "LIT_LOOP_PLAN_EXISTS_DIFFERENT_BRIEF", { goalsPath: existing.goalsPath });
            }
            return planResult(existing); // idempotent no-op
        }
        const now = ctx.now();
        const candidates = deriveGoalCandidates(brief);
        const goals = candidates.map((objective, i) => ({
            id: normalizeGoalId(i, objective),
            title: titleFromObjective(objective),
            objective,
            status: "pending",
            successCriteria: seedDefaultSuccessCriteria(objective),
            attempt: 0,
            createdAt: now,
            updatedAt: now,
        }));
        const paths = planPaths(ctx);
        const plan = {
            version: 1,
            createdAt: now,
            updatedAt: now,
            ...paths,
            sessionId: ctx.scope?.sessionId ?? null,
            codexGoalMode: "aggregate",
            goals,
        };
        plan.codexObjective = aggregateCodexObjective(plan);
        await writeBrief(ctx.repoRoot, brief, ctx.scope);
        await writePlan(ctx.repoRoot, plan, ctx.scope);
        await appendLedger(ctx.repoRoot, { at: now, kind: "plan_created", message: `${goals.length} goal(s) derived from brief.` }, ctx.scope);
        return {
            exitCode: 0,
            text: LOOP_CREATE_STDOUT(goals.length, plan),
            json: { ok: true, plan, summary: summarizePlan(plan) },
        };
    });
}
// ── status ───────────────────────────────────────────────────────────────────
export async function handleStatus(ctx) {
    const plan = await readPlan(ctx.repoRoot, ctx.scope);
    const summary = summarizePlan(plan);
    const header = `lit-loop status: ${summary.total} goals (${summary.pending} pending, ${summary.in_progress} in progress, ${summary.complete} complete, ${summary.failed} failed, ${summary.blocked} blocked)`;
    const lines = plan.goals.map((g) => {
        const pass = g.successCriteria.filter((c) => c.status === "pass").length;
        return `- ${g.id} [${g.status}] ${g.title} (criteria ${pass}/${g.successCriteria.length} pass)`;
    });
    return { exitCode: 0, text: `${[header, ...lines].join("\n")}\n`, json: { ok: true, plan, summary } };
}
// ── run ──────────────────────────────────────────────────────────────────────
export async function handleRun(argv, ctx) {
    const retryFailed = hasFlag(argv, "--retry-failed");
    return withMutationLock(ctx.repoRoot, ctx.scope, async () => {
        const plan = await readPlan(ctx.repoRoot, ctx.scope);
        const pick = pickNextRunnableGoal(plan, { retryFailed });
        if (pick === null) {
            const summary = summarizePlan(plan);
            if (!isLitLoopDone(plan)) {
                return {
                    exitCode: 3,
                    text: `lit-loop stalled (LIT_LOOP_STALLED): no runnable goals; ${summary.failed} failed, ${summary.blocked} blocked. Resume with litcodex loop run --retry-failed.\n`,
                    json: { ok: false, done: false, state: "stalled", code: "LIT_LOOP_STALLED", summary, plan },
                };
            }
            return {
                exitCode: 0,
                text: "lit-loop: all goals complete\n",
                json: { ok: true, done: true, state: "done", summary, plan },
            };
        }
        const now = ctx.now();
        const goal = pick.goal;
        const fromStatus = pick.retried ? goal.status : undefined;
        if (pick.retried) {
            goal.status = "pending";
        }
        goal.status = "in_progress";
        goal.attempt += 1;
        goal.startedAt ??= now;
        goal.updatedAt = now;
        plan.activeGoalId = goal.id;
        plan.updatedAt = now;
        await writePlan(ctx.repoRoot, plan, ctx.scope);
        if (pick.retried && fromStatus !== undefined) {
            await appendLedger(ctx.repoRoot, { at: now, kind: "goal_retried", goalId: goal.id, fromStatus, attempt: goal.attempt }, ctx.scope);
        }
        await appendLedger(ctx.repoRoot, {
            at: now,
            kind: pick.resumed ? "goal_resumed" : "goal_started",
            goalId: goal.id,
            message: `Attempt ${goal.attempt}`,
        }, ctx.scope);
        const runText = buildRunInstruction(plan, goal);
        const goalInstruction = buildCodexGoalInstruction({ plan, goal });
        const text = `${runText}\n${goalInstruction.text}\n`;
        return {
            exitCode: 0,
            text,
            json: {
                ok: true,
                done: false,
                state: "runnable",
                resumed: pick.resumed,
                goal,
                instruction: { text },
                codexGoal: goalInstruction.json,
                plan,
            },
        };
    });
}
// ── checkpoint ───────────────────────────────────────────────────────────────
const CHECKPOINT_STATUSES = new Set(["complete", "failed", "blocked"]);
export async function handleCheckpoint(argv, ctx) {
    const goalId = requireValue(argv, "--goal-id");
    const statusRaw = requireValue(argv, "--status");
    if (!CHECKPOINT_STATUSES.has(statusRaw)) {
        throw new LitLoopError(`Invalid --status: ${statusRaw} (use complete|failed|blocked).`, "LIT_LOOP_ARGUMENT_INVALID", {
            status: statusRaw,
        });
    }
    const status = statusRaw;
    const evidence = redactSecrets(requireNonEmpty(requireValue(argv, "--evidence"), "--evidence"));
    return withMutationLock(ctx.repoRoot, ctx.scope, async () => {
        const plan = await readPlan(ctx.repoRoot, ctx.scope);
        const goal = findGoal(plan, goalId);
        if (status === "complete") {
            const unresolved = requireAllCriteriaPass(goal);
            if (unresolved.length > 0) {
                throw new LitLoopError(`Goal ${goalId} has unresolved criteria.`, "LIT_LOOP_CRITERIA_NOT_ALL_PASS", {
                    goalId,
                    unresolved,
                });
            }
        }
        const now = ctx.now();
        goal.status = status;
        goal.evidence = evidence;
        goal.updatedAt = now;
        if (status === "complete") {
            goal.completedAt = now;
            delete goal.failedAt;
            delete goal.failureReason;
        }
        else {
            goal.failedAt = now;
            goal.failureReason = evidence;
        }
        if (plan.activeGoalId === goalId) {
            delete plan.activeGoalId;
        }
        plan.updatedAt = now;
        const kind = status === "complete" ? "goal_completed" : status === "failed" ? "goal_failed" : "goal_blocked";
        const ledgerEntry = { at: now, kind, goalId, goalStatus: status, evidence };
        await writePlan(ctx.repoRoot, plan, ctx.scope);
        await appendLedger(ctx.repoRoot, ledgerEntry, ctx.scope);
        const codexCheckpoint = buildCodexGoalCheckpoint({ plan, goal, status });
        const requestedCodexGoalStatus = status === "complete" ? checkpointCodexGoalStatus(plan) : null;
        return {
            exitCode: 0,
            text: `lit-loop checkpoint: ${goalId} -> ${status}\n\n${codexCheckpoint}\n`,
            json: {
                ok: true,
                goal,
                ledgerEntry,
                codexGoal: {
                    mode: "agent_protocol",
                    source: "derived_from_durable_state",
                    status: requestedCodexGoalStatus ?? "unobserved",
                    requestedStatus: requestedCodexGoalStatus,
                    observed: false,
                    mutationPerformed: false,
                },
                plan,
                summary: summarizePlan(plan),
            },
        };
    });
}
function checkpointCodexGoalStatus(plan) {
    if (isLitLoopDone(plan))
        return "complete";
    return "active";
}
// -- record-evidence -----------------------------------------------------------
const EVIDENCE_STATUSES = new Set(["pass", "fail", "blocked"]);
export async function handleRecordEvidence(argv, ctx) {
    const goalId = requireValue(argv, "--goal-id");
    const criterionId = requireValue(argv, "--criterion-id");
    const statusRaw = requireValue(argv, "--status");
    if (!EVIDENCE_STATUSES.has(statusRaw)) {
        throw new LitLoopError(`Invalid --status: ${statusRaw} (use pass|fail|blocked).`, "LIT_LOOP_EVIDENCE_STATUS_INVALID", {
            status: statusRaw,
        });
    }
    const status = statusRaw;
    const evidence = redactSecrets(requireNonEmpty(requireValue(argv, "--evidence"), "--evidence"));
    const notesRaw = readValue(argv, "--notes");
    const notes = notesRaw === undefined ? undefined : redactSecrets(notesRaw);
    return withMutationLock(ctx.repoRoot, ctx.scope, async () => {
        const plan = await readPlan(ctx.repoRoot, ctx.scope);
        const goal = findGoal(plan, goalId);
        const crit = goal.successCriteria.find((c) => c.id === criterionId);
        if (crit === undefined) {
            throw new LitLoopError(`Unknown criterion: ${criterionId}.`, "LIT_LOOP_CRITERION_NOT_FOUND", {
                goalId,
                criterionId,
            });
        }
        const now = ctx.now();
        const prevStatus = crit.status;
        crit.status = status;
        crit.capturedEvidence = evidence;
        crit.capturedAt = now;
        if (notes !== undefined) {
            crit.notes = notes;
        }
        goal.updatedAt = now;
        plan.updatedAt = now;
        const kind = status === "pass" ? "evidence_captured" : status === "fail" ? "criterion_failed" : "criterion_blocked";
        const ledgerEntry = {
            at: now,
            kind,
            goalId,
            criterionId,
            criterionStatus: status,
            evidence,
            before: { status: prevStatus },
            after: { status, capturedAt: now },
        };
        await writePlan(ctx.repoRoot, plan, ctx.scope);
        await appendLedger(ctx.repoRoot, ledgerEntry, ctx.scope);
        return {
            exitCode: 0,
            text: `lit-loop evidence recorded: ${goalId}/${criterionId} -> ${status}\n`,
            json: { ok: true, goal, criterion: crit, ledgerEntry, plan, summary: summarizePlan(plan) },
        };
    });
}
// ── shared helpers ───────────────────────────────────────────────────────────
function findGoal(plan, goalId) {
    const goal = plan.goals.find((g) => g.id === goalId);
    if (goal === undefined) {
        throw new LitLoopError(`Unknown lit-loop goal id: ${goalId}.`, "LIT_LOOP_GOAL_NOT_FOUND", { goalId });
    }
    return goal;
}
function planPaths(ctx) {
    const dir = resolveLoopStateDir(ctx.repoRoot, ctx.scope);
    const rel = repoRelative(dir, ctx.repoRoot);
    return {
        briefPath: `${rel}/brief.md`,
        goalsPath: `${rel}/goals.json`,
        ledgerPath: `${rel}/ledger.jsonl`,
        evidenceDir: `${rel}/evidence`,
    };
}
async function readPlanOrNull(ctx) {
    try {
        return await readPlan(ctx.repoRoot, ctx.scope);
    }
    catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
        if (code === "LIT_LOOP_PLAN_MISSING") {
            return null;
        }
        throw err;
    }
}
async function readBriefOrNull(ctx) {
    try {
        return await readBrief(ctx.repoRoot, ctx.scope);
    }
    catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
        if (code === "LIT_LOOP_PLAN_MISSING") {
            return null;
        }
        throw err;
    }
}
function planResult(plan) {
    return {
        exitCode: 0,
        text: LOOP_CREATE_STDOUT(plan.goals.length, plan),
        json: { ok: true, plan, summary: summarizePlan(plan) },
    };
}
