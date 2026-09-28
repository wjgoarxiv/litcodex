import { CodexConfigMigrationError } from "./errors.js";

/**
 * Keep omitted-agent dispatch on Codex's native default role.
 *
 * This is deliberately a nested `agents.default.config_file` setting. The host owns the
 * dispatch semantics; LitCodex only supplies the role file and never invents a global scalar
 * default-model key. Existing user-owned bindings are left byte-for-byte intact. Ambiguous native
 * TOML shapes fail closed because a text rewrite cannot safely decide which binding the host uses.
 */
export function ensureNativeDefaultAgentConfig(
	config: string,
	configFile: string,
	configPath: string | null = null,
): string {
	const scan = scanDefaultBindings(config);
	if (scan.ambiguous !== null) {
		throw new CodexConfigMigrationError(
			"CONFIG_MALFORMED",
			"Codex default-agent binding is ambiguous; refusing to rewrite it.",
			configPath,
			{ reason: scan.ambiguous },
		);
	}
	if (scan.bindingCount > 0 || scan.hasDefaultTable) return config;

	const prefix = config.trimEnd();
	return `${prefix}${prefix.length === 0 ? "" : "\n\n"}[agents.default]\nconfig_file = ${JSON.stringify(configFile)}\n`;
}

interface DefaultBindingScan {
	readonly bindingCount: number;
	readonly hasDefaultTable: boolean;
	readonly ambiguous: string | null;
}

/** Scan only enough TOML to distinguish a single native binding from unsafe alternatives. */
function scanDefaultBindings(config: string): DefaultBindingScan {
	let section: readonly string[] | null = null;
	let multilineCloser: string | null = null;
	let hasDefaultTable = false;
	let bindingCount = 0;
	let defaultTableKind: "header" | "inline" | "dotted" | null = null;

	const ambiguous = (reason: string): DefaultBindingScan => ({ bindingCount, hasDefaultTable, ambiguous: reason });
	const recordBinding = (value: string, shape: string): DefaultBindingScan | null => {
		const parsed = parseStringValue(value);
		if (parsed === null) return ambiguous(`${shape} config_file is not a plain TOML string`);
		bindingCount += 1;
		if (bindingCount > 1) return ambiguous("multiple agents.default config_file bindings");
		return null;
	};
	const recordDefaultTable = (kind: "header" | "inline" | "dotted"): DefaultBindingScan | null => {
		if (defaultTableKind !== null && (defaultTableKind !== kind || kind !== "dotted")) {
			return ambiguous("duplicate agents.default tables");
		}
		defaultTableKind = kind;
		hasDefaultTable = true;
		return null;
	};

	for (const raw of config.split("\n")) {
		if (multilineCloser !== null) {
			if (raw.includes(multilineCloser)) multilineCloser = null;
			continue;
		}
		const line = stripTomlComment(raw);
		const triple = multilineOpener(line);
		if (triple !== null) {
			multilineCloser = triple;
			continue;
		}
		const trimmed = line.trim();
		if (trimmed === "") continue;

		const header = parseHeader(trimmed);
		if (header !== null) {
			section = header.name;
			if (sameKey(header.name, ["agents", "default"])) {
				if (header.array) return ambiguous("agents.default array-of-tables is unsupported");
				const failure = recordDefaultTable("header");
				if (failure !== null) return failure;
			}
			continue;
		}

		const equals = findTopLevelEquals(trimmed);
		if (equals < 0) continue;
		const key = parseKeyPath(trimmed.slice(0, equals));
		if (key === null) continue;
		const value = trimmed.slice(equals + 1).trim();

		const effectiveKey = section === null ? key : [...section, ...key];
		const currentDefaultTable = section !== null && sameKey(section, ["agents", "default"]);
		if (currentDefaultTable && sameKey(key, ["config_file"])) {
			const failure = recordBinding(value, "table");
			if (failure !== null) return failure;
			continue;
		}

		if (effectiveKey.length >= 2 && sameKey(effectiveKey.slice(0, 2), ["agents", "default"])) {
			const inlineDefault =
				sameKey(effectiveKey, ["agents", "default"]) &&
				((section !== null && sameKey(section, ["agents"]) && sameKey(key, ["default"])) ||
					(section === null && sameKey(key, ["agents", "default"])));
			if (!currentDefaultTable) {
				const tableFailure = recordDefaultTable(inlineDefault ? "inline" : "dotted");
				if (tableFailure !== null) return tableFailure;
			}
			if (sameKey(effectiveKey, ["agents", "default", "config_file"])) {
				const failure = recordBinding(value, inlineDefault ? "inline" : "dotted");
				if (failure !== null) return failure;
				continue;
			}
			if (!inlineDefault) continue;
			const inline = scanInlineDefaultTable(value);
			if (inline.ambiguous !== null) return ambiguous(inline.ambiguous);
			if (inline.configFile !== null) {
				const failure = recordBinding(inline.configFile, "inline");
				if (failure !== null) return failure;
			}
		}
	}

	return { bindingCount, hasDefaultTable, ambiguous: null };
}

function parseHeader(line: string): { readonly name: readonly string[]; readonly array: boolean } | null {
	const array = line.startsWith("[[");
	const opening = array ? "[[" : "[";
	const closing = array ? "]]" : "]";
	if (!line.startsWith(opening) || !line.endsWith(closing)) return null;
	const name = parseKeyPath(line.slice(opening.length, -closing.length));
	return name === null || name.length === 0 ? null : { name, array };
}

function sameKey(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((part, index) => part === right[index]);
}

function findTopLevelEquals(line: string): number {
	let quote: '"' | "'" | null = null;
	let escaped = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (quote === '"' && escaped) {
			escaped = false;
			continue;
		}
		if (quote === '"' && char === "\\") {
			escaped = true;
			continue;
		}
		if (quote !== null && char === quote) {
			quote = null;
			continue;
		}
		if (quote === null && (char === '"' || char === "'")) {
			quote = char;
			continue;
		}
		if (quote === null && char === "=") return index;
	}
	return -1;
}

function parseKeyPath(input: string): string[] | null {
	const parts: string[] = [];
	let index = 0;
	while (index < input.length) {
		while (/\s/u.test(input[index] ?? "")) index += 1;
		if (index >= input.length) break;
		const first = input[index];
		let part: string | null;
		if (first === '"' || first === "'") {
			const quote = first;
			const start = index;
			index += 1;
			let escaped = false;
			while (index < input.length) {
				const char = input[index];
				if (quote === '"' && escaped) {
					escaped = false;
					index += 1;
					continue;
				}
				if (quote === '"' && char === "\\") {
					escaped = true;
					index += 1;
					continue;
				}
				if (char === quote) break;
				index += 1;
			}
			if (index >= input.length || input[index] !== quote) return null;
			part = parseStringValue(input.slice(start, index + 1));
			index += 1;
		} else {
			const start = index;
			while (index < input.length && /[A-Za-z0-9_-]/u.test(input[index] ?? "")) index += 1;
			if (start === index) return null;
			part = input.slice(start, index);
		}
		if (part === null) return null;
		parts.push(part);
		while (/\s/u.test(input[index] ?? "")) index += 1;
		if (index >= input.length) return parts;
		if (input[index] !== ".") return null;
		index += 1;
	}
	return parts.length === 0 ? null : parts;
}

function scanInlineDefaultTable(value: string): {
	readonly configFile: string | null;
	readonly ambiguous: string | null;
} {
	const trimmed = value.trim();
	if (!trimmed.startsWith("{")) return { configFile: null, ambiguous: null };
	if (!trimmed.endsWith("}")) return { configFile: null, ambiguous: "default inline table is unterminated" };
	const entries = splitInlineEntries(trimmed.slice(1, -1));
	if (entries === null) return { configFile: null, ambiguous: "default inline table could not be scanned safely" };
	let configFile: string | null = null;
	for (const entry of entries) {
		if (entry.trim() === "") continue;
		const equals = findTopLevelEquals(entry);
		if (equals < 0) return { configFile: null, ambiguous: "default inline table contains an unparseable entry" };
		const key = parseKeyPath(entry.slice(0, equals));
		if (key === null) return { configFile: null, ambiguous: "default inline table contains an unparseable key" };
		if (!sameKey(key, ["config_file"])) continue;
		const valueText = entry.slice(equals + 1).trim();
		if (configFile !== null) return { configFile: null, ambiguous: "multiple agents.default config_file bindings" };
		if (parseStringValue(valueText) === null) {
			return { configFile: null, ambiguous: "inline config_file is not a plain TOML string" };
		}
		configFile = valueText;
	}
	return { configFile, ambiguous: null };
}

function splitInlineEntries(body: string): string[] | null {
	const entries: string[] = [];
	let start = 0;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	let curly = 0;
	let square = 0;
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (quote === '"' && escaped) {
			escaped = false;
			continue;
		}
		if (quote === '"' && char === "\\") {
			escaped = true;
			continue;
		}
		if (quote !== null) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "{") curly += 1;
		if (char === "}") curly -= 1;
		if (char === "[") square += 1;
		if (char === "]") square -= 1;
		if (curly < 0 || square < 0) return null;
		if (char === "," && curly === 0 && square === 0) {
			entries.push(body.slice(start, index));
			start = index + 1;
		}
	}
	if (quote !== null || curly !== 0 || square !== 0) return null;
	entries.push(body.slice(start));
	return entries;
}

function parseStringValue(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return typeof parsed === "string" ? parsed : null;
		} catch {
			return null;
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	return null;
}

function stripTomlComment(line: string): string {
	let quote: '"' | "'" | null = null;
	let escaped = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (quote === '"' && escaped) {
			escaped = false;
			continue;
		}
		if (quote === '"' && char === "\\") {
			escaped = true;
			continue;
		}
		if (quote !== null && char === quote) {
			quote = null;
			continue;
		}
		if (quote === null && (char === '"' || char === "'")) {
			quote = char;
			continue;
		}
		if (quote === null && char === "#") return line.slice(0, index);
	}
	return line;
}

function multilineOpener(line: string): string | null {
	for (const delimiter of ['"""', "'''"]) {
		const opener = line.indexOf(delimiter);
		if (opener >= 0 && line.indexOf(delimiter, opener + delimiter.length) < 0) return delimiter;
	}
	return null;
}
