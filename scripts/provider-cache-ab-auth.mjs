import { cpSync, lstatSync, mkdirSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { measureProviderCacheReceipts } from "../plugins/litcodex/components/telemetry/dist/provider-cache.js";
import { runCommand, runProviderTurn } from "./provider-cache-ab-process.mjs";

export class HostAuthError extends Error {
	constructor(code) {
		super(code);
		this.name = "HostAuthError";
		this.code = code;
	}
}

export function findHostAuthSource(env, defaultHome = homedir()) {
	const configuredHome = typeof env.CODEX_HOME === "string" ? env.CODEX_HOME.trim() : "";
	if (configuredHome !== "" && !isAbsolute(configuredHome)) {
		throw new HostAuthError("BLOCKED_HOST_AUTH_UNAVAILABLE");
	}
	const codexHome = configuredHome === "" ? join(resolve(defaultHome), ".codex") : configuredHome;
	try {
		const source = realpathSync(join(codexHome, "auth.json"));
		if (!statSync(source).isFile()) throw new Error("not a file");
		return source;
	} catch {
		throw new HostAuthError("BLOCKED_HOST_AUTH_UNAVAILABLE");
	}
}

export function captureHostAuthBoundary(source) {
	try {
		const metadata = statSync(source, { bigint: true });
		if (!metadata.isFile()) throw new Error("not a file");
		return Object.freeze({
			device: metadata.dev.toString(),
			inode: metadata.ino.toString(),
			size: metadata.size.toString(),
			modified: metadata.mtimeNs.toString(),
			changed: metadata.ctimeNs.toString(),
		});
	} catch {
		throw new HostAuthError("BLOCKED_HOST_AUTH_UNAVAILABLE");
	}
}

export function linkHostAuthSource(source, sandboxCodexHome) {
	mkdirSync(sandboxCodexHome, { recursive: true, mode: 0o700 });
	const linked = join(sandboxCodexHome, "auth.json");
	if (lstatSync(linked, { throwIfNoEntry: false }) !== undefined) {
		throw new HostAuthError("SANDBOX_AUTH_TARGET_EXISTS");
	}
	symlinkSync(source, linked, "file");
	assertHostAuthLink(source, linked);
	return linked;
}

export function assertHostAuthBoundary(source, expected, linked) {
	assertHostAuthLink(source, linked);
	assertHostAuthUnchanged(source, expected);
}

export function assertHostAuthUnchanged(source, expected) {
	let actual;
	try {
		actual = captureHostAuthBoundary(source);
	} catch {
		throw new HostAuthError("HOST_AUTH_MUTATED");
	}
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new HostAuthError("HOST_AUTH_MUTATED");
}

export function isChatGptLoginStatus(stdout, stderr) {
	return [stdout, stderr]
		.filter((value) => typeof value === "string")
		.flatMap((value) => value.split(/\r?\n/u))
		.some((line) => line.trim() === "Logged in using ChatGPT");
}

export async function verifyChatGptLogin({ root, codex, env, source, boundary, signal, onAuthLink }) {
	const authCheckHome = join(root, "auth-check");
	const authCheckCodexHome = join(authCheckHome, ".codex");
	const linked = linkHostAuthSource(source, authCheckCodexHome);
	onAuthLink(linked);
	let result;
	try {
		result = await runCommand(codex, ["login", "status"], {
			cwd: root,
			env: { ...env, HOME: authCheckHome, CODEX_HOME: authCheckCodexHome },
			timeoutMs: 10_000,
			signal,
		});
	} catch {
		throw new HostAuthError("BLOCKED_HOST_AUTH_UNAVAILABLE");
	}
	assertHostAuthBoundary(source, boundary, linked);
	if (!isChatGptLoginStatus(result.stdout, result.stderr)) {
		throw new HostAuthError("BLOCKED_HOST_AUTH_UNAVAILABLE");
	}
}

export async function runLiveSession({
	root,
	template,
	arm,
	block,
	ordinal,
	codex,
	model,
	scenario,
	env,
	fixtureRoot,
	authSource,
	authBoundary,
	signal,
	onAuthLink,
	onCompletion,
}) {
	const taskHome = join(root, `home-${ordinal}`);
	cpSync(template, taskHome, { recursive: true });
	const taskEnv = { ...env, HOME: taskHome, CODEX_HOME: join(taskHome, ".codex") };
	const linkedAuth = linkHostAuthSource(authSource, taskEnv.CODEX_HOME);
	onAuthLink(linkedAuth);
	const initialOptions = [
		"--json",
		"--model",
		model,
		"--skip-git-repo-check",
		"--sandbox",
		"read-only",
		"--dangerously-bypass-hook-trust",
	];
	const baselineTurn = await runProviderTurn(
		codex,
		["exec", ...initialOptions, "-C", fixtureRoot, scenario.records[0].prompt],
		taskEnv,
		fixtureRoot,
		scenario.records[0],
		signal,
		onCompletion,
	);
	assertHostAuthBoundary(authSource, authBoundary, linkedAuth);
	const threadId = baselineTurn.parsed.threadId;
	if (typeof threadId !== "string") throw new Error("MISSING_THREAD_ID");
	const turns = [];
	const snapshots = [];
	const resumeOptions = ["--json", "--model", model, "--skip-git-repo-check", "--dangerously-bypass-hook-trust"];
	for (const record of scenario.records.slice(1)) {
		const turn = await runProviderTurn(
			codex,
			["exec", "resume", ...resumeOptions, threadId, record.prompt],
			taskEnv,
			fixtureRoot,
			record,
			signal,
			onCompletion,
		);
		assertHostAuthBoundary(authSource, authBoundary, linkedAuth);
		snapshots.push(turn.parsed.receipt);
		turns.push({
			id: record.id,
			latencyMs: turn.latencyMs,
			correct: turn.parsed.correct,
			responseSha256: turn.parsed.responseSha256,
			responseBytes: turn.parsed.responseBytes,
			stdoutSha256: turn.stdoutSha256,
			stderrSha256: turn.stderrSha256,
		});
	}
	const measurement = measureProviderCacheReceipts({ baseline: baselineTurn.parsed.receipt, snapshots });
	if (measurement.status !== "measured") throw new Error(`MEASUREMENT_${measurement.status.toUpperCase()}`);
	return { block, arm, measurement, turns };
}

function assertHostAuthLink(source, linked) {
	try {
		if (!lstatSync(linked).isSymbolicLink() || realpathSync(linked) !== realpathSync(source)) {
			throw new Error("link changed");
		}
	} catch {
		throw new HostAuthError("SANDBOX_AUTH_COPY_DETECTED");
	}
}
