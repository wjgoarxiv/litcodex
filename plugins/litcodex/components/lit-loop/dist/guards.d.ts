export { LIT_LOOP_DIRECTIVE_MARKER } from "./markers.js";
/**
 * Context-pressure / compaction / recovery markers. Lowercase substrings; matching is
 * case-insensitive (input is lowercased before .includes). VERBATIM and ORDER-STABLE — the single
 * source of truth (A3 §E): any module needing context-pressure detection MUST import this array,
 * never copy it. Marker 5 retains the literal token `codex` (the host runtime, NOT a legacy brand —
 * A3 C16) and the literal U+0027 apostrophe in `model's`.
 */
export declare const CONTEXT_PRESSURE_MARKERS: readonly ["context compacted", "context_length_exceeded", "skill descriptions were shortened", "context_too_large", "codex ran out of room in the model's context window", "your input exceeds the context window", "long threads and multiple compactions"];
/** Tail window (bytes) read for the guard-2 directive-dedupe scan. Exactly 512000. */
export declare const TRANSCRIPT_SEARCH_BYTES: 512000;
/**
 * Per-end byte budget for the guard-3 (context-pressure-transcript) read. Guard 3 reads at most the
 * first and last GUARD3_WINDOW_BYTES of the transcript (whole file when smaller than 2×). Exactly
 * 1 MiB per end so worst-case guard-3 work is ≤ 2 MiB of fixed-string scanning (A3 addendum §A).
 * Distinct from TRANSCRIPT_SEARCH_BYTES (the guard-2 tail); the two MUST NOT be aliased.
 */
export declare const GUARD3_WINDOW_BYTES: 1048576;
/**
 * The hook OUTPUT envelope event-name value, written to the transcript by M06 and matched by guard
 * 2 (A3 addendum §D). camelCase, load-bearing; declared exactly once here so M06's emitter and this
 * guard cannot drift. M06 imports this from ./guards.js (one-way: codex-hook -> guards).
 */
export declare const HOOK_OUTPUT_EVENT_NAME: "UserPromptSubmit";
/** Normalized transcript-path input shape accepted by the file-reading guards. */
export type GuardTranscriptInput = string | null | undefined;
/** Structured suppression decision returned to the M06 hook runner. */
export interface LitLoopGuardDecision {
    /** true => the hook MUST emit "" (no directive); false => injection may proceed. */
    readonly suppress: boolean;
    /** Machine-readable reason. "none" only when suppress === false. */
    readonly reason: "none" | "context-pressure-prompt" | "already-injected" | "context-pressure-transcript" | "not-a-trigger";
}
/**
 * Pure lexical test: does `text` contain ANY context-pressure marker? Lowercases `text`, then
 * CONTEXT_PRESSURE_MARKERS.some(m => lower.includes(m)). No I/O, no state, idempotent.
 * @throws TypeError if `text` is not a string.
 */
export declare function hasContextPressureMarker(text: string): boolean;
/** Alias used by the prompt-level guard (guard 1). Identical semantics to hasContextPressureMarker. */
export declare function isContextPressurePrompt(prompt: string): boolean;
/**
 * Generic per-mode idempotency check (RC1). Reads the TAIL (last TRANSCRIPT_SEARCH_BYTES bytes) of
 * the transcript, parses each JSONL line, and returns true iff some line is a prior HOOK OUTPUT
 * envelope: parsed.hookSpecificOutput.hookEventName === HOOK_OUTPUT_EVENT_NAME AND
 * typeof additionalContext === "string" AND additionalContext.includes(`marker`). A marker quoted
 * inside a user/assistant content STRING (or a forged envelope embedded as text) is NOT a top-level
 * envelope line and is skipped. FAIL-OPEN: any thrown Error => false. The multi-mode hook passes the
 * MATCHED mode's open marker so re-injection is suppressed per mode (mode switching is allowed).
 */
export declare function transcriptHasDirectiveMarker(transcriptPath: GuardTranscriptInput, marker: string): boolean;
/** Lit-loop idempotency guard (guard 2) — the generic check bound to the lit-loop marker. */
export declare function transcriptHasLitLoopDirective(transcriptPath: GuardTranscriptInput): boolean;
/**
 * Context-pressure transcript guard (guard 3). Reads a bounded head+tail window of the transcript
 * (A3 addendum §A): the whole file when ≤ 2×GUARD3_WINDOW_BYTES, else the first + last
 * GUARD3_WINDOW_BYTES joined by a "\n" separator (so a marker cannot be manufactured across the
 * cut), then runs hasContextPressureMarker over it. Markers buried in nested JSON are caught by
 * design. FAIL-OPEN: any thrown Error => false. null/undefined path => false.
 */
export declare function transcriptHasContextPressureMarker(transcriptPath: GuardTranscriptInput): boolean;
/**
 * THE single decision the M06 hook runner calls. Evaluates the four guards in fixed order and
 * returns the first veto, else {suppress:false, reason:"none"}. Suppression dominates activation:
 * guard 0 (not-a-trigger) runs first so the file-I/O guards only fire when a trigger is present;
 * guard 1 (context-pressure-prompt) runs before the transcript guards so a recovery prompt that
 * also contains `lit` is suppressed without any file read. Never throws for any string prompt +
 * GuardTranscriptInput path (the only throw is the non-string prompt defensive guard).
 * @throws TypeError only if `prompt` is not a string (M06 type-guards this upstream).
 */
export declare function shouldSuppressInjection(prompt: string, transcriptPath: GuardTranscriptInput, openMarker: string): LitLoopGuardDecision;
/** Lit-loop entry point (backward-compatible) — the generic decision bound to the lit-loop marker. */
export declare function shouldSuppressLitLoopInjection(prompt: string, transcriptPath: GuardTranscriptInput): LitLoopGuardDecision;
