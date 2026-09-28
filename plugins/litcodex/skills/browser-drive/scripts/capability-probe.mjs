#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import process from "node:process";

export const DRIVER_COMMAND = "agent-browser";

export const BROWSER_DRIVE_IDENTITY = Object.freeze({
	source: "vercel-labs/agent-browser",
	sourceUrl: "https://github.com/vercel-labs/agent-browser",
	command: DRIVER_COMMAND,
});

export const BROWSER_DRIVE_BLOCKER = Object.freeze({
	unavailable: "BLOCKED_BROWSER_DRIVER_UNAVAILABLE",
	identity: "BLOCKED_BROWSER_IDENTITY_UNVERIFIED",
});

/**
 * @typedef {Object} BrowserDriverAvailable
 * @property {"available"} status
 * @property {true} available
 * @property {"available"} availability
 * @property {string} command
 * @property {string} version
 * @property {null} blocker
 * @property {null} reason
 * @property {string} detail
 */

/**
 * @typedef {Object} BrowserDriverUnavailable
 * @property {"unavailable"} status
 * @property {false} available
 * @property {"unavailable"} availability
 * @property {string|null} command
 * @property {string|null} version
 * @property {string} blocker
 * @property {"missing-command"|"identity-unverified"|"probe-error"} reason
 * @property {string} detail
 */

/** @typedef {BrowserDriverAvailable|BrowserDriverUnavailable} BrowserDriverProbeResult */

const VERSION_TIMEOUT_MS = 10_000;
const SUPERVISOR_GRACE_MS = 2_000;
const BANNER_LIMIT = 200;
const VERSION_OUTPUT_LIMIT_BYTES = 16 * 1024;
const SUPERVISOR_OUTPUT_LIMIT_BYTES = 64 * 1024;
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;
const RAW_ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/u;
const RAW_CONTROL_CHARS = /[\p{Cc}\p{Cf}]/u;
export const VERIFIED_DRIVER_FLOOR = "0.34.0";
const VERSION_NUMBER = "(?:0|[1-9]\\d*)";
const PRERELEASE_ID = `(?:${VERSION_NUMBER}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const BUILD_ID = "[0-9A-Za-z-]+";
const SEMVER = `${VERSION_NUMBER}\\.${VERSION_NUMBER}\\.${VERSION_NUMBER}(?:-${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*)?(?:\\+${BUILD_ID}(?:\\.${BUILD_ID})*)?`;
const DRIVER_VERSION = new RegExp(`^${BROWSER_DRIVE_IDENTITY.command}\\s+v?(${SEMVER})$`, "iu");
const BANNER_INSTRUCTION =
	/(?:\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions\b)|(?:\b(?:follow|execute|run)\s+(?:these|the\s+following)\s+instructions\b)|(?:\b(?:system|developer)\s*:\s*)/iu;
const BANNER_MARKUP = /(?:<\/?[A-Za-z][^>\r\n]{0,128}>|<!--|-->|<!\[CDATA\[|\{\{|\}\})/u;
const BANNER_CREDENTIAL =
	/(?:(?:\b[a-z][a-z0-9+.-]*:\/\/|\/\/)[^\/?#\s]*@|\b(?:gh[pousr]|github_pat|glpat|gloas|gldt|glrt|glcbt|xox[baprs]|xapp|npm)[_-][A-Za-z0-9_-]{8,}\b|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{10,}\b|\bwhsec_[A-Za-z0-9_-]{10,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\b(?:AIza|hf_)[A-Za-z0-9_-]{16,}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\b(?:(?:[A-Za-z][A-Za-z0-9]*[_-]+)*(?:api[_-]?key|access[_-]?token|auth(?:[_-]?token)?|client[_-]?secret|credential|passphrase|password|private[_-]?key|refresh[_-]?token|secret|token|_auth(?:token)?)(?:[_-]+[A-Za-z0-9]+)*)\s*[=:]\s*[^\s"'`]+|\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s"'`]+|\b(?:basic|bearer)\s+[A-Za-z0-9+/=_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;

const POSIX_SUPERVISOR = String.raw`
import { spawn } from "node:child_process";
import process from "node:process";

const command = process.argv[1];
const args = JSON.parse(process.argv[2]);
const timeoutMs = Number(process.argv[3]);
const maxOutputBytes = Number(process.argv[4]);
const env = process.env;
const output = {
  stdout: { chunks: [], seen: 0 },
  stderr: { chunks: [], seen: 0 },
};
let totalSeen = 0;
let timedOut = false;
let outputExceeded = false;
let terminating = false;
let finished = false;
let timeoutTimer;
let killTimer;

function collect(stream, target) {
  stream.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    target.seen += bytes.byteLength;
    totalSeen += bytes.byteLength;
    if (totalSeen > maxOutputBytes) {
      outputExceeded = true;
      terminate("output");
    }
    const kept = Math.max(0, Math.min(bytes.byteLength, maxOutputBytes - (target.seen - bytes.byteLength)));
    if (kept > 0) target.chunks.push(bytes.subarray(0, kept));
  });
}

function signalChild(signal) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The child may have exited between the state check and the signal.
  }
}

function terminate(reason) {
  if (finished || terminating) return;
  terminating = true;
  timedOut = reason === "timeout";
  signalChild("SIGTERM");
  killTimer = setTimeout(() => signalChild("SIGKILL"), 100);
}

function writeResult(code, signal) {
	// One aggregate byte budget covers both streams: stdout keeps its bytes first and stderr
	// receives only the remainder, so the persisted total stays deterministic and bounded.
	const stdoutBytes = Buffer.concat(output.stdout.chunks).subarray(0, maxOutputBytes);
	const stderrBytes = Buffer.concat(output.stderr.chunks).subarray(
	  0,
	  Math.max(0, maxOutputBytes - stdoutBytes.byteLength),
	);
	process.stdout.write(JSON.stringify({
		code: Number.isInteger(code) ? code : null,
		signal: signal ?? null,
		timedOut,
    outputExceeded,
    windowsDirectChildFallback: process.platform === "win32" && terminating,
    stdout: stdoutBytes.toString("base64"),
		stderr: stderrBytes.toString("base64"),
	}) + "\n");
}

function finish(code, signal) {
	if (finished) return;
	finished = true;
	clearTimeout(timeoutTimer);
	clearTimeout(killTimer);
	if (process.platform !== "win32" && child.pid !== undefined) {
		signalChild("SIGTERM");
		killTimer = setTimeout(() => {
			signalChild("SIGKILL");
			writeResult(code, signal);
		}, 100);
		return;
	}
	writeResult(code, signal);
}

const child = spawn(command, args, {
  env,
  detached: process.platform !== "win32",
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
});
collect(child.stdout, output.stdout);
collect(child.stderr, output.stderr);
child.once("error", () => finish(null, "error"));
child.once("close", (code, signal) => finish(code, signal));
timeoutTimer = setTimeout(() => terminate("timeout"), timeoutMs);
`;

function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsCredentialShape(value) {
	return typeof value === "string" && BANNER_CREDENTIAL.test(value);
}

function hasRawBannerControl(value) {
	if (typeof value !== "string") return false;
	for (const raw of value.split(/\r?\n/u)) {
		if (RAW_ANSI_ESCAPE.test(raw) || RAW_CONTROL_CHARS.test(raw)) return true;
	}
	return false;
}

// Paths never legitimately carry control characters, so test the whole string: the line-splitting
// banner check would let a newline or carriage return inside an executable path slip through.
function hasRawPathControl(value) {
	return typeof value !== "string" || RAW_CONTROL_CHARS.test(value);
}

function firstMeaningfulLine(value) {
	if (typeof value !== "string") return null;
	for (const raw of value.split(/\r?\n/u)) {
		const line = raw.replace(ANSI_ESCAPE, "").replace(CONTROL_CHARS, "").trim();
		if (line !== "") return line;
	}
	return null;
}

function hasOverLimitMeaningfulLine(value) {
	if (typeof value !== "string") return false;
	for (const raw of value.split(/\r?\n/u)) {
		const line = raw.replace(ANSI_ESCAPE, "").replace(CONTROL_CHARS, "");
		if (line.trim() !== "" && line.length > BANNER_LIMIT) return true;
	}
	return false;
}

function combinedOutputExceedsLimit(stdout, stderr) {
	const stdoutBytes = typeof stdout === "string" ? Buffer.byteLength(stdout, "utf8") : 0;
	const stderrBytes = typeof stderr === "string" ? Buffer.byteLength(stderr, "utf8") : 0;
	return stdoutBytes + stderrBytes > VERSION_OUTPUT_LIMIT_BYTES;
}

function bannerIsUnsafe(value) {
	if (typeof value !== "string") return false;
	for (const raw of value.split(/\r?\n/u)) {
		const line = raw.replace(ANSI_ESCAPE, "").replace(CONTROL_CHARS, "").trim();
		if (line !== "" && (BANNER_INSTRUCTION.test(line) || BANNER_MARKUP.test(line) || BANNER_CREDENTIAL.test(line))) {
			return true;
		}
	}
	return false;
}

function exitStatus(result) {
	if (!isRecord(result)) return null;
	const value = result.status ?? result.returncode;
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function runSafely(runCommand, command, args, options) {
	try {
		return typeof runCommand === "function" ? runCommand(command, args, options) : null;
	} catch {
		return null;
	}
}

function decodeSupervisorOutput(value) {
	if (typeof value !== "string") return "";
	try {
		return Buffer.from(value, "base64").toString("utf8");
	} catch {
		return "";
	}
}

function runVersionCommand(command, args, environment, timeoutMs) {
	try {
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "-e", POSIX_SUPERVISOR, command, JSON.stringify(args), String(timeoutMs), String(VERSION_OUTPUT_LIMIT_BYTES)],
			{
				encoding: "utf8",
				env: environment,
				timeout: timeoutMs + SUPERVISOR_GRACE_MS,
				maxBuffer: SUPERVISOR_OUTPUT_LIMIT_BYTES,
			},
		);
		const message = typeof result.stdout === "string" ? result.stdout.trim() : "";
		const parsed = message === "" ? null : JSON.parse(message);
		if (!isRecord(parsed)) return null;
		return {
			status: typeof parsed.code === "number" ? parsed.code : null,
			stdout: decodeSupervisorOutput(parsed.stdout),
			stderr: decodeSupervisorOutput(parsed.stderr),
			timedOut: parsed.timedOut === true,
			outputExceeded: parsed.outputExceeded === true,
			windowsDirectChildFallback: parsed.windowsDirectChildFallback === true,
		};
	} catch {
		return null;
	}
}

function resolveExecutable(searchPath) {
	if (typeof searchPath !== "string" || searchPath.length === 0) return null;
	if (hasRawPathControl(searchPath) || containsCredentialShape(searchPath)) return null;
	const extensions = process.platform === "win32" ? process.env.PATHEXT?.split(";") ?? [".EXE", ".CMD", ".BAT"] : [""];
	for (const directory of searchPath.split(delimiter)) {
		if (directory.length === 0) continue;
		const base = join(directory, DRIVER_COMMAND);
		for (const extension of extensions) {
			const candidate = `${base}${extension}`;
			if (hasRawPathControl(candidate) || containsCredentialShape(candidate)) return null;
			try {
				if (statSync(candidate).isFile()) {
					accessSync(candidate, constants.X_OK);
					return candidate;
				}
			} catch {
				// Continue through PATH entries. A broken or non-executable entry is unavailable.
			}
		}
	}
	return null;
}

function result(status, fields) {
	return { status, available: status === "available", availability: status, ...fields };
}

function unavailable(reason, detail, command = null, version = null) {
	return result("unavailable", {
		command,
		version,
		blocker: reason === "missing-command" ? BROWSER_DRIVE_BLOCKER.unavailable : BROWSER_DRIVE_BLOCKER.identity,
		reason,
		detail,
	});
}

function probeUnsafe(options) {
	if (!isRecord(options)) {
		return unavailable("probe-error", `${DRIVER_COMMAND} capability probe received malformed input`);
	}
	const input = options;
	const hasExplicitPath = Object.hasOwn(input, "path");
	if (hasExplicitPath && typeof input.path !== "string") {
		return unavailable("probe-error", `${DRIVER_COMMAND} capability probe received malformed input`);
	}
	if (Object.hasOwn(input, "runCommand") && typeof input.runCommand !== "function") {
		return unavailable("probe-error", `${DRIVER_COMMAND} capability probe received malformed input`);
	}
	const searchPath = hasExplicitPath
		? input.path
		: typeof process.env.PATH === "string"
			? process.env.PATH
			: "";
	const requestedTimeout = input.timeoutMs;
	const timeoutMs =
		typeof requestedTimeout === "number" && Number.isInteger(requestedTimeout) && requestedTimeout > 0
			? Math.min(requestedTimeout, VERSION_TIMEOUT_MS)
			: VERSION_TIMEOUT_MS;
	if (searchPath.length === 0) {
		return unavailable(
			"missing-command",
			`${DRIVER_COMMAND} is not on PATH; this session cannot drive a browser`,
		);
	}

	const environment = { PATH: searchPath };
	const injectedRunner = typeof input.runCommand === "function" ? input.runCommand : null;
	const resolved = injectedRunner
		? runSafely(injectedRunner, "command", ["-v", DRIVER_COMMAND], {
			encoding: "utf8",
			env: environment,
			shell: true,
		})
		: null;
	const command = injectedRunner
		? exitStatus(resolved) === 0
			? hasRawBannerControl(resolved?.stdout) || containsCredentialShape(firstMeaningfulLine(resolved?.stdout))
				? null
				: firstMeaningfulLine(resolved?.stdout)
			: null
		: resolveExecutable(searchPath);
	if (command === null || hasRawPathControl(command)) {
		return unavailable(
			"missing-command",
			`${DRIVER_COMMAND} is not on PATH; this session cannot drive a browser`,
		);
	}

	const versionRun = injectedRunner
		? runSafely(injectedRunner, command, ["--version"], {
			encoding: "utf8",
			env: environment,
			timeout: timeoutMs,
			maxBuffer: VERSION_OUTPUT_LIMIT_BYTES,
		})
		: runVersionCommand(command, ["--version"], environment, timeoutMs);
	const hasRawOutputControl =
		hasRawBannerControl(versionRun?.stdout) || hasRawBannerControl(versionRun?.stderr);
	if (hasRawOutputControl) {
		return unavailable(
			"identity-unverified",
			`${command} resolved but did not report a usable version`,
			command,
			null,
		);
	}
	const rawVersion = firstMeaningfulLine(versionRun?.stdout) ?? firstMeaningfulLine(versionRun?.stderr);
	const identity = rawVersion?.match(DRIVER_VERSION) ?? null;
	const normalizedVersion = identity === null ? null : `${DRIVER_COMMAND} ${identity[1]}`;
	const unsafeBanner =
		containsCredentialShape(versionRun?.stdout) ||
		containsCredentialShape(versionRun?.stderr) ||
		bannerIsUnsafe(versionRun?.stdout) ||
		bannerIsUnsafe(versionRun?.stderr);
	const overLimitBanner = hasOverLimitMeaningfulLine(versionRun?.stdout) || hasOverLimitMeaningfulLine(versionRun?.stderr);
	const overLimitOutput =
		combinedOutputExceedsLimit(versionRun?.stdout, versionRun?.stderr) || versionRun?.outputExceeded === true;
	if (
		versionRun === null ||
		exitStatus(versionRun) !== 0 ||
		rawVersion === null ||
		unsafeBanner ||
		overLimitBanner ||
		overLimitOutput ||
		versionRun?.timedOut === true
	) {
		return unavailable(
			"identity-unverified",
			`${command} resolved but did not report a usable version`,
			command,
			null,
		);
	}
	if (identity === null || normalizedVersion === null) {
		return unavailable(
			"identity-unverified",
			`${command} resolved but its version banner does not identify ${DRIVER_COMMAND}`,
			command,
			null,
		);
	}
	const versionWithoutBuild = identity[1]?.split("+", 1)[0] ?? "";
	const [versionCore, prerelease] = versionWithoutBuild.split("-", 2);
	const parts = versionCore?.split(".").map(BigInt) ?? [];
	const floor = VERIFIED_DRIVER_FLOOR.split(".").map(BigInt);
	let comparison = 0;
	for (let index = 0; index < floor.length; index += 1) {
		if (parts[index] !== floor[index]) {
			comparison = (parts[index] ?? 0n) > (floor[index] ?? 0n) ? 1 : -1;
			break;
		}
	}
	const older = comparison < 0 || (comparison === 0 && prerelease !== undefined);
	const newer = comparison > 0;
	if (older) {
		return unavailable("identity-unverified", `${normalizedVersion} is below the verified floor ${VERIFIED_DRIVER_FLOOR}`, command, normalizedVersion);
	}
	return result("available", {
		command,
		version: normalizedVersion,
		blocker: null,
		reason: null,
		detail: newer
			? `${command} ${normalizedVersion} is beyond verified; identity was confirmed and the capability floor is ${VERIFIED_DRIVER_FLOOR}`
			: `${command} ${normalizedVersion} meets the verified floor ${VERIFIED_DRIVER_FLOOR}`,
	});
}

/**
 * Probe the external browser driver without throwing.
 *
 * @param {unknown} options
 * @returns {BrowserDriverProbeResult}
 */
export function probeBrowserDriver(options) {
	try {
		if (arguments.length === 0) options = {};
		return probeUnsafe(options);
	} catch {
		return unavailable(
			"probe-error",
			`${DRIVER_COMMAND} capability probe received malformed input or failed safely`,
		);
	}
}

if (process.argv[1]?.endsWith("capability-probe.mjs")) {
	const report = probeBrowserDriver();
	process.stdout.write(`${JSON.stringify(report)}\n`);
	process.exitCode = report.available ? 0 : 1;
}
