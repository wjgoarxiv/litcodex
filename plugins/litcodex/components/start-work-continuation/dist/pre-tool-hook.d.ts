import { type StoreOptions } from "./lifecycle-store.js";
/**
 * The start-work PreToolUse guard. While this session owns a nonterminal run, a direct tool call naming a secret
 * or a Codex setting is denied; after another session ended the run with `lit cancel`, every guarded call is
 * denied until the user next types here. Everything else, including every other session, gets no output. The hook
 * never answers allow or ask; the lifecycle store's own checks stay the authority.
 */
export declare function runPreToolUseHook(input: unknown, options?: StoreOptions): string;
/**
 * The guard's answer when it could not run: hook input over the byte limit, input that is not JSON, or a check that
 * threw. It denies when the input names a session that owns a run here, or when it names no session and folder at
 * all; a readable session and folder without a run get no output, so other sessions keep working.
 */
export declare function runPreToolUseFallback(head: string): string;
/** The same answer for parsed input whose check threw. */
export declare function uncheckedDecision(sessionId: unknown, cwd: unknown): string;
