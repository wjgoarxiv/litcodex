// src/jev-hint.ts — optional Jev skill hint for the UserPromptSubmit hook.
//
// Off by default. Active only when `LITCODEX_JEV=1` AND a non-empty `TYPESAFE_API_KEY` are both in
// the hook's environment. On an eligible turn (not a slash command, not an explicit `$skill` mention,
// not already routed by the deterministic lit router, at least 4 non-space characters) it sends the
// redacted, truncated prompt text to Jev with one Choice question over this plugin's own implicitly
// invocable skills, and returns at most one fixed advisory sentence naming a validated skill id.
//
// The response is untrusted: only an exact catalog id (or `none`) with a numeric confidence at or
// above the threshold is accepted, and no response text ever reaches the model context. Every
// failure falls back to today's behavior, with one short visible note per session. With
// `LITCODEX_JEV_SHOW=1` as well, a hinted turn also shows one visible line naming the skill id and
// latency. Whenever the hint is on, the first prompt of each session the router leaves alone also shows
// a once-per-session plain-text banner (`JEV_ON_BANNER`). The key is read from the environment only and is never written to output, errors, state,
// or the trace.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, unlinkSync, writeSync, } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { isExactBrowserDrivePrompt } from "./browser-drive-route.js";
import { isExactBareHandoffPrompt } from "./handoff-route.js";
import { resolveSkillPath } from "./modes.js";
import { isExactBareScientificVisualizationPrompt } from "./scientific-visualization-route.js";
import { matchRenamedSkillInvocation } from "./skill-renames.js";
import { normalizeSessionId } from "./state-paths.js";
import { maskMarkdownCode, matchLitTrigger } from "./trigger.js";
export const JEV_FLAG_ENV = "LITCODEX_JEV";
export const JEV_KEY_ENV = "TYPESAFE_API_KEY";
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-1.13.0";
export const JEV_DEFAULT_TIMEOUT_MS = 1_500;
export const JEV_MAX_TIMEOUT_MS = 3_000;
export const JEV_DEFAULT_MAX_CALLS = 200;
export const JEV_DEFAULT_MIN_CONFIDENCE = 0.35;
export const JEV_MAX_PROMPT_CHARS = 2_000;
export const JEV_REDACTION_WINDOW_CHARS = 8_000;
export const JEV_MAX_DESCRIPTION_CHARS = 300;
export const JEV_MAX_BODY_BYTES = 64 * 1024;
export const JEV_STATE_DIR = ".litcodex/jev";
const QUESTION_INSTRUCTIONS = "Which one skill, if any, is the best fit for the user's request? Choose none when no catalog skill fits.";
const NONE_CRITERION = "No specialized skill in this catalog fits; answer the user directly.";
const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FRONTMATTER_READ_BYTES = 16 * 1024;
/** The doctor/status state. Never reveals the key or its length. */
export function jevSwitchState(env) {
    if (env[JEV_FLAG_ENV] !== "1")
        return "off";
    return (env[JEV_KEY_ENV]?.trim() ?? "") !== "" ? "on" : "flag on but TYPESAFE_API_KEY missing";
}
// ── Redaction ────────────────────────────────────────────────────────────────
// The user name runs to the next separator and never ends in a dot, so `/Users/alice.` keeps its full stop.
const HOME_PATHS = [
    /\/(?:Users|home)\/[^/\\\s,;:"'`()[\]<>{}]*[^/\\\s,;:"'`()[\]<>{}.](\/)?/g,
    /[A-Za-z]:\\Users\\[^/\\\s,;:"'`()[\]<>{}]*[^/\\\s,;:"'`()[\]<>{}.](\\)?/gi,
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const TOKEN_SHAPES = [
    /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g,
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g,
    /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
    /\bsk-[A-Za-z0-9_-]{16,}/g,
    /\bgh[op]_[A-Za-z0-9]{16,}/g,
    /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
    /\bnpm_[A-Za-z0-9]{16,}/g,
    /\bapikey_[A-Za-z0-9_-]{8,}/gi,
    /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
    /\bAKIA[A-Z0-9]{16}\b/g,
    /\bAIza[A-Za-z0-9_-]{20,}/g,
    /[A-Za-z0-9+/_-]{32,}={0,2}/g,
];
const TRAILING_TOKEN_RUN = /[A-Za-z0-9+/_-]{8,}={0,2}$/;
/**
 * Redact an 8,000-character window (home paths, e-mail addresses, the literal key and token-shaped
 * strings, in that order), then cut to 2,000 characters. A run of 8 or more token characters left at
 * the cut is part of something the cut split, so it becomes `[secret]` too.
 */
export function redactJevPrompt(prompt, key = "") {
    let text = Array.from(prompt).slice(0, JEV_REDACTION_WINDOW_CHARS).join("");
    for (const pattern of HOME_PATHS)
        text = text.replace(pattern, (_match, separator) => (separator ? "~/" : "~"));
    text = text.replace(EMAIL, "[email]");
    if (key !== "")
        text = text.split(key).join("[secret]");
    for (const pattern of TOKEN_SHAPES)
        text = text.replace(pattern, "[secret]");
    const chars = Array.from(text);
    if (chars.length <= JEV_MAX_PROMPT_CHARS)
        return text;
    return chars.slice(0, JEV_MAX_PROMPT_CHARS).join("").replace(TRAILING_TOKEN_RUN, "[secret]");
}
/** The installed plugin's `skills/` directory, resolved the same way the mode router finds bodies. */
export function defaultJevSkillsRoot() {
    return dirname(dirname(resolveSkillPath("lit-loop")));
}
function readHead(path) {
    let fd;
    try {
        fd = openSync(path, "r");
        const buffer = Buffer.alloc(FRONTMATTER_READ_BYTES);
        const read = readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, read).toString("utf8");
    }
    catch {
        return null;
    }
    finally {
        if (fd !== undefined)
            closeSync(fd);
    }
}
function frontmatterValue(raw) {
    const value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === "string")
                return parsed;
        }
        catch {
            return value.slice(1, -1);
        }
    }
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        return value.slice(1, -1).replace(/''/g, "'");
    return value;
}
function readFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (match?.[1] === undefined)
        return {};
    const out = {};
    for (const line of match[1].split(/\r?\n/)) {
        const field = /^(name|description):\s*(.*)$/.exec(line);
        if (field?.[1] === "name" && field[2] !== undefined)
            out.name = frontmatterValue(field[2]);
        if (field?.[1] === "description" && field[2] !== undefined)
            out.description = frontmatterValue(field[2]);
    }
    return out;
}
function implicitInvocationDisabled(skillDir) {
    try {
        return /^\s*allow_implicit_invocation:\s*false\s*$/m.test(readFileSync(join(skillDir, "agents", "openai.yaml"), "utf8"));
    }
    catch {
        return false;
    }
}
/**
 * This plugin's own skills that the host may load on the model's initiative: every `skills/<id>/SKILL.md`
 * whose frontmatter `name` equals its directory, minus skills whose `agents/openai.yaml` sets
 * `allow_implicit_invocation: false` (those run only on an explicit user invocation).
 */
export function loadJevCatalog(skillsRoot = defaultJevSkillsRoot()) {
    let names;
    try {
        names = readdirSync(skillsRoot).sort();
    }
    catch {
        return [];
    }
    const catalog = [];
    for (const id of names) {
        if (!SKILL_ID.test(id) || id === "none")
            continue;
        const head = readHead(join(skillsRoot, id, "SKILL.md"));
        if (head === null)
            continue;
        const frontmatter = readFrontmatter(head);
        const description = frontmatter.description?.trim() ?? "";
        if (frontmatter.name !== id || description === "")
            continue;
        if (implicitInvocationDisabled(join(skillsRoot, id)))
            continue;
        catalog.push({ id, description: Array.from(description).slice(0, JEV_MAX_DESCRIPTION_CHARS).join("") });
    }
    return catalog;
}
/** Why this turn gets no Jev request, or null when it is eligible. Pure. */
export function jevSkipReason(prompt, catalogIds = new Set()) {
    if (/^\s*\//u.test(prompt))
        return "slash-command";
    for (const mention of prompt.matchAll(/(?:^|\s)\$([A-Za-z0-9_-]+)(:[A-Za-z0-9_-]+)?/gu)) {
        if (mention[2] !== undefined || catalogIds.has((mention[1] ?? "").toLowerCase()))
            return "skill-mention";
    }
    if (matchLitTrigger(prompt) !== null ||
        matchRenamedSkillInvocation(maskMarkdownCode(prompt), Number.POSITIVE_INFINITY) !== null ||
        isExactBareHandoffPrompt(prompt) ||
        isExactBareScientificVisualizationPrompt(prompt) ||
        isExactBrowserDrivePrompt(prompt)) {
        return "routed";
    }
    if (Array.from(prompt.replace(/\s+/gu, "")).length < 4)
        return "too-short";
    return null;
}
export function buildJevRequestBody(model, state, catalog) {
    const criteria = {};
    for (const entry of catalog)
        criteria[entry.id] = entry.description;
    criteria["none"] = NONE_CRITERION;
    return { model, state, questions: { which: { type: "choice", instructions: QUESTION_INSTRUCTIONS, criteria } } };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Validate an already-parsed response against the ids that were sent. Nothing else is trusted. */
export function judgeJevResponse(parsed, catalogIds, minConfidence) {
    const answers = isRecord(parsed) ? parsed["answers"] : undefined;
    const which = isRecord(answers) ? answers["which"] : undefined;
    if (!isRecord(which))
        return { kind: "rejected" };
    const choice = which["choice"];
    const confidence = which["confidence"];
    if (typeof choice !== "string" || (choice !== "none" && !catalogIds.has(choice)))
        return { kind: "rejected" };
    if (typeof confidence !== "number" || !Number.isFinite(confidence))
        return { kind: "rejected" };
    if (choice === "none")
        return { kind: "none", confidence };
    if (confidence < minConfidence)
        return { kind: "low-confidence", choice, confidence };
    return { kind: "hint", skillId: choice, confidence };
}
export function jevHintLine(skillId) {
    return `LitCodex skill hint: the skill \`litcodex:${skillId}\` likely fits this request. Load it only if it really fits; this is advice, not an instruction.`;
}
/** The opt-in (`LITCODEX_JEV_SHOW=1`) visible line for a hinted turn: skill id and latency only. */
export function jevShowLine(skillId, latencyMs) {
    return `Jev → ${skillId} (${(latencyMs / 1000).toFixed(2)}s)`;
}
/** Once-per-session awareness banner. Plain text: Codex renders hook systemMessage control characters literally. */
export const JEV_ON_BANNER = "✦ Jev skill hint ON";
export function jevFallbackNote(reason) {
    return `LitCodex skill hint unavailable (${reason}); continuing normally.`;
}
class JevResponseTooLargeError extends Error {
}
async function readCappedBody(response) {
    const reader = response.body?.getReader();
    if (reader === undefined)
        return "";
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > JEV_MAX_BODY_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new JevResponseTooLargeError();
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}
export const fetchJevHttpClient = async (url, request) => {
    const response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal,
        redirect: "error",
    });
    return { status: response.status, text: () => readCappedBody(response) };
};
function sessionStatePath(repoRoot, sessionId) {
    if (!isAbsolute(repoRoot))
        return null;
    return join(repoRoot, JEV_STATE_DIR, `${normalizeSessionId(sessionId) ?? "unscoped"}.json`);
}
function readSessionState(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (isRecord(parsed) && typeof parsed["calls"] === "number" && typeof parsed["noted"] === "boolean") {
            return { version: 1, calls: parsed["calls"], noted: parsed["noted"], announced: parsed["announced"] === true };
        }
    }
    catch {
        // Missing or malformed state starts a fresh session record.
    }
    return { version: 1, calls: 0, noted: false, announced: false };
}
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
/**
 * Create `.litcodex/jev` one level at a time. False when either level is a symlink or not a directory,
 * so a checked-in link can never redirect state or trace writes elsewhere.
 */
function ensureStateDir(dir) {
    for (const level of [dirname(dir), dir]) {
        try {
            if (!lstatSync(level).isDirectory())
                return false;
        }
        catch {
            try {
                mkdirSync(level);
            }
            catch {
                return false;
            }
        }
    }
    return true;
}
/** False when `path` exists as anything but a regular file (a symlink included). */
function isRegularOrAbsent(path) {
    return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? true;
}
function writeSessionState(path, state) {
    if (!ensureStateDir(dirname(path)))
        return false;
    const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
        if (!isRegularOrAbsent(path))
            return false;
        const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW);
        try {
            writeSync(fd, `${JSON.stringify(state)}\n`);
        }
        finally {
            closeSync(fd);
        }
        renameSync(tmp, path);
        return true;
    }
    catch {
        try {
            unlinkSync(tmp);
        }
        catch {
            // Nothing was created.
        }
        return false;
    }
}
function writeTrace(repoRoot, env, now, record) {
    if (env[`${JEV_FLAG_ENV}_TRACE`] !== "1" || !isAbsolute(repoRoot))
        return;
    try {
        const path = join(repoRoot, JEV_STATE_DIR, "trace.jsonl");
        if (!ensureStateDir(dirname(path)) || !isRegularOrAbsent(path))
            return;
        const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW);
        try {
            writeSync(fd, `${JSON.stringify({ ts: new Date(now()).toISOString(), ...record })}\n`);
        }
        finally {
            closeSync(fd);
        }
    }
    catch {
        // The trace is an optional debug aid; a write failure never affects the turn.
    }
}
// ── Settings ─────────────────────────────────────────────────────────────────
function positiveInt(raw, fallback) {
    const value = raw === undefined ? Number.NaN : Number(raw.trim());
    return Number.isInteger(value) && value > 0 ? value : fallback;
}
function nonNegativeInt(raw, fallback) {
    const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw.trim());
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}
function unitInterval(raw, fallback) {
    const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw.trim());
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}
function modelName(raw) {
    const value = raw?.trim() ?? "";
    return /^[A-Za-z0-9._:-]{1,64}$/.test(value) ? value : JEV_DEFAULT_MODEL;
}
const NOTHING = Object.freeze({});
async function exchange(http, key, body, timeoutMs) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            resolve({ kind: "failed", reason: "timeout" });
        }, timeoutMs);
    });
    const call = (async () => {
        try {
            const response = await http(JEV_ENDPOINT, {
                method: "POST",
                headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
                body,
                signal: controller.signal,
            });
            if (response.status !== 200)
                return { kind: "response", status: response.status, body: null };
            const text = await response.text();
            if (Buffer.byteLength(text, "utf8") > JEV_MAX_BODY_BYTES)
                return { kind: "failed", reason: "response-too-large" };
            return { kind: "response", status: 200, body: text };
        }
        catch (error) {
            if (controller.signal.aborted)
                return { kind: "failed", reason: "timeout" };
            return {
                kind: "failed",
                reason: error instanceof JevResponseTooLargeError ? "response-too-large" : "network",
            };
        }
    })();
    try {
        return await Promise.race([call, timeout]);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Decide the optional hint for one UserPromptSubmit turn. Never throws; every failure resolves to at
 * most one visible fallback note per session and otherwise to nothing.
 */
export async function runJevSkillHint(input) {
    const { env, repoRoot } = input;
    const now = input.now ?? Date.now;
    const switchState = jevSwitchState(env);
    if (switchState === "off")
        return NOTHING;
    if (jevSkipReason(input.prompt) !== null)
        return NOTHING;
    const statePath = sessionStatePath(repoRoot, input.sessionId);
    if (statePath === null)
        return NOTHING;
    const session = readSessionState(statePath);
    const fail = (reason, record) => {
        writeTrace(repoRoot, env, now, { ...record, fallback: reason });
        if (session.noted)
            return NOTHING;
        const current = readSessionState(statePath);
        if (!writeSessionState(statePath, { ...current, noted: true }))
            return NOTHING;
        return { systemMessage: jevFallbackNote(reason) };
    };
    const blank = { promptSha256: "", choice: null, confidence: null, latencyMs: null, httpStatus: null };
    const catalog = loadJevCatalog(input.skillsRoot);
    const catalogIds = new Set(catalog.map((entry) => entry.id));
    if (jevSkipReason(input.prompt, catalogIds) !== null)
        return NOTHING;
    if (switchState !== "on")
        return fail("key-missing", blank);
    if (catalog.length === 0)
        return fail("catalog-unavailable", blank);
    if (session.calls >= nonNegativeInt(env[`${JEV_FLAG_ENV}_MAX_CALLS`], JEV_DEFAULT_MAX_CALLS)) {
        return fail("cap-reached", blank);
    }
    const key = env[JEV_KEY_ENV]?.trim() ?? "";
    const state = redactJevPrompt(input.prompt, key);
    const promptSha256 = createHash("sha256").update(state).digest("hex");
    const body = JSON.stringify(buildJevRequestBody(modelName(env[`${JEV_FLAG_ENV}_MODEL`]), state, catalog));
    if (Buffer.byteLength(body, "utf8") > JEV_MAX_BODY_BYTES)
        return fail("request-too-large", { ...blank, promptSha256 });
    // Count the call before sending it, so a state write failure can never lift the per-session cap.
    if (!writeSessionState(statePath, { ...session, calls: session.calls + 1 }))
        return NOTHING;
    const timeoutMs = Math.min(positiveInt(env[`${JEV_FLAG_ENV}_TIMEOUT_MS`], JEV_DEFAULT_TIMEOUT_MS), JEV_MAX_TIMEOUT_MS);
    const started = now();
    const result = await exchange(input.http ?? fetchJevHttpClient, key, body, timeoutMs);
    const latencyMs = Math.max(0, now() - started);
    const sent = { ...blank, promptSha256, latencyMs };
    if (result.kind === "failed")
        return fail(result.reason, sent);
    if (result.status !== 200 || result.body === null) {
        return fail(`http-${result.status}`, { ...sent, httpStatus: result.status });
    }
    let parsed;
    try {
        parsed = JSON.parse(result.body);
    }
    catch {
        return fail("invalid-json", { ...sent, httpStatus: 200 });
    }
    const minConfidence = unitInterval(env[`${JEV_FLAG_ENV}_MIN_CONFIDENCE`], JEV_DEFAULT_MIN_CONFIDENCE);
    const verdict = judgeJevResponse(parsed, catalogIds, minConfidence);
    const choice = verdict.kind === "hint" ? verdict.skillId : verdict.kind === "none" ? "none" : null;
    const confidence = verdict.kind === "rejected" ? null : verdict.confidence;
    writeTrace(repoRoot, env, now, { ...sent, httpStatus: 200, choice, confidence, fallback: null });
    if (verdict.kind !== "hint")
        return NOTHING;
    const additionalContext = jevHintLine(verdict.skillId);
    if (env[`${JEV_FLAG_ENV}_SHOW`] !== "1")
        return { additionalContext };
    return { additionalContext, systemMessage: jevShowLine(verdict.skillId, latencyMs) };
}
/**
 * The once-per-session banner, or null. Only when the hint is fully on (flag and key); it is claimed in
 * the session state before it is shown, so a state write failure shows nothing rather than repeating.
 */
export function claimJevOnBanner(repoRoot, sessionId, env) {
    if (jevSwitchState(env) !== "on")
        return null;
    const statePath = sessionStatePath(repoRoot, sessionId);
    if (statePath === null)
        return null;
    const session = readSessionState(statePath);
    if (session.announced)
        return null;
    return writeSessionState(statePath, { ...session, announced: true }) ? JEV_ON_BANNER : null;
}
/** Put the banner (when claimed) on its own line ahead of any other visible Jev line. */
export function withJevBanner(result, banner) {
    if (banner === null)
        return result;
    const systemMessage = result.systemMessage === undefined ? banner : `${banner}\n${result.systemMessage}`;
    return { ...result, systemMessage };
}
/** Codex UserPromptSubmit output for a hint and/or visible line; "" when there is nothing to say. */
export function formatJevHookOutput(result) {
    if (result.additionalContext === undefined && result.systemMessage === undefined)
        return "";
    return `${JSON.stringify({
        ...(result.systemMessage === undefined ? {} : { systemMessage: result.systemMessage }),
        ...(result.additionalContext === undefined
            ? {}
            : { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: result.additionalContext } }),
    })}\n`;
}
