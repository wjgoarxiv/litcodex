// src/guards.ts — M07 activation-policy guard layer.
//
// Sits between the M05 bounded trigger matcher (./trigger.js) and the M06 hook runner. M05 asks
// "does this prompt lexically contain a `lit` trigger?"; M07 asks "given the surrounding session
// state, should we actually inject the <lit-loop-mode> directive NOW?". It owns four suppression
// guards, evaluated in a fixed order (suppression dominates activation):
//   0. not a lit trigger                 -> suppress, "not-a-trigger"
//   1. prompt is a context-pressure msg  -> suppress, "context-pressure-prompt"
//   2. transcript already hook-injected  -> suppress, "already-injected"
//   3. transcript shows context pressure -> suppress, "context-pressure-transcript"
//   else                                 -> allow,    "none"
//
// Detection is PURELY lexical/structural (fixed marker tables + a fixed JSON-envelope shape), so
// prompt prose cannot alter any guard outcome. Every file-reading guard is FAIL-OPEN: any thrown
// Error returns false (no suppression from that guard), never throwing — a missing, unreadable,
// oversized, or malformed transcript can never crash the Codex turn. This module reads transcript
// files but writes nothing and holds no mutable state.
//
// Dependency direction (A3 C9 flat layout; one-way: codex-hook -> guards -> trigger): imports ONLY
// ./trigger.js and ./markers.js; NEVER ./directive.js, ./state-store.js, or ./codex-hook.js
// (no-cycle invariant). The marker is the single-source markers.ts value, re-exported here
// (A3 C1) — never re-declared.

import { readFileSync } from "node:fs";
import { LIT_LOOP_DIRECTIVE_MARKER } from "./markers.js";
import { isLitTriggerPrompt } from "./trigger.js";

// Re-export the single-source directive marker (A3 C1) so the guards public surface is unchanged
// while markers.ts stays the only declaration site (guards never imports directive — no cycle).
export { LIT_LOOP_DIRECTIVE_MARKER } from "./markers.js";

/**
 * Context-pressure / compaction / recovery markers. Lowercase substrings; matching is
 * case-insensitive (input is lowercased before .includes). VERBATIM and ORDER-STABLE — the single
 * source of truth (A3 §E): any module needing context-pressure detection MUST import this array,
 * never copy it. Marker 5 retains the literal token `codex` (the host runtime, NOT a legacy brand —
 * A3 C16) and the literal U+0027 apostrophe in `model's`.
 */
export const CONTEXT_PRESSURE_MARKERS = Object.freeze([
	"context compacted",
	"context_length_exceeded",
	"skill descriptions were shortened",
	"context_too_large",
	"codex ran out of room in the model's context window",
	"your input exceeds the context window",
	"long threads and multiple compactions",
] as const);

/** Tail window (bytes) read for the guard-2 directive-dedupe scan. Exactly 512000. */
export const TRANSCRIPT_SEARCH_BYTES = 512000 as const;

/**
 * Per-end byte budget for the guard-3 (context-pressure-transcript) read. Guard 3 reads at most the
 * first and last GUARD3_WINDOW_BYTES of the transcript (whole file when smaller than 2×). Exactly
 * 1 MiB per end so worst-case guard-3 work is ≤ 2 MiB of fixed-string scanning (A3 addendum §A).
 * Distinct from TRANSCRIPT_SEARCH_BYTES (the guard-2 tail); the two MUST NOT be aliased.
 */
export const GUARD3_WINDOW_BYTES = 1048576 as const;

/**
 * The hook OUTPUT envelope event-name value, written to the transcript by M06 and matched by guard
 * 2 (A3 addendum §D). camelCase, load-bearing; declared exactly once here so M06's emitter and this
 * guard cannot drift. M06 imports this from ./guards.js (one-way: codex-hook -> guards).
 */
export const HOOK_OUTPUT_EVENT_NAME = "UserPromptSubmit" as const;

/** Normalized transcript-path input shape accepted by the file-reading guards. */
export type GuardTranscriptInput = string | null | undefined;

/** Structured suppression decision returned to the M06 hook runner. */
export interface LitLoopGuardDecision {
	/** true => the hook MUST emit "" (no directive); false => injection may proceed. */
	readonly suppress: boolean;
	/** Machine-readable reason. "none" only when suppress === false. */
	readonly reason:
		| "none"
		| "context-pressure-prompt"
		| "already-injected"
		| "context-pressure-transcript"
		| "not-a-trigger";
}

const PROMPT_NOT_A_STRING = "lit guard: prompt must be a string";
const TEXT_NOT_A_STRING = "lit guard: text must be a string";

// --- Internal helpers (not exported; semantics load-bearing) ----------------------------------

/** Narrow to a plain (non-null, non-array) record. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse one JSONL line. Empty/whitespace line -> null; JSON.parse Error -> null (skipped);
 * a non-Error throw (rare) is rethrown so the caller's fail-open boundary handles only Errors.
 */
function parseJsonLine(line: string): unknown {
	if (line.trim().length === 0) {
		return null;
	}
	try {
		return JSON.parse(line);
	} catch (error) {
		if (error instanceof Error) {
			return null;
		}
		throw error;
	}
}

// --- Pure marker matcher (guard 1 primitive) ---------------------------------------------------

/**
 * Pure lexical test: does `text` contain ANY context-pressure marker? Lowercases `text`, then
 * CONTEXT_PRESSURE_MARKERS.some(m => lower.includes(m)). No I/O, no state, idempotent.
 * @throws TypeError if `text` is not a string.
 */
export function hasContextPressureMarker(text: string): boolean {
	if (typeof text !== "string") {
		throw new TypeError(TEXT_NOT_A_STRING);
	}
	const lower = text.toLowerCase();
	return CONTEXT_PRESSURE_MARKERS.some((marker) => lower.includes(marker));
}

/** Alias used by the prompt-level guard (guard 1). Identical semantics to hasContextPressureMarker. */
export function isContextPressurePrompt(prompt: string): boolean {
	return hasContextPressureMarker(prompt);
}

// --- Guard 2: idempotency (already-injected) ---------------------------------------------------

/**
 * Generic per-mode idempotency check (RC1). Reads the TAIL (last TRANSCRIPT_SEARCH_BYTES bytes) of
 * the transcript, parses each JSONL line, and returns true iff some line is a prior HOOK OUTPUT
 * envelope: parsed.hookSpecificOutput.hookEventName === HOOK_OUTPUT_EVENT_NAME AND
 * typeof additionalContext === "string" AND additionalContext.includes(`marker`). A marker quoted
 * inside a user/assistant content STRING (or a forged envelope embedded as text) is NOT a top-level
 * envelope line and is skipped. FAIL-OPEN: any thrown Error => false. The multi-mode hook passes the
 * MATCHED mode's open marker so re-injection is suppressed per mode (mode switching is allowed).
 */
export function transcriptHasDirectiveMarker(transcriptPath: GuardTranscriptInput, marker: string): boolean {
	if (transcriptPath === null || transcriptPath === undefined) {
		return false;
	}
	try {
		const buf = readFileSync(transcriptPath);
		const tail = buf.subarray(Math.max(0, buf.byteLength - TRANSCRIPT_SEARCH_BYTES)).toString("utf8");
		for (const line of tail.split(/\r?\n/)) {
			const parsed = parseJsonLine(line);
			if (parsed === null || !isRecord(parsed)) {
				continue;
			}
			const hso = parsed["hookSpecificOutput"];
			if (!isRecord(hso)) {
				continue;
			}
			if (hso["hookEventName"] !== HOOK_OUTPUT_EVENT_NAME) {
				continue;
			}
			const additionalContext = hso["additionalContext"];
			if (typeof additionalContext === "string" && additionalContext.includes(marker)) {
				return true;
			}
		}
		return false;
	} catch (error) {
		if (error instanceof Error) {
			return false; // fail-open
		}
		throw error;
	}
}

/** Lit-loop idempotency guard (guard 2) — the generic check bound to the lit-loop marker. */
export function transcriptHasLitLoopDirective(transcriptPath: GuardTranscriptInput): boolean {
	return transcriptHasDirectiveMarker(transcriptPath, LIT_LOOP_DIRECTIVE_MARKER);
}

// --- Guard 3: context-pressure transcript ------------------------------------------------------

/**
 * Context-pressure transcript guard (guard 3). Reads a bounded head+tail window of the transcript
 * (A3 addendum §A): the whole file when ≤ 2×GUARD3_WINDOW_BYTES, else the first + last
 * GUARD3_WINDOW_BYTES joined by a "\n" separator (so a marker cannot be manufactured across the
 * cut), then runs hasContextPressureMarker over it. Markers buried in nested JSON are caught by
 * design. FAIL-OPEN: any thrown Error => false. null/undefined path => false.
 */
export function transcriptHasContextPressureMarker(transcriptPath: GuardTranscriptInput): boolean {
	if (transcriptPath === null || transcriptPath === undefined) {
		return false;
	}
	try {
		const buf = readFileSync(transcriptPath);
		const n = buf.byteLength;
		let text: string;
		if (n <= 2 * GUARD3_WINDOW_BYTES) {
			text = buf.toString("utf8");
		} else {
			const head = buf.subarray(0, GUARD3_WINDOW_BYTES).toString("utf8");
			const tail = buf.subarray(n - GUARD3_WINDOW_BYTES).toString("utf8");
			text = `${head}\n${tail}`;
		}
		return hasContextPressureMarker(text);
	} catch (error) {
		if (error instanceof Error) {
			return false; // fail-open
		}
		throw error;
	}
}

// --- Single entry point (A3 C3) -----------------------------------------------------------------

/**
 * THE single decision the M06 hook runner calls. Evaluates the four guards in fixed order and
 * returns the first veto, else {suppress:false, reason:"none"}. Suppression dominates activation:
 * guard 0 (not-a-trigger) runs first so the file-I/O guards only fire when a trigger is present;
 * guard 1 (context-pressure-prompt) runs before the transcript guards so a recovery prompt that
 * also contains `lit` is suppressed without any file read. Never throws for any string prompt +
 * GuardTranscriptInput path (the only throw is the non-string prompt defensive guard).
 * @throws TypeError only if `prompt` is not a string (M06 type-guards this upstream).
 */
export function shouldSuppressInjection(
	prompt: string,
	transcriptPath: GuardTranscriptInput,
	openMarker: string,
): LitLoopGuardDecision {
	if (typeof prompt !== "string") {
		throw new TypeError(PROMPT_NOT_A_STRING);
	}
	if (!isLitTriggerPrompt(prompt)) {
		return { suppress: true, reason: "not-a-trigger" };
	}
	if (isContextPressurePrompt(prompt)) {
		return { suppress: true, reason: "context-pressure-prompt" };
	}
	// RC1: guard 2 checks the MATCHED mode's marker only — re-injecting the SAME mode is suppressed,
	// switching modes (e.g. `lit` after `litwork`) is allowed.
	if (transcriptHasDirectiveMarker(transcriptPath, openMarker)) {
		return { suppress: true, reason: "already-injected" };
	}
	if (transcriptHasContextPressureMarker(transcriptPath)) {
		return { suppress: true, reason: "context-pressure-transcript" };
	}
	return { suppress: false, reason: "none" };
}

/** Lit-loop entry point (backward-compatible) — the generic decision bound to the lit-loop marker. */
export function shouldSuppressLitLoopInjection(
	prompt: string,
	transcriptPath: GuardTranscriptInput,
): LitLoopGuardDecision {
	return shouldSuppressInjection(prompt, transcriptPath, LIT_LOOP_DIRECTIVE_MARKER);
}
