import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export class ContractError extends Error {
	constructor(code, message) {
		super(`${code}: ${message}`);
		this.name = "ContractError";
		this.code = code;
	}
}

export function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJson(text, code = "JSON_INVALID") {
	if (text.includes("\0")) throw new ContractError(code, "NUL bytes are forbidden");
	try {
		assertNoDuplicateKeys(text, code);
		return JSON.parse(text);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new ContractError(code, detail);
	}
}

function skipSpace(text, start) {
	let index = start;
	while (index < text.length && /\s/u.test(text[index])) index += 1;
	return index;
}

function stringEnd(text, start, code) {
	let index = start + 1;
	while (index < text.length) {
		if (text[index] === "\\") {
			index += 2;
			continue;
		}
		if (text[index] === '"') return index + 1;
		if (text.charCodeAt(index) < 0x20) throw new ContractError(code, "control character in JSON string");
		index += 1;
	}
	throw new ContractError(code, "unterminated JSON string");
}

function valueEnd(text, start, code) {
	const index = skipSpace(text, start);
	if (text[index] === '"') return stringEnd(text, index, code);
	if (text[index] === "{") return objectEnd(text, index, code);
	if (text[index] === "[") return arrayEnd(text, index, code);
	let end = index;
	while (end < text.length && !/[\s,\]}]/u.test(text[end])) end += 1;
	if (end === index) throw new ContractError(code, "missing JSON value");
	return end;
}

function objectEnd(text, start, code) {
	const keys = new Set();
	let index = skipSpace(text, start + 1);
	if (text[index] === "}") return index + 1;
	while (index < text.length) {
		if (text[index] !== '"') throw new ContractError(code, "object key must be a string");
		const end = stringEnd(text, index, code);
		const key = JSON.parse(text.slice(index, end));
		if (keys.has(key)) throw new ContractError(code, `duplicate JSON key: ${key}`);
		keys.add(key);
		index = skipSpace(text, end);
		if (text[index] !== ":") throw new ContractError(code, "missing colon after object key");
		index = skipSpace(text, valueEnd(text, index + 1, code));
		if (text[index] === "}") return index + 1;
		if (text[index] !== ",") throw new ContractError(code, "missing comma in object");
		index = skipSpace(text, index + 1);
	}
	throw new ContractError(code, "unterminated object");
}

function arrayEnd(text, start, code) {
	let index = skipSpace(text, start + 1);
	if (text[index] === "]") return index + 1;
	while (index < text.length) {
		index = skipSpace(text, valueEnd(text, index, code));
		if (text[index] === "]") return index + 1;
		if (text[index] !== ",") throw new ContractError(code, "missing comma in array");
		index = skipSpace(text, index + 1);
	}
	throw new ContractError(code, "unterminated array");
}

export function assertNoDuplicateKeys(text, code = "JSON_INVALID") {
	valueEnd(text, 0, code);
}

export function decodeUtf8(bytes, maxBytes, code = "JSON_INVALID") {
	if (bytes.length > maxBytes) throw new ContractError(code, `input exceeds ${maxBytes} bytes`);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new ContractError(code, "input is not valid UTF-8");
	}
}

export function readRegularBytes(path, maxBytes, code = "FILE_INVALID") {
	let stat;
	try {
		stat = lstatSync(path);
	} catch {
		throw new ContractError(code, `file is unavailable: ${path}`);
	}
	if (stat.isSymbolicLink() || !stat.isFile()) throw new ContractError(code, "path must be a regular non-symlink file");
	if (stat.size > maxBytes) throw new ContractError(code, `file exceeds ${maxBytes} bytes`);
	return readFileSync(path);
}

export function readStdinBytes(maxBytes, code = "JSON_INVALID") {
	const chunks = [];
	let total = 0;
	while (true) {
		const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
		const count = readSync(0, chunk, 0, chunk.length);
		if (count === 0) return Buffer.concat(chunks, total);
		total += count;
		if (total > maxBytes) throw new ContractError(code, `input exceeds ${maxBytes} bytes`);
		chunks.push(chunk.subarray(0, count));
	}
}

export function readJsonFile(path, maxBytes, code = "JSON_INVALID") {
	return parseJson(decodeUtf8(readRegularBytes(path, maxBytes, code), maxBytes, code), code);
}

export function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;
	const result = {};
	for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
	return result;
}

export function canonicalJson(value) {
	return `${JSON.stringify(canonicalize(value))}\n`;
}

export function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalSha256(value) {
	return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

export function assertOnlyFlags(args, allowed) {
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		if (!allowed.has(flag)) throw new ContractError("ARGUMENT_INVALID", `unsupported argument: ${flag ?? "missing"}`);
		if (args[index + 1] === undefined || args[index + 1].startsWith("--")) {
			throw new ContractError("ARGUMENT_INVALID", `${flag} requires a value`);
		}
	}
}

export function readFlag(args, name) {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--")) {
		throw new ContractError("ARGUMENT_INVALID", `${name} requires a value`);
	}
	return value;
}

export function fail(error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 2;
}

export function isMain(metaUrl) {
	if (process.argv[1] === undefined) return false;
	try {
		return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}
