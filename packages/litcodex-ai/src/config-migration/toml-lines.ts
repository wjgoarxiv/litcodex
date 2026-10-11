// Line classification shared by the root-settings writer, the shape validator and uninstall.
//
// Pure. Not a TOML parser: it only knows enough to tell a table header from a line that continues a
// multi-line value, so a row such as `["b"],` inside an array or a `[x]` line inside a `"""` string is
// never taken for a header, and a header with a trailing comment (`[mcp_servers.x] # server`) is.

export type TomlLineKind = "header" | "continuation" | "other";

/**
 * Classify every line. `header`: a table or array-of-tables header outside any open value.
 * `continuation`: a line inside a multi-line array, inline table or `"""`/`'''` string.
 * A value still open at end of file is invalid TOML; its lines are then rescanned as if it had
 * closed on its first line, so an unclosed `[` cannot hide the headers after it.
 */
export function tomlLineKinds(lines: readonly string[]): TomlLineKind[] {
	const kinds: TomlLineKind[] = [];
	scanFrom(lines, 0, kinds);
	return kinds;
}

function scanFrom(lines: readonly string[], start: number, kinds: TomlLineKind[]): void {
	let depth = 0;
	let openString: '"""' | "'''" | null = null;
	let openedAt = -1;
	for (let index = start; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const open = depth > 0 || openString !== null;
		if (open) {
			kinds[index] = "continuation";
		} else if (isTomlTableHeader(line)) {
			kinds[index] = "header";
			continue;
		} else {
			kinds[index] = "other";
		}
		let i = 0;
		while (i < line.length) {
			if (openString !== null) {
				const close = findMultilineClose(line, i, openString);
				if (close === -1) break;
				i = close + 3;
				openString = null;
				continue;
			}
			const ch = line[i];
			if (ch === "#") break;
			if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
				openString = line.startsWith('"""', i) ? '"""' : "'''";
				i += 3;
				continue;
			}
			if (ch === '"' || ch === "'") {
				i = endOfQuoted(line, i);
				continue;
			}
			if (ch === "[" || ch === "{") depth += 1;
			if ((ch === "]" || ch === "}") && depth > 0) depth -= 1;
			i += 1;
		}
		const stillOpen = depth > 0 || openString !== null;
		if (!open && stillOpen) openedAt = index;
		if (!stillOpen) openedAt = -1;
	}
	if (openedAt !== -1) scanFrom(lines, openedAt + 1, kinds);
}

/** A line whose comment-stripped text is `[...]` or `[[...]]`. Callers decide whether it sits inside a value. */
export function isTomlTableHeader(line: string): boolean {
	const bare = stripTomlComment(line).trim();
	return bare.startsWith("[") && bare.endsWith("]");
}

/** Drop a trailing `# comment`, ignoring `#` inside quoted strings (e.g. `[projects."/a#b"]`). */
export function stripTomlComment(line: string): string {
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === "#") return line.slice(0, i);
		i = ch === '"' || ch === "'" ? endOfQuoted(line, i) : i + 1;
	}
	return line;
}

/** Index of the closing delimiter of a multi-line string, honoring `\` escapes in `"""` strings. */
function findMultilineClose(line: string, from: number, delimiter: '"""' | "'''"): number {
	for (let i = from; i < line.length; i += 1) {
		if (delimiter === '"""' && line[i] === "\\") {
			i += 1;
			continue;
		}
		if (line.startsWith(delimiter, i)) return i;
	}
	return -1;
}

/** Index just past a single-line basic (`"…"`, with escapes) or literal (`'…'`) string starting at `start`. */
function endOfQuoted(line: string, start: number): number {
	const quote = line[start];
	let i = start + 1;
	while (i < line.length) {
		if (quote === '"' && line[i] === "\\") {
			i += 2;
			continue;
		}
		if (line[i] === quote) return i + 1;
		i += 1;
	}
	return line.length;
}
