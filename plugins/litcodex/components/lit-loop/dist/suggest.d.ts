/**
 * The suggestion tier for prompts without `lit`. A few gated detectors offer a skill (plus "none") and let the model
 * decide; nothing loads by itself. When no rule fires, one compact catalog line names the common skills instead. A
 * rule ships only after it passed the eval gate in `test/fixtures/suggest-eval` (recall >= 0.85 and near-miss false
 * positives <= 0.10 on the dev half, then once on the sealed held-out half); a rule that failed stays a candidate
 * and its skill is still named in the catalog line. Everything here is local text matching: no network, no record.
 */
export interface SuggestionRule {
    readonly skill: string;
    readonly fires: (text: string) => boolean;
}
/** Every detector written for this repo, shipped or not; the eval gate test scores all of them. */
export declare const CANDIDATE_RULES: readonly SuggestionRule[];
/** The skills whose detectors passed the eval gate; the gate test fails if one of them stops passing. */
export declare const SHIPPED_SKILLS: readonly string[];
export declare const CATALOG_SKILLS: readonly string[];
/** Bytes the catalog line or a suggestion note may add to one prompt. */
export declare const SUGGESTION_BYTE_BUDGET = 512;
/** Code fences, inline code and host blocks such as `<environment_context>…</environment_context>` are not the user's words. */
export declare function strippedPrompt(prompt: string): string;
/** True when the prompt names a route itself: the word `lit`, a slash command or a `$skill` mention. */
export declare function namesRoute(prompt: string): boolean;
/** The skills the shipped rules offer for this prompt, in table order. */
export declare function firedSkills(prompt: string, rules?: readonly SuggestionRule[]): readonly string[];
/**
 * The context for a prompt without `lit`: a suggestion note, the catalog line, or "" when the prompt names a route.
 * A one-word prompt (`go`, `next`, `yes`) answers something already on screen, so it gets nothing either.
 */
export declare function suggestionContext(prompt: string): string;
