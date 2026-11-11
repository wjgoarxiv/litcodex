// Strict JSON parsing and an entry-point check for the repository's QA scripts (installed-surface probes,
// install smoke, locked-host check). They lived in the visual-qa skill until it moved out of LitCodex;
// the scripts keep the same behavior: duplicate keys, trailing data and NUL bytes are refused.
import { realpathSync } from "node:fs";
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

export function isMain(metaUrl) {
	if (process.argv[1] === undefined) return false;
	try {
		return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}
