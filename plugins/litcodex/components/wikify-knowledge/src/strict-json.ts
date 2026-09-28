const jsonWhitespace = (character: string | undefined): boolean =>
	character === " " || character === "\t" || character === "\r" || character === "\n";

export function decodeStrictUtf8(bytes: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function parseStrictJson(text: string): unknown {
	if (hasDuplicateJsonObjectKey(text)) throw new Error("Duplicate JSON object key.");
	return JSON.parse(text) as unknown;
}

function hasDuplicateJsonObjectKey(text: string): boolean {
	const objects: Set<string>[] = [];
	let index = 0;
	while (index < text.length) {
		const character = text[index];
		if (character === undefined) return false;
		if (character === '"') {
			const token = scanJsonString(text, index);
			if (token === undefined) return false;
			index = token.end;
			while (index < text.length && jsonWhitespace(text[index])) index += 1;
			const currentObject = objects.at(-1);
			if (text[index] === ":" && currentObject !== undefined) {
				if (currentObject.has(token.value)) return true;
				currentObject.add(token.value);
			}
			continue;
		}
		if (character === "{") objects.push(new Set());
		else if (character === "}") objects.pop();
		index += 1;
	}
	return false;
}

function scanJsonString(text: string, start: number): { end: number; value: string } | undefined {
	let index = start + 1;
	let value = "";
	while (index < text.length) {
		const character = text[index];
		if (character === undefined) return undefined;
		index += 1;
		if (character === '"') return { end: index, value };
		if (character !== "\\") {
			if (character.charCodeAt(0) < 0x20) return undefined;
			value += character;
			continue;
		}
		const escapeCode = text[index];
		if (escapeCode === undefined) return undefined;
		index += 1;
		switch (escapeCode) {
			case '"':
			case "\\":
			case "/":
				value += escapeCode;
				break;
			case "b":
				value += "\b";
				break;
			case "f":
				value += "\f";
				break;
			case "n":
				value += "\n";
				break;
			case "r":
				value += "\r";
				break;
			case "t":
				value += "\t";
				break;
			case "u": {
				const code = text.slice(index, index + 4);
				if (!/^[0-9a-f]{4}$/iu.test(code)) return undefined;
				value += String.fromCharCode(Number.parseInt(code, 16));
				index += 4;
				break;
			}
			default:
				return undefined;
		}
	}
	return undefined;
}
