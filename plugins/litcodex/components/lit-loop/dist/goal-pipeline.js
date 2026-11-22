// src/goal-pipeline.ts — a lit-plan's `## Done when` block becomes one Codex `/goal` objective (S4).
//
// lit-plan runs `cli.js goal propose .litcodex/plans/<slug>.md` once, after it published the plan. That
// compiles the block into a condition, lints it, runs its check once to prove the condition is false now,
// writes the question into `.litcodex/goal/consent.json` and prints one line: the consent question, or
// `No goal set: <reason>`. Only the user's next prompt, exactly `yes`, arms it: the prompt hook then
// records `.litcodex/goal/owner.json` and tells the model to call Codex's `create_goal` with this
// objective alone (the existing PreToolUse guard still rejects any other key). Codex lets only the user
// run `/goal clear`, so LitCodex never clears a goal: on done the model marks the owned goal complete
// with `update_goal`, and on `lit cancel` it hands the user the `/goal clear` line, in both cases only
// when `get_goal` reports exactly the owned objective. A goal the user set by hand is never touched.
//
// A lit-loop or litwork run with no plan gets one question too (`kind: "loop"`): its condition is the project's
// test command exiting 0 with the objective done. The prompt hook records it at the run's first activation
// (`offerLoopGoal`, no test run), or `goal propose --loop --check "<cmd>" <objective>` records it after a failing
// check; only the user's exact `yes` arms it, and it starts no start-work run.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { answerChoice, markdownGuide } from "./goal-guide.js";
import { plainDirsOrMissing, writeFileAtomic } from "./live-step.js";
import { redactSecrets } from "./redaction.js";
import { chooseNext, openPlanNamed } from "./rewind.js";
export const GOAL_DIR = ".litcodex/goal";
export const GOAL_MAX_CHARS = 500;
export const CONSENT_TTL_MS = 30 * 60 * 1000;
export const FALSIFY_TIMEOUT_MS = 120_000;
/** Fixed status lines, one per outcome. The CLI and the hook print these and nothing else. */
export const GOAL_STATUS = Object.freeze({
    asked: (condition) => `Approve plan, start work and set goal: /goal ${condition}? ${answerChoice("plan")}`,
    askStart: `Approve plan and start work? ${answerChoice("start")}`,
    notStarted: (reason) => `Work not started and no goal set: ${reason}`,
    loopAsked: (condition) => `Set goal for this lit-loop: /goal ${condition}? ${answerChoice("loop")}`,
    skipped: (reason) => `No goal set: ${reason}`,
    set: (id) => `LitCodex goal set [lit:${id}]`,
    yours: "Your own goal is active; LitCodex left it alone.",
    notConfirmed: (condition) => `Goal not confirmed. Paste: /goal ${condition}`,
    met: (id) => `Goal met and marked complete [lit:${id}]`,
    clearByUser: (id) => `LitCodex goal stopped [lit:${id}]; Codex lets only you clear it: /goal clear`,
});
const JUDGMENT_WORDS = [
    /\bworks?\b/iu,
    /\bworking\b/iu,
    /\blooks? (?:good|fine|right|nice|great)\b/iu,
    /\bseems?\b/iu,
    /\bproperly\b/iu,
    /\bcorrectly\b/iu,
    /\bnicely\b/iu,
    /\bshould (?:work|pass)\b/iu,
    /\bas expected\b/iu,
    /\bgood enough\b/iu,
    /잘\s*(?:동작|작동|돌아|돼|된다|되면)/u,
    /괜찮/u,
    /깔끔/u,
    /제대로/u,
    /문제\s*없/u,
];
/** A success that is only an outward action proves nothing about the work and cannot be undone. */
const OUTWARD_ONLY = /^\s*(?:git\s+push|git\s+tag|npm\s+publish|pnpm\s+publish|yarn\s+publish|gh\s+(?:release|pr\s+merge))\b/iu;
/** Check commands the dry run may execute. Anything else is refused before it runs. */
const CHECK_ALLOWLIST = [
    /^npm (?:test|run [\w:.-]+)(?: --[\w-]+)*$/u,
    /^npx vitest run(?: [\w./-]+)*$/u,
    /^node --test(?: [\w./-]+)*$/u,
    /^node [\w./-]+\.m?js(?: [\w./=-]+)*$/u,
    /^(?:pnpm|yarn) (?:test|run [\w:.-]+)$/u,
    /^(?:pytest|python3? -m pytest)(?: [\w./:-]+)*$/u,
    /^cargo test(?: [\w-]+)*$/u,
    /^go test(?: [\w./-]+)*$/u,
    /^make (?:test|check|verify)$/u,
    /^(?:bash|sh) scripts\/[\w./-]+\.sh$/u,
];
export const conditionHash = (condition) => createHash("sha256").update(condition).digest("hex").slice(0, 16);
/** Binds the answer to the plan it starts and the goal it sets, so an edited consent file arms nothing. */
export const consentHash = (plan, condition) => conditionHash(`${plan}\u0000${condition ?? ""}`);
export const goalId = (plan, check) => createHash("sha256").update(`${plan}\u0000${check}`).digest("hex").slice(0, 8);
/** The `## Done when` block: a `check: \`<command>\`` line, the first one wins. */
export function parseDoneWhen(planText) {
    const lines = planText.split(/\r?\n/u);
    const start = lines.findIndex((line) => /^##\s+Done when\s*$/iu.test(line));
    if (start === -1)
        return { ok: false, reason: "the plan has no `## Done when` block" };
    for (const line of lines.slice(start + 1)) {
        if (/^##\s/u.test(line))
            break;
        const match = /^\s*(?:[-*]\s+)?check:\s*`([^`\n]+)`\s*$/u.exec(line);
        if (match?.[1] !== undefined)
            return { ok: true, check: match[1].trim() };
    }
    return { ok: false, reason: "the `## Done when` block names no `check:` command" };
}
/** `Every row in .litcodex/plans/<f>.md is ticked and \`<cmd>\` exits 0 [lit:<id>]`, or why it cannot be built. */
export function compileCondition(plan, check) {
    const id = goalId(plan, check);
    const condition = `Every row in ${plan} is ticked and \`${check}\` exits 0 [lit:${id}]`;
    if (condition.length > GOAL_MAX_CHARS) {
        return { ok: false, reason: `the condition is over ${GOAL_MAX_CHARS} characters; point the check at one script` };
    }
    return { ok: true, condition, id };
}
/** A lit-loop's condition: its check exits 0 and its objective is done. No plan, so no rows to tick. */
export function compileLoopCondition(objective, check) {
    const id = goalId(`loop\u0000${objective}`, check);
    const condition = `\`${check}\` exits 0 and this is done: ${objective} [lit:${id}]`;
    if (condition.length > GOAL_MAX_CHARS) {
        return { ok: false, reason: `the condition is over ${GOAL_MAX_CHARS} characters; shorten the objective` };
    }
    return { ok: true, condition, id };
}
/** Rejects judgment words, an outward-only success, a command off the allowlist and conditions over the cap. */
export function lintCondition(condition, check) {
    const reasons = [];
    if (condition.length > GOAL_MAX_CHARS)
        reasons.push(`over ${GOAL_MAX_CHARS} characters`);
    const words = JUDGMENT_WORDS.map((pattern) => pattern.exec(check)?.[0]).filter((word) => word !== undefined);
    if (words.length > 0)
        reasons.push(`judgment words cannot be checked (${words.join(", ")})`);
    if (OUTWARD_ONLY.test(check))
        reasons.push("a push, publish or release is not a check of the work");
    if (!CHECK_ALLOWLIST.some((pattern) => pattern.test(check)))
        reasons.push(`\`${check}\` is not an allowlisted test command`);
    return { ok: reasons.length === 0, reasons };
}
/** Plan rows as LitCodex plans write them: `- [ ] N. title` / `- [x] F1. title` at column zero. */
export function planRows(planText) {
    const rows = [...planText.matchAll(/^- \[([ xX])\] /gmu)];
    return { total: rows.length, open: rows.filter((row) => row[1] === " ").length };
}
const runCheck = (cmd, args, cwd, timeoutMs) => {
    const result = spawnSync(cmd, [...args], { cwd, timeout: timeoutMs, stdio: "ignore", shell: false });
    return { status: result.status, signal: result.signal, error: result.error };
};
/**
 * The dry run: the condition must be false right now, or the goal would be met at its first check. The
 * check runs once, time-boxed, with no shell, so an unrunnable or hanging command is caught before it is a goal.
 */
export function falsify(args) {
    const timeoutMs = args.timeoutMs ?? FALSIFY_TIMEOUT_MS;
    const { open } = planRows(args.planText);
    const [cmd = "", ...rest] = args.check.split(/\s+/u);
    const result = (args.run ?? runCheck)(cmd, rest, args.cwd, timeoutMs);
    if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
        return { ok: false, reason: `\`${args.check}\` did not finish within ${Math.round(timeoutMs / 1000)} s` };
    }
    // A check script the plan itself creates is missing until the work runs: false now, not broken.
    const plannedScript = (cmd === "bash" || cmd === "sh") && rest.length === 1 && args.planText.includes(rest[0] ?? "");
    if ((result.error !== undefined && !plannedScript) || (result.status === 127 && !plannedScript)) {
        return { ok: false, reason: `\`${args.check}\` cannot run here` };
    }
    if (result.status === 0 && open === 0) {
        return {
            ok: false,
            reason: `the goal is already true (${args.plan} is all ticked and \`${args.check}\` exits 0)`,
        };
    }
    return { ok: true, open, exit: result.status };
}
/** A lit-loop has no unticked rows to keep its goal false, so its check must fail right now. */
export function falsifyLoop(args) {
    const timeoutMs = args.timeoutMs ?? FALSIFY_TIMEOUT_MS;
    const [cmd = "", ...rest] = args.check.split(/\s+/u);
    const result = (args.run ?? runCheck)(cmd, rest, args.cwd, timeoutMs);
    if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
        return { ok: false, reason: `\`${args.check}\` did not finish within ${Math.round(timeoutMs / 1000)} s` };
    }
    if (result.error !== undefined || result.status === 127) {
        return { ok: false, reason: `\`${args.check}\` cannot run here` };
    }
    if (result.status === 0) {
        return {
            ok: false,
            reason: `\`${args.check}\` already passes, so the goal would be met at once; write the failing test first`,
        };
    }
    return { ok: true, exit: result.status };
}
/** `goal propose <plan>`: the one line to add to the approval question, and the consent it recorded. */
export function proposeGoal(args) {
    const { cwd } = args;
    const planPath = resolve(cwd, args.planArg ?? "");
    // Windows `relative` uses backslashes; the plan id and its check are always written with `/`.
    const plan = relative(cwd, planPath).split(sep).join("/");
    if (args.planArg === undefined || isAbsolute(plan) || !/^\.litcodex\/plans\/[\w.-]+\.md$/u.test(plan)) {
        return { line: GOAL_STATUS.skipped("give the published plan as .litcodex/plans/<slug>.md inside this project") };
    }
    let planText;
    try {
        planText = readFileSync(planPath, "utf8");
    }
    catch {
        return { line: GOAL_STATUS.skipped(`${plan} cannot be read`) };
    }
    const goal = compileGoal(cwd, plan, planText, args);
    const consent = {
        version: 1,
        condition: goal.ok ? goal.condition : null,
        hash: consentHash(plan, goal.ok ? goal.condition : null),
        id: goal.ok ? goal.id : goalId(plan, ""),
        plan,
        askedAt: new Date(args.now ?? Date.now()).toISOString(),
    };
    if (!writeGoalFile(cwd, "consent.json", consent))
        return { line: GOAL_STATUS.skipped(`${GOAL_DIR} is not writable`) };
    // Without a goal the question still starts the work; the one reason line says why no goal comes with it.
    return goal.ok
        ? { line: GOAL_STATUS.asked(goal.condition), consent, asked: "plan" }
        : { line: `${GOAL_STATUS.skipped(goal.reason)}\n${GOAL_STATUS.askStart}`, consent, asked: "start" };
}
function compileGoal(cwd, plan, planText, args) {
    if (/^goal:\s*never\s*$/mu.test(planText))
        return { ok: false, reason: "this plan is marked goal: never" };
    const done = parseDoneWhen(planText);
    if (!done.ok)
        return { ok: false, reason: done.reason };
    const built = compileCondition(plan, done.check);
    if (!built.ok)
        return { ok: false, reason: built.reason };
    const lint = lintCondition(built.condition, done.check);
    if (!lint.ok)
        return { ok: false, reason: lint.reasons.join("; ") };
    const dry = falsify({
        cwd,
        plan,
        planText,
        check: done.check,
        ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
        ...(args.run === undefined ? {} : { run: args.run }),
    });
    if (!dry.ok)
        return { ok: false, reason: dry.reason };
    return { ok: true, condition: built.condition, id: built.id };
}
/** The text of a prompt after its run-route word, as the objective: no code, no pasted slash commands, no secrets. */
const MAX_OBJECTIVE_CHARS = 180;
export function normalizeGoalObjective(value) {
    const joined = value
        .split(/\r?\n/gu)
        .filter((line) => !line.trimStart().startsWith("/"))
        .join(" ");
    return redactSecrets(joined).replace(/\s+/gu, " ").slice(0, MAX_OBJECTIVE_CHARS).trim();
}
/** The project's own test command, for the question the prompt hook shows; null when there is none. */
export function detectCheck(cwd) {
    try {
        const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
        if (typeof pkg?.scripts?.test === "string")
            return "npm test";
    }
    catch {
        // No readable package.json.
    }
    for (const [file, check] of [
        ["pytest.ini", "pytest"],
        ["pyproject.toml", "pytest"],
        ["Cargo.toml", "cargo test"],
        ["go.mod", "go test ./..."],
    ]) {
        if (existsSync(join(cwd, file)))
            return check;
    }
    return null;
}
/**
 * `goal propose --loop --check "<cmd>" <objective>`: a lit-loop's question. With no settable goal it records
 * nothing and returns only `No goal set: <reason>`. `falsifyNow: false` skips the dry run (the prompt hook cannot
 * wait on a test run); the objective clause still keeps such a goal false until the work is done.
 */
export function proposeLoopGoal(args) {
    const objective = normalizeGoalObjective(args.objective ?? "");
    const check = (args.check ?? "").trim();
    if (objective === "")
        return { line: GOAL_STATUS.skipped("name what the loop should finish") };
    const built = compileLoopCondition(objective, check);
    if (!built.ok)
        return { line: GOAL_STATUS.skipped(built.reason) };
    const lint = lintCondition(built.condition, check);
    if (!lint.ok)
        return { line: GOAL_STATUS.skipped(lint.reasons.join("; ")) };
    if (args.falsifyNow !== false) {
        const dry = falsifyLoop({
            cwd: args.cwd,
            check,
            ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
            ...(args.run === undefined ? {} : { run: args.run }),
        });
        if (!dry.ok)
            return { line: GOAL_STATUS.skipped(dry.reason) };
    }
    const consent = {
        version: 1,
        kind: "loop",
        condition: built.condition,
        hash: conditionHash(built.condition),
        id: built.id,
        plan: null,
        askedAt: new Date(args.now ?? Date.now()).toISOString(),
    };
    if (!writeGoalFile(args.cwd, "consent.json", { ...consent, objective }))
        return { line: GOAL_STATUS.skipped(`${GOAL_DIR} is not writable`) };
    return { line: GOAL_STATUS.loopAsked(built.condition), consent, asked: "loop" };
}
/** `yes`, `edit` and `no` (exactly, any case) answer the goal question; anything else is no answer. */
export function consentAnswer(prompt) {
    const text = prompt.trim().toLowerCase();
    return text === "yes" || text === "edit" || text === "no" ? text : null;
}
function writeGoalFile(cwd, name, record) {
    try {
        if (!isAbsolute(cwd) || !plainDirsOrMissing(cwd, GOAL_DIR))
            return false;
        mkdirSync(join(cwd, GOAL_DIR), { recursive: true });
        writeFileAtomic(join(cwd, GOAL_DIR, name), `${JSON.stringify(record)}\n`);
        return true;
    }
    catch {
        return false;
    }
}
function readGoalFile(cwd, name) {
    try {
        const path = join(cwd, GOAL_DIR, name);
        if (!isAbsolute(cwd) || !existsSync(path) || !plainDirsOrMissing(cwd, GOAL_DIR))
            return null;
        const value = JSON.parse(readFileSync(path, "utf8"));
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? value
            : null;
    }
    catch {
        return null;
    }
}
const dropGoalFile = (cwd, name) => {
    try {
        if (isAbsolute(cwd) && plainDirsOrMissing(cwd, GOAL_DIR))
            rmSync(join(cwd, GOAL_DIR, name), { force: true });
    }
    catch {
        // A file that cannot be removed only expires.
    }
};
/** The consent the user is answering: fresh, and its hash still binds its condition. */
export function liveConsent(cwd, now) {
    const record = readGoalFile(cwd, "consent.json");
    if (record === null)
        return null;
    const { condition, hash, id, plan, askedAt } = record;
    if ((typeof condition !== "string" && condition !== null) || typeof id !== "string")
        return null;
    if (typeof askedAt !== "string")
        return null;
    const asked = Date.parse(askedAt);
    if (!Number.isFinite(asked) || now - asked > CONSENT_TTL_MS)
        return null;
    if (record["kind"] === "loop") {
        if (plan !== null || typeof condition !== "string" || hash !== conditionHash(condition))
            return null;
        return { version: 1, kind: "loop", condition, hash, id, plan: null, askedAt };
    }
    if (typeof plan !== "string" || hash !== consentHash(plan, condition))
        return null;
    return { version: 1, condition, hash, id, plan, askedAt };
}
/** The goal LitCodex armed in this project and has not seen finish, if any. */
export function ownedGoal(cwd) {
    const record = readGoalFile(cwd, "owner.json");
    return typeof record?.["condition"] === "string" &&
        typeof record["id"] === "string" &&
        record["hash"] === conditionHash(record["condition"]) &&
        typeof record["closedAt"] !== "string"
        ? { condition: record["condition"], id: record["id"] }
        : null;
}
/**
 * The owned goal finished: the model's `update_goal` with `status: "complete"` ran, which the PostToolUse hook sees.
 * The record is kept with `closedAt`, so a finished goal neither blocks the next lit-loop question nor earns a
 * `/goal clear` line on `lit cancel`. A goal the user clears by hand is not seen, and stays owned until `lit cancel`.
 */
export function closeOwnedGoal(cwd, now) {
    const record = readGoalFile(cwd, "owner.json");
    if (record === null || ownedGoal(cwd) === null)
        return false;
    return writeGoalFile(cwd, "owner.json", { ...record, closedAt: new Date(now).toISOString() });
}
const ACTIVE_RUN = new Set(["continue-work", "other-session", "approve-boundary"]);
/** The production start check: the plan is still open and no start-work run is under way in this project. */
export const defaultStartCheck = (cwd, plan, sessionId) => {
    if (openPlanNamed(cwd, basename(plan)) === null)
        return `${plan} is not an open plan`;
    if (ACTIVE_RUN.has(chooseNext(cwd, sessionId).kind))
        return "another start-work run is active; finish or cancel it first";
    return null;
};
/**
 * The answer to the plan question (R1), or null when no live question is open. An exact `yes` both starts the
 * plan's start-work run (the hook routes `start-work <slug>` exactly as if the user had typed it) and arms the
 * goal; when the run cannot start, the goal is not armed either. Every answer drops the consent.
 */
export function planAnswer(args) {
    const answer = consentAnswer(args.prompt);
    if (answer === null) {
        // Any other prompt ends a lit-loop question; a plan question waits for its answer until it expires.
        if (readGoalFile(args.cwd, "consent.json")?.["kind"] === "loop")
            dropGoalFile(args.cwd, "consent.json");
        return null;
    }
    const consent = liveConsent(args.cwd, args.now);
    if (consent === null)
        return null;
    dropGoalFile(args.cwd, "consent.json");
    if (consent.kind === "loop")
        return loopAnswer(args.cwd, consent, answer, args.sessionId, args.now);
    const plan = consent.plan;
    if (plan === null)
        return null;
    if (answer === "no") {
        return {
            context: `LitCodex plan: the user answered no. Reply with exactly \`${GOAL_STATUS.skipped("you said no")}\`, then ask how to go on with the plan; start nothing.`,
            start: null,
        };
    }
    if (answer === "edit") {
        return {
            context: `LitCodex plan: the user wants to edit. Ask one question: what to change in the plan or its \`## Done when\` check. Update ${plan}, run \`node <plugin-root>/components/lit-loop/dist/cli.js goal propose ${plan}\` again and ask its question again. Start and set nothing yourself.`,
            start: null,
        };
    }
    const refused = (args.startCheck ?? defaultStartCheck)(args.cwd, plan, args.sessionId);
    if (refused !== null) {
        return {
            context: `LitCodex plan: the answer was yes, but the work cannot start. Reply with exactly \`${GOAL_STATUS.notStarted(refused)}\` and start nothing.`,
            start: null,
        };
    }
    const start = `start-work ${basename(plan).replace(/\.md$/u, "")}`;
    if (consent.condition === null) {
        return {
            context: `LitCodex plan: the user approved the plan with yes; this prompt starts its work as \`${start}\`. No goal comes with it.`,
            start,
        };
    }
    const owned = writeGoalFile(args.cwd, "owner.json", {
        version: 1,
        condition: consent.condition,
        hash: conditionHash(consent.condition),
        id: consent.id,
        plan,
        sessionId: args.sessionId,
        setAt: new Date(args.now).toISOString(),
    });
    if (!owned) {
        return {
            context: `LitCodex plan: the answer was yes, but ${GOAL_DIR} is not writable. Reply with exactly \`${GOAL_STATUS.notStarted(`${GOAL_DIR} is not writable`)}\` and start nothing.`,
            start: null,
        };
    }
    return {
        context: [
            `LitCodex plan: the user approved the plan, its work and its goal with yes. This prompt starts the work as \`${start}\`; first set the goal with Codex's native goal tools:`,
            ...nativeGoalSteps(consent.condition, consent.id, "the start-work run below"),
            `Later, only while \`get_goal\` reports exactly this objective: when every row of ${plan} is ticked and its check exits 0, call \`update_goal\` with \`{"status": "complete"}\` and say \`${GOAL_STATUS.met(consent.id)}\`. On \`lit cancel\` or a BLOCKED stop, say \`${GOAL_STATUS.clearByUser(consent.id)}\`.`,
        ].join("\n"),
        start,
    };
}
/** The three steps that set the approved goal through Codex's native tools; the plan and loop answers share them. */
function nativeGoalSteps(condition, id, next) {
    return [
        `1. Call \`get_goal\`. When it reports an active goal whose objective is not exactly the condition below, that goal is the user's own: leave it, say \`${GOAL_STATUS.yours}\` and go on with the work.`,
        `2. Otherwise call \`create_goal\` with exactly ${JSON.stringify({ objective: condition })} and no other key.`,
        `3. When create_goal succeeded, say \`${GOAL_STATUS.set(id)}\`; when it failed or was denied, say \`${GOAL_STATUS.notConfirmed(condition)}\`. Then carry on with ${next}.`,
    ];
}
/** The answer to a lit-loop question: `yes` arms the goal and starts nothing; `no` and `edit` set nothing. */
function loopAnswer(cwd, consent, answer, sessionId, now) {
    const condition = consent.condition;
    if (answer === "edit" || condition === null)
        return null;
    if (answer === "no") {
        return {
            context: `LitCodex lit-loop: the user answered no to the goal question, so no goal is set. Make the first line of your reply exactly \`${GOAL_STATUS.skipped("you said no")}\`, then go on with the lit-loop work.`,
            start: null,
        };
    }
    if (ownedGoal(cwd) !== null)
        return null;
    const owned = writeGoalFile(cwd, "owner.json", {
        version: 1,
        condition,
        hash: conditionHash(condition),
        id: consent.id,
        plan: null,
        sessionId,
        setAt: new Date(now).toISOString(),
    });
    if (!owned) {
        return {
            context: `LitCodex lit-loop: the answer was yes, but ${GOAL_DIR} is not writable. Make the first line of your reply exactly \`${GOAL_STATUS.notConfirmed(condition)}\`, then go on with the lit-loop work.`,
            start: null,
        };
    }
    return {
        context: [
            "LitCodex lit-loop: the user approved the lit-loop goal with yes. This starts no start-work run; first set the goal with Codex's native goal tools:",
            ...nativeGoalSteps(condition, consent.id, "the lit-loop work"),
            `Later, only while \`get_goal\` reports exactly this objective: when the check in it exits 0 and the objective is done, call \`update_goal\` with \`{"status": "complete"}\` and say \`${GOAL_STATUS.met(consent.id)}\`. On \`lit cancel\` or a BLOCKED stop, say \`${GOAL_STATUS.clearByUser(consent.id)}\`.`,
        ].join("\n"),
        start: null,
    };
}
/** `lit cancel` while LitCodex owns a goal: the clear line for the user, never a clear of the goal itself. */
export function goalCancelContext(cwd) {
    const owned = ownedGoal(cwd);
    if (owned === null)
        return null;
    dropGoalFile(cwd, "owner.json");
    return `LitCodex goal: the run was cancelled. Call \`get_goal\`; only when its objective is exactly ${JSON.stringify(owned.condition)}, add the line \`${GOAL_STATUS.clearByUser(owned.id)}\` to your reply. Any other goal is the user's own: do not mention or change it.`;
}
/** SessionStart sweep: an expired question is removed so a later bare `yes` arms nothing. */
export function sweepGoalState(cwd, now) {
    if (readGoalFile(cwd, "consent.json") !== null && liveConsent(cwd, now) === null)
        dropGoalFile(cwd, "consent.json");
}
/** `cli.js goal propose <plan>` or `goal propose --loop --check "<cmd>" <objective>`. */
export function goalCommand(argv, io) {
    if (argv[0] !== "propose") {
        io.stderr.write('[lit-loop] goal: usage: goal propose .litcodex/plans/<slug>.md | goal propose --loop --check "<cmd>" <objective>\n');
        return 2;
    }
    const cwd = io.cwd ?? process.cwd();
    // `--loop --check "<cmd>" <objective...>` is a lit-loop's question; a plan path is a plan's.
    const result = argv[1] === "--loop" && argv[2] === "--check"
        ? proposeLoopGoal({ cwd, check: argv[3], objective: argv.slice(4).join(" ") })
        : proposeGoal({ cwd, planArg: argv[1] });
    // The model ends its reply with this output, so an asked question carries its answer guide below it.
    const guide = result.asked === undefined ? "" : `\n\n${markdownGuide(result.asked, result.consent?.condition ?? null)}`;
    io.stdout.write(`${result.line}${guide}\n`);
    return 0;
}
