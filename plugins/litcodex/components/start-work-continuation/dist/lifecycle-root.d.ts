/**
 * The folder whose start-work state a hook in `cwd` should act on. From `cwd` upward, the nearest folder whose
 * state holds a nonterminal run (or, with `wantSession`, a cancel notice for that session) wins, so a nested
 * project's own run beats an outer one. A linked Git worktree falls back to its main checkout. With neither, the
 * answer is `cwd` itself, as before. Only files are read; no subprocess runs inside the hook's time budget.
 */
export declare function findLifecycleRoot(cwd: string, options?: {
    readonly wantSession?: string;
}): string;
