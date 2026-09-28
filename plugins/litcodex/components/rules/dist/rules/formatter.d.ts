import type { LoadedRule } from "./types.js";
export interface FormatOptions {
    maxRuleChars: number;
    maxResultChars: number;
}
export interface FormatBlockResult {
    block: string;
    rules: LoadedRule[];
}
export declare function formatStaticBlock(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): string;
export declare function formatStaticBlockResult(rules: ReadonlyArray<LoadedRule>, options: FormatOptions): FormatBlockResult;
export declare function formatDynamicBlock(rules: ReadonlyArray<LoadedRule>, targetRelativePath: string, options: FormatOptions): string;
export declare function formatDynamicBlockResult(rules: ReadonlyArray<LoadedRule>, targetRelativePath: string, options: FormatOptions): FormatBlockResult;
