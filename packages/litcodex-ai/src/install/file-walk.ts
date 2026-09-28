import {
	type BigIntStats,
	closeSync,
	constants,
	type Dir,
	type Dirent,
	fstatSync,
	lstatSync,
	opendirSync,
	openSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface WalkedEntry {
	readonly absolutePath: string;
	readonly relativePath: string;
	readonly kind: "directory" | "file" | "unexpected";
}

export interface PayloadEntry {
	readonly relativePath: string;
	readonly kind: "file" | "unexpected";
}

export type PayloadDirectoryReader = (directory: Dir, lexicalPath: string) => readonly Dirent<string>[];
export type PayloadDirectoryCapability = "posix-verified-fd" | "windows-stable-path";

const nativeDirectoryCapability: PayloadDirectoryCapability =
	process.platform === "win32" ? "windows-stable-path" : "posix-verified-fd";

export interface StableFileReadFs {
	readonly closeSync: typeof closeSync;
	readonly constants: typeof constants;
	readonly fstatSync: typeof fstatSync;
	readonly lstatSync: typeof lstatSync;
	readonly openSync: typeof openSync;
	readonly readFileSync: (fd: number) => Uint8Array;
}

const NODE_FILE_READ_FS: StableFileReadFs = Object.freeze({
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync: (fd: number) => readFileSync(fd),
});

function pathDirectoryMetadata(path: string): BigIntStats {
	const metadata = lstatSync(path, { bigint: true });
	if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
		throw new Error("payload directory is not a real directory");
	}
	return metadata;
}

function directoryMetadataMatches(left: BigIntStats, right: BigIntStats): boolean {
	return (
		left.isDirectory() &&
		right.isDirectory() &&
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.birthtimeNs === right.birthtimeNs &&
		left.mtimeNs === right.mtimeNs &&
		left.ctimeNs === right.ctimeNs
	);
}

function exactDirectoryEntries(entries: readonly Dirent<string>[]): readonly string[] {
	return entries
		.map((entry) => [entry.name, entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unexpected"] as const)
		.sort(([leftName, leftKind], [rightName, rightKind]) =>
			leftName === rightName ? leftKind.localeCompare(rightKind) : leftName.localeCompare(rightName),
		)
		.map((entry) => JSON.stringify(entry));
}

function openFileDescriptors(): ReadonlyMap<number, string> {
	for (const registry of ["/proc/self/fd", "/dev/fd"]) {
		try {
			const descriptors = new Map<number, string>();
			for (const name of readdirSync(registry)) {
				const descriptor = Number(name);
				if (!Number.isInteger(descriptor) || descriptor < 0) continue;
				try {
					const identity = fstatSync(descriptor, { bigint: true });
					descriptors.set(descriptor, `${identity.dev}:${identity.ino}`);
				} catch {
					// Ignore the registry's already-closed enumeration descriptor.
				}
			}
			return descriptors;
		} catch {
			// Try the next platform descriptor registry.
		}
	}
	throw new Error("open file descriptors cannot be inspected safely");
}

const readDirectoryFromDescriptor: PayloadDirectoryReader = (directory) => {
	const entries: Dirent<string>[] = [];
	for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
	return entries;
};

function readPosixStableDirectory(path: string, directoryReader: PayloadDirectoryReader) {
	const before = pathDirectoryMetadata(path);
	const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(fd, { bigint: true });
		if (
			!opened.isDirectory() ||
			opened.dev !== before.dev ||
			opened.ino !== before.ino ||
			opened.ctimeNs !== before.ctimeNs ||
			opened.birthtimeNs !== before.birthtimeNs
		) {
			throw new Error("payload directory identity changed before enumeration");
		}
		const descriptorsBefore = openFileDescriptors();
		const openedIdentity = `${opened.dev}:${opened.ino}`;
		const directory = opendirSync(path);
		try {
			const directoryDescriptors = [...openFileDescriptors()].flatMap(([descriptor, identity]) =>
				descriptor !== fd && identity === openedIdentity && descriptorsBefore.get(descriptor) !== identity
					? [descriptor]
					: [],
			);
			const [directoryDescriptor] = directoryDescriptors;
			if (directoryDescriptors.length !== 1 || directoryDescriptor === undefined) {
				throw new Error("payload directory descriptor cannot be identified safely");
			}
			const directoryBefore = fstatSync(directoryDescriptor, { bigint: true });
			if (
				!directoryBefore.isDirectory() ||
				directoryBefore.dev !== opened.dev ||
				directoryBefore.ino !== opened.ino ||
				directoryBefore.ctimeNs !== opened.ctimeNs ||
				directoryBefore.birthtimeNs !== opened.birthtimeNs
			) {
				throw new Error("payload directory descriptor identity changed before enumeration");
			}
			const entries = directoryReader(directory, path);
			const directoryAfter = fstatSync(directoryDescriptor, { bigint: true });
			if (
				!directoryAfter.isDirectory() ||
				directoryAfter.dev !== directoryBefore.dev ||
				directoryAfter.ino !== directoryBefore.ino ||
				directoryAfter.birthtimeNs !== directoryBefore.birthtimeNs ||
				directoryAfter.mtimeNs !== directoryBefore.mtimeNs ||
				directoryAfter.ctimeNs !== directoryBefore.ctimeNs
			) {
				throw new Error("payload directory descriptor mutated during enumeration");
			}
			const after = lstatSync(path, { bigint: true });
			if (
				!after.isDirectory() ||
				after.dev !== opened.dev ||
				after.ino !== opened.ino ||
				after.ctimeNs !== opened.ctimeNs ||
				after.birthtimeNs !== opened.birthtimeNs
			) {
				throw new Error("payload directory identity changed during enumeration");
			}
			return entries;
		} finally {
			directory.closeSync();
		}
	} finally {
		closeSync(fd);
	}
}

function readWindowsStableDirectoryOnce(
	path: string,
	expected: BigIntStats,
	directoryReader: PayloadDirectoryReader,
): readonly Dirent<string>[] {
	const beforeOpen = pathDirectoryMetadata(path);
	if (!directoryMetadataMatches(beforeOpen, expected)) {
		throw new Error("payload directory identity or metadata changed before enumeration");
	}
	const directory = opendirSync(path);
	let entries: readonly Dirent<string>[];
	try {
		const afterOpen = pathDirectoryMetadata(path);
		if (!directoryMetadataMatches(afterOpen, expected)) {
			throw new Error("payload directory identity or metadata changed while opening enumeration handle");
		}
		entries = directoryReader(directory, path);
	} finally {
		directory.closeSync();
	}
	const afterClose = pathDirectoryMetadata(path);
	if (!directoryMetadataMatches(afterClose, expected)) {
		throw new Error("payload directory identity or metadata changed during enumeration");
	}
	return entries;
}

/**
 * Node does not expose a Windows `Dir` file descriptor for direct file-id verification. The native
 * Windows branch therefore brackets two handle-bound enumerations with no-follow path identity and
 * nanosecond metadata snapshots, then requires both name/kind sets to match exactly.
 */
function readWindowsStableDirectory(path: string, directoryReader: PayloadDirectoryReader) {
	const expected = pathDirectoryMetadata(path);
	const first = readWindowsStableDirectoryOnce(path, expected, directoryReader);
	const second = readWindowsStableDirectoryOnce(path, expected, directoryReader);
	const firstEntries = exactDirectoryEntries(first);
	const secondEntries = exactDirectoryEntries(second);
	if (
		firstEntries.length !== secondEntries.length ||
		firstEntries.some((entry, index) => entry !== secondEntries[index])
	) {
		throw new Error("payload directory entries changed between stable enumerations");
	}
	return first;
}

function readStableDirectory(
	path: string,
	directoryReader: PayloadDirectoryReader,
	directoryCapability: PayloadDirectoryCapability,
) {
	return directoryCapability === "windows-stable-path"
		? readWindowsStableDirectory(path, directoryReader)
		: readPosixStableDirectory(path, directoryReader);
}

/** Enumerate a directory without following links, using APIs available at the Node 20.0 floor. */
export function walkDirectory(
	root: string,
	directoryReader: PayloadDirectoryReader = readDirectoryFromDescriptor,
	directoryCapability: PayloadDirectoryCapability = nativeDirectoryCapability,
): readonly WalkedEntry[] {
	const walked: WalkedEntry[] = [];
	const pending = [{ absolutePath: root, relativePath: "" }];
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		for (const entry of readStableDirectory(current.absolutePath, directoryReader, directoryCapability)) {
			const absolutePath = join(current.absolutePath, entry.name);
			const relativePath = current.relativePath.length === 0 ? entry.name : `${current.relativePath}/${entry.name}`;
			const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "unexpected";
			walked.push({ absolutePath, relativePath, kind });
			if (kind === "directory") pending.push({ absolutePath, relativePath });
		}
	}
	return walked;
}

/**
 * Return every non-directory entry for exact payload comparison.
 *
 * Regular files are expected. Symlinks, sockets, FIFOs, devices, and other special
 * entries deliberately remain in the returned path set so callers fail closed.
 */
export function listPayloadPaths(root: string): readonly string[] {
	return listPayloadEntries(root).map((entry) => entry.relativePath);
}

/** Preserve each non-directory entry's no-follow kind for exact installed-payload checks. */
export function listPayloadEntries(
	root: string,
	directoryReader: PayloadDirectoryReader = readDirectoryFromDescriptor,
	directoryCapability: PayloadDirectoryCapability = nativeDirectoryCapability,
): readonly PayloadEntry[] {
	return walkDirectory(root, directoryReader, directoryCapability).flatMap(({ relativePath, kind }) =>
		kind === "directory" ? [] : [{ relativePath, kind }],
	);
}

/** Read one stable regular-file identity without following a leaf symbolic link. */
export function readRegularFileBuffer(path: string, fs: StableFileReadFs = NODE_FILE_READ_FS): Uint8Array {
	const parent = dirname(path);
	const parentBefore = fs.lstatSync(parent, { bigint: true });
	if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory()) {
		throw new Error("payload parent is not a real directory");
	}
	const before = fs.lstatSync(path, { bigint: true });
	if (!before.isFile()) throw new Error("payload entry is not a regular file");
	const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fs.fstatSync(fd, { bigint: true });
		if (
			!opened.isFile() ||
			opened.dev !== before.dev ||
			opened.ino !== before.ino ||
			opened.ctimeNs !== before.ctimeNs ||
			opened.birthtimeNs !== before.birthtimeNs
		) {
			throw new Error("payload file identity changed before read");
		}
		const parentAfterOpen = fs.lstatSync(parent, { bigint: true });
		if (
			parentAfterOpen.isSymbolicLink() ||
			!parentAfterOpen.isDirectory() ||
			parentAfterOpen.dev !== parentBefore.dev ||
			parentAfterOpen.ino !== parentBefore.ino ||
			parentAfterOpen.ctimeNs !== parentBefore.ctimeNs ||
			parentAfterOpen.birthtimeNs !== parentBefore.birthtimeNs
		) {
			throw new Error("payload parent identity changed before read");
		}
		const bytes = fs.readFileSync(fd);
		const after = fs.lstatSync(path, { bigint: true });
		if (
			!after.isFile() ||
			after.dev !== opened.dev ||
			after.ino !== opened.ino ||
			after.ctimeNs !== opened.ctimeNs ||
			after.birthtimeNs !== opened.birthtimeNs
		) {
			throw new Error("payload file identity changed during read");
		}
		const parentAfterRead = fs.lstatSync(parent, { bigint: true });
		if (
			parentAfterRead.isSymbolicLink() ||
			!parentAfterRead.isDirectory() ||
			parentAfterRead.dev !== parentBefore.dev ||
			parentAfterRead.ino !== parentBefore.ino ||
			parentAfterRead.ctimeNs !== parentBefore.ctimeNs ||
			parentAfterRead.birthtimeNs !== parentBefore.birthtimeNs
		) {
			throw new Error("payload parent identity changed during read");
		}
		return bytes;
	} finally {
		fs.closeSync(fd);
	}
}
