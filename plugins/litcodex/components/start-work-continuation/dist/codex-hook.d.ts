import type { StoreOptions } from "./lifecycle-store.js";
import type { ReadonlyFileSystem } from "./types.js";
export declare function runStopHook(input: unknown, _legacyFs?: ReadonlyFileSystem): string;
export type BoundaryAnswer = "approve" | "deny";
/**
 * The whole prompt `lit approve` / `lit 승인` or `lit deny` / `lit 거절`, case-sensitive, at most 512 bytes.
 * Anything around it (a quote, a code fence, a leading word) is ordinary text and answers nothing.
 */
export declare function parseBoundaryAnswer(prompt: string): BoundaryAnswer | null;
export declare function runUserPromptSubmitHook(input: unknown, options?: StoreOptions): string;
interface StartWorkRoute {
    readonly selector: string | null;
    readonly resumeBoundaryId: string | null;
    readonly grantId: string | null;
    readonly worktreePath: string | null;
}
export declare function parseExplicitStartWorkPrompt(prompt: string): StartWorkRoute | null;
export {};
