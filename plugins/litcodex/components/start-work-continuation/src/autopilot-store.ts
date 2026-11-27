import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { Tier } from "./shell-tier.js";

/**
 * The autopilot's own small state beside the lifecycle state: parked commands, the inbox snapshot, the block budget
 * per plan state, the paused flag, a stored check timeout and the typed start-work consents that bind a
 * `Run charter:`. The lifecycle store stays the authority for a run's status; this file only remembers what the
 * guard parked and what the user was shown. Only the hooks write it, under its own lock, by atomic rename.
 */
export const MAX_B_STEPS = 32;
export const MAX_X_STEPS = 16;
export const MAX_REFUSED = 64;
const MAX_FILE_BYTES = 512_000;
const LOCK_STALE_MS = 10_000;
const LOCK_ATTEMPTS = 40;

export interface ParkedStep {
	readonly id: string;
	readonly command: string;
	readonly cwd: string;
	readonly tier: Tier;
	readonly held: string | null;
	readonly outward: boolean;
	/** The next open row when it was parked, or null when every row was ticked. */
	readonly row: string | null;
	readonly parked_at: string;
	readonly asked: number;
	readonly last_result?: string;
}

export interface SnapshotStep {
	readonly id: string;
	readonly command: string;
	readonly cwd: string;
	readonly tier: Tier;
}

export interface Snapshot {
	readonly list_id: string;
	readonly steps: readonly SnapshotStep[];
}

export interface Budget {
	readonly state: string;
	readonly blocks: number;
	readonly inbox: boolean;
	readonly turn: string | null;
	readonly last: string;
	/** sha256 of the plan text at the last spend, so the LIT card line can tell an unchanged plan without the state digest. */
	readonly plan?: string;
}

export interface WorkAutopilot {
	readonly session: string;
	readonly steps: readonly ParkedStep[];
	readonly refused: readonly { readonly command: string; readonly cwd: string }[];
	readonly snapshot: Snapshot | null;
	readonly budget: Budget | null;
	readonly paused: boolean;
	readonly check: { readonly state: string; readonly turn: string; readonly outcome: "timeout" } | null;
	readonly overflow: number;
	/** Rows whose parked step an approved replay ran; the Stop driver tells the model to clear their BLOCKED line. */
	readonly released?: readonly { readonly row: string; readonly command: string }[];
}

export interface Consent {
	readonly plans: Readonly<Record<string, string>>;
	readonly at: string;
}

export interface AutopilotFile {
	readonly version: 1;
	readonly works: Readonly<Record<string, WorkAutopilot>>;
	readonly consents: Readonly<Record<string, Consent>>;
}

const EMPTY: AutopilotFile = { version: 1, works: {}, consents: {} };

export function autopilotPathFor(root: string): string {
	return join(root, ".litcodex", "start-work", "autopilot.json");
}

export function emptyWork(session: string): WorkAutopilot {
	return { session, steps: [], refused: [], snapshot: null, budget: null, paused: false, check: null, overflow: 0 };
}

/** The file as stored, or an empty one when it is missing, too large, a link or unreadable. */
export function readAutopilot(root: string): AutopilotFile {
	const path = autopilotPathFor(root);
	const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	let fd: number | undefined;
	try {
		if (lstatSync(path).isSymbolicLink()) return EMPTY;
		fd = openSync(path, constants.O_RDONLY | noFollow);
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return EMPTY;
		const buffer = Buffer.alloc(stat.size);
		const read = readSync(fd, buffer, 0, stat.size, 0);
		return normalize(JSON.parse(buffer.subarray(0, read).toString("utf8")));
	} catch {
		return EMPTY;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function workOf(file: AutopilotFile, workId: string, session: string): WorkAutopilot {
	return file.works[workId] ?? emptyWork(session);
}

/** Read, change and write the file under its lock. `change` returns the next file, or null to write nothing. */
export function updateAutopilot<T>(
	root: string,
	change: (file: AutopilotFile) => { readonly next: AutopilotFile | null; readonly result: T },
): T {
	const dir = join(root, ".litcodex", "start-work");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const lock = `${autopilotPathFor(root)}.lock`;
	acquire(lock);
	try {
		const { next, result } = change(readAutopilot(root));
		if (next !== null) {
			const body = `${JSON.stringify(next)}\n`;
			if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw new Error("autopilot state would exceed its size cap");
			const temp = `${autopilotPathFor(root)}.${randomUUID()}.tmp`;
			writeFileSync(temp, body, { mode: 0o600, flag: "wx" });
			renameSync(temp, autopilotPathFor(root));
		}
		return result;
	} finally {
		rmSync(lock, { force: true });
	}
}

export function withWork(file: AutopilotFile, workId: string, work: WorkAutopilot): AutopilotFile {
	return { ...file, works: { ...file.works, [workId]: work } };
}

/** Park `step`, or count one more ask when the same command in the same folder is already parked. */
export function parkStep(
	work: WorkAutopilot,
	step: Omit<ParkedStep, "id" | "asked" | "parked_at">,
	at: string,
): { readonly work: WorkAutopilot; readonly outcome: "parked" | "again" | "full"; readonly asked: number } {
	const same = work.steps.find((item) => item.command === step.command && item.cwd === step.cwd);
	if (same !== undefined) {
		const asked = same.asked + 1;
		return {
			work: { ...work, steps: work.steps.map((item) => (item === same ? { ...item, asked } : item)) },
			outcome: "again",
			asked,
		};
	}
	const count = work.steps.filter((item) => item.tier === step.tier).length;
	if (count >= (step.tier === "B" ? MAX_B_STEPS : MAX_X_STEPS)) {
		return { work: { ...work, overflow: work.overflow + 1 }, outcome: "full", asked: 1 };
	}
	const id = `p-${createHash("sha256").update(`${step.cwd}\0${step.command}\0${at}`).digest("hex").slice(0, 12)}`;
	return {
		work: { ...work, steps: [...work.steps, { ...step, id, asked: 1, parked_at: at }] },
		outcome: "parked",
		asked: 1,
	};
}

function acquire(lock: string): void {
	for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
		try {
			const fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
			closeSync(fd);
			return;
		} catch (error) {
			if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { force: true });
			} catch {
				// The holder just released it.
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
		}
	}
	throw new Error("autopilot state lock is busy");
}

function normalize(value: unknown): AutopilotFile {
	if (!isRecord(value) || value["version"] !== 1) return EMPTY;
	const works: Record<string, WorkAutopilot> = {};
	if (isRecord(value["works"])) {
		for (const [id, raw] of Object.entries(value["works"])) {
			const work = normalizeWork(raw);
			if (work !== null) works[id] = work;
		}
	}
	const consents: Record<string, Consent> = {};
	if (isRecord(value["consents"])) {
		for (const [session, raw] of Object.entries(value["consents"])) {
			if (!isRecord(raw) || !isRecord(raw["plans"]) || typeof raw["at"] !== "string") continue;
			const plans: Record<string, string> = {};
			for (const [plan, digest] of Object.entries(raw["plans"]))
				if (typeof digest === "string") plans[plan] = digest;
			consents[session] = { plans, at: raw["at"] };
		}
	}
	return { version: 1, works, consents };
}

function normalizeWork(value: unknown): WorkAutopilot | null {
	if (!isRecord(value) || typeof value["session"] !== "string") return null;
	const steps = Array.isArray(value["steps"]) ? value["steps"].filter(isStep) : [];
	const refused = Array.isArray(value["refused"])
		? value["refused"].filter(
				(item): item is { command: string; cwd: string } =>
					isRecord(item) && typeof item["command"] === "string" && typeof item["cwd"] === "string",
			)
		: [];
	const snapshot = isSnapshot(value["snapshot"]) ? value["snapshot"] : null;
	const budget = isBudget(value["budget"]) ? value["budget"] : null;
	const check =
		isRecord(value["check"]) &&
		typeof value["check"]["state"] === "string" &&
		typeof value["check"]["turn"] === "string" &&
		value["check"]["outcome"] === "timeout"
			? { state: value["check"]["state"], turn: value["check"]["turn"], outcome: "timeout" as const }
			: null;
	return {
		session: value["session"],
		steps,
		refused,
		snapshot,
		budget,
		paused: value["paused"] === true,
		check,
		overflow: typeof value["overflow"] === "number" ? value["overflow"] : 0,
		released: Array.isArray(value["released"])
			? value["released"]
					.filter(
						(item): item is { row: string; command: string } =>
							isRecord(item) && typeof item["row"] === "string" && typeof item["command"] === "string",
					)
					.slice(0, 32)
			: [],
	};
}

function isStep(value: unknown): value is ParkedStep {
	return (
		isRecord(value) &&
		typeof value["id"] === "string" &&
		typeof value["command"] === "string" &&
		typeof value["cwd"] === "string" &&
		(value["tier"] === "B" || value["tier"] === "X") &&
		(value["held"] === null || typeof value["held"] === "string") &&
		typeof value["outward"] === "boolean" &&
		(value["row"] === null || typeof value["row"] === "string") &&
		typeof value["parked_at"] === "string" &&
		typeof value["asked"] === "number"
	);
}

function isSnapshot(value: unknown): value is Snapshot {
	return (
		isRecord(value) &&
		typeof value["list_id"] === "string" &&
		Array.isArray(value["steps"]) &&
		value["steps"].every(
			(step) =>
				isRecord(step) &&
				typeof step["id"] === "string" &&
				typeof step["command"] === "string" &&
				typeof step["cwd"] === "string" &&
				(step["tier"] === "B" || step["tier"] === "X"),
		)
	);
}

function isBudget(value: unknown): value is Budget {
	return (
		isRecord(value) &&
		typeof value["state"] === "string" &&
		typeof value["blocks"] === "number" &&
		typeof value["inbox"] === "boolean" &&
		(value["turn"] === null || typeof value["turn"] === "string") &&
		typeof value["last"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
