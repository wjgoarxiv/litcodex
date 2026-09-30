// tools/readme-audit.mjs — M16 README docs-audit (npm run docs:audit).
//
// Pure auditReadme(text, contract) computes a ReadmeAuditReport from README text + the frozen
// contract; the CLI wrapper does file I/O, JSON encoding, and exit-code mapping. Bounded
// legacy-token matching is delegated to the M04 scanner's matchToken (C10: "scanner clean" ⇔
// "guard clean"), so a token only matches on word/path-segment boundaries — benign English
// (chromosome, homogeneous, restart-workflow) never false-positives.
//
// Exit codes (CLI): 0 = all checks pass; 1 = content failure (offenders); 2 = operational
// error (README unreadable, or readme-contract.json missing/malformed) — fail-closed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { matchToken } from "./scan-legacy-tokens.mjs";

const DEFAULT_CONTRACT_PATH = fileURLToPath(new URL("./readme-contract.json", import.meta.url));

// Top-level CLI routes (M03/M12 runCli surface). Loop subcommands are validated separately.
// Mirrors packages/litcodex-ai/src/cli.ts ROUTES keys (install/doctor/uninstall/config/loop/hook)
// plus the position-independent --help/--version. `config` and `hook` are sub-routed below.
export const TOP_LEVEL_ROUTES = Object.freeze([
	"install",
	"doctor",
	"office-runtime",
	"motion-runtime",
	"uninstall",
	"config",
	"loop",
	"hook",
	"--help",
	"--version",
]);

// M09 loop subcommands. Imported lazily inside the CLI to keep auditReadme pure + dependency-free;
// the test imports LOOP_SUBCOMMANDS directly and cross-checks. Mirrored here as the routability set.
export const LOOP_SUBCOMMANDS = Object.freeze([
	"help",
	"create",
	"status",
	"run",
	"checkpoint",
	"record-evidence",
	"doctor",
]);

// Sub-routes for the two two-token top-level routes (cli.ts: `config migrate`, `hook
// user-prompt-submit|stop|session-start|post-compact`). A `config`/`hook` invocation is only routable
// with the matching sub-token.
export const CONFIG_SUBCOMMANDS = Object.freeze(["migrate"]);
export const HOOK_SUBCOMMANDS = Object.freeze(["user-prompt-submit", "stop", "session-start", "post-compact"]);
export const OFFICE_RUNTIME_SUBCOMMANDS = Object.freeze(["install", "status"]);
export const MOTION_RUNTIME_SUBCOMMANDS = Object.freeze(["install", "status"]);

// Fixed, contract-derived non-gating claims (G16.2): descriptive claims the audit deliberately
// does NOT verify against the live Codex host. Emitted verbatim so the report self-documents the
// gate boundary (consistency-only, never liveness).
const NON_GATING_CLAIMS = Object.freeze([
	{ claim: "~/.codex/config.toml is the Codex-managed config path", reason: "live-host-descriptive" },
	{ claim: "litcodex loop <sub> behaves correctly against a live Codex host", reason: "live-host-descriptive" },
]);

/**
 * Bounded legacy-token matcher (C10 / G16.5). Returns the 1-based line of the FIRST bounded match
 * of `token` in `text`, or null. Path-shaped tokens (containing "/" or ".") reuse the same boundary
 * class with "/" and "." treated as token-internal delimiters, so a path-segment token matches when
 * it stands alone (`<dot>seg/foo`) but not when its segment is glued to a longer word.
 * @param {string} text
 * @param {string} token
 * @returns {{line:number}|null}
 */
export function findBoundedToken(text, token) {
	const lines = text.split(/\r?\n/);
	const pathShaped = token.includes("/") || token.includes(".");
	for (let i = 0; i < lines.length; i++) {
		if (pathShaped) {
			if (matchPathToken(lines[i], token.toLowerCase()) !== -1) return { line: i + 1 };
		} else if (matchToken(lines[i], token.toLowerCase(), "bounded").length > 0) {
			return { line: i + 1 };
		}
	}
	return null;
}

// Word/path boundary char class: a char that ENDS a token (its absence on a side = boundary).
function isPathWordChar(c) {
	return c !== "" && /[a-z0-9_-]/i.test(c);
}

/**
 * Path-shaped token match: the token's own "/" and "." are token-internal delimiters, so only the
 * OUTER edges are boundary-checked. A path-segment token matches when it stands alone (left edge = a
 * non-word neighbor, the trailing "/" being its own right boundary) but NOT when its segment is glued
 * to a longer word (the trailing segment followed by a word char). Returns the match offset or -1.
 */
function matchPathToken(line, token) {
	const lc = line.toLowerCase();
	const lastChar = token[token.length - 1];
	const firstChar = token[0];
	let from = 0;
	for (;;) {
		const i = lc.indexOf(token, from);
		if (i === -1) return -1;
		const before = i === 0 ? "" : lc[i - 1];
		const after = i + token.length >= lc.length ? "" : lc[i + token.length];
		// Left edge: if the token starts with a word char, require a non-word neighbor; if it
		// starts with punctuation (".", "/"), that punctuation is itself the boundary.
		const leftOk = !isPathWordChar(firstChar) || !isPathWordChar(before);
		// Right edge: same logic for the trailing char.
		const rightOk = !isPathWordChar(lastChar) || !isPathWordChar(after);
		if (leftOk && rightOk) return i;
		from = i + 1;
	}
}

/** First 1-based line that contains `needle` (case-insensitive substring), or null. */
function findPhraseLine(text, needle) {
	const lc = needle.toLowerCase();
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].toLowerCase().includes(lc)) return { line: i + 1 };
	}
	return null;
}

/**
 * Strip a leading global-or-npx invocation prefix, then return the subcommand word for route-checking,
 * or null if the line is not a litcodex invocation (G16.1). Accepted prefixes (exact):
 * "litcodex " | "npx --yes litcodex-ai ".
 * @param {string} commandLine
 * @returns {string|null}
 */
export function extractLitcodexSubcommand(commandLine) {
	const trimmed = commandLine.trim();
	let rest = null;
	const scoped = trimmed.match(
		/^npm exec --yes --package @litfamily\/litcodex@(?:[0-9]+\.[0-9]+\.[0-9]+|latest) -- litcodex (.*)$/,
	);
	if (scoped) {
		rest = scoped[1];
	} else if (trimmed.startsWith("npx --yes litcodex-ai ")) {
		rest = trimmed.slice("npx --yes litcodex-ai ".length);
	} else if (trimmed.startsWith("litcodex ")) {
		rest = trimmed.slice("litcodex ".length);
	}
	if (rest === null) return null;
	const first = rest.trim().split(/\s+/)[0];
	return first === "" ? null : first;
}

// Heading line for a required section anchor: ^#{1,2} <anchor-text>, trailing space tolerated.
// "## What is LitCodex" accepts "## What is this" as an alternate.
function sectionMatches(line, anchor) {
	const norm = line.replace(/\s+$/, "");
	if (norm === anchor) return true;
	if (anchor === "## What is LitCodex" && norm === "## What is this") return true;
	return false;
}

/**
 * Pure: given README text + contract, compute the audit report. No I/O.
 * @param {string} text
 * @param {{requiredSections:string[],requiredPhrases:string[],requiredCommands:string[],requiredSkillIds?:string[],forbiddenTokens:Array<string|{parts:string[]}>,forbiddenPhrases:Array<string|{parts:string[]}>}} contract
 * @param {string} [readmePath]
 */
export function auditReadme(text, contractRaw, readmePath = "") {
	const contract = normalizeContract(contractRaw);
	const lines = text.split(/\r?\n/);
	const offenders = [];

	// 1. Sections: locate each anchor as a heading line, in order.
	let searchFrom = 0;
	let lastFoundLine = -1;
	for (const anchor of contract.requiredSections) {
		let foundAt = -1;
		for (let i = searchFrom; i < lines.length; i++) {
			if (sectionMatches(lines[i], anchor)) {
				foundAt = i;
				break;
			}
		}
		if (foundAt === -1) {
			// Maybe it exists earlier (out of order) — scan the whole doc to disambiguate.
			let anywhere = -1;
			for (let i = 0; i < lines.length; i++) {
				if (sectionMatches(lines[i], anchor)) {
					anywhere = i;
					break;
				}
			}
			if (anywhere === -1) {
				offenders.push({ kind: "missing-section", value: anchor, line: null });
			} else {
				offenders.push({ kind: "section-out-of-order", value: anchor, line: anywhere + 1 });
			}
		} else {
			if (foundAt <= lastFoundLine) {
				offenders.push({ kind: "section-out-of-order", value: anchor, line: foundAt + 1 });
			}
			lastFoundLine = foundAt;
			searchFrom = foundAt + 1;
		}
	}

	// 2. Phrases.
	for (const phrase of contract.requiredPhrases) {
		if (!text.includes(phrase)) {
			offenders.push({ kind: "missing-phrase", value: phrase, line: null });
		}
	}

	// 3. Commands: presence.
	for (const command of contract.requiredCommands) {
		if (!text.includes(command)) {
			offenders.push({ kind: "missing-command", value: command, line: null });
		}
	}

	// 4. User-visible bundled skill inventory (bounded exact IDs, not substrings).
	for (const skillId of contract.requiredSkillIds) {
		if (!findBoundedToken(text, skillId)) {
			offenders.push({ kind: "missing-skill-id", value: skillId, line: null });
		}
	}

	// 5. Command-surface consistency: every documented `litcodex loop <word>`,
	//    `litcodex <word>`, and `npx --yes litcodex-ai <word>` must be routable.
	const loopRe = /\b(?:litcodex|npx --yes litcodex-ai) loop (--?[a-z][\w-]*|[a-z][\w-]*)/g;
	for (const m of text.matchAll(loopRe)) {
		const sub = m[1];
		if (sub.startsWith("--")) continue; // flags like --json on a loop command are fine
		if (!LOOP_SUBCOMMANDS.includes(sub)) {
			offenders.push({
				kind: "unknown-subcommand",
				value: `litcodex loop ${sub}`,
				line: lineOfIndex(text, m.index),
			});
		}
	}
	const topRe = /\b(litcodex|npx --yes litcodex-ai) (--?[a-z][\w-]*|[a-z][\w-]*)/g;
	for (const m of text.matchAll(topRe)) {
		const prefix = m[1];
		const sub = m[2];
		if (sub === "loop") continue; // grouped route is checked above
		if (sub.startsWith("-")) continue; // position-independent flags (e.g. --dry-run) are valid
		if (TOP_LEVEL_ROUTES.includes(sub)) continue;
		// Only flag bare-word subs that are clearly a top-level invocation (skip prose adjacency).
		offenders.push({
			kind: "unknown-subcommand",
			value: prefix === "litcodex" ? `litcodex ${sub}` : `litcodex-ai ${sub}`,
			line: lineOfIndex(text, m.index),
		});
	}

	// 6. Forbidden tokens (bounded).
	for (const token of contract.forbiddenTokens) {
		const hit = findBoundedToken(text, token);
		if (hit) offenders.push({ kind: "forbidden-token", value: token, line: hit.line });
	}

	// 7. Forbidden phrases (case-insensitive substring).
	for (const phrase of contract.forbiddenPhrases) {
		const checkedText =
			phrase === "--package "
				? text.replace(
						/npm exec --yes --package @litfamily\/litcodex@[0-9]+\.[0-9]+\.[0-9]+ -- litcodex /g,
						(match) => " ".repeat(match.length),
					)
				: text;
		const hit = findPhraseLine(checkedText, phrase);
		if (hit) offenders.push({ kind: "forbidden-phrase", value: phrase, line: hit.line });
	}
	// 6b. The "or"-join anti-pattern: npx framed as interchangeable with the global install (G16.1).
	const orJoin = /litcodex install\s+or\s+(?:npx|npm exec)/i;
	const orMatch = orJoin.exec(text);
	if (orMatch) {
		offenders.push({ kind: "forbidden-phrase", value: "or-join", line: lineOfIndex(text, orMatch.index) });
	}

	return {
		ok: offenders.length === 0,
		readmePath,
		offenders,
		checked: {
			phrases: contract.requiredPhrases.length,
			commands: contract.requiredCommands.length,
			sections: contract.requiredSections.length,
			skills: contract.requiredSkillIds.length,
		},
		nonGatingClaims: NON_GATING_CLAIMS,
	};
}

function normalizeContract(contract) {
	return {
		...contract,
		requiredSkillIds: materializeList(contract.requiredSkillIds ?? []),
		forbiddenTokens: materializeList(contract.forbiddenTokens ?? []),
		forbiddenPhrases: materializeList(contract.forbiddenPhrases ?? []),
	};
}

function materializeList(items) {
	return items.map((item) => {
		if (typeof item === "string") return item;
		if (item && Array.isArray(item.parts)) return item.parts.join("");
		return String(item);
	});
}

/** 1-based line number of a character index in text. */
export function lineOfIndex(text, index) {
	if (index == null || index < 0) return null;
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === "\n") line++;
	}
	return line;
}

// --- CLI wrapper -------------------------------------------------------------------------------

class AuditOperationalError extends Error {
	constructor(message) {
		super(message);
		this.name = "AuditOperationalError";
	}
}

function loadContract() {
	const path = process.env.LITCODEX_README_CONTRACT
		? resolve(process.env.LITCODEX_README_CONTRACT)
		: DEFAULT_CONTRACT_PATH;
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		throw new AuditOperationalError("cannot load readme-contract.json");
	}
	try {
		return JSON.parse(raw);
	} catch {
		throw new AuditOperationalError("cannot load readme-contract.json");
	}
}

function main(argv) {
	const args = argv.slice(2);
	const json = args.includes("--json");
	const positional = args.filter((a) => a !== "--json");
	const readmeArg = positional[0] ?? "README.md";
	const readmePath = resolve(process.cwd(), readmeArg);

	let contract;
	try {
		contract = loadContract();
	} catch (err) {
		process.stderr.write(`[readme-audit] ${err.message}\n`);
		return 2;
	}

	let text;
	try {
		text = readFileSync(readmePath, "utf8");
	} catch {
		process.stderr.write(`[readme-audit] cannot read README: ${readmePath}\n`);
		return 2;
	}

	const report = auditReadme(text, contract, readmePath);

	if (json) {
		process.stdout.write(`${JSON.stringify(report)}\n`);
		return report.ok ? 0 : 1;
	}

	for (const o of report.offenders) {
		const loc = o.line == null ? "" : ` (line ${o.line})`;
		process.stdout.write(`FAIL: ${o.kind} — ${o.value}${loc}\n`);
	}
	if (report.ok) {
		process.stdout.write("ok: all README checks pass\n");
		process.stdout.write("readme-audit: PASS\n");
	} else {
		process.stdout.write(`readme-audit: FAIL (${report.offenders.length} offender(s))\n`);
	}
	return report.ok ? 0 : 1;
}

const INVOKED_AS_SCRIPT = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_AS_SCRIPT) {
	process.exit(main(process.argv));
}
