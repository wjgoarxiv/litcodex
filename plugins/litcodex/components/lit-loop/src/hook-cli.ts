// src/hook-cli.ts — M06 process adapter (A2 §2.4, A3 addendum A3/A4).
//
// The ONLY module that touches process streams + exit codes for the hook route. Reads stdin to a
// UTF-8 string defensively, then BOM-strip → empty-check → JSON.parse (in that exact order, A3 A4),
// hands the parsed value to the pure engine, and writes the decision. Exit map: any structurally
// valid event → 0 (no-op writes zero bytes); unparseable or oversized stdin → 2 with a
// machine-readable LitHookError JSON line on stderr. NEVER calls process.exit (the dispatcher does)
// and NEVER throws.

import { isAbsolute } from "node:path";
import { Writable } from "node:stream";
import { adhdSuggestion } from "./adhd-suggest.js";
import { claimReloadContext, evaluateAutoHandoffStop, recordCompaction, takeReloadContext } from "./auto-handoff.js";
import {
	applyAutoHandoffRoute,
	clearManagedCompactionWhenOff,
	parseAutoHandoffRoute,
} from "./auto-handoff-settings.js";
import { applyPreToolUseCreateGoalGuard, isLitUserPromptSubmitInput, runUserPromptSubmitHook } from "./codex-hook.js";
import { laneScope, subagentEvent, toolLaneEvents } from "./lane-events.js";
import { type LaneEvent, recordLaneEvent } from "./lane-state.js";
import {
	detectWaitReason,
	endLiveStep,
	recordLiveStepEnd,
	recordLiveStepStart,
	recordTurnStart,
	writeThreadPointer,
} from "./live-step.js";
import {
	armMotionTurn,
	disarmMotionTurn,
	evaluateMotionStop,
	type MotionEvaluator,
	recordMotionTool,
} from "./motion-gate.js";
import {
	evaluatePlanPersistence,
	formatStopBlockOutput,
	rearmLitPlanIfSatisfied,
	recordLitPlanActivation,
} from "./plan-persistence.js";
import {
	clearActiveRoute,
	isBareLit,
	isLitContinue,
	readActiveRoute,
	readResumeWork,
	recordActiveRoute,
} from "./reentry.js";
import { isBoundaryAnswer, isGoPrompt, takeGo } from "./rewind-go.js";
import { workflowCard } from "./screen-card.js";
import { screenColor } from "./screen-status.js";
import { applyPromptToStack, frameToResume } from "./stack-hook.js";
import { recordWorkflowTurn, workflowStopLine, workflowTurn } from "./workflow-map.js";

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
	clearManagedCompactionWhenOff(hookCwd(parsed, repoRoot), auto.env ?? process.env);
	// `lit approve` / `lit deny` answer a start-work boundary; the lifecycle hook owns them, so this one stays out.
	if (isLitUserPromptSubmitInput(parsed) && isBoundaryAnswer(parsed.prompt)) return 0;
	// `go` after a lit-adhd brief runs the one step the brief named, as if the user had typed that step.
	let goNote: string | null = null;
	if (isLitUserPromptSubmitInput(parsed) && isGoPrompt(parsed.prompt)) {
		const scope = hookSessionScope(parsed, repoRoot);
		const go = scope === null ? null : takeGo(scope.cwd, scope.sessionId, auto.now ?? Date.now());
		if (go?.kind === "hint") {
			stdout.write(withReloadContext("", go.text) ?? "");
			return 0;
		}
		if (go?.kind === "run") {
			parsed = { ...(parsed as unknown as Record<string, unknown>), prompt: go.prompt };
			goNote = go.note;
		}
	}
	const pointer = hookSessionScope(parsed, repoRoot);
	const savedRoute = pointer === null ? null : readActiveRoute(pointer.cwd, pointer.sessionId);
	// An active lit-plan owns the persistence gate, so `lit continue` stays inside it rather than leaving it armed.
	const litContinue =
		pointer !== null &&
		savedRoute !== "lit-plan" &&
		isLitUserPromptSubmitInput(parsed) &&
		isLitContinue(parsed.prompt);
	// `lit continue` over a side discipline returns to the paused spine, at the stage and count it left.
	const spine = litContinue ? frameToResume(pointer.cwd, pointer.sessionId) : null;
	const decision = runUserPromptSubmitHook(parsed, () => {
		const saved = savedRoute;
		return {
			active: spine !== null && saved !== null ? spine.skill : saved,
			resume: pointer === null ? null : readResumeWork(pointer.cwd, pointer.sessionId),
			frame:
				spine === null
					? null
					: {
							skill: spine.skill ?? "work",
							stage: spine.stage,
							...(spine.n === undefined ? {} : { n: spine.n }),
							...(spine.total === undefined ? {} : { total: spine.total }),
						},
		};
	});
	// A film prompt arms the completion gate for this session; any other prompt disarms it.
	if (pointer !== null && isLitUserPromptSubmitInput(parsed)) {
		if (decision.kind === "inject" && decision.film === true) armMotionTurn(pointer.cwd, pointer.sessionId, auto.now);
		else disarmMotionTurn(pointer.cwd, pointer.sessionId);
	}
	// A read-only brief never takes the saved route: the work under it keeps its contract and its place.
	if (pointer !== null && decision.kind === "inject" && decision.mode !== "lit-adhd") {
		recordActiveRoute(pointer.cwd, pointer.sessionId, spine?.skill ?? decision.mode);
	}
	if (pointer !== null && isLitUserPromptSubmitInput(parsed) && (litContinue || decision.kind === "inject")) {
		applyPromptToStack(
			pointer.cwd,
			pointer.sessionId,
			parsed.prompt,
			{ continued: litContinue, mode: decision.kind === "inject" ? decision.mode : null },
			auto.now === undefined ? undefined : new Date(auto.now),
		);
	}
	// Only a LIT thread gets a pointer: this prompt ignites LIT, or an earlier one already did.
	if (pointer !== null && (decision.kind === "inject" || workflowTurn(pointer.cwd, pointer.sessionId) !== null)) {
		writeThreadPointer(auto.env ?? process.env, pointer.sessionId, pointer.cwd, auto.now);
		recordTurnStart(pointer.cwd, pointer.sessionId, auto.now);
	}
	// A continued lit-plan keeps its persistence gate as it is. A fresh activation arms it again, and so does an
	// explicit `lit plan …` once the previous plan was saved (a bare `lit` carries on and never re-arms).
	if (decision.kind === "inject" && decision.mode === "lit-plan") {
		const scope = hookSessionScope(parsed, repoRoot);
		if (scope !== null) {
			if (decision.entry !== "continue") recordLitPlanActivation(scope.cwd, scope.sessionId);
			else if (isLitUserPromptSubmitInput(parsed) && !isBareLit(parsed.prompt))
				rearmLitPlanIfSatisfied(scope.cwd, scope.sessionId);
		}
	}
	const env = auto.env ?? process.env;
	const own =
		decision.kind === "inject"
			? withCardOffer(
					withWorkflowMap(decision.stdout, parsed, decision.mode, env),
					pointer,
					auto,
					decision.entry === "continue",
				)
			: "";
	const noted = goNote === null || own === "" ? own : (withReloadContext(own, goNote) ?? own);
	const output = withAutoHandoffReload(noted, parsed, repoRoot, auto);
	if (output !== "") stdout.write(output);
	return 0;
}

/** Injectable environment for the automatic-handoff hooks; production uses the process environment. */
export interface AutoHandoffHookOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: number;
	/** Replaces the installed film skill's done-check in the Stop gate; tests only. */
	readonly evaluateMotion?: MotionEvaluator;
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

/**
 * Put the handoff excerpt for a compaction between turns into this turn's output, claiming it once. The
 * claim is made only when the output is built, and it is given back when the text cannot be merged, so a
 * reload that never reached the model stays available for the next prompt.
 */
function withAutoHandoffReload(
	stdout: string,
	parsed: unknown,
	repoRoot: string,
	options: AutoHandoffHookOptions,
): string {
	const scope = hookSessionScope(parsed, repoRoot);
	if (scope === null) return stdout;
	const claim = claimReloadContext(scope.cwd, scope.sessionId, options.env ?? process.env, false);
	if (claim === null) return stdout;
	const merged = withReloadContext(stdout, claim.text);
	if (merged === null) {
		claim.release();
		return stdout;
	}
	return merged;
}

/**
 * Add reload text to a UserPromptSubmit output that may already carry context, or carry only a visible
 * line; "" becomes a context-only output. Null when the output cannot be merged (it is not JSON).
 */
function withReloadContext(stdout: string, reload: string): string | null {
	if (stdout === "") {
		return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reload } })}\n`;
	}
	try {
		const output = JSON.parse(stdout) as {
			hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
		} | null;
		if (typeof output !== "object" || output === null || Array.isArray(output)) return null;
		const specific = output.hookSpecificOutput ?? { hookEventName: "UserPromptSubmit" };
		specific.additionalContext = [specific.additionalContext, reload].filter(Boolean).join("\n\n");
		output.hookSpecificOutput = specific;
		return `${JSON.stringify(output)}\n`;
	} catch {
		return null;
	}
}

/**
 * Add the LIT card (map and checklist) under the activation banner and remember the turn for the Stop
 * card. Only an event that names its own absolute `cwd` is mapped, so the card always describes the
 * session's repo.
 */
function withWorkflowMap(stdout: string, parsed: unknown, mode: string, env: NodeJS.ProcessEnv): string {
	if (!isRecord(parsed) || typeof parsed["cwd"] !== "string" || !isAbsolute(parsed["cwd"])) return stdout;
	const cwd = parsed["cwd"];
	const sessionId =
		typeof parsed["session_id"] === "string" && parsed["session_id"] !== "" ? parsed["session_id"] : null;
	try {
		if (sessionId !== null && typeof parsed["turn_id"] === "string") {
			recordWorkflowTurn(cwd, sessionId, parsed["turn_id"], mode);
		}
		const card = workflowCard(cwd, sessionId, mode, "turn started", {
			color: screenColor(env),
			quietWhenEmpty: true,
		});
		if (card === null) return stdout;
		const output = JSON.parse(stdout) as Record<string, unknown>;
		if (!isRecord(output) || typeof output["systemMessage"] !== "string") return stdout;
		output["systemMessage"] = `${output["systemMessage"]}\n${card}`;
		return `${JSON.stringify(output)}\n`;
	} catch {
		return stdout;
	}
}

/**
 * Asks the model to open the LIT card for this LIT turn, so the live card sits next to the newest turn
 * instead of scrolling away with the first one. In the terminal `codex` the same tool returns the map as text.
 */
export const CARD_OFFER_CONTEXT =
	"LIT card: if the `lit_card` tool (litcodex MCP server) is available, call the `lit_card` tool once now, with no arguments, so the user sees the live LIT card for this turn. It replaces the previous turn's card, which folds itself into one line. Do not call it again in this turn; it updates by itself.";

/** The card request for a continued discipline: the model already read the full one when it was activated. */
export const CARD_OFFER_CONTINUE_CONTEXT =
	"LIT card: if the `lit_card` tool is available, call it once now with no arguments; it updates by itself.";

/**
 * Add the card request to every LIT activation, right under the banner line so it stays inside the part
 * of the context Codex always shows, and remember when it was last made.
 */
function withCardOffer(
	stdout: string,
	scope: { sessionId: string; cwd: string } | null,
	auto: AutoHandoffHookOptions,
	continued = false,
): string {
	if (scope === null || stdout === "") return stdout;
	const offer = continued ? CARD_OFFER_CONTINUE_CONTEXT : CARD_OFFER_CONTEXT;
	const merged = withContextAfterBanner(stdout, offer) ?? withReloadContext(stdout, offer);
	if (merged === null) return stdout;
	writeThreadPointer(auto.env ?? process.env, scope.sessionId, scope.cwd, auto.now, { cardOffered: true });
	return merged;
}

/** Insert a line after the context's `LIT IGNITED` banner line; null when there is no banner to anchor on. */
function withContextAfterBanner(stdout: string, text: string): string | null {
	try {
		const output = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: unknown } } | null;
		const context = output?.hookSpecificOutput?.additionalContext;
		if (output === null || typeof context !== "string") return null;
		const banner = /^.*LIT IGNITED · .*$/mu.exec(context);
		if (banner === null) return null;
		const end = banner.index + banner[0].length;
		(output.hookSpecificOutput as { additionalContext: string }).additionalContext =
			`${context.slice(0, end)}\n${text}${context.slice(end)}`;
		return `${JSON.stringify(output)}\n`;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A subagent's hooks carry the root session id, so its Stop must not end the parent's turn card. */
function isSubagent(parsed: unknown): boolean {
	return isRecord(parsed) && typeof parsed["agent_id"] === "string" && parsed["agent_id"] !== "";
}

/** Absolute `cwd` from a hook event, else the fallback root. */
function hookCwd(parsed: unknown, repoRoot: string): string {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return repoRoot;
	const cwd = (parsed as Record<string, unknown>)["cwd"];
	return typeof cwd === "string" && isAbsolute(cwd) ? cwd : repoRoot;
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
	clearManagedCompactionWhenOff(hookCwd(parsed, repoRoot), auto.env ?? process.env);
	const scope = hookSessionScope(parsed, repoRoot);
	if (scope !== null) {
		// No tool runs once Stop fires: one whose PostToolUse never came (interrupted, or denied by another hook) is over.
		// The turn itself closes only below, after the guards that can send the model back to work.
		endLiveStep(scope.cwd, scope.sessionId, auto.now, false);
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
		if (handoff.decision === "block") {
			stdout.write(formatStopBlockOutput(handoff.reason));
			return 0;
		}
		// A subagent's Stop carries the parent's session id; the parent's turn is still running.
		if (isSubagent(parsed)) return 0;
		const motion = await evaluateMotionStop({
			cwd: scope.cwd,
			sessionId: scope.sessionId,
			...(auto.now === undefined ? {} : { now: auto.now }),
			...(auto.evaluateMotion === undefined ? {} : { evaluate: auto.evaluateMotion }),
		});
		if (motion.action === "block") {
			stdout.write(formatStopBlockOutput(motion.reason));
			return 0;
		}
		const lastMsg = typeof record["last_assistant_message"] === "string" ? record["last_assistant_message"] : null;
		endLiveStep(scope.cwd, scope.sessionId, auto.now, true, detectWaitReason(lastMsg));
		const env = auto.env ?? process.env;
		const line =
			typeof record["turn_id"] === "string"
				? workflowStopLine(scope.cwd, scope.sessionId, record["turn_id"], {
						stopHookActive: record["stop_hook_active"] === true,
						transcriptPath: typeof record["transcript_path"] === "string" ? record["transcript_path"] : null,
					})
				: null;
		const turn = line === null ? null : workflowTurn(scope.cwd, scope.sessionId);
		const card =
			turn === null ? null : workflowCard(scope.cwd, scope.sessionId, turn.mode, line, { color: screenColor(env) });
		// Codex puts a hook label before the first row, so the card starts on the next one.
		if (card !== null) stdout.write(`${JSON.stringify({ systemMessage: `\n${card}` })}\n`);
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
	clearManagedCompactionWhenOff(hookCwd(event.parsed, repoRoot), auto.env ?? process.env);
	const record = event.parsed as Record<string, unknown> | null;
	if (
		typeof record === "object" &&
		record !== null &&
		(record["source"] === "startup" || record["source"] === "resume")
	) {
		const opened = hookSessionScope(record, repoRoot);
		const offer = opened === null ? null : adhdSuggestion(opened.cwd, opened.sessionId);
		if (offer !== null) {
			stdout.write(
				`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: offer } })}\n`,
			);
		}
		return 0;
	}
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
	auto: AutoHandoffHookOptions = {},
): Promise<number> {
	const event = await readHookEvent(stdin, stderr);
	if (event.exit !== null) return event.exit;
	clearManagedCompactionWhenOff(hookCwd(event.parsed, repoRoot), auto.env ?? process.env);
	const scope = hookSessionScope(event.parsed, repoRoot);
	if (scope !== null) {
		recordCompaction(scope.cwd, scope.sessionId);
		// The activation text may be gone from the model's context, so the next lit prompt sends it in full.
		clearActiveRoute(scope.cwd, scope.sessionId);
	}
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

/** The card's own tools: opening or polling the card is not a step of the work. */
const OWN_CARD_TOOL = /^mcp__litcodex__lit_card(?:_status)?$/u;

/** Injectable environment and clock for the live-step hooks. */
export interface LiveStepHookOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: number;
}

/** `{ sessionId, cwd, tool, toolUseId }` from a tool event that names its own absolute cwd, else null. */
function toolEventScope(
	parsed: unknown,
): { sessionId: string; cwd: string; tool: string; toolUseId: string | null } | null {
	if (!isRecord(parsed)) return null;
	const { session_id: sessionId, cwd, tool_name: tool, tool_use_id: toolUseId } = parsed;
	if (typeof sessionId !== "string" || sessionId === "" || typeof tool !== "string" || tool === "") return null;
	if (typeof cwd !== "string" || !isAbsolute(cwd)) return null;
	return { sessionId, cwd, tool, toolUseId: typeof toolUseId === "string" && toolUseId !== "" ? toolUseId : null };
}

/**
 * Catch-all PreToolUse: in a thread with a LIT activation, remember the running tool for the LIT card
 * and point the thread at its workspace. It prints nothing and exits 0 on every input, so it can never block or change a tool call.
 */
export async function runPreToolUseLiveHookCli(
	stdin: NodeJS.ReadableStream,
	_stdout: NodeJS.WritableStream,
	_stderr: NodeJS.WritableStream,
	options: LiveStepHookOptions = {},
): Promise<number> {
	const event = await readHookEvent(stdin, nullSink());
	if (event.exit !== null) return 0;
	const scope = toolEventScope(event.parsed);
	if (scope === null || OWN_CARD_TOOL.test(scope.tool)) return 0;
	const now = options.now ?? Date.now();
	// Only a LIT thread has a card to feed, so other sessions leave no `.litcodex` folder and no pointer.
	if (workflowTurn(scope.cwd, scope.sessionId) === null) return 0;
	recordLiveStepStart(scope.cwd, scope.sessionId, scope, now);
	writeThreadPointer(options.env ?? process.env, scope.sessionId, scope.cwd, now);
	return 0;
}

/** Catch-all PostToolUse: clear the live step this call set. Prints nothing; exits 0 on every input. */
export async function runPostToolUseLiveHookCli(
	stdin: NodeJS.ReadableStream,
	_stdout: NodeJS.WritableStream,
	_stderr: NodeJS.WritableStream,
	options: LiveStepHookOptions = {},
): Promise<number> {
	const event = await readHookEvent(stdin, nullSink());
	if (event.exit !== null) return 0;
	const scope = toolEventScope(event.parsed);
	const now = options.now ?? Date.now();
	if (scope !== null && !OWN_CARD_TOOL.test(scope.tool)) recordLiveStepEnd(scope.cwd, scope.sessionId, scope, now);
	recordLanes(event.parsed, toolLaneEvents, now);
	// A shell call that ran the film renderer is noted for the completion gate (motion-gate.ts).
	recordMotionTool(event.parsed, now);
	return 0;
}

/** Fold a hook payload's lane events into the session's lane records; only a LIT thread has lanes to draw. */
function recordLanes(parsed: unknown, read: (parsed: unknown) => LaneEvent[], now: number): void {
	try {
		const scope = laneScope(parsed);
		if (scope === null || workflowTurn(scope.cwd, scope.sessionId) === null) return;
		for (const laneEvent of read(parsed)) recordLaneEvent(scope.cwd, scope.sessionId, laneEvent, now);
	} catch {
		// Lanes only decorate the card; a hook never fails because of them.
	}
}

/**
 * SubagentStart and SubagentStop: a child agent began or ended, so its lane row appears or leaves. Prints
 * nothing and exits 0 on every input, including one whose payload shape is not the one probed.
 */
export async function runSubagentHookCli(
	kind: "start" | "stop",
	stdin: NodeJS.ReadableStream,
	options: LiveStepHookOptions = {},
): Promise<number> {
	const event = await readHookEvent(stdin, nullSink());
	if (event.exit !== null) return 0;
	recordLanes(
		event.parsed,
		(parsed) => {
			const laneEvent = subagentEvent(parsed, kind);
			return laneEvent === null ? [] : [laneEvent];
		},
		options.now ?? Date.now(),
	);
	return 0;
}

/** Swallows the parse errors the shared reader reports; the live-step hooks stay silent. */
function nullSink(): Writable {
	return new Writable({ write: (_chunk, _encoding, callback) => callback() });
}
