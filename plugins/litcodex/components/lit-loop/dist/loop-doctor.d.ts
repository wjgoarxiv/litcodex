import type { LoopCheckpointRef, LoopDoctorReport, RunLoopDoctorDeps, RunLoopDoctorOptions } from "./loop-doctor-types.js";
export { renderDoctorJson, renderDoctorText } from "./loop-doctor-render.js";
/** The ONLY ledger kinds the checkpoint scan treats as terminal. Each is in BOTH producer enums. */
export declare const TERMINAL_LEDGER_KINDS: {
    readonly goal_completed: "complete";
    readonly goal_failed: "failed";
    readonly goal_blocked: "blocked";
};
/**
 * Resolves true iff the AGGREGATE hooks.json registers UserPromptSubmit with the canonical command
 * (all three HOOK_COMMAND_FRAGMENTS). ENOENT ⇒ false; any read/parse error rethrows to checkHook's
 * catch (→ warn). Never executes any command from the manifest.
 */
export declare function hookRegistered(repoRoot: string): Promise<boolean>;
/**
 * Install-aware hook probe (production default the global CLI injects). The dev-tree manifest
 * `<repoRoot>/plugins/litcodex/hooks/hooks.json` ONLY exists when run from the repo; a real install
 * (`litcodex loop doctor` from any cwd) has no such file, so the pure `hookRegistered` falsely warns
 * "not registered". This trusts the repoRoot manifest when present (dev/test), and otherwise looks
 * where the INSTALLED plugin actually lives: the Codex plugin cache
 * `<CODEX_HOME>/plugins/cache/.../hooks/hooks.json` (the global CLI runs the bundled lit-loop, so the
 * plugin's aggregate manifest only exists in that cache). Pure-read, never executes a command;
 * `opts.codexHome` is injectable so tests stay hermetic.
 */
export declare function hookRegisteredInstalled(repoRoot: string, opts?: {
    codexHome?: string;
}): Promise<boolean>;
/** Scan the ledger tail backward for the last terminal entry; null when none usable. */
export declare function latestCheckpointFromLedger(entries: ReadonlyArray<Record<string, unknown>>): LoopCheckpointRef | null;
/**
 * Produce a LoopDoctorReport. NEVER throws, NEVER mutates state, NEVER calls process.exit. Every
 * sub-check is independently fail-soft. Deterministic given the same on-disk state + injected deps.
 */
export declare function runLoopDoctor(options: RunLoopDoctorOptions, deps?: Partial<RunLoopDoctorDeps>): Promise<LoopDoctorReport>;
