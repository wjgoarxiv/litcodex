import { type BigIntStats, closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

export interface StableReadFileSystem {
	readonly noFollowFlag: number;
	readonly nonBlockFlag: number;
	lstat(path: string): BigIntStats;
	open(path: string, flags: number): number;
	fstat(descriptor: number): BigIntStats;
	read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number): number;
	close(descriptor: number): void;
}

export const NODE_STABLE_READ_FS: StableReadFileSystem = Object.freeze({
	noFollowFlag: typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0,
	nonBlockFlag: typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0,
	lstat: (path: string) => lstatSync(path, { bigint: true }),
	open: (path: string, flags: number) => openSync(path, flags),
	fstat: (descriptor: number) => fstatSync(descriptor, { bigint: true }),
	read: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) =>
		readSync(descriptor, buffer, offset, length, position),
	close: (descriptor: number) => closeSync(descriptor),
});

export interface StableDirectorySnapshot {
	readonly path: string;
	readonly stat: BigIntStats;
}

export function readStableRegularUtf8(
	path: string,
	maxBytes: number,
	fs: StableReadFileSystem = NODE_STABLE_READ_FS,
	expectedDirectories?: readonly StableDirectorySnapshot[],
): string | undefined {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || fs.noFollowFlag === 0) return undefined;
	let descriptor: number | undefined;
	try {
		const pinnedDirectories = expectedDirectories ?? snapshotStableDirectoryChain(path, fs);
		if (pinnedDirectories === undefined) return undefined;
		const before = fs.lstat(path);
		if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes)) return undefined;
		if (!directorySnapshotsMatch(pinnedDirectories, fs)) return undefined;
		descriptor = fs.open(path, constants.O_RDONLY | fs.noFollowFlag | fs.nonBlockFlag);
		const opened = fs.fstat(descriptor);
		if (!sameRegularIdentity(before, opened)) return undefined;

		const buffer = Buffer.alloc(maxBytes + 1);
		let total = 0;
		while (total < buffer.byteLength) {
			const read = fs.read(descriptor, buffer, total, buffer.byteLength - total, total);
			if (read === 0) break;
			total += read;
		}
		if (total > maxBytes) return undefined;

		const closedOver = fs.fstat(descriptor);
		const namedAfter = fs.lstat(path);
		if (!sameStableSnapshot(opened, closedOver) || !sameRegularIdentity(opened, namedAfter)) return undefined;
		if (!directorySnapshotsMatch(pinnedDirectories, fs)) return undefined;
		if (closedOver.size !== BigInt(total)) return undefined;
		return buffer.subarray(0, total).toString("utf8");
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return undefined;
	} finally {
		if (descriptor !== undefined) {
			try {
				fs.close(descriptor);
			} catch {}
		}
	}
}

export function snapshotStableDirectoryChain(
	path: string,
	fs: StableReadFileSystem = NODE_STABLE_READ_FS,
	root: string = parse(resolve(path)).root,
): readonly StableDirectorySnapshot[] | undefined {
	const boundary = resolve(root);
	const paths: string[] = [];
	let current = dirname(resolve(path));
	while (true) {
		paths.push(current);
		if (current === boundary) break;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
	paths.reverse();

	try {
		const snapshots: StableDirectorySnapshot[] = [];
		for (const directoryPath of paths) {
			const stat = fs.lstat(directoryPath);
			if (stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
			snapshots.push({ path: directoryPath, stat });
		}
		return snapshots;
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return undefined;
	}
}

function directorySnapshotsMatch(expected: readonly StableDirectorySnapshot[], fs: StableReadFileSystem): boolean {
	return expected.every((entry) => {
		const current = fs.lstat(entry.path);
		return !current.isSymbolicLink() && sameDirectoryIdentity(entry.stat, current);
	});
}

export function sameDirectoryIdentity(left: BigIntStats, right: BigIntStats): boolean {
	return (
		left.isDirectory() &&
		right.isDirectory() &&
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.ctimeNs === right.ctimeNs &&
		left.birthtimeNs === right.birthtimeNs
	);
}

function sameRegularIdentity(left: BigIntStats, right: BigIntStats): boolean {
	return (
		left.isFile() &&
		right.isFile() &&
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.ctimeNs === right.ctimeNs &&
		left.birthtimeNs === right.birthtimeNs
	);
}

function sameStableSnapshot(left: BigIntStats, right: BigIntStats): boolean {
	return (
		sameRegularIdentity(left, right) &&
		left.size === right.size &&
		left.mtimeNs === right.mtimeNs &&
		left.ctimeNs === right.ctimeNs
	);
}
