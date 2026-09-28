import type { StoreOptions } from "./lifecycle-store.js";
import type { ReadonlyFileSystem } from "./types.js";
export declare function runStopHook(input: unknown, _legacyFs?: ReadonlyFileSystem): string;
export declare function runUserPromptSubmitHook(input: unknown, options?: StoreOptions): string;
interface StartWorkRoute {
    readonly selector: string | null;
    readonly resumeBoundaryId: string | null;
    readonly grantId: string | null;
    readonly worktreePath: string | null;
}
export declare function parseExplicitStartWorkPrompt(prompt: string): StartWorkRoute | null;
export {};
