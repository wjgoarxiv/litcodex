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
}
type GuardOptions = {
    readonly scan?: (text: string) => readonly HumanizerFinding[];
};
export declare function humanizerFailOpenOutput(event: "PreToolUse" | "PostToolUse"): string;
/** Run the bundled detector. Its exit statuses 1 and 2 represent findings; 2 is also used for block hits. */
export declare function inspectHumanizerText(text: string, detectorPath?: string): readonly HumanizerFinding[];
/** Deny block-tier findings before a supported editor writes; warnings are advisory context. */
export declare function runHumanizerPreToolUse(input: HumanizerHookInput, options?: GuardOptions): string;
/** Inspect Office/PDF output after creation; block findings ask the model to fix and rebuild. */
export declare function runHumanizerPostToolUse(input: HumanizerHookInput, options?: GuardOptions): string;
export {};
