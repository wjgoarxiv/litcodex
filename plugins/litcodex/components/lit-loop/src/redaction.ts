// src/redaction.ts — prompt/evidence secret redaction helpers.
// Pure, deterministic, and intentionally conservative: user text may be persisted into brief.md,
// goals.json, ledger.jsonl, and Codex goal handoff output, so known secret shapes are replaced before
// state writes or model-facing payload rendering.

export const REDACTED_SECRET = "[REDACTED_SECRET]" as const;

const DIRECT_SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
	/\bsk-[A-Za-z0-9_-]{20,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g,
	/\b(?:glpat|gloas|gldt|glrt|glcbt)-[A-Za-z0-9_-]{8,}\b/g,
	/\b(?:xox[baprs]|xapp)-[A-Za-z0-9-]{8,}\b/g,
	/\bnpm_[A-Za-z0-9_-]{8,}\b/g,
	/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{10,}\b/g,
	/\bwhsec_[A-Za-z0-9_-]{10,}\b/g,
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/giu,
	/\bAIza[A-Za-z0-9_-]{20,}\b/g,
	/\bhf_[A-Za-z0-9_-]{20,}\b/g,
	/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
	/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
]);

// A value that is nothing but a short lowercase word is ordinary English, not a credential: real
// bearer/basic payloads and generated secrets are base64, hex, JWT, or otherwise mixed-case. This
// guard is applied only where the surrounding key is itself an English word, so `password=correct`
// still redacts while `Secret: the plan is simple` survives byte-identical. The cost is that a
// credential deliberately written as a bare lowercase word after an ambiguous key is not caught.
const PROSE_VALUE = /(?![a-z]{1,19}(?:[\s"'`]|$))/.source;

// Keys that are never ordinary prose: redact whatever value follows, including a plain word.
const HIGH_SIGNAL_KEY_VALUE_SECRET =
	/\b((?:(?:[A-Za-z][A-Za-z0-9]*[_-]+)*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|credential|passphrase|password|private[_-]?key|refresh[_-]?token|_auth(?:token)?)(?:[_-]+[A-Za-z0-9]+)*)\s*[=:]\s*)([^\s"'`]+)/giu;
// `auth`, `secret`, and `token` are also everyday English, so they require a credential-shaped value.
const COMPACT_AMBIGUOUS_KEY_VALUE_SECRET =
	/\b((?:(?:[A-Za-z][A-Za-z0-9]*[_-]+)*(?:auth|secret|token)(?:[_-]+[A-Za-z0-9]+)*)(?:\s*=\s*|:))([^\s"'`]+)/giu;
const AMBIGUOUS_KEY_VALUE_SECRET = new RegExp(
	`\\b((?:(?:[A-Za-z][A-Za-z0-9]*[_-]+)*(?:auth|secret|token)(?:[_-]+[A-Za-z0-9]+)*)\\s*[=:]\\s*)(${PROSE_VALUE}[^\\s"'\`]+)`,
	"giu",
);
const AUTH_HEADER_SECRET = /\b((?:(?:Proxy-Authorization|Authorization)[ \t]*:[ \t]*)[^\s"'`:]+[ \t]+)([^\s"'`]+)/giu;
// A bare `Bearer`/`Basic` scheme carries far less signal than an Authorization header, and "a basic
// dashboard" is ordinary prose, so the payload must look like a credential.
const BARE_AUTH_SCHEME_SECRET = new RegExp(`\\b((?:Bearer|Basic)[ \t]+)(${PROSE_VALUE}[^\\s"'\`]+)`, "giu");
const GENERIC_AUTH_HEADER_SECRET =
	/\b((?:Proxy-Authorization|Authorization)[ \t]*:[ \t]*)([^\r\n]*\S[^\r\n]*)(?=\r?$)/gimu;
const URI_USERINFO = /((?:[a-z][a-z0-9+.-]*:\/\/|\/\/))[^/?#\s]*@/giu;
const PRIVATE_KEY_SECRET =
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/giu;
const PRIVATE_KEY_MARKER_SECRET = /-----(?:BEGIN|END) [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/giu;

type RedactionRule = {
	readonly pattern: RegExp;
	readonly replacement: (match: RegExpMatchArray) => string;
};

const REDACTION_RULES: readonly RedactionRule[] = Object.freeze([
	{ pattern: URI_USERINFO, replacement: (match: RegExpMatchArray) => match[1] ?? "" },
	{ pattern: PRIVATE_KEY_SECRET, replacement: () => REDACTED_SECRET },
	{ pattern: PRIVATE_KEY_MARKER_SECRET, replacement: () => REDACTED_SECRET },
	{
		pattern: GENERIC_AUTH_HEADER_SECRET,
		replacement: (match: RegExpMatchArray) => `${match[1] ?? ""}${REDACTED_SECRET}`,
	},
	{
		pattern: AUTH_HEADER_SECRET,
		replacement: (match: RegExpMatchArray) => `${match[1] ?? ""}${REDACTED_SECRET}`,
	},
	{
		pattern: BARE_AUTH_SCHEME_SECRET,
		replacement: (match: RegExpMatchArray) => `${match[1] ?? ""}${REDACTED_SECRET}`,
	},
	// High-signal keys are matched before the ambiguous set so `auth_token: none` still redacts.
	{
		pattern: HIGH_SIGNAL_KEY_VALUE_SECRET,
		replacement: (match: RegExpMatchArray) => `${match[1] ?? ""}${REDACTED_SECRET}`,
	},
	{
		pattern: COMPACT_AMBIGUOUS_KEY_VALUE_SECRET,
		replacement: (match: RegExpMatchArray) => `${match[1] ?? ""}${REDACTED_SECRET}`,
	},
	{
		pattern: AMBIGUOUS_KEY_VALUE_SECRET,
		replacement: (match: RegExpMatchArray) => `${match[1] ?? ""}${REDACTED_SECRET}`,
	},
	...DIRECT_SECRET_PATTERNS.map((pattern) => ({
		pattern,
		replacement: () => REDACTED_SECRET,
	})),
]);

const C1_CSI = /^\u009b[0-?]*[ -/]*[@-~]/u;
const OBFUSCATION_CONTROL = /[\p{Cc}\p{Cf}]/u;

type NormalizedView = {
	readonly text: string;
	readonly sourceStarts: readonly number[];
	readonly sourceEnds: readonly number[];
};

type RedactionEdit = {
	readonly start: number;
	readonly end: number;
	readonly replacement: string;
	readonly order: number;
};

function normalizedView(text: string, preserveControlBoundaries: boolean): NormalizedView {
	let normalized = "";
	const sourceStarts: number[] = [];
	const sourceEnds: number[] = [];
	const append = (value: string, start: number, end: number): void => {
		normalized += value;
		for (let index = 0; index < value.length; index += 1) {
			sourceStarts.push(start);
			sourceEnds.push(end);
		}
	};

	for (let offset = 0; offset < text.length; ) {
		if (text[offset] === "\u009b") {
			const sequence = text.slice(offset).match(C1_CSI);
			if (sequence !== null) {
				if (preserveControlBoundaries) {
					append(" ", offset, offset + sequence[0].length);
				}
				offset += sequence[0].length;
				continue;
			}
		}
		const codePoint = text.codePointAt(offset);
		if (codePoint === undefined) break;
		const character = String.fromCodePoint(codePoint);
		const end = offset + character.length;
		if (OBFUSCATION_CONTROL.test(character)) {
			if (character === "\t" || character === "\n" || character === "\r") {
				append(character, offset, end);
			} else if (preserveControlBoundaries) {
				append(" ", offset, end);
			}
		} else {
			append(character, offset, end);
		}
		offset = end;
	}

	return { text: normalized, sourceStarts, sourceEnds };
}

function collectRedactionEdits(view: NormalizedView): RedactionEdit[] {
	const edits: RedactionEdit[] = [];
	for (const [order, rule] of REDACTION_RULES.entries()) {
		const matcher = new RegExp(rule.pattern.source, rule.pattern.flags);
		for (const match of view.text.matchAll(matcher)) {
			const matched = match[0];
			if (match.index === undefined || matched.length === 0) continue;
			const lastIndex = match.index + matched.length - 1;
			const start = view.sourceStarts[match.index];
			const end = view.sourceEnds[lastIndex];
			if (start === undefined || end === undefined) continue;
			edits.push({ start, end, replacement: rule.replacement(match), order });
		}
	}
	return edits;
}

function applyRedactionEdits(text: string, edits: RedactionEdit[]): string {
	const selected: RedactionEdit[] = [];
	for (const edit of edits.sort(
		(first, second) =>
			first.start - second.start ||
			second.end - second.start - (first.end - first.start) ||
			first.order - second.order,
	)) {
		const previous = selected.at(-1);
		if (previous !== undefined && edit.start < previous.end) continue;
		selected.push(edit);
	}
	for (let index = selected.length - 1; index >= 0; index -= 1) {
		const edit = selected[index];
		if (edit === undefined) continue;
		text = `${text.slice(0, edit.start)}${edit.replacement}${text.slice(edit.end)}`;
	}
	return text;
}

export function redactSecrets(text: string): string {
	if (typeof text !== "string" || text.length === 0) {
		return text;
	}
	const stripped = normalizedView(text, false);
	const spaced = normalizedView(text, true);
	return applyRedactionEdits(text, [...collectRedactionEdits(stripped), ...collectRedactionEdits(spaced)]);
}

export function redactSecretsInValue<T>(value: T): T {
	if (typeof value === "string") {
		return redactSecrets(value) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactSecretsInValue(item)) as T;
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			out[key] = redactSecretsInValue(item);
		}
		return out as T;
	}
	return value;
}
