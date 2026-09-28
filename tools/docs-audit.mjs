// tools/docs-audit.mjs — T27 docs & workflow completeness audit (npm run docs:audit).
//
// T21 shipped tools/readme-audit.mjs auditing README.md against a frozen content contract. T27
// BROADENS the `docs:audit` gate to EVERY user-facing doc so no doc drifts from the REAL command
// surface. For README.md it delegates to the full M16 auditReadme (sections/phrases/tokens). For
// EVERY user-facing doc — including README — it additionally runs a pure command-surface audit:
//
//   - every documented `litcodex …` / `npx --yes litcodex-ai …` invocation must map to a real route
//     (install / doctor / uninstall / `config migrate` / `hook user-prompt-submit` from the
//     litcodex-ai dispatcher, plus the canonical M09 LOOP_SUBCOMMANDS), OR be an explicitly-marked
//     negative/example (a line carrying a negation cue such as "never"/"instead of"), and
//   - NO doc may use the wrong loop verb `litcodex lit-loop <sub>` (A3 D2 — the verb is `loop`).
//
// "Documented command" = a `litcodex` token in CODE CONTEXT (inline `backticks` or a fenced block)
// and in COMMAND POSITION (not a prose noun, not inside a quoted string, not a shell function def).
// The M04 bounded-token matcher is reused via readme-audit.findBoundedToken so "docs clean ⇔
// scanner clean".
//
// Exit codes (CLI): 0 = every doc passes; 1 = a doc has offenders; 2 = operational error
// (a required doc / the readme contract is unreadable) — fail-closed.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isExactBareHandoffPrompt } from "@litcodex/lit-loop/dist/handoff-route.js";
import { modeForToken } from "@litcodex/lit-loop/dist/modes.js";
import { isExactBareScientificVisualizationPrompt } from "@litcodex/lit-loop/dist/scientific-visualization-route.js";
import { matchLitTrigger } from "@litcodex/lit-loop/dist/trigger.js";
import {
	auditReadme,
	CONFIG_SUBCOMMANDS,
	findBoundedToken,
	HOOK_SUBCOMMANDS,
	LOOP_SUBCOMMANDS,
	lineOfIndex,
	OFFICE_RUNTIME_SUBCOMMANDS,
} from "./readme-audit.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_CONTRACT_PATH = fileURLToPath(new URL("./readme-contract.json", import.meta.url));

/**
 * The user-facing docs the gate audits, repo-relative. README.md gets the FULL M16 contract audit;
 * every doc (README included) gets the command-surface audit. Optional docs absent in a given build
 * are skipped, not failed (release docs may not all exist yet).
 */
export const USER_FACING_DOCS = Object.freeze([
	"CONTRIBUTING.md",
	"SECURITY.md",
	"CODE_OF_CONDUCT.md",
	"SUPPORT.md",
	"docs/privacy.md",
	"docs/npm-migration.md",
	".github/ISSUE_TEMPLATE/bug_report.md",
	".github/ISSUE_TEMPLATE/feature_request.md",
	".github/PULL_REQUEST_TEMPLATE.md",
	"README.md",
	"README-Ko-KR.md",
	"CHANGELOG.md",
	"packages/litcodex-ai/README.md",
	"docs/usage.md",
	"docs/usage-Ko-KR.md",
	"docs/spec/litcodex-contract.md",
	"docs/reference-analysis.md",
	"docs/release/provenance.md",
	"docs/release/publish-checklist.md",
	"RELEASE_CHECKLIST.md",
	"plugins/litcodex/components/lit-loop/README.md",
	"plugins/litcodex/components/lit-loop/skills/lit-loop/SKILL.md",
	"plugins/litcodex/components/lit-loop/skills/lit-loop/references/full-workflow.md",
	"plugins/litcodex/components/lit-loop/directive.md",
]);

const CHANGELOG_LINK_DOCS = new Set(["README.md", "README-Ko-KR.md", "packages/litcodex-ai/README.md"]);
const PUBLIC_ROUTE_READMES = new Set(["README.md", "README-Ko-KR.md"]);
const EXACT_ROUTE_MODES = new Set(["lit-handoff", "lit-scientific-visualization"]);

// Wrong loop verb (A3 D2): the CLI verb group is `loop`, never `lit-loop`. A `litcodex lit-loop
// <sub>` command form is a hard fail (the noun/brand `lit-loop` stays legal in prose).
const WRONG_LOOP_VERB_RE = /\blitcodex\s+lit-loop\b/;

// Negation cues: a line that frames a command as a NEVER-do / counter-example is an explicitly
// marked reference, not an aspirational command. Such a line is exempt from surface offenses.
const NEGATION_CUE_RE = /\b(never|not|don't|do not|instead of|rather than|avoid|wrong|incorrect|n't)\b/i;

// A documented invocation candidate: `litcodex` or `npx --yes litcodex-ai` followed (on the SAME
// line) by a bare-word subcommand or a flag. The leading capture is the prefix so the offender
// value reads back cleanly. Same-line whitespace only ([ \t]) so a value like `VAR=litcodex` on its
// own line never grabs the next line's first word.
const INVOCATION_RE = /(litcodex|npx --yes litcodex-ai)[ \t]+(--?[a-z][\w-]*|[a-z][\w-]*)((?:[ \t]+[\w./<>-]+)*)/g;

// Left-edge command-position guard: the char immediately before `litcodex`/`npx` must NOT make the
// token a value, path, or identifier (so `LIT_LOOP_CLI=litcodex`, `bin/litcodex`, `"...litcodex`
// are not treated as invocations).
const NON_COMMAND_LEFT = new Set(["=", "/", "-", ".", '"', "'", "_"]);

/**
 * Mark every character index that lies inside CODE CONTEXT (an inline `…` span or a fenced ``` block)
 * AND not inside a quoted string within that code. Returns a Uint8Array flag per char: 1 = a real
 * command position, 0 = prose / quoted data. Single-pass, line-aware.
 * @param {string} text
 * @returns {Uint8Array}
 */
function markCommandContext(text) {
	const flags = new Uint8Array(text.length);
	const lines = text.split("\n");
	let inFence = false;
	let offset = 0;
	for (const line of lines) {
		const fenceToggle = /^\s*```/.test(line);
		if (fenceToggle) {
			inFence = !inFence;
			offset += line.length + 1;
			continue; // the fence delimiter line itself carries no command
		}
		if (inFence) {
			markFencedLine(flags, line, offset);
		} else {
			markInlineSpans(flags, line, offset);
		}
		offset += line.length + 1;
	}
	return flags;
}

// Inside a fenced block: every char is code EXCEPT chars inside single/double quoted strings, which
// are data (e.g. `printf "...litcodex executable..."`). Comment lines (#) are prose too.
function markFencedLine(flags, line, offset) {
	if (/^\s*#/.test(line)) return; // shell comment line — prose
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "'" && !inDouble) inSingle = !inSingle;
		else if (c === '"' && !inSingle) inDouble = !inDouble;
		else if (!inSingle && !inDouble) flags[offset + i] = 1;
	}
}

// Outside a fence: only chars inside inline `…` spans are code context.
function markInlineSpans(flags, line, offset) {
	let inSpan = false;
	for (let i = 0; i < line.length; i++) {
		if (line[i] === "`") {
			inSpan = !inSpan;
			continue;
		}
		if (inSpan) flags[offset + i] = 1;
	}
}

/**
 * Pure command-surface audit: scan `text` for documented litcodex invocations and the wrong loop
 * verb, returning offenders. Only invocations in command context (not prose, not negated) count.
 * @param {string} text
 * @returns {{ok:boolean, offenders:Array<{kind:string,value:string,line:number}>}}
 */
export function auditCommandSurface(text) {
	const offenders = [];
	const inCode = markCommandContext(text);
	const lineStartCache = text.split("\n");

	for (const m of text.matchAll(INVOCATION_RE)) {
		const idx = m.index;
		if (!inCode[idx]) continue; // prose mention, not a documented command
		const before = idx === 0 ? "" : text[idx - 1];
		if (NON_COMMAND_LEFT.has(before)) continue; // a value/path/identifier, not an invocation
		const line = lineOfIndex(text, idx);
		const lineText = lineStartCache[line - 1] ?? "";
		if (NEGATION_CUE_RE.test(lineText)) continue; // explicitly-marked never/example reference

		const prefix = m[1];
		const first = m[2];
		const tail = m[3].trim().split(/\s+/).filter(Boolean);

		// Wrong loop verb: `litcodex lit-loop …` — flagged regardless of the following sub.
		if (prefix === "litcodex" && first === "lit-loop") {
			offenders.push({ kind: "wrong-verb-command", value: `litcodex lit-loop ${tail[0] ?? ""}`.trim(), line });
			continue;
		}

		const verdict = classifyInvocation(first, tail);
		if (verdict.ok) continue;
		const label = prefix === "litcodex" ? "litcodex" : "litcodex-ai";
		offenders.push({ kind: "unknown-command", value: `${label} ${verdict.shown}`.trim(), line });
	}

	// Defensive: also flag the wrong verb anywhere in code context even if the INVOCATION_RE shape
	// (a following sub token) is absent, e.g. a bare `litcodex lit-loop` reference in code.
	let from = 0;
	for (;;) {
		const hit = WRONG_LOOP_VERB_RE.exec(text.slice(from));
		if (!hit) break;
		const idx = from + hit.index;
		from = idx + 1;
		if (!inCode[idx]) continue;
		const line = lineOfIndex(text, idx);
		const lineText = lineStartCache[line - 1] ?? "";
		if (NEGATION_CUE_RE.test(lineText)) continue;
		if (offenders.some((o) => o.kind === "wrong-verb-command" && o.line === line)) continue;
		offenders.push({ kind: "wrong-verb-command", value: "litcodex lit-loop", line });
	}

	return { ok: offenders.length === 0, offenders };
}

/**
 * Classify a top-level invocation against the real route table. Flags and sub-routed commands
 * (`config migrate`, `hook user-prompt-submit`, `loop <sub>`) are validated here.
 * @returns {{ok:boolean, shown:string}}
 */
function classifyInvocation(first, tail) {
	if (first.startsWith("-")) return { ok: true, shown: first }; // position-independent flags
	if (first === "loop") {
		const sub = tail.find((t) => !t.startsWith("-"));
		if (sub === undefined) return { ok: true, shown: "loop" }; // bare `litcodex loop …` / `loop <sub>` placeholder
		if (sub.startsWith("<")) return { ok: true, shown: `loop ${sub}` }; // `loop <sub>` template
		return { ok: LOOP_SUBCOMMANDS.includes(sub), shown: `loop ${sub}` };
	}
	if (first === "config") {
		const sub = tail.find((t) => !t.startsWith("-"));
		if (sub === undefined || sub.startsWith("<")) return { ok: true, shown: "config" };
		return { ok: CONFIG_SUBCOMMANDS.includes(sub), shown: `config ${sub}` };
	}
	if (first === "hook") {
		const sub = tail.find((t) => !t.startsWith("-"));
		if (sub === undefined || sub.startsWith("<")) return { ok: true, shown: "hook" };
		return { ok: HOOK_SUBCOMMANDS.includes(sub), shown: `hook ${sub}` };
	}
	if (first === "office-runtime") {
		const sub = tail.find((t) => !t.startsWith("-"));
		if (sub === undefined || sub.startsWith("<")) return { ok: true, shown: "office-runtime" };
		return { ok: OFFICE_RUNTIME_SUBCOMMANDS.includes(sub), shown: `office-runtime ${sub}` };
	}
	const TOP = ["install", "doctor", "uninstall"];
	return { ok: TOP.includes(first), shown: first };
}

/**
 * Audit one doc. README.md additionally runs the full M16 content contract; every doc runs the
 * command-surface audit + a bounded-legacy-token sweep (C10) so "docs clean ⇔ scanner clean".
 * @param {string} text
 * @param {string} relPath
 * @param {object} [contract] frozen README contract (only used for README.md)
 * @param {{npmPackageName:string,npmPackageVersion:string,litLoopHookStatusMessage:string}} [facts] live package/manifest facts
 */
export function auditDoc(text, relPath, contract, facts) {
	const offenders = [];
	const surface = auditCommandSurface(text);
	offenders.push(...surface.offenders);
	if (PUBLIC_ROUTE_READMES.has(relPath)) {
		offenders.push(...auditPublicHookRoutes(text, relPath, facts?.englishPublicHookRoutes));
	}
	if (facts) offenders.push(...auditRepoFacts(text, relPath, facts));

	if (relPath === "README.md" && contract) {
		const report = auditReadme(text, contract, relPath);
		offenders.push(...report.offenders);
	} else if (contract) {
		// Non-README docs: reuse the contract's forbidden-token set via the bounded matcher only
		// (sections/phrases are README-specific). Skip the litcodex-contract + reference-analysis
		// docs, which intentionally enumerate the guarded legacy tokens as policy evidence.
		const enumeratesTokens = relPath === "docs/spec/litcodex-contract.md" || relPath === "docs/reference-analysis.md";
		if (!enumeratesTokens) {
			for (const rawToken of contract.forbiddenTokens) {
				const token = materializeContractValue(rawToken);
				const hit = findBoundedToken(text, token);
				if (hit) offenders.push({ kind: "forbidden-token", value: token, line: hit.line });
			}
		}
	}

	return { ok: offenders.length === 0, path: relPath, offenders };
}

function auditPublicHookRoutes(text, relPath, expectedRows) {
	const offenders = [];
	const rows = extractPublicHookRouteRows(text);
	for (const row of rows) {
		for (const form of row.forms) {
			const actualMode = nativeHookModeForForm(form);
			if (actualMode === null) {
				offenders.push({ kind: "unknown-hook-route", value: form, line: row.line });
			} else if (actualMode !== row.mode) {
				offenders.push({
					kind: "hook-route-mode-drift",
					value: `${form}: ${row.mode} (actual ${actualMode})`,
					line: row.line,
				});
			}
		}
		if (EXACT_ROUTE_MODES.has(row.mode) && !hasExactBareQualifier(row.input, relPath)) {
			offenders.push({ kind: "exact-route-ambiguity", value: row.forms.join(", "), line: row.line });
		}
	}

	if (Array.isArray(expectedRows)) {
		const comparable = rows.map(({ mode, forms }) => ({ mode, forms }));
		if (JSON.stringify(comparable) !== JSON.stringify(expectedRows)) {
			offenders.push({
				kind: "route-parity-drift",
				value: "README-Ko-KR.md must match README.md public hook routes",
				line: null,
			});
		}
	}
	return offenders;
}

function extractPublicHookRouteRows(text) {
	const rows = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		const cells = line.split("|");
		const mode = /^\s*\*\*([^*]+)\*\*\s*$/u.exec(cells[2] ?? "")?.[1];
		if (mode === undefined) continue;
		const input = cells[1] ?? "";
		const forms = [...input.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
		rows.push({ mode: mode.toLowerCase().replaceAll(" ", "-"), forms, input, line: index + 1 });
	}
	return rows;
}

function nativeHookModeForForm(form) {
	if (isExactBareHandoffPrompt(form)) return "lit-handoff";
	if (isExactBareScientificVisualizationPrompt(form)) return "lit-scientific-visualization";
	const match = matchLitTrigger(form);
	return match === null ? null : modeForToken(match.token).mode;
}

function hasExactBareQualifier(input, relPath) {
	return relPath === "README-Ko-KR.md" ? /정확히\s+단독으로\s+입력한/u.test(input) : /\bexact bare\b/iu.test(input);
}

function auditRepoFacts(text, relPath, facts) {
	const offenders = [];
	if (CHANGELOG_LINK_DOCS.has(relPath)) {
		if (!text.includes("CHANGELOG.md")) {
			offenders.push({
				kind: "history-link-missing",
				value: "CHANGELOG.md",
				line: null,
			});
		}
	}
	if (relPath === "docs/spec/litcodex-contract.md" && !text.includes(facts.litLoopHookStatusMessage)) {
		offenders.push({ kind: "hook-status-drift", value: facts.litLoopHookStatusMessage, line: null });
	}
	if (relPath === "docs/spec/litcodex-contract.md") {
		const packaging = text.split(/Packaging constants:\r?\n/u)[1]?.split(/\n---\s*(?:\n|$)/u)[0] ?? "";
		const rows = packaging.split(/\r?\n/u).map((line) =>
			line
				.trim()
				.replace(/^\||\|$/gu, "")
				.split("|")
				.map((cell) => cell.trim()),
		);
		for (const [key, value] of [
			[
				"Installer npm package",
				`\`${facts.npmPackageName}\`, version \`${facts.npmPackageVersion}\`, \`type: module\``,
			],
			["Version (all package.json)", `\`${facts.npmPackageVersion}\``],
		]) {
			const matches = rows.filter((row) => row[0]?.replaceAll("`", "") === key);
			if (matches.length !== 1 || matches[0].length !== 2 || matches[0][1] !== value) {
				offenders.push({ kind: "packaging-contract-drift", value: `${key}: ${value}`, line: null });
			}
		}
	}
	return offenders;
}

export function loadRepoFacts(repoRoot = REPO_ROOT) {
	let pkg;
	let hooks;
	let englishReadme;
	try {
		pkg = JSON.parse(readFileSync(resolve(repoRoot, "packages/litcodex-ai/package.json"), "utf8"));
		hooks = JSON.parse(readFileSync(resolve(repoRoot, "plugins/litcodex/hooks/hooks.json"), "utf8"));
		englishReadme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
	} catch {
		throw new AuditOperationalError("cannot load repo-derived docs facts");
	}
	const groups = hooks?.hooks?.UserPromptSubmit;
	const handlers = Array.isArray(groups) ? groups.flatMap((group) => group?.hooks ?? []) : [];
	const litLoop = handlers.find(
		(handler) =>
			typeof handler?.command === "string" &&
			handler.command.includes("components/lit-loop/dist/cli.js") &&
			handler.command.includes("hook user-prompt-submit"),
	);
	if (
		typeof pkg?.name !== "string" ||
		typeof pkg?.version !== "string" ||
		typeof litLoop?.statusMessage !== "string"
	) {
		throw new AuditOperationalError("cannot load repo-derived docs facts");
	}
	return {
		npmPackageName: pkg.name,
		npmPackageVersion: pkg.version,
		litLoopHookStatusMessage: litLoop.statusMessage,
		englishPublicHookRoutes: extractPublicHookRouteRows(englishReadme).map(({ mode, forms }) => ({ mode, forms })),
	};
}

function materializeContractValue(value) {
	if (typeof value === "string") return value;
	if (value && Array.isArray(value.parts)) return value.parts.join("");
	return String(value);
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
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new AuditOperationalError("cannot load readme-contract.json");
	}
}

function resolveDocList() {
	const docs = [...USER_FACING_DOCS];
	// Test/diagnostic hook: an extra doc to fold into the audit (e.g. a negative fixture).
	if (process.env.LITCODEX_DOCS_EXTRA) {
		docs.push(process.env.LITCODEX_DOCS_EXTRA);
	}
	return docs;
}

function main() {
	const json = process.argv.includes("--json");

	let contract;
	let facts;
	try {
		contract = loadContract();
		facts = loadRepoFacts();
	} catch (err) {
		process.stderr.write(`[docs-audit] ${err.message}\n`);
		return 2;
	}

	const results = [];
	for (const rel of resolveDocList()) {
		const abs = resolve(REPO_ROOT, rel);
		if (!existsSync(abs)) {
			// README.md is mandatory; every other doc is optional in a given build.
			if (rel === "README.md") {
				process.stderr.write(`[docs-audit] cannot read required doc: ${rel}\n`);
				return 2;
			}
			continue;
		}
		let text;
		try {
			text = readFileSync(abs, "utf8");
		} catch {
			process.stderr.write(`[docs-audit] cannot read doc: ${rel}\n`);
			return 2;
		}
		results.push(auditDoc(text, rel, contract, facts));
	}

	const offenderCount = results.reduce((n, r) => n + r.offenders.length, 0);
	const ok = offenderCount === 0;

	if (json) {
		process.stdout.write(`${JSON.stringify({ ok, docs: results })}\n`);
		return ok ? 0 : 1;
	}

	for (const r of results) {
		for (const o of r.offenders) {
			const loc = o.line == null ? "" : ` (line ${o.line})`;
			process.stdout.write(`FAIL: ${r.path}: ${o.kind} — ${o.value}${loc}\n`);
		}
	}
	if (ok) {
		process.stdout.write(`ok: ${results.length} doc(s) consistent with the real command surface\n`);
		process.stdout.write("docs-audit: PASS\n");
	} else {
		process.stdout.write(`docs-audit: FAIL (${offenderCount} offender(s))\n`);
	}
	return ok ? 0 : 1;
}

const INVOKED_AS_SCRIPT = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_AS_SCRIPT) {
	process.exit(main());
}
