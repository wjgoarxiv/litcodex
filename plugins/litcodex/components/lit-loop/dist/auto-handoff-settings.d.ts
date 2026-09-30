export declare const AUTO_HANDOFF_FLAG_ENV = "LITCODEX_AUTO_HANDOFF";
export declare const AUTO_HANDOFF_PERCENT_ENV = "LITCODEX_AUTO_HANDOFF_PERCENT";
export declare const AUTO_HANDOFF_DIR = ".litcodex/auto-handoff";
export declare const AUTO_HANDOFF_SETTINGS_FILE = "settings.json";
export declare const HOST_COMPACT_KEY = "model_post_turn_compact_threshold_percent";
export declare const HOST_COMPACT_BEGIN = "# litcodex automatic handoff (managed by `lit-handoff auto`; `lit-handoff auto off` removes it)";
export interface StoredAutoHandoff {
    readonly enabled: boolean;
    readonly percent: number | null;
}
export type AutoHandoffSource = "default" | "command" | "environment";
export interface AutoHandoffState {
    /** True only when the feature is on AND has a valid percent. */
    readonly active: boolean;
    /** The percent in force, or null when there is none. */
    readonly percent: number | null;
    /** Where the on/off decision came from. */
    readonly source: AutoHandoffSource;
    /** Plain-language problems the doctor and `status` show. */
    readonly warnings: readonly string[];
}
/** A whole number from 1 to 99 written as plain digits, else null. */
export declare function parsePercent(raw: string | undefined): number | null;
export declare function settingsPath(repoRoot: string): string;
/** Read a small regular file; null when missing, a symlink, too large, or unreadable. */
export declare function readSmallFile(path: string): string | null;
/** The stored choice; a missing, malformed or hand-edited file reads as "off, no percent". */
export declare function readStoredAutoHandoff(repoRoot: string): {
    stored: StoredAutoHandoff;
    warning: string | null;
};
/**
 * Combine the environment with the stored choice. The environment wins when it is set: `=1` turns the
 * feature on and `=0` turns it off. The percent comes from its variable first, then from the stored
 * value. Nothing is active without a valid percent.
 */
export declare function resolveAutoHandoff(env: NodeJS.ProcessEnv, stored: StoredAutoHandoff, storedWarning?: string | null): AutoHandoffState;
export declare function loadAutoHandoffState(repoRoot: string, env: NodeJS.ProcessEnv): AutoHandoffState;
/** Atomic write that refuses to go through a symlink (in any component below `root`) or replace anything but a regular file. */
export declare function writeSmallFile(path: string, text: string, root: string): boolean;
export declare function writeStoredAutoHandoff(repoRoot: string, stored: StoredAutoHandoff): boolean;
export declare function projectConfigPath(repoRoot: string): string;
export type ProjectCompaction = {
    readonly kind: "managed";
    readonly percent: number;
} | {
    readonly kind: "user-set";
    readonly percent: number;
} | {
    readonly kind: "absent";
};
/** What the project's `.codex/config.toml` says about compacting after a turn. */
export declare function readProjectCompaction(repoRoot: string): ProjectCompaction;
/**
 * True when `$CODEX_HOME/config.toml` marks this project trusted. Codex ignores a project's own
 * `.codex/config.toml` until then, so an untrusted project never gets the compaction setting applied.
 */
export declare function projectTrusted(repoRoot: string, env: NodeJS.ProcessEnv): boolean;
/** True when Codex itself will compact once a turn ends with usage at or above `percent`. */
export declare function hostCompactsAt(repoRoot: string, percent: number, env: NodeJS.ProcessEnv): boolean;
export type ProjectConfigResult = "written" | "unchanged-user-key" | "failed" | "removed" | "nothing-to-remove";
/** Write (or update) the marked block. A key the user wrote by hand stays as it is. */
export declare function writeProjectCompaction(repoRoot: string, percent: number): ProjectConfigResult;
/** Remove only the marked block; delete the file (and an empty `.codex`) when nothing else is left. */
export declare function removeProjectCompaction(repoRoot: string): ProjectConfigResult;
/**
 * Remove the managed block when the feature is effectively off, however it got there: `lit-handoff auto
 * off`, `LITCODEX_AUTO_HANDOFF=0`, a deleted settings file, or a percent that is not valid. Without this the
 * block outlives the switch and Codex keeps compacting at that percent with no handoff. Only the marked
 * block goes; a key the user wrote by hand is never touched. Never throws.
 */
export declare function clearManagedCompactionWhenOff(repoRoot: string, env: NodeJS.ProcessEnv): ProjectConfigResult;
export type AutoHandoffRoute = {
    readonly action: "on";
    readonly argument: string | null;
} | {
    readonly action: "off";
} | {
    readonly action: "status";
} | {
    readonly action: "usage";
};
/** Only the complete prompt `lit-handoff auto ...` (case-insensitive, edge whitespace allowed) is a route. */
export declare function parseAutoHandoffRoute(prompt: string): AutoHandoffRoute | null;
export declare function describeAutoHandoff(repoRoot: string, state: AutoHandoffState, env: NodeJS.ProcessEnv): string;
/** Apply a parsed route and return the one message the user sees. Never throws. */
export declare function applyAutoHandoffRoute(repoRoot: string, env: NodeJS.ProcessEnv, route: AutoHandoffRoute): string;
