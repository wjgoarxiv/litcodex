// src/comprehend-content.test.ts — lit-comprehend directive content invariants.
//
// Guards directives/lit-comprehend.md: wrapper markers, the canonical probe line, canonical Korean section
// headers, the output-routing clause (--md / --en), the worktree-boundary hard stop, the
// verifier invocation requirement, and the ABSENCE of mutating loop verbs (lit-comprehend never
// writes ledger state). Legacy literals are assembled from fragments so this file stays
// scanner-clean.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const comprehendDirective = readFileSync(new URL("../directives/lit-comprehend.md", import.meta.url), "utf8");
const comprehendSkill = readFileSync(new URL("../../../skills/lit-comprehend/SKILL.md", import.meta.url), "utf8");
const comprehendTemplate = readFileSync(
	new URL("../../../skills/lit-comprehend/references/artifact-template.md", import.meta.url),
	"utf8",
);
const comprehendVerifier = readFileSync(
	new URL("../../../skills/lit-comprehend/scripts/verify-explainer.ts", import.meta.url),
	"utf8",
);

const FORBIDDEN = [
	["ultra", "work"].join(""),
	["spark", "shell"].join(""),
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["oh-my-", "openagent"].join(""),
];
const BOUNDED = [["o", "m", "o"].join(""), ["u", "l", "w"].join("")];

function legacyHits(text: string): string[] {
	const lower = text.toLowerCase();
	const hits: string[] = [];
	for (const t of FORBIDDEN) if (lower.includes(t)) hits.push(t);
	for (const t of BOUNDED) if (new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(lower)) hits.push(t);
	return hits;
}

describe("lit-comprehend directive (directives/lit-comprehend.md)", () => {
	it("is wrapped in <lit-comprehend-mode> and mandates the 🔥 **LIT IGNITED · lit-comprehend** 🔥 probe", () => {
		expect(comprehendDirective.trim().startsWith("<lit-comprehend-mode>")).toBe(true);
		expect(comprehendDirective.trim().endsWith("</lit-comprehend-mode>")).toBe(true);
		expect(comprehendDirective).toContain("🔥 **LIT IGNITED · lit-comprehend** 🔥");
	});

	it("carries the reader-facing Korean section headers", () => {
		for (const header of ["한눈에", "이미 알고 있던 것", "직관", "바뀐 것", "퀴즈", "다음"]) {
			expect(comprehendDirective).toContain(header);
		}
	});

	it("routes to Skill(lit-comprehend) and references the output path", () => {
		expect(comprehendDirective).toContain("Skill(lit-comprehend)");
		expect(comprehendDirective).toContain("~/.litcodex/lit-comprehend/");
	});

	it("supports --md and --en output switches", () => {
		expect(comprehendDirective).toContain("--md");
		expect(comprehendDirective).toContain("--en");
	});

	it("references the verifier script", () => {
		expect(comprehendDirective).toContain("verify-explainer");
	});

	it("keeps command receipts internal and limits the reader reply", () => {
		expect(comprehendDirective).toContain("internal_ledger_path");
		expect(comprehendDirective).toContain("one decision-relevant limitation");
		expect(comprehendDirective).not.toContain('"evidence": ["command transcripts');
	});

	it("teaches the data-src code-attribution markup", () => {
		expect(comprehendDirective).toContain("data-src");
	});

	it("enforces the execution gate: proceed on explicit target, propose and wait on inferred scope", () => {
		expect(comprehendDirective).toContain("activation is not build permission");
		expect(comprehendDirective).toContain("Proceed immediately");
		expect(comprehendDirective).toContain("Propose the scope and wait for approval");
		expect(comprehendDirective).toContain("Do not read the tree at this stage");
	});

	it("enforces the worktree boundary hard stop", () => {
		expect(comprehendDirective).toContain("Never write the artifact inside the repository worktree");
		expect(comprehendDirective).toContain("never `git add` it");
	});

	it("contains NO mutating loop verb or goal tool", () => {
		for (const mutating of [
			"litcodex loop create",
			"litcodex loop run",
			"litcodex loop checkpoint",
			"litcodex loop record-evidence",
			"create_goal",
			"update_goal",
		]) {
			expect(comprehendDirective).not.toContain(mutating);
		}
	});

	it("carries no legacy token", () => {
		expect(legacyHits(comprehendDirective)).toEqual([]);
	});
});

describe("lit-comprehend SKILL.md", () => {
	it("has the correct frontmatter name", () => {
		expect(comprehendSkill).toContain("name: lit-comprehend");
	});

	it("carries the reader-facing Korean section headers", () => {
		for (const header of ["한눈에", "이미 알고 있던 것", "직관", "바뀐 것", "직접 만져보기", "퀴즈", "다음"]) {
			expect(comprehendSkill).toContain(header);
		}
	});

	it("routes exact receipts and unresolved questions to a private ledger", () => {
		expect(comprehendSkill).toContain("~/.litcodex/lit-comprehend/YYYY-MM-DD-<slug>.ledger.md");
		expect(comprehendSkill).toContain("Mention one material limitation once");
		expect(comprehendTemplate).toContain("Keep the full verification record");
		expect(comprehendTemplate).not.toContain(["### 6. ", "확인 안 된 것"].join(""));
		expect(comprehendTemplate).not.toContain(["### 7. ", "증거"].join(""));
		expect(comprehendVerifier).not.toContain(["확인", " 안 된 것"].join(""));
		expect(comprehendVerifier).not.toContain(["증", "거"].join(""));
	});

	it("references the output path and verifier", () => {
		expect(comprehendSkill).toContain("~/.litcodex/lit-comprehend/");
		expect(comprehendSkill).toContain("verify-explainer");
	});

	it("teaches the data-src code-attribution markup with rationale", () => {
		expect(comprehendSkill).toContain("data-src");
		expect(comprehendSkill).toContain("verifier");
	});

	it("enforces the execution gate: proceed on explicit target, propose and wait on inferred scope", () => {
		expect(comprehendSkill).toContain("activation is not build permission");
		expect(comprehendSkill).toContain("Proceed immediately");
		expect(comprehendSkill).toContain("Propose the scope and wait for approval");
		expect(comprehendSkill).toContain("Do not read the tree at this stage");
	});

	it("carries no legacy token", () => {
		expect(legacyHits(comprehendSkill)).toEqual([]);
	});
});
