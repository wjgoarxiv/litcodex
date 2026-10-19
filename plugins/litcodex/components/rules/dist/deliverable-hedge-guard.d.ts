export interface HumanizerHookInput {
    readonly hook_event_name: "PreToolUse" | "PostToolUse";
    readonly cwd: string;
    readonly tool_name: string;
    readonly tool_input: unknown;
    readonly tool_response?: unknown;
}
export interface HumanizerFinding {
    readonly file?: string;
    readonly line: number;
    readonly severity: "block" | "warn";
    readonly rule: string;
    readonly excerpt?: string;
    /** Last line of a multi-line finding, such as a negation-cluster paragraph. */
    readonly endLine?: number;
}
type GuardOptions = {
    readonly scan?: (text: string) => readonly HumanizerFinding[];
};
/**
 * Reader-facing prose formats. Block-tier rules are prose rules (a line-start `Source:` label, for
 * example), so they apply only here; code and data files such as YAML keys or Python docstrings
 * are never scanned.
 */
export declare const HUMANIZER_PROSE_EXTENSIONS: ReadonlySet<string>;
export declare function humanizerFailOpenOutput(event: "PreToolUse" | "PostToolUse"): string;
/** Run the bundled detector. Its exit statuses 1 and 2 represent findings; 2 is also used for block hits. */
export declare function inspectHumanizerText(text: string, detectorPath?: string): readonly HumanizerFinding[];
/** Deny block-tier findings before a supported editor writes; warnings are advisory context. */
export declare function runHumanizerPreToolUse(input: HumanizerHookInput, options?: GuardOptions): string;
/** Inspect Office/PDF output after creation; block findings ask the model to fix and rebuild. */
export declare function runHumanizerPostToolUse(input: HumanizerHookInput, options?: GuardOptions): string;
/**
 * Check beside the detector: definitional negations, plain or reworded, counted per paragraph or list block,
 * and per column in a Markdown table (short status cells ignored). Code, inline code and quote lines are
 * removed first. A block finding goes through the guard's normal refusal; a warning stays advisory.
 */
export declare function negationClusterFindings(text: string): HumanizerFinding[];
export {};
