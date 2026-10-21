import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, win32 } from "node:path";

export const AUTO_UPDATE_PACKAGE = "@litfamily/litcodex" as const;
export const DEFAULT_AUTO_UPDATE_TIMEOUT_MS = 10_000;
/**
 * Limit for each install step: the global npm install, the target's Codex install, and both rollbacks.
 * Measured on 2026-10-11 against the public registry from an empty npm cache: the global install with its
 * postinstall pre-warm took 1.7-5.6 s and the target's Codex install took 7.9-14.1 s, so the old shared
 * 10 s limit could cut the Codex step. Sixty seconds is about ten times the slowest npm install and four
 * times the slowest Codex install, while one stuck step still cannot hold a session for long.
 */
export const DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS = 60_000;
export const DEFAULT_AUTO_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTO_UPDATE_RETRY_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_AUTO_UPDATE_LOCK_STALE_MS = 10 * 60 * 1000;
export const AUTO_UPDATE_SCHEMA_VERSION = 1 as const;
export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org/" as const;

export type NpmCommand = "npm" | "npm.cmd";

export interface NpmInvocationOptions {
	readonly platform?: NodeJS.Platform;
	readonly npmExecPath?: string | undefined;
	readonly nodePath?: string;
	readonly exists?: (path: string) => boolean;
}

export interface NpmInvocation {
	readonly command: string;
	readonly args: readonly string[];
}

export function resolveNpmCommand(platform: NodeJS.Platform = process.platform): NpmCommand {
	return platform === "win32" ? "npm.cmd" : "npm";
}

export function resolveNpmInvocation(args: readonly string[], options: NpmInvocationOptions = {}): NpmInvocation {
	const platform = options.platform ?? process.platform;
	const npmExecPath = Object.hasOwn(options, "npmExecPath") ? options.npmExecPath : process.env["npm_execpath"];
	const nodePath = options.nodePath ?? process.execPath;
	const exactNpm = npmExecPath?.trim();
	if (exactNpm) return { command: nodePath, args: [exactNpm, ...args] };
	if (platform === "win32") {
		// A session hook has no npm_execpath; the npm that ships beside node.exe avoids the npm.cmd shim.
		const bundled = win32.join(win32.dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
		if ((options.exists ?? existsSync)(bundled)) return { command: nodePath, args: [bundled, ...args] };
	}
	return { command: resolveNpmCommand(platform), args: [...args] };
}

export interface ShellSafeInvocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly shell: boolean;
}

/**
 * Node refuses to spawn a .cmd/.bat file without a shell (CVE-2024-27980: spawnSync npm.cmd EINVAL).
 * On Windows such a command becomes one cmd.exe line of quoted arguments; anything cmd.exe would
 * interpret is refused rather than escaped.
 */
export function shellSafeInvocation(
	command: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
): ShellSafeInvocation {
	if (platform !== "win32" || !/\.(?:cmd|bat)$/iu.test(command)) return { command, args: [...args], shell: false };
	const quoted = [command, ...args].map((value) => {
		if (/["%^&|<>!\r\n]/u.test(value)) throw new Error(`refusing to pass ${JSON.stringify(value)} through cmd.exe`);
		return /[\s()]/u.test(value) ? `"${value}"` : value;
	});
	return { command: quoted.join(" "), args: [], shell: true };
}

export type AutoUpdateSource = "session-start" | "management-command";
export type AutoUpdateStatus =
	| "updated"
	| "up-to-date"
	| "skipped"
	| "failed"
	| "unknown-state"
	| "locked"
	| "throttled";

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

export type AutoUpdateSpawn = (
	command: string,
	args: readonly string[],
	options: AutoUpdateSpawnOptions,
) => AutoUpdateSpawnResult;

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
	readonly reason?:
		| "disabled"
		| "existing-opt-out"
		| "recursion-guard"
		| "ci"
		| "ineligible"
		| "marketplace-flow"
		| "throttled"
		| "retry-throttled"
		| "unknown-current"
		| "unknown-latest"
		| "up-to-date"
		| "locked"
		| undefined;
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

interface AutoUpdateState {
	readonly lastCheckedAt?: number;
	readonly lastAttemptedAt?: number;
	readonly lastStatus?: "success" | "failed" | "started";
}

const SAFE_ENV_KEYS = [
	"PATH",
	"HOME",
	"USERPROFILE",
	"HOMEDRIVE",
	"HOMEPATH",
	"SystemRoot",
	"SYSTEMROOT",
	"TMPDIR",
	"TMP",
	"TEMP",
	"LANG",
	"LC_ALL",
] as const;

// These name the Codex host being managed. The target package's install, version probe and doctor
// must act on the same host as the session that started the update, so only those children get them.
const CODEX_HOST_ENV_KEYS = [
	"CODEX_HOME",
	"CODEX_BIN",
	"LITCODEX_DATA_ROOT",
	"LITCODEX_AUTO_UPDATE_STATE_ROOT",
] as const;

function parseStableVersion(version: unknown): readonly [bigint, bigint, bigint] | null {
	if (typeof version !== "string") return null;
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version.trim());
	if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
	try {
		return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
	} catch {
		return null;
	}
}

function compareStableVersions(left: string, right: string): number {
	const a = parseStableVersion(left);
	const b = parseStableVersion(right);
	if (a === null || b === null) return 0;
	for (let index = 0; index < 3; index += 1) {
		const av = a[index];
		const bv = b[index];
		if (av === undefined || bv === undefined) return 0;
		if (av > bv) return 1;
		if (av < bv) return -1;
	}
	return 0;
}

function markerPresent(env: NodeJS.ProcessEnv, key: string): boolean {
	return Object.hasOwn(env, key);
}

function elapsed(now: number, at: number | undefined): number | null {
	if (!Number.isFinite(now) || !Number.isFinite(at)) return null;
	return Math.max(0, now - (at as number));
}

export function resolveAutoUpdateStateRoot(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env["LITCODEX_AUTO_UPDATE_STATE_ROOT"]?.trim();
	if (configured) return configured;
	const dataRoot = env["LITCODEX_DATA_ROOT"]?.trim() || join(homedir(), ".litcodex");
	return join(dataRoot, "auto-update");
}

interface NpmEnvironmentSandbox {
	readonly env: NodeJS.ProcessEnv;
	readonly root: string;
}

function createNpmEnvironmentSandbox(env: NodeJS.ProcessEnv): NpmEnvironmentSandbox {
	const safe: NodeJS.ProcessEnv = {};
	for (const key of SAFE_ENV_KEYS) {
		const value = env[key];
		if (value !== undefined) safe[key] = value;
	}
	const root = mkdtempSync(join(tmpdir(), "litcodex-auto-update-npm-"));
	const npmrc = join(root, ".npmrc");
	const cache = join(root, "cache");
	mkdirSync(cache, { recursive: true, mode: 0o700 });
	writeFileSync(npmrc, "", { encoding: "utf8", mode: 0o600 });
	// Never inherit a user's registry, userconfig, cache, auth, proxy, or certificate settings. The
	// updater talks only to the official HTTPS registry through fresh empty npm state.
	safe["npm_config_registry"] = OFFICIAL_NPM_REGISTRY;
	safe["NPM_CONFIG_REGISTRY"] = OFFICIAL_NPM_REGISTRY;
	safe["npm_config_userconfig"] = npmrc;
	safe["NPM_CONFIG_USERCONFIG"] = npmrc;
	safe["npm_config_cache"] = cache;
	safe["NPM_CONFIG_CACHE"] = cache;
	// These markers are deliberately added after filtering so npm lifecycle children cannot recurse
	// into this updater or emit a second cache-only notice.
	safe["LITCODEX_AUTO_UPDATE_IN_PROGRESS"] = "1";
	safe["LITCODEX_NO_AUTO_UPDATE"] = "1";
	safe["NO_UPDATE_NOTIFIER"] = "1";
	safe["LITCODEX_NO_UPDATE_CHECK"] = "1";
	return { env: safe, root };
}

function withSanitizedNpmEnvironment<T>(env: NodeJS.ProcessEnv, operation: (safe: NodeJS.ProcessEnv) => T): T {
	const sandbox = createNpmEnvironmentSandbox(env);
	try {
		return operation(sandbox.env);
	} finally {
		rmSync(sandbox.root, { recursive: true, force: true });
	}
}

function withCodexHost(safe: NodeJS.ProcessEnv, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const host: NodeJS.ProcessEnv = { ...safe };
	for (const key of CODEX_HOST_ENV_KEYS) {
		const value = env[key];
		if (value !== undefined) host[key] = value;
	}
	return host;
}

function installIntoCodex(
	command: string,
	options: Pick<AutoUpdateVerifyOptions, "cwd" | "env" | "spawn">,
	timeout: number,
): AutoUpdateSpawnResult {
	return options.spawn(command, ["exec", "--global", "--", "litcodex", "install", "--no-auto-update"], {
		cwd: options.cwd,
		env: options.env,
		timeout,
		stdio: "ignore",
	});
}

export function sanitizeNpmEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	// This public inspection helper intentionally returns the generated paths so callers/tests can
	// prove that user npm state was not reused. Runtime subprocesses use withSanitizedNpmEnvironment,
	// which removes the temporary files after each synchronous npm call.
	return createNpmEnvironmentSandbox(env).env;
}

export function resolveAutoUpdatePlan(options: AutoUpdatePlanOptions): AutoUpdatePlan {
	const env = options.env ?? process.env;
	const now = options.now ?? Date.now();
	const argv = options.argv ?? [];
	const source = options.source;
	if (markerPresent(env, "NO_UPDATE_NOTIFIER") || markerPresent(env, "LITCODEX_NO_UPDATE_CHECK")) {
		return { shouldRun: false, reason: "existing-opt-out", source };
	}
	if (markerPresent(env, "LITCODEX_NO_AUTO_UPDATE") || argv.includes("--no-auto-update")) {
		return { shouldRun: false, reason: "disabled", source };
	}
	if (markerPresent(env, "LITCODEX_AUTO_UPDATE_IN_PROGRESS")) {
		return { shouldRun: false, reason: "recursion-guard", source };
	}
	if (markerPresent(env, "CI")) return { shouldRun: false, reason: "ci", source };
	if (options.eligible === false) return { shouldRun: false, reason: "ineligible", source };
	if (options.installFlow === "marketplace") return { shouldRun: false, reason: "marketplace-flow", source };
	const successInterval = positiveInteger(env["LITCODEX_AUTO_UPDATE_INTERVAL_MS"], DEFAULT_AUTO_UPDATE_INTERVAL_MS);
	const sinceLastCheck = elapsed(now, options.lastCheckedAt);
	if (options.lastStatus !== "failed" && sinceLastCheck !== null && sinceLastCheck < successInterval) {
		return { shouldRun: false, reason: "throttled", source };
	}
	const retryInterval = positiveInteger(
		env["LITCODEX_AUTO_UPDATE_RETRY_INTERVAL_MS"],
		DEFAULT_AUTO_UPDATE_RETRY_INTERVAL_MS,
	);
	const sinceLastAttempt = elapsed(now, options.lastAttemptedAt);
	if (options.lastStatus === "failed" && sinceLastAttempt !== null && sinceLastAttempt < retryInterval) {
		return { shouldRun: false, reason: "retry-throttled", source };
	}
	const currentVersion = options.currentVersion ?? env["LITCODEX_CURRENT_VERSION"];
	const latestVersion = options.latestVersion ?? env["LITCODEX_LATEST_VERSION"];
	if (parseStableVersion(currentVersion) === null) return { shouldRun: false, reason: "unknown-current", source };
	if (parseStableVersion(latestVersion) === null) return { shouldRun: false, reason: "unknown-latest", source };
	if (compareStableVersions(latestVersion as string, currentVersion as string) <= 0) {
		return { shouldRun: false, reason: "up-to-date", source, currentVersion, latestVersion };
	}
	const npm = resolveNpmInvocation(
		["install", "--global", "--no-fund", "--no-audit", `${AUTO_UPDATE_PACKAGE}@${latestVersion}`],
		{
			npmExecPath: env["npm_execpath"],
		},
	);
	return {
		shouldRun: true,
		source,
		currentVersion,
		latestVersion,
		command: npm.command,
		args: npm.args,
	};
}

function positiveInteger(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}

function defaultSpawn(
	command: string,
	args: readonly string[],
	options: AutoUpdateSpawnOptions,
): AutoUpdateSpawnResult {
	let invocation: ShellSafeInvocation;
	try {
		invocation = shellSafeInvocation(command, args);
	} catch (error) {
		return { status: null, error: error as Error };
	}
	const result = spawnSync(invocation.command, [...invocation.args], {
		shell: invocation.shell,
		cwd: options.cwd,
		env: options.env,
		timeout: options.timeout,
		killSignal: "SIGTERM",
		stdio: options.stdio,
		encoding: "utf8",
	});
	return {
		status: result.status,
		signal: result.signal,
		...(result.error === undefined ? {} : { error: result.error }),
		...(result.stdout === undefined ? {} : { stdout: result.stdout }),
		...(result.stderr === undefined ? {} : { stderr: result.stderr }),
	};
}

function outputText(value: string | Buffer | undefined): string {
	if (value === undefined) return "";
	return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

function spawnSucceeded(result: AutoUpdateSpawnResult): boolean {
	return result.status === 0 && result.error === undefined && (result.signal === undefined || result.signal === null);
}

function readState(path: string): AutoUpdateState {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const record = parsed as Record<string, unknown>;
		return {
			...(typeof record["lastCheckedAt"] === "number" ? { lastCheckedAt: record["lastCheckedAt"] } : {}),
			...(typeof record["lastAttemptedAt"] === "number" ? { lastAttemptedAt: record["lastAttemptedAt"] } : {}),
			...(record["lastStatus"] === "success" ||
			record["lastStatus"] === "failed" ||
			record["lastStatus"] === "started"
				? { lastStatus: record["lastStatus"] }
				: {}),
		};
	} catch {
		return {};
	}
}

function atomicJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.tmp.${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
}

function acquireLock(path: string, now: number, staleMs: number): string | null {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const token = `${process.pid}:${now}:${randomUUID()}`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const fd = openSync(path, "wx", 0o600);
			writeFileSync(fd, `${token}\n`, "utf8");
			closeSync(fd);
			return token;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
			try {
				if (now - statSync(path).mtimeMs < staleMs) return null;
				rmSync(path, { force: true });
			} catch {
				return null;
			}
		}
	}
	return null;
}

function releaseLock(path: string, token: string): void {
	try {
		if (readFileSync(path, "utf8").trim() === token) rmSync(path, { force: true });
	} catch {
		// The lock was already removed or replaced by a newer owner; never delete blindly.
	}
}

function iso(now: number): string {
	return new Date(now).toISOString();
}

function noRunResult(plan: AutoUpdatePlan, stateRoot: string, startedAt: string): AutoUpdateResult {
	const journalPath = join(stateRoot, "journal.json");
	const receiptPath = join(stateRoot, "receipt.json");
	const finishedAt = startedAt;
	const receipt: AutoUpdateResult = {
		schemaVersion: AUTO_UPDATE_SCHEMA_VERSION,
		packageName: AUTO_UPDATE_PACKAGE,
		status:
			plan.reason === "up-to-date"
				? "up-to-date"
				: plan.reason === "throttled" || plan.reason === "retry-throttled"
					? "throttled"
					: plan.reason === "locked"
						? "locked"
						: "skipped",
		reason: plan.reason,
		source: plan.source,
		...(plan.currentVersion === undefined ? {} : { currentVersion: plan.currentVersion }),
		...(plan.latestVersion === undefined ? {} : { latestVersion: plan.latestVersion }),
		rollbackAttempted: false,
		startedAt,
		finishedAt,
		journalPath,
		receiptPath,
	};
	return receipt;
}

function latestFromRegistry(
	env: NodeJS.ProcessEnv,
	spawn: AutoUpdateSpawn,
	cwd: string,
	timeout: number,
): string | undefined {
	const npm = resolveNpmInvocation(["view", AUTO_UPDATE_PACKAGE, "version", "--json"], {
		npmExecPath: env["npm_execpath"],
	});
	const result = withSanitizedNpmEnvironment(env, (safeEnv) =>
		spawn(npm.command, npm.args, {
			cwd,
			env: safeEnv,
			timeout,
			stdio: ["ignore", "pipe", "pipe"],
		}),
	);
	if (!spawnSucceeded(result)) return undefined;
	const raw = outputText(result.stdout).trim();
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "string" && parseStableVersion(parsed) !== null) return parsed;
	} catch {
		if (parseStableVersion(raw) !== null) return raw;
	}
	return undefined;
}

/**
 * Prove that npm's global executable resolves to the exact version that the install command targeted.
 * npm can return exit 0 for a no-op, warning, or partially successful lifecycle, so the install result
 * is never treated as committed until this independent version probe agrees. Only that exact package
 * then installs itself into Codex (managed marketplace and plugin cache); its doctor runs last, because
 * the doctor fails while Codex still holds the previous plugin version.
 */
export function verifyInstalledVersion(
	expectedVersion: string,
	options: AutoUpdateVerifyOptions,
): AutoUpdateVerification {
	const versionArgs = ["exec", "--global", "--", "litcodex", "--version"] as const;
	const result = options.spawn(options.command, versionArgs, {
		cwd: options.cwd,
		env: options.env,
		timeout: options.timeout,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!spawnSucceeded(result)) {
		return {
			status: "unavailable",
			expectedVersion,
			doctorStatus: "not-run",
			detail: `global litcodex --version probe exited ${String(result.status)}`,
		};
	}
	const raw = outputText(result.stdout).trim();
	const observedVersion = raw
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.find((line) => parseStableVersion(line) !== null);
	if (observedVersion === undefined) {
		return {
			status: "unavailable",
			expectedVersion,
			doctorStatus: "not-run",
			detail: "global litcodex --version probe returned no stable version",
		};
	}
	if (observedVersion !== expectedVersion) {
		return {
			status: "mismatch",
			expectedVersion,
			observedVersion,
			doctorStatus: "not-run",
			detail: `global litcodex resolved ${observedVersion}; expected ${expectedVersion}`,
		};
	}
	const codexInstall = installIntoCodex(
		options.command,
		options,
		positiveTimeout(options.installTimeout, DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS),
	);
	if (!spawnSucceeded(codexInstall)) {
		return {
			status: "unavailable",
			expectedVersion,
			observedVersion,
			doctorStatus: "not-run",
			codexInstallAttempted: true,
			detail: `target litcodex install exited ${String(codexInstall.status)}`,
		};
	}
	const doctorArgs = ["exec", "--global", "--", "litcodex", "doctor", "--json", "--no-auto-update"] as const;
	const doctorResult = options.spawn(options.command, doctorArgs, {
		cwd: options.cwd,
		env: options.env,
		timeout: options.timeout,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!spawnSucceeded(doctorResult)) {
		return {
			status: "unavailable",
			expectedVersion,
			observedVersion,
			doctorStatus: "failed",
			doctorDetail: `target litcodex doctor --json exited ${String(doctorResult.status)}`,
			codexInstallAttempted: true,
			detail: `global litcodex resolved exact ${expectedVersion}, but target doctor did not pass`,
		};
	}
	const doctorLine = outputText(doctorResult.stdout).trim().split(/\r?\n/u).at(-1);
	let doctorHealthy = false;
	try {
		const parsed: unknown = doctorLine === undefined ? undefined : JSON.parse(doctorLine);
		doctorHealthy =
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed) &&
			(parsed as Record<string, unknown>)["ok"] === true;
	} catch {
		doctorHealthy = false;
	}
	if (!doctorHealthy) {
		return {
			status: "unavailable",
			expectedVersion,
			observedVersion,
			doctorStatus: "failed",
			doctorDetail: "target litcodex doctor --json reported unhealthy or malformed output",
			codexInstallAttempted: true,
			detail: `global litcodex resolved exact ${expectedVersion}, but target doctor did not pass`,
		};
	}
	return {
		status: "verified",
		expectedVersion,
		observedVersion,
		doctorStatus: "passed",
		doctorDetail: "target litcodex doctor --json passed",
		codexInstallAttempted: true,
		detail: `global litcodex resolved exact ${expectedVersion}; installed into Codex; target doctor passed`,
	};
}

export function runForegroundAutoUpdate(options: AutoUpdateRunOptions): AutoUpdateResult {
	const env = options.env ?? process.env;
	const clock = options.clock ?? Date.now;
	const now = options.now ?? clock();
	const stateRoot = options.stateRoot ?? resolveAutoUpdateStateRoot(env);
	const statePath = join(stateRoot, "state.json");
	const journalPath = join(stateRoot, "journal.json");
	const receiptPath = join(stateRoot, "receipt.json");
	const startedAt = iso(now);
	const spawn = options.spawn ?? defaultSpawn;
	const cwd = options.cwd ?? process.cwd();
	const timeout = positiveTimeout(
		options.timeoutMs,
		positiveInteger(env["LITCODEX_AUTO_UPDATE_TIMEOUT_MS"], DEFAULT_AUTO_UPDATE_TIMEOUT_MS),
	);
	const installTimeout = positiveTimeout(
		options.installTimeoutMs,
		positiveInteger(env["LITCODEX_AUTO_UPDATE_INSTALL_TIMEOUT_MS"], DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS),
	);
	const state = readState(statePath);
	const planOptions = {
		...options,
		env,
		now,
		lastCheckedAt: state.lastCheckedAt,
		lastAttemptedAt: state.lastAttemptedAt,
		lastStatus: state.lastStatus,
	};
	// Every opt-out and throttle is decided before the registry is asked, so a throttled session never
	// spends a network round trip. The registry is consulted only when nothing else stopped the run.
	let plan = resolveAutoUpdatePlan(planOptions);
	if (plan.reason === "unknown-latest" && (options.latestVersion ?? env["LITCODEX_LATEST_VERSION"]) === undefined) {
		plan = resolveAutoUpdatePlan({ ...planOptions, latestVersion: latestFromRegistry(env, spawn, cwd, timeout) });
	}
	if (!plan.shouldRun) {
		const result = noRunResult(plan, stateRoot, startedAt);
		const previous = readAutoUpdateReceipt(stateRoot);
		const earlierFailure = unresolvedFailure(previous, plan);
		// A throttled session start says nothing new, so the update stays the visible receipt for the doctor.
		const keepsUpdate = previous?.status === "updated" && plan.reason === "throttled";
		if (options.writeReceipt !== false) {
			atomicJson(journalPath, { phase: "skipped", ...result });
			if (!earlierFailure && !keepsUpdate) atomicJson(receiptPath, result);
		}
		if (plan.reason === "up-to-date") {
			atomicJson(statePath, { ...state, lastCheckedAt: now, ...(earlierFailure ? {} : { lastStatus: "success" }) });
		}
		return result;
	}

	const lockPath = join(stateRoot, "lock");
	const lockToken = acquireLock(
		lockPath,
		now,
		Math.max(
			positiveInteger(env["LITCODEX_AUTO_UPDATE_LOCK_STALE_MS"], DEFAULT_AUTO_UPDATE_LOCK_STALE_MS),
			autoUpdateWorstCaseMs(timeout, installTimeout) + 30_000,
		),
	);
	if (lockToken === null) {
		const result = noRunResult({ ...plan, shouldRun: false, reason: "locked" }, stateRoot, startedAt);
		if (options.writeReceipt !== false) atomicJson(receiptPath, result);
		return result;
	}

	let rollbackAttempted = false;
	let rollbackStatus: number | null | undefined;
	let rollbackSucceeded = false;
	let rollbackError: Error | undefined;
	let rollbackSignal: NodeJS.Signals | null | undefined;
	let keptPluginRoot: string | null = null;
	try {
		const journal = {
			schemaVersion: AUTO_UPDATE_SCHEMA_VERSION,
			phase: "prepared",
			packageName: AUTO_UPDATE_PACKAGE,
			source: plan.source,
			currentVersion: plan.currentVersion,
			latestVersion: plan.latestVersion,
			startedAt,
			lockToken,
			command: plan.command,
			args: plan.args,
		};
		atomicJson(journalPath, journal);
		atomicJson(statePath, { ...state, lastAttemptedAt: now, lastStatus: "started" });
		const command = plan.command as string;
		const args = plan.args as readonly string[];
		const result = withSanitizedNpmEnvironment(env, (safeEnv) =>
			spawn(command, args, {
				cwd,
				env: safeEnv,
				timeout: installTimeout,
				stdio: "ignore",
			}),
		);
		let verification: AutoUpdateVerification = {
			status: "not-run",
			expectedVersion: plan.latestVersion as string,
			doctorStatus: "not-run",
			detail: `npm install exited ${String(result.status)}`,
		};
		if (spawnSucceeded(result)) {
			atomicJson(journalPath, { ...journal, phase: "verifying" });
			keptPluginRoot = copyRunningPluginRoot(options.keepPluginRoot, stateRoot);
			try {
				verification = withSanitizedNpmEnvironment(env, (safeEnv) =>
					(options.verifyInstalled ?? verifyInstalledVersion)(plan.latestVersion as string, {
						command,
						cwd,
						env: withCodexHost(safeEnv, env),
						timeout,
						installTimeout,
						spawn,
					}),
				);
			} catch (error) {
				verification = {
					status: "unavailable",
					expectedVersion: plan.latestVersion as string,
					doctorStatus: "unavailable",
					doctorDetail: error instanceof Error ? `version probe failed: ${error.message}` : "version probe failed",
					detail: error instanceof Error ? `version probe failed: ${error.message}` : "version probe failed",
				};
			}
		}
		if (spawnSucceeded(result) && verification.status === "verified") {
			const receipt: AutoUpdateResult = {
				schemaVersion: AUTO_UPDATE_SCHEMA_VERSION,
				packageName: AUTO_UPDATE_PACKAGE,
				status: "updated",
				source: plan.source,
				currentVersion: plan.currentVersion,
				latestVersion: plan.latestVersion,
				rollbackAttempted: false,
				verificationStatus: verification.status,
				...(verification.observedVersion === undefined ? {} : { verifiedVersion: verification.observedVersion }),
				verificationDetail: verification.detail,
				doctorStatus: verification.doctorStatus,
				...(verification.doctorDetail === undefined ? {} : { doctorDetail: verification.doctorDetail }),
				startedAt,
				finishedAt: iso(Math.max(now, clock())),
				journalPath,
				receiptPath,
			};
			atomicJson(journalPath, {
				...journal,
				phase: "committed",
				finishedAt: receipt.finishedAt,
				verificationStatus: verification.status,
				...(verification.observedVersion === undefined ? {} : { verifiedVersion: verification.observedVersion }),
				verificationDetail: verification.detail,
				doctorStatus: verification.doctorStatus,
				...(verification.doctorDetail === undefined ? {} : { doctorDetail: verification.doctorDetail }),
			});
			atomicJson(statePath, { lastCheckedAt: now, lastAttemptedAt: now, lastStatus: "success" });
			if (options.writeReceipt !== false) atomicJson(receiptPath, receipt);
			return receipt;
		}

		if (spawnSucceeded(result)) {
			atomicJson(journalPath, {
				...journal,
				phase: "verification-failed",
				verificationStatus: verification.status,
				...(verification.observedVersion === undefined ? {} : { verifiedVersion: verification.observedVersion }),
				verificationDetail: verification.detail,
				doctorStatus: verification.doctorStatus,
				...(verification.doctorDetail === undefined ? {} : { doctorDetail: verification.doctorDetail }),
			});
		}
		rollbackAttempted = plan.currentVersion !== undefined && parseStableVersion(plan.currentVersion) !== null;
		if (rollbackAttempted) {
			try {
				const rollback = withSanitizedNpmEnvironment(env, (safeEnv) =>
					spawn(
						command,
						["install", "--global", "--no-fund", "--no-audit", `${AUTO_UPDATE_PACKAGE}@${plan.currentVersion}`],
						{
							cwd,
							env: safeEnv,
							timeout: installTimeout,
							stdio: "ignore",
						},
					),
				);
				rollbackStatus = rollback.status;
				rollbackSignal = rollback.signal;
				rollbackError = rollback.error;
				rollbackSucceeded = spawnSucceeded(rollback);
				if (rollbackSucceeded && verification.codexInstallAttempted === true) {
					// The target already wrote its plugin into Codex, so the restored package reinstalls its own.
					const restore = withSanitizedNpmEnvironment(env, (safeEnv) =>
						installIntoCodex(command, { cwd, env: withCodexHost(safeEnv, env), spawn }, installTimeout),
					);
					rollbackStatus = restore.status;
					rollbackSignal = restore.signal;
					rollbackError =
						restore.error ??
						(spawnSucceeded(restore)
							? undefined
							: new Error(`restoring the ${plan.currentVersion} Codex plugin exited ${String(restore.status)}`));
					rollbackSucceeded = spawnSucceeded(restore);
				}
			} catch (error) {
				rollbackError = error instanceof Error ? error : new Error("rollback probe failed");
			}
		}
		const finishedAt = iso(Math.max(now, clock()));
		const rollbackFailed = rollbackAttempted && !rollbackSucceeded;
		const receipt: AutoUpdateResult = {
			schemaVersion: AUTO_UPDATE_SCHEMA_VERSION,
			packageName: AUTO_UPDATE_PACKAGE,
			status: rollbackFailed ? "unknown-state" : "failed",
			reason: rollbackFailed
				? `rollback-failed:${rollbackError?.message ?? (rollbackSignal ? `terminated:${rollbackSignal}` : String(rollbackStatus))}`
				: spawnSucceeded(result)
					? `post-install-verification:${verification.status}:${verification.detail}`
					: (result.error?.message ??
						(result.signal ? `terminated:${result.signal}` : `exit:${String(result.status)}`)),
			source: plan.source,
			currentVersion: plan.currentVersion,
			latestVersion: plan.latestVersion,
			rollbackAttempted,
			...(rollbackStatus === undefined ? {} : { rollbackStatus }),
			verificationStatus: verification.status,
			...(verification.observedVersion === undefined ? {} : { verifiedVersion: verification.observedVersion }),
			verificationDetail: verification.detail,
			doctorStatus: verification.doctorStatus,
			...(verification.doctorDetail === undefined ? {} : { doctorDetail: verification.doctorDetail }),
			startedAt,
			finishedAt,
			journalPath,
			receiptPath,
		};
		atomicJson(journalPath, {
			...journal,
			phase: rollbackSucceeded ? "rolled-back" : "rollback-failed",
			finishedAt,
			rollbackStatus,
			verificationStatus: verification.status,
			...(verification.observedVersion === undefined ? {} : { verifiedVersion: verification.observedVersion }),
			verificationDetail: verification.detail,
			doctorStatus: verification.doctorStatus,
			...(verification.doctorDetail === undefined ? {} : { doctorDetail: verification.doctorDetail }),
		});
		atomicJson(statePath, { lastAttemptedAt: now, lastStatus: "failed" });
		if (options.writeReceipt !== false) atomicJson(receiptPath, receipt);
		return receipt;
	} finally {
		if (keptPluginRoot !== null && options.keepPluginRoot !== undefined) {
			restoreRunningPluginRoot(keptPluginRoot, options.keepPluginRoot);
		}
		releaseLock(lockPath, lockToken);
	}
}

/**
 * Copy the running session's plugin folder aside before the Codex install replaces the plugin cache. Only a
 * versioned cache folder qualifies; a checkout or the npm package copy is never touched. Best effort: a failed
 * copy only means the running session loses its hooks, as it did before.
 */
function copyRunningPluginRoot(root: string | undefined, stateRoot: string): string | null {
	if (root === undefined || parseStableVersion(basename(root)) === null || !existsSync(root)) return null;
	const kept = join(stateRoot, "kept-plugin", basename(root));
	try {
		rmSync(kept, { recursive: true, force: true });
		cpSync(root, kept, { recursive: true, verbatimSymlinks: true });
		return kept;
	} catch {
		rmSync(kept, { recursive: true, force: true });
		return null;
	}
}

/** Put the copy back only if Codex removed the folder; a rollback that reinstalled it wins. */
function restoreRunningPluginRoot(kept: string, root: string): void {
	try {
		if (!existsSync(root)) {
			mkdirSync(dirname(root), { recursive: true });
			try {
				renameSync(kept, root);
			} catch {
				cpSync(kept, root, { recursive: true, verbatimSymlinks: true });
			}
		}
	} catch {
		// The session then runs without its old folder, which is the pre-existing behaviour.
	} finally {
		rmSync(dirname(kept), { recursive: true, force: true });
	}
}

/** The longest one transaction can run: three probes plus four install steps (two forward, two back). */
export function autoUpdateWorstCaseMs(
	timeout = DEFAULT_AUTO_UPDATE_TIMEOUT_MS,
	installTimeout = DEFAULT_AUTO_UPDATE_INSTALL_TIMEOUT_MS,
): number {
	return timeout * 3 + installTimeout * 4;
}

/**
 * A failed or unknown-state receipt stays the visible receipt until an update attempt replaces it, or
 * until an up-to-date check proves the failed target is installed, which makes that failure history.
 */
function unresolvedFailure(previous: AutoUpdateReceipt | null, plan: AutoUpdatePlan): boolean {
	if (previous?.status !== "failed" && previous?.status !== "unknown-state") return false;
	if (plan.reason !== "up-to-date" || previous.latestVersion === undefined || plan.currentVersion === undefined) {
		return true;
	}
	return compareStableVersions(plan.currentVersion, previous.latestVersion) < 0;
}

export function readAutoUpdateReceipt(stateRoot = resolveAutoUpdateStateRoot()): AutoUpdateReceipt | null {
	const path = join(stateRoot, "receipt.json");
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		const receipt = parsed as Partial<AutoUpdateReceipt>;
		if (receipt.schemaVersion !== AUTO_UPDATE_SCHEMA_VERSION || receipt.packageName !== AUTO_UPDATE_PACKAGE)
			return null;
		if (typeof receipt.status !== "string" || typeof receipt.source !== "string") return null;
		return parsed as AutoUpdateReceipt;
	} catch {
		return null;
	}
}
