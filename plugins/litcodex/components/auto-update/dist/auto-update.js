import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
export const AUTO_UPDATE_PACKAGE = "@litfamily/litcodex";
export const DEFAULT_AUTO_UPDATE_TIMEOUT_MS = 10_000;
export const DEFAULT_AUTO_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AUTO_UPDATE_RETRY_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_AUTO_UPDATE_LOCK_STALE_MS = 10 * 60 * 1000;
export const AUTO_UPDATE_SCHEMA_VERSION = 1;
export const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org/";
export function resolveNpmCommand(platform = process.platform) {
    return platform === "win32" ? "npm.cmd" : "npm";
}
export function resolveNpmInvocation(args, options = {}) {
    const platform = options.platform ?? process.platform;
    const npmExecPath = Object.hasOwn(options, "npmExecPath") ? options.npmExecPath : process.env["npm_execpath"];
    const nodePath = options.nodePath ?? process.execPath;
    const exactNpm = npmExecPath?.trim();
    if (exactNpm)
        return { command: nodePath, args: [exactNpm, ...args] };
    return { command: resolveNpmCommand(platform), args: [...args] };
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
];
function parseStableVersion(version) {
    if (typeof version !== "string")
        return null;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version.trim());
    if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined)
        return null;
    try {
        return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
    }
    catch {
        return null;
    }
}
function compareStableVersions(left, right) {
    const a = parseStableVersion(left);
    const b = parseStableVersion(right);
    if (a === null || b === null)
        return 0;
    for (let index = 0; index < 3; index += 1) {
        const av = a[index];
        const bv = b[index];
        if (av === undefined || bv === undefined)
            return 0;
        if (av > bv)
            return 1;
        if (av < bv)
            return -1;
    }
    return 0;
}
function markerPresent(env, key) {
    return Object.hasOwn(env, key);
}
function elapsed(now, at) {
    if (!Number.isFinite(now) || !Number.isFinite(at))
        return null;
    return Math.max(0, now - at);
}
export function resolveAutoUpdateStateRoot(env = process.env) {
    const configured = env["LITCODEX_AUTO_UPDATE_STATE_ROOT"]?.trim();
    if (configured)
        return configured;
    const dataRoot = env["LITCODEX_DATA_ROOT"]?.trim() || join(homedir(), ".litcodex");
    return join(dataRoot, "auto-update");
}
function createNpmEnvironmentSandbox(env) {
    const safe = {};
    for (const key of SAFE_ENV_KEYS) {
        const value = env[key];
        if (value !== undefined)
            safe[key] = value;
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
function withSanitizedNpmEnvironment(env, operation) {
    const sandbox = createNpmEnvironmentSandbox(env);
    try {
        return operation(sandbox.env);
    }
    finally {
        rmSync(sandbox.root, { recursive: true, force: true });
    }
}
export function sanitizeNpmEnvironment(env = process.env) {
    // This public inspection helper intentionally returns the generated paths so callers/tests can
    // prove that user npm state was not reused. Runtime subprocesses use withSanitizedNpmEnvironment,
    // which removes the temporary files after each synchronous npm call.
    return createNpmEnvironmentSandbox(env).env;
}
export function resolveAutoUpdatePlan(options) {
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
    if (markerPresent(env, "CI"))
        return { shouldRun: false, reason: "ci", source };
    if (options.eligible === false)
        return { shouldRun: false, reason: "ineligible", source };
    if (options.installFlow === "marketplace")
        return { shouldRun: false, reason: "marketplace-flow", source };
    const successInterval = positiveInteger(env["LITCODEX_AUTO_UPDATE_INTERVAL_MS"], DEFAULT_AUTO_UPDATE_INTERVAL_MS);
    const sinceLastCheck = elapsed(now, options.lastCheckedAt);
    if (options.lastStatus !== "failed" && sinceLastCheck !== null && sinceLastCheck < successInterval) {
        return { shouldRun: false, reason: "throttled", source };
    }
    const retryInterval = positiveInteger(env["LITCODEX_AUTO_UPDATE_RETRY_INTERVAL_MS"], DEFAULT_AUTO_UPDATE_RETRY_INTERVAL_MS);
    const sinceLastAttempt = elapsed(now, options.lastAttemptedAt);
    if (options.lastStatus === "failed" && sinceLastAttempt !== null && sinceLastAttempt < retryInterval) {
        return { shouldRun: false, reason: "retry-throttled", source };
    }
    const currentVersion = options.currentVersion ?? env["LITCODEX_CURRENT_VERSION"];
    const latestVersion = options.latestVersion ?? env["LITCODEX_LATEST_VERSION"];
    if (parseStableVersion(currentVersion) === null)
        return { shouldRun: false, reason: "unknown-current", source };
    if (parseStableVersion(latestVersion) === null)
        return { shouldRun: false, reason: "unknown-latest", source };
    if (compareStableVersions(latestVersion, currentVersion) <= 0) {
        return { shouldRun: false, reason: "up-to-date", source, currentVersion, latestVersion };
    }
    const npm = resolveNpmInvocation(["install", "--global", "--no-fund", "--no-audit", `${AUTO_UPDATE_PACKAGE}@${latestVersion}`], {
        npmExecPath: env["npm_execpath"],
    });
    return {
        shouldRun: true,
        source,
        currentVersion,
        latestVersion,
        command: npm.command,
        args: npm.args,
    };
}
function positiveInteger(value, fallback) {
    if (value === undefined || value.trim() === "")
        return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
function positiveTimeout(value, fallback) {
    return value !== undefined && Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}
function defaultSpawn(command, args, options) {
    const result = spawnSync(command, [...args], {
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
function outputText(value) {
    if (value === undefined)
        return "";
    return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
function spawnSucceeded(result) {
    return result.status === 0 && result.error === undefined && (result.signal === undefined || result.signal === null);
}
function readState(path) {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            return {};
        const record = parsed;
        return {
            ...(typeof record["lastCheckedAt"] === "number" ? { lastCheckedAt: record["lastCheckedAt"] } : {}),
            ...(typeof record["lastAttemptedAt"] === "number" ? { lastAttemptedAt: record["lastAttemptedAt"] } : {}),
            ...(record["lastStatus"] === "success" ||
                record["lastStatus"] === "failed" ||
                record["lastStatus"] === "started"
                ? { lastStatus: record["lastStatus"] }
                : {}),
        };
    }
    catch {
        return {};
    }
}
function atomicJson(path, value) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.tmp.${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
}
function acquireLock(path, now, staleMs) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const token = `${process.pid}:${now}:${randomUUID()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const fd = openSync(path, "wx", 0o600);
            writeFileSync(fd, `${token}\n`, "utf8");
            closeSync(fd);
            return token;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                return null;
            try {
                if (now - statSync(path).mtimeMs < staleMs)
                    return null;
                rmSync(path, { force: true });
            }
            catch {
                return null;
            }
        }
    }
    return null;
}
function releaseLock(path, token) {
    try {
        if (readFileSync(path, "utf8").trim() === token)
            rmSync(path, { force: true });
    }
    catch {
        // The lock was already removed or replaced by a newer owner; never delete blindly.
    }
}
function iso(now) {
    return new Date(now).toISOString();
}
function noRunResult(plan, stateRoot, startedAt) {
    const journalPath = join(stateRoot, "journal.json");
    const receiptPath = join(stateRoot, "receipt.json");
    const finishedAt = startedAt;
    const receipt = {
        schemaVersion: AUTO_UPDATE_SCHEMA_VERSION,
        packageName: AUTO_UPDATE_PACKAGE,
        status: plan.reason === "up-to-date"
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
function latestFromRegistry(env, spawn, cwd, timeout) {
    const npm = resolveNpmInvocation(["view", AUTO_UPDATE_PACKAGE, "version", "--json"], {
        npmExecPath: env["npm_execpath"],
    });
    const result = withSanitizedNpmEnvironment(env, (safeEnv) => spawn(npm.command, npm.args, {
        cwd,
        env: safeEnv,
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
    }));
    if (!spawnSucceeded(result))
        return undefined;
    const raw = outputText(result.stdout).trim();
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string" && parseStableVersion(parsed) !== null)
            return parsed;
    }
    catch {
        if (parseStableVersion(raw) !== null)
            return raw;
    }
    return undefined;
}
/**
 * Prove that npm's global executable resolves to the exact version that the install command targeted.
 * npm can return exit 0 for a no-op, warning, or partially successful lifecycle, so the install result
 * is never treated as committed until this independent version probe agrees.
 */
export function verifyInstalledVersion(expectedVersion, options) {
    const versionArgs = ["exec", "--global", "--", "litcodex", "--version"];
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
    const doctorArgs = ["exec", "--global", "--", "litcodex", "doctor", "--json", "--no-auto-update"];
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
            detail: `global litcodex resolved exact ${expectedVersion}, but target doctor did not pass`,
        };
    }
    const doctorLine = outputText(doctorResult.stdout).trim().split(/\r?\n/u).at(-1);
    let doctorHealthy = false;
    try {
        const parsed = doctorLine === undefined ? undefined : JSON.parse(doctorLine);
        doctorHealthy =
            typeof parsed === "object" &&
                parsed !== null &&
                !Array.isArray(parsed) &&
                parsed["ok"] === true;
    }
    catch {
        doctorHealthy = false;
    }
    if (!doctorHealthy) {
        return {
            status: "unavailable",
            expectedVersion,
            observedVersion,
            doctorStatus: "failed",
            doctorDetail: "target litcodex doctor --json reported unhealthy or malformed output",
            detail: `global litcodex resolved exact ${expectedVersion}, but target doctor did not pass`,
        };
    }
    return {
        status: "verified",
        expectedVersion,
        observedVersion,
        doctorStatus: "passed",
        doctorDetail: "target litcodex doctor --json passed",
        detail: `global litcodex resolved exact ${expectedVersion}; target doctor passed`,
    };
}
export function runForegroundAutoUpdate(options) {
    const env = options.env ?? process.env;
    const now = options.now ?? Date.now();
    const stateRoot = options.stateRoot ?? resolveAutoUpdateStateRoot(env);
    const statePath = join(stateRoot, "state.json");
    const journalPath = join(stateRoot, "journal.json");
    const receiptPath = join(stateRoot, "receipt.json");
    const startedAt = iso(now);
    const spawn = options.spawn ?? defaultSpawn;
    const cwd = options.cwd ?? process.cwd();
    const timeout = positiveTimeout(options.timeoutMs, positiveInteger(env["LITCODEX_AUTO_UPDATE_TIMEOUT_MS"], DEFAULT_AUTO_UPDATE_TIMEOUT_MS));
    const state = readState(statePath);
    const latestVersion = options.latestVersion ?? env["LITCODEX_LATEST_VERSION"] ?? latestFromRegistry(env, spawn, cwd, timeout);
    const plan = resolveAutoUpdatePlan({
        ...options,
        env,
        now,
        latestVersion,
        lastCheckedAt: state.lastCheckedAt,
        lastAttemptedAt: state.lastAttemptedAt,
        lastStatus: state.lastStatus,
    });
    if (!plan.shouldRun) {
        const result = noRunResult(plan, stateRoot, startedAt);
        if (options.writeReceipt !== false) {
            atomicJson(journalPath, { phase: "skipped", ...result });
            atomicJson(receiptPath, result);
        }
        if (plan.reason === "up-to-date")
            atomicJson(statePath, { ...state, lastCheckedAt: now, lastStatus: "success" });
        return result;
    }
    const lockPath = join(stateRoot, "lock");
    const lockToken = acquireLock(lockPath, now, Math.max(positiveInteger(env["LITCODEX_AUTO_UPDATE_LOCK_STALE_MS"], DEFAULT_AUTO_UPDATE_LOCK_STALE_MS), timeout * 5 + 30_000));
    if (lockToken === null) {
        const result = noRunResult({ ...plan, shouldRun: false, reason: "locked" }, stateRoot, startedAt);
        if (options.writeReceipt !== false)
            atomicJson(receiptPath, result);
        return result;
    }
    let rollbackAttempted = false;
    let rollbackStatus;
    let rollbackSucceeded = false;
    let rollbackError;
    let rollbackSignal;
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
        const command = plan.command;
        const args = plan.args;
        const result = withSanitizedNpmEnvironment(env, (safeEnv) => spawn(command, args, {
            cwd,
            env: safeEnv,
            timeout,
            stdio: "ignore",
        }));
        let verification = {
            status: "not-run",
            expectedVersion: plan.latestVersion,
            doctorStatus: "not-run",
            detail: `npm install exited ${String(result.status)}`,
        };
        if (spawnSucceeded(result)) {
            atomicJson(journalPath, { ...journal, phase: "verifying" });
            try {
                verification = withSanitizedNpmEnvironment(env, (safeEnv) => (options.verifyInstalled ?? verifyInstalledVersion)(plan.latestVersion, {
                    command,
                    cwd,
                    env: safeEnv,
                    timeout,
                    spawn,
                }));
            }
            catch (error) {
                verification = {
                    status: "unavailable",
                    expectedVersion: plan.latestVersion,
                    doctorStatus: "unavailable",
                    doctorDetail: error instanceof Error ? `version probe failed: ${error.message}` : "version probe failed",
                    detail: error instanceof Error ? `version probe failed: ${error.message}` : "version probe failed",
                };
            }
        }
        if (spawnSucceeded(result) && verification.status === "verified") {
            const receipt = {
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
                finishedAt: iso(now),
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
            if (options.writeReceipt !== false)
                atomicJson(receiptPath, receipt);
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
                const rollback = withSanitizedNpmEnvironment(env, (safeEnv) => spawn(command, ["install", "--global", "--no-fund", "--no-audit", `${AUTO_UPDATE_PACKAGE}@${plan.currentVersion}`], {
                    cwd,
                    env: safeEnv,
                    timeout,
                    stdio: "ignore",
                }));
                rollbackStatus = rollback.status;
                rollbackSignal = rollback.signal;
                rollbackError = rollback.error;
                rollbackSucceeded = spawnSucceeded(rollback);
            }
            catch (error) {
                rollbackError = error instanceof Error ? error : new Error("rollback probe failed");
            }
        }
        const finishedAt = iso(now);
        const rollbackFailed = rollbackAttempted && !rollbackSucceeded;
        const receipt = {
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
        if (options.writeReceipt !== false)
            atomicJson(receiptPath, receipt);
        return receipt;
    }
    finally {
        releaseLock(lockPath, lockToken);
    }
}
export function readAutoUpdateReceipt(stateRoot = resolveAutoUpdateStateRoot()) {
    const path = join(stateRoot, "receipt.json");
    if (!existsSync(path))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            return null;
        const receipt = parsed;
        if (receipt.schemaVersion !== AUTO_UPDATE_SCHEMA_VERSION || receipt.packageName !== AUTO_UPDATE_PACKAGE)
            return null;
        if (typeof receipt.status !== "string" || typeof receipt.source !== "string")
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
