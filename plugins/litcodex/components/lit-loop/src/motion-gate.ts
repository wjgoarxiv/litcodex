// src/motion-gate.ts — the film completion gate.
//
// A turn routed to the film skill is done when the skill's own done-check says so, not when a command
// ran. Three hook events cooperate through one small record, `.litcodex/motion/turn.json`:
//   UserPromptSubmit  arms the turn for a film prompt, and removes the record for any other prompt;
//   PostToolUse       records every `render.mjs <subcommand>` run of a shell call (its output folder,
//                     round and exit), after expanding the shell variables the call set itself;
//   Stop              blocks the turn until the last output folder passes the done-check.
//
// The record belongs to one session. A model that works inside the film folder is still found: every
// lookup walks up from the hook's cwd to the nearest folder that holds this session's record. A missing
// or unreadable treatment, gate report or look record is a block with a named reason (the skill's
// done-check reports it). Only this module's own state fails open. After MOTION_MAX_BLOCKS reminders the
// hook blocks once more to tell the model to say, in the reply, that the film is not done and why. A blocked
// environment goes straight to that notice, and a finished film that carries a downgrade, labels or open
// look items blocks once so the reply says so. Frames viewed are whatever the done-check reads from
// look.json; this module never parses a transcript.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { plainDirsOrMissing, readSmallJson, writeFileAtomic } from "./live-step.js";
import { resolveSkillPath } from "./modes.js";

export const MOTION_MAX_BLOCKS = 2;

const MOTION_DIR = ".litcodex/motion";
const MOTION_FILE = "turn.json";
const MAX_RUNS = 12;
const MAX_TURN_BYTES = 16_384;

/** Exit codes the renderer reserves for a blocked environment (MO-A-45); the turn cannot finish by trying again. */
const BLOCKED_EXITS: ReadonlySet<number> = new Set([10, 11, 12, 14, 15, 21, 22]);
/** The renderer prints `<NAME>: <message>` for a blocked run and sets no exit line, so the name stands in for the code. */
const EXIT_BY_NAME: Readonly<Record<string, number>> = Object.freeze({
	BLOCKED_NO_CHROME: 10,
	BLOCKED_NO_WEBGL2: 11,
	BLOCKED_NO_FFMPEG_FOR_VIDEO: 12,
	GATE_FAIL_QA: 13,
	BLOCKED_DEPS_NOT_PREWARMED: 14,
	BLOCKED_FONT_FETCH: 15,
	BLOCKED_TREATMENT_INVALID: 16,
	BLOCKED_NO_COVER_ENCODER: 21,
	BLOCKED_ASSET_MISSING: 22,
});

const SUBCOMMANDS = "stage|cover-gate|cover|film|gate|sound|look|stills|sheet|video|perf|completion";
const COMMAND = new RegExp(`\\brender\\.mjs["']?\\s+(${SUBCOMMANDS})\\b([^\\n;&|]*)`, "u");
const SHELL_TOOL = /^Bash$/u;

export interface MotionRun {
	readonly mode: string;
	readonly out: string | null;
	readonly round: number | null;
	readonly stillsOnly: boolean;
	readonly exitCode: number | null;
	readonly at: number;
}

export interface MotionTurn {
	readonly sessionId: string;
	readonly promptAt: number;
	readonly runs: readonly MotionRun[];
	readonly blockCount: number;
	readonly warned: boolean;
	readonly notified: boolean;
}

/** What the film skill's done-check returns (`engine/completion.mjs`). */
export interface MotionVerdict {
	readonly status: string;
	readonly reason: string;
	readonly downgraded?: readonly string[];
	readonly openItems?: readonly string[];
	readonly labels?: readonly string[];
	readonly mode?: string;
}

export type MotionEvaluator = (outDir: string) => Promise<MotionVerdict | null> | MotionVerdict | null;

export type MotionStopDecision =
	| { readonly action: "allow"; readonly why: string }
	| { readonly action: "block"; readonly why: string; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function motionTurnPath(root: string): string {
	return join(root, MOTION_DIR, MOTION_FILE);
}

type TurnRead =
	| { readonly kind: "none" }
	| { readonly kind: "bad" }
	| { readonly kind: "turn"; readonly turn: MotionTurn };

function readTurn(root: string): TurnRead {
	const path = motionTurnPath(root);
	if (!existsSync(path)) return { kind: "none" };
	const raw = readSmallJson(path, MAX_TURN_BYTES);
	if (
		!isRecord(raw) ||
		typeof raw["sessionId"] !== "string" ||
		!Number.isInteger(raw["blockCount"]) ||
		!Array.isArray(raw["runs"])
	)
		return { kind: "bad" };
	return { kind: "turn", turn: raw as unknown as MotionTurn };
}

function writeTurn(root: string, turn: MotionTurn): boolean {
	try {
		if (!plainDirsOrMissing(root, MOTION_DIR)) return false;
		mkdirSync(join(root, MOTION_DIR), { recursive: true });
		writeFileAtomic(motionTurnPath(root), `${JSON.stringify(turn)}\n`);
		return true;
	} catch {
		return false;
	}
}

/**
 * The nearest folder up the tree from `cwd` whose record belongs to `sessionId`. The model often works
 * inside the film folder, and that folder is not the one the prompt armed. A record of another session is
 * not this turn's; an unreadable one of this folder ends the search as "bad" so the caller fails open.
 */
export function findMotionTurnRoot(
	cwd: string,
	sessionId: string,
): { readonly root: string; readonly turn: MotionTurn } | "bad" | null {
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		const read = readTurn(dir);
		if (read.kind === "bad") return "bad";
		if (read.kind === "turn" && read.turn.sessionId === sessionId) return { root: dir, turn: read.turn };
		if (dirname(dir) === dir) return null;
	}
}

/** Arm the turn for a film prompt: a fresh record, no runs, no reminders yet. */
export function armMotionTurn(cwd: string, sessionId: string, now = Date.now()): boolean {
	return writeTurn(cwd, { sessionId, promptAt: now, runs: [], blockCount: 0, warned: false, notified: false });
}

/** A prompt that is not a film prompt ends the gate for this session; nothing else is touched. */
export function disarmMotionTurn(cwd: string, sessionId: string): void {
	try {
		const found = findMotionTurnRoot(cwd, sessionId);
		if (found === null) return;
		if (found === "bad") rmSync(motionTurnPath(resolve(cwd)), { force: true });
		else rmSync(motionTurnPath(found.root), { force: true });
	} catch {
		// A stale record only costs one extra reminder; a prompt hook never fails because of it.
	}
}

const unquote = (value: string): string => value.replace(/^["']|["']$/gu, "");

/** `$NAME` and `${NAME}` from the assignments the command made. A name it never set stays as written. */
function expandVars(value: string, vars: ReadonlyMap<string, string>): string {
	return value.replace(
		/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/gu,
		(whole, braced?: string, bare?: string) => {
			return vars.get(braced ?? bare ?? "") ?? whole;
		},
	);
}

/** The folder a leading `cd <dir>` of the same command line moved to, else the hook's own cwd. */
function workdirAfterCd(before: string, workdir: string): string {
	let dir = workdir;
	for (const match of before.matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]*"|'[^']*'|[^\s;&|]+)/gu)) {
		const target = match[1] === undefined ? "" : unquote(match[1]);
		if (target === "" || target.includes("$") || target.includes("`")) return "";
		dir = target.startsWith("~") ? join(homedir(), target.slice(1)) : isAbsolute(target) ? target : join(dir, target);
	}
	return dir;
}

export interface ParsedMotionCommand {
	readonly mode: string;
	readonly out: string | null;
	readonly round: number | null;
	readonly stillsOnly: boolean;
}

/**
 * Parse one shell call that runs `render.mjs <subcommand> ...`. Variables the same command set earlier
 * (`D=/x/film && node "$R" stage --out "$D"`, also `${D}`) are expanded first. An output path that still
 * holds a `$` after that, or a command substitution, is unknown (`out: null`), never guessed.
 */
export function parseMotionCommand(command: string, workdir: string): ParsedMotionCommand | null {
	const vars = new Map<string, string>();
	for (const m of command.matchAll(
		/(?:^|[\s;&|(])(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]*)/gu,
	)) {
		const name = m[1];
		const value = m[2];
		if (name !== undefined && value !== undefined) vars.set(name, expandVars(unquote(value), vars));
	}
	const expanded = expandVars(command, vars);
	const match = COMMAND.exec(expanded);
	if (!match) return null;
	const mode = match[1] ?? "";
	const tokens = [...(match[2] ?? "").matchAll(/"[^"]*"|'[^']*'|\S+/gu)].map((m) => unquote(m[0]));
	let outValue: string | undefined;
	let roundValue: string | undefined;
	let stillsOnly = false;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i] ?? "";
		if (token === "--stills-only") stillsOnly = true;
		else if (token === "--out") outValue = tokens[++i];
		else if (token.startsWith("--out=")) outValue = token.slice("--out=".length);
		else if (token === "--round") roundValue = tokens[++i];
		else if (token.startsWith("--round=")) roundValue = token.slice("--round=".length);
	}
	const base = workdirAfterCd(expanded.slice(0, match.index), workdir);
	const abs = (path: string | undefined): string | null => {
		if (path === undefined || path === "" || base === "") return null;
		if (path.includes("$") || path.includes("`")) return null;
		if (path.startsWith("~")) return join(homedir(), path.slice(1));
		return isAbsolute(path) ? resolve(path) : resolve(base, path);
	};
	// cover-gate judges a decoded file; it is not a render, so it never becomes the folder the gate checks.
	const out = mode === "cover-gate" ? null : abs(outValue);
	const round = roundValue === undefined || !/^\d+$/u.test(roundValue) ? null : Number(roundValue);
	return { mode, out, round, stillsOnly };
}

function responseText(response: unknown): string {
	if (typeof response === "string") return response;
	if (!isRecord(response)) return "";
	return [response["stdout"], response["stderr"], response["output"]].filter((p) => typeof p === "string").join("\n");
}

/** The run's exit: a numeric field the host sends, else an `exit <code>` line, else a blocked name the renderer printed. */
export function exitCodeOf(response: unknown): number | null {
	if (isRecord(response)) {
		const meta = isRecord(response["metadata"]) ? response["metadata"] : {};
		for (const value of [response["exit_code"], response["exitCode"], meta["exit_code"]])
			if (typeof value === "number" && Number.isInteger(value)) return value;
	}
	const text = responseText(response);
	const lines = [...text.matchAll(/^exit (\d+)\b/gmu)];
	const last = lines[lines.length - 1]?.[1];
	if (last !== undefined) return Number(last);
	const named = /^([A-Z][A-Z0-9_]+):/mu.exec(text)?.[1];
	return named !== undefined && named in EXIT_BY_NAME ? (EXIT_BY_NAME[named] ?? null) : null;
}

/** Record a finished shell call that ran `render.mjs`. Silent for anything else, and never throws. */
export function recordMotionTool(input: unknown, now = Date.now()): MotionTurn | null {
	try {
		if (!isRecord(input)) return null;
		const { session_id: sessionId, cwd, tool_name: tool, tool_input: toolInput } = input;
		if (typeof sessionId !== "string" || sessionId === "" || typeof cwd !== "string" || !isAbsolute(cwd)) return null;
		if (typeof tool !== "string" || !SHELL_TOOL.test(tool) || !isRecord(toolInput)) return null;
		const command = typeof toolInput["command"] === "string" ? toolInput["command"] : toolInput["cmd"];
		if (typeof command !== "string") return null;
		const parsed = parseMotionCommand(command, cwd);
		if (parsed === null) return null;
		const found = findMotionTurnRoot(cwd, sessionId);
		if (found === null || found === "bad") return null;
		const run: MotionRun = { ...parsed, exitCode: exitCodeOf(input["tool_response"]), at: now };
		const turn: MotionTurn = { ...found.turn, runs: [...found.turn.runs, run].slice(-MAX_RUNS) };
		return writeTurn(found.root, turn) ? turn : null;
	} catch {
		return null;
	}
}

const notDoneNotice = (reasons: readonly string[]): string =>
	`lit-typographic-motion: the film is not done (${reasons.join("; ")}). Stop rendering now and say in the reply, in plain words, that the film is not done and why, and what the user can run to finish it.`;

/**
 * The installed film skill's done-check, imported by absolute path. Null when the skill or its module is
 * missing (the gate cannot judge, so it fails open); a check that throws on a render folder it cannot read
 * is a not-complete verdict that names the cause.
 */
export const installedEvaluator: MotionEvaluator = async (outDir) => {
	let evaluate: ((dir: string) => MotionVerdict) | undefined;
	try {
		const module = resolve(dirname(resolveSkillPath("lit-typographic-motion")), "engine", "completion.mjs");
		if (!existsSync(module)) return null;
		const loaded = (await import(pathToFileURL(module).href)) as {
			evaluateCompletion?: (dir: string) => MotionVerdict;
		};
		evaluate = loaded.evaluateCompletion;
	} catch {
		return null;
	}
	if (typeof evaluate !== "function") return null;
	try {
		return evaluate(outDir);
	} catch (error) {
		const message = error instanceof Error ? error.message.split("\n")[0] : "unreadable render state";
		return { status: "not complete", reason: `the render state in ${outDir} could not be read (${message})` };
	}
};

export interface MotionStopInput {
	readonly cwd: string;
	readonly sessionId: string;
	readonly now?: number;
	readonly evaluate?: MotionEvaluator;
}

/** Decide whether the Stop event may end a film turn. Allows when there is no armed turn or this gate cannot judge. */
export async function evaluateMotionStop(input: MotionStopInput): Promise<MotionStopDecision> {
	const found = findMotionTurnRoot(input.cwd, input.sessionId);
	if (found === null) return { action: "allow", why: "not-a-motion-turn" };
	if (found === "bad") return { action: "allow", why: "unreadable-turn-state" };
	const { root, turn } = found;
	if (turn.notified) return { action: "allow", why: "notified" };
	const last = [...turn.runs].reverse().find((r) => r.out !== null) ?? null;
	let verdict: MotionVerdict;
	if (last === null) {
		verdict = { status: "not complete", reason: "no render command ran in this turn" };
	} else if (last.exitCode !== null && BLOCKED_EXITS.has(last.exitCode)) {
		verdict = {
			status: "BLOCKED",
			reason: `the render is BLOCKED (exit ${last.exitCode}); report the blocked state and its fix command`,
		};
	} else {
		const judged = await (input.evaluate ?? installedEvaluator)(last.out ?? "");
		if (judged === null) return { action: "allow", why: "done-check-unavailable" };
		verdict = judged;
	}
	if (verdict.status === "complete" || verdict.status === "DONE_UNVIEWED") {
		const say = [
			...(verdict.status === "DONE_UNVIEWED" ? [verdict.reason] : []),
			...(verdict.labels ?? []),
			...(verdict.downgraded ?? []).map((d) => `downgraded: ${d}`),
			...(verdict.openItems ?? []).map((o) => `open item: ${o}`),
		];
		if (say.length === 0) return { action: "allow", why: "done" };
		writeTurn(root, { ...turn, notified: true });
		return {
			action: "block",
			why: verdict.status,
			reason: `lit-typographic-motion: the film is finished. The reply must say plainly: ${say.join("; ")}.`,
		};
	}
	if (verdict.status === "BLOCKED" || turn.blockCount >= MOTION_MAX_BLOCKS) {
		writeTurn(root, { ...turn, notified: true, warned: true });
		return { action: "block", why: "not-done-notice", reason: notDoneNotice([verdict.reason]) };
	}
	writeTurn(root, { ...turn, blockCount: turn.blockCount + 1 });
	return {
		action: "block",
		why: "not-done",
		reason: `lit-typographic-motion is not done: ${verdict.reason}. Finish the loop in references/look.md: render, open every listed still, record the look round, and render again when the gate or a look answer asks for it. \`render.mjs completion --out <dir>\` prints this verdict.`,
	};
}
