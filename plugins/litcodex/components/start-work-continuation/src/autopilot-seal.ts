import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import type { Snapshot } from "./autopilot-store.js";

/**
 * The autopilot's seals: what the hooks recorded for a run, kept outside the workspace under
 * `<CODEX_HOME>/litcodex/start-work-seals/`. Codex's workspace sandbox does not cover the Codex home and the start-work
 * guard refuses shell writes there, so the model cannot rewrite a seal the way it could rewrite the run state in the
 * project. Each seal holds the digest of the parked list the user was last shown, the digest of the typed start-work
 * consent, and the Done-when line as the run first saw it. Only the hook process's own environment picks the folder.
 * A missing or unreadable seal never passes a check that needs it.
 */
export interface SealRecord {
	readonly snapshot?: { readonly list_id: string; readonly digest: string };
	readonly consent?: string;
	readonly check?: { readonly line: string | null };
	/** Digests of the commands `lit deny` refused, kept here too so a corrupt run state cannot drop them. */
	readonly refused?: readonly string[];
}

interface SealFile {
	readonly version: 1;
	readonly records: Readonly<Record<string, SealRecord>>;
}

function sealPath(root: string): string | null {
	const configured = process.env["CODEX_HOME"]?.trim() ?? "";
	const home = process.env["HOME"]?.trim() ?? "";
	const codexHome =
		configured !== "" && isAbsolute(configured) ? configured : isAbsolute(home) ? join(home, ".codex") : null;
	if (codexHome === null) return null;
	const key = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 32);
	return join(codexHome, "litcodex", "start-work-seals", `${key}.json`);
}

function readFile(root: string): SealFile {
	const path = sealPath(root);
	if (path === null) return { version: 1, records: {} };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed !== "object" || parsed === null) return { version: 1, records: {} };
		const records = (parsed as { records?: unknown }).records;
		if (typeof records !== "object" || records === null) return { version: 1, records: {} };
		return { version: 1, records: records as Record<string, SealRecord> };
	} catch {
		return { version: 1, records: {} };
	}
}

export function readSeal(root: string, key: string): SealRecord {
	return readFile(root).records[key] ?? {};
}

/** Change one record by temp file and rename. False when the seal could not be written. */
export function writeSeal(root: string, key: string, change: (record: SealRecord) => SealRecord): boolean {
	const path = sealPath(root);
	if (path === null) return false;
	try {
		const dir = join(path, "..");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const file = readFile(root);
		const next: SealFile = { version: 1, records: { ...file.records, [key]: change(file.records[key] ?? {}) } };
		const temp = join(dir, `.${randomUUID()}.tmp`);
		writeFileSync(temp, `${JSON.stringify(next)}\n`, { flag: "wx", mode: 0o600 });
		renameSync(temp, path);
		return true;
	} catch {
		return false;
	}
}

/** The short digest the inbox shows for a parked list: its id and every step's id, command, folder and tier. */
export function snapshotDigest(snapshot: Snapshot): string {
	const body = JSON.stringify([
		snapshot.list_id,
		snapshot.steps.map((step) => [step.id, step.command, step.cwd, step.tier]),
	]);
	return createHash("sha256").update(body).digest("hex").slice(0, 12);
}

export function sealSnapshot(root: string, workId: string, snapshot: Snapshot): void {
	writeSeal(root, `work:${workId}`, (record) => ({
		...record,
		snapshot: { list_id: snapshot.list_id, digest: snapshotDigest(snapshot) },
	}));
}

/** True when `snapshot` is exactly the list the hook sealed for this work. */
export function snapshotSealed(root: string, workId: string, snapshot: Snapshot): boolean {
	const sealed = readSeal(root, `work:${workId}`).snapshot;
	return sealed !== undefined && sealed.list_id === snapshot.list_id && sealed.digest === snapshotDigest(snapshot);
}

export function consentDigest(plans: Readonly<Record<string, string>>, at: string): string {
	const sorted = Object.keys(plans)
		.sort()
		.map((plan) => [plan, plans[plan]]);
	return createHash("sha256")
		.update(JSON.stringify([sorted, at]))
		.digest("hex");
}

function refusalDigest(command: string, cwd: string): string {
	return createHash("sha256").update(`${cwd}\0${command}`).digest("hex").slice(0, 32);
}

/** Remember the commands `lit deny` refused for this work (the newest 256). */
export function sealRefusals(root: string, workId: string, steps: readonly { command: string; cwd: string }[]): void {
	if (steps.length === 0) return;
	writeSeal(root, `work:${workId}`, (record) => ({
		...record,
		refused: [...(record.refused ?? []), ...steps.map((step) => refusalDigest(step.command, step.cwd))].slice(-256),
	}));
}

export function refusalSealed(root: string, workId: string, command: string, cwd: string): boolean {
	const refused = readSeal(root, `work:${workId}`).refused;
	return Array.isArray(refused) && refused.includes(refusalDigest(command, cwd));
}

/** The seal key of one session's Done-when line for one plan. */
export function checkKey(sessionId: string, plan: string): string {
	return `check:codex:${sessionId}:${plan}`;
}

/**
 * The Done-when line bound to this session and plan: the one a typed start-work saw, else the one the first turn-end
 * saw, pinned then. `undefined` when no seal can be kept.
 */
export function pinnedCheck(root: string, key: string, line: string | null): string | null | undefined {
	const sealed = readSeal(root, key).check;
	if (sealed !== undefined) return sealed.line;
	return pinCheck(root, key, line) ? line : undefined;
}

/** Bind the Done-when line as it stands now (a typed start-work rebinds it). */
export function pinCheck(root: string, key: string, line: string | null): boolean {
	return writeSeal(root, key, (record) => ({ ...record, check: { line } }));
}
