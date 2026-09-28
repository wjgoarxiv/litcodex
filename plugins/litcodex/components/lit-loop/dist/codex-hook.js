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
// On activation the payload is the trusted bundled directive, loaded behind a FAIL-SILENT boundary:
// a directive-load error resolves to "" (→ noop), so a missing dist/directive.md degrades the hook
// to a silent no-op + exit 0 rather than throwing into the Codex host.
import { isExactBrowserDrivePrompt, shouldSuppressBrowserDriveInjection } from "./browser-drive-route.js";
import { LitLoopDirectiveError, loadDirectiveWithSkillBodyFrom, loadSkillInvocationContext } from "./directive.js";
import { hasContextPressureMarker, shouldSuppressInjection, transcriptHasContextPressureMarker, transcriptHasDirectiveMarker, } from "./guards.js";
import { isExactBareHandoffPrompt, shouldSuppressHandoffInjection } from "./handoff-route.js";
import { activationMessage } from "./lit-mark.js";
import { BROWSER_DRIVE_MODE_SPEC, HANDOFF_MODE_SPEC, modeForToken, resolveSkillPath, SCIENTIFIC_VISUALIZATION_MODE_SPEC, } from "./modes.js";
import { motionRouteContext } from "./motion-route.js";
import { isExactBareScientificVisualizationPrompt, isScientificVisualizationWhitespaceNearMiss, shouldSuppressScientificVisualizationInjection, } from "./scientific-visualization-route.js";
import { matchRenamedSkillInvocation, skillRenameNote } from "./skill-renames.js";
import { maskMarkdownCode, matchLitTrigger } from "./trigger.js";
const HOOK_EVENT_NAME = "UserPromptSubmit";
const PRE_TOOL_USE_EVENT_NAME = "PreToolUse";
const CREATE_GOAL_TOOL_NAME = "create_goal";
const CREATE_GOAL_DENY_REASON = "Use create_goal with objective only. Omit token_budget, status, metadata, and all other keys so the Codex goal stays unlimited; record native-goal-unavailable if the host goal tools are not available.";
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
        return loadDirectiveWithSkillBodyFrom(mode.directivePath, mode.openMarker, mode.closeMarker, mode.skillName, mode.skillPath);
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
 */
export function runUserPromptSubmitHook(input) {
    if (!isLitUserPromptSubmitInput(input)) {
        return { kind: "noop" };
    }
    // `input` is a narrowed record here; re-read the transcript key (either casing) as a raw value.
    const transcriptPath = readGuardTranscriptPath(input);
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
    const mode = modeForToken(match.token);
    const decision = shouldSuppressInjection(input.prompt, transcriptPath, mode.openMarker);
    if (decision.suppress) {
        return { kind: "noop" };
    }
    const context = loadDirectiveForModeFailSilent(mode);
    const stdout = context === ""
        ? ""
        : formatAdditionalContextOutput([
            context,
            mode.skillName === "lit-loop" ? motionRouteContext(mode.skillPath, input.prompt) : "",
            skillRenameNote(match.raw),
        ]
            .filter(Boolean)
            .join("\n"), mode.mode);
    if (stdout === "") {
        return { kind: "noop" };
    }
    return { kind: "inject", stdout, mode: mode.mode };
}
