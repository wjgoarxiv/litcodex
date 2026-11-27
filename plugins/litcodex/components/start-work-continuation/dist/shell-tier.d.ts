/**
 * How the start-work guard reads one shell command while a run is active.
 *
 * Codex already runs every command under its own sandbox and approval policy, so this guard does not try to
 * allow-list the shell. It refuses only what a long unattended run must not do on its own: anything outward or
 * irreversible (push, tag, publish, reset, a network tool, a delete outside the project), a write that leaves the
 * run's granted roots, a commit without a matching `Run charter:`, and any shape that hides which program runs
 * (an expansion, a glob, a nested shell, a prefix such as `time` or `NAME=value`). Such a call is parked: denied,
 * recorded with its exact text, and the model is told to continue with the next row. Secrets and settings are
 * refused and never stored. Everything else passes untouched.
 *
 * A parked step has a tier. `B` is an allow-list and nothing else: `cd`, `touch`, `mkdir`, `cp`, `mv` and
 * `git add <named files>` whose every path resolves inside the project, outside `.git`, onto nothing that exists
 * yet for `cp`/`mv`. Plain `lit approve` replays B steps. Everything else parked is `X` and replays only on the
 * exact prompt `lit approve x`. A step with a `held` reason is listed but never replayed by any answer.
 */
export type Tier = "B" | "X";
export type Assessment = {
    readonly kind: "pass";
} | {
    readonly kind: "refused";
    readonly reason: string;
} | {
    readonly kind: "park";
    readonly tier: Tier;
    /** Why the command cannot be checked, or null when it can. A held step is never replayed. */
    readonly held: string | null;
    /** May reach outside the machine or the project, or cannot be undone: keeps a finished run open. */
    readonly outward: boolean;
    readonly why: string;
};
export interface ShellContext {
    /** Folder the command runs in. */
    readonly cwd: string;
    /** Canonical project root: the run's worktree, or the folder holding its state. */
    readonly project: string;
    /** Canonical roots the run may write: its authority roots and granted roots. */
    readonly roots: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    /** True when a commit in `cwd`'s repository on its current branch is covered by a consented charter. */
    readonly commitAllowed?: (repoRoot: string, branch: string) => boolean;
}
interface Word {
    readonly value: string;
    readonly raw: string;
    /** Unquoted `$`, backtick, glob, brace, backslash or `~` the word parser does not resolve. */
    readonly flag: string | null;
    readonly tildeUser: boolean;
}
interface Segment {
    readonly words: readonly Word[];
    readonly writes: readonly Word[];
    readonly reads: readonly Word[];
}
type Parsed = {
    readonly segments: readonly Segment[];
    readonly held: string | null;
};
/** Assess one command for an active run. Never throws. */
export declare function assessCommand(command: string, context: ShellContext): Assessment;
/**
 * The tier a command gets when it is parked, whether or not the guard would refuse it now. Replay runs this again,
 * so a stored step that was edited, or whose folder moved, is checked against the files as they are.
 */
export declare function parkedTier(command: string, context: ShellContext): {
    readonly kind: "refused";
    readonly reason: string;
} | {
    readonly kind: "tier";
    readonly tier: Tier;
    readonly held: string | null;
    readonly outward: boolean;
};
/** The repository holding `dir`: its work-tree root and Git folder (a linked worktree's `.git` file is followed). */
export declare function repoOf(dir: string): {
    readonly root: string;
    readonly gitDir: string;
} | null;
/** The branch `HEAD` names, read from the file at call time; null for a detached or unreadable HEAD. */
export declare function headBranch(gitDir: string): string | null;
/** Split a command into `&&`/`||`/`;`/`|` segments of words, with redirect targets apart. */
export declare function parse(command: string): Parsed;
export {};
