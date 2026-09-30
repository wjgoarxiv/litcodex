// src/hook-cli.ts — M06 process adapter (A2 §2.4, A3 addendum A3/A4).
//
// The ONLY module that touches process streams + exit codes for the hook route. Reads stdin to a
// UTF-8 string defensively, then BOM-strip → empty-check → JSON.parse (in that exact order, A3 A4),
// hands the parsed value to the pure engine, and writes the decision. Exit map: any structurally
// valid event → 0 (no-op writes zero bytes); unparseable or oversized stdin → 2 with a
// machine-readable LitHookError JSON line on stderr. NEVER calls process.exit (the dispatcher does)
// and NEVER throws. A UserPromptSubmit turn the router leaves alone may carry the opt-in Jev skill
// hint (./jev-hint.ts) and, once per session while it is on, a plain-text banner; with its switch
// off, that path makes no request and writes nothing.

import { isAbsolute } from "node:path";
import { evaluateAutoHandoffStop, recordCompaction, takeReloadContext } from "./auto-handoff.js";
import { applyAutoHandoffRoute, parseAutoHandoffRoute } from "./auto-handoff-settings.js";
import { applyPreToolUseCreateGoalGuard, isLitUserPromptSubmitInput, runUserPromptSubmitHook } from "./codex-hook.js";
import {
	claimJevOnBanner,
	formatJevHookOutput,
	type JevHttpClient,
	jevSwitchState,
	runJevSkillHint,
	withJevBanner,
} from "./jev-hint.js";
import { evaluatePlanPersistence, formatStopBlockOutput, recordLitPlanActivation } from "./plan-persistence.js";

/** Hard cap on stdin to bound memory / ReDoS exposure inside the 5 s Codex hook budget. 8 MB. */
export const MAX_STDIN_BYTES = 8_000_000;

/** Machine-readable error envelope emitted to stderr on a NON-zero exit. */
export interface LitHookError {
	readonly ok: false;
	readonly error: { readonly code: LitHookErrorCode; readonly message: string };
}

export type LitHookErrorCode = "LIT_HOOK_STDIN_INVALID_JSON" | "LIT_HOOK_STDIN_TOO_LARGE";

const INVALID_JSON_MESSAGE = "lit hook: stdin was not valid JSON";
const TOO_LARGE_MESSAGE = `lit hook: stdin exceeded ${MAX_STDIN_BYTES} bytes`;

function errorLine(code: LitHookErrorCode, message: string): string {
	const payload: LitHookError = { ok: false, error: { code, message } };
	return `${JSON.stringify(payload)}\n`;
}

/**
 * Read stdin to completion, enforcing MAX_STDIN_BYTES per chunk on the raw byte total BEFORE any
 * decode (A3 A3). Resolves the decoded UTF-8 string, or `null` if the cap was exceeded (in which
 * case the stream is destroyed and no decode/parse is attempted on the over-limit buffer).
 */
function readStdin(stdin: NodeJS.ReadableStream): Promise<string | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let settled = false;

		const finish = (value: string | null): void => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};

		stdin.on("data", (chunk: Buffer | string) => {
			const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
			total += buf.length;
			if (total > MAX_STDIN_BYTES) {
				// Stop reading and abandon the over-limit buffer without decoding/parsing it.
				stdin.pause();
				const destroy = (stdin as { destroy?: () => void }).destroy;
				if (typeof destroy === "function") {
					destroy.call(stdin);
				}
				finish(null);
				return;
			}
			chunks.push(buf);
		});
		stdin.on("end", () => {
			finish(Buffer.concat(chunks).toString("utf8"));
		});
		stdin.on("error", () => {
			// Treat a stream error like end-of-input over what we collected; the parse step decides.
			finish(Buffer.concat(chunks).toString("utf8"));
		});
		stdin.on("close", () => {
			finish(Buffer.concat(chunks).toString("utf8"));
		});
	});
}

/**
 * Stream-driven entry point. Resolves exactly one exit code (0 or 2); NEVER calls process.exit and
 * NEVER throws. Writes the camelCase activation line to stdout (empty on no-op), or a LitHookError
 * line to stderr on malformed / oversized stdin.
 */
export async function runUserPromptSubmitHookCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
	repoRoot = process.cwd(),
	jev: JevHookOptions = {},
	auto: AutoHandoffHookOptions = {},
): Promise<number> {
	const decoded = await readStdin(stdin);
	if (decoded === null) {
		stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
		return 2;
	}

	// A3 A4 ordering: strip ONE leading BOM, then empty-check, then parse.
	let raw = decoded;
	if (raw.charCodeAt(0) === 0xfeff) {
		raw = raw.slice(1);
	}
	if (raw.trim().length === 0) {
		return 0;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
		return 2;
	}

	const route = autoHandoffRouteOutput(parsed, repoRoot, auto);
	if (route !== "") {
		stdout.write(route);
		return 0;
	}
	const reload = autoHandoffReload(parsed, repoRoot, auto);
	const decision = runUserPromptSubmitHook(parsed);
	if (decision.kind === "inject" && decision.mode === "lit-plan") {
		const scope = hookSessionScope(parsed, repoRoot);
		if (scope !== null) recordLitPlanActivation(scope.cwd, scope.sessionId);
	}
	if (decision.kind === "inject") {
		stdout.write(withReloadContext(decision.stdout, reload));
		return 0;
	}
	const hint = await jevHintOutput(parsed, repoRoot, jev);
	const output = withReloadContext(hint, reload);
	if (output !== "") stdout.write(output);
	return 0;
}

/** Injectable environment for the automatic-handoff hooks; production uses the process environment. */
export interface AutoHandoffHookOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: number;
}

/** `lit-handoff auto on|off|status` changes a setting and never reaches the model: the prompt is blocked with one plain reply. */
function autoHandoffRouteOutput(parsed: unknown, repoRoot: string, options: AutoHandoffHookOptions): string {
	if (!isLitUserPromptSubmitInput(parsed)) return "";
	const route = parseAutoHandoffRoute(parsed.prompt);
	if (route === null) return "";
	const record = parsed as unknown as Record<string, unknown>;
	const cwd = typeof record["cwd"] === "string" && isAbsolute(record["cwd"]) ? record["cwd"] : repoRoot;
	const reason = applyAutoHandoffRoute(cwd, options.env ?? process.env, route);
	return `${JSON.stringify({ decision: "block", reason })}\n`;
}

/** The handoff excerpt to bring back after a compaction between turns, or null. Claims it once. */
function autoHandoffReload(parsed: unknown, repoRoot: string, options: AutoHandoffHookOptions): string | null {
	const scope = hookSessionScope(parsed, repoRoot);
	if (scope === null) return null;
	return takeReloadContext(scope.cwd, scope.sessionId, options.env ?? process.env, false);
}

/** Add reload text to a UserPromptSubmit output that may already carry context; "" stays "" without one. */
function withReloadContext(stdout: string, reload: string | null): string {
	if (reload === null) return stdout;
	if (stdout === "") {
		return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reload } })}\n`;
	}
	try {
		const output = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
		const specific = output.hookSpecificOutput;
		if (specific === undefined) return stdout;
		specific.additionalContext = [specific.additionalContext, reload].filter(Boolean).join("\n\n");
		return `${JSON.stringify(output)}\n`;
	} catch {
		return stdout;
	}
}

/** Injectable Jev dependencies; production uses the process environment and built-in `fetch`. */
export interface JevHookOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly http?: JevHttpClient;
	readonly skillsRoot?: string;
}

/** Optional Jev skill hint for a turn the deterministic router left alone. Never throws. */
async function jevHintOutput(parsed: unknown, repoRoot: string, options: JevHookOptions): Promise<string> {
	const env = options.env ?? process.env;
	if (jevSwitchState(env) === "off" || !isLitUserPromptSubmitInput(parsed)) return "";
	const record = parsed as unknown as Record<string, unknown>;
	const sessionId = typeof record["session_id"] === "string" ? record["session_id"] : null;
	const cwd = typeof record["cwd"] === "string" && isAbsolute(record["cwd"]) ? record["cwd"] : repoRoot;
	try {
		const banner = claimJevOnBanner(cwd, sessionId, env);
		const result = await runJevSkillHint({
			prompt: parsed.prompt,
			sessionId,
			repoRoot: cwd,
			env,
			...(options.http === undefined ? {} : { http: options.http }),
			...(options.skillsRoot === undefined ? {} : { skillsRoot: options.skillsRoot }),
		});
		return formatJevHookOutput(withJevBanner(result, banner));
	} catch {
		return "";
	}
}

/** Read `{ session_id, cwd }` from a hook event; `cwd` falls back to `repoRoot` when absent or relative. */
function hookSessionScope(parsed: unknown, repoRoot: string): { sessionId: string; cwd: string } | null {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	const sessionId = record["session_id"];
	if (typeof sessionId !== "string" || sessionId.length === 0) return null;
	const cwd = record["cwd"];
	return { sessionId, cwd: typeof cwd === "string" && isAbsolute(cwd) ? cwd : repoRoot };
}

/** Enforce lit-plan persistence when a Stop hook event arrives. */
export async function runStopPlanPersistenceHookCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
	repoRoot = process.cwd(),
	auto: AutoHandoffHookOptions = {},
): Promise<number> {
	const decoded = await readStdin(stdin);
	if (decoded === null) {
		stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
		return 2;
	}
	let raw = decoded;
	if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
	if (raw.trim().length === 0) return 0;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
		return 2;
	}
	const scope = hookSessionScope(parsed, repoRoot);
	if (scope !== null) {
		const persistence = evaluatePlanPersistence(scope.cwd, scope.sessionId);
		if (persistence.decision === "block") {
			stdout.write(formatStopBlockOutput(persistence.reason));
			return 0;
		}
		const record = parsed as Record<string, unknown>;
		const handoff = evaluateAutoHandoffStop({
			repoRoot: scope.cwd,
			sessionId: scope.sessionId,
			transcriptPath: typeof record["transcript_path"] === "string" ? record["transcript_path"] : null,
			stopHookActive: record["stop_hook_active"] === true,
			env: auto.env ?? process.env,
			...(auto.now === undefined ? {} : { now: auto.now }),
		});
		if (handoff.decision === "block") stdout.write(formatStopBlockOutput(handoff.reason));
	}
	return 0;
}

/** Parse a hook event from stdin the way every route here does; `exit` is set when the route must stop. */
async function readHookEvent(
	stdin: NodeJS.ReadableStream,
	stderr: NodeJS.WritableStream,
): Promise<{ readonly exit: number } | { readonly exit: null; readonly parsed: unknown }> {
	const decoded = await readStdin(stdin);
	if (decoded === null) {
		stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
		return { exit: 2 };
	}
	let raw = decoded;
	if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
	if (raw.trim().length === 0) return { exit: 0 };
	try {
		return { exit: null, parsed: JSON.parse(raw) };
	} catch {
		stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
		return { exit: 2 };
	}
}

/** SessionStart: after a compaction inside a turn, bring this session's fresh handoff back once. */
export async function runSessionStartHookCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
	repoRoot = process.cwd(),
	auto: AutoHandoffHookOptions = {},
): Promise<number> {
	const event = await readHookEvent(stdin, stderr);
	if (event.exit !== null) return event.exit;
	const record = event.parsed as Record<string, unknown> | null;
	if (typeof record !== "object" || record === null || record["source"] !== "compact") return 0;
	const scope = hookSessionScope(record, repoRoot);
	if (scope === null) return 0;
	const reload = takeReloadContext(scope.cwd, scope.sessionId, auto.env ?? process.env, true);
	if (reload !== null) {
		stdout.write(
			`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: reload } })}\n`,
		);
	}
	return 0;
}

/** PostCompact: remember that a session that saved a handoff has now been compacted. Writes nothing to stdout. */
export async function runPostCompactHookCli(
	stdin: NodeJS.ReadableStream,
	_stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
	repoRoot = process.cwd(),
): Promise<number> {
	const event = await readHookEvent(stdin, stderr);
	if (event.exit !== null) return event.exit;
	const scope = hookSessionScope(event.parsed, repoRoot);
	if (scope !== null) recordCompaction(scope.cwd, scope.sessionId);
	return 0;
}

export async function runPreToolUseCreateGoalGuardCli(
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
): Promise<number> {
	const decoded = await readStdin(stdin);
	if (decoded === null) {
		stderr.write(errorLine("LIT_HOOK_STDIN_TOO_LARGE", TOO_LARGE_MESSAGE));
		return 2;
	}

	let raw = decoded;
	if (raw.charCodeAt(0) === 0xfeff) {
		raw = raw.slice(1);
	}
	if (raw.trim().length === 0) {
		return 0;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		stderr.write(errorLine("LIT_HOOK_STDIN_INVALID_JSON", INVALID_JSON_MESSAGE));
		return 2;
	}

	const decision = applyPreToolUseCreateGoalGuard(parsed);
	if (decision.kind === "deny") {
		stdout.write(decision.stdout);
	}
	return 0;
}
