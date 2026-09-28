import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class InputError extends Error {
	constructor(code, detail) {
		super(`${code}: ${detail}`);
		this.name = "InputError";
		this.code = code;
	}
}

export function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function whitespace(text, index) {
	let cursor = index;
	while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
	return cursor;
}

function stringBoundary(text, index, code) {
	let cursor = index + 1;
	while (cursor < text.length) {
		const character = text[cursor];
		if (character === "\\") {
			cursor += 2;
			continue;
		}
		if (character === '"') return cursor + 1;
		if (text.charCodeAt(cursor) < 0x20) throw new InputError(code, "JSON strings cannot contain control characters");
		cursor += 1;
	}
	throw new InputError(code, "unterminated JSON string");
}

function valueBoundary(text, index, code) {
	const start = whitespace(text, index);
	if (text[start] === '"') return stringBoundary(text, start, code);
	if (text[start] === "{") return objectBoundary(text, start, code);
	if (text[start] === "[") return arrayBoundary(text, start, code);
	let cursor = start;
	while (cursor < text.length && !/[\s,\]}]/u.test(text[cursor])) cursor += 1;
	if (cursor === start) throw new InputError(code, "missing JSON value");
	return cursor;
}

function objectBoundary(text, index, code) {
	const keys = new Set();
	let cursor = whitespace(text, index + 1);
	if (text[cursor] === "}") return cursor + 1;
	while (cursor < text.length) {
		if (text[cursor] !== '"') throw new InputError(code, "JSON object keys must be strings");
		const end = stringBoundary(text, cursor, code);
		const key = JSON.parse(text.slice(cursor, end));
		if (keys.has(key)) throw new InputError(code, `duplicate JSON key: ${key}`);
		keys.add(key);
		cursor = whitespace(text, end);
		if (text[cursor] !== ":") throw new InputError(code, "missing colon after JSON object key");
		cursor = whitespace(text, valueBoundary(text, cursor + 1, code));
		if (text[cursor] === "}") return cursor + 1;
		if (text[cursor] !== ",") throw new InputError(code, "missing comma in JSON object");
		cursor = whitespace(text, cursor + 1);
	}
	throw new InputError(code, "unterminated JSON object");
}

function arrayBoundary(text, index, code) {
	let cursor = whitespace(text, index + 1);
	if (text[cursor] === "]") return cursor + 1;
	while (cursor < text.length) {
		cursor = whitespace(text, valueBoundary(text, cursor, code));
		if (text[cursor] === "]") return cursor + 1;
		if (text[cursor] !== ",") throw new InputError(code, "missing comma in JSON array");
		cursor = whitespace(text, cursor + 1);
	}
	throw new InputError(code, "unterminated JSON array");
}

export function parseJson(text, code = "JSON_INVALID") {
	if (text.includes("\0")) throw new InputError(code, "NUL bytes are forbidden");
	try {
		const end = whitespace(text, valueBoundary(text, 0, code));
		if (end !== text.length) throw new InputError(code, "trailing data after JSON value");
		return JSON.parse(text);
	} catch (error) {
		if (error instanceof InputError) throw error;
		throw new InputError(code, error instanceof Error ? error.message : String(error));
	}
}

export function decodeUtf8(bytes, maxBytes, code = "INPUT_INVALID") {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes) {
		throw new InputError(code, `input exceeds ${maxBytes} bytes`);
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new InputError(code, "input is not valid UTF-8");
	}
}

export function readStdinBytes(maxBytes, code = "INPUT_INVALID") {
	const chunks = [];
	let total = 0;
	for (;;) {
		const remaining = maxBytes + 1 - total;
		const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
		const count = readSync(0, chunk, 0, chunk.length);
		if (count === 0) return Buffer.concat(chunks, total);
		total += count;
		if (total > maxBytes) throw new InputError(code, `input exceeds ${maxBytes} bytes`);
		chunks.push(chunk.subarray(0, count));
	}
}

function containedBy(root, candidate) {
	const delta = relative(root, candidate);
	return delta === "" || (!delta.startsWith("..") && !isAbsolute(delta));
}

function sameIdentity(pathStat, descriptorStat) {
	return (
		pathStat.dev === descriptorStat.dev &&
		pathStat.ino === descriptorStat.ino &&
		pathStat.mode === descriptorStat.mode &&
		pathStat.uid === descriptorStat.uid &&
		pathStat.gid === descriptorStat.gid &&
		pathStat.rdev === descriptorStat.rdev &&
		pathStat.birthtimeNs === descriptorStat.birthtimeNs
	);
}

function readDescriptorBytes(descriptor, maxBytes, code, hooks) {
	const chunks = [];
	let total = 0;
	for (;;) {
		const remaining = maxBytes + 1 - total;
		const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
		hooks?.beforeRead?.(descriptor);
		let count;
		try {
			count = readSync(descriptor, chunk, 0, chunk.length, null);
		} catch {
			throw new InputError(code, "file could not be read through its validated descriptor");
		}
		if (count === 0) return Buffer.concat(chunks, total);
		total += count;
		if (total > maxBytes) throw new InputError(code, `file exceeds ${maxBytes} bytes`);
		chunks.push(chunk.subarray(0, count));
	}
}

export function readRegularBytesWithin(path, root, maxBytes, code = "FILE_INVALID", hooks) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
		throw new InputError(code, "maximum file size must be a non-negative safe integer");
	}
	const allowedRoot = realpathSync(resolve(root));
	const lexicalPath = resolve(path);
	let stat;
	try {
		stat = lstatSync(lexicalPath, { bigint: true });
	} catch {
		throw new InputError(code, `file is unavailable: ${lexicalPath}`);
	}
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new InputError(code, "path must be a regular non-symlink file");
	}
	const realPath = realpathSync(lexicalPath);
	if (!containedBy(allowedRoot, realPath)) throw new InputError(code, "path escapes the allowed root");
	if (stat.size > BigInt(maxBytes)) throw new InputError(code, `file exceeds ${maxBytes} bytes`);
	hooks?.afterPathValidation?.();

	const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
	let descriptor;
	try {
		descriptor = openSync(lexicalPath, constants.O_RDONLY | noFollow | nonBlocking);
	} catch {
		throw new InputError(code, "file changed during validation or could not be opened safely");
	}

	try {
		hooks?.afterOpen?.(descriptor);
		let descriptorStat;
		try {
			descriptorStat = fstatSync(descriptor, { bigint: true });
		} catch {
			throw new InputError(code, "opened file descriptor could not be validated");
		}
		if (!descriptorStat.isFile()) {
			throw new InputError(code, "opened path must be a regular file");
		}
		if (!sameIdentity(stat, descriptorStat)) {
			throw new InputError(code, "file changed during validation");
		}
		if (descriptorStat.size > BigInt(maxBytes)) {
			throw new InputError(code, `file exceeds ${maxBytes} bytes`);
		}
		return readDescriptorBytes(descriptor, maxBytes, code, hooks);
	} finally {
		closeSync(descriptor);
	}
}

export function readStdinJson(maxBytes = 512 * 1024, code = "JSON_INVALID") {
	const bytes = readStdinBytes(maxBytes, code);
	return parseJson(decodeUtf8(bytes, maxBytes, code), code);
}

export function readBoundedJsonFile(path, maxBytes = 512 * 1024, code = "JSON_INVALID") {
	const bytes = readRegularBytesWithin(path, process.cwd(), maxBytes, code);
	return parseJson(decodeUtf8(bytes, maxBytes, code), code);
}

function normalized(value) {
	if (Array.isArray(value)) return value.map(normalized);
	if (!isRecord(value)) return value;
	const result = {};
	for (const key of Object.keys(value).sort()) result[key] = normalized(value[key]);
	return result;
}

export function canonicalJson(value) {
	return `${JSON.stringify(normalized(value))}\n`;
}

export function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

export function isMain(metaUrl) {
	if (process.argv[1] === undefined) return false;
	try {
		return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}
