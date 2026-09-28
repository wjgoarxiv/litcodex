import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
export const NODE_STABLE_READ_FS = Object.freeze({
    noFollowFlag: typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0,
    nonBlockFlag: typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0,
    lstat: (path) => lstatSync(path, { bigint: true }),
    open: (path, flags) => openSync(path, flags),
    fstat: (descriptor) => fstatSync(descriptor, { bigint: true }),
    read: (descriptor, buffer, offset, length, position) => readSync(descriptor, buffer, offset, length, position),
    close: (descriptor) => closeSync(descriptor),
});
export function readStableRegularUtf8(path, maxBytes, fs = NODE_STABLE_READ_FS, expectedDirectories) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || fs.noFollowFlag === 0)
        return undefined;
    let descriptor;
    try {
        const pinnedDirectories = expectedDirectories ?? snapshotStableDirectoryChain(path, fs);
        if (pinnedDirectories === undefined)
            return undefined;
        const before = fs.lstat(path);
        if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes))
            return undefined;
        if (!directorySnapshotsMatch(pinnedDirectories, fs))
            return undefined;
        descriptor = fs.open(path, constants.O_RDONLY | fs.noFollowFlag | fs.nonBlockFlag);
        const opened = fs.fstat(descriptor);
        if (!sameRegularIdentity(before, opened))
            return undefined;
        const buffer = Buffer.alloc(maxBytes + 1);
        let total = 0;
        while (total < buffer.byteLength) {
            const read = fs.read(descriptor, buffer, total, buffer.byteLength - total, total);
            if (read === 0)
                break;
            total += read;
        }
        if (total > maxBytes)
            return undefined;
        const closedOver = fs.fstat(descriptor);
        const namedAfter = fs.lstat(path);
        if (!sameStableSnapshot(opened, closedOver) || !sameRegularIdentity(opened, namedAfter))
            return undefined;
        if (!directorySnapshotsMatch(pinnedDirectories, fs))
            return undefined;
        if (closedOver.size !== BigInt(total))
            return undefined;
        return buffer.subarray(0, total).toString("utf8");
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
        return undefined;
    }
    finally {
        if (descriptor !== undefined) {
            try {
                fs.close(descriptor);
            }
            catch { }
        }
    }
}
export function snapshotStableDirectoryChain(path, fs = NODE_STABLE_READ_FS, root = parse(resolve(path)).root) {
    const boundary = resolve(root);
    const paths = [];
    let current = dirname(resolve(path));
    while (true) {
        paths.push(current);
        if (current === boundary)
            break;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
    paths.reverse();
    try {
        const snapshots = [];
        for (const directoryPath of paths) {
            const stat = fs.lstat(directoryPath);
            if (stat.isSymbolicLink() || !stat.isDirectory())
                return undefined;
            snapshots.push({ path: directoryPath, stat });
        }
        return snapshots;
    }
    catch (error) {
        if (!(error instanceof Error))
            throw error;
        return undefined;
    }
}
function directorySnapshotsMatch(expected, fs) {
    return expected.every((entry) => {
        const current = fs.lstat(entry.path);
        return !current.isSymbolicLink() && sameDirectoryIdentity(entry.stat, current);
    });
}
export function sameDirectoryIdentity(left, right) {
    return (left.isDirectory() &&
        right.isDirectory() &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.ctimeNs === right.ctimeNs &&
        left.birthtimeNs === right.birthtimeNs);
}
function sameRegularIdentity(left, right) {
    return (left.isFile() &&
        right.isFile() &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.ctimeNs === right.ctimeNs &&
        left.birthtimeNs === right.birthtimeNs);
}
function sameStableSnapshot(left, right) {
    return (sameRegularIdentity(left, right) &&
        left.size === right.size &&
        left.mtimeNs === right.mtimeNs &&
        left.ctimeNs === right.ctimeNs);
}
