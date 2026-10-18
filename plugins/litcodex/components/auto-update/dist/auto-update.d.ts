export declare const AUTO_UPDATE_PACKAGE: "@litfamily/litcodex";
export declare const DEFAULT_AUTO_UPDATE_TIMEOUT_MS = 10000;
/**
 * Limit for each install step: the global npm install, the target's Codex install, and both rollbacks.
 * Measured on 2026-10-11 against the public registry from an empty npm cache: the global install with its
 * postinstall pre-warm took 1.7-5.6 s and the target's Codex install took 7.9-14.1 s, so the old shared
 * 10 s limit could cut the Codex step. Sixty seconds is about ten times the slowest npm install and four
 * times the slowest Codex install, while one stuck step still cannot hold a session for long.
 */
export declare const DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS = 60000;
export declare const DEFAULT_AUTO_UPDATE_INTERVAL_MS: number;
export declare const DEFAULT_AUTO_UPDATE_RETRY_INTERVAL_MS: number;
export declare const DEFAULT_AUTO_UPDATE_LOCK_STALE_MS: number;
export declare const AUTO_UPDATE_SCHEMA_VERSION: 1;
export declare const OFFICIAL_NPM_REGISTRY: "https://registry.npmjs.org/";
export type NpmCommand = "npm" | "npm.cmd";
export interface NpmInvocationOptions {
    readonly platform?: NodeJS.Platform;
    readonly npmExecPath?: string | undefined;
    readonly nodePath?: string;
}
export interface NpmInvocation {
    readonly command: string;
    readonly args: readonly string[];
}
export declare function resolveNpmCommand(platform?: NodeJS.Platform): NpmCommand;
export declare function resolveNpmInvocation(args: readonly string[], options?: NpmInvocationOptions): NpmInvocation;
export type AutoUpdateSource = "session-start" | "management-command";
export type AutoUpdateStatus = "updated" | "up-to-date" | "skipped" | "failed" | "unknown-state" | "locked" | "throttled";
export type AutoUpdateVerificationStatus = "verified" | "mismatch" | "unavailable" | "not-run";
export type AutoUpdateDoctorStatus = "passed" | "failed" | "unavailable" | "not-run";
export interface AutoUpdateVerification {
    readonly status: AutoUpdateVerificationStatus;
    readonly expectedVersion: string;
    readonly observedVersion?: string | undefined;
    readonly doctorStatus: AutoUpdateDoctorStatus;
    readonly doctorDetail?: string | undefined;
    readonly codexInstallAttempted?: boolean | undefined;
    readonly detail: string;
}
export interface AutoUpdateSpawnOptions {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeout: number;
    readonly stdio: "ignore" | ["ignore", "pipe", "pipe"];
}
export interface AutoUpdateSpawnResult {
    readonly status: number | null;
    readonly signal?: NodeJS.Signals | null | undefined;
    readonly error?: Error | undefined;
    readonly stdout?: string | Buffer | undefined;
    readonly stderr?: string | Buffer | undefined;
}
export type AutoUpdateSpawn = (command: string, args: readonly string[], options: AutoUpdateSpawnOptions) => AutoUpdateSpawnResult;
export interface AutoUpdateVerifyOptions {
    readonly command: string;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeout: number;
    readonly installTimeout?: number;
    readonly spawn: AutoUpdateSpawn;
}
export type AutoUpdateVerify = (expectedVersion: string, options: AutoUpdateVerifyOptions) => AutoUpdateVerification;
export interface AutoUpdatePlanOptions {
    readonly env?: NodeJS.ProcessEnv | undefined;
    readonly argv?: readonly string[] | undefined;
    readonly now?: number | undefined;
    readonly currentVersion?: string | undefined;
    readonly latestVersion?: string | undefined;
    readonly source: AutoUpdateSource;
    readonly eligible?: boolean | undefined;
    readonly installFlow?: "package" | "marketplace" | undefined;
    readonly lastCheckedAt?: number | undefined;
    readonly lastAttemptedAt?: number | undefined;
    readonly lastStatus?: "success" | "failed" | "started" | undefined;
}
export interface AutoUpdatePlan {
    readonly shouldRun: boolean;
    readonly reason?: "disabled" | "existing-opt-out" | "recursion-guard" | "ci" | "ineligible" | "marketplace-flow" | "throttled" | "retry-throttled" | "unknown-current" | "unknown-latest" | "up-to-date" | "locked" | undefined;
    readonly source: AutoUpdateSource;
    readonly currentVersion?: string | undefined;
    readonly latestVersion?: string | undefined;
    readonly command?: string | undefined;
    readonly args?: readonly string[] | undefined;
}
export interface AutoUpdateRunOptions extends AutoUpdatePlanOptions {
    readonly stateRoot?: string;
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly installTimeoutMs?: number;
    readonly lockStaleMs?: number;
    readonly spawn?: AutoUpdateSpawn;
    readonly verifyInstalled?: AutoUpdateVerify;
    readonly writeReceipt?: boolean;
    /** Read at the start (unless `now` is given) and again at the end, so the receipt shows the real finish. */
    readonly clock?: () => number;
    /**
     * The versioned plugin folder the running Codex session started from. Codex removes it when the new plugin
     * is installed, yet the session keeps using its hooks and skill files, so the updater puts it back.
     */
    readonly keepPluginRoot?: string;
}
export interface AutoUpdateReceipt {
    readonly schemaVersion: typeof AUTO_UPDATE_SCHEMA_VERSION;
    readonly packageName: typeof AUTO_UPDATE_PACKAGE;
    readonly status: AutoUpdateStatus;
    readonly reason?: string | undefined;
    readonly source: AutoUpdateSource;
    readonly currentVersion?: string | undefined;
    readonly latestVersion?: string | undefined;
    readonly rollbackAttempted: boolean;
    readonly rollbackStatus?: number | null | undefined;
    readonly verificationStatus?: AutoUpdateVerificationStatus | undefined;
    readonly verifiedVersion?: string | undefined;
    readonly verificationDetail?: string | undefined;
    readonly doctorStatus?: AutoUpdateDoctorStatus | undefined;
    readonly doctorDetail?: string | undefined;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly journalPath: string;
}
export interface AutoUpdateResult extends AutoUpdateReceipt {
    readonly receiptPath: string;
}
export declare function resolveAutoUpdateStateRoot(env?: NodeJS.ProcessEnv): string;
export declare function sanitizeNpmEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function resolveAutoUpdatePlan(options: AutoUpdatePlanOptions): AutoUpdatePlan;
/**
 * Prove that npm's global executable resolves to the exact version that the install command targeted.
 * npm can return exit 0 for a no-op, warning, or partially successful lifecycle, so the install result
 * is never treated as committed until this independent version probe agrees. Only that exact package
 * then installs itself into Codex (managed marketplace and plugin cache); its doctor runs last, because
 * the doctor fails while Codex still holds the previous plugin version.
 */
export declare function verifyInstalledVersion(expectedVersion: string, options: AutoUpdateVerifyOptions): AutoUpdateVerification;
export declare function runForegroundAutoUpdate(options: AutoUpdateRunOptions): AutoUpdateResult;
/** The longest one transaction can run: three probes plus four install steps (two forward, two back). */
export declare function autoUpdateWorstCaseMs(timeout?: number, installTimeout?: number): number;
export declare function readAutoUpdateReceipt(stateRoot?: string): AutoUpdateReceipt | null;
