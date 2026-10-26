// Bounded reads of files a model or a render wrote. The Stop hook runs the done-check synchronously inside a
// 5 s manifest timeout, so a path that is a named pipe, a link to a device, or a huge file must end in a
// refusal, never a blocked read. lstat first, open without following links and without blocking, check the
// opened descriptor again, and stop at the byte limit.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

export const READ_LIMIT = 4 * 1024 * 1024;

export function readBounded(path, maxBytes = READ_LIMIT) {
	if (!lstatSync(path).isFile()) throw new Error(`${path} is not a regular file`);
	const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
	try {
		const info = fstatSync(fd);
		if (!info.isFile()) throw new Error(`${path} is not a regular file`);
		if (info.size > maxBytes) throw new Error(`${path} is too large (${info.size} bytes; limit ${maxBytes})`);
		const chunks = [];
		let total = 0;
		for (;;) {
			const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
			const got = readSync(fd, chunk, 0, chunk.length, null);
			if (got === 0) break;
			total += got;
			if (total > maxBytes) throw new Error(`${path} is too large (over ${maxBytes} bytes)`);
			chunks.push(chunk.subarray(0, got));
		}
		return Buffer.concat(chunks);
	} finally {
		closeSync(fd);
	}
}

export const readBoundedText = (path, maxBytes = READ_LIMIT) => readBounded(path, maxBytes).toString("utf8");
