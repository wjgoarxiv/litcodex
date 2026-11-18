// src/codex-hook.ts — M06 pure hook engine (A2 §2.4, A3 C3/C12).
//
// Takes an already-parsed `unknown` (the JSON.parse'd stdin value) and returns a structured
// HookDecision. NO process / stdin / stdout / exit lives here — that is hook-cli.ts. The engine is
// total over `unknown` and NEVER throws on a structurally-valid event.
//
// Activation policy is delegated to the SINGLE guard entry point
// `shouldSuppressLitLoopInjection(prompt, transcriptPath)` from ./guards.js (A3 C3): the engine
// branches only on its `{suppress, reason}` result and imports NOTHING from the trigger module
// (guard 0 `not-a-trigger` already covers lexical trigger detection). The engine never reads the
// transcript itself and never slices the prompt by any offset (A3 A6).
//
// Casing (A3 C12): the input type-guard accepts BOTH the snake_case wire key `hook_event_name`
// (primary) AND the camelCase `hookEventName` (fallback). The emitted envelope is ALWAYS camelCase
// (`hookSpecificOutput.hookEventName`).
//
// On activation the payload is the route's short head with its bundled directive and installed skill
// named as files (route-heads.ts), loaded behind a FAIL-SILENT boundary:
// a directive-load error resolves to "" (→ noop), so a missing dist/directive.md degrades the hook
// to a silent no-op + exit 0 rather than throwing into the Codex host.
import { isExactBrowserDrivePrompt, shouldSuppressBrowserDriveInjection } from "./browser-drive-route.js";
import { LitLoopDirectiveError } from "./directive.js";
import { hasContextPressureMarker, shouldSuppressInjection, transcriptHasContextPressureMarker, transcriptHasDirectiveMarker, } from "./guards.js";
import { isExactBareHandoffPrompt, shouldSuppressHandoffInjection } from "./handoff-route.js";
import { activationMessage } from "./lit-mark.js";
import { BROWSER_DRIVE_MODE_SPEC, HANDOFF_MODE_SPEC, modeForToken, resolveSkillPath, SCIENTIFIC_VISUALIZATION_MODE_SPEC, } from "./modes.js";
import { motionRouteContext } from "./motion-route.js";
import { continueContext, enterRoute, entryNotes, NO_REENTRY } from "./reentry.js";
import { loadRouteContext, loadSkillInvocationContext } from "./route-context.js";
import { classifySchematicRequest } from "./schematic-route.js";
import { isExactBareScientificVisualizationPrompt, isScientificVisualizationWhitespaceNearMiss, shouldSuppressScientificVisualizationInjection, } from "./scientific-visualization-route.js";
import { skillPlanFor } from "./skill-plan.js";
import { matchRenamedSkillInvocation, skillRenameNote } from "./skill-renames.js";
import { maskMarkdownCode, matchLitTrigger } from "./trigger.js";
const HOOK_EVENT_NAME = "UserPromptSubmit";
const PRE_TOOL_USE_EVENT_NAME = "PreToolUse";
const CREATE_GOAL_TOOL_NAME = "create_goal";
const CREATE_GOAL_DENY_REASON = "Use create_goal with objective only. Omit token_budget, status, metadata, and all other keys so the Codex goal stays unlimited.";
/**
 * Skills a leading route phrase names directly, checked before the bounded tokens: `ultra-brainstorm`,
 * `lit ultra-brainstorm` (hyphen or space) and `$litcodex:ultra-brainstorm` name the fan-out brainstorm, so
 * `lit … brainstorm` never takes it; `lit team <goal>` and `lit team mode <goal>` name the team orchestrator.
 */
export const EXPLICIT_SKILL_ROUTES = [
    {
        skill: "ultra-brainstorm",
        route: /^\s*(?:lit\s+ultra[\s-]?brainstorm(?:ing)?|ultra-brainstorm|\$litcodex:ultra-brainstorm)(?![\p{L}\p{N}_-])/iu,
    },
    { skill: "lit-team", route: /^\s*lit\s+team(?:\s+mode)?(?![\p{L}\p{N}_-])/iu },
];
/**
 * Which lit-adhd view the prompt asked for. The old lit-recap words (`lit recap`, `litrecap`, `recap`, `리캡`,
 * `lit-recap`) open the recap view with the one-line moved note; `lit adhd recap [session]` opens it without;
 * `자세히` / `detail` opens the KPI board; anything else gets the verdict card.
 */
export function adhdViewLine(prompt, raw) {
    const text = maskMarkdownCode(prompt);
    // Korean unless the user asked for English in so many words (R5): the code picks, the model passes the flag.
    const lang = /(?:^|\s)--en(?:glish)?\b|\bin english\b|영어로/iu.test(text) ? "en" : "ko";
    const session = /\brecap\s+([0-9a-f]{4,36})\b/iu.exec(text)?.[1]?.toLowerCase();
    const recap = session === undefined ? "--recap" : `--recap ${session}`;
    const view = (name, flags) => `lit-adhd view: ${name}. Run the collector with exactly these flags: \`${flags} --lang ${lang}\`.`;
    // The old lit-recap words get the moved note as the first line the collector prints.
    if (/recap|리캡/iu.test(raw))
        return view("recap", `${recap} --moved`);
    if (/(?:^|\s)(?:lit[\s-]+)?(?:adhd|rewind)\s+(?:recap|리캡)(?![\p{L}\p{N}_-])/iu.test(text))
        return view("recap", recap);
    if (/자세히|\bdetail(?:ed|s)?\b|--detail/iu.test(text))
        return view("detail", "--detail");
    return view("card", "--card");
}
/** Narrow to a plain (non-null, non-array) record. */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read either casing of the event-name key (snake wins on conflict, A3 C12). */
function readEventName(record) {
    if (Object.hasOwn(record, "hook_event_name")) {
        return record["hook_event_name"];
    }
    return record["hookEventName"];
}
/** Read either casing of the transcript-path key (snake wins on conflict). */
function readTranscriptPath(value) {
    if (!isRecord(value))
        return undefined;
    const record = value;
    if (Object.hasOwn(record, "transcript_path")) {
        return record["transcript_path"];
    }
    if (Object.hasOwn(record, "transcriptPath")) {
        return record["transcriptPath"];
    }
    return undefined;
}
function isTranscriptPathValue(value) {
    return value === undefined || value === null || typeof value === "string";
}
function readGuardTranscriptPath(value) {
    const path = readTranscriptPath(value);
    return isTranscriptPathValue(path) ? path : undefined;
}
/**
 * Type-guard. True iff `value` is a record whose accepted event-name key (snake `hook_event_name`
 * primary, camel `hookEventName` fallback) === "UserPromptSubmit", `prompt` is a string, and the
 * transcript-path key (either casing) is undefined | null | string (A3 C12). This is a runtime
 * accept-set, not a structural type assert, so a camelCase-keyed record also returns true.
 */
export function isLitUserPromptSubmitInput(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (readEventName(value) !== HOOK_EVENT_NAME) {
        return false;
    }
    if (typeof value["prompt"] !== "string") {
        return false;
    }
    return isTranscriptPathValue(readTranscriptPath(value));
}
export function isLitPreToolUseCreateGoalInput(value) {
    return (isRecord(value) &&
        readEventName(value) === PRE_TOOL_USE_EVENT_NAME &&
        value["tool_name"] === CREATE_GOAL_TOOL_NAME &&
        Object.hasOwn(value, "tool_input"));
}
/**
 * Wraps directive text and the active mode in the Codex output envelope. Returns "" if the
 * normalized context is empty (caller treats "" as noop). Output is a single-line JSON + trailing
 * "\n" with the per-invocation user-visible systemMessage at the top level.
 */
export function formatAdditionalContextOutput(additionalContext, mode, env = process.env) {
    const normalized = additionalContext.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (normalized.length === 0) {
        return "";
    }
    const output = {
        systemMessage: activationMessage(mode, env),
        hookSpecificOutput: {
            hookEventName: HOOK_EVENT_NAME,
            additionalContext: normalized,
        },
    };
    return `${JSON.stringify(output)}\n`;
}
function formatPreToolUseDenyOutput(reason) {
    const output = {
        hookSpecificOutput: {
            hookEventName: PRE_TOOL_USE_EVENT_NAME,
            permissionDecision: "deny",
            permissionDecisionReason: reason,
            additionalContext: reason,
        },
    };
    return `${JSON.stringify(output)}\n`;
}
function hasObjectiveOnlyCreateGoalInput(value) {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value);
    return keys.length === 1 && keys[0] === "objective" && typeof value["objective"] === "string";
}
export function applyPreToolUseCreateGoalGuard(input) {
    if (!isLitPreToolUseCreateGoalInput(input)) {
        return { kind: "noop" };
    }
    if (hasObjectiveOnlyCreateGoalInput(input.tool_input)) {
        return { kind: "noop" };
    }
    return { kind: "deny", stdout: formatPreToolUseDenyOutput(CREATE_GOAL_DENY_REASON) };
}
/**
 * Load the matched mode's directive behind a fail-silent boundary: any loader error (e.g. a missing
 * directives/<mode>.md or a marker-wrapper mismatch) resolves to "" so the hook degrades to a silent
 * no-op instead of throwing into the Codex host.
 */
function loadDirectiveForModeFailSilent(mode) {
    try {
        return loadRouteContext(mode);
    }
    catch {
        return "";
    }
}
/**
 * Pure decision function (multi-mode router). Takes an already-parsed value (NOT a raw string).
 * Total over `unknown`; NEVER throws. Flow: validate shape → match the lit-family trigger token
 * (guard 0) → resolve the mode → run guards 1-3 against the MATCHED mode's marker (RC1) → load that
 * mode's directive fail-silent. Returns { kind:"noop" } for a wrong-shape value, no trigger, a guard
 * veto, or a fail-silent empty directive; { kind:"inject", stdout } only on a real activation.
 *
 * `reentry` is read only once a lit-family route has matched. A route whose contract this session
 * already holds gets the short continue context (`entry: "continue"`) instead of the full activation.
 */
export function runUserPromptSubmitHook(input, reentry = () => NO_REENTRY) {
    if (!isLitUserPromptSubmitInput(input)) {
        return { kind: "noop" };
    }
    // `input` is a narrowed record here; re-read the transcript key (either casing) as a raw value.
    const transcriptPath = readGuardTranscriptPath(input);
    const masked = maskMarkdownCode(input.prompt);
    const explicit = EXPLICIT_SKILL_ROUTES.find(({ route }) => route.test(masked))?.skill;
    if (explicit !== undefined) {
        if (hasContextPressureMarker(input.prompt) || transcriptHasContextPressureMarker(transcriptPath))
            return { kind: "noop" };
        try {
            const context = loadSkillInvocationContext(explicit, resolveSkillPath(explicit));
            const stdout = formatAdditionalContextOutput(context, explicit);
            return stdout === "" ? { kind: "noop" } : { kind: "inject", stdout, mode: explicit };
        }
        catch (error) {
            if (error instanceof LitLoopDirectiveError)
                return { kind: "noop" };
            throw error;
        }
    }
    const match = matchLitTrigger(input.prompt);
    const renamed = matchRenamedSkillInvocation(maskMarkdownCode(input.prompt), match?.index ?? Infinity);
    if (renamed !== null) {
        const marker = `<${renamed.skillId}-mode>`;
        if (hasContextPressureMarker(input.prompt) ||
            transcriptHasContextPressureMarker(transcriptPath) ||
            transcriptHasDirectiveMarker(transcriptPath, marker))
            return { kind: "noop" };
        try {
            const context = renamed.skillId === "lit-crucible" || renamed.skillId === "lit-init"
                ? loadDirectiveForModeFailSilent(modeForToken(renamed.skillId))
                : loadSkillInvocationContext(renamed.skillId, resolveSkillPath(renamed.skillId));
            if (context === "")
                return { kind: "noop" };
            return {
                kind: "inject",
                mode: renamed.skillId,
                stdout: formatAdditionalContextOutput([context, renamed.note].filter(Boolean).join("\n"), renamed.skillId),
            };
        }
        catch (error) {
            if (error instanceof LitLoopDirectiveError)
                return { kind: "noop" };
            throw error;
        }
    }
    if (isExactBareHandoffPrompt(input.prompt)) {
        if (shouldSuppressHandoffInjection(transcriptPath))
            return { kind: "noop" };
        const stdout = formatAdditionalContextOutput(loadDirectiveForModeFailSilent(HANDOFF_MODE_SPEC), HANDOFF_MODE_SPEC.mode);
        if (stdout === "")
            return { kind: "noop" };
        return { kind: "inject", stdout, mode: HANDOFF_MODE_SPEC.mode };
    }
    if (isExactBareScientificVisualizationPrompt(input.prompt)) {
        if (shouldSuppressScientificVisualizationInjection(transcriptPath))
            return { kind: "noop" };
        const stdout = formatAdditionalContextOutput(loadDirectiveForModeFailSilent(SCIENTIFIC_VISUALIZATION_MODE_SPEC), SCIENTIFIC_VISUALIZATION_MODE_SPEC.mode);
        if (stdout === "")
            return { kind: "noop" };
        return { kind: "inject", stdout, mode: SCIENTIFIC_VISUALIZATION_MODE_SPEC.mode };
    }
    if (isExactBrowserDrivePrompt(input.prompt)) {
        if (shouldSuppressBrowserDriveInjection(transcriptPath))
            return { kind: "noop" };
        const stdout = formatAdditionalContextOutput(loadDirectiveForModeFailSilent(BROWSER_DRIVE_MODE_SPEC), BROWSER_DRIVE_MODE_SPEC.mode);
        if (stdout === "")
            return { kind: "noop" };
        return { kind: "inject", stdout, mode: BROWSER_DRIVE_MODE_SPEC.mode };
    }
    if (isScientificVisualizationWhitespaceNearMiss(input.prompt))
        return { kind: "noop" };
    // Guard 0 / routing: which bounded lit-family token matched → which mode + directive.
    if (match === null) {
        return { kind: "noop" };
    }
    // A bare `lit` that asks for a drawing of real equipment takes the schematic route, not the generic lit-loop one.
    const mode = modeForToken(match.token === "lit" && classifySchematicRequest(input.prompt) ? "lit-schematic" : match.token);
    // Whether this session already holds the contract comes from the session's saved state (reentry.ts), not the transcript.
    const decision = shouldSuppressInjection(input.prompt, transcriptPath, mode.openMarker, { transcriptDedupe: false });
    if (decision.suppress) {
        return { kind: "noop" };
    }
    const entry = enterRoute(input.prompt, mode.mode, reentry());
    const keeps = entry.kind === "continue" || (entry.kind === "resume" && entry.active);
    const route = entry.kind === "first" ? mode.mode : entry.route;
    const context = keeps ? continueContext(route, entry) : loadDirectiveForModeFailSilent(mode);
    const film = mode.skillName === "lit-loop" ? motionRouteContext(mode.skillPath, input.prompt) : "";
    const view = route === "lit-adhd" && !keeps ? adhdViewLine(input.prompt, match.raw) : "";
    // Only a prompt that reached its route through the word `lit` (or `litwork`) gets a skill plan.
    const plan = !keeps && /^lit(?:work)?$/iu.test(match.raw.split(/\s/u)[0] ?? "") ? skillPlanFor(input.prompt, route) : "";
    const stdout = context === ""
        ? ""
        : formatAdditionalContextOutput([context, ...(keeps ? [] : entryNotes(entry)), view, film, plan, skillRenameNote(match.raw)]
            .filter(Boolean)
            .join("\n"), route);
    if (stdout === "") {
        return { kind: "noop" };
    }
    return keeps
        ? { kind: "inject", stdout, mode: route, entry: "continue" }
        : { kind: "inject", stdout, mode: mode.mode };
}
