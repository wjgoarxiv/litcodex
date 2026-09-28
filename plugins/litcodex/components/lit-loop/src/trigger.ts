// src/trigger.ts — M05 bounded lit trigger parser.
//
// Single source of truth for deciding whether a user prompt activates the LitCodex `lit-loop`
// workflow. Pure, side-effect-free, Unicode-aware. Accepts the bounded tokens `lit`, `lit-loop`,
// and `litcodex` (case-insensitive), plus sibling mode tokens that are safe to inject directly.
// Explicit leading `start-work ...` routes execute with the installed skill body, while ordinary
// discussion stays inert and scoped mentions such as `$litcodex:start-work ...` stay native.
// Recap aliases (`litrecap` / `recap` / `리캡`) normalize to the single `lit-recap` token.
// The bare `comprehend` alias normalizes to the `lit-comprehend` token. Rejects
// every substring collision (`split`, `literal`, `litmus`, `lithium`, `glitter`, `flit`, `slit`,
// `litter`, `recapture`, …) while respecting Korean (Hangul) and English boundaries.
//
// This module imports NOTHING from `state-store`, `directive`, `guards`, `markers`, or
// `codex-hook` (one-way: hook → trigger, never the reverse). It reads no files, touches no state,
// emits no hook JSON, and never mutates the prompt. (A3 C9 flat layout; A2 §2.1 export surface.)

import { isAbsolute } from "node:path";
import {
	isCodexSkillMentionToken,
	scopedTokenForBareLit,
	suppressesBareLitAfterCodexSkillMention,
} from "./skill-mention-scope.js";
import { renamedSkillId } from "./skill-renames.js";

/** The accepted bounded lit-family tokens, longest-first (ordering is load-bearing — see below). */
export type LitTriggerToken =
	| "lit-comprehend"
	| "deep-interview"
	| "lit-crucible"
	| "lit-init"
	| "start-work"
	| "review-work"
	| "litresearch"
	| "lit-recap"
	| "lit-loop"
	| "lit-plan"
	| "litcodex"
	| "litgoal"
	| "litwork"
	| "lit";

/**
 * Frozen tuple of the accepted tokens in match-priority (longest-first) order.
 * Exported so tests and the mode router (modes.ts) can enumerate without re-deriving.
 */
export const LIT_TRIGGER_TOKENS: readonly LitTriggerToken[] = Object.freeze([
	"lit-comprehend",
	"deep-interview",
	"lit-crucible",
	"lit-init",
	"start-work",
	"review-work",
	"litresearch",
	"lit-recap",
	"lit-loop",
	"lit-plan",
	"litcodex",
	"litgoal",
	"litwork",
	"lit",
] as const);

/**
 * Bounded token regex kept as a non-global/non-sticky contract fixture for tests and low-level
 * consumers. Hook activation semantics MUST go through `matchLitTrigger()`, which additionally masks
 * Markdown code, ignores slash-command/path tokens except `/litresearch`, and expands natural
 * phrases after bare `lit`.
 * Boundaries: a token must be preceded by start-of-string OR a non `[letter|number|_]` code point,
 * and must NOT be followed by `[letter|number|_|-]`.
 *
 * MUST NOT carry the /g or /y flag: a global regex retains `lastIndex` between calls and would
 * make `.test()` return alternating results for the same input. Longest-first alternation
 * (`lit-comprehend|lit-crucible|lit-init|hyperplan|init-deep|start-work|review-work|litresearch|comprehend|lit-recap|lit-loop|lit-plan|litcodex|litrecap|litgoal|litwork|recap|리캡|lit`)
 * guarantees a longer family token wins over a bare `lit` at the same start; the trailing-`-`
 * lookahead means `lit work` (space) is a bare `lit` while `litwork` (glued) is the work mode.
 * The `litrecap` / `recap` / `리캡` alternatives are ROUTING ALIASES normalized to the canonical
 * `lit-recap` token, and bare `comprehend` normalizes to `lit-comprehend`, by `matchLitTrigger`
 * (they are not members of the token union).
 * No nested quantifiers / no backreferences ⇒ ReDoS-free.
 */
export const LIT_TRIGGER_PATTERN =
	/(?:^|[^\p{L}\p{N}_])(lit-comprehend|deep-interview|lit-crucible|lit-init|hyperplan|init-deep|start-work|review-work|litresearch|comprehend|lit-recap|lit-loop|lit-plan|litcodex|litrecap|litgoal|litwork|recap|리캡|lit)(?![\p{L}\p{N}_-])/iu;

/** Structured result of a successful match. */
export interface LitTriggerMatch {
	/** The normalized accepted token (always lowercase canonical form). */
	token: LitTriggerToken;
	/** The exact source substring that matched, preserving the user's original casing. */
	raw: string;
	/**
	 * UTF-16 code-unit index of the first character of `raw` within the input prompt.
	 *
	 * INFORMATIONAL / DIAGNOSTIC ONLY. This is a UTF-16 code-unit offset (NOT a Unicode
	 * code-point offset). Consumers MUST NOT use it to slice, splice, or index into the
	 * prompt: an astral-plane character (e.g. an emoji) before the token makes the UTF-16
	 * offset diverge from the code-point offset, so slicing by `index` is unsafe by contract.
	 * Use it for logging / ordering ("which match came first") only. If a downstream module
	 * ever needs a surrogate-pair-safe offset, it MUST compute the conversion itself; this
	 * module will never emit a code-point offset.
	 */
	index: number;
}

const NOT_A_STRING = "lit trigger: prompt must be a string";

/**
 * Returns true iff `prompt` contains at least one bounded lit trigger.
 *
 * @param prompt Arbitrary untrusted user text (may be empty, multi-line, mixed-script).
 * @throws TypeError if `prompt` is not a string (defensive guard for `unknown` callers).
 */
export function isLitTriggerPrompt(prompt: string): boolean {
	if (typeof prompt !== "string") {
		throw new TypeError(NOT_A_STRING);
	}
	return matchLitTrigger(prompt) !== null;
}

/**
 * Returns the FIRST bounded lit trigger match in document order, or null if none.
 * Deterministic: identical input always yields the identical result.
 *
 * @param prompt Arbitrary untrusted user text.
 * @returns LitTriggerMatch for the earliest match (lowest `index`), else null.
 * @throws TypeError if `prompt` is not a string.
 */
export function matchLitTrigger(prompt: string): LitTriggerMatch | null {
	if (typeof prompt !== "string") {
		throw new TypeError(NOT_A_STRING);
	}
	if (/^\/\$litcodex:[A-Za-z0-9_-]+(?:\s|$)/iu.test(prompt)) return null;
	const explicitStartWork = explicitStartWorkPrefix(prompt);
	if (explicitStartWork !== null && hasValidStartWorkGrammar(prompt)) {
		return { token: "start-work", raw: explicitStartWork, index: 0 };
	}
	const searchable = maskMarkdownCode(prompt);
	const scan =
		/(?:^|[^\p{L}\p{N}_])(lit-comprehend|deep-interview|lit-crucible|lit-init|hyperplan|init-deep|start-work|review-work|litresearch|comprehend|lit-recap|lit-loop|lit-plan|litcodex|litrecap|litgoal|litwork|recap|리캡|lit)(?![\p{L}\p{N}_-])/giu;
	for (const m of searchable.matchAll(scan)) {
		const raw = m[1];
		if (raw === undefined) {
			continue;
		}
		const index = (m.index ?? 0) + m[0].length - raw.length;
		const lowered = raw.toLowerCase();
		// Canonicalize routing aliases: litrecap / recap / 리캡 → lit-recap; comprehend → lit-comprehend.
		const token: LitTriggerToken =
			lowered === "litrecap" || lowered === "recap" || lowered === "리캡"
				? "lit-recap"
				: lowered === "comprehend"
					? "lit-comprehend"
					: ((renamedSkillId(lowered) ?? lowered) as LitTriggerToken);
		if (isSlashCommandOrPathToken(prompt, index, token)) {
			if (index === 1) {
				return null;
			}
			continue;
		}
		if (isCodexSkillMentionToken(prompt, index)) {
			continue;
		}
		const phrase = raw.toLowerCase() === "lit" ? naturalPhraseAfterLit(prompt, searchable, index, raw.length) : null;
		if (phrase !== null) {
			if (phrase.token === "start-work" && !hasExplicitStartWorkPrefix(prompt, index, false)) {
				continue;
			}
			if (phrase.token === "start-work" && !hasValidStartWorkGrammar(prompt)) continue;
			return phrase;
		}
		if (raw.toLowerCase() === "lit" && suppressesBareLitAfterCodexSkillMention(prompt, index)) {
			continue;
		}
		const scopedToken = raw.toLowerCase() === "lit" ? scopedTokenForBareLit(prompt, index) : null;
		if (scopedToken !== null) {
			return { token: scopedToken, raw: prompt.slice(index, index + raw.length), index };
		}
		if (token === "start-work" && !hasExplicitStartWorkPrefix(prompt, index, true)) {
			continue;
		}
		if (token === "start-work" && !hasValidStartWorkGrammar(prompt)) continue;
		return { token, raw: prompt.slice(index, index + raw.length), index };
	}
	return null;
}

const hasExplicitStartWorkPrefix = (prompt: string, tokenIndex: number, allowDollar: boolean): boolean =>
	(allowDollar ? /^\s*\$?$/u : /^\s*$/u).test(prompt.slice(0, tokenIndex));

function hasValidStartWorkGrammar(prompt: string): boolean {
	if (/[^\S ]/u.test(prompt) || prompt.includes("  ")) return false;
	const route = prompt.match(/^(?:start-work|\$start-work|lit start work|\$litcodex:start-work)(?: (.+))?$/u);
	if (route === null) return false;
	let rest = route[1] ?? "";
	const worktreeMarkers = [...rest.matchAll(/(?:^| )--worktree /g)];
	if (worktreeMarkers.length > 1) return false;
	if (worktreeMarkers.length === 1) {
		const marker = worktreeMarkers[0];
		if (marker === undefined || marker.index === undefined) return false;
		const worktree = rest.slice(marker.index + marker[0].length);
		if (worktree.length === 0 || !isAbsolute(worktree) || / --\S/.test(worktree)) {
			return false;
		}
		rest = rest.slice(0, marker.index);
	}
	const flags =
		rest.match(/^--resume ([^ ]+) --grant ([^ ]+)$/u) ?? rest.match(/^(.*?) --resume ([^ ]+) --grant ([^ ]+)$/u);
	const selector = flags?.[1] === undefined ? rest : flags.length === 3 ? "" : flags[1];
	const resume = flags === null ? undefined : flags.length === 3 ? flags[1] : flags[2];
	const grant = flags === null ? undefined : flags.length === 3 ? flags[2] : flags[3];
	return !selector.includes("--") && (resume === undefined) === (grant === undefined);
}

function explicitStartWorkPrefix(prompt: string): string | null {
	for (const prefix of ["$litcodex:start-work", "lit start work", "$start-work", "start-work"] as const) {
		if (prompt === prefix || prompt.startsWith(`${prefix} `)) return prefix;
	}
	return null;
}

function naturalPhraseAfterLit(
	prompt: string,
	searchable: string,
	index: number,
	rawLength: number,
): LitTriggerMatch | null {
	const start = index + rawLength;
	const rest = searchable.slice(start);
	const m =
		/^(\s+)(start\s+work|deep\s+interview|lit-crucible|lit-init|hyperplan|init-deep|comprehend|plan|review|research|goal|recap)(?![\p{L}\p{N}_-])/iu.exec(
			rest,
		);
	if (m === null || m[1] === undefined || m[2] === undefined) {
		return null;
	}
	const normalized = m[2].toLowerCase().replace(/\s+/g, " ");
	const tokenByPhrase: Record<string, LitTriggerToken> = {
		"start work": "start-work",
		"deep interview": "deep-interview",
		"lit-crucible": "lit-crucible",
		hyperplan: "lit-crucible",
		"lit-init": "lit-init",
		"init-deep": "lit-init",
		comprehend: "lit-comprehend",
		plan: "lit-plan",
		review: "review-work",
		research: "litresearch",
		goal: "litgoal",
		recap: "lit-recap",
	};
	const token = tokenByPhrase[normalized];
	if (token === undefined) {
		return null;
	}
	const rawLengthWithPhrase = rawLength + m[1].length + m[2].length;
	return { token, raw: prompt.slice(index, index + rawLengthWithPhrase), index };
}

function isSlashCommandOrPathToken(prompt: string, tokenIndex: number, token: LitTriggerToken): boolean {
	const prev = prompt[tokenIndex - 1];
	if (prev !== "/") {
		return false;
	}
	const slashRouteRest = prompt.slice(tokenIndex + token.length);
	return !(token === "litresearch" && tokenIndex === 1 && /^(?:\s|$)/u.test(slashRouteRest));
}

function maskRange(chars: string[], start: number, end: number): void {
	for (let i = start; i < end; i += 1) {
		if (chars[i] !== "\n" && chars[i] !== "\r") {
			chars[i] = " ";
		}
	}
}

function maskInlineCode(chars: string[], input: string, start: number, end: number): void {
	let i = start;
	while (i < end) {
		if (input[i] !== "`") {
			i += 1;
			continue;
		}
		let ticks = 1;
		while (i + ticks < end && input[i + ticks] === "`") {
			ticks += 1;
		}
		let close = -1;
		for (let j = i + ticks; j < end; j += 1) {
			let run = 0;
			while (run < ticks && input[j + run] === "`") {
				run += 1;
			}
			if (run === ticks) {
				close = j + ticks;
				break;
			}
		}
		if (close === -1) {
			maskRange(chars, i, end);
			return;
		}
		maskRange(chars, i, close);
		i = close;
	}
}

export function maskMarkdownCode(input: string): string {
	const chars = input.split("");
	let offset = 0;
	let fenceChar: "`" | "~" | null = null;
	let fenceLen = 0;
	for (const line of input.match(/.*(?:\r\n|\n|\r|$)/g) ?? []) {
		if (line === "" && offset >= input.length) {
			break;
		}
		const lineStart = offset;
		const lineEnd = offset + line.length;
		const withoutNewline = line.replace(/[\r\n]+$/, "");
		const fence = withoutNewline.match(/^ {0,3}(`{3,}|~{3,})/);
		if (fenceChar !== null) {
			maskRange(chars, lineStart, lineEnd);
			if (fence?.[1]?.startsWith(fenceChar) === true && fence[1].length >= fenceLen) {
				fenceChar = null;
				fenceLen = 0;
			}
		} else if (fence?.[1] !== undefined) {
			fenceChar = fence[1][0] as "`" | "~";
			fenceLen = fence[1].length;
			maskRange(chars, lineStart, lineEnd);
		} else {
			maskInlineCode(chars, input, lineStart, lineEnd);
		}
		offset = lineEnd;
	}
	return chars.join("");
}
