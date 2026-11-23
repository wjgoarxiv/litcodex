import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export const SESSION_STATE_LOCK_CONTENDED = Symbol("session-state-lock-contended");

export type SessionStateLockResult<T> = T | typeof SESSION_STATE_LOCK_CONTENDED;

const LOCK_RETRY_COUNT = 20;
const LOCK_RETRY_DELAY_MS = 5;
/** A holder keeps the lock for milliseconds; one this old was left by a process that died holding it. */
const LOCK_STALE_MS = 30_000;
const LOCK_SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));

export function withSessionStateLock<T>(cachePath: string, callback: () => T): SessionStateLockResult<T> {
	const lockPath = `${cachePath}.lock`;
	mkdirSync(dirname(cachePath), { recursive: true });
	for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
		try {
			mkdirSync(lockPath);
			try {
				return callback();
			} finally {
				rmSync(lockPath, { recursive: true, force: true });
			}
		} catch (error) {
			if (errorCode(error) === "EEXIST") {
				if (!reclaimStaleLock(lockPath)) sleepSync(LOCK_RETRY_DELAY_MS);
				continue;
			}
			throw error;
		}
	}
	return SESSION_STATE_LOCK_CONTENDED;
}

/** Move a stale lock directory aside and remove it; false when it is fresh or another process got there first. */
function reclaimStaleLock(lockPath: string): boolean {
	try {
		const observed = lstatSync(lockPath);
		const age = Date.now() - observed.mtimeMs;
		if (!observed.isDirectory() || age < 0 || age <= LOCK_STALE_MS) return false;
		const current = lstatSync(lockPath);
		if (current.ino !== observed.ino || current.dev !== observed.dev) return false;
		const tombstone = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
		renameSync(lockPath, tombstone);
		rmSync(tombstone, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

function errorCode(error: unknown): unknown {
	if (!isRecord(error)) {
		return undefined;
	}
	return Reflect.get(error, "code");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleepSync(milliseconds: number): void {
	Atomics.wait(LOCK_SLEEP_VIEW, 0, 0, milliseconds);
}
