// src/lit-recap-content.test.ts — lit-recap directive content invariants (SC3/SC4/SC5).
//
// Guards directives/lit-recap.md: wrapper markers, the canonical probe line, the five locked Korean recap
// headers, the read-only clause, the ledger read paths, the brief/English switches, and the
// ABSENCE of every mutating loop verb (the recap surface never writes). Legacy literals are
// assembled from fragments so this file stays scanner-clean.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const litRecap = readFileSync(new URL("../directives/lit-recap.md", import.meta.url), "utf8");
const litRecapSkill = readFileSync(new URL("../../../skills/lit-recap/SKILL.md", import.meta.url), "utf8");

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

describe("lit-recap directive (directives/lit-recap.md)", () => {
	it("is wrapped in <lit-recap-mode> and mandates the 🔥 **LIT IGNITED · lit-recap** 🔥 probe", () => {
		expect(litRecap.trim().startsWith("<lit-recap-mode>")).toBe(true);
		expect(litRecap.trim().endsWith("</lit-recap-mode>")).toBe(true);
		expect(litRecap).toContain("🔥 **LIT IGNITED · lit-recap** 🔥");
	});

	it("carries the five locked Korean recap headers plus the brief digest header (SC3)", () => {
		for (const header of [
			"# 작업 리캡 (lit-recap)",
			"## ✅ 완료된 작업",
			"## 🔄 진행 중",
			"## ⛔ 블로커",
			"## 📁 증거 경로",
			"## ➡️ 다음 단계",
			"## ⚡ 요약",
		]) {
			expect(litRecap).toContain(header);
		}
	});

	it("is explicitly read-only and names the exact durable ledger read paths (SC4)", () => {
		expect(litRecap).toContain("읽기 전용");
		expect(litRecap).toContain("MUST NOT write");
		expect(litRecap).toContain(".litcodex/start-work/state.json");
		expect(litRecap).toContain(".litcodex/lit-loop/brief.md");
		expect(litRecap).toContain(".litcodex/lit-loop/goals.json");
		expect(litRecap).toContain(".litcodex/lit-loop/ledger.jsonl");
		expect(litRecap).not.toContain(".litcodex/start-work/ledger.jsonl");
		expect(litRecapSkill).toContain(".litcodex/lit-loop/ledger.jsonl");
		expect(litRecapSkill).not.toContain(".litcodex/start-work/ledger.jsonl");
	});

	it("contains NO mutating loop verb or goal tool (SC4 negative)", () => {
		for (const mutating of [
			"litcodex loop create",
			"litcodex loop run",
			"litcodex loop checkpoint",
			"litcodex loop record-evidence",
			"create_goal",
			"update_goal",
		]) {
			expect(litRecap).not.toContain(mutating);
		}
	});

	it("defaults to Korean with the English and brief switches (SC5)", () => {
		expect(litRecap).toContain("--en");
		expect(litRecap).toContain("영어로");
		expect(litRecap).toContain("--brief");
		expect(litRecap).toContain("짧게");
	});

	it("carries no legacy token", () => {
		expect(legacyHits(litRecap)).toEqual([]);
	});
});
