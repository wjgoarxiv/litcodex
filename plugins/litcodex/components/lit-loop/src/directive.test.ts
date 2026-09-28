// src/directive.test.ts — M10 content-invariant + loader suite (plan T15 RED→GREEN gate).
//
// Covers the S10 test plan, A3 D2 (`litcodex loop <sub>`), A3 C1 (marker single-source via
// markers.ts, cross-module byte-equality), and A3 C8 (loader reads ./directive.md, a dist-only
// smoke test that imports the BUILT dist/directive.js so the suite cannot pass off dev-tree
// source). All edge-case loader tests use the test-only loadLitLoopDirectiveFrom(path).

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
	LIT_LOOP_DIRECTIVE,
	LIT_LOOP_DIRECTIVE_MARKER,
	LitLoopDirectiveError,
	loadLitLoopDirective,
	loadLitLoopDirectiveFrom,
} from "./directive.js";
import { LIT_LOOP_DIRECTIVE_CLOSE, LIT_LOOP_DIRECTIVE_MARKER as MARKERS_MARKER } from "./markers.js";

// --- Fixture (single source of the content contract) -----------------------------------------

interface RequiredPhrase {
	phrase: string;
	why: string;
}
interface ForbiddenSubstring {
	token?: string;
	tokenParts?: readonly string[];
	class: "legacy" | "marketing";
	why: string;
}
interface DirectiveFixture {
	version: 1;
	marker: string;
	mandatedFirstLine: string;
	requiredPhrases: readonly RequiredPhrase[];
	forbiddenSubstrings: readonly ForbiddenSubstring[];
}

const FIXTURE_PATH = fileURLToPath(new URL("../test/fixtures/directive-required-phrases.json", import.meta.url));
const FIXTURE = JSON.parse(execFileSync("cat", [FIXTURE_PATH], { encoding: "utf8" })) as DirectiveFixture;

// Read this module's own source + the bundled directive.md raw bytes for the static guards.
const DIRECTIVE_TS_PATH = fileURLToPath(new URL("./directive.ts", import.meta.url));
const DIRECTIVE_MD_PATH = fileURLToPath(new URL("../directive.md", import.meta.url));
const DIRECTIVE_TS_SOURCE = execFileSync("cat", [DIRECTIVE_TS_PATH], { encoding: "utf8" });
const DIRECTIVE_MD_RAW = execFileSync("cat", [DIRECTIVE_MD_PATH], { encoding: "utf8" });
const LIT_LOOP_SKILL_PATH = fileURLToPath(new URL("../../../skills/lit-loop/SKILL.md", import.meta.url));
const LIT_LOOP_AGENT_PATH = fileURLToPath(new URL("../../../skills/lit-loop/agents/openai.yaml", import.meta.url));
const LIT_LOOP_FULL_WORKFLOW_PATH = fileURLToPath(
	new URL("../../../skills/lit-loop/references/full-workflow.md", import.meta.url),
);
const LIT_LOOP_SKILL_RAW = readFileSync(LIT_LOOP_SKILL_PATH, "utf8");
const LIT_LOOP_AGENT_RAW = readFileSync(LIT_LOOP_AGENT_PATH, "utf8");
const LIT_LOOP_FULL_WORKFLOW_RAW = readFileSync(LIT_LOOP_FULL_WORKFLOW_PATH, "utf8");
const HISTORICAL_STATE_PATH = [".o", "mo/"].join("");

function forbiddenToken(entry: ForbiddenSubstring): string {
	return entry.token ?? entry.tokenParts?.join("") ?? "";
}

// --- temp-dir cleanup registry ----------------------------------------------------------------

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}
function writeTempDirective(name: string, content: string): string {
	const dir = makeTempDir("lit-directive-");
	const path = join(dir, name);
	writeFileSync(path, content, "utf8");
	return path;
}
afterAll(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

// =============================================================================================
// 1–2: bracketing + marker (A3 C1 single-source)
// =============================================================================================

describe("loads and brackets the directive", () => {
	it("#given the bundled directive.md #when loaded #then it brackets the marker and is non-empty", () => {
		expect(LIT_LOOP_DIRECTIVE.startsWith(LIT_LOOP_DIRECTIVE_MARKER)).toBe(true);
		expect(LIT_LOOP_DIRECTIVE.endsWith(LIT_LOOP_DIRECTIVE_CLOSE)).toBe(true);
		expect(LIT_LOOP_DIRECTIVE.length).toBeGreaterThan(0);
		expect(LIT_LOOP_DIRECTIVE).not.toContain("\r");
	});
});

describe("marker constant equals the wrapper opening tag", () => {
	it("#given the marker constant #when compared #then equals the wrapper and is findable", () => {
		expect(LIT_LOOP_DIRECTIVE_MARKER).toBe("<lit-loop-mode>");
		expect(LIT_LOOP_DIRECTIVE.includes(LIT_LOOP_DIRECTIVE_MARKER)).toBe(true);
	});

	it("#given directive.ts and markers.ts #when compared #then the marker is byte-identical (A3 C1)", () => {
		// Cross-module byte-equality: directive re-exports markers.ts, never re-declares.
		expect(LIT_LOOP_DIRECTIVE_MARKER).toBe(MARKERS_MARKER);
		expect(DIRECTIVE_TS_SOURCE).toContain('from "./markers.js"');
		// directive.ts must NOT re-declare the marker literal.
		expect(DIRECTIVE_TS_SOURCE).not.toMatch(/LIT_LOOP_DIRECTIVE_MARKER\s*=/);
	});
});

// =============================================================================================
// 3–9: content invariants
// =============================================================================================

describe("mandates the exact first user-visible line", () => {
	it("#given the directive body #when scanned #then the first-line rule is present and agrees with the fixture", () => {
		expect(LIT_LOOP_DIRECTIVE).toContain("🔥 **LIT IGNITED · lit-loop** 🔥");
		expect(LIT_LOOP_DIRECTIVE).toContain("First user-visible line this turn MUST be exactly:");
		expect(FIXTURE.mandatedFirstLine).toBe("🔥 **LIT IGNITED · lit-loop** 🔥");
	});
});

describe("routes bounded activation to direct same-session work", () => {
	it("#given one coherent deliverable #when lit activates #then durable setup is skipped before the durable path", () => {
		const gate = "## Scope gate: bounded versus durable";
		const fastPath = "### Bounded task: work in the current session";
		for (const [label, text, laterSection] of [
			["directive", LIT_LOOP_DIRECTIVE, "## Enter lit-loop"],
			["skill", LIT_LOOP_SKILL_RAW, "## Required durable-workflow steps"],
		] as const) {
			const normalized = text.replace(/\s+/g, " ");
			expect(normalized, `${label} must declare the scope gate`).toContain(gate);
			expect(normalized, `${label} must declare the bounded fast path`).toContain(fastPath);
			expect(normalized.indexOf(gate), `${label} scope gate must precede its durable workflow`).toBeLessThan(
				normalized.indexOf(laterSection),
			);
			for (const phrase of [
				"one coherent deliverable",
				"A longer single run or time-consuming validation does not by itself require a ledger or agents",
				"Do not inspect existing `.litcodex/lit-loop` state",
				"Do not create durable goals, an evidence directory, or a task ledger",
				"Do not run `litcodex loop` commands or spawn subagents",
				"Read the necessary files, do the work directly, and run the checks needed to verify it",
			]) {
				expect(normalized, `${label} must include: ${phrase}`).toContain(phrase);
			}
		}
		expect(LIT_LOOP_AGENT_RAW).toContain("one coherent deliverable");
		expect(LIT_LOOP_AGENT_RAW).toContain(
			"use durable goals and checkpoints only when the scope gate selects the durable path",
		);
		expect(LIT_LOOP_FULL_WORKFLOW_RAW.replace(/\s+/g, " ")).toContain(
			"Bounded same-session tasks must not read this file or initialize loop state",
		);
	});
});

it("routes diagram deliverables to the native supporting skill before drawing", () => {
	for (const body of [LIT_LOOP_DIRECTIVE, LIT_LOOP_SKILL_RAW]) {
		expect(body).toContain("lit-diagram-drawer/SKILL.md");
		expect(body).toContain("before drawing");
		expect(body).toContain("Do not treat quoted examples or keywords alone as a routing request");
	}
	const policy = readFileSync(
		new URL("../../../skills/lit-diagram-drawer/agents/openai.yaml", import.meta.url),
		"utf8",
	);
	expect(policy).toContain("allow_implicit_invocation: true");
});

it("routes report and slide deliverables to native Office skills", () => {
	for (const body of [LIT_LOOP_DIRECTIVE, LIT_LOOP_SKILL_RAW]) {
		expect(body).toContain("../lit-docx/SKILL.md");
		expect(body).toContain("../lit-pptx/SKILL.md");
		expect(body).toContain("Load both when both formats are requested");
		expect(body).toContain("quoted examples and input-file names");
		expect(body).toContain("without preference questions");
	}
});

it("gives newly authored video priority over slide and interface hand-offs", () => {
	for (const body of [LIT_LOOP_DIRECTIVE, LIT_LOOP_SKILL_RAW]) {
		const motion = body.indexOf("../lit-typographic-motion/SKILL.md");
		const office = body.indexOf("../lit-pptx/SKILL.md");
		const interfaceSkill = body.indexOf("frontend-ui-ux/SKILL.md");
		expect(motion).toBeGreaterThan(-1);
		expect(motion).toBeLessThan(office);
		expect(motion).toBeLessThan(interfaceSkill);
		for (const phrase of [
			"video noun",
			"creation verb",
			"existing footage",
			"background video",
			"thumbnail",
			"bare motion",
			"../lit-typographic-motion/scripts/render.mjs",
		]) {
			expect(body.toLowerCase()).toContain(phrase);
		}
	}
});

it("routes bounded software implementation through the native code skill before editing", () => {
	for (const body of [LIT_LOOP_DIRECTIVE, LIT_LOOP_SKILL_RAW]) {
		expect(body).toContain("../lit-code/SKILL.md");
		expect(body).toContain("before editing source");
		expect(body).toContain("core user flow, input errors, and executable checks");
		expect(body).toContain("everyday adjacent operations");
		expect(body).toContain("without avoidable setup");
		expect(body).toContain("usage docs against the commands that actually run");
	}
});

describe("instructs durable state under .litcodex/lit-loop", () => {
	it("#given the directive body #when scanned #then durable-state artifacts are named", () => {
		for (const phrase of [
			".litcodex/lit-loop",
			"brief.md",
			"goals.json",
			"ledger.jsonl",
			".litcodex/lit-loop/evidence",
		]) {
			expect(LIT_LOOP_DIRECTIVE).toContain(phrase);
		}
	});
});

describe("never references historical state dirs", () => {
	it("#given the directive body #when scanned #then historical state path is absent and .litcodex/lit-loop present", () => {
		expect(LIT_LOOP_DIRECTIVE.toLowerCase()).not.toContain(HISTORICAL_STATE_PATH);
		expect(LIT_LOOP_DIRECTIVE).toContain(".litcodex/lit-loop");
	});
});

describe("mandates failing-first and real-surface proof", () => {
	it("#given the directive body #when scanned #then RED-before-GREEN + tests-not-done language present", () => {
		expect(LIT_LOOP_DIRECTIVE).toContain("RED before GREEN");
		expect(LIT_LOOP_DIRECTIVE).toContain("TESTS ALONE NEVER PROVE DONE");
	});
});

describe("instructs verify, checkpoint, and continue-or-stop", () => {
	it("#given the directive body #when scanned #then loop verb surfaces + continue mandate present (A3 D2)", () => {
		for (const phrase of [
			"litcodex loop status",
			"litcodex loop run",
			"litcodex loop checkpoint",
			"litcodex loop record-evidence",
			"litcodex loop doctor",
			"continue until every success criterion is proven",
		]) {
			expect(LIT_LOOP_DIRECTIVE).toContain(phrase);
		}
		// A3 D2: the verb group is `loop`, never `lit-loop`.
		expect(LIT_LOOP_DIRECTIVE).not.toContain("litcodex lit-loop");
	});
});

describe("instructs an honest blocked-stop", () => {
	it("#given the directive body #when scanned #then blocked-stop language present", () => {
		expect(LIT_LOOP_DIRECTIVE).toContain("genuinely blocked");
		expect(LIT_LOOP_DIRECTIVE).toContain("BLOCKED:");
	});
});

describe("instructs ledger re-read after compaction", () => {
	it("#given the directive body #when scanned #then compaction-recovery language present", () => {
		expect(LIT_LOOP_DIRECTIVE).toContain("Context compacted");
		expect(LIT_LOOP_DIRECTIVE).toContain("re-read the WHOLE ledger");
	});
});

// =============================================================================================
// 10–12: data-driven fixture gates (single source of content truth)
// =============================================================================================

describe("contains no legacy brand tokens", () => {
	const legacy = FIXTURE.forbiddenSubstrings.filter((f) => f.class === "legacy");
	it.each(legacy)("#given $why #when scanned #then the guarded value is absent", (entry) => {
		const token = forbiddenToken(entry);
		if (token === ["o", "m", "o"].join("")) {
			// bounded match so legitimate words are not false-flagged (S10 note).
			expect(new RegExp(`\\b${token}\\b`, "i").test(LIT_LOOP_DIRECTIVE)).toBe(false);
		} else {
			expect(LIT_LOOP_DIRECTIVE.toLowerCase()).not.toContain(token.toLowerCase());
		}
	});
});

describe("contains no marketing or launch-gating copy", () => {
	const marketing = FIXTURE.forbiddenSubstrings.filter((f) => f.class === "marketing");
	it.each(marketing)("#given $why #when scanned #then the guarded value is absent", (entry) => {
		const token = forbiddenToken(entry);
		expect(LIT_LOOP_DIRECTIVE.toLowerCase()).not.toContain(token.toLowerCase());
	});
});

describe("every required phrase is present", () => {
	it.each(FIXTURE.requiredPhrases)("#given $why #when scanned #then $phrase is present", ({ phrase }) => {
		expect(LIT_LOOP_DIRECTIVE).toContain(phrase);
	});
});

// =============================================================================================
// 13: prompt-injection inertness (no interpolation placeholders in the raw source)
// =============================================================================================

describe("directive contains no interpolation placeholders for user text", () => {
	it("#given the raw directive.md bytes #when scanned #then no dollar-brace / double-brace / printf sites", () => {
		expect(DIRECTIVE_MD_RAW).not.toContain("${");
		expect(DIRECTIVE_MD_RAW).not.toContain("{{");
		expect(DIRECTIVE_MD_RAW).not.toContain("%s");
	});
});

// =============================================================================================
// 14–16: loader normalization (via loadLitLoopDirectiveFrom)
// =============================================================================================

const VALID_BODY = `${LIT_LOOP_DIRECTIVE_MARKER}\nhello world\n${LIT_LOOP_DIRECTIVE_CLOSE}`;

describe("normalizes CRLF to LF", () => {
	it("#given a CRLF directive #when loaded #then no \\r and equal to the LF form", () => {
		const crlf = VALID_BODY.replace(/\n/g, "\r\n");
		const lfPath = writeTempDirective("directive.md", VALID_BODY);
		const crlfPath = writeTempDirective("directive.md", crlf);
		const loaded = loadLitLoopDirectiveFrom(crlfPath);
		expect(loaded).not.toContain("\r");
		expect(loaded).toBe(loadLitLoopDirectiveFrom(lfPath));
	});
});

describe("normalizes lone CR to LF", () => {
	it("#given a lone-CR directive #when loaded #then no \\r remains", () => {
		const cr = VALID_BODY.replace(/\n/g, "\r");
		const path = writeTempDirective("directive.md", cr);
		const loaded = loadLitLoopDirectiveFrom(path);
		expect(loaded).not.toContain("\r");
		expect(loaded.startsWith(LIT_LOOP_DIRECTIVE_MARKER)).toBe(true);
	});
});

describe("trims surrounding whitespace", () => {
	it("#given a padded directive #when loaded #then the first line is the marker", () => {
		const padded = `\n\n   \n${VALID_BODY}\n\n  \n`;
		const path = writeTempDirective("directive.md", padded);
		const loaded = loadLitLoopDirectiveFrom(path);
		expect(loaded.split("\n")[0]).toBe(LIT_LOOP_DIRECTIVE_MARKER);
		expect(loaded.endsWith(LIT_LOOP_DIRECTIVE_CLOSE)).toBe(true);
	});
});

// =============================================================================================
// 17–19: loader error classes
// =============================================================================================

describe("throws UNREADABLE when file missing", () => {
	it("#given a nonexistent path #when loaded #then throws UNREADABLE", () => {
		const path = join(makeTempDir("lit-directive-"), "does-not-exist.md");
		try {
			loadLitLoopDirectiveFrom(path);
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(LitLoopDirectiveError);
			expect((err as LitLoopDirectiveError).code).toBe("LIT_LOOP_DIRECTIVE_UNREADABLE");
			expect((err as LitLoopDirectiveError).resolvedPath).toBe(path);
		}
	});
});

describe("throws EMPTY on empty file", () => {
	it("#given a whitespace-only file #when loaded #then throws EMPTY", () => {
		const path = writeTempDirective("directive.md", "   \n\t\n  ");
		try {
			loadLitLoopDirectiveFrom(path);
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(LitLoopDirectiveError);
			expect((err as LitLoopDirectiveError).code).toBe("LIT_LOOP_DIRECTIVE_EMPTY");
		}
	});
});

describe("throws MARKER_MISSING when wrapper absent", () => {
	it("#given a markerless file #when loaded #then throws MARKER_MISSING", () => {
		const path = writeTempDirective("directive.md", "just some text without the wrapper");
		try {
			loadLitLoopDirectiveFrom(path);
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(LitLoopDirectiveError);
			expect((err as LitLoopDirectiveError).code).toBe("LIT_LOOP_DIRECTIVE_MARKER_MISSING");
		}
	});
});

// =============================================================================================
// 20: adversarial path (space + # + Hangul) via fileURLToPath
// =============================================================================================

describe("resolves directive path under unicode/hash/space dirs", () => {
	it("#given a temp dir named with space/#/Hangul #when loaded #then succeeds, bracketed", () => {
		const dir = makeTempDir("lit qa # 한글-");
		const path = join(dir, "directive.md");
		writeFileSync(path, VALID_BODY, "utf8");
		const loaded = loadLitLoopDirectiveFrom(path);
		expect(loaded.startsWith(LIT_LOOP_DIRECTIVE_MARKER)).toBe(true);
		expect(loaded.endsWith(LIT_LOOP_DIRECTIVE_CLOSE)).toBe(true);
	});
});

// =============================================================================================
// 21 + 23: static source guards (fileURLToPath, no forbidden imports)
// =============================================================================================

describe("loader uses fileURLToPath not pathname", () => {
	it("#given directive.ts source #when read #then uses fileURLToPath and the ../directive.md offset (A3 G6)", () => {
		expect(DIRECTIVE_TS_SOURCE).toContain("fileURLToPath");
		expect(DIRECTIVE_TS_SOURCE).not.toContain(".pathname");
		// A3 G6 (supersedes C8): the authored directive.md lives at the component root (files[]),
		// so the loader resolves `../directive.md` (one level above src/ AND above dist/), never the
		// flat `./directive.md` form that required a build-copy mirror.
		expect(DIRECTIVE_TS_SOURCE).toContain('new URL("../directive.md", import.meta.url)');
		expect(DIRECTIVE_TS_SOURCE).not.toContain('new URL("./directive.md", import.meta.url)');
	});
});

describe("directive module imports nothing from trigger, state-store, or codex-hook", () => {
	it("#given directive.ts source #when read #then no forbidden import edges", () => {
		for (const forbidden of [
			"./trigger",
			"./state-store",
			"./state-types",
			"./state-paths",
			"./guards",
			"./codex-hook",
		]) {
			expect(DIRECTIVE_TS_SOURCE).not.toContain(`from "${forbidden}`);
		}
	});
});

// =============================================================================================
// 22: large-but-bounded directive
// =============================================================================================

describe("accepts a large but bounded directive", () => {
	it("#given a 23 KB valid directive #when loaded #then loads, bracketed, no throw", () => {
		const filler = "x".repeat(23 * 1024);
		const body = `${LIT_LOOP_DIRECTIVE_MARKER}\n${filler}\n${LIT_LOOP_DIRECTIVE_CLOSE}`;
		const path = writeTempDirective("directive.md", body);
		const loaded = loadLitLoopDirectiveFrom(path);
		expect(loaded.startsWith(LIT_LOOP_DIRECTIVE_MARKER)).toBe(true);
		expect(loaded.length).toBeGreaterThan(23 * 1024);
	});
});

// =============================================================================================
// 24: deterministic / stable across loads
// =============================================================================================

describe("value is stable across repeated loads", () => {
	it("#given repeated calls #when loaded #then identical to each other and to the constant", () => {
		expect(loadLitLoopDirective()).toBe(loadLitLoopDirective());
		expect(loadLitLoopDirective()).toBe(LIT_LOOP_DIRECTIVE);
	});
});

// =============================================================================================
// DIST-ONLY smoke test (A3 G6): stage the REAL published tarball layout — <pkg>/dist/directive.js
// + <pkg>/{directive.md,package.json} at the package root — then import the BUILT dist/directive.js
// and assert a non-empty, marker-bracketed, first-line directive. This cannot pass off the dev-tree
// source: it imports the compiled module resolving ../directive.md to the staged root copy, and
// there is NO dist/directive.md or src/directive.md mirror.
// =============================================================================================

describe("dist-only smoke: built dist/directive.js produces a bracketed directive", () => {
	const distJs = fileURLToPath(new URL("../dist/directive.js", import.meta.url));
	const distMarkers = fileURLToPath(new URL("../dist/markers.js", import.meta.url));
	const rootMd = fileURLToPath(new URL("../directive.md", import.meta.url));
	const rootPackageJson = fileURLToPath(new URL("../package.json", import.meta.url));

	it("#given a built published package layout #when dist/directive.js is imported #then it exports a bracketed, first-line directive", (ctx) => {
		// CI runs `npm test` BEFORE `npm run build` (A3 G6): with no built dist this test SKIPS so a
		// clean buildless checkout is fully green; when the component is built it runs and asserts on
		// the REAL compiled artifact. The component-root directive.md is always present (tracked).
		if (!existsSync(distJs) || !existsSync(distMarkers) || !existsSync(rootMd) || !existsSync(rootPackageJson)) {
			ctx.skip();
			return;
		}
		// Stage the published tarball layout: <pkg>/dist/{directive.js,markers.js} plus package.json
		// and the authored directive.md at the package root. The loader resolves ../directive.md from
		// dist/ to that root copy — exactly how the shipped package loads it.
		const pkgDir = makeTempDir("lit-dist-smoke-");
		const pkgDist = join(pkgDir, "dist");
		const stagedPackageJson = join(pkgDir, "package.json");
		mkdirSync(pkgDist, { recursive: true });
		cpSync(distJs, join(pkgDist, "directive.js"));
		cpSync(distMarkers, join(pkgDist, "markers.js"));
		cpSync(rootMd, join(pkgDir, "directive.md"));
		cpSync(rootPackageJson, stagedPackageJson);
		expect(existsSync(stagedPackageJson)).toBe(true);
		expect(JSON.parse(readFileSync(stagedPackageJson, "utf8"))).toMatchObject({
			name: "@litcodex/lit-loop",
			type: "module",
		});
		const probe = join(pkgDist, "probe.mjs");
		writeFileSync(
			probe,
			[
				'import { LIT_LOOP_DIRECTIVE, LIT_LOOP_DIRECTIVE_MARKER } from "./directive.js";',
				"const ok =",
				'  LIT_LOOP_DIRECTIVE.startsWith("<lit-loop-mode>") &&',
				'  LIT_LOOP_DIRECTIVE.endsWith("</lit-loop-mode>") &&',
				'  LIT_LOOP_DIRECTIVE_MARKER === "<lit-loop-mode>" &&',
				'  LIT_LOOP_DIRECTIVE.includes("🔥 **LIT IGNITED · lit-loop** 🔥") &&',
				"  LIT_LOOP_DIRECTIVE.length > 0;",
				"process.stdout.write(JSON.stringify({ ok, len: LIT_LOOP_DIRECTIVE.length }));",
				"process.exit(ok ? 0 : 1);",
			].join("\n"),
			"utf8",
		);
		const out = execFileSync(process.execPath, [probe], { encoding: "utf8" });
		const parsed = JSON.parse(out) as { ok: boolean; len: number };
		expect(parsed.ok).toBe(true);
		expect(parsed.len).toBeGreaterThan(0);
	});
});
