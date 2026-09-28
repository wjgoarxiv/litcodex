#!/usr/bin/env node
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { runStopHook, runUserPromptSubmitHook } from "./codex-hook.js";
import { initializeWork, isBoundedLifecycleText, START_WORK_MAX_DISPLAY_BYTES, START_WORK_MAX_STDIN_BYTES, transitionWork, } from "./lifecycle-store.js";
import { analyzePlanProgress } from "./plan-progress.js";
import { PlanPublisherError, publishPlan } from "./plan-publisher.js";
import { diagnoseLifecycle } from "./work-state-reader.js";
const USAGE = "Usage: litcodex-start-work-continuation init | analyze-plan | publish-plan --cwd <path> --slug <slug> | hook <stop|user-prompt-submit> | transition <pause|cancel|complete> | doctor --cwd <path> --json\n";
const command = process.argv[2];
const subcommand = process.argv[3];
const publishPlanArgs = command === "publish-plan" ? parsePublishPlanArgs(process.argv.slice(3)) : null;
if (command === "init" && subcommand === undefined) {
    await runInitCli();
}
else if (command === "analyze-plan" && subcommand === undefined) {
    await runAnalyzePlanCli();
}
else if (publishPlanArgs !== null) {
    await runPublishPlanCli(publishPlanArgs);
}
else if (command === "hook" && (subcommand === "stop" || subcommand === "user-prompt-submit")) {
    await runHookCli(subcommand);
}
else if (command === "hook" && subcommand === "subagent-stop") {
    process.exitCode = 0;
}
else if (command === "transition" && isCliTransitionAction(subcommand)) {
    await runTransitionCli(subcommand);
}
else if (command === "doctor" &&
    process.argv[3] === "--cwd" &&
    process.argv[5] === "--json" &&
    process.argv.length === 6) {
    runDoctorCli(process.argv[4]);
}
else {
    process.stderr.write(USAGE);
    process.exitCode = 1;
}
async function runHookCli(kind) {
    const raw = await readStdin();
    if (raw === null || raw.trim().length === 0)
        return;
    const parsed = parseJson(raw);
    if (parsed === undefined)
        return;
    const output = kind === "stop" ? runStopHook(parsed) : runUserPromptSubmitHook(parsed);
    if (output.length > 0)
        processStdout.write(output);
}
async function runTransitionCli(action) {
    const raw = await readStdin();
    if (raw === null)
        return fail("INPUT_TOO_LARGE", "transition stdin exceeded its byte limit");
    const parsed = parseJson(raw);
    if (!isTransitionCliInput(parsed, action))
        return fail("INPUT_INVALID", "transition stdin must match the strict JSON schema");
    try {
        const result = transitionWork(parsed.cwd, {
            action,
            expectedRevision: parsed.expected_revision,
            sessionId: parsed.session_id,
            transitionId: parsed.transition_id,
            workId: parsed.work_id,
            reasonCode: parsed.reason_code,
            ...(parsed.boundary === undefined ? {} : { boundary: parsed.boundary }),
            ...(parsed.grant === undefined ? {} : { grant: parsed.grant }),
            ...(parsed.authority === undefined
                ? {}
                : {
                    authority: {
                        authorityId: parsed.authority.authority_id,
                        allowedRoots: parsed.authority.allowed_roots,
                        allowedActions: parsed.authority.allowed_actions,
                        forbiddenActions: parsed.authority.forbidden_actions,
                    },
                }),
        });
        const work = result.state.works[result.event.workId];
        if (work === undefined)
            return fail("STATE_INVALID", "active work disappeared");
        processStdout.write(`${JSON.stringify({ ok: true, changed: result.changed, revision: result.state.revision, status: work.status, kind: result.event.kind })}\n`);
    }
    catch (error) {
        return fail("TRANSITION_FAILED", error instanceof Error ? error.message : "transition failed");
    }
}
async function runInitCli() {
    const raw = await readStdin();
    if (raw === null)
        return fail("INPUT_TOO_LARGE", "init stdin exceeded its byte limit");
    const parsed = parseJson(raw);
    if (!isInitCliInput(parsed))
        return fail("INPUT_INVALID", "init stdin must match the strict JSON schema");
    try {
        const result = initializeWork(parsed.cwd, {
            initId: parsed.init_id,
            expectedRevision: parsed.expected_revision,
            workId: parsed.work_id,
            plan: parsed.plan,
            planName: parsed.plan_name,
            sessionId: parsed.session_id,
            worktreePath: parsed.worktree_path,
            authority: {
                authorityId: parsed.authority.authority_id,
                allowedRoots: parsed.authority.allowed_roots,
                allowedActions: parsed.authority.allowed_actions,
                forbiddenActions: parsed.authority.forbidden_actions,
            },
        });
        const work = result.state.works[result.event.workId];
        if (work === undefined)
            return fail("STATE_INVALID", "initialized work disappeared");
        processStdout.write(`${JSON.stringify({ ok: true, changed: result.changed, revision: result.state.revision, status: work.status, kind: result.event.kind })}\n`);
    }
    catch (error) {
        return fail("INIT_FAILED", error instanceof Error ? error.message : "init failed");
    }
}
async function runAnalyzePlanCli() {
    const markdown = await readStdin();
    if (markdown === null)
        return fail("INPUT_TOO_LARGE", "plan stdin exceeded its byte limit");
    const progress = analyzePlanProgress(markdown);
    if (!progress.contractValid)
        return fail("PLAN_EMPTY", "start-work plan requires real Todos and final verification checkbox rows");
    processStdout.write(`${JSON.stringify({ ok: true, progress })}\n`);
}
async function runPublishPlanCli(args) {
    const markdown = await readStdin();
    if (markdown === null)
        return fail("INPUT_TOO_LARGE", "plan stdin exceeded its byte limit");
    try {
        const result = publishPlan(args.cwd, args.slug, markdown);
        processStdout.write(`${JSON.stringify({ ok: true, path: result.path, progress: result.progress })}\n`);
    }
    catch (error) {
        if (error instanceof PlanPublisherError)
            return fail(error.code, error.message);
        return fail("PLAN_WRITE_FAILED", "atomic plan write failed");
    }
}
function runDoctorCli(cwd) {
    if (!isBoundedLifecycleText(cwd)) {
        fail("INPUT_INVALID", "doctor cwd is invalid");
        return;
    }
    const diagnostic = diagnoseLifecycle(cwd);
    processStdout.write(`${JSON.stringify(diagnostic)}\n`);
    if (!diagnostic.ok)
        process.exitCode = 2;
}
function fail(code, message) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.exitCode = 2;
}
function isTransitionCliInput(value, action) {
    if (!isRecord(value))
        return false;
    const allowed = new Set([
        "cwd",
        "session_id",
        "expected_revision",
        "transition_id",
        "work_id",
        "reason_code",
        "boundary",
        "grant",
        "authority",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
        return false;
    const basic = isBoundedLifecycleText(value["cwd"]) &&
        isBoundedLifecycleText(value["session_id"]) &&
        Number.isSafeInteger(value["expected_revision"]) &&
        value["expected_revision"] >= 0 &&
        isBoundedLifecycleText(value["transition_id"]) &&
        isBoundedLifecycleText(value["work_id"]) &&
        isReasonCode(value["reason_code"]);
    if (!basic)
        return false;
    const boundary = value["boundary"] === undefined ? undefined : parseBoundary(value["boundary"]);
    const grant = value["grant"] === undefined ? undefined : parseGrant(value["grant"]);
    const authority = value["authority"] === undefined ? undefined : parseAuthority(value["authority"]);
    if ((value["boundary"] !== undefined && boundary === undefined) ||
        (value["grant"] !== undefined && grant === undefined)) {
        return false;
    }
    if (value["authority"] !== undefined && authority === undefined)
        return false;
    if (action === "pause")
        return boundary !== undefined && grant === undefined && isPauseReason(value["reason_code"]);
    if (action === "resume")
        return boundary !== undefined && grant !== undefined && value["reason_code"] === "explicit_user_resume";
    return boundary === undefined && grant === undefined;
}
function isInitCliInput(value) {
    if (!isRecord(value))
        return false;
    const allowed = new Set([
        "cwd",
        "init_id",
        "expected_revision",
        "work_id",
        "plan",
        "plan_name",
        "session_id",
        "worktree_path",
        "authority",
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key)) || !isRecord(value["authority"]))
        return false;
    const authority = value["authority"];
    const authorityKeys = new Set(["authority_id", "allowed_roots", "allowed_actions", "forbidden_actions"]);
    if (Object.keys(authority).some((key) => !authorityKeys.has(key)))
        return false;
    return (isBoundedLifecycleText(value["cwd"]) &&
        isBoundedLifecycleText(value["init_id"]) &&
        Number.isSafeInteger(value["expected_revision"]) &&
        value["expected_revision"] >= 0 &&
        isBoundedLifecycleText(value["work_id"]) &&
        isBoundedLifecycleText(value["plan"]) &&
        isBoundedLifecycleText(value["plan_name"], START_WORK_MAX_DISPLAY_BYTES) &&
        isBoundedLifecycleText(value["session_id"]) &&
        (value["worktree_path"] === null || isBoundedLifecycleText(value["worktree_path"])) &&
        parseAuthority(authority) !== undefined);
}
function isCliTransitionAction(value) {
    return value === "pause" || value === "cancel" || value === "complete";
}
function parsePublishPlanArgs(args) {
    if (args.length !== 4 || args[0] !== "--cwd" || args[2] !== "--slug")
        return null;
    const cwd = args[1];
    const slug = args[3];
    return typeof cwd === "string" && cwd.length > 0 && typeof slug === "string" && slug.length > 0
        ? { cwd, slug }
        : null;
}
function parseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return undefined;
        throw error;
    }
}
function readStdin() {
    return new Promise((resolve) => {
        const chunks = [];
        let bytes = 0;
        let oversized = false;
        processStdin.on("data", (chunk) => {
            const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            bytes += buffer.byteLength;
            if (bytes > START_WORK_MAX_STDIN_BYTES) {
                oversized = true;
                chunks.length = 0;
                return;
            }
            if (!oversized)
                chunks.push(buffer);
        });
        processStdin.once("error", () => resolve(oversized ? null : Buffer.concat(chunks).toString("utf8")));
        processStdin.once("end", () => resolve(oversized ? null : Buffer.concat(chunks).toString("utf8")));
    });
}
function isBoundedStringArray(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 64 &&
        value.every((item) => isBoundedLifecycleText(item)));
}
function isReasonCode(value) {
    return (value === "authorization_required" ||
        value === "credential_required" ||
        value === "host_capability_required" ||
        value === "explicit_user_resume" ||
        value === "user_cancelled" ||
        value === "completed");
}
function parseAuthority(value) {
    if (!isRecord(value))
        return undefined;
    const keys = new Set(["authority_id", "allowed_roots", "allowed_actions", "forbidden_actions"]);
    if (Object.keys(value).some((key) => !keys.has(key)))
        return undefined;
    return isBoundedLifecycleText(value["authority_id"]) &&
        isBoundedStringArray(value["allowed_roots"]) &&
        isBoundedStringArray(value["allowed_actions"]) &&
        isBoundedStringArray(value["forbidden_actions"])
        ? {
            authority_id: value["authority_id"],
            allowed_roots: value["allowed_roots"],
            allowed_actions: value["allowed_actions"],
            forbidden_actions: value["forbidden_actions"],
        }
        : undefined;
}
function parseBoundary(value) {
    if (!isRecord(value))
        return undefined;
    const keys = new Set(["boundary_id", "authority_id", "action", "root"]);
    if (Object.keys(value).some((key) => !keys.has(key)))
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
    const keys = new Set(["grant_id", "authority_id", "boundary_id", "action", "root"]);
    if (Object.keys(value).some((key) => !keys.has(key)))
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
function isPauseReason(value) {
    return value === "authorization_required" || value === "credential_required" || value === "host_capability_required";
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
