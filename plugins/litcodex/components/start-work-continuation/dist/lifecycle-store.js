import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync, } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { analyzePlanProgress } from "./plan-progress.js";
export const START_WORK_STATE_MAX_BYTES = 1_000_000;
export const START_WORK_PLAN_MAX_BYTES = 1_000_000;
export const START_WORK_LEDGER_TAIL_BYTES = 2_000_000;
export const START_WORK_MAX_FIELD_BYTES = 10_000;
export const START_WORK_MAX_DISPLAY_BYTES = 512;
export const START_WORK_MAX_STDIN_BYTES = 1_000_000;
export const START_WORK_MAX_HISTORY_EVENTS = 64;
export const START_WORK_MAX_AUTHORITY_BYTES = 64_000;
export const START_WORK_MAX_INIT_BYTES = 256_000;
const MAX_AUTHORITY_ITEMS = 64;
const MAX_AUTHORITY_GRANTS = 64;
const LOCK_ATTEMPTS = 8;
const LOCK_STALE_MS = 30_000;
const O_NOFOLLOW = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
export class LifecycleStoreError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "LifecycleStoreError";
    }
}
export function statePathFor(cwd) {
    return join(cwd, ".litcodex", "start-work", "state.json");
}
export function ledgerPathFor(cwd) {
    return join(cwd, ".litcodex", "lit-loop", "ledger.jsonl");
}
export function isBoundedLifecycleText(value, maxBytes = START_WORK_MAX_FIELD_BYTES) {
    return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= maxBytes;
}
export function readLifecycleState(cwd) {
    try {
        const paths = managedPaths(cwd, false);
        return loadState(paths).state;
    }
    catch (error) {
        if (error instanceof Error)
            return null;
        throw error;
    }
}
export function inspectLifecycleState(cwd) {
    try {
        const loaded = loadState(managedPaths(cwd, false));
        return { ok: true, state: loaded.state, sourceSchema: loaded.sourceSchema };
    }
    catch (error) {
        if (error instanceof LifecycleStoreError)
            return { ok: false, code: error.code, message: error.message };
        if (error instanceof Error)
            return { ok: false, code: "STATE_UNREADABLE", message: error.message };
        throw error;
    }
}
export function selectWorkForSession(state, sessionId, statuses) {
    if (state.active_work_id === null)
        return null;
    const prefixed = `codex:${sessionId}`;
    const selected = state.works[state.active_work_id];
    if (selected === undefined || selected.work_id !== state.active_work_id)
        return null;
    if (!statuses.includes(selected.status) || !selected.session_ids.includes(prefixed))
        return null;
    const matches = Object.entries(state.works).filter(([id, work]) => id === work.work_id && statuses.includes(work.status) && work.session_ids.includes(prefixed));
    return matches.length === 1 && matches[0]?.[0] === state.active_work_id ? selected : null;
}
export function resolveCanonicalPlan(cwd, activePlan, allowHistoricalAbsolute = false) {
    return canonicalPlan(managedPaths(cwd, false), activePlan, allowHistoricalAbsolute);
}
export function initializeWork(cwd, request, options = {}) {
    validateInitRequest(cwd, request);
    const paths = managedPaths(cwd, true);
    const plan = canonicalPlan(paths, request.plan, false);
    if (!plan.progress.contractValid)
        throw new LifecycleStoreError("PLAN_EMPTY", "start-work plan requires real Todos and final verification checkbox rows");
    const authority = normalizeAuthority(paths, request.authority);
    const worktreePath = normalizeWorktree(request.worktreePath ?? null, authority.allowed_roots);
    const normalizedRequest = { ...request, authority, worktreePath, plan: plan.relativePath };
    const initFingerprint = digest(stableJson(normalizedRequest));
    return withStateLock(paths, options, () => {
        if (pathExists(paths.state)) {
            const loaded = loadState(paths);
            reconcileAllLastTransitions(paths, loaded.state, options);
            const existing = findCanonicalEvent(paths, loaded.state, request.initId, options);
            if (existing !== undefined) {
                if (existing.kind !== "start_work_initialized" || existing.initFingerprint !== initFingerprint) {
                    throw new LifecycleStoreError("INIT_CONFLICT", "existing state does not match the requested init id");
                }
                ensureLedgerEvent(paths, existing, options);
                return { changed: false, state: loaded.state, event: existing };
            }
            const state = normalizeStateForMutation(paths, loaded);
            if (state.active_work_id !== null || Object.values(state.works).some((work) => isNonterminal(work.status))) {
                throw new LifecycleStoreError("INIT_NONTERMINAL", "new init is rejected while nonterminal work exists");
            }
            assertReplayAvailable(loaded.state, request.expectedRevision);
            if (state.revision !== request.expectedRevision) {
                throw new LifecycleStoreError("REVISION_CONFLICT", "expected revision does not match current revision");
            }
            if (state.works[request.workId] !== undefined) {
                throw new LifecycleStoreError("WORK_ID_CONFLICT", "new init cannot replace a preserved work record");
            }
            const at = options.now?.() ?? new Date().toISOString();
            const event = initEvent(request, plan, initFingerprint, state.revision + 1, at);
            const work = initializedWork(request, plan, authority, worktreePath, event, at);
            const history = appendHistory(state, event);
            const nextState = compactTerminalWorks({
                ...state,
                schema_version: 3,
                revision: event.revision,
                active_work_id: request.workId,
                works: { ...state.works, [request.workId]: work },
                transition_history: history.events,
                history_floor_revision: history.floorRevision,
                init_id: request.initId,
            });
            validateStateConsistency(nextState);
            writeStateAtomic(paths, nextState, false);
            options.afterStateWrite?.();
            ensureLedgerEvent(paths, event, options);
            return { changed: true, state: nextState, event };
        }
        if (request.expectedRevision !== 0) {
            throw new LifecycleStoreError("REVISION_CONFLICT", "fresh init requires expected revision zero");
        }
        const existingLedger = scanLedgerForTransition(paths, request.initId, options);
        if (existingLedger.event !== undefined || existingLedger.conflict) {
            throw new LifecycleStoreError("INIT_CONFLICT", "init id already exists in lifecycle ledger");
        }
        const at = options.now?.() ?? new Date().toISOString();
        const event = initEvent(request, plan, initFingerprint, 1, at);
        const work = initializedWork(request, plan, authority, worktreePath, event, at);
        const state = {
            schema_version: 3,
            revision: 1,
            active_work_id: request.workId,
            works: { [request.workId]: work },
            transition_history: { [request.initId]: event },
            history_floor_revision: 1,
            init_id: request.initId,
        };
        validateStateConsistency(state);
        writeStateAtomic(paths, state, true);
        options.afterStateWrite?.();
        ensureLedgerEvent(paths, event, options);
        return { changed: true, state, event };
    });
}
export function transitionWork(cwd, request, options = {}) {
    validateTransitionRequest(cwd, request);
    const paths = managedPaths(cwd, true);
    return withStateLock(paths, options, () => {
        const loaded = loadState(paths);
        reconcileAllLastTransitions(paths, loaded.state, options);
        const existing = findCanonicalEvent(paths, loaded.state, request.transitionId, options);
        if (existing !== undefined) {
            if (!requestMatchesEvent(request, existing)) {
                throw new LifecycleStoreError("TRANSITION_ID_CONFLICT", "transition id has a conflicting canonical event");
            }
            ensureLedgerEvent(paths, existing, options);
            return { changed: false, state: loaded.state, event: existing };
        }
        assertReplayAvailable(loaded.state, request.expectedRevision);
        const migrationAuthority = request.authority === undefined ? undefined : normalizeAuthority(paths, request.authority);
        const state = normalizeStateForMutation(paths, loaded, migrationAuthority);
        const work = state.works[request.workId];
        if (work === undefined ||
            work.work_id !== request.workId ||
            !work.session_ids.includes(`codex:${request.sessionId}`) ||
            state.active_work_id !== request.workId) {
            throw new LifecycleStoreError("WORK_SELECTION_INVALID", "workId did not select the active matching work");
        }
        const authority = work.authority;
        if (authority === undefined) {
            throw new LifecycleStoreError("AUTHORITY_INVALID", "nonterminal work lacks authority");
        }
        const boundary = request.boundary === undefined ? undefined : normalizeBoundary(request.boundary, authority);
        if (request.action === "pause" &&
            work.status === "paused" &&
            boundary !== undefined &&
            work.pending_boundary !== undefined &&
            boundariesEquivalent(boundary, work.pending_boundary)) {
            const prior = work.last_transition;
            if (prior === undefined || prior.kind !== "start_work_paused") {
                throw new LifecycleStoreError("BOUNDARY_STATE_INVALID", "pending boundary lacks its pause event");
            }
            ensureLedgerEvent(paths, prior, options);
            return { changed: false, state, event: prior };
        }
        if (request.action === "pause" && work.status === "active" && boundary !== undefined) {
            if (authorityAuthorizesBoundary(authority, boundary)) {
                const prior = work.last_transition;
                if (prior === undefined) {
                    throw new LifecycleStoreError("BOUNDARY_STATE_INVALID", "authorized work lacks its canonical event");
                }
                ensureLedgerEvent(paths, prior, options);
                return { changed: false, state, event: prior };
            }
            const consumed = work.authority_grants?.find((grant) => grantAuthorizesBoundary(grant, boundary));
            if (consumed !== undefined) {
                const prior = work.last_transition;
                if (prior === undefined) {
                    throw new LifecycleStoreError("BOUNDARY_STATE_INVALID", "authorized work lacks its canonical event");
                }
                ensureLedgerEvent(paths, prior, options);
                return { changed: false, state, event: prior };
            }
        }
        if (state.revision !== request.expectedRevision) {
            throw new LifecycleStoreError("REVISION_CONFLICT", "expected revision does not match current revision");
        }
        const plan = canonicalPlan(paths, work.active_plan, false);
        // Fresh init enforces the planner contract; persisted work retains legacy progress compatibility.
        if (plan.progress.total === 0)
            throw new LifecycleStoreError("PLAN_EMPTY", "start-work plan has no executable checkbox");
        const target = targetStatus(request.action, work.status, request.reasonCode);
        if (request.action === "complete" && plan.progress.remaining !== 0) {
            throw new LifecycleStoreError("PLAN_INCOMPLETE", "complete requires zero remaining executable checkboxes");
        }
        const grant = request.grant === undefined ? undefined : normalizeGrant(request.grant, authority, boundary);
        if (request.action === "pause" && boundary === undefined) {
            throw new LifecycleStoreError("BOUNDARY_REQUIRED", "pause requires an explicit authority boundary");
        }
        if (request.action === "resume") {
            if (boundary === undefined || grant === undefined) {
                throw new LifecycleStoreError("GRANT_REQUIRED", "resume requires matching boundary and grant");
            }
            const pending = work.pending_boundary ?? (loaded.sourceSchema === 2 ? boundary : undefined);
            if (pending === undefined || !boundariesEquivalent(boundary, pending)) {
                throw new LifecycleStoreError("BOUNDARY_MISMATCH", "resume boundary does not match pending boundary");
            }
            const conflictingGrant = work.authority_grants?.find((item) => item.grant_id === grant.grant_id && !grantMatchesBoundary(item, boundary));
            if (conflictingGrant !== undefined) {
                throw new LifecycleStoreError("GRANT_CONFLICT", "grant id is already bound to a different boundary");
            }
        }
        const event = transitionEvent(state, work, request, target, plan, options.now?.() ?? new Date().toISOString(), boundary, grant);
        const grants = request.action === "resume" && grant !== undefined
            ? [...(work.authority_grants ?? []).filter((item) => item.grant_id !== grant.grant_id), grant].slice(-MAX_AUTHORITY_GRANTS)
            : work.authority_grants;
        const updatedWork = {
            ...work,
            status: target,
            ...(request.action === "pause" && boundary !== undefined ? { pending_boundary: boundary } : {}),
            ...(request.action === "resume" && grants !== undefined ? { authority_grants: grants } : {}),
            last_transition: event,
        };
        const nextWork = request.action === "resume" || terminalAction(request.action) ? omitPendingBoundary(updatedWork) : updatedWork;
        const terminal = target === "abandoned" || target === "completed";
        const history = appendHistory(state, event);
        const nextState = compactTerminalWorks({
            ...state,
            schema_version: 3,
            revision: event.revision,
            active_work_id: terminal ? null : request.workId,
            works: { ...state.works, [request.workId]: nextWork },
            transition_history: history.events,
            history_floor_revision: history.floorRevision,
        });
        validateStateConsistency(nextState);
        writeStateAtomic(paths, nextState, false);
        options.afterStateWrite?.();
        ensureLedgerEvent(paths, event, options);
        return { changed: true, state: nextState, event };
    });
}
export function advanceStopLease(cwd, request, options = {}) {
    if (!isBoundedLifecycleText(cwd) ||
        !isBoundedLifecycleText(request.sessionId) ||
        !isBoundedLifecycleText(request.turnId) ||
        !isBoundedLifecycleText(request.workId) ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 ||
        !isHash(request.progressToken)) {
        throw new LifecycleStoreError("LEASE_INPUT_INVALID", "continuation lease input is malformed or oversized");
    }
    const paths = managedPaths(cwd, true);
    return withStateLock(paths, options, () => {
        const loaded = loadState(paths);
        reconcileAllLastTransitions(paths, loaded.state, options);
        const state = normalizeStateForMutation(paths, loaded);
        if (state.revision !== request.expectedRevision || state.active_work_id !== request.workId) {
            return { outcome: "silent", state };
        }
        const work = selectWorkForSession(state, request.sessionId, ["active"]);
        if (work === null || work.work_id !== request.workId)
            return { outcome: "silent", state };
        const plan = canonicalPlan(paths, work.active_plan, false);
        if (plan.progress.total === 0 || plan.progress.remaining === 0)
            return { outcome: "silent", state };
        if (plan.progress.progressToken !== request.progressToken) {
            throw new LifecycleStoreError("PROGRESS_TOKEN_MISMATCH", "continuation progress token does not match the plan");
        }
        const lease = work.continuation_lease;
        if (lease?.progress_token === request.progressToken && lease.turn_id === request.turnId) {
            const event = findCanonicalEvent(paths, state, lease.transition_id, options);
            if (event === undefined || event.kind !== "start_work_continuation_issued") {
                throw new LifecycleStoreError("LEASE_STATE_INVALID", "continuation lease lacks its canonical event");
            }
            return { outcome: "replay", state, event };
        }
        if (lease?.progress_token === request.progressToken)
            return { outcome: "silent", state };
        const at = options.now?.() ?? new Date().toISOString();
        const transitionId = `stop-continue:${shortDigest(request.sessionId)}:${shortDigest(request.turnId)}:${request.progressToken}`;
        const existing = findCanonicalEvent(paths, state, transitionId, options);
        if (existing !== undefined) {
            ensureLedgerEvent(paths, existing, options);
            return { outcome: "replay", state, event: existing };
        }
        const revision = state.revision + 1;
        const event = {
            kind: "start_work_continuation_issued",
            at,
            workId: work.work_id,
            transitionId,
            revision,
            fromWorkStatus: "active",
            toWorkStatus: "active",
            plan: work.active_plan,
            sessionId: `codex:${request.sessionId}`,
            turnId: request.turnId,
            progressToken: request.progressToken,
        };
        const nextWork = {
            ...work,
            continuation_lease: {
                progress_token: request.progressToken,
                turn_id: request.turnId,
                transition_id: transitionId,
            },
            last_transition: event,
        };
        const history = appendHistory(state, event);
        const nextState = compactTerminalWorks({
            ...state,
            schema_version: 3,
            revision,
            works: { ...state.works, [work.work_id]: nextWork },
            transition_history: history.events,
            history_floor_revision: history.floorRevision,
        });
        validateStateConsistency(nextState);
        writeStateAtomic(paths, nextState, false);
        options.afterStateWrite?.();
        ensureLedgerEvent(paths, event, options);
        return { outcome: "issued", state: nextState, event };
    });
}
export function reconcileLifecycleState(cwd, options = {}) {
    try {
        const paths = managedPaths(cwd, true);
        return withStateLock(paths, options, () => {
            const loaded = loadState(paths);
            reconcileAllLastTransitions(paths, loaded.state, options);
            return loaded.state;
        });
    }
    catch (error) {
        if (error instanceof LifecycleStoreError && error.code === "STATE_MISSING")
            return null;
        throw error;
    }
}
function managedPaths(cwd, createMutableDirs) {
    if (!isBoundedLifecycleText(cwd))
        throw new LifecycleStoreError("CWD_INVALID", "cwd is malformed or oversized");
    let canonicalCwd;
    try {
        canonicalCwd = realpathSync(cwd);
    }
    catch (error) {
        throw managedError("CWD_UNREADABLE", "cwd is unreadable", error);
    }
    assertSafeDirectory(canonicalCwd, canonicalCwd, "cwd");
    const litcodex = join(canonicalCwd, ".litcodex");
    const plans = join(litcodex, "plans");
    assertSafeDirectory(litcodex, canonicalCwd, ".litcodex");
    assertSafeDirectory(plans, canonicalCwd, "plans");
    const startWork = join(litcodex, "start-work");
    const litLoop = join(litcodex, "lit-loop");
    ensureManagedDirectory(startWork, litcodex, createMutableDirs, "start-work");
    ensureManagedDirectory(litLoop, litcodex, createMutableDirs, "lit-loop");
    const paths = {
        cwd: canonicalCwd,
        litcodex,
        plans,
        startWork,
        litLoop,
        state: join(startWork, "state.json"),
        ledger: join(litLoop, "ledger.jsonl"),
        lock: join(startWork, "state.json.lock"),
    };
    for (const [path, label] of [
        [paths.state, "state"],
        [paths.ledger, "ledger"],
        [paths.lock, "lock"],
    ]) {
        if (pathExists(path))
            assertSafeLeaf(path, label);
    }
    return paths;
}
function assertSafeDirectory(path, root, label) {
    let stat;
    try {
        stat = lstatSync(path);
    }
    catch (error) {
        throw managedError("MANAGED_PATH_MISSING", `${label} directory is missing`, error);
    }
    if (stat.isSymbolicLink())
        throw new LifecycleStoreError("MANAGED_PATH_SYMLINK", `${label} is a symbolic link`);
    if (!stat.isDirectory())
        throw new LifecycleStoreError("MANAGED_PATH_INVALID", `${label} is not a directory`);
    const canonical = realpathSync(path);
    if (!isWithin(root, canonical))
        throw new LifecycleStoreError("MANAGED_PATH_ESCAPE", `${label} escapes canonical cwd`);
}
function ensureManagedDirectory(path, root, create, label) {
    if (!pathExists(path)) {
        if (!create)
            return;
        mkdirSync(path, { mode: 0o700 });
    }
    assertSafeDirectory(path, root, label);
}
function assertSafeLeaf(path, label) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
        throw new LifecycleStoreError("MANAGED_PATH_SYMLINK", `${label} is a symbolic link`);
    if (!stat.isFile())
        throw new LifecycleStoreError("MANAGED_PATH_INVALID", `${label} is not a regular file`);
}
function canonicalPlan(paths, input, allowHistoricalAbsolute) {
    if (!isBoundedLifecycleText(input))
        throw new LifecycleStoreError("PLAN_PATH_INVALID", "plan path is invalid");
    let candidate;
    if (isAbsolute(input)) {
        if (!allowHistoricalAbsolute)
            throw new LifecycleStoreError("PLAN_PATH_INVALID", "absolute plan path is not allowed");
        candidate = input;
    }
    else {
        if (!/^\.litcodex\/plans\/[^/\\]+\.md$/.test(input)) {
            throw new LifecycleStoreError("PLAN_PATH_INVALID", "plan must be .litcodex/plans/*.md");
        }
        candidate = resolve(paths.cwd, input);
    }
    let canonical;
    try {
        const leaf = lstatSync(candidate);
        if (leaf.isSymbolicLink())
            throw new LifecycleStoreError("PLAN_SYMLINK", "plan is a symbolic link");
        canonical = realpathSync(candidate);
    }
    catch (error) {
        if (error instanceof LifecycleStoreError)
            throw error;
        throw managedError("PLAN_UNREADABLE", "plan is unreadable", error);
    }
    if (dirname(canonical) !== paths.plans || !isWithin(paths.plans, canonical)) {
        throw new LifecycleStoreError("PLAN_REALPATH_ESCAPE", "plan resolves outside canonical plans root");
    }
    const relativePath = `.litcodex/plans/${basename(canonical)}`;
    const fd = openNoFollow(canonical, constants.O_RDONLY, undefined, "plan");
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile())
            throw new LifecycleStoreError("PLAN_NOT_REGULAR", "plan is not a regular file");
        const text = readBoundedUtf8(fd, stat.size, START_WORK_PLAN_MAX_BYTES, "PLAN_TOO_LARGE");
        return { absolutePath: canonical, relativePath, text, progress: analyzePlanProgress(text) };
    }
    finally {
        closeSync(fd);
    }
}
function loadState(paths) {
    if (!pathExists(paths.state))
        throw new LifecycleStoreError("STATE_MISSING", "start-work state is missing");
    assertSafeLeaf(paths.state, "state");
    const fd = openNoFollow(paths.state, constants.O_RDONLY, undefined, "state");
    let raw;
    try {
        const stat = fstatSync(fd);
        raw = readBoundedUtf8(fd, stat.size, START_WORK_STATE_MAX_BYTES, "STATE_TOO_LARGE");
    }
    finally {
        closeSync(fd);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw managedError("STATE_INVALID_JSON", "state is not valid JSON", error);
    }
    if (!isRecord(parsed))
        throw new LifecycleStoreError("STATE_INVALID", "state must be an object");
    const schema = parsed["schema_version"];
    if (schema !== 2 && schema !== 3)
        throw new LifecycleStoreError("UNSUPPORTED_SCHEMA", "unsupported start-work schema");
    const active = parsed["active_work_id"];
    if ((schema === 2 && typeof active !== "string") ||
        (schema === 3 && active !== null && typeof active !== "string")) {
        throw new LifecycleStoreError("ACTIVE_WORK_INVALID", "active_work_id is invalid");
    }
    const worksValue = parsed["works"];
    if (!isRecord(worksValue))
        throw new LifecycleStoreError("STATE_INVALID", "works must be an object");
    const entries = [];
    for (const [id, value] of Object.entries(worksValue)) {
        const work = parseWork(paths, id, value, schema);
        if (work === null)
            throw new LifecycleStoreError("STATE_INVALID", `invalid work entry ${id}`);
        entries.push([id, work]);
    }
    const works = Object.fromEntries(entries);
    if (typeof active === "string" && (works[active] === undefined || works[active]?.work_id !== active)) {
        throw new LifecycleStoreError("ACTIVE_WORK_INVALID", "active_work_id is dangling or mismatched");
    }
    const revision = schema === 2 ? 0 : parsed["revision"];
    if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new LifecycleStoreError("STATE_INVALID", "revision must be a non-negative safe integer");
    }
    const history = parseHistory(parsed["transition_history"]);
    const historyFloor = schema === 2 ? 0 : (parsed["history_floor_revision"] ?? (history === undefined ? 0 : 1));
    if (!Number.isSafeInteger(historyFloor) ||
        historyFloor < 0 ||
        historyFloor > revision) {
        throw new LifecycleStoreError("STATE_REVISION_INVALID", "history floor is inconsistent with state revision");
    }
    const state = {
        ...parsed,
        schema_version: 3,
        revision: revision,
        active_work_id: active,
        works,
        ...(history === undefined ? {} : { transition_history: history }),
        ...(schema === 2 ? {} : { history_floor_revision: historyFloor }),
    };
    if (schema === 3)
        validateStateConsistency(state);
    return { state, sourceSchema: schema };
}
function parseWork(paths, id, value, schema) {
    if (!isBoundedLifecycleText(id) || !isRecord(value))
        return null;
    const activePlan = value["active_plan"];
    if (!isBoundedLifecycleText(activePlan) || (schema === 3 && !/^\.litcodex\/plans\/[^/\\]+\.md$/.test(activePlan))) {
        return null;
    }
    const sessionIds = value["session_ids"];
    const status = value["status"];
    if (schema === 3 && !Object.hasOwn(value, "worktree_path")) {
        throw new LifecycleStoreError("WORKTREE_INVALID", "schema-3 work requires its own worktree_path");
    }
    const worktree = value["worktree_path"] ?? null;
    if (value["work_id"] !== id ||
        !isBoundedLifecycleText(value["plan_name"], START_WORK_MAX_DISPLAY_BYTES) ||
        !Array.isArray(sessionIds) ||
        sessionIds.length === 0 ||
        !sessionIds.every((item) => isBoundedLifecycleText(item)) ||
        !isWorkStatus(status) ||
        !(worktree === null || isBoundedLifecycleText(worktree)))
        return null;
    const lease = parseLease(value["continuation_lease"]);
    if (value["continuation_lease"] !== undefined && lease === undefined)
        return null;
    const last = parseLifecycleEvent(value["last_transition"]);
    if (value["last_transition"] !== undefined && last === undefined)
        return null;
    if (last !== undefined && (last.workId !== id || last.plan !== activePlan || last.toWorkStatus !== status))
        return null;
    let authority;
    try {
        authority = parseStoredAuthority(paths, value["authority"], status, schema);
    }
    catch (error) {
        if (error instanceof LifecycleStoreError)
            throw error;
        throw error;
    }
    const pending = parseBoundary(value["pending_boundary"]);
    if (value["pending_boundary"] !== undefined && pending === undefined)
        return null;
    if (pending !== undefined) {
        if (status !== "paused" || authority === undefined)
            return null;
        validateBoundaryAgainstAuthority(pending, authority, true);
    }
    const grants = parseGrants(value["authority_grants"]);
    if (value["authority_grants"] !== undefined && grants === undefined)
        return null;
    if (grants !== undefined) {
        if (authority === undefined || grants.some((grant) => !grantMatchesStoredAuthority(grant, authority, status))) {
            return null;
        }
    }
    let normalizedWorktree = worktree;
    if (schema === 3) {
        if (isNonterminal(status) && authority === undefined) {
            throw new LifecycleStoreError("WORKTREE_INVALID", "nonterminal work requires authority-bound execution cwd");
        }
        const roots = authority === undefined ? [] : effectiveRoots(authority, grants ?? []);
        if (worktree === null) {
            if (isNonterminal(status) && !roots.some((root) => isWithin(root, paths.cwd))) {
                throw new LifecycleStoreError("WORKTREE_INVALID", "null worktree requires authority over canonical cwd");
            }
        }
        else {
            normalizedWorktree = validateStoredWorktree(worktree, roots, status);
        }
        if (status === "paused") {
            if (pending === undefined ||
                last === undefined ||
                last.kind !== "start_work_paused" ||
                last.fromWorkStatus !== "active" ||
                last.reasonCode === undefined ||
                !isPauseReason(last.reasonCode) ||
                last.boundary === undefined ||
                !boundariesEquivalent(last.boundary, pending)) {
                throw new LifecycleStoreError("BOUNDARY_STATE_INVALID", "paused work requires its matching last pause event");
            }
        }
    }
    return {
        ...value,
        work_id: id,
        active_plan: activePlan,
        plan_name: value["plan_name"],
        session_ids: sessionIds,
        status,
        worktree_path: normalizedWorktree,
        ...(authority === undefined ? {} : { authority }),
        ...(pending === undefined ? {} : { pending_boundary: pending }),
        ...(grants === undefined ? {} : { authority_grants: grants }),
        ...(lease === undefined ? {} : { continuation_lease: lease }),
        ...(last === undefined ? {} : { last_transition: last }),
    };
}
function normalizeStateForMutation(paths, loaded, migrationAuthority) {
    if (loaded.sourceSchema === 3)
        return loaded.state;
    const works = Object.fromEntries(Object.entries(loaded.state.works).map(([id, work]) => {
        const plan = canonicalPlan(paths, work.active_plan, true);
        if (isNonterminal(work.status) && migrationAuthority === undefined) {
            throw new LifecycleStoreError("MIGRATION_AUTHORITY_REQUIRED", "schema-2 migration authority is required");
        }
        const authority = isNonterminal(work.status) ? migrationAuthority : work.authority;
        const worktree = work.worktree_path === null || authority === undefined
            ? work.worktree_path
            : normalizeWorktree(work.worktree_path, authority.allowed_roots);
        return [
            id,
            {
                ...work,
                active_plan: plan.relativePath,
                worktree_path: worktree,
                ...(authority === undefined ? {} : { authority }),
            },
        ];
    }));
    const history = { ...(loaded.state.transition_history ?? {}) };
    for (const work of Object.values(works)) {
        if (work.last_transition !== undefined)
            history[work.last_transition.transitionId] = work.last_transition;
    }
    return {
        ...loaded.state,
        schema_version: 3,
        revision: 0,
        works,
        transition_history: history,
        history_floor_revision: 0,
    };
}
function initEvent(request, plan, initFingerprint, revision, at) {
    return {
        kind: "start_work_initialized",
        at,
        workId: request.workId,
        transitionId: request.initId,
        revision,
        toWorkStatus: "active",
        plan: plan.relativePath,
        sessionId: `codex:${request.sessionId}`,
        progressToken: plan.progress.progressToken,
        initFingerprint,
    };
}
function initializedWork(request, plan, authority, worktreePath, event, at) {
    return {
        work_id: request.workId,
        active_plan: plan.relativePath,
        plan_name: request.planName,
        session_ids: [`codex:${request.sessionId}`],
        status: "active",
        worktree_path: worktreePath,
        authority,
        started_at: at,
        last_transition: event,
    };
}
function appendHistory(state, event) {
    const entries = [...sortedHistoryEntries(state), [event.transitionId, event]]
        .sort((left, right) => left[1].revision - right[1].revision)
        .slice(-START_WORK_MAX_HISTORY_EVENTS);
    return {
        events: Object.fromEntries(entries),
        floorRevision: entries[0]?.[1].revision ?? event.revision,
    };
}
function assertReplayAvailable(state, expectedRevision) {
    const floor = state.history_floor_revision ?? 0;
    if (floor > 0 && expectedRevision < floor) {
        throw new LifecycleStoreError("REPLAY_EXPIRED", "transition replay expired from retained history");
    }
}
function validateStateConsistency(state) {
    const nonterminal = Object.values(state.works).filter((work) => isNonterminal(work.status));
    if (state.active_work_id === null) {
        if (nonterminal.length !== 0) {
            throw new LifecycleStoreError("ACTIVE_WORK_INVALID", "nonterminal work requires active_work_id");
        }
    }
    else {
        const active = state.works[state.active_work_id];
        if (active === undefined || !isNonterminal(active.status) || nonterminal.length !== 1) {
            throw new LifecycleStoreError("ACTIVE_WORK_INVALID", "schema-3 state must select exactly one nonterminal work");
        }
    }
    const history = sortedHistoryEvents(state);
    if (new Set(history.map((event) => event.revision)).size !== history.length) {
        throw new LifecycleStoreError("STATE_REVISION_INVALID", "transition history revisions must be unique");
    }
    let previous = 0;
    for (const event of history) {
        if (event.revision <= previous ||
            event.revision > state.revision ||
            (previous > 0 && event.revision !== previous + 1)) {
            throw new LifecycleStoreError("STATE_REVISION_INVALID", "transition history revisions must increase monotonically");
        }
        const work = state.works[event.workId];
        if (work === undefined) {
            throw new LifecycleStoreError("STATE_REVISION_INVALID", "transition history references unknown work");
        }
        if (work.authority !== undefined && event.boundary !== undefined) {
            try {
                validateBoundaryAgainstAuthority(event.boundary, work.authority, true, !isNonterminal(work.status));
            }
            catch {
                throw new LifecycleStoreError("AUTHORITY_INVALID", "history boundary is outside stored authority");
            }
        }
        if (work.authority !== undefined &&
            event.grant !== undefined &&
            !grantMatchesStoredAuthority(event.grant, work.authority, work.status)) {
            throw new LifecycleStoreError("AUTHORITY_INVALID", "history grant is outside stored authority");
        }
        if (event.grant !== undefined &&
            (event.boundary === undefined ||
                event.grant.boundary_id !== event.boundary.boundary_id ||
                event.grant.action !== event.boundary.action ||
                event.grant.root !== event.boundary.root)) {
            throw new LifecycleStoreError("AUTHORITY_INVALID", "history grant does not match its boundary");
        }
        previous = event.revision;
    }
    if (history.length > START_WORK_MAX_HISTORY_EVENTS) {
        throw new LifecycleStoreError("STATE_REVISION_INVALID", "transition history exceeds its retained-event limit");
    }
    if (history.length > 0) {
        if (history.at(-1)?.revision !== state.revision) {
            throw new LifecycleStoreError("STATE_REVISION_INVALID", "state revision must match newest retained event");
        }
        if ((state.history_floor_revision ?? 0) !== history[0]?.revision) {
            throw new LifecycleStoreError("STATE_REVISION_INVALID", "history floor must match oldest retained event");
        }
    }
    else if (state.revision !== 0) {
        throw new LifecycleStoreError("STATE_REVISION_INVALID", "nonzero revision requires retained history");
    }
    for (const work of Object.values(state.works)) {
        const last = work.last_transition;
        if (work.status === "paused" && last?.revision !== state.revision) {
            throw new LifecycleStoreError("BOUNDARY_STATE_INVALID", "paused work pause event must be the latest revision");
        }
        if (last === undefined)
            continue;
        if (last.revision > state.revision) {
            throw new LifecycleStoreError("STATE_REVISION_INVALID", "work transition exceeds state revision");
        }
        const retained = state.transition_history?.[last.transitionId];
        if (last.revision >= (state.history_floor_revision ?? 0) &&
            (retained === undefined || !eventsEquivalent(last, retained))) {
            throw new LifecycleStoreError("STATE_REVISION_INVALID", "work transition conflicts with retained history");
        }
    }
}
function sortedHistoryEntries(state) {
    return Object.entries(state.transition_history ?? {}).sort((left, right) => {
        const revision = left[1].revision - right[1].revision;
        return revision === 0 ? left[0].localeCompare(right[0]) : revision;
    });
}
function sortedHistoryEvents(state) {
    return sortedHistoryEntries(state).map(([, event]) => event);
}
function compactTerminalWorks(state) {
    const floor = state.history_floor_revision ?? 0;
    if (floor === 0)
        return state;
    const retainedWorkIds = new Set(sortedHistoryEvents(state).map((event) => event.workId));
    const works = Object.fromEntries(Object.entries(state.works).filter(([, work]) => {
        if (isNonterminal(work.status) || retainedWorkIds.has(work.work_id))
            return true;
        return work.last_transition === undefined || work.last_transition.revision >= floor;
    }));
    return Object.keys(works).length === Object.keys(state.works).length ? state : { ...state, works };
}
function parseLease(value) {
    if (value === undefined)
        return undefined;
    if (!isRecord(value))
        return undefined;
    return isHash(value["progress_token"]) &&
        isBoundedLifecycleText(value["turn_id"]) &&
        isBoundedLifecycleText(value["transition_id"])
        ? {
            progress_token: value["progress_token"],
            turn_id: value["turn_id"],
            transition_id: value["transition_id"],
        }
        : undefined;
}
function parseHistory(value) {
    if (value === undefined)
        return undefined;
    if (!isRecord(value))
        throw new LifecycleStoreError("STATE_INVALID", "transition_history must be an object");
    const entries = [];
    for (const [id, candidate] of Object.entries(value)) {
        const event = parseLifecycleEvent(candidate);
        if (event === undefined || event.transitionId !== id) {
            throw new LifecycleStoreError("STATE_INVALID", `invalid transition_history event ${id}`);
        }
        entries.push([id, event]);
    }
    return Object.fromEntries(entries);
}
function parseLifecycleEvent(value) {
    if (!isRecord(value) || Object.hasOwn(value, "reason"))
        return undefined;
    const allowed = new Set([
        "kind",
        "at",
        "workId",
        "transitionId",
        "revision",
        "fromWorkStatus",
        "toWorkStatus",
        "plan",
        "sessionId",
        "reasonCode",
        "turnId",
        "progressToken",
        "initFingerprint",
        "boundary",
        "grant",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
        return undefined;
    if (!isLifecycleKind(value["kind"]) ||
        !isBoundedLifecycleText(value["at"]) ||
        !isBoundedLifecycleText(value["workId"]) ||
        !isBoundedLifecycleText(value["transitionId"]) ||
        !Number.isSafeInteger(value["revision"]) ||
        value["revision"] < 0 ||
        !isWorkStatus(value["toWorkStatus"]) ||
        !isBoundedLifecycleText(value["plan"]) ||
        !isBoundedLifecycleText(value["sessionId"]))
        return undefined;
    if (value["fromWorkStatus"] !== undefined && !isWorkStatus(value["fromWorkStatus"]))
        return undefined;
    if (value["reasonCode"] !== undefined && !isReasonCode(value["reasonCode"]))
        return undefined;
    if (value["turnId"] !== undefined && !isBoundedLifecycleText(value["turnId"]))
        return undefined;
    if (value["progressToken"] !== undefined && !isHash(value["progressToken"]))
        return undefined;
    if (value["initFingerprint"] !== undefined && !isHash(value["initFingerprint"]))
        return undefined;
    const boundary = parseBoundary(value["boundary"]);
    if (value["boundary"] !== undefined && boundary === undefined)
        return undefined;
    const grant = parseGrant(value["grant"]);
    if (value["grant"] !== undefined && grant === undefined)
        return undefined;
    return {
        ...value,
        ...(boundary === undefined ? {} : { boundary }),
        ...(grant === undefined ? {} : { grant }),
    };
}
function transitionEvent(state, work, request, target, plan, at, boundary, grant) {
    return {
        kind: kindForAction(request.action),
        at,
        workId: request.workId,
        transitionId: request.transitionId,
        revision: state.revision + 1,
        fromWorkStatus: work.status,
        toWorkStatus: target,
        plan: plan.relativePath,
        sessionId: `codex:${request.sessionId}`,
        reasonCode: request.reasonCode,
        ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
        progressToken: plan.progress.progressToken,
        ...(boundary === undefined ? {} : { boundary }),
        ...(grant === undefined ? {} : { grant }),
    };
}
function targetStatus(action, status, reasonCode) {
    if (action === "pause" && status === "active" && isPauseReason(reasonCode))
        return "paused";
    if (action === "resume" && status === "paused" && reasonCode === "explicit_user_resume")
        return "active";
    if (action === "cancel" && (status === "active" || status === "paused") && reasonCode === "user_cancelled") {
        return "abandoned";
    }
    if (action === "complete" && status === "active" && reasonCode === "completed") {
        return "completed";
    }
    throw new LifecycleStoreError("TRANSITION_INVALID", `cannot ${action} work from ${status} with ${reasonCode}`);
}
function kindForAction(action) {
    if (action === "pause")
        return "start_work_paused";
    if (action === "resume")
        return "start_work_resumed";
    if (action === "cancel")
        return "start_work_cancelled";
    return "start_work_completed";
}
function requestMatchesEvent(request, event) {
    return (event.kind === kindForAction(request.action) &&
        event.workId === request.workId &&
        event.sessionId === `codex:${request.sessionId}` &&
        event.reasonCode === request.reasonCode &&
        event.turnId === request.turnId &&
        authorityReplayValueEqual(event.boundary, request.boundary) &&
        authorityReplayValueEqual(event.grant, request.grant));
}
function reconcileAllLastTransitions(paths, state, options) {
    const newest = Object.values(state.works)
        .map((work) => work.last_transition)
        .filter((event) => event !== undefined)
        .sort((left, right) => right.revision - left.revision)[0];
    if (newest !== undefined && newest.revision === state.revision)
        ensureLedgerEvent(paths, newest, options);
}
function findCanonicalEvent(paths, state, transitionId, options) {
    const retained = state.transition_history?.[transitionId];
    const scanned = scanLedgerForTransition(paths, transitionId, options);
    if (scanned.conflict)
        throw new LifecycleStoreError("LEDGER_CONFLICT", "transition id has conflicting ledger payloads");
    if (retained !== undefined && scanned.event !== undefined && !eventsEquivalent(retained, scanned.event)) {
        throw new LifecycleStoreError("LEDGER_CONFLICT", "retained transition conflicts with lifecycle ledger");
    }
    const canonical = retained ?? scanned.event;
    if (retained === undefined && canonical !== undefined && canonical.revision < (state.history_floor_revision ?? 0)) {
        throw new LifecycleStoreError("REPLAY_EXPIRED", "transition replay expired from retained history");
    }
    return canonical;
}
function ensureLedgerEvent(paths, event, options) {
    const scanned = scanLedgerForTransition(paths, event.transitionId, options);
    if (scanned.conflict || (scanned.event !== undefined && !eventsEquivalent(scanned.event, event))) {
        throw new LifecycleStoreError("LEDGER_CONFLICT", "transition id has a conflicting ledger payload");
    }
    if (scanned.event !== undefined)
        return;
    appendLedgerEvent(paths, event);
}
function scanLedgerForTransition(paths, transitionId, options) {
    if (!pathExists(paths.ledger))
        return { conflict: false };
    assertSafeLeaf(paths.ledger, "ledger");
    const fd = openNoFollow(paths.ledger, constants.O_RDONLY, undefined, "ledger");
    try {
        const stat = fstatSync(fd);
        const bytes = Math.min(stat.size, START_WORK_LEDGER_TAIL_BYTES);
        const offset = Math.max(0, stat.size - bytes);
        const buffer = Buffer.alloc(bytes);
        const read = readInto(fd, buffer, offset);
        options.onLedgerRead?.(read, offset);
        let text = buffer.subarray(0, read).toString("utf8");
        if (offset > 0)
            text = text.slice(Math.max(0, text.indexOf("\n") + 1));
        let event;
        let conflict = false;
        for (const line of text.split(/\r?\n/)) {
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (!isRecord(parsed) || parsed["transitionId"] !== transitionId)
                continue;
            const candidate = parseLifecycleEvent(parsed);
            if (candidate === undefined) {
                conflict = true;
                continue;
            }
            if (event !== undefined && !eventsEquivalent(event, candidate))
                conflict = true;
            event ??= candidate;
        }
        return { ...(event === undefined ? {} : { event }), conflict };
    }
    finally {
        closeSync(fd);
    }
}
function appendLedgerEvent(paths, event) {
    const fd = openNoFollow(paths.ledger, constants.O_CREAT | constants.O_RDWR | constants.O_APPEND, 0o600, "ledger");
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile())
            throw new LifecycleStoreError("LEDGER_INVALID", "ledger is not a regular file");
        if (stat.size > 0) {
            const last = Buffer.alloc(1);
            readSync(fd, last, 0, 1, stat.size - 1);
            if (last[0] !== 0x0a)
                writeAll(fd, Buffer.from("\n"));
        }
        writeAll(fd, Buffer.from(`${stableEventJson(event)}\n`, "utf8"));
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
function writeStateAtomic(paths, state, createOnly) {
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > START_WORK_STATE_MAX_BYTES) {
        throw new LifecycleStoreError("STATE_WRITE_TOO_LARGE", "state write would exceed the readable state limit");
    }
    const temp = join(paths.startWork, `.${randomUUID()}.state.tmp`);
    const fd = openNoFollow(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600, "state temp");
    try {
        writeAll(fd, Buffer.from(serialized, "utf8"));
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    try {
        if (createOnly) {
            linkSync(temp, paths.state);
            unlinkSync(temp);
        }
        else {
            renameSync(temp, paths.state);
        }
    }
    catch (error) {
        try {
            unlinkSync(temp);
        }
        catch {
            // Preserve the primary atomic-write failure.
        }
        throw managedError(createOnly ? "STATE_EXISTS" : "STATE_WRITE_FAILED", "atomic state write failed", error);
    }
}
function withStateLock(paths, options, operation) {
    const owner = acquireLock(paths, options.nowMs ?? Date.now);
    try {
        return operation();
    }
    finally {
        releaseLock(paths.lock, owner);
    }
}
function acquireLock(paths, nowMs) {
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
        const body = JSON.stringify({ token: randomUUID(), createdAt: nowMs() });
        try {
            const fd = openNoFollow(paths.lock, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600, "lock");
            writeAll(fd, Buffer.from(body, "utf8"));
            fsyncSync(fd);
            const stat = fstatSync(fd, { bigint: true });
            return { fd, body, dev: stat.dev, ino: stat.ino };
        }
        catch (error) {
            if (!isCode(error, "EEXIST"))
                throw error;
            tryRemoveStaleLock(paths.lock, nowMs());
        }
    }
    throw new LifecycleStoreError("LOCK_BUSY", "start-work state lock is busy");
}
function tryRemoveStaleLock(path, nowMs) {
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink())
        throw new LifecycleStoreError("MANAGED_PATH_SYMLINK", "lock is a symbolic link");
    if (!stat.isFile())
        return;
    const fd = openNoFollow(path, constants.O_RDONLY, undefined, "lock");
    try {
        const fdStat = fstatSync(fd, { bigint: true });
        const size = Number(fdStat.size > 4096n ? 4096n : fdStat.size);
        const buffer = Buffer.alloc(size);
        const read = readInto(fd, buffer, 0);
        const text = buffer.subarray(0, read).toString("utf8");
        let stale = false;
        try {
            const parsed = JSON.parse(text);
            stale =
                isRecord(parsed) &&
                    typeof parsed["createdAt"] === "number" &&
                    parsed["createdAt"] <= nowMs &&
                    nowMs - parsed["createdAt"] > LOCK_STALE_MS;
        }
        catch {
            const mtimeMs = Number(fdStat.mtimeMs);
            stale = mtimeMs <= nowMs && nowMs - mtimeMs > LOCK_STALE_MS;
        }
        if (!stale)
            return;
        const current = lstatSync(path, { bigint: true });
        if (current.dev === fdStat.dev && current.ino === fdStat.ino)
            unlinkSync(path);
    }
    finally {
        closeSync(fd);
    }
}
function releaseLock(path, owner) {
    try {
        if (pathExists(path)) {
            const current = lstatSync(path, { bigint: true });
            const held = fstatSync(owner.fd, { bigint: true });
            const body = readFdText(owner.fd, Number(held.size));
            if (current.dev === owner.dev &&
                current.ino === owner.ino &&
                held.dev === owner.dev &&
                held.ino === owner.ino &&
                body === owner.body) {
                unlinkSync(path);
            }
        }
    }
    finally {
        closeSync(owner.fd);
    }
}
function validateInitRequest(cwd, request) {
    if (!isBoundedLifecycleText(cwd) ||
        !isBoundedLifecycleText(request.initId) ||
        !isBoundedLifecycleText(request.workId) ||
        !isBoundedLifecycleText(request.plan) ||
        !isBoundedLifecycleText(request.planName, START_WORK_MAX_DISPLAY_BYTES) ||
        !isBoundedLifecycleText(request.sessionId) ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 ||
        !(request.worktreePath === undefined ||
            request.worktreePath === null ||
            isBoundedLifecycleText(request.worktreePath))) {
        throw new LifecycleStoreError("INIT_INPUT_INVALID", "init input is malformed or oversized");
    }
    if (Buffer.byteLength(stableJson(request), "utf8") > START_WORK_MAX_INIT_BYTES) {
        throw new LifecycleStoreError("INIT_INPUT_TOO_LARGE", "init payload exceeds its total byte budget");
    }
}
function validateTransitionRequest(cwd, request) {
    if (!isBoundedLifecycleText(cwd) ||
        !isTransitionAction(request.action) ||
        !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 ||
        !isBoundedLifecycleText(request.sessionId) ||
        !isBoundedLifecycleText(request.transitionId) ||
        !isBoundedLifecycleText(request.workId) ||
        !isReasonCode(request.reasonCode) ||
        (request.boundary !== undefined && parseBoundary(request.boundary) === undefined) ||
        (request.grant !== undefined && parseGrant(request.grant) === undefined)) {
        throw new LifecycleStoreError("TRANSITION_INPUT_INVALID", "transition input is malformed or oversized");
    }
    if (request.turnId !== undefined && !isBoundedLifecycleText(request.turnId)) {
        throw new LifecycleStoreError("TRANSITION_INPUT_INVALID", "transition turn id is malformed or oversized");
    }
    if (request.action === "pause" && (request.boundary === undefined || !isPauseReason(request.reasonCode))) {
        throw new LifecycleStoreError("TRANSITION_INPUT_INVALID", "pause requires a boundary and blocker reason");
    }
    if (request.action === "resume" && (request.boundary === undefined || request.grant === undefined)) {
        throw new LifecycleStoreError("TRANSITION_INPUT_INVALID", "resume requires boundary and grant");
    }
    if ((request.action === "cancel" || request.action === "complete") &&
        (request.boundary !== undefined || request.grant !== undefined)) {
        throw new LifecycleStoreError("TRANSITION_INPUT_INVALID", "terminal transitions do not accept boundary or grant");
    }
}
function normalizeAuthority(paths, input) {
    if (!isRecord(input) ||
        !isBoundedLifecycleText(input.authorityId) ||
        !validStringArray(input.allowedRoots) ||
        !validStringArray(input.allowedActions) ||
        !validStringArray(input.forbiddenActions)) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "authority envelope is malformed or oversized");
    }
    if (Buffer.byteLength(stableJson(input), "utf8") > START_WORK_MAX_AUTHORITY_BYTES) {
        throw new LifecycleStoreError("AUTHORITY_BUDGET_EXCEEDED", "authority envelope exceeds its total byte budget");
    }
    const allowedRoots = input.allowedRoots.map((root) => {
        if (!isAbsolute(root))
            throw new LifecycleStoreError("AUTHORITY_INVALID", "allowed roots must be absolute");
        const canonical = realpathSync(root);
        assertSafeDirectory(canonical, canonical, "allowed root");
        return canonical;
    });
    if (new Set(allowedRoots).size !== allowedRoots.length) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "allowed roots must be unique");
    }
    if (new Set(input.allowedActions).size !== input.allowedActions.length ||
        new Set(input.forbiddenActions).size !== input.forbiddenActions.length) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "authority actions must be unique");
    }
    if (input.allowedActions.some((action) => input.forbiddenActions.includes(action))) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "allowed and forbidden actions overlap");
    }
    if (!allowedRoots.some((root) => isWithin(root, paths.cwd))) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "authority allowed_roots do not contain cwd");
    }
    return {
        authority_id: input.authorityId,
        allowed_roots: allowedRoots,
        allowed_actions: [...input.allowedActions],
        forbidden_actions: [...input.forbiddenActions],
    };
}
function normalizeWorktree(value, allowedRoots) {
    if (value === null)
        return null;
    if (!isAbsolute(value))
        throw new LifecycleStoreError("WORKTREE_INVALID", "worktree path must be absolute");
    const canonical = realpathSync(value);
    assertSafeDirectory(canonical, canonical, "worktree");
    if (!allowedRoots.some((root) => isWithin(root, canonical))) {
        throw new LifecycleStoreError("WORKTREE_INVALID", "worktree is outside authority allowed_roots");
    }
    return canonical;
}
function validStringArray(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.length <= MAX_AUTHORITY_ITEMS &&
        value.every((item) => isBoundedLifecycleText(item)));
}
function parseStoredAuthority(paths, value, status, schema) {
    if (value === undefined) {
        if (schema === 3 && isNonterminal(status)) {
            throw new LifecycleStoreError("AUTHORITY_INVALID", "active or paused schema-3 work requires authority");
        }
        return undefined;
    }
    if (!isRecord(value))
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored authority must be an object");
    const allowed = new Set(["authority_id", "allowed_roots", "allowed_actions", "forbidden_actions"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored authority contains unknown fields");
    }
    if (!isBoundedLifecycleText(value["authority_id"]) ||
        !validStringArray(value["allowed_roots"]) ||
        !validStringArray(value["allowed_actions"]) ||
        !validStringArray(value["forbidden_actions"])) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored authority is malformed or oversized");
    }
    if (Buffer.byteLength(stableJson(value), "utf8") > START_WORK_MAX_AUTHORITY_BYTES) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored authority exceeds its total byte budget");
    }
    const roots = value["allowed_roots"];
    for (const root of roots) {
        if (!isAbsolute(root))
            throw new LifecycleStoreError("AUTHORITY_INVALID", "stored allowed roots must be absolute");
        if (!isNonterminal(status)) {
            if (resolve(root) !== root) {
                throw new LifecycleStoreError("AUTHORITY_INVALID", "terminal stored roots must be normalized absolute paths");
            }
            try {
                if (realpathSync(root) !== root) {
                    throw new LifecycleStoreError("AUTHORITY_INVALID", "terminal stored roots must remain canonical");
                }
                assertSafeDirectory(root, root, "allowed root");
            }
            catch (error) {
                if (error instanceof LifecycleStoreError)
                    throw error;
                if (!isCode(error, "ENOENT"))
                    throw managedError("AUTHORITY_INVALID", "stored allowed root is unreadable", error);
            }
            continue;
        }
        let canonical;
        try {
            canonical = realpathSync(root);
        }
        catch (error) {
            throw managedError("AUTHORITY_INVALID", "stored allowed root is unreadable", error);
        }
        if (canonical !== root)
            throw new LifecycleStoreError("AUTHORITY_INVALID", "stored allowed roots must be canonical");
        assertSafeDirectory(root, root, "allowed root");
    }
    if (new Set(roots).size !== roots.length)
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored roots must be unique");
    const allowedActions = value["allowed_actions"];
    const forbiddenActions = value["forbidden_actions"];
    if (new Set(allowedActions).size !== allowedActions.length ||
        new Set(forbiddenActions).size !== forbiddenActions.length ||
        allowedActions.some((action) => forbiddenActions.includes(action))) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored authority actions are inconsistent");
    }
    if (isNonterminal(status) && !roots.some((root) => isWithin(root, paths.cwd))) {
        throw new LifecycleStoreError("AUTHORITY_INVALID", "stored authority does not contain canonical cwd");
    }
    return {
        authority_id: value["authority_id"],
        allowed_roots: [...roots],
        allowed_actions: [...allowedActions],
        forbidden_actions: [...forbiddenActions],
    };
}
function validateStoredWorktree(value, allowedRoots, status) {
    if (!isAbsolute(value))
        throw new LifecycleStoreError("WORKTREE_INVALID", "stored worktree must be absolute");
    let canonical;
    try {
        canonical = realpathSync(value);
    }
    catch (error) {
        if (!isNonterminal(status) && resolve(value) === value && isCode(error, "ENOENT"))
            return value;
        throw managedError("WORKTREE_INVALID", "stored worktree is unreadable", error);
    }
    if (canonical !== value)
        throw new LifecycleStoreError("WORKTREE_INVALID", "stored worktree must be canonical");
    assertSafeDirectory(value, value, "worktree");
    if (allowedRoots.length > 0 && !allowedRoots.some((root) => isWithin(root, value))) {
        throw new LifecycleStoreError("WORKTREE_INVALID", "stored worktree is outside authority roots");
    }
    return value;
}
function parseBoundary(value) {
    if (!isRecord(value))
        return undefined;
    const allowed = new Set(["boundary_id", "authority_id", "action", "root"]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
        return undefined;
    return isBoundedLifecycleText(value["boundary_id"]) &&
        isBoundedLifecycleText(value["authority_id"]) &&
        isBoundedLifecycleText(value["action"]) &&
        isBoundedLifecycleText(value["root"])
        ? {
            boundary_id: value["boundary_id"],
            authority_id: value["authority_id"],
            action: value["action"],
            root: value["root"],
        }
        : undefined;
}
function parseGrant(value) {
    if (!isRecord(value))
        return undefined;
    const allowed = new Set(["grant_id", "authority_id", "boundary_id", "action", "root"]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
        return undefined;
    return isBoundedLifecycleText(value["grant_id"]) &&
        isBoundedLifecycleText(value["authority_id"]) &&
        isBoundedLifecycleText(value["boundary_id"]) &&
        isBoundedLifecycleText(value["action"]) &&
        isBoundedLifecycleText(value["root"])
        ? {
            grant_id: value["grant_id"],
            authority_id: value["authority_id"],
            boundary_id: value["boundary_id"],
            action: value["action"],
            root: value["root"],
        }
        : undefined;
}
function parseGrants(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.length > MAX_AUTHORITY_GRANTS)
        return undefined;
    const grants = value.map(parseGrant);
    if (grants.some((grant) => grant === undefined))
        return undefined;
    const defined = grants;
    if (new Set(defined.map((grant) => grant.grant_id)).size !== defined.length)
        return undefined;
    return defined;
}
function normalizeBoundary(value, authority) {
    const parsed = parseBoundary(value);
    if (parsed === undefined)
        throw new LifecycleStoreError("BOUNDARY_INVALID", "authority boundary is malformed");
    let root;
    try {
        root = realpathSync(parsed.root);
    }
    catch (error) {
        throw managedError("BOUNDARY_INVALID", "authority boundary root is unreadable", error);
    }
    const normalized = { ...parsed, root };
    validateBoundaryAgainstAuthority(normalized, authority, false);
    return normalized;
}
function validateBoundaryAgainstAuthority(boundary, authority, requireCanonical, allowMissing = false) {
    if (boundary.authority_id !== authority.authority_id) {
        throw new LifecycleStoreError("BOUNDARY_MISMATCH", "boundary authority identity does not match work authority");
    }
    if (authority.forbidden_actions.includes(boundary.action)) {
        throw new LifecycleStoreError("BOUNDARY_MISMATCH", "boundary action is permanently forbidden");
    }
    if (!isAbsolute(boundary.root))
        throw new LifecycleStoreError("BOUNDARY_MISMATCH", "boundary root must be absolute");
    let canonical;
    try {
        canonical = realpathSync(boundary.root);
    }
    catch (error) {
        if (allowMissing && resolve(boundary.root) === boundary.root && isCode(error, "ENOENT"))
            return;
        throw error;
    }
    if (requireCanonical && canonical !== boundary.root) {
        throw new LifecycleStoreError("BOUNDARY_MISMATCH", "stored boundary root must be canonical");
    }
}
function normalizeGrant(value, authority, boundary) {
    const parsed = parseGrant(value);
    if (parsed === undefined || boundary === undefined) {
        throw new LifecycleStoreError("GRANT_INVALID", "authority grant is malformed or lacks a boundary");
    }
    const root = realpathSync(parsed.root);
    const normalized = { ...parsed, root };
    if (!grantMatchesAuthority(normalized, authority) || normalized.boundary_id !== boundary.boundary_id) {
        throw new LifecycleStoreError("GRANT_MISMATCH", "grant does not match pending boundary and authority");
    }
    if (normalized.action !== boundary.action || normalized.root !== boundary.root) {
        throw new LifecycleStoreError("GRANT_MISMATCH", "grant action or root does not match pending boundary");
    }
    return normalized;
}
function grantMatchesAuthority(grant, authority) {
    try {
        return (grant.authority_id === authority.authority_id &&
            !authority.forbidden_actions.includes(grant.action) &&
            isAbsolute(grant.root) &&
            realpathSync(grant.root) === grant.root);
    }
    catch {
        return false;
    }
}
function grantMatchesStoredAuthority(grant, authority, status) {
    if (grantMatchesAuthority(grant, authority))
        return true;
    return (!isNonterminal(status) &&
        grant.authority_id === authority.authority_id &&
        !authority.forbidden_actions.includes(grant.action) &&
        isAbsolute(grant.root) &&
        resolve(grant.root) === grant.root &&
        !pathExists(grant.root));
}
function grantMatchesBoundary(grant, boundary) {
    return (grant.authority_id === boundary.authority_id &&
        grant.boundary_id === boundary.boundary_id &&
        grant.action === boundary.action &&
        grant.root === boundary.root);
}
function authorityAuthorizesBoundary(authority, boundary) {
    return (authority.allowed_actions.includes(boundary.action) &&
        authority.allowed_roots.some((root) => isWithin(root, boundary.root)));
}
function grantAuthorizesBoundary(grant, boundary) {
    return (grant.authority_id === boundary.authority_id &&
        grant.action === boundary.action &&
        isWithin(grant.root, boundary.root));
}
function effectiveRoots(authority, grants) {
    return [...new Set([...authority.allowed_roots, ...grants.map((grant) => grant.root)])];
}
function boundariesEquivalent(left, right) {
    return stableJson(left) === stableJson(right);
}
function openNoFollow(path, flags, mode, label) {
    try {
        return mode === undefined ? openSync(path, flags | O_NOFOLLOW) : openSync(path, flags | O_NOFOLLOW, mode);
    }
    catch (error) {
        if (isCode(error, "ELOOP"))
            throw new LifecycleStoreError("MANAGED_PATH_SYMLINK", `${label} is a symbolic link`);
        throw error;
    }
}
function readBoundedUtf8(fd, size, max, code) {
    if (size > max)
        throw new LifecycleStoreError(code, "managed file exceeds its byte limit");
    return readFdText(fd, size);
}
function readFdText(fd, size) {
    const buffer = Buffer.alloc(size);
    const read = readInto(fd, buffer, 0);
    return buffer.subarray(0, read).toString("utf8");
}
function readInto(fd, buffer, position) {
    let total = 0;
    while (total < buffer.byteLength) {
        const read = readSync(fd, buffer, total, buffer.byteLength - total, position + total);
        if (read === 0)
            break;
        total += read;
    }
    return total;
}
function writeAll(fd, buffer) {
    let offset = 0;
    while (offset < buffer.byteLength)
        offset += writeSync(fd, buffer, offset, buffer.byteLength - offset);
}
function eventsEquivalent(left, right) {
    return stableEventJson(left) === stableEventJson(right);
}
function stableEventJson(event) {
    return JSON.stringify({
        kind: event.kind,
        at: event.at,
        workId: event.workId,
        transitionId: event.transitionId,
        revision: event.revision,
        ...(event.fromWorkStatus === undefined ? {} : { fromWorkStatus: event.fromWorkStatus }),
        toWorkStatus: event.toWorkStatus,
        plan: event.plan,
        sessionId: event.sessionId,
        ...(event.reasonCode === undefined ? {} : { reasonCode: event.reasonCode }),
        ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
        ...(event.progressToken === undefined ? {} : { progressToken: event.progressToken }),
        ...(event.initFingerprint === undefined ? {} : { initFingerprint: event.initFingerprint }),
        ...(event.boundary === undefined ? {} : { boundary: event.boundary }),
        ...(event.grant === undefined ? {} : { grant: event.grant }),
    });
}
function optionalStableEqual(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    return stableJson(left) === stableJson(right);
}
function authorityReplayValueEqual(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    if (!isRecord(left) || !isRecord(right))
        return false;
    const leftRoot = left["root"];
    const rightRoot = right["root"];
    if (typeof leftRoot !== "string" || typeof rightRoot !== "string")
        return optionalStableEqual(left, right);
    try {
        return (stableJson({ ...left, root: realpathSync(leftRoot) }) ===
            stableJson({ ...right, root: realpathSync(rightRoot) }));
    }
    catch {
        return false;
    }
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
function pathExists(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch (error) {
        if (isCode(error, "ENOENT"))
            return false;
        throw error;
    }
}
function isWithin(root, candidate) {
    const rel = relative(root, candidate);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function managedError(code, message, cause) {
    return new LifecycleStoreError(code, cause instanceof Error ? `${message}: ${cause.message}` : message);
}
function digest(value) {
    return createHash("sha256").update(value).digest("hex");
}
function shortDigest(value) {
    return digest(value).slice(0, 16);
}
function isHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isPauseReason(value) {
    return value === "authorization_required" || value === "credential_required" || value === "host_capability_required";
}
function isReasonCode(value) {
    return (value === "authorization_required" ||
        value === "credential_required" ||
        value === "host_capability_required" ||
        value === "explicit_user_resume" ||
        value === "user_cancelled" ||
        value === "completed");
}
function isLifecycleKind(value) {
    return (value === "start_work_initialized" ||
        value === "start_work_continuation_issued" ||
        value === "start_work_paused" ||
        value === "start_work_resumed" ||
        value === "start_work_cancelled" ||
        value === "start_work_completed");
}
function isWorkStatus(value) {
    return value === "active" || value === "paused" || value === "abandoned" || value === "completed";
}
function isNonterminal(value) {
    return value === "active" || value === "paused";
}
function isTransitionAction(value) {
    return value === "pause" || value === "resume" || value === "cancel" || value === "complete";
}
function terminalAction(value) {
    return value === "cancel" || value === "complete";
}
function omitPendingBoundary(work) {
    const copy = { ...work };
    delete copy.pending_boundary;
    return copy;
}
function isCode(error, code) {
    return isRecord(error) && error["code"] === code;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
