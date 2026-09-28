// src/hook-cli.ts — M06 process adapter (A2 §2.4, A3 addendum A3/A4).
//
// The ONLY module that touches process streams + exit codes for the hook route. Reads stdin to a
// UTF-8 string defensively, then BOM-strip → empty-check → JSON.parse (in that exact order, A3 A4),
// hands the parsed value to the pure engine, and writes the decision. Exit map: any structurally
// valid event → 0 (no-op writes zero bytes); unparseable or oversized stdin → 2 with a
// machine-readable LitHookError JSON line on stderr. NEVER calls process.exit (the dispatcher does)
// and NEVER throws.
import { isAbsolute } from "node:path";
import { applyPreToolUseCreateGoalGuard, runUserPromptSubmitHook } from "./codex-hook.js";
import { evaluatePlanPersistence, formatStopBlockOutput, recordLitPlanActivation } from "./plan-persistence.js";
/** Hard cap on stdin to bound memory / ReDoS exposure inside the 5 s Codex hook budget. 8 MB. */
export const MAX_STDIN_BYTES = 8_000_000;
const INVALID_JSON_MESSAGE = "lit hook: stdin was not valid JSON";
const TOO_LARGE_MESSAGE = `lit hook: stdin exceeded ${MAX_STDIN_BYTES} bytes`;
function errorLine(code, message) {
    const payload = { ok: false, error: { code, message } };
    return `${JSON.stringify(payload)}\n`;
}
/**
 * Read stdin to completion, enforcing MAX_STDIN_BYTES per chunk on the raw byte total BEFORE any
 * decode (A3 A3). Resolves the decoded UTF-8 string, or `null` if the cap was exceeded (in which
 * case the stream is destroyed and no decode/parse is attempted on the over-limit buffer).
 */
function readStdin(stdin) {
    return new Promise((resolve) => {
        const chunks = [];
        let total = 0;
        let settled = false;
        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };
        stdin.on("data", (chunk) => {
            const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
            total += buf.length;
            if (total > MAX_STDIN_BYTES) {
                // Stop reading and abandon the over-limit buffer without decoding/parsing it.
                stdin.pause();
                const destroy = stdin.destroy;
                if (typeof destroy === "function") {
                    destroy.call(stdin);
                }
                finish(null);
                return;
            }
            chunks.push(buf);
        });
        stdin.on("end", () => {
            finish(Buffer.concat(chunks).toString("utf8"));
        });
        stdin.on("error", () => {
            // Treat a stream error like end-of-input over what we collected; the parse step decides.
            finish(Buffer.concat(chunks).toString("utf8"));
        });
        stdin.on("close", () => {
            finish(Buffer.concat(chunks).toString("utf8"));
        });
    });
}
/**
 * Stream-driven entry point. Resolves exactly one exit code (0 or 2); NEVER calls process.exit and
 * NEVER throws. Writes the camelCase activation line to stdout (empty on no-op), or a LitHookError
 * line to stderr on malformed / oversized stdin.
 */
export async function runUserPromptSubmitHookCli(stdin, stdout, stderr, repoRoot = process.cwd()) {
    const decoded = await readStdin(stdin);
    if (decoded === null) {
        stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
        return 2;
    }
    // A3 A4 ordering: strip ONE leading BOM, then empty-check, then parse.
    let raw = decoded;
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    if (raw.trim().length === 0) {
        return 0;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
        return 2;
    }
    const decision = runUserPromptSubmitHook(parsed);
    if (decision.kind === "inject" && decision.mode === "lit-plan") {
        const scope = hookSessionScope(parsed, repoRoot);
        if (scope !== null)
            recordLitPlanActivation(scope.cwd, scope.sessionId);
    }
    if (decision.kind === "inject")
        stdout.write(decision.stdout);
    return 0;
}
/** Read `{ session_id, cwd }` from a hook event; `cwd` falls back to `repoRoot` when absent or relative. */
function hookSessionScope(parsed, repoRoot) {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return null;
    const record = parsed;
    const sessionId = record["session_id"];
    if (typeof sessionId !== "string" || sessionId.length === 0)
        return null;
    const cwd = record["cwd"];
    return { sessionId, cwd: typeof cwd === "string" && isAbsolute(cwd) ? cwd : repoRoot };
}
/** Enforce lit-plan persistence when a Stop hook event arrives. */
export async function runStopPlanPersistenceHookCli(stdin, stdout, stderr, repoRoot = process.cwd()) {
    const decoded = await readStdin(stdin);
    if (decoded === null) {
        stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
        return 2;
    }
    let raw = decoded;
    if (raw.charCodeAt(0) === 0xfeff)
        raw = raw.slice(1);
    if (raw.trim().length === 0)
        return 0;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
        return 2;
    }
    const scope = hookSessionScope(parsed, repoRoot);
    if (scope !== null) {
        const persistence = evaluatePlanPersistence(scope.cwd, scope.sessionId);
        if (persistence.decision === "block")
            stdout.write(formatStopBlockOutput(persistence.reason));
    }
    return 0;
}
export async function runPreToolUseCreateGoalGuardCli(stdin, stdout, stderr) {
    const decoded = await readStdin(stdin);
    if (decoded === null) {
        stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
        return 2;
    }
    let raw = decoded;
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    if (raw.trim().length === 0) {
        return 0;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
        return 2;
    }
    const decision = applyPreToolUseCreateGoalGuard(parsed);
    if (decision.kind === "deny") {
        stdout.write(decision.stdout);
    }
    return 0;
}
