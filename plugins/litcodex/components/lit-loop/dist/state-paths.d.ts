export declare const LIT_LOOP_DIR = ".litcodex/lit-loop";
export declare const LIT_LOOP_BRIEF = "brief.md";
export declare const LIT_LOOP_GOALS = "goals.json";
export declare const LIT_LOOP_LEDGER = "ledger.jsonl";
export declare const LIT_LOOP_EVIDENCE = "evidence";
/** Optional session partition. Absent / null ⇒ the unscoped root dir. */
export interface LitLoopScope {
    readonly sessionId?: string | null;
}
/**
 * Sanitize an arbitrary session id into a single safe path segment, OR null.
 * Splits on `/` and `\`, drops "", ".", ".." segments, joins survivors with "-", whitelists
 * `[A-Za-z0-9._-]` (everything else → "-"), collapses repeats, strips leading dots and
 * leading/trailing `[.-]`. Provably contains no "/", "\", or ".." and is never "."/""/null-unsafe.
 */
export declare function normalizeSessionId(sessionId: string | null | undefined): string | null;
/** Relative dir: `.litcodex/lit-loop` or `.litcodex/lit-loop/<normalizedSessionId>`. */
export declare function litLoopRelativeDir(scope?: LitLoopScope): string;
/** Absolute scope dir. repoRoot MUST be absolute. */
export declare function litLoopDir(repoRoot: string, scope?: LitLoopScope): string;
export declare function litLoopBriefPath(repoRoot: string, scope?: LitLoopScope): string;
export declare function litLoopGoalsPath(repoRoot: string, scope?: LitLoopScope): string;
export declare function litLoopLedgerPath(repoRoot: string, scope?: LitLoopScope): string;
export declare function litLoopEvidenceDir(repoRoot: string, scope?: LitLoopScope): string;
/**
 * Resolve an evidence file path under the scope's evidence/ dir. Rejects an escaping `name`
 * (contains "/", "\", "..", or is ""/".") with LIT_LOOP_EVIDENCE_NAME_UNSAFE BEFORE any fs op.
 */
export declare function evidencePath(repoRoot: string, name: string, scope?: LitLoopScope): string;
/** repoRoot-relative, forward-slash form of an absolute path (for messages / plan fields). */
export declare function repoRelative(absolutePath: string, repoRoot: string): string;
/**
 * Resolve a LitLoopScope from argv/env. Precedence (first non-blank wins): `--session <id>` /
 * `--session=<id>` / `--session-id <id>` / `--session-id=<id>` → env `LITCODEX_SESSION_ID` →
 * `CODEX_SESSION_ID` → `CODEX_THREAD_ID` → compatibility env `LITCODEX_LOOP_SESSION` →
 * `LIT_LOOP_SESSION`. The chosen raw id is normalized; returns `{ sessionId }` when a non-null id
 * results, else `undefined`. Pure aside from reading the provided `env` object (NEVER
 * `process.env`); zero I/O.
 */
export declare function resolveLoopScope(source: {
    argv?: readonly string[];
    env?: Record<string, string | undefined>;
}): LitLoopScope | undefined;
