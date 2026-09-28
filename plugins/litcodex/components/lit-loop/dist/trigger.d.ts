/** The accepted bounded lit-family tokens, longest-first (ordering is load-bearing — see below). */
export type LitTriggerToken = "lit-comprehend" | "deep-interview" | "lit-crucible" | "lit-init" | "start-work" | "review-work" | "litresearch" | "lit-recap" | "lit-loop" | "lit-plan" | "litcodex" | "litgoal" | "litwork" | "lit";
/**
 * Frozen tuple of the accepted tokens in match-priority (longest-first) order.
 * Exported so tests and the mode router (modes.ts) can enumerate without re-deriving.
 */
export declare const LIT_TRIGGER_TOKENS: readonly LitTriggerToken[];
/**
 * Bounded token regex kept as a non-global/non-sticky contract fixture for tests and low-level
 * consumers. Hook activation semantics MUST go through `matchLitTrigger()`, which additionally masks
 * Markdown code, ignores slash-command/path tokens except `/litresearch`, and expands natural
 * phrases after bare `lit`.
 * Boundaries: a token must be preceded by start-of-string OR a non `[letter|number|_]` code point,
 * and must NOT be followed by `[letter|number|_|-]`.
 *
 * MUST NOT carry the /g or /y flag: a global regex retains `lastIndex` between calls and would
 * make `.test()` return alternating results for the same input. Longest-first alternation
 * (`lit-comprehend|lit-crucible|lit-init|hyperplan|init-deep|start-work|review-work|litresearch|comprehend|lit-recap|lit-loop|lit-plan|litcodex|litrecap|litgoal|litwork|recap|리캡|lit`)
 * guarantees a longer family token wins over a bare `lit` at the same start; the trailing-`-`
 * lookahead means `lit work` (space) is a bare `lit` while `litwork` (glued) is the work mode.
 * The `litrecap` / `recap` / `리캡` alternatives are ROUTING ALIASES normalized to the canonical
 * `lit-recap` token, and bare `comprehend` normalizes to `lit-comprehend`, by `matchLitTrigger`
 * (they are not members of the token union).
 * No nested quantifiers / no backreferences ⇒ ReDoS-free.
 */
export declare const LIT_TRIGGER_PATTERN: RegExp;
/** Structured result of a successful match. */
export interface LitTriggerMatch {
    /** The normalized accepted token (always lowercase canonical form). */
    token: LitTriggerToken;
    /** The exact source substring that matched, preserving the user's original casing. */
    raw: string;
    /**
     * UTF-16 code-unit index of the first character of `raw` within the input prompt.
     *
     * INFORMATIONAL / DIAGNOSTIC ONLY. This is a UTF-16 code-unit offset (NOT a Unicode
     * code-point offset). Consumers MUST NOT use it to slice, splice, or index into the
     * prompt: an astral-plane character (e.g. an emoji) before the token makes the UTF-16
     * offset diverge from the code-point offset, so slicing by `index` is unsafe by contract.
     * Use it for logging / ordering ("which match came first") only. If a downstream module
     * ever needs a surrogate-pair-safe offset, it MUST compute the conversion itself; this
     * module will never emit a code-point offset.
     */
    index: number;
}
/**
 * Returns true iff `prompt` contains at least one bounded lit trigger.
 *
 * @param prompt Arbitrary untrusted user text (may be empty, multi-line, mixed-script).
 * @throws TypeError if `prompt` is not a string (defensive guard for `unknown` callers).
 */
export declare function isLitTriggerPrompt(prompt: string): boolean;
/**
 * Returns the FIRST bounded lit trigger match in document order, or null if none.
 * Deterministic: identical input always yields the identical result.
 *
 * @param prompt Arbitrary untrusted user text.
 * @returns LitTriggerMatch for the earliest match (lowest `index`), else null.
 * @throws TypeError if `prompt` is not a string.
 */
export declare function matchLitTrigger(prompt: string): LitTriggerMatch | null;
export declare function maskMarkdownCode(input: string): string;
