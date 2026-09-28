import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Exclusive lock built on mkdir, which is atomic on every filesystem team state
// can live on. The owner token guards against releasing a lock that a stale-lock
// takeover already handed to someone else.

export class OwnerLockError extends Error {
	constructor(message, exitCode = 75) {
		super(message);
		this.name = "OwnerLockError";
		this.exitCode = exitCode;
	}
}

const OWNER_FILE = "owner";

function readOwner(lockDir) {
	try {
		return readFileSync(join(lockDir, OWNER_FILE), "utf8").trim();
	} catch {
		return null;
	}
}

function lockAgeMs(lockDir) {
	try {
		return Date.now() - statSync(lockDir).mtimeMs;
	} catch {
		return 0;
	}
}

export function acquireOwnerLock(lockDir, { timeoutMs = 5000, staleMs = 30_000 } = {}) {
	const owner = randomUUID();
	const deadline = Date.now() + timeoutMs;

	// `init` runs before the team directory exists, so the parent is created
	// separately; only the lock directory itself needs the atomic create.
	mkdirSync(dirname(lockDir), { recursive: true, mode: 0o700 });

	while (true) {
		try {
			mkdirSync(lockDir, { recursive: false, mode: 0o700 });
			writeFileSync(join(lockDir, OWNER_FILE), owner, { encoding: "utf8", mode: 0o600 });
			return owner;
		} catch (error) {
			if (error?.code !== "EEXIST") throw new OwnerLockError(`team state lock failed: ${error?.message ?? error}`);
		}

		// A crashed holder leaves the directory behind; reclaim it once it is provably stale.
		if (lockAgeMs(lockDir) > staleMs) {
			rmSync(lockDir, { recursive: true, force: true });
			continue;
		}

		if (Date.now() >= deadline) {
			throw new OwnerLockError(`team state is locked by another process (waited ${timeoutMs}ms)`);
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
	}
}

export function releaseOwnerLock(lockDir, owner) {
	const held = readOwner(lockDir);
	// `delete` removes the whole team directory, taking the lock with it; a lock
	// that is already gone is released, not a failure.
	if (held === null) return true;
	if (held !== owner) return false;
	rmSync(lockDir, { recursive: true, force: true });
	return true;
}

export async function withOwnerLock(lockDir, fn, options) {
	const owner = acquireOwnerLock(lockDir, options);
	try {
		return await fn();
	} finally {
		if (!releaseOwnerLock(lockDir, owner)) throw new OwnerLockError("team state lock release failed");
	}
}
