// src/statusline.ts — `litcodex statusline`: the LIT status as one line, for a host status line command.
//
// Codex 0.163.0 has no command-backed status line yet; this prints the line such a command would show, in
// the shape Claude-compatible status line hosts use: optional JSON on stdin naming `session_id` and `cwd`
// (or `workspace.current_dir`), one line on stdout, the width from `COLUMNS`. It picks that session's LIT
// records, else the newest LIT session in the same folder, else the newest LIT session, the way
// `litcodex hud` does (hud.ts), and reads the same card (card-status.ts) without opening a Codex rollout.
// Stdin is capped at 64 KiB and read for at most 200 ms. Nothing is written but the line; any problem
// prints an empty line, and the exit code is always 0.

import { type CardStatus, clock } from "./card-status.js";
import { cleanStatus, fit, listSessions, readHud } from "./hud.js";
import { stageText } from "./screen-card.js";

const MAX_STDIN_BYTES = 64 * 1024;
const STDIN_BUDGET_MS = 200;
const DEFAULT_WIDTH = 120;
const ACCENT = "\u001b[38;2;255;155;94m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

export interface StatuslineIo {
	readonly stdin: NodeJS.ReadableStream & { readonly isTTY?: boolean };
	readonly stdout: { write(text: string): unknown };
	readonly env: NodeJS.ProcessEnv;
	readonly now?: () => number;
}

interface HostInput {
	readonly sessionId: string | null;
	readonly cwd: string | null;
}

const NO_INPUT: HostInput = { sessionId: null, cwd: null };

/** Whatever arrives within the budget and the cap; null when the cap is passed. */
function readInput(stdin: StatuslineIo["stdin"]): Promise<string | null> {
	if (stdin.isTTY === true) return Promise.resolve("");
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let settled = false;
		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stdin.removeListener("data", onData);
			stdin.pause();
			resolve(value);
		};
		const onData = (chunk: Buffer | string): void => {
			const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			total += buffer.length;
			if (total > MAX_STDIN_BYTES) finish(null);
			else chunks.push(buffer);
		};
		const timer = setTimeout(() => finish(Buffer.concat(chunks).toString("utf8")), STDIN_BUDGET_MS);
		stdin.on("data", onData);
		stdin.once("end", () => finish(Buffer.concat(chunks).toString("utf8")));
		stdin.once("error", () => finish(null));
	});
}

function parseInput(raw: string | null): HostInput {
	if (raw === null || raw.trim() === "") return NO_INPUT;
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return NO_INPUT;
		const record = value as Record<string, unknown>;
		const workspace = record["workspace"];
		const current =
			typeof workspace === "object" && workspace !== null
				? (workspace as Record<string, unknown>)["current_dir"]
				: undefined;
		const cwd = typeof current === "string" ? current : typeof record["cwd"] === "string" ? record["cwd"] : null;
		const sessionId = typeof record["session_id"] === "string" ? record["session_id"] : null;
		return { sessionId: sessionId === "" ? null : sessionId, cwd: cwd === "" ? null : cwd };
	} catch {
		return NO_INPUT;
	}
}

/** The session the line is about: the named one when LIT knows it, else the newest one in `cwd`, else null (newest). */
function wantedSession(env: NodeJS.ProcessEnv, input: HostInput): string | null {
	const sessions = listSessions(env);
	if (input.sessionId !== null && sessions.some((session) => session.id === input.sessionId)) return input.sessionId;
	return sessions.find((session) => input.cwd !== null && session.cwd === input.cwd)?.id ?? null;
}

/** The one line, coloured on request and cut to `width` cells; "" when there is no LIT turn to show. */
export function statuslineText(status: CardStatus | null, options: { width: number; color: boolean }): string {
	if (status === null || status.state === "ready") return "";
	const card = cleanStatus(status);
	const route = `🔥 LIT · ${card.mode ?? "lit"}${card.state === "complete" ? " ✓" : ""}`;
	const parts = [card.map === null ? null : card.map.cells.map(stageText).join(" › ")];
	if (card.step !== null) parts.push(`⠹ ${card.step.tool} ${clock(card.now - card.step.startedAt)}`);
	const rest = parts.filter((part): part is string => part !== null && part !== "").join("  ");
	const line = fit(rest === "" ? route : `${route}  ${rest}`, Math.max(10, options.width));
	if (!options.color) return line;
	return line.startsWith(route)
		? `${BOLD}${ACCENT}${route}${RESET}${DIM}${line.slice(route.length)}${RESET}`
		: `${BOLD}${ACCENT}${line}${RESET}`;
}

export async function statuslineCommand(_args: readonly string[], io: StatuslineIo): Promise<number> {
	try {
		const input = parseInput(await readInput(io.stdin));
		const now = (io.now ?? Date.now)();
		const view = readHud(io.env, wantedSession(io.env, input), now);
		const columns = Number.parseInt(io.env["COLUMNS"] ?? "", 10);
		const noColor = io.env["NO_COLOR"];
		const line = statuslineText(view.status, {
			width: Number.isFinite(columns) && columns > 0 ? columns : DEFAULT_WIDTH,
			color: noColor === undefined || noColor === "",
		});
		io.stdout.write(`${line}\n`);
	} catch {
		io.stdout.write("\n");
	}
	return 0;
}
