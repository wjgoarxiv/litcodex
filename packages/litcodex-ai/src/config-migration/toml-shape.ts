// M13 — validateTomlShape structural gate (S13 addendum Gap B).
//
// The SOLE gate between "backup + CONFIG_MALFORMED exit 2" (install) and
// "proceed to surgical rewrite". The accept/reject boundary is the CLOSED
// grammar R1/R2/R3; nothing outside these three rules is rejected. Pure, never
// throws. Returns the FIRST violation (R1 -> R2 -> R3, scanning top-to-bottom).
//
// Accepts exotic-but-valid TOML: multiline strings ("""/'''), arrays-of-tables
// ([[...]]), inline arrays/tables, section-scoped clipped strings.

export type TomlShapeRejection =
	| "unterminated-string" // Rule R1
	| "unbalanced-section-header" // Rule R2
	| "duplicate-multi-agent-v2"; // Rule R3

export interface TomlShapeResult {
	ok: boolean;
	reason: TomlShapeRejection | null;
	line: number | null;
}

const WELL_FORMED_HEADER = /^\s*\[\[?[^[\]]+\]\]?\s*(?:#[^\n]*)?$/;
const GUARD_HEADER = "[features.multi_agent_v2]";

/** Validate the structural shape. Pure, never throws. */
export function validateTomlShape(config: string): TomlShapeResult {
	const lines = config.split(/\n/);
	let inRoot = true;
	let guardCount = 0;
	let multilineCloser: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		const lineNo = i + 1;

		// Inside an open multiline string: skip until the closer appears.
		if (multilineCloser !== null) {
			if (raw.includes(multilineCloser)) {
				multilineCloser = null;
			}
			continue;
		}

		const trimmed = raw.trim();
		const isHeader = trimmed.startsWith("[");

		if (isHeader) {
			// R2 — unbalanced [section] header. Strip quoted key segments FIRST so brackets inside a
			// quoted key (e.g. a Windows project path `[projects."C:\…\[INBOX] MEMOS"]`, which Codex
			// writes verbatim and is valid TOML) are not mistaken for stray section brackets.
			if (!WELL_FORMED_HEADER.test(stripQuotedSpans(raw))) {
				return reject("unbalanced-section-header", lineNo);
			}
			// R3 — duplicate [features.multi_agent_v2] table.
			if (stripInlineComment(trimmed) === GUARD_HEADER) {
				guardCount += 1;
				if (guardCount >= 2) {
					return reject("duplicate-multi-agent-v2", lineNo);
				}
			}
			inRoot = false;
			continue;
		}

		// R1 — only root-scope scalar lines are checked.
		if (inRoot) {
			const opener = multilineOpener(raw);
			if (opener !== null) {
				// A multiline opener whose closer is NOT on the same line opens a block.
				multilineCloser = opener;
				continue;
			}
			if (hasUnterminatedQuote(raw, '"') || hasUnterminatedQuote(raw, "'")) {
				return reject("unterminated-string", lineNo);
			}
		}
	}

	return { ok: true, reason: null, line: null };
}

function reject(reason: TomlShapeRejection, line: number): TomlShapeResult {
	return { ok: false, reason, line };
}

/**
 * Detect a multiline-string opener (`"""` or `'''`) whose closing delimiter is
 * NOT present later on the same line. Returns the closer delimiter when the
 * block stays open, else null.
 */
function multilineOpener(line: string): string | null {
	for (const delim of ['"""', "'''"]) {
		const open = line.indexOf(delim);
		if (open === -1) {
			continue;
		}
		const close = line.indexOf(delim, open + delim.length);
		if (close === -1) {
			return delim;
		}
	}
	return null;
}

/**
 * R1 detection for a single delimiter: count unescaped delimiters on the value
 * side of the `=`. An ODD count means the opening quote is never closed.
 */
function hasUnterminatedQuote(line: string, delim: string): boolean {
	const eq = line.indexOf("=");
	if (eq === -1) {
		return false;
	}
	const value = line.slice(eq + 1);
	let count = 0;
	let backslashes = 0;
	for (const ch of value) {
		if (ch === delim) {
			// `"` counts only when preceded by an even number of backslashes.
			if (backslashes % 2 === 0) {
				count += 1;
			}
		}
		backslashes = ch === "\\" ? backslashes + 1 : 0;
	}
	return count % 2 === 1;
}

function stripInlineComment(line: string): string {
	const idx = line.indexOf("#");
	return idx === -1 ? line.trim() : line.slice(0, idx).trim();
}

/**
 * Replace every quoted span (basic `"…"` or literal `'…'`) with a single inert placeholder, so a
 * structural scan never sees `[`, `]`, `#`, or quote chars that live INSIDE a TOML string. Basic
 * strings honor `\` escapes (so an escaped quote doesn't close early); literal strings do not.
 * Used to bracket-balance a section header whose key may contain a quoted path (e.g. `[INBOX]`).
 */
function stripQuotedSpans(line: string): string {
	let out = "";
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === '"' || ch === "'") {
			out += "Q"; // the whole quoted span collapses to one bracket-free key token
			i += 1;
			while (i < line.length) {
				if (ch === '"' && line[i] === "\\") {
					i += 2; // skip an escaped char in a basic string (e.g. \" or \\)
					continue;
				}
				if (line[i] === ch) {
					i += 1; // closing quote
					break;
				}
				i += 1;
			}
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}
