// src/state-store.ts — M08/T13 durable state store (the ONLY fs authority for loop state).
//
// Resolves the state dir from the project root (never the module location), writes goals.json
// ATOMICALLY via tmp-write→fsync→rename (a crash mid-write can never leave a half-truncated
// plan), APPENDS ledger lines without rewriting, VALIDATES the plan schema on read, and on a
// corruption QUARANTINES the bad bytes to a timestamped .bak + writes a recovery report +
// appends a state_recovered ledger line + throws a typed recoverable error (NEVER auto-recreate,
// NEVER discard goals). Serializes same-process mutations per state dir. It MUST NEVER read,
// write, create, or reference the legacy runtime dir — runtime state lives ONLY under `.litcodex/lit-loop`.
import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { redactSecretsInValue } from "./redaction.js";
import { LIT_LOOP_GOALS, litLoopBriefPath, litLoopDir, litLoopEvidenceDir, litLoopGoalsPath, litLoopLedgerPath, litLoopRelativeDir, normalizeSessionId, repoRelative, } from "./state-paths.js";
import { isGoalId, iso, isUserModel, LitLoopStateError, } from "./state-types.js";
// Re-export the path-layer scope helpers M09/M11 import via the store barrel.
export { evidencePath, resolveLoopScope } from "./state-paths.js";
/** Alias of `litLoopDir` under the name M09 (loop model) and M11 (doctor) import. */
export function resolveLoopStateDir(repoRoot, scope) {
    return litLoopDir(repoRoot, scope);
}
// ── errno helpers ────────────────────────────────────────────────────────────
function errnoCode(err) {
    return typeof err === "object" && err !== null && "code" in err
        ? err.code
        : undefined;
}
function writeFailed(message, cause, details) {
    return new LitLoopStateError(message, "LIT_LOOP_WRITE_FAILED", {
        cause,
        details: { ...details, cause: errnoCode(cause) },
    });
}
// ── atomic write primitive (tmp in same dir → fsync → rename) ────────────────
async function atomicWrite(targetPath, contents) {
    const dir = join(targetPath, "..");
    const rand = Math.random().toString(36).slice(2, 10);
    const tmp = `${targetPath}.${process.pid}.${Date.now()}.${rand}.tmp`;
    let handle;
    try {
        handle = await open(tmp, "w");
        await handle.writeFile(contents, "utf8");
        await handle.sync(); // fsync: durability of tmp bytes before publish
        await handle.close();
        handle = undefined;
        await rename(tmp, targetPath); // POSIX rename over existing target is atomic
    }
    catch (err) {
        if (handle !== undefined) {
            await handle.close().catch(() => undefined);
        }
        await unlink(tmp).catch(() => undefined); // best-effort cleanup; prior target untouched
        throw writeFailed(`failed to write ${repoRelative(targetPath, dir)}`, err, { path: targetPath });
    }
}
// ── plan validation (the single schema gate, A3 C7 + addendum §B.3) ──────────
function isIsoString(v) {
    return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
}
function field(obj, key) {
    return obj[key];
}
function validateGoal(goal) {
    if (typeof goal !== "object" || goal === null) {
        return false;
    }
    if (!isGoalId(field(goal, "id"))) {
        return false;
    }
    if (typeof field(goal, "title") !== "string" || typeof field(goal, "objective") !== "string") {
        return false;
    }
    const statuses = ["pending", "in_progress", "complete", "failed", "blocked"];
    const status = field(goal, "status");
    if (typeof status !== "string" || !statuses.includes(status)) {
        return false;
    }
    const attempt = field(goal, "attempt");
    if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0) {
        return false;
    }
    if (!isIsoString(field(goal, "createdAt")) || !isIsoString(field(goal, "updatedAt"))) {
        return false;
    }
    const successCriteria = field(goal, "successCriteria");
    if (!Array.isArray(successCriteria)) {
        return false;
    }
    const critStatuses = ["pending", "pass", "fail", "blocked"];
    for (const crit of successCriteria) {
        if (typeof crit !== "object" || crit === null) {
            return false;
        }
        const id = field(crit, "id");
        if (typeof id !== "string" || !/^C\d{3}$/.test(id)) {
            return false;
        }
        if (typeof field(crit, "scenario") !== "string" || typeof field(crit, "expectedEvidence") !== "string") {
            return false;
        }
        if (!isUserModel(field(crit, "userModel"))) {
            return false; // REJECTS "adversarial" and any non-3-value model
        }
        const cs = field(crit, "status");
        if (typeof cs !== "string" || !critStatuses.includes(cs)) {
            return false;
        }
        const cap = field(crit, "capturedEvidence");
        if (!(cap === null || typeof cap === "string")) {
            return false;
        }
    }
    return true;
}
/** Structural plan validation. Returns the reason string on failure, or null when valid. */
function planInvalidReason(plan) {
    if (typeof plan !== "object" || plan === null) {
        return "plan is not an object";
    }
    if (field(plan, "version") !== 1) {
        return `version must be 1 (got ${JSON.stringify(field(plan, "version"))})`;
    }
    if (!isIsoString(field(plan, "createdAt")) || !isIsoString(field(plan, "updatedAt"))) {
        return "createdAt/updatedAt must be ISO-8601 strings";
    }
    for (const f of ["briefPath", "goalsPath", "ledgerPath", "evidenceDir"]) {
        if (typeof field(plan, f) !== "string") {
            return `${f} must be a string`;
        }
    }
    const sessionId = field(plan, "sessionId");
    if (!(sessionId === null || typeof sessionId === "string")) {
        return "sessionId must be a string or null";
    }
    const codexGoalMode = field(plan, "codexGoalMode");
    if (codexGoalMode !== undefined && codexGoalMode !== "aggregate" && codexGoalMode !== "per_story") {
        return "codexGoalMode must be aggregate or per_story when present";
    }
    const codexObjective = field(plan, "codexObjective");
    if (codexObjective !== undefined && typeof codexObjective !== "string") {
        return "codexObjective must be a string when present";
    }
    const goals = field(plan, "goals");
    if (!Array.isArray(goals)) {
        return "goals must be an array";
    }
    for (const goal of goals) {
        if (!validateGoal(goal)) {
            return "a goal failed schema validation";
        }
    }
    const activeGoalId = field(plan, "activeGoalId");
    if (activeGoalId !== undefined) {
        if (typeof activeGoalId !== "string") {
            return "activeGoalId must be a string when present";
        }
        const ids = new Set(goals.map((g) => g.id));
        if (!ids.has(activeGoalId)) {
            return `activeGoalId ${JSON.stringify(activeGoalId)} does not match any goal`;
        }
    }
    return null;
}
function validatePlan(plan) {
    const reason = planInvalidReason(plan);
    if (reason !== null) {
        throw new LitLoopStateError(`invalid lit-loop plan: ${reason}`, "LIT_LOOP_PLAN_INVALID", {
            details: { reason },
        });
    }
}
// ── existence probe (A3 C6: false ONLY on ENOENT, throws WRITE_FAILED otherwise) ──
function assertAbsolute(absPath) {
    if (typeof absPath !== "string" || !isAbsolute(absPath)) {
        throw new LitLoopStateError(`path must be absolute (got ${JSON.stringify(absPath)})`, "LIT_LOOP_REPO_ROOT_INVALID", { details: { absPath } });
    }
}
export async function statExists(absPath) {
    assertAbsolute(absPath);
    try {
        await stat(absPath);
        return true;
    }
    catch (err) {
        if (errnoCode(err) === "ENOENT") {
            return false;
        }
        // A permission / IO / loop error MUST NOT masquerade as "absent".
        throw writeFailed(`stat failed for ${absPath}`, err, { path: absPath });
    }
}
// ── brief-file read (M09-addendum §A1.1: inert data, no normalization) ───────
export class BriefFileMissingError extends Error {
    constructor(path, cause) {
        super(`brief file not found or not a regular file: ${path}`, cause === undefined ? undefined : { cause });
        this.name = "BriefFileMissingError";
        this.path = path;
    }
}
export class BriefFileUnreadableError extends Error {
    constructor(path, cause) {
        super(`brief file is unreadable: ${path}`, cause === undefined ? undefined : { cause });
        this.name = "BriefFileUnreadableError";
        this.path = path;
    }
}
/**
 * Read `briefFilePath` as INERT UTF-8 text. The path is used AS GIVEN — no normalization, no
 * re-rooting against `repoRoot`, no rejection (the bytes are data, never re-interpreted as a
 * path/flag). ENOENT/EISDIR → BriefFileMissingError; EACCES/EIO → BriefFileUnreadableError.
 */
export async function readBriefFile(_repoRoot, briefFilePath) {
    try {
        return await readFile(briefFilePath, "utf8");
    }
    catch (err) {
        const code = errnoCode(err);
        if (code === "ENOENT" || code === "EISDIR") {
            throw new BriefFileMissingError(briefFilePath, err);
        }
        throw new BriefFileUnreadableError(briefFilePath, err);
    }
}
// ── mutation lock (canonical + alias, SAME reference; A3 C6) ─────────────────
const mutationLocks = new Map();
export function withMutationLock(repoRoot, scope, body) {
    const key = `${repoRoot}\0${litLoopRelativeDir(scope)}`;
    const prior = mutationLocks.get(key) ?? Promise.resolve();
    const run = prior.then(body, body); // run after prior settles either way
    // Store a poison-proof tail so a rejected body never blocks subsequent locks.
    mutationLocks.set(key, run.catch(() => undefined));
    return run;
}
/** @deprecated Alias of `withMutationLock` (SAME function reference, same lock map). */
export const withStateMutationLock = withMutationLock;
// ── writePlan (crash-atomic) ─────────────────────────────────────────────────
export async function writePlan(repoRoot, plan, scope) {
    const redactedPlan = redactSecretsInValue(plan);
    validatePlan(redactedPlan); // throws LIT_LOOP_PLAN_INVALID before any write — never write a bad object
    const dir = litLoopDir(repoRoot, scope);
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (err) {
        throw writeFailed(`failed to create ${dir}`, err, { path: dir });
    }
    await atomicWrite(litLoopGoalsPath(repoRoot, scope), `${JSON.stringify(redactedPlan, null, 2)}\n`);
}
// ── writeBrief (atomic, intentional overwrite; addendum §A) ──────────────────
export async function writeBrief(repoRoot, brief, scope) {
    const dir = litLoopDir(repoRoot, scope);
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (err) {
        throw writeFailed(`failed to create ${dir}`, err, { path: dir });
    }
    await atomicWrite(litLoopBriefPath(repoRoot, scope), redactSecretsInValue(brief));
}
export async function readBrief(repoRoot, scope) {
    try {
        return await readFile(litLoopBriefPath(repoRoot, scope), "utf8");
    }
    catch (err) {
        if (errnoCode(err) === "ENOENT") {
            throw new LitLoopStateError(`lit-loop brief not found at ${repoRelative(litLoopBriefPath(repoRoot, scope), repoRoot)}`, "LIT_LOOP_PLAN_MISSING", { details: { path: repoRelative(litLoopBriefPath(repoRoot, scope), repoRoot) } });
        }
        throw writeFailed("failed to read brief", err);
    }
}
// ── appendLedger (append-only, never read-modify-write) ──────────────────────
export async function appendLedger(repoRoot, entry, scope) {
    const dir = litLoopDir(repoRoot, scope);
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (err) {
        throw writeFailed(`failed to create ${dir}`, err, { path: dir });
    }
    const filled = redactSecretsInValue({ ...entry, at: entry.at ?? iso() });
    try {
        await appendFile(litLoopLedgerPath(repoRoot, scope), `${JSON.stringify(filled)}\n`, "utf8");
    }
    catch (err) {
        throw writeFailed("failed to append ledger entry", err, { kind: entry.kind });
    }
}
export async function readLedger(repoRoot, scope) {
    let raw;
    try {
        raw = await readFile(litLoopLedgerPath(repoRoot, scope), "utf8");
    }
    catch (err) {
        if (errnoCode(err) === "ENOENT") {
            return { entries: [], skipped: 0 };
        }
        throw writeFailed("failed to read ledger", err);
    }
    const entries = [];
    let skipped = 0;
    for (const line of raw.split(/\r?\n/)) {
        if (line.trim() === "") {
            continue;
        }
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            skipped += 1; // fail-open: one bad line never blinds the audit trail
        }
    }
    return { entries, skipped };
}
// ── ensureEvidenceDir ────────────────────────────────────────────────────────
export async function ensureEvidenceDir(repoRoot, scope) {
    const dir = litLoopEvidenceDir(repoRoot, scope);
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (err) {
        throw writeFailed(`failed to create ${dir}`, err, { path: dir });
    }
    return dir;
}
// ── corruption recovery (backup + report + ledger; NEVER auto-recreate) ──────
function compactIso() {
    // e.g. 20260613T090100Z — filesystem-safe, sortable.
    return iso()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
}
function sha256(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}
async function readReusableRecovery(repoRoot, dir, reportPath, rawHash, byteLength) {
    try {
        const report = JSON.parse(await readFile(reportPath, "utf8"));
        if (report.file !== LIT_LOOP_GOALS ||
            report.byteLength !== byteLength ||
            report.sha256 !== rawHash ||
            typeof report.backup !== "string") {
            return undefined;
        }
        const backupPath = join(repoRoot, report.backup);
        if (!backupPath.startsWith(`${dir}/`))
            return undefined;
        await stat(backupPath);
        return { backupPath, report: report };
    }
    catch {
        return undefined;
    }
}
async function recoverCorrupt(repoRoot, scope, raw, cause) {
    const dir = litLoopDir(repoRoot, scope);
    const goalsPath = litLoopGoalsPath(repoRoot, scope);
    const reason = cause instanceof Error ? cause.message : String(cause);
    const reportPath = join(dir, "state-recovery.json");
    const byteLength = Buffer.byteLength(raw, "utf8");
    const rawHash = sha256(raw);
    const reusable = await readReusableRecovery(repoRoot, dir, reportPath, rawHash, byteLength);
    const backupPath = reusable?.backupPath ?? `${goalsPath}.corrupt-${compactIso()}.bak`;
    // 1. Preserve the exact bad bytes for forensics — never delete the user's data.
    if (reusable === undefined) {
        await writeFile(backupPath, raw, "utf8").catch(() => undefined);
    }
    // 2. Machine-readable recovery report.
    const report = reusable?.report ?? {
        at: iso(),
        file: LIT_LOOP_GOALS,
        backup: repoRelative(backupPath, repoRoot),
        reason,
        byteLength,
        sha256: rawHash,
    };
    if (reusable === undefined) {
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8").catch(() => undefined);
    }
    // 3. Best-effort ledger line (recovery does not depend on the ledger succeeding).
    await appendLedger(repoRoot, {
        at: iso(),
        kind: "state_recovered",
        message: `lit-loop plan corrupt: ${reason}`,
        before: { backup: report.backup },
    }, scope).catch(() => undefined);
    throw new LitLoopStateError(`lit-loop plan at ${repoRelative(goalsPath, repoRoot)} is corrupt; backed up.`, "LIT_LOOP_PLAN_CORRUPT", { cause, details: { backup: report.backup, report: repoRelative(reportPath, repoRoot) } });
}
// ── readPlan ─────────────────────────────────────────────────────────────────
export async function readPlan(repoRoot, scope) {
    const goalsPath = litLoopGoalsPath(repoRoot, scope);
    let raw;
    try {
        raw = await readFile(goalsPath, "utf8");
    }
    catch (err) {
        if (errnoCode(err) === "ENOENT") {
            throw new LitLoopStateError(`lit-loop plan not found at ${repoRelative(goalsPath, repoRoot)}`, "LIT_LOOP_PLAN_MISSING", { details: { path: repoRelative(goalsPath, repoRoot) } });
        }
        throw writeFailed(`failed to read ${goalsPath}`, err, { path: goalsPath });
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        return recoverCorrupt(repoRoot, scope, raw, err);
    }
    const reason = planInvalidReason(parsed);
    if (reason !== null) {
        return recoverCorrupt(repoRoot, scope, raw, new LitLoopStateError(reason, "LIT_LOOP_PLAN_INVALID", { details: { reason } }));
    }
    return parsed;
}
// ── initState (idempotent; dir → brief → plan → ledger) ──────────────────────
export async function initState(repoRoot, args) {
    const scope = { sessionId: args.sessionId ?? null };
    const dir = litLoopDir(repoRoot, scope); // asserts repoRoot absolute
    try {
        await mkdir(dir, { recursive: true });
        await mkdir(litLoopEvidenceDir(repoRoot, scope), { recursive: true });
    }
    catch (err) {
        throw writeFailed(`failed to create ${dir}`, err, { path: dir });
    }
    // brief.md — write only if absent (never clobber a human-edited brief).
    const briefPath = litLoopBriefPath(repoRoot, scope);
    if (!(await statExists(briefPath))) {
        await atomicWrite(briefPath, redactSecretsInValue(args.brief));
    }
    // goals.json — return an existing valid plan unchanged (idempotent).
    if (await statExists(litLoopGoalsPath(repoRoot, scope))) {
        const existing = await readPlan(repoRoot, scope);
        return existing;
    }
    const now = iso();
    const sessionId = normalizeSessionId(args.sessionId);
    const plan = {
        version: 1,
        createdAt: now,
        updatedAt: now,
        briefPath: repoRelative(briefPath, repoRoot),
        goalsPath: repoRelative(litLoopGoalsPath(repoRoot, scope), repoRoot),
        ledgerPath: repoRelative(litLoopLedgerPath(repoRoot, scope), repoRoot),
        evidenceDir: repoRelative(litLoopEvidenceDir(repoRoot, scope), repoRoot),
        sessionId,
        goals: [],
    };
    await writePlan(repoRoot, plan, scope);
    await appendLedger(repoRoot, { at: now, kind: "plan_created", message: "Initialized lit-loop state" }, scope);
    return plan;
}
// ── exit-code mapping (A3 C7 corrected + addendum §A.2: 3/4/5) ───────────────
export function exitCodeFor(err) {
    if (err instanceof LitLoopStateError) {
        switch (err.code) {
            case "LIT_LOOP_PLAN_MISSING":
                return 3;
            case "LIT_LOOP_PLAN_CORRUPT":
                return 4;
            case "LIT_LOOP_WRITE_FAILED":
                return 5;
            case "LIT_LOOP_PLAN_INVALID":
            case "LIT_LOOP_EVIDENCE_NAME_UNSAFE":
            case "LIT_LOOP_REPO_ROOT_INVALID":
                return 2;
            default:
                return 1;
        }
    }
    return 1;
}
