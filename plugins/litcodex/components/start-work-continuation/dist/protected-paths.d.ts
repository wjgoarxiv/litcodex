export type AccessKind = "read" | "write";
/**
 * Why a run may not touch `path`, or null when it may. Secrets, shell and credential files and Codex settings are
 * refused for reads and writes; the rest of the Codex home, Git internals and the start-work state are refused for
 * writes only. Paths are compared after resolving symlinks, and case-folded where the file system usually is.
 */
export declare function protectedReason(path: string, kind: AccessKind, env?: NodeJS.ProcessEnv): string | null;
/**
 * Why removing, moving or replacing `path` as a whole would take a protected folder with it, or null. The folders are
 * the start-work state under `stateRoots`, any `.litcodex/start-work` found directly inside `path`, the Codex home
 * (it holds the seals) and the home's secret folders.
 */
export declare function containedReason(path: string, env?: NodeJS.ProcessEnv, stateRoots?: readonly string[]): string | null;
/**
 * Why a recursive read of `path` would walk into secrets or settings, or null: `path` is the home folder, the Codex
 * home, a secret folder, or a folder above one of them.
 */
export declare function ancestorReason(path: string, env?: NodeJS.ProcessEnv): string | null;
/** File-name rules alone (the `.env` family, SSH keys, `*.pem`, shell rc names, `.mcp.json`). */
export declare function isProtectedFileName(word: string): boolean;
/** The Codex home: `CODEX_HOME` when absolute, else `$HOME/.codex`; canonical and folded. */
export declare function codexHomeOf(env: NodeJS.ProcessEnv): string | null;
/**
 * Resolve `path` through every link, a dangling last one included, and keep the missing rest as written; folded.
 * A link loop or a chain past the hop limit resolves to a sentinel inside no folder, which `protectedReason` refuses.
 */
export declare function canonical(path: string): string;
/** `path` with every symbolic link followed (dangling ones too), or null for a loop or more than 16 hops. */
export declare function resolveLinks(path: string): string | null;
