// T20 / M15 — lit-loop skill & operational docs content-invariant guard suite.
//
// Asserts the SKILL.md / references/full-workflow.md / agents/openai.yaml doc files satisfy the
// machine-checkable contract in test/fixtures/skill-doc-contract.json: required LitCodex-native
// phrases present, no legacy token (bounded match reused from the M04 scanner), command surface
// consistent with the M09 LOOP_SUBCOMMANDS export, the canonical `litcodex loop` verb (never the
// M10-outlier `litcodex lit-loop <sub>`), the version-glob cache-fallback bootstrap block,
// pinned multi_agent_v1 tool namespace, the evidence gate axiom intact, and the openai.yaml
// discovery fields.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — JS module, scanner has no .d.ts; runtime export is the contract.
import { LEGACY_TOKENS, matchToken, scanText } from "../../../../../tools/scan-legacy-tokens.mjs";
import { LOOP_SUBCOMMANDS } from "../src/loop-cli.js";
import contract from "./fixtures/skill-doc-contract.json" with { type: "json" };

const SKILL_DIR = fileURLToPath(new URL("../../../skills/lit-loop/", import.meta.url));
const SKILL_MD = `${SKILL_DIR}SKILL.md`;
const WORKFLOW_MD = `${SKILL_DIR}references/full-workflow.md`;
const OPENAI_YAML = `${SKILL_DIR}agents/openai.yaml`;

const read = (p: string): string => readFileSync(p, "utf8");
const skillText = read(SKILL_MD);
const workflowText = read(WORKFLOW_MD);
const yamlText = read(OPENAI_YAML);

// Bounded legacy-token detection reused from the M04 scanner (C10): bounded for the two short
// collision-prone tokens (indices 0 and 3), substring for the five long tokens.
function legacyOffenders(text: string): string[] {
	const hits: string[] = [];
	const tokens = LEGACY_TOKENS as readonly string[];
	tokens.forEach((token, i) => {
		const mode = i === 0 || i === 3 ? "bounded" : "substring";
		if (matchToken(text, token, mode).length > 0) hits.push(token);
	});
	return hits;
}

describe("M15 skill-docs › SKILL frontmatter name", () => {
	it("declares name: lit-loop on line 2 (skill loader contract)", () => {
		expect(/^---\nname: lit-loop\n/m.test(skillText)).toBe(true);
	});
	it("has a non-empty description containing lit-loop and no forbidden token", () => {
		const m = skillText.match(/\ndescription:\s*(.+)/);
		expect(m).not.toBeNull();
		const desc = (m?.[1] ?? "").trim();
		expect(desc.length).toBeGreaterThan(0);
		expect(desc.toLowerCase()).toContain("lit-loop");
		expect(legacyOffenders(desc)).toEqual([]);
	});
	it("has a non-empty metadata.short-description with no forbidden token", () => {
		const m = skillText.match(/short-description:\s*(.+)/);
		expect(m).not.toBeNull();
		const sd = (m?.[1] ?? "").trim();
		expect(sd.length).toBeGreaterThan(0);
		expect(legacyOffenders(sd)).toEqual([]);
	});
});

describe("M15 skill-docs › SKILL required phrases present", () => {
	for (const phrase of contract.requiredPhrases.skill) {
		it(`SKILL.md contains "${phrase}"`, () => {
			expect(skillText).toContain(phrase);
		});
	}
});

describe("M15 skill-docs › workflow required phrases present", () => {
	for (const phrase of contract.requiredPhrases.workflow) {
		it(`full-workflow.md contains "${phrase}"`, () => {
			expect(workflowText).toContain(phrase);
		});
	}
});

describe("M15 skill-docs › documents hook activation", () => {
	it("SKILL names UserPromptSubmit and the <lit-loop-mode> marker", () => {
		expect(skillText).toContain("UserPromptSubmit");
		expect(skillText).toContain("<lit-loop-mode>");
	});
});

describe("M15 skill-docs › state dir is lit-loop", () => {
	it("both docs name .litcodex/lit-loop and never historical state paths", () => {
		expect(skillText).toContain(".litcodex/lit-loop");
		expect(workflowText).toContain(".litcodex/lit-loop");
		const dotLegacy = [".", "o", "m", "o", "/"].join("");
		expect(skillText).not.toContain(dotLegacy);
		expect(workflowText).not.toContain(dotLegacy);
	});
});

describe("M15 skill-docs › rejects legacy tokens (bounded match, M04 scanner)", () => {
	it("SKILL.md has zero legacy offenders", () => {
		expect(legacyOffenders(skillText)).toEqual([]);
	});
	it("full-workflow.md has zero legacy offenders", () => {
		expect(legacyOffenders(workflowText)).toEqual([]);
	});
	it("openai.yaml has zero legacy offenders", () => {
		expect(legacyOffenders(yamlText)).toEqual([]);
	});
	it("bounded match ignores embedded letters (no naive substring ban)", () => {
		// Sanity: a benign word containing the o-m-o letters must NOT trip the bounded matcher.
		expect(legacyOffenders("chromosome homogeneous")).toEqual([]);
		// And a real bounded token must trip it (mutation guard).
		const real = ["o", "m", "o"].join("");
		expect(legacyOffenders(`a ${real} b`)).toContain(real);
	});
});

describe("M15 skill-docs › rejects reference directive markers", () => {
	for (const entry of contract.forbiddenTokens) {
		const tok = "parts" in entry ? entry.parts.join("") : String(entry);
		it(`no doc contains "${tok}"`, () => {
			expect(skillText).not.toContain(tok);
			expect(workflowText).not.toContain(tok);
			expect(yamlText).not.toContain(tok);
		});
	}
});

describe("M15 skill-docs › docs reference only real loop subcommands (canonical verb)", () => {
	const subs = LOOP_SUBCOMMANDS as readonly string[];
	const docs: Array<[string, string]> = [
		["SKILL.md", skillText],
		["full-workflow.md", workflowText],
	];
	for (const [label, text] of docs) {
		it(`${label}: every "litcodex loop <X>" uses a known subcommand`, () => {
			const re = /litcodex loop ([a-z-]+)/g;
			for (const m of text.matchAll(re)) {
				expect(subs).toContain(m[1]);
			}
		});
	}
	it("the only CLI verb preceding a subcommand is the canonical 'litcodex loop'", () => {
		expect(contract.canonicalCliVerb).toBe("litcodex loop");
	});
});

describe("M15 skill-docs › rejects litcodex lit-loop CLI verb (A1)", () => {
	const subs = LOOP_SUBCOMMANDS as readonly string[];
	const docs: Array<[string, string]> = [
		["SKILL.md", skillText],
		["full-workflow.md", workflowText],
	];
	for (const [label, text] of docs) {
		for (const sub of subs) {
			it(`${label}: no "litcodex lit-loop ${sub}" CLI form`, () => {
				const re = new RegExp(`litcodex[ \\t]+lit-loop[ \\t]+${sub}\\b`);
				expect(re.test(text)).toBe(false);
			});
		}
	}
	it("rejects the bare 'litcodex lit-loop' bigram in both docs", () => {
		expect(skillText).not.toContain(contract.forbiddenCliVerb);
		expect(workflowText).not.toContain(contract.forbiddenCliVerb);
	});
	it("allows lit-loop identifier / marker / state-dir uses (positive control)", () => {
		// These legitimate uses are present and must NOT be flagged by the adjacency guard.
		expect(skillText).toContain("<lit-loop-mode>");
		expect(skillText).toContain(".litcodex/lit-loop");
		expect(/^---\nname: lit-loop\n/m.test(skillText)).toBe(true);
		expect(skillText).not.toContain(contract.forbiddenCliVerb);
	});
});

describe("M15 skill-docs › evidence gate language intact (A4)", () => {
	it("full-workflow.md keeps the TESTS ALONE NEVER PROVE DONE axiom", () => {
		expect(workflowText).toContain("TESTS ALONE NEVER PROVE DONE");
	});
	it("contains the blocking rule (leftover live state = blocked, not PASS)", () => {
		expect(/blocked/i.test(workflowText)).toBe(true);
		expect(/blocked/i.test(skillText)).toBe(true);
	});
	it("contains no gate-weakening phrase", () => {
		const weakening =
			/\b(skip|bypass|weaken|auto[-\s]?complete|mark complete|complete faster)\b[^\n]*\b(test|verification|evidence|criteria|gate)\b/i;
		expect(weakening.test(skillText)).toBe(false);
		expect(weakening.test(workflowText)).toBe(false);
	});
	for (const phrase of contract.requiredPhrases.behavioralNonGating) {
		it(`full-workflow.md keeps the non-gating behavioral prose "${phrase}"`, () => {
			expect(workflowText).toContain(phrase);
		});
	}
});

describe("M15 skill-docs › tool mapping pins multi_agent_v1 (A3)", () => {
	it("no doc names the M13-disabled multi_agent_v2 flag", () => {
		expect(skillText).not.toContain(contract.forbiddenToolNamespace);
		expect(workflowText).not.toContain(contract.forbiddenToolNamespace);
	});
	it("every multi_agent_v<N> token starts with the pinned namespace", () => {
		for (const text of [skillText, workflowText]) {
			for (const m of text.matchAll(/multi_agent_v\d+/g)) {
				expect(m[0]).toBe(contract.toolNamespace);
			}
		}
	});
});

describe("M15 skill-docs › bootstrap block extractable + version glob + injection-safe", () => {
	// Extract the fenced ```sh block under "### 1. Create goals from the brief".
	function extractBootstrap(text: string): string | null {
		const headingIdx = text.indexOf("### 1. Create goals from the brief");
		if (headingIdx === -1) return null;
		const fenceOpen = text.indexOf("```sh", headingIdx);
		if (fenceOpen === -1) return null;
		const bodyStart = text.indexOf("\n", fenceOpen) + 1;
		const fenceClose = text.indexOf("```", bodyStart);
		if (fenceClose === -1) return null;
		return text.slice(bodyStart, fenceClose);
	}
	const block = extractBootstrap(workflowText);

	it("a ```sh bootstrap block exists under the heading", () => {
		expect(block).not.toBeNull();
	});
	it("uses the version glob, never a pinned x.y.z cache version", () => {
		expect(block).toContain("plugins/cache/litcodex/litcodex/*/components/lit-loop/dist/cli.js");
		expect(/plugins\/cache\/litcodex\/litcodex\/\d+\.\d+\.\d+\//.test(block ?? "")).toBe(false);
		expect(/\d+\.\d+\.\d+/.test(block ?? "")).toBe(false);
	});
	it("is injection-safe: no eval, no unquoted $CODEX_HOME", () => {
		expect(block).not.toContain("eval");
		// Every $CODEX_HOME expansion in a path context is double-quoted.
		const unquoted = /(?<!")\$CODEX_HOME(?!["}])/;
		// Allow the `${CODEX_HOME:-…}` default-expansion form which is also safe.
		const stripped = (block ?? "").replace(/\$\{CODEX_HOME[^}]*\}/g, "");
		expect(unquoted.test(stripped)).toBe(false);
	});
	it("is fail-soft: writes the notepad and prints the install guidance", () => {
		expect(block).toContain(".litcodex/lit-loop/bootstrap-notepad.md");
		expect(block).toContain("npm install -g @litfamily/litcodex");
	});
	it("bootstrap glob matches the segment constant (A2)", () => {
		const segs = contract.bootstrapCachePathSegments as readonly string[];
		expect(segs[4]).toBe("*");
		expect(segs[2]).toBe("litcodex");
		expect(segs[3]).toBe("litcodex");
		const literal = `"$CODEX_HOME"/${segs.join("/")}`;
		expect(workflowText).toContain(literal);
	});
});

describe("M15 skill-docs › agents/openai.yaml fields", () => {
	it('display_name equals "lit-loop" with no brand suffix', () => {
		expect(yamlText).toContain('display_name: "lit-loop"');
		// No "(…)" brand suffix on the display name line.
		const line = yamlText.split("\n").find((l) => l.includes("display_name")) ?? "";
		expect(/\(.*\)/.test(line)).toBe(false);
	});
	it("short_description is present and non-empty", () => {
		const m = yamlText.match(/short_description:\s*"(.*)"/);
		expect(m).not.toBeNull();
		expect((m?.[1] ?? "").length).toBeGreaterThan(0);
	});
	it('search_terms contains the exact item "lit-loop"', () => {
		expect(yamlText).toMatch(/^\s*-\s*"lit-loop"\s*$/m);
	});
	it("default_prompt contains $lit-loop", () => {
		const m = yamlText.match(/default_prompt:\s*"(.*)"/);
		expect(m).not.toBeNull();
		expect(m?.[1]).toContain("$lit-loop");
	});
});

describe("M15 skill-docs › cross-check against the M04 scanner (scanText, C10)", () => {
	it("scanText reports zero hits for all three docs", () => {
		// "scanner clean" ⇔ "guard clean": run the real scanner matcher over the doc bytes.
		expect(scanText(SKILL_MD, skillText)).toEqual([]);
		expect(scanText(WORKFLOW_MD, workflowText)).toEqual([]);
		expect(scanText(OPENAI_YAML, yamlText)).toEqual([]);
	});
});
