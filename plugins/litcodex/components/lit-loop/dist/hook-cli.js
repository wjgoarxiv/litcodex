// src/hook-cli.ts — M06 process adapter (A2 §2.4, A3 addendum A3/A4).
//
// The ONLY module that touches process streams + exit codes for the hook route. Reads stdin to a
// UTF-8 string defensively, then BOM-strip → empty-check → JSON.parse (in that exact order, A3 A4),
// hands the parsed value to the pure engine, and writes the decision. Exit map: any structurally
// valid event → 0 (no-op writes zero bytes); unparseable or oversized stdin → 2 with a
// machine-readable LitHookError JSON line on stderr. NEVER calls process.exit (the dispatcher does)
// and NEVER throws.
import { isAbsolute } from "node:path";
import { Writable } from "node:stream";
import { adhdSuggestion } from "./adhd-suggest.js";
import { claimReloadContext, evaluateAutoHandoffStop, recordCompaction, takeReloadContext } from "./auto-handoff.js";
import { applyAutoHandoffRoute, clearManagedCompactionWhenOff, parseAutoHandoffRoute, } from "./auto-handoff-settings.js";
import { applyPreToolUseCreateGoalGuard, isLitUserPromptSubmitInput, runUserPromptSubmitHook } from "./codex-hook.js";
import { hookJson } from "./control-chars.js";
import { plainGuide } from "./goal-guide.js";
import { closeOwnedGoal, detectCheck, goalCancelContext, goalQuestionOpen, liveConsent, normalizeGoalObjective, ownedGoal, planAnswer, proposeLoopGoal, startAnswers, sweepGoalState, } from "./goal-pipeline.js";
import { wrapped } from "./hud.js";
import { laneScope, subagentEvent, toolLaneEvents } from "./lane-events.js";
import { recordLaneEvent } from "./lane-state.js";
import { detectWaitReason, endLiveStep, recordLiveStepEnd, recordLiveStepStart, recordTurnStart, writeThreadPointer, } from "./live-step.js";
import { evaluatePlanPersistence, formatStopBlockOutput, rearmLitPlanIfSatisfied, recordLitPlanActivation, } from "./plan-persistence.js";
import { clearActiveRoute, isBareLit, isLitContinue, readActiveRoute, readResumeWork, recordActiveRoute, } from "./reentry.js";
import { isBoundaryAnswer, isGoPrompt, takeGo } from "./rewind-go.js";
import { outcomeFor, recordRunEnd } from "./run-end.js";
import { SAFE_WIDTH, workflowCard } from "./screen-card.js";
import { screenLook } from "./screen-status.js";
import { recordLiveness } from "./session-liveness.js";
import { applyPromptToStack, frameToResume } from "./stack-hook.js";
import { suggestionContext } from "./suggest.js";
import { takeSunsetHint } from "./sunset-settings.js";
import { maskMarkdownCode } from "./trigger.js";
import { continuingWork, recordWorkflowTurn, workflowStopLine, workflowTurn } from "./workflow-map.js";
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
export async function runUserPromptSubmitHookCli(stdin, stdout, stderr, repoRoot = process.cwd(), auto = {}) {
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
    const route = autoHandoffRouteOutput(parsed, repoRoot, auto);
    if (route !== "") {
        stdout.write(hookJson(route));
        return 0;
    }
    clearManagedCompactionWhenOff(hookCwd(parsed, repoRoot), auto.env ?? process.env);
    // The start-work run words (`lit approve`, `lit approve x`, `lit deny`, `lit skip-row`, `lit pause`, `lit resume`,
    // `lit cancel`) belong to the lifecycle hook, so this one stays out.
    // `yes` / `edit` / `no` right after lit-plan's goal question answer it (S4); `lit cancel` also hands the user
    // the `/goal clear` line for a goal LitCodex armed.
    let planNote = null;
    if (isLitUserPromptSubmitInput(parsed)) {
        const cwd = hookCwd(parsed, repoRoot);
        // Any prompt in a LIT thread ends the wait, an answer this hook handles itself included.
        const live = hookSessionScope(parsed, repoRoot);
        if (live !== null && workflowTurn(live.cwd, live.sessionId) !== null) {
            recordTurnStart(live.cwd, live.sessionId, auto.now);
        }
        if (isBoundaryAnswer(parsed.prompt)) {
            const cancel = /cancel|취소/u.test(parsed.prompt) ? goalCancelContext(cwd) : null;
            if (cancel !== null) {
                stdout.write(hookJson(withReloadContext("", cancel) ?? ""));
                return 0;
            }
        }
        else {
            const answer = planAnswer({
                cwd,
                prompt: parsed.prompt,
                sessionId: hookSessionScope(parsed, repoRoot)?.sessionId ?? null,
                now: auto.now ?? Date.now(),
            });
            if (answer !== null && answer.start === null) {
                stdout.write(hookJson(withReloadContext("", answer.context) ?? ""));
                return 0;
            }
            // R1: `yes` starts the plan through the same start-work route as typing `start-work <slug>`.
            if (answer !== null && answer.start !== null) {
                parsed = { ...parsed, prompt: answer.start };
                planNote = answer.context;
            }
        }
    }
    if (isLitUserPromptSubmitInput(parsed) && isBoundaryAnswer(parsed.prompt))
        return 0;
    // `go` after a lit-adhd brief runs the one step the brief named, as if the user had typed that step.
    let goNote = planNote;
    if (isLitUserPromptSubmitInput(parsed) && isGoPrompt(parsed.prompt)) {
        const scope = hookSessionScope(parsed, repoRoot);
        const go = scope === null ? null : takeGo(scope.cwd, scope.sessionId, auto.now ?? Date.now());
        if (go?.kind === "hint") {
            stdout.write(hookJson(withReloadContext("", go.text) ?? ""));
            return 0;
        }
        if (go?.kind === "run") {
            parsed = { ...parsed, prompt: go.prompt };
            goNote = go.note;
        }
    }
    const pointer = hookSessionScope(parsed, repoRoot);
    const savedRoute = pointer === null ? null : readActiveRoute(pointer.cwd, pointer.sessionId);
    // An active lit-plan owns the persistence gate, so `lit continue` stays inside it rather than leaving it armed.
    const litContinue = pointer !== null &&
        savedRoute !== "lit-plan" &&
        isLitUserPromptSubmitInput(parsed) &&
        isLitContinue(parsed.prompt);
    // `lit continue` over a side discipline returns to the paused spine, at the stage and count it left.
    const spine = litContinue ? frameToResume(pointer.cwd, pointer.sessionId) : null;
    const decision = runUserPromptSubmitHook(parsed, () => {
        const saved = savedRoute;
        return {
            active: spine !== null && saved !== null ? spine.skill : saved,
            resume: pointer === null ? null : readResumeWork(pointer.cwd, pointer.sessionId),
            frame: spine === null
                ? null
                : {
                    skill: spine.skill ?? "work",
                    stage: spine.stage,
                    ...(spine.n === undefined ? {} : { n: spine.n }),
                    ...(spine.total === undefined ? {} : { total: spine.total }),
                },
        };
    });
    // A read-only brief never takes the saved route: the work under it keeps its contract and its place.
    if (pointer !== null && decision.kind === "inject" && decision.mode !== "lit-adhd") {
        recordActiveRoute(pointer.cwd, pointer.sessionId, spine?.skill ?? decision.mode);
    }
    if (decision.kind === "inject" && decision.mode === "start-work" && isLitUserPromptSubmitInput(parsed)) {
        startAnswers(hookCwd(parsed, repoRoot), parsed.prompt, pointer?.sessionId);
    }
    if (pointer !== null && isLitUserPromptSubmitInput(parsed) && (litContinue || decision.kind === "inject")) {
        applyPromptToStack(pointer.cwd, pointer.sessionId, parsed.prompt, { continued: litContinue, mode: decision.kind === "inject" ? decision.mode : null }, auto.now === undefined ? undefined : new Date(auto.now));
    }
    // Only a LIT thread gets a pointer: this prompt ignites LIT, or an earlier one already did.
    if (pointer !== null && (decision.kind === "inject" || workflowTurn(pointer.cwd, pointer.sessionId) !== null)) {
        writeThreadPointer(auto.env ?? process.env, pointer.sessionId, pointer.cwd, auto.now);
        recordTurnStart(pointer.cwd, pointer.sessionId, auto.now);
    }
    // A continued lit-plan keeps its persistence gate as it is. A fresh activation arms it again, and so does an
    // explicit `lit plan …` once the previous plan was saved (a bare `lit` carries on and never re-arms).
    if (decision.kind === "inject" && decision.mode === "lit-plan") {
        const scope = hookSessionScope(parsed, repoRoot);
        if (scope !== null) {
            if (decision.entry !== "continue")
                recordLitPlanActivation(scope.cwd, scope.sessionId);
            else if (isLitUserPromptSubmitInput(parsed) && !isBareLit(parsed.prompt))
                rearmLitPlanIfSatisfied(scope.cwd, scope.sessionId);
        }
    }
    const env = auto.env ?? process.env;
    const own = decision.kind === "inject"
        ? withCardOffer(withWorkflowMap(withLoopGoal(decision, parsed, hookCwd(parsed, repoRoot), auto.now ?? Date.now()), parsed, decision.mode, env), pointer, auto, decision.entry === "continue")
        : "";
    const hint = decision.kind === "inject" && decision.entry !== "continue" ? withSunsetHint(own, env) : own;
    const noted = goNote === null || hint === "" ? hint : (withReloadContext(hint, goNote) ?? hint);
    const output = withAutoHandoffReload(noted, parsed, repoRoot, auto);
    if (output !== "")
        stdout.write(hookJson(output));
    else if (decision.kind === "noop" && isLitUserPromptSubmitInput(parsed)) {
        // A prompt without `lit` gets the suggestion tier: a skill offer the model may decline, or the catalog line.
        const suggestion = suggestionContext(parsed.prompt);
        if (suggestion !== "") {
            stdout.write(hookJson(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: suggestion } })}\n`));
        }
    }
    return 0;
}
/** `lit-handoff auto on|off|status` changes a setting and never reaches the model: the prompt is blocked with one plain reply. */
function autoHandoffRouteOutput(parsed, repoRoot, options) {
    if (!isLitUserPromptSubmitInput(parsed))
        return "";
    const route = parseAutoHandoffRoute(parsed.prompt);
    if (route === null)
        return "";
    const record = parsed;
    const cwd = typeof record["cwd"] === "string" && isAbsolute(record["cwd"]) ? record["cwd"] : repoRoot;
    const reason = applyAutoHandoffRoute(cwd, options.env ?? process.env, route);
    return `${JSON.stringify({ decision: "block", reason })}\n`;
}
/**
 * Put the handoff excerpt for a compaction between turns into this turn's output, claiming it once. The
 * claim is made only when the output is built, and it is given back when the text cannot be merged, so a
 * reload that never reached the model stays available for the next prompt.
 */
function withAutoHandoffReload(stdout, parsed, repoRoot, options) {
    const scope = hookSessionScope(parsed, repoRoot);
    if (scope === null)
        return stdout;
    const claim = claimReloadContext(scope.cwd, scope.sessionId, options.env ?? process.env, false);
    if (claim === null)
        return stdout;
    const merged = withReloadContext(stdout, claim.text);
    if (merged === null) {
        claim.release();
        return stdout;
    }
    return merged;
}
/**
 * Add reload text to a UserPromptSubmit output that may already carry context, or carry only a visible
 * line; "" becomes a context-only output. Null when the output cannot be merged (it is not JSON).
 */
function withReloadContext(stdout, reload) {
    if (stdout === "") {
        return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reload } })}\n`;
    }
    try {
        const output = JSON.parse(stdout);
        if (typeof output !== "object" || output === null || Array.isArray(output))
            return null;
        const specific = output.hookSpecificOutput ?? { hookEventName: "UserPromptSubmit" };
        specific.additionalContext = [specific.additionalContext, reload].filter(Boolean).join("\n\n");
        output.hookSpecificOutput = specific;
        return `${JSON.stringify(output)}\n`;
    }
    catch {
        return null;
    }
}
/** Run routes that get the lit-loop goal question; litgoal keeps its own binding and plans keep the plan question. */
const LOOP_GOAL_ROUTES = new Set(["lit-loop", "litwork"]);
// Short on purpose: the first activation's context is held to a byte budget. The full steps are in the lit-loop skill.
const LOOP_GOAL_FALLBACK = "Goal: after a failing check, follow lit-loop's `goal propose --loop` step; never call `create_goal` first.";
/** The model-context line for a run whose goal question the hook already put in front of the user. */
const loopGoalContext = (line) => `Native goal: LitCodex has shown the user this goal question: ${line} Do not ask it again. Never call \`create_goal\` or type \`/goal\` yourself: the user's exact \`yes\` on a later prompt arms it and this hook then tells you to call \`create_goal\`.`;
/** Words that greet or thank and name no work. */
const GREETING = /^(?:hi|hello|hey|yo|hiya|good (?:morning|afternoon|evening)|thanks|thank you|thx|안녕(?:하세요|하십니까)?|하이|ㅎㅇ|고마워요?|감사합니다)(?:\s+there)?[\s,.!?~ㅎㅋ^]*$/iu;
/** The Stop line in plain words; a turn that asked something opens with whose turn it is. */
export function stopNote(line, waitReason) {
    const plain = line
        .replace(/^✨ /u, "")
        .replace(/^⏳ /u, "")
        .replace(/\b(tasks?|goals?) ✓/gu, "$1 done")
        .replace(" · continuing ▸ ", " · continuing with: ")
        .replace(" · next ▸ ", " · next: ");
    if (waitReason === null)
        return plain;
    const turn = waitReason === "blocked" ? "blocked · needs your help above" : "your turn · answer the question above";
    return plain.startsWith("turn done") ? plain.replace("turn done", turn) : `${turn} · ${plain}`;
}
/**
 * The text after the run-route word as the objective: no leading route filler or skill-plan flags. When the word
 * ends the prompt (`fix the login button lit`), the text before it is the objective instead. A resume word
 * (`lit continue`), a greeting (`hi lit`) and a question about the word itself (`what does lit-loop do?`) name no objective.
 */
export function loopObjective(prompt) {
    const masked = maskMarkdownCode(prompt);
    const match = /(?:^|[^\p{L}\p{N}_])(?:lit-loop|litcodex|litwork|lit)(?![\p{L}\p{N}_-])\s*(.*)$/isu.exec(masked);
    if (match === null)
        return "";
    const before = normalizeGoalObjective(masked.slice(0, match.index));
    const tail = normalizeGoalObjective((match[1] ?? "").replace(/^(?:\+[\w-]+\s+)*(?:(?:loop|work)\b\s*)?/iu, ""));
    if (tail !== "" && GREETING.test(tail))
        return before;
    if (!/[\p{L}\p{N}]/u.test(tail))
        return GREETING.test(before) ? "" : before;
    if (/^(?:continue|resume|계속|이어서)[.!]?$/iu.test(tail))
        return "";
    if (before !== "" && /[?？]$/u.test(tail))
        return "";
    return tail;
}
/**
 * A run's first activation asks the goal question itself, shown to the user in the hook's systemMessage, when the
 * prompt names an objective, the project has a test command, and LitCodex owns or asks no goal yet. The check is
 * not run here. Without that, the run route only learns it may propose one after its failing check. A repeated
 * prompt (entry "continue") and every other route get nothing.
 */
function withLoopGoal(decision, parsed, cwd, now) {
    if (!LOOP_GOAL_ROUTES.has(decision.mode) || decision.entry === "continue" || !isLitUserPromptSubmitInput(parsed))
        return decision.stdout;
    try {
        const objective = loopObjective(parsed.prompt);
        const check = objective === "" ? null : detectCheck(cwd);
        const open = ownedGoal(cwd) !== null || liveConsent(cwd, now) !== null;
        const sessionId = hookSessionScope(parsed, cwd)?.sessionId ?? null;
        const offer = check === null || open ? null : proposeLoopGoal({ cwd, check, objective, now, falsifyNow: false, sessionId });
        const note = offer?.consent !== undefined
            ? loopGoalContext(offer.line)
            : open || objective === ""
                ? null
                : LOOP_GOAL_FALLBACK;
        if (note === null)
            return decision.stdout;
        const output = JSON.parse(decision.stdout);
        if (offer?.consent !== undefined && isRecord(output) && typeof output["systemMessage"] === "string") {
            output["systemMessage"] = `${output["systemMessage"]}\n${inCard(`${offer.line}\n${plainGuide("loop")}`)}`;
        }
        const base = `${JSON.stringify(output)}\n`;
        return withContextAfterBanner(base, note) ?? withReloadContext(base, note) ?? decision.stdout;
    }
    catch {
        return decision.stdout;
    }
}
/** One line about the sunset footer under the first LIT activation that can show it; never again. */
function withSunsetHint(stdout, env) {
    try {
        const output = JSON.parse(stdout);
        if (!isRecord(output) || typeof output["systemMessage"] !== "string")
            return stdout;
        const line = takeSunsetHint(env);
        if (line === null)
            return stdout;
        output["systemMessage"] = `${output["systemMessage"]}\n${inCard(line)}`;
        return `${JSON.stringify(output)}\n`;
    }
    catch {
        return stdout;
    }
}
/** Lines under the card, broken where the card's own rows end: Codex wraps a longer one to the pane's left edge. */
function inCard(lines) {
    return lines
        .split("\n")
        .flatMap((line) => wrapped(line, SAFE_WIDTH))
        .join("\n");
}
/**
 * Add the LIT card (map and checklist) under the activation banner and remember the turn for the Stop
 * card. Only an event that names its own absolute `cwd` is mapped, so the card always describes the
 * session's repo.
 */
function withWorkflowMap(stdout, parsed, mode, env) {
    if (!isRecord(parsed) || typeof parsed["cwd"] !== "string" || !isAbsolute(parsed["cwd"]))
        return stdout;
    const cwd = parsed["cwd"];
    const sessionId = typeof parsed["session_id"] === "string" && parsed["session_id"] !== "" ? parsed["session_id"] : null;
    try {
        if (sessionId !== null && typeof parsed["turn_id"] === "string") {
            recordWorkflowTurn(cwd, sessionId, parsed["turn_id"], mode);
        }
        const card = workflowCard(cwd, sessionId, mode, "turn started", {
            ...screenLook(env),
            quietWhenEmpty: true,
            underBanner: true,
            repeats: "show",
        });
        if (card === null)
            return stdout;
        const output = JSON.parse(stdout);
        if (!isRecord(output) || typeof output["systemMessage"] !== "string")
            return stdout;
        output["systemMessage"] = `${output["systemMessage"]}\n${card}`;
        return `${JSON.stringify(output)}\n`;
    }
    catch {
        return stdout;
    }
}
/**
 * Asks the model to open the LIT card for this LIT turn, so the live card sits next to the newest turn
 * instead of scrolling away with the first one. In the terminal `codex` the same tool returns the map as text.
 */
export const CARD_OFFER_CONTEXT = "LIT card: if the `lit_card` tool (litcodex MCP server) is available, call the `lit_card` tool once now, with no arguments, so the user sees the live LIT card for this turn. It replaces the previous turn's card, which folds itself into one line. Do not call it again in this turn; it updates by itself.";
/** The card request for a continued discipline: the model already read the full one when it was activated. */
export const CARD_OFFER_CONTINUE_CONTEXT = "LIT card: if the `lit_card` tool is available, call it once now with no arguments; it updates by itself.";
/**
 * Add the card request to every LIT activation, right under the banner line so it stays inside the part
 * of the context Codex always shows, and remember when it was last made.
 */
function withCardOffer(stdout, scope, auto, continued = false) {
    if (scope === null || stdout === "")
        return stdout;
    const offer = continued ? CARD_OFFER_CONTINUE_CONTEXT : CARD_OFFER_CONTEXT;
    const merged = withContextAfterBanner(stdout, offer) ?? withReloadContext(stdout, offer);
    if (merged === null)
        return stdout;
    writeThreadPointer(auto.env ?? process.env, scope.sessionId, scope.cwd, auto.now, { cardOffered: true });
    return merged;
}
/** Insert a line after the context's `LIT IGNITED` banner line; null when there is no banner to anchor on. */
function withContextAfterBanner(stdout, text) {
    try {
        const output = JSON.parse(stdout);
        const context = output?.hookSpecificOutput?.additionalContext;
        if (output === null || typeof context !== "string")
            return null;
        const banner = /^.*LIT IGNITED · .*$/mu.exec(context);
        if (banner === null)
            return null;
        const end = banner.index + banner[0].length;
        output.hookSpecificOutput.additionalContext =
            `${context.slice(0, end)}\n${text}${context.slice(end)}`;
        return `${JSON.stringify(output)}\n`;
    }
    catch {
        return null;
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** A subagent's hooks carry the root session id, so its Stop must not end the parent's turn card. */
function isSubagent(parsed) {
    return isRecord(parsed) && typeof parsed["agent_id"] === "string" && parsed["agent_id"] !== "";
}
/** Absolute `cwd` from a hook event, else the fallback root. */
function hookCwd(parsed, repoRoot) {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return repoRoot;
    const cwd = parsed["cwd"];
    return typeof cwd === "string" && isAbsolute(cwd) ? cwd : repoRoot;
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
export async function runStopPlanPersistenceHookCli(stdin, stdout, stderr, repoRoot = process.cwd(), auto = {}) {
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
    clearManagedCompactionWhenOff(hookCwd(parsed, repoRoot), auto.env ?? process.env);
    const scope = hookSessionScope(parsed, repoRoot);
    if (scope !== null) {
        // No tool runs once Stop fires: one whose PostToolUse never came (interrupted, or denied by another hook) is over.
        // The turn itself closes only below, after the guards that can send the model back to work.
        endLiveStep(scope.cwd, scope.sessionId, auto.now, false);
        const persistence = evaluatePlanPersistence(scope.cwd, scope.sessionId, auto.now);
        if (persistence.decision === "block") {
            stdout.write(hookJson(formatStopBlockOutput(persistence.reason)));
            return 0;
        }
        const record = parsed;
        const handoff = evaluateAutoHandoffStop({
            repoRoot: scope.cwd,
            sessionId: scope.sessionId,
            transcriptPath: typeof record["transcript_path"] === "string" ? record["transcript_path"] : null,
            stopHookActive: record["stop_hook_active"] === true,
            env: auto.env ?? process.env,
            ...(auto.now === undefined ? {} : { now: auto.now }),
        });
        if (handoff.decision === "block") {
            stdout.write(hookJson(formatStopBlockOutput(handoff.reason)));
            return 0;
        }
        // A subagent's Stop carries the parent's session id; the parent's turn is still running.
        if (isSubagent(parsed))
            return 0;
        const lastMsg = typeof record["last_assistant_message"] === "string" ? record["last_assistant_message"] : null;
        // A goal question this session asked waits for its answer, whatever the model said last.
        const asked = goalQuestionOpen(scope.cwd, scope.sessionId, auto.now ?? Date.now());
        const turnId = record["turn_id"];
        const stop = {
            stopHookActive: record["stop_hook_active"] === true,
            transcriptPath: typeof record["transcript_path"] === "string" ? record["transcript_path"] : null,
        };
        const stopLine = (next) => typeof turnId === "string" ? workflowStopLine(scope.cwd, scope.sessionId, turnId, { ...stop, next }) : null;
        const line = stopLine(true);
        // A turn that start-work carries on is not over and waits for nobody, whatever word began it.
        const continuing = typeof turnId === "string" && continuingWork(scope.cwd, scope.sessionId, turnId, stop) !== null;
        const waitReason = continuing ? null : (detectWaitReason(lastMsg) ?? (asked ? "question" : null));
        endLiveStep(scope.cwd, scope.sessionId, auto.now, !continuing, waitReason);
        const env = auto.env ?? process.env;
        if (workflowTurn(scope.cwd, scope.sessionId) !== null)
            recordLiveness(scope.cwd, scope.sessionId, "idle", auto.now);
        const turn = line === null ? null : workflowTurn(scope.cwd, scope.sessionId);
        const card = turn === null || line === null
            ? null
            : workflowCard(scope.cwd, scope.sessionId, turn.mode, (next) => stopNote((next ? null : stopLine(false)) ?? line, waitReason), {
                ...screenLook(env),
                quietMap: true,
                waiting: waitReason !== null,
                ended: !continuing,
                repeats: "omit",
            });
        // The end of a LIT run: remember whether it reported, had nothing to report, or waits on the user.
        const opened = workflowTurn(scope.cwd, scope.sessionId);
        const outcome = opened === null || continuing ? null : outcomeFor(line, waitReason);
        if (opened !== null && outcome !== null) {
            recordRunEnd(scope.cwd, scope.sessionId, { mode: opened.mode, outcome }, auto.now);
        }
        // Codex puts its hook label before the first row and indents the rest, so the card reads on from it.
        if (card !== null)
            stdout.write(hookJson(`${JSON.stringify({ systemMessage: card })}\n`));
    }
    return 0;
}
/** Parse a hook event from stdin the way every route here does; `exit` is set when the route must stop. */
async function readHookEvent(stdin, stderr) {
    const decoded = await readStdin(stdin);
    if (decoded === null) {
        stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
        return { exit: 2 };
    }
    let raw = decoded;
    if (raw.charCodeAt(0) === 0xfeff)
        raw = raw.slice(1);
    if (raw.trim().length === 0)
        return { exit: 0 };
    try {
        return { exit: null, parsed: JSON.parse(raw) };
    }
    catch {
        stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
        return { exit: 2 };
    }
}
/** SessionStart: after a compaction inside a turn, bring this session's fresh handoff back once. */
export async function runSessionStartHookCli(stdin, stdout, stderr, repoRoot = process.cwd(), auto = {}) {
    const event = await readHookEvent(stdin, stderr);
    if (event.exit !== null)
        return event.exit;
    clearManagedCompactionWhenOff(hookCwd(event.parsed, repoRoot), auto.env ?? process.env);
    sweepGoalState(hookCwd(event.parsed, repoRoot), auto.now ?? Date.now());
    const record = event.parsed;
    if (typeof record === "object" &&
        record !== null &&
        (record["source"] === "startup" || record["source"] === "resume")) {
        const opened = hookSessionScope(record, repoRoot);
        const offer = opened === null ? null : adhdSuggestion(opened.cwd, opened.sessionId);
        if (offer !== null) {
            stdout.write(hookJson(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: offer } })}\n`));
        }
        return 0;
    }
    if (typeof record !== "object" || record === null || record["source"] !== "compact")
        return 0;
    const scope = hookSessionScope(record, repoRoot);
    if (scope === null)
        return 0;
    const reload = takeReloadContext(scope.cwd, scope.sessionId, auto.env ?? process.env, true);
    if (reload !== null) {
        stdout.write(hookJson(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: reload } })}\n`));
    }
    return 0;
}
/** PostCompact: remember that a session that saved a handoff has now been compacted. Writes nothing to stdout. */
export async function runPostCompactHookCli(stdin, _stdout, stderr, repoRoot = process.cwd(), auto = {}) {
    const event = await readHookEvent(stdin, stderr);
    if (event.exit !== null)
        return event.exit;
    clearManagedCompactionWhenOff(hookCwd(event.parsed, repoRoot), auto.env ?? process.env);
    const scope = hookSessionScope(event.parsed, repoRoot);
    if (scope !== null) {
        recordCompaction(scope.cwd, scope.sessionId);
        // The activation text may be gone from the model's context, so the next lit prompt sends it in full.
        clearActiveRoute(scope.cwd, scope.sessionId);
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
        stdout.write(hookJson(decision.stdout));
    }
    return 0;
}
/** The card's own tools: opening or polling the card is not a step of the work. */
const OWN_CARD_TOOL = /^mcp__litcodex__lit_card(?:_status)?$/u;
/** `{ sessionId, cwd, tool, toolUseId }` from a tool event that names its own absolute cwd, else null. */
function toolEventScope(parsed) {
    if (!isRecord(parsed))
        return null;
    const { session_id: sessionId, cwd, tool_name: tool, tool_use_id: toolUseId } = parsed;
    if (typeof sessionId !== "string" || sessionId === "" || typeof tool !== "string" || tool === "")
        return null;
    if (typeof cwd !== "string" || !isAbsolute(cwd))
        return null;
    return { sessionId, cwd, tool, toolUseId: typeof toolUseId === "string" && toolUseId !== "" ? toolUseId : null };
}
/**
 * Catch-all PreToolUse: in a thread with a LIT activation, remember the running tool for the LIT card
 * and point the thread at its workspace. It prints nothing and exits 0 on every input, so it can never block or change a tool call.
 */
export async function runPreToolUseLiveHookCli(stdin, _stdout, _stderr, options = {}) {
    const event = await readHookEvent(stdin, nullSink());
    if (event.exit !== null)
        return 0;
    const scope = toolEventScope(event.parsed);
    if (scope === null || OWN_CARD_TOOL.test(scope.tool))
        return 0;
    const now = options.now ?? Date.now();
    // Only a LIT thread has a card to feed, so other sessions leave no `.litcodex` folder and no pointer.
    if (workflowTurn(scope.cwd, scope.sessionId) === null)
        return 0;
    recordLiveStepStart(scope.cwd, scope.sessionId, scope, now);
    writeThreadPointer(options.env ?? process.env, scope.sessionId, scope.cwd, now);
    return 0;
}
/** Catch-all PostToolUse: clear the live step this call set. Prints nothing; exits 0 on every input. */
export async function runPostToolUseLiveHookCli(stdin, _stdout, _stderr, options = {}) {
    const event = await readHookEvent(stdin, nullSink());
    if (event.exit !== null)
        return 0;
    const scope = toolEventScope(event.parsed);
    const now = options.now ?? Date.now();
    if (scope !== null && scope.tool === "update_goal" && isRecord(event.parsed)) {
        const input = event.parsed["tool_input"];
        if (isRecord(input) && input["status"] === "complete")
            closeOwnedGoal(scope.cwd, now);
    }
    if (scope !== null && !OWN_CARD_TOOL.test(scope.tool)) {
        recordLiveStepEnd(scope.cwd, scope.sessionId, scope, now);
        if (workflowTurn(scope.cwd, scope.sessionId) !== null)
            recordLiveness(scope.cwd, scope.sessionId, "alive", now);
    }
    recordLanes(event.parsed, toolLaneEvents, now);
    return 0;
}
/** Fold a hook payload's lane events into the session's lane records; only a LIT thread has lanes to draw. */
function recordLanes(parsed, read, now) {
    try {
        const scope = laneScope(parsed);
        if (scope === null || workflowTurn(scope.cwd, scope.sessionId) === null)
            return;
        for (const laneEvent of read(parsed))
            recordLaneEvent(scope.cwd, scope.sessionId, laneEvent, now);
    }
    catch {
        // Lanes only decorate the card; a hook never fails because of them.
    }
}
/**
 * SubagentStart and SubagentStop: a child agent began or ended, so its lane row appears or leaves. Prints
 * nothing and exits 0 on every input, including one whose payload shape is not the one probed.
 */
export async function runSubagentHookCli(kind, stdin, options = {}) {
    const event = await readHookEvent(stdin, nullSink());
    if (event.exit !== null)
        return 0;
    recordLanes(event.parsed, (parsed) => {
        const laneEvent = subagentEvent(parsed, kind);
        return laneEvent === null ? [] : [laneEvent];
    }, options.now ?? Date.now());
    return 0;
}
/** Swallows the parse errors the shared reader reports; the live-step hooks stay silent. */
function nullSink() {
    return new Writable({ write: (_chunk, _encoding, callback) => callback() });
}
