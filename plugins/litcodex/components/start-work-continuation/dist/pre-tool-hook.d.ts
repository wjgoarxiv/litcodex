import { type StoreOptions } from "./lifecycle-store.js";
/**
 * The start-work PreToolUse guard. While this session owns a nonterminal run, a direct tool call naming a secret
 * or a Codex setting is denied; after another session ended the run with `lit cancel`, every guarded call is
 * denied until the user next types here. Everything else, including every other session, gets no output. The hook
 * never answers allow or ask; the lifecycle store's own checks stay the authority.
 */
export declare function runPreToolUseHook(input: unknown, options?: StoreOptions): string;
