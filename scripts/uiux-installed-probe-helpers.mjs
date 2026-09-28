import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalJson, parseJson, sha256 } from "../plugins/litcodex/skills/visual-qa/scripts/strict-input.mjs";
import { uiuxDesignContract } from "../tools/uiux-design-contract.mjs";
import { run } from "./run-install-smoke.mjs";

export function assert(condition, message) {
	if (!condition) throw new Error(message);
}

export function timed(command, args, options) {
	const started = process.hrtime.bigint();
	const result = run(command, args, options);
	return { ...result, durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1_000) / 1000 };
}

function killProcessGroup(child, signal) {
	if (child.pid === undefined) return;
	try {
		if (process.platform === "win32") child.kill(signal);
		else process.kill(-child.pid, signal);
	} catch (error) {
		if (error?.code !== "ESRCH") throw error;
	}
}

export function timedAsync(command, args, options = {}) {
	const started = process.hrtime.bigint();
	const { input, maxOutputBytes = 4 * 1024 * 1024, signal, timeout = 0, ...spawnOptions } = options;
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let outputLimitExceeded = false;
		let timedOut = false;
		let aborted = signal?.aborted === true;
		let spawnError;
		let forceKillTimer;
		let timeoutTimer;
		const child = spawn(command, args, {
			...spawnOptions,
			detached: process.platform !== "win32",
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const terminate = () => {
			killProcessGroup(child, "SIGTERM");
			forceKillTimer = setTimeout(() => killProcessGroup(child, "SIGKILL"), 1_000);
			forceKillTimer.unref();
		};
		const onAbort = () => {
			aborted = true;
			terminate();
		};
		const capture = (kind, chunk) => {
			const text = chunk.toString("utf8");
			const bytes = Buffer.byteLength(text);
			if (kind === "stdout") stdoutBytes += bytes;
			else stderrBytes += bytes;
			const current = kind === "stdout" ? stdout : stderr;
			if (Buffer.byteLength(current) + bytes <= maxOutputBytes) {
				if (kind === "stdout") stdout += text;
				else stderr += text;
			} else if (!outputLimitExceeded) {
				outputLimitExceeded = true;
				terminate();
			}
		};
		child.stdout.on("data", (chunk) => capture("stdout", chunk));
		child.stderr.on("data", (chunk) => capture("stderr", chunk));
		child.on("error", (error) => {
			spawnError = error;
		});
		child.on("close", (exitCode, exitSignal) => {
			if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
			if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
			signal?.removeEventListener("abort", onAbort);
			resolve({
				exitCode: exitCode ?? -1,
				signal: exitSignal,
				stdout,
				stderr,
				stdoutBytes,
				stderrBytes,
				outputLimitExceeded,
				timedOut,
				aborted,
				spawnError,
				durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1_000) / 1000,
			});
		});
		if (input !== undefined) child.stdin.end(input);
		else child.stdin.end();
		if (signal?.aborted) onAbort();
		else signal?.addEventListener("abort", onAbort, { once: true });
		if (timeout > 0) {
			timeoutTimer = setTimeout(() => {
				timedOut = true;
				terminate();
			}, timeout);
			timeoutTimer.unref();
		}
	});
}

export class ProbeTerminalError extends Error {
	constructor(status, phase, message, details = {}) {
		super(message);
		this.name = "ProbeTerminalError";
		this.status = status;
		this.phase = phase;
		this.details = details;
	}
}

const LOCKED_CODEX_VERSION = "0.144.0";
const LOCKED_CODEX_PACKAGE = "@openai/codex";
const LOCKED_CODEX_BIN = "bin/codex.js";

function codexProvenanceError(message) {
	return new ProbeTerminalError("BLOCKED_HOST_UNAVAILABLE", "codex-provenance", message);
}

function readJsonObject(path, contractName) {
	let value;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw codexProvenanceError(`${contractName} is unavailable`);
	}
	if (value === null || Array.isArray(value) || typeof value !== "object") {
		throw codexProvenanceError(`${contractName} is malformed`);
	}
	return value;
}

function pathInside(parent, candidate) {
	const rel = relative(parent, candidate);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function captureRepositoryCodexIdentity({ repoRoot, codexBin }) {
	const normalizedRoot = resolve(repoRoot);
	const expectedPublicPath = resolve(normalizedRoot, "node_modules/.bin/codex");
	if (typeof codexBin !== "string" || !isAbsolute(codexBin) || resolve(codexBin) !== expectedPublicPath) {
		throw codexProvenanceError("CODEX_BIN does not match the repository Codex public path");
	}

	let canonicalRoot;
	let publicEntry;
	let publicRealpath;
	let packageRoot;
	try {
		canonicalRoot = realpathSync(normalizedRoot);
		publicEntry = lstatSync(expectedPublicPath, { bigint: true });
		publicRealpath = realpathSync(expectedPublicPath);
		packageRoot = realpathSync(join(normalizedRoot, "node_modules/@openai/codex"));
	} catch {
		throw codexProvenanceError("repository Codex public path is unavailable");
	}
	if (!publicEntry.isSymbolicLink()) {
		throw codexProvenanceError("repository Codex public path is not the lock-owned symlink");
	}
	if (!pathInside(canonicalRoot, packageRoot)) {
		throw codexProvenanceError("repository Codex package root escapes the repository");
	}

	const rootManifest = readJsonObject(join(normalizedRoot, "package.json"), "root package contract");
	const lock = readJsonObject(join(normalizedRoot, "package-lock.json"), "Codex lock contract");
	const packageManifest = readJsonObject(join(packageRoot, "package.json"), "Codex package contract");
	if (
		packageManifest.name !== LOCKED_CODEX_PACKAGE ||
		packageManifest.version !== LOCKED_CODEX_VERSION ||
		packageManifest.bin?.codex !== LOCKED_CODEX_BIN
	) {
		throw codexProvenanceError("Codex package contract is not the lock-owned version and bin");
	}
	if (
		rootManifest.devDependencies?.[LOCKED_CODEX_PACKAGE] !== LOCKED_CODEX_VERSION ||
		lock.packages?.[""]?.devDependencies?.[LOCKED_CODEX_PACKAGE] !== LOCKED_CODEX_VERSION ||
		lock.packages?.["node_modules/@openai/codex"]?.version !== LOCKED_CODEX_VERSION ||
		lock.packages?.["node_modules/@openai/codex"]?.bin?.codex !== LOCKED_CODEX_BIN
	) {
		throw codexProvenanceError("Codex lock contract is not pinned to the expected version and bin");
	}

	let packageBinRealpath;
	let packageBinStat;
	try {
		packageBinRealpath = realpathSync(join(packageRoot, LOCKED_CODEX_BIN));
		packageBinStat = statSync(packageBinRealpath);
		accessSync(packageBinRealpath, constants.X_OK);
	} catch {
		throw codexProvenanceError("lock-owned Codex package bin is not executable");
	}
	if (
		!packageBinStat.isFile() ||
		!pathInside(packageRoot, packageBinRealpath) ||
		publicRealpath !== packageBinRealpath
	) {
		throw codexProvenanceError("repository Codex public path does not resolve to the package bin target");
	}

	return Object.freeze({
		repoRoot: normalizedRoot,
		codexBin: expectedPublicPath,
		packageVersion: LOCKED_CODEX_VERSION,
		publicDev: publicEntry.dev,
		publicIno: publicEntry.ino,
		publicCtimeNs: publicEntry.ctimeNs.toString(),
		publicBirthtimeNs: publicEntry.birthtimeNs.toString(),
		realpath: publicRealpath,
		targetDev: packageBinStat.dev,
		targetIno: packageBinStat.ino,
		targetSha256: createHash("sha256").update(readFileSync(packageBinRealpath)).digest("hex"),
	});
}

export function assertRepositoryCodexIdentity(identity) {
	if (identity === null || typeof identity !== "object") {
		throw codexProvenanceError("repository Codex identity is unavailable");
	}
	const current = captureRepositoryCodexIdentity({ repoRoot: identity.repoRoot, codexBin: identity.codexBin });
	for (const field of [
		"publicDev",
		"publicIno",
		"publicCtimeNs",
		"publicBirthtimeNs",
		"realpath",
		"targetDev",
		"targetIno",
		"targetSha256",
	]) {
		if (current[field] !== identity[field]) {
			throw codexProvenanceError("repository Codex executable identity changed after preflight");
		}
	}
	return current;
}

export function verifyLockedCodex({
	codexBin,
	runCommand = timed,
	isExecutable = (path) => {
		try {
			accessSync(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	},
}) {
	if (typeof codexBin !== "string" || !isAbsolute(codexBin) || !isExecutable(codexBin)) {
		throw new ProbeTerminalError(
			"BLOCKED_HOST_UNAVAILABLE",
			"codex-preflight-before",
			"lock-owned Codex executable unavailable",
		);
	}
	const version = runCommand(codexBin, ["--version"], { timeout: 30_000 });
	if (version.timedOut || version.spawnError?.code === "ETIMEDOUT") {
		throw new ProbeTerminalError("FAIL_HOST_TIMEOUT", "codex-version", "locked Codex version check timed out");
	}
	if (version.spawnError?.code === "ENOENT" || version.spawnError?.code === "EACCES") {
		throw new ProbeTerminalError("BLOCKED_HOST_UNAVAILABLE", "codex-version", "lock-owned Codex disappeared");
	}
	if (version.exitCode !== 0 || version.stdout.trim() !== "codex-cli 0.144.0") {
		throw new ProbeTerminalError("FAIL_HOST_MALFORMED", "codex-version", "locked Codex version is not 0.144.0", {
			exitCode: version.exitCode,
			stdoutSha256: createHash("sha256").update(version.stdout).digest("hex"),
		});
	}
	if (!isExecutable(codexBin)) {
		throw new ProbeTerminalError(
			"BLOCKED_HOST_UNAVAILABLE",
			"codex-preflight-after",
			"lock-owned Codex executable disappeared after version preflight",
		);
	}
	return {
		status: "PASS",
		version: "0.144.0",
		exitCode: version.exitCode,
		stdoutBytes: Buffer.byteLength(version.stdout),
		stdoutSha256: createHash("sha256").update(version.stdout).digest("hex"),
		stderrEvidence: outputEvidence(version.stderr),
		durationMs: version.durationMs,
	};
}

export async function verifyLockedCodexAsync({
	codexBin,
	runCommand = timedAsync,
	isExecutable = (path) => {
		try {
			accessSync(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	},
	signal,
	env,
}) {
	if (typeof codexBin !== "string" || !isAbsolute(codexBin) || !isExecutable(codexBin)) {
		throw new ProbeTerminalError(
			"BLOCKED_HOST_UNAVAILABLE",
			"codex-preflight-before",
			"lock-owned Codex executable unavailable",
		);
	}
	const version = await runCommand(codexBin, ["--version"], { env, timeout: 30_000, signal });
	if (signal?.aborted || version.aborted) throw signal?.reason ?? new Error("probe interrupted");
	if (version.timedOut || version.spawnError?.code === "ETIMEDOUT") {
		throw new ProbeTerminalError("FAIL_HOST_TIMEOUT", "codex-version", "locked Codex version check timed out");
	}
	if (version.spawnError?.code === "ENOENT" || version.spawnError?.code === "EACCES") {
		throw new ProbeTerminalError("BLOCKED_HOST_UNAVAILABLE", "codex-version", "lock-owned Codex disappeared");
	}
	if (version.outputLimitExceeded || version.exitCode !== 0 || version.stdout.trim() !== "codex-cli 0.144.0") {
		throw new ProbeTerminalError("FAIL_HOST_MALFORMED", "codex-version", "locked Codex version is not 0.144.0", {
			exitCode: version.exitCode,
			stdout: version.stdout,
		});
	}
	if (!isExecutable(codexBin)) {
		throw new ProbeTerminalError(
			"BLOCKED_HOST_UNAVAILABLE",
			"codex-preflight-after",
			"lock-owned Codex executable disappeared after version preflight",
		);
	}
	return {
		status: "PASS",
		version: "0.144.0",
		exitCode: version.exitCode,
		stdoutBytes: Buffer.byteLength(version.stdout),
		stdoutSha256: createHash("sha256").update(version.stdout).digest("hex"),
		stderrEvidence: outputEvidence(version.stderr),
		durationMs: version.durationMs,
	};
}

function receiptIoWithDefaults(receiptIo = {}) {
	return { link, mkdir, rename, rm, writeFile, ...receiptIo };
}

async function atomicWriteJsonAsync(path, value, receiptIo) {
	const io = receiptIoWithDefaults(receiptIo);
	await io.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await io.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		await io.rename(temporary, path);
	} catch (error) {
		await io.rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}

async function atomicCreateJsonAsync(path, value, receiptIo) {
	const io = receiptIoWithDefaults(receiptIo);
	await io.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await io.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
		await io.link(temporary, path);
		await io.rm(temporary, { force: true });
	} catch (error) {
		await io.rm(temporary, { force: true }).catch(() => {});
		throw error;
	}
}

function archivedEvidencePath(evidencePath, runId) {
	if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(runId)) {
		throw new Error("installed probe runId is not safe for durable evidence");
	}
	return join(dirname(evidencePath), "task-uiux-installed-runs", `${runId}.json`);
}

export function outputEvidence(value, classifications = []) {
	const text = typeof value === "string" ? value : String(value ?? "");
	return {
		bytes: Buffer.byteLength(text),
		sha256: createHash("sha256").update(text).digest("hex"),
		...(classifications.length === 0 ? {} : { classifications: [...new Set(classifications)].sort() }),
	};
}

function redactSecrets(value) {
	return value
		.replace(
			/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/giu,
			"[REDACTED PRIVATE KEY]",
		)
		.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu, "$1[REDACTED]@")
		.replace(/((?:proxy-)?authorization\s*[:=]\s*)(?:bearer|basic)\s+[^\s,;]+/giu, "$1[REDACTED]")
		.replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu, "[REDACTED AUTHORIZATION]")
		.replace(
			/((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|passwd|passphrase|credential|set-cookie|cookie|session(?:[_-]?id)?|private[_-]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
			"$1[REDACTED]",
		)
		.replace(/\bnpm_[A-Za-z0-9]{20,}\b/gu, "[REDACTED NPM TOKEN]")
		.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, "[REDACTED GITHUB TOKEN]")
		.replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, "[REDACTED GITHUB TOKEN]")
		.replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED OPENAI TOKEN]")
		.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[REDACTED AWS KEY]")
		.replace(/\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{10,}\b/gu, "[REDACTED SLACK TOKEN]")
		.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED GOOGLE KEY]")
		.replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gu, "[REDACTED SERVICE TOKEN]")
		.replace(/\bglpat-[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED GITLAB TOKEN]")
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED JWT]")
		.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/giu, "[REDACTED PRIVATE KEY]")
		.replace(/-----END [A-Z0-9 ]*PRIVATE KEY-----/giu, "[REDACTED PRIVATE KEY]");
}

export function boundedErrorMessage(error, fallback) {
	const raw = error instanceof Error ? String(error.message) : typeof error === "string" ? error : fallback;
	const redacted = redactSecrets(raw)
		.replace(/[\u0000-\u001f\u007f]+/gu, " ")
		.trim();
	const message = redacted || fallback;
	return message.length <= 240 ? message : `${message.slice(0, 239)}…`;
}

const SAFE_TERMINAL_NUMBER_FIELDS = new Set([
	"attemptCount",
	"byteCount",
	"durationMs",
	"exitCode",
	"failureCount",
	"fileCount",
	"removedCount",
	"retryCount",
	"stderrBytes",
	"stdoutBytes",
	"successCount",
	"totalCount",
]);
const SAFE_TERMINAL_BOOLEAN_FIELDS = new Set(["aborted", "outputLimitExceeded", "removed", "timedOut", "unchanged"]);
const SAFE_CLASSIFICATIONS = new Set(["responses-websocket-401"]);
const SAFE_TERMINAL_STATUSES = new Set([
	"BLOCKED_HOST_UNAVAILABLE",
	"FAIL_HOST_COMMAND_MISSING",
	"FAIL_HOST_EXECUTION",
	"FAIL_HOST_MALFORMED",
	"FAIL_HOST_TIMEOUT",
]);
const SAFE_TERMINAL_PHASES = new Set([
	"arguments",
	"codex-bin",
	"codex-provenance",
	"codex-preflight-after",
	"codex-preflight-before",
	"codex-version",
	"doctor",
	"host-execution",
	"install",
	"installed-litcodex",
	"litcodex-install",
	"npm-install-global",
	"npm-pack",
]);
const SAFE_ERROR_NAMES = new Set([
	"AggregateError",
	"Error",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
]);
const SAFE_PROBE_STATUSES = new Set([
	"BLOCKED_HOST_AUTH_UNAVAILABLE",
	"BLOCKED_HOST_CONFIG_UNREADABLE",
	"BLOCKED_HOST_UNAVAILABLE",
	"FAIL_DOCTOR_MALFORMED",
	"FAIL_DOCTOR_UNHEALTHY",
	"FAIL_HOST_COMMAND_MISSING",
	"FAIL_HOST_EXECUTION",
	"FAIL_HOST_MALFORMED",
	"FAIL_HOST_TIMEOUT",
	"NOT_REQUESTED",
	"PASS",
]);

function safeFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeHash(value) {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

function safeOutputEvidence(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const bytes = safeFiniteNumber(value.bytes);
	const sha256 = safeHash(value.sha256);
	if (bytes === undefined || bytes < 0 || sha256 === undefined) return undefined;
	const safe = { bytes, sha256 };
	if (Array.isArray(value.classifications)) {
		const classifications = [
			...new Set(value.classifications.filter((item) => SAFE_CLASSIFICATIONS.has(item))),
		].sort();
		if (classifications.length > 0) safe.classifications = classifications;
	}
	return safe;
}

function safeIdentifier(value) {
	return typeof value === "string" && /^[a-z0-9][a-z0-9:-]{0,63}$/u.test(value) ? value : undefined;
}

function safeIdentifierList(value, maximum = 32) {
	if (!Array.isArray(value)) return [];
	return value
		.slice(0, maximum)
		.map((item) => safeIdentifier(item))
		.filter((item) => item !== undefined);
}

function safeCommandReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const name = safeIdentifier(value.name);
	if (name === undefined) return undefined;
	const safe = { name };
	for (const key of ["exitCode", "durationMs", "stdoutBytes", "stderrBytes", "scenarioCount", "semanticAssertions"]) {
		const number = safeFiniteNumber(value[key]);
		if (number !== undefined && (key === "exitCode" || number >= 0)) safe[key] = number;
	}
	for (const key of ["stdoutSha256", "stderrSha256"]) {
		const hash = safeHash(value[key]);
		if (hash !== undefined) safe[key] = hash;
	}
	for (const key of ["stdoutEvidence", "stderrEvidence"]) {
		const evidence = safeOutputEvidence(value[key]);
		if (evidence !== undefined) safe[key] = evidence;
	}
	if (Array.isArray(value.scenarioIds)) safe.scenarioIds = safeIdentifierList(value.scenarioIds);
	return safe;
}

function safeDiscoveryReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const id = safeIdentifier(value.id);
	const sha256 = safeHash(value.sha256);
	return id === undefined || sha256 === undefined ? undefined : { id, sha256 };
}

function safeHookReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const id = safeIdentifier(value.id);
	if (id === undefined) return undefined;
	const safe = { id };
	for (const key of ["exitCode", "durationMs", "stdoutBytes"]) {
		const number = safeFiniteNumber(value[key]);
		if (number !== undefined && (key === "exitCode" || number >= 0)) safe[key] = number;
	}
	return safe;
}

function safeDoctorReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const status = SAFE_PROBE_STATUSES.has(value.status) ? value.status : undefined;
	if (status === undefined) return undefined;
	const safe = { status };
	const exitCode = safeFiniteNumber(value.exitCode);
	if (exitCode !== undefined) safe.exitCode = exitCode;
	const stdoutBytes = safeFiniteNumber(value.stdoutBytes);
	if (stdoutBytes !== undefined && stdoutBytes >= 0) safe.stdoutBytes = stdoutBytes;
	const stdoutSha256 = safeHash(value.stdoutSha256);
	if (stdoutSha256 !== undefined) safe.stdoutSha256 = stdoutSha256;
	const stderrEvidence = safeOutputEvidence(value.stderrEvidence);
	if (stderrEvidence !== undefined) safe.stderrEvidence = stderrEvidence;
	if (value.report === null) safe.report = null;
	else if (value.report && typeof value.report === "object" && !Array.isArray(value.report)) {
		const issueCount = safeFiniteNumber(value.report.issueCount);
		if (typeof value.report.ok === "boolean" && issueCount !== undefined && issueCount >= 0) {
			safe.report = { ok: value.report.ok, issueCount };
		}
	}
	return safe;
}

function safeHostAttemptReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const id = safeIdentifier(value.id);
	const status = SAFE_PROBE_STATUSES.has(value.status) ? value.status : undefined;
	if (id === undefined || status === undefined) return undefined;
	const safe = { id, status };
	const exitCode = safeFiniteNumber(value.exitCode);
	if (exitCode !== undefined) safe.exitCode = exitCode;
	const stdoutBytes = safeFiniteNumber(value.stdoutBytes);
	if (stdoutBytes !== undefined && stdoutBytes >= 0) safe.stdoutBytes = stdoutBytes;
	const stdoutSha256 = safeHash(value.stdoutSha256);
	if (stdoutSha256 !== undefined) safe.stdoutSha256 = stdoutSha256;
	const stderrEvidence = safeOutputEvidence(value.stderrEvidence);
	if (stderrEvidence !== undefined) safe.stderrEvidence = stderrEvidence;
	return safe;
}

function safeHostExecutionReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const status = SAFE_PROBE_STATUSES.has(value.status) ? value.status : undefined;
	if (status === undefined || typeof value.realCodex !== "boolean") return undefined;
	return {
		status,
		realCodex: value.realCodex,
		attemptedSkillIds: safeIdentifierList(value.attemptedSkillIds),
		blockedSkillIds: safeIdentifierList(value.blockedSkillIds),
		attempts: Array.isArray(value.attempts)
			? value.attempts.map((attempt) => safeHostAttemptReceipt(attempt)).filter((attempt) => attempt !== undefined)
			: [],
	};
}

function safeProbeCounts(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const safe = {};
	for (const key of [
		"setupCommands",
		"semanticCommands",
		"discoveredSkills",
		"zeroStdoutHooks",
		"scenarios",
		"scenarioAssertions",
	]) {
		const number = safeFiniteNumber(value[key]);
		if (number !== undefined && number >= 0) safe[key] = number;
	}
	return Object.keys(safe).length === 0 ? undefined : safe;
}

function safeOperationReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return {
			status: "FAIL_HOST_MALFORMED",
			failure: { phase: "unexpected-exception", message: "probe operation returned no typed receipt" },
		};
	}
	const status = SAFE_PROBE_STATUSES.has(value.status) ? value.status : "FAIL_HOST_MALFORMED";
	const safe = { status };
	if (value.scope === "doctor" || value.scope === "full") safe.scope = value.scope;
	if (value.package && typeof value.package === "object" && !Array.isArray(value.package)) {
		const packageReceipt = {};
		const tarballSha256 = safeHash(value.package.tarballSha256);
		if (tarballSha256 !== undefined) packageReceipt.tarballSha256 = tarballSha256;
		for (const key of ["installedPackagePresent", "managedMarketplacePresent", "sourceFallbackUnavailable"]) {
			if (typeof value.package[key] === "boolean") packageReceipt[key] = value.package[key];
		}
		if (Object.keys(packageReceipt).length > 0) safe.package = packageReceipt;
	}
	for (const key of ["setupCommands", "semanticCommands"]) {
		if (Array.isArray(value[key])) {
			safe[key] = value[key].map((record) => safeCommandReceipt(record)).filter((record) => record !== undefined);
		}
	}
	if (Array.isArray(value.discovery)) {
		safe.discovery = value.discovery
			.map((record) => safeDiscoveryReceipt(record))
			.filter((record) => record !== undefined);
	}
	if (Array.isArray(value.hooks)) {
		safe.hooks = value.hooks.map((record) => safeHookReceipt(record)).filter((record) => record !== undefined);
	}
	const doctor = safeDoctorReceipt(value.doctor);
	if (doctor !== undefined) safe.doctor = doctor;
	const hostExecution = safeHostExecutionReceipt(value.hostExecution);
	if (hostExecution !== undefined) safe.hostExecution = hostExecution;
	const counts = safeProbeCounts(value.counts);
	if (counts !== undefined) safe.counts = counts;
	if (value.failure && typeof value.failure === "object" && !Array.isArray(value.failure)) {
		const phase = SAFE_TERMINAL_PHASES.has(value.failure.phase) ? value.failure.phase : "unexpected-exception";
		safe.failure = {
			phase,
			message: boundedErrorMessage(value.failure.message, "probe operation failed"),
			...safeTerminalDetails(value.failure),
		};
	}
	return safe;
}

function safeCountReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const safe = {};
	for (const [key, item] of Object.entries(value)) {
		if (!SAFE_TERMINAL_NUMBER_FIELDS.has(key)) continue;
		const number = safeFiniteNumber(item);
		if (number !== undefined && number >= 0) safe[key] = number;
	}
	return Object.keys(safe).length === 0 ? undefined : safe;
}

function safeTerminalDetails(details) {
	if (details === null || typeof details !== "object" || Array.isArray(details)) return {};
	const safe = {};
	for (const [key, value] of Object.entries(details)) {
		if (key === "stderr" || key === "stdout") {
			safe[`${key}Evidence`] = outputEvidence(value);
			continue;
		}
		if (key === "stderrEvidence" || key === "stdoutEvidence") {
			const evidence = safeOutputEvidence(value);
			if (evidence !== undefined) safe[key] = evidence;
			continue;
		}
		if (key === "sha256" || key === "stdoutSha256" || key === "stderrSha256") {
			const hash = safeHash(value);
			if (hash !== undefined) safe[key] = hash;
			continue;
		}
		if (SAFE_TERMINAL_NUMBER_FIELDS.has(key)) {
			const number = safeFiniteNumber(value);
			if (number !== undefined) safe[key] = number;
			continue;
		}
		if (SAFE_TERMINAL_BOOLEAN_FIELDS.has(key) && typeof value === "boolean") {
			safe[key] = value;
			continue;
		}
		if (key === "status" && SAFE_TERMINAL_STATUSES.has(value)) {
			safe.status = value;
			continue;
		}
		if (key === "phase" && SAFE_TERMINAL_PHASES.has(value)) {
			safe.phase = value;
			continue;
		}
		if (key === "code" && typeof value === "string" && /^E[A-Z0-9_]{1,31}$/u.test(value)) {
			safe.code = value;
			continue;
		}
		if (key === "signal" && (value === "SIGINT" || value === "SIGTERM" || value === "SIGKILL")) {
			safe.signal = value;
			continue;
		}
		if (key === "message" && typeof value === "string") {
			safe.message = boundedErrorMessage(value, "detail unavailable");
			continue;
		}
		if (key === "counts" || key === "timing") {
			const counts = safeCountReceipt(value);
			if (counts !== undefined) safe[key] = counts;
		}
	}
	return safe;
}

function safeCleanupReceipt(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return { removed: false };
	const safe = {};
	for (const key of [
		"removed",
		"timedOut",
		"interrupted",
		"temporaryArtifactsRemoved",
		"sessionTerminated",
		"authStateRemoved",
	]) {
		if (typeof value[key] === "boolean") safe[key] = value[key];
	}
	const counts = safeCountReceipt(value.counts);
	if (counts !== undefined) safe.counts = counts;
	return Object.keys(safe).length === 0 ? { removed: false } : safe;
}

function safeSentinelReceipt(value) {
	if (value?.status === "ERROR") {
		const name = SAFE_ERROR_NAMES.has(value.error?.name) ? value.error.name : "Error";
		const code =
			typeof value.error?.code === "string" && /^E[A-Z0-9_]{1,31}$/u.test(value.error.code)
				? value.error.code
				: null;
		return {
			status: "ERROR",
			error: {
				name,
				...(code === null ? {} : { code }),
				message: boundedErrorMessage(value.error?.message, "live CODEX_HOME config sentinel read failed"),
			},
		};
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const safe = {};
	if (typeof value.exists === "boolean") safe.exists = value.exists;
	if (value.sha256 === null) safe.sha256 = null;
	else {
		const hash = safeHash(value.sha256);
		if (hash !== undefined) safe.sha256 = hash;
	}
	return safe;
}

function sentinelReadDiagnostic(error, phase) {
	const candidateName = error instanceof Error ? error.name : null;
	const name = typeof candidateName === "string" && SAFE_ERROR_NAMES.has(candidateName) ? candidateName : "Error";
	const candidateCode = error && typeof error === "object" ? error.code : null;
	const code = typeof candidateCode === "string" && /^E[A-Z0-9_]{1,31}$/u.test(candidateCode) ? candidateCode : null;
	const message = `live CODEX_HOME config sentinel ${phase === "live-sentinel-before" ? "preflight" : "postflight"} read failed (${name}${code === null ? "" : `/${code}`})`;
	return {
		status: "ERROR",
		error: {
			name,
			...(code === null ? {} : { code }),
			message,
		},
	};
}

function interruptionReceipt(receipt, interruption) {
	if (interruption === null) return receipt;
	return {
		...receipt,
		status: "INTERRUPTED_SIGNAL",
		failure: { phase: "signal", message: `probe interrupted by ${interruption.signal}` },
		interruption: {
			signal: interruption.signal,
			exitCode: interruption.exitCode,
			repeated: interruption.repeated,
		},
	};
}

export async function runProbeLifecycle({
	evidencePath,
	runId = randomUUID(),
	now = () => new Date().toISOString(),
	readSentinel = configSentinel,
	operation,
	cleanup,
	cleanupTimeoutMs = 5_000,
	receiptIo,
}) {
	const startedAt = now();
	let receipt = { schema: "litcodex.uiux-installed-probe/v4", runId, startedAt, status: "IN_PROGRESS" };
	const archivedPath = archivedEvidencePath(evidencePath, runId);
	const operationController = new AbortController();
	let interruption = null;
	const signalHandlers = new Map();
	for (const [signal, exitCode] of [
		["SIGINT", 130],
		["SIGTERM", 143],
	]) {
		const handler = () => {
			if (interruption === null) {
				interruption = { signal, exitCode, repeated: false };
				operationController.abort(new Error(`probe interrupted by ${signal}`));
			} else {
				interruption.repeated = true;
			}
		};
		signalHandlers.set(signal, handler);
		process.on(signal, handler);
	}
	const restoreSignalHandlers = () => {
		for (const [signal, handler] of signalHandlers) process.off(signal, handler);
	};
	try {
		await atomicCreateJsonAsync(archivedPath, receipt, receiptIo);
	} catch (error) {
		await atomicWriteJsonAsync(evidencePath, receipt, receiptIo).catch(() => {});
		restoreSignalHandlers();
		throw error;
	}
	try {
		await atomicWriteJsonAsync(evidencePath, receipt, receiptIo);
	} catch (error) {
		restoreSignalHandlers();
		throw error;
	}
	let sentinelBefore;
	let sentinelBeforeRead = false;
	let sentinelBeforeDiagnostic;
	if (interruption === null) {
		try {
			sentinelBefore = readSentinel();
			sentinelBeforeRead = true;
		} catch (error) {
			sentinelBeforeDiagnostic = sentinelReadDiagnostic(error, "live-sentinel-before");
			receipt.status = "BLOCKED_HOST_CONFIG_UNREADABLE";
			receipt.failure = { phase: "live-sentinel-before", message: sentinelBeforeDiagnostic.error.message };
		}
	}
	if (sentinelBeforeRead && interruption === null) {
		try {
			receipt = { ...receipt, ...safeOperationReceipt(await operation({ signal: operationController.signal })) };
		} catch (error) {
			if (interruption === null) {
				const terminal = error instanceof ProbeTerminalError ? error : null;
				const status = SAFE_TERMINAL_STATUSES.has(terminal?.status) ? terminal.status : "FAIL_HOST_EXECUTION";
				const phase = SAFE_TERMINAL_PHASES.has(terminal?.phase) ? terminal.phase : "unexpected-exception";
				receipt = {
					...receipt,
					status,
					failure: {
						phase,
						message: boundedErrorMessage(error, "unexpected probe failure"),
						...safeTerminalDetails(terminal?.details),
					},
				};
			}
		}
	}
	try {
		let timeout;
		const timeoutResult = new Promise((resolve) => {
			timeout = setTimeout(() => resolve({ sandboxRoot: null, removed: false, timedOut: true }), cleanupTimeoutMs);
		});
		receipt.cleanup = safeCleanupReceipt(
			await Promise.race([Promise.resolve(cleanup({ interrupted: interruption !== null })), timeoutResult]),
		);
		clearTimeout(timeout);
		if (receipt.cleanup?.timedOut === true && interruption === null) {
			receipt.status = "FAIL_HOST_EXECUTION";
			receipt.failure = { phase: "cleanup", message: "probe cleanup timed out" };
		}
	} catch (error) {
		if (interruption === null) {
			receipt.status = "FAIL_HOST_EXECUTION";
			receipt.failure = {
				phase: "cleanup",
				message: boundedErrorMessage(error, "probe cleanup failed"),
			};
		}
		receipt.cleanup = { removed: false };
	}
	let sentinelAfter;
	let sentinelAfterRead = false;
	let sentinelAfterDiagnostic;
	if (interruption === null || sentinelBeforeRead) {
		try {
			sentinelAfter = readSentinel();
			sentinelAfterRead = true;
		} catch (error) {
			sentinelAfterDiagnostic = sentinelReadDiagnostic(error, "live-sentinel-after");
			if (sentinelBeforeRead && interruption === null) {
				receipt.status = "FAIL_HOST_EXECUTION";
				receipt.failure = { phase: "live-sentinel-after", message: sentinelAfterDiagnostic.error.message };
			}
		}
	}
	receipt.liveSentinel = {
		before: safeSentinelReceipt(sentinelBeforeRead ? sentinelBefore : sentinelBeforeDiagnostic),
		after: safeSentinelReceipt(sentinelAfterRead ? sentinelAfter : sentinelAfterDiagnostic),
	};
	if (sentinelBeforeRead && sentinelAfterRead) {
		const unchanged = JSON.stringify(sentinelBefore) === JSON.stringify(sentinelAfter);
		receipt.liveSentinel.unchanged = unchanged;
		if (!unchanged && interruption === null) {
			receipt.status = "FAIL_HOST_EXECUTION";
			receipt.failure = { phase: "live-sentinel", message: "live CODEX_HOME config sentinel changed" };
		}
	}
	receipt.endedAt = now();
	const interruptedBeforeWrite = interruption !== null;
	try {
		receipt = interruptionReceipt(receipt, interruption);
		await atomicWriteJsonAsync(archivedPath, receipt, receiptIo);
		await atomicWriteJsonAsync(evidencePath, receipt, receiptIo);
		if (!interruptedBeforeWrite && interruption !== null) {
			receipt = interruptionReceipt(receipt, interruption);
			await atomicWriteJsonAsync(archivedPath, receipt, receiptIo);
			await atomicWriteJsonAsync(evidencePath, receipt, receiptIo);
		}
	} catch (error) {
		restoreSignalHandlers();
		throw error;
	}
	restoreSignalHandlers();
	if (interruption !== null) process.exitCode = interruption.exitCode;
	return receipt;
}

export function commandRecord(name, command, args, options, exitCode, stdoutIncludes) {
	const result = timed(command, args, options);
	assert(
		result.exitCode === exitCode,
		`${name} exit ${result.exitCode}: ${boundedErrorMessage(result.stderr, "command failed")}`,
	);
	assert(result.stdout.includes(stdoutIncludes), `${name} stdout missing ${stdoutIncludes}`);
	return {
		name: safeIdentifier(name) ?? "command",
		exitCode: result.exitCode,
		durationMs: result.durationMs,
		stdoutBytes: Buffer.byteLength(result.stdout),
		stdoutSha256: createHash("sha256").update(result.stdout).digest("hex"),
		stderrEvidence: outputEvidence(result.stderr),
	};
}

export async function commandRecordAsync(
	name,
	command,
	args,
	options,
	exitCode,
	expectedResult,
	runCommand = timedAsync,
) {
	const result = await runCommand(command, args, options);
	assert(
		result.exitCode === exitCode,
		`${name} exit ${result.exitCode}: ${boundedErrorMessage(result.stderr, "command failed")}`,
	);
	let parsed;
	try {
		parsed = parseJson(result.stdout, "SEMANTIC_RESULT_INVALID");
	} catch (error) {
		if (error instanceof Error && error.message.includes("duplicate JSON key")) {
			throw new Error(`${name} stdout must not contain a duplicate JSON key`);
		}
		throw new Error(`${name} stdout must contain exactly one JSON object`);
	}
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new Error(`${name} stdout must contain exactly one JSON object`);
	}
	if (expectedResult === null || Array.isArray(expectedResult) || typeof expectedResult !== "object") {
		throw new Error(`${name} semantic expectation must be an object`);
	}
	for (const [field, expected] of Object.entries(expectedResult)) {
		assert(
			Object.hasOwn(parsed, field) && JSON.stringify(parsed[field]) === JSON.stringify(expected),
			`${name} semantic field ${field} did not match the strict typed expectation`,
		);
	}
	return {
		name: safeIdentifier(name) ?? "command",
		exitCode: result.exitCode,
		durationMs: result.durationMs,
		stdoutBytes: Buffer.byteLength(result.stdout),
		stdoutSha256: createHash("sha256").update(result.stdout).digest("hex"),
		stderrEvidence: outputEvidence(result.stderr),
	};
}

export function assertBetaDesignContract(contract) {
	assert(
		/^litfamily\.design-contract\/v1beta[1-9]\d*$/u.test(contract?.schema_id ?? ""),
		"installed probe contract must be beta",
	);
}

export function designContract() {
	return {
		...uiuxDesignContract({ id: "installed-probe" }),
		schema_id: "litfamily.design-contract/v1beta1",
		lane: "brownfield",
		tokens: [{ id: "token:action", category: "color", value: "accent-600", usage: "primary action" }],
		component_behaviors: [
			{
				component_id: "component:primary-action",
				state_ids: ["state:error"],
				interaction_ids: ["interaction:critical"],
				keyboard_behavior: "Enter activates the primary action",
			},
		],
		responsive_transformations: [
			{
				route_id: "route:primary",
				viewport_id: "viewport:small",
				behavior: "The primary region stacks at compact width",
			},
		],
		motion: {
			policy: "functional",
			reduced_motion_behavior: "State changes without translation",
			transitions: [
				{
					id: "transition:primary",
					interaction_id: "interaction:critical",
					duration_ms: 120,
					easing: "ease-out",
				},
			],
		},
		acceptance_criteria: [
			{
				id: "criterion:primary",
				observable: "Keyboard activation reaches the error state",
				verification: "browser",
				required: true,
				inventory_ids: ["component:primary-action", "interaction:critical", "state:error"],
			},
		],
	};
}

export function evidenceBundle(
	contract,
	{
		captureBytes,
		capturePath = "captures/primary.png",
		capturedAt = "2026-07-25T05:59:20.000Z",
		createdAt = "2026-07-25T05:59:30.000Z",
		full = false,
	} = {},
) {
	if (!Buffer.isBuffer(captureBytes) || captureBytes.length === 0) {
		throw new Error("installed beta evidence requires material capture bytes");
	}
	const smokeIds = [
		"route:primary",
		"interaction:critical",
		"viewport:small",
		"viewport:large",
		...contract.evidence_policy.required_channels.map((channel) => `channel:${channel}`),
	];
	const ids = full
		? [
				"route:primary",
				"route:secondary",
				"region:primary",
				"component:primary-action",
				"interaction:critical",
				"state:error",
				"viewport:small",
				"viewport:large",
				...contract.evidence_policy.required_channels.map((channel) => `channel:${channel}`),
			]
		: smokeIds;
	const items = Object.fromEntries(
		ids.map((id) => [id, Buffer.from(`installed-item:${id}`, "utf8").toString("base64")]),
	);
	const inventory = ids.map((id) => ({
		id,
		status: "captured",
		evidence_hash: sha256(Buffer.from(`installed-item:${id}`, "utf8")),
		captured_at: capturedAt,
	}));
	const manifest = {
		schema_id: "litfamily.evidence-manifest/v1beta1",
		created_at: createdAt,
		maximum_age_seconds: 60,
		design_contract_hash: sha256(canonicalJson(contract)),
		source_hash: contract.source_hash,
		capture_hash: sha256(captureBytes),
		capture_path: capturePath,
		capture_byte_length: captureBytes.length,
		capture_width: 1,
		capture_height: 1,
		environment: {
			surface: "web",
			renderer_identity: "isolated-installed-probe",
			capture_tool: "litcodex installed-surface driver",
			locale: "ko-KR",
			color_scheme: "light",
			reduced_motion: true,
			process_owned: true,
			session_owned: true,
		},
		capabilities: { capture: true, auth: true, independent_review: false },
		inventory,
		review_receipt_hashes: [],
		cleanup: {
			status: "complete",
			temporary_artifacts_removed: true,
			session_terminated: true,
			auth_state_removed: true,
		},
		blockers: [],
		findings: [],
	};
	const evidence = {
		manifest: canonicalJson(manifest),
		inventory: canonicalJson(inventory),
		inventory_items: items,
		capture_base64: captureBytes.toString("base64"),
	};
	return {
		design_contract: contract,
		evidence_manifest: manifest,
		evidence_bytes: evidence,
		review_receipts: [],
	};
}

export function configSentinel() {
	const root = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
	const path = join(root, "config.toml");
	return {
		path,
		exists: existsSync(path),
		sha256: existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null,
	};
}
