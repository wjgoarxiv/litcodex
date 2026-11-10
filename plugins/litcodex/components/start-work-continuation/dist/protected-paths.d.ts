export type AccessKind = "read" | "write";
/**
 * Why a run may not touch `path`, or null when it may. Secrets, shell and credential files and Codex settings are
 * refused for reads and writes; the rest of the Codex home, Git internals and the start-work state are refused for
 * writes only. Paths are compared after resolving symlinks, and case-folded where the file system usually is.
 */
export declare function protectedReason(path: string, kind: AccessKind, env?: NodeJS.ProcessEnv): string | null;
/** File-name rules alone (the `.env` family, SSH keys, `*.pem`, shell rc names, `.mcp.json`). */
export declare function isProtectedFileName(word: string): boolean;
/** The Codex home: `CODEX_HOME` when absolute, else `$HOME/.codex`; canonical and folded. */
export declare function codexHomeOf(env: NodeJS.ProcessEnv): string | null;
/** Resolve the nearest existing ancestor through symlinks and keep the rest of the path as written. */
export declare function canonical(path: string): string;
