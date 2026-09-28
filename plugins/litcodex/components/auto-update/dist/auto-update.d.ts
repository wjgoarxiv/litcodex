export declare const AUTO_UPDATE_PACKAGE: "@litfamily/litcodex";
export declare const DEFAULT_AUTO_UPDATE_TIMEOUT_MS = 10000;
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
    readonly lockStaleMs?: number;
    readonly spawn?: AutoUpdateSpawn;
    readonly verifyInstalled?: AutoUpdateVerify;
    readonly writeReceipt?: boolean;
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
 * is never treated as committed until this independent version probe agrees.
 */
export declare function verifyInstalledVersion(expectedVersion: string, options: AutoUpdateVerifyOptions): AutoUpdateVerification;
export declare function runForegroundAutoUpdate(options: AutoUpdateRunOptions): AutoUpdateResult;
export declare function readAutoUpdateReceipt(stateRoot?: string): AutoUpdateReceipt | null;
