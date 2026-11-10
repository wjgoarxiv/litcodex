import type { CancelNotice, StoreOptions } from "./lifecycle-store.js";
import type { ReadonlyFileSystem } from "./types.js";
export declare function runStopHook(input: unknown, _legacyFs?: ReadonlyFileSystem): string;
export type TypedRunCommand = "approve" | "deny" | "cancel";
/**
 * The whole prompt `lit approve` / `lit 승인`, `lit deny` / `lit 거절` or `lit cancel` / `lit 취소`, case-sensitive,
 * at most 512 characters. Anything around it (a quote, a code fence, a leading word) is ordinary text.
 */
export declare function parseTypedRunCommand(prompt: string): TypedRunCommand | null;
export declare function cancelNoticeText(notice: CancelNotice): string;
export declare function runUserPromptSubmitHook(input: unknown, options?: StoreOptions): string;
interface StartWorkRoute {
    readonly selector: string | null;
    readonly resumeBoundaryId: string | null;
    readonly grantId: string | null;
    readonly worktreePath: string | null;
}
export declare function parseExplicitStartWorkPrompt(prompt: string): StartWorkRoute | null;
export {};
