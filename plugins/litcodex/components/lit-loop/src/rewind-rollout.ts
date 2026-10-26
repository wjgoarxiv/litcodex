// src/rewind-rollout.ts — reads Codex session records (rollout JSONL files) for the lit-adhd brief.
//
// Only Codex's own records under `<codex home>/sessions` are read, and only a bounded window of each: the
// head (where the session meta and the first request sit) and the tail (where the latest turn sits), both
// under one byte budget for the whole run. A symlink, a named pipe or a file that is not a regular file is
// refused before it is opened; a subagent's records are skipped. The format is private to Codex, so every
// field is read tolerantly and anything unreadable becomes "unknown" rather than an error.

import { closeSync, fstatSync, lstatSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import { openRegularFile } from "./live-step.js";

export const HEAD_BYTES = 256 * 1024;
export const TAIL_BYTES = 256 * 1024;
export const TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 3000;
const MAX_DEPTH = 4;
const ROLLOUT_NAME = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/u;
/** User messages Codex itself inserts: they are context, not something the user typed. */
const INJECTED =
	/^\s*(?:<environment_context>|<user_instructions>|<INSTRUCTIONS>|# AGENTS\.md|<turn_aborted>|<skill>|<user_shell_command>)/u;

export interface RolloutFile {
	readonly path: string;
	readonly id: string;
	readonly mtimeMs: number;
	readonly size: number;
}

export type LastEvent = "user" | "agent" | "complete" | "tool" | "aborted" | null;

export interface RolloutFacts {
	readonly id: string;
	readonly cwd: string | null;
	readonly startedAt: number | null;
	readonly lastAt: number | null;
	readonly firstUser: string | null;
	readonly lastUser: string | null;
	readonly lastAgent: string | null;
	readonly last: LastEvent;
	readonly subagent: boolean;
	/** Tool calls seen in the window read; a floor, not a total, when `stepsPartial`. */
	readonly steps: number;
	readonly stepsPartial: boolean;
	/** Name of the last tool the session called, as Codex records it. */
	readonly lastTool: string | null;
	/** What that last call was about, in a word or two: a patched file's base name or the program a shell call ran. */
	readonly lastTarget: string | null;
	/** Tool names with the number of calls seen in the window read, most used first. */
	readonly tools: readonly (readonly [string, number])[];
	/** Base names of the files `apply_patch` touched in the window read, in order, without repeats. */
	readonly edited: readonly string[];
}

/** A byte allowance shared by every read of one run. */
export interface ByteBudget {
	remaining: number;
	exhausted: boolean;
}

export function newBudget(total = TOTAL_BYTES): ByteBudget {
	return { remaining: total, exhausted: false };
}

/** Rollout files under `<home>/sessions`, newest first. Symlinks, other file types and deep trees are skipped. */
export function listRollouts(codexHome: string): RolloutFile[] {
	const found: RolloutFile[] = [];
	const walk = (dir: string, depth: number): void => {
		if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			return;
		}
		for (const name of names) {
			if (found.length >= MAX_FILES) return;
			const path = join(dir, name);
			try {
				const stat = lstatSync(path);
				if (stat.isSymbolicLink()) continue;
				if (stat.isDirectory()) walk(path, depth + 1);
				else if (stat.isFile()) {
					const match = ROLLOUT_NAME.exec(name);
					if (match?.[1] !== undefined) found.push({ path, id: match[1], mtimeMs: stat.mtimeMs, size: stat.size });
				}
			} catch {
				// A file that vanished or cannot be inspected is left out.
			}
		}
	};
	walk(join(codexHome, "sessions"), 0);
	return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Read `length` bytes at `offset` from an open file, charging the budget; null when the budget cannot cover it. */
function readSlice(fd: number, offset: number, length: number, budget: ByteBudget): string | null {
	if (length <= 0) return "";
	if (length > budget.remaining) {
		budget.exhausted = true;
		return null;
	}
	const buffer = Buffer.alloc(length);
	let filled = 0;
	while (filled < length) {
		const read = readSync(fd, buffer, filled, length - filled, offset + filled);
		if (read <= 0) break;
		filled += read;
	}
	budget.remaining -= filled;
	return buffer.subarray(0, filled).toString("utf8");
}

interface Window {
	readonly head: string;
	/** The tail when the file is longer than the head; null when the head already covers it. */
	readonly tail: string | null;
	readonly headCut: boolean;
}

function readWindow(file: RolloutFile, budget: ByteBudget): Window | null {
	const fd = openRegularFile(file.path);
	if (fd === null) return null;
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile()) return null;
		const headLength = Math.min(stat.size, HEAD_BYTES);
		const head = readSlice(fd, 0, headLength, budget);
		if (head === null) return null;
		if (stat.size <= HEAD_BYTES) return { head, tail: null, headCut: false };
		const tailStart = Math.max(HEAD_BYTES, stat.size - TAIL_BYTES);
		const tail = readSlice(fd, tailStart, stat.size - tailStart, budget);
		return { head, tail: tail ?? "", headCut: true };
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whole JSON lines of a chunk; a line the chunk cut off at either end is dropped. */
function wholeLines(text: string, dropFirst: boolean, dropLast: boolean): Record<string, unknown>[] {
	const lines = text.split("\n");
	if (dropLast) lines.pop();
	if (dropFirst) lines.shift();
	const out: Record<string, unknown>[] = [];
	for (const line of lines) {
		if (line.trim() === "") continue;
		try {
			const record: unknown = JSON.parse(line);
			if (isRecord(record)) out.push(record);
		} catch {
			// A damaged line is skipped.
		}
	}
	return out;
}

function textOf(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return null;
	const parts = content
		.filter(isRecord)
		.map((item) => (typeof item["text"] === "string" ? item["text"] : ""))
		.filter((part) => part !== "");
	return parts.length === 0 ? null : parts.join("\n");
}

const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu;
const SAFE_PROGRAM = /^[\w.+-]{1,24}$/u;

/** Base name of a path, or null when it holds anything but plain file-name characters. */
function baseName(path: string): string | null {
	const name = path.trim().split(/[\\/]/u).at(-1) ?? "";
	return /^[^\s\u0000-\u001f]{1,60}$/u.test(name) ? name : null;
}

/** The text of a call's input: custom tools carry a string, function calls a JSON string of arguments. */
function callInput(payload: Record<string, unknown>): string {
	const raw = payload["input"] ?? payload["arguments"];
	return typeof raw === "string" ? raw : "";
}

/** The program a shell call starts, never its arguments: `npx` for `["npx","vitest"]` or `cmd: "git status"`. */
function programOf(payload: Record<string, unknown>): string | null {
	let args: unknown;
	try {
		args = JSON.parse(callInput(payload));
	} catch {
		return null;
	}
	if (!isRecord(args)) return null;
	let first: string | undefined;
	if (typeof args["cmd"] === "string") first = args["cmd"].trim().split(/\s+/u)[0];
	else if (Array.isArray(args["command"])) {
		const parts = args["command"].filter((part): part is string => typeof part === "string");
		const wrapped = /^(?:ba|z)?sh$/u.test(baseName(parts[0] ?? "") ?? "") && /^-l?c$/u.test(parts[1] ?? "");
		first = wrapped ? parts[2]?.trim().split(/\s+/u)[0] : parts[0];
	}
	const name = first === undefined ? null : baseName(first);
	return name !== null && SAFE_PROGRAM.test(name) ? name : null;
}

function stamp(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
}

/** Facts from the head and tail records of one rollout. */
export function parseRollout(
	fileId: string,
	window: { head: string; tail: string | null; headCut: boolean },
): RolloutFacts {
	const headRecords = wholeLines(window.head, false, window.headCut || window.tail !== null);
	const tailRecords = window.tail === null ? [] : wholeLines(window.tail, true, false);
	let id = fileId;
	let cwd: string | null = null;
	let startedAt: number | null = null;
	let subagent = false;
	let firstUser: string | null = null;
	let lastUser: string | null = null;
	let lastAgent: string | null = null;
	let last: LastEvent = null;
	let lastAt: number | null = null;
	let steps = 0;
	let lastTool: string | null = null;
	let lastTarget: string | null = null;
	const toolCount = new Map<string, number>();
	const edited: string[] = [];
	const meta = headRecords.find((record) => record["type"] === "session_meta");
	if (meta !== undefined && isRecord(meta["payload"])) {
		const payload = meta["payload"];
		if (typeof payload["id"] === "string" && payload["id"] !== "") id = payload["id"];
		if (typeof payload["cwd"] === "string" && payload["cwd"] !== "") cwd = payload["cwd"];
		startedAt = stamp(payload["timestamp"]) ?? stamp(meta["timestamp"]);
		subagent = isRecord(payload["source"]) && "subagent" in payload["source"];
	}
	const visit = (record: Record<string, unknown>, first: boolean): void => {
		const payload = isRecord(record["payload"]) ? record["payload"] : null;
		if (payload === null) return;
		const at = stamp(record["timestamp"]);
		if (at !== null) lastAt = Math.max(lastAt ?? at, at);
		let user: string | null = null;
		if (record["type"] === "event_msg") {
			if (payload["type"] === "user_message" && typeof payload["message"] === "string") user = payload["message"];
			else if (payload["type"] === "agent_message" && typeof payload["message"] === "string") {
				lastAgent = payload["message"];
				last = "agent";
			} else if (payload["type"] === "task_complete") {
				if (typeof payload["last_agent_message"] === "string") lastAgent = payload["last_agent_message"];
				last = "complete";
			} else if (payload["type"] === "turn_aborted") last = "aborted";
		} else if (record["type"] === "response_item") {
			if (payload["type"] === "message") {
				const text = textOf(payload["content"]);
				if (payload["role"] === "user" && text !== null && !INJECTED.test(text)) user = text;
				else if (payload["role"] === "assistant" && text !== null) {
					lastAgent = text;
					last = "agent";
				}
			} else if (
				payload["type"] === "function_call" ||
				payload["type"] === "custom_tool_call" ||
				payload["type"] === "local_shell_call"
			) {
				last = "tool";
				steps += 1;
				const name = payload["type"] === "local_shell_call" ? "shell" : payload["name"];
				if (typeof name === "string" && /^[\w.:-]{1,48}$/u.test(name)) {
					lastTool = name;
					toolCount.set(name, (toolCount.get(name) ?? 0) + 1);
				}
				const patched = [...callInput(payload).replaceAll("\\n", "\n").matchAll(PATCH_FILE)]
					.map((match) => baseName(match[1] ?? ""))
					.filter((file): file is string => file !== null);
				for (const file of patched) if (!edited.includes(file)) edited.push(file);
				lastTarget = patched.at(-1) ?? programOf(payload);
			}
		}
		if (user !== null && !INJECTED.test(user)) {
			if (first && firstUser === null) firstUser = user;
			lastUser = user;
			last = "user";
		}
	};
	for (const record of headRecords) visit(record, true);
	for (const record of tailRecords) visit(record, false);
	return {
		id,
		cwd,
		startedAt,
		lastAt,
		firstUser,
		lastUser,
		lastAgent,
		last,
		subagent,
		steps,
		stepsPartial: window.tail !== null,
		lastTool,
		lastTarget,
		tools: [...toolCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
		edited,
	};
}

/** Facts for one rollout, or null when it cannot be read (refused type, budget spent, unreadable). */
export function readRollout(file: RolloutFile, budget: ByteBudget): RolloutFacts | null {
	const window = readWindow(file, budget);
	return window === null ? null : parseRollout(file.id, window);
}
