import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const DEFAULT_FS = Object.freeze({ closeSync, constants, fstatSync, lstatSync, openSync, readSync });

export class StableFileReadError extends Error {
	constructor(code) {
		super(code);
		this.name = "StableFileReadError";
		this.code = code;
	}
}

function fail(code) {
	throw new StableFileReadError(code);
}

function identity(stat) {
	return {
		dev: stat.dev,
		ino: stat.ino,
		mode: stat.mode,
		size: stat.size,
		ctimeMs: stat.ctimeMs,
		mtimeMs: stat.mtimeMs,
	};
}

function sameIdentity(left, right) {
	return (
		left?.dev === right?.dev &&
		left?.ino === right?.ino &&
		left?.mode === right?.mode &&
		left?.size === right?.size &&
		left?.ctimeMs === right?.ctimeMs &&
		left?.mtimeMs === right?.mtimeMs
	);
}

function ancestorPaths(root, filePath) {
	const absoluteRoot = resolve(root);
	const directory = dirname(resolve(filePath));
	const fromRoot = relative(absoluteRoot, directory);
	if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) fail("PATH_ESCAPE");
	const paths = [absoluteRoot];
	let current = absoluteRoot;
	for (const part of fromRoot.split(sep).filter(Boolean)) {
		current = join(current, part);
		paths.push(current);
	}
	return paths;
}

function closeAll(opened, fs) {
	for (const descriptor of [...opened].reverse()) {
		try {
			fs.closeSync(descriptor);
		} catch {
			// A prior verification failure remains fail-closed; cleanup cannot make it pass.
		}
	}
}

function openAncestors(root, filePath, fs) {
	if (typeof fs.constants?.O_NOFOLLOW !== "number" || typeof fs.constants?.O_DIRECTORY !== "number") {
		fail("CAPABILITY_UNAVAILABLE");
	}
	const descriptors = [];
	const snapshots = [];
	try {
		for (const absolutePath of ancestorPaths(root, filePath)) {
			const named = fs.lstatSync(absolutePath);
			if (named.isSymbolicLink() || !named.isDirectory()) fail("ANCESTOR_INVALID");
			const descriptor = fs.openSync(
				absolutePath,
				fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
			);
			descriptors.push(descriptor);
			const opened = fs.fstatSync(descriptor);
			if (!opened.isDirectory() || !sameIdentity(identity(named), identity(opened))) fail("ANCESTOR_CHANGED");
			snapshots.push({ absolutePath, identity: identity(opened) });
		}
		return { descriptors, snapshots };
	} catch (error) {
		closeAll(descriptors, fs);
		if (error instanceof StableFileReadError) throw error;
		fail(error?.code === "ENOENT" ? "MISSING" : "UNREADABLE");
	}
}

function verifyOpenAncestors(chain, fs) {
	try {
		for (let index = 0; index < chain.snapshots.length; index++) {
			const snapshot = chain.snapshots[index];
			const opened = fs.fstatSync(chain.descriptors[index]);
			const named = fs.lstatSync(snapshot.absolutePath);
			if (
				!opened.isDirectory() ||
				!named.isDirectory() ||
				named.isSymbolicLink() ||
				!sameIdentity(snapshot.identity, identity(opened)) ||
				!sameIdentity(snapshot.identity, identity(named))
			) {
				fail("ANCESTOR_CHANGED");
			}
		}
	} catch (error) {
		if (error instanceof StableFileReadError) throw error;
		fail("ANCESTOR_CHANGED");
	}
}

function readOpenedSize(descriptor, size, fs) {
	const bytes = Buffer.allocUnsafe(size);
	let offset = 0;
	while (offset < size) {
		const count = fs.readSync(descriptor, bytes, offset, size - offset, null);
		if (count === 0) break;
		offset += count;
	}
	const probe = Buffer.allocUnsafe(1);
	const grew = fs.readSync(descriptor, probe, 0, 1, null) !== 0;
	if (offset !== size || grew) fail("FILE_CHANGED");
	return bytes;
}

export function readStableRegularFile(root, filePath, maxBytes, fs = DEFAULT_FS) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail("INVALID_BOUND");
	const chain = openAncestors(root, filePath, fs);
	let descriptor;
	try {
		let named;
		try {
			named = fs.lstatSync(filePath);
		} catch (error) {
			fail(error?.code === "ENOENT" ? "MISSING" : "UNREADABLE");
		}
		if (named.isSymbolicLink()) fail("SYMLINK");
		if (!named.isFile()) fail("SPECIAL");
		if ((named.mode & 0o444) === 0) fail("UNREADABLE");
		if (named.size > maxBytes) fail("TOO_LARGE");
		if (typeof fs.constants?.O_NOFOLLOW !== "number") fail("CAPABILITY_UNAVAILABLE");

		descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
		const opened = fs.fstatSync(descriptor);
		if (!opened.isFile() || !sameIdentity(identity(named), identity(opened))) fail("FILE_CHANGED");
		if (opened.size > maxBytes) fail("TOO_LARGE");
		const bytes = readOpenedSize(descriptor, opened.size, fs);
		const afterDescriptor = fs.fstatSync(descriptor);
		if (!afterDescriptor.isFile() || !sameIdentity(identity(opened), identity(afterDescriptor))) fail("FILE_CHANGED");
		verifyOpenAncestors(chain, fs);
		const afterNamed = fs.lstatSync(filePath);
		if (afterNamed.isSymbolicLink() || !afterNamed.isFile() || !sameIdentity(identity(opened), identity(afterNamed))) {
			fail("FILE_CHANGED");
		}
		return {
			bytes,
			snapshot: {
				file: { absolutePath: resolve(filePath), identity: identity(opened) },
				ancestors: chain.snapshots,
			},
		};
	} catch (error) {
		if (error instanceof StableFileReadError) throw error;
		fail(error?.code === "ENOENT" ? "MISSING" : "UNREADABLE");
	} finally {
		if (descriptor !== undefined) {
			try {
				fs.closeSync(descriptor);
			} catch {
				// The read has already been identity-checked; descriptor cleanup remains best-effort.
			}
		}
		closeAll(chain.descriptors, fs);
	}
}

export function assertStableFileSnapshot(snapshot, fs = DEFAULT_FS) {
	try {
		for (const ancestor of snapshot.ancestors) {
			const named = fs.lstatSync(ancestor.absolutePath);
			if (named.isSymbolicLink() || !named.isDirectory() || !sameIdentity(ancestor.identity, identity(named))) {
				fail("ANCESTOR_CHANGED");
			}
		}
		const named = fs.lstatSync(snapshot.file.absolutePath);
		if (named.isSymbolicLink() || !named.isFile() || !sameIdentity(snapshot.file.identity, identity(named))) {
			fail("FILE_CHANGED");
		}
	} catch (error) {
		if (error instanceof StableFileReadError) throw error;
		fail("FILE_CHANGED");
	}
}
