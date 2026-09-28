// src/litwork-content.test.ts — W3 litwork directive + agent .toml content invariants.
//
// Guards the ported litwork content (directives/litwork.md + agents/litcodex-*.toml): the directive
// wrapper + canonical probe line, the agent .toml schema + native role names, the agent_type lockstep between
// directive and agents, and a TARGETED legacy-token sweep (RC3) that also covers the legacy wrapper (the
// legacy shell wrapper, NOT in the global six-token scanner). Legacy tokens are assembled from
// fragments so THIS test file stays scanner-clean with no allowlist entry (self-immune).

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIRECTIVES_DIR = fileURLToPath(new URL("../directives/", import.meta.url));
const AGENTS_DIR = fileURLToPath(new URL("../agents/", import.meta.url));

const LITWORK_DIRECTIVE = readFileSync(new URL("../directives/litwork.md", import.meta.url), "utf8");
const AGENT_FILES = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".toml"));

// The six brand legacy tokens + the legacy shell wrapper, assembled from fragments (self-immunity).
const FORBIDDEN = [
	["ultra", "work"].join(""),
	["spark", "shell"].join(""),
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["oh-my-", "openagent"].join(""),
];
const BOUNDED_FORBIDDEN = [["o", "m", "o"].join(""), ["u", "l", "w"].join("")];

/** Every legacy substring + bounded whole-word hit in `text` (lowercased). */
function legacyHits(text: string): string[] {
	const lower = text.toLowerCase();
	const hits: string[] = [];
	for (const t of FORBIDDEN) if (lower.includes(t)) hits.push(t);
	for (const t of BOUNDED_FORBIDDEN) {
		if (new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(lower)) hits.push(t);
	}
	return hits;
}

const EXPECTED_AGENTS = [
	"litcodex-default",
	"litcodex-explorer",
	"litcodex-librarian",
	"litcodex-metis",
	"litcodex-plan",
	"litcodex-momus",
	"litcodex-litwork-reviewer",
];

describe("litwork directive (directives/litwork.md)", () => {
	it("is wrapped in the <litwork-mode> marker pair", () => {
		expect(LITWORK_DIRECTIVE.trim().startsWith("<litwork-mode>")).toBe(true);
		expect(LITWORK_DIRECTIVE.trim().endsWith("</litwork-mode>")).toBe(true);
	});

	it("mandates the 🔥 **LIT IGNITED · litwork** 🔥 probe as the first user-visible line", () => {
		expect(LITWORK_DIRECTIVE).toContain("🔥 **LIT IGNITED · litwork** 🔥");
		expect(LITWORK_DIRECTIVE).toContain("First user-visible line this turn MUST be exactly");
	});

	it("carries NO legacy token (RC3: includes legacy wrapper)", () => {
		expect(legacyHits(LITWORK_DIRECTIVE)).toEqual([]);
	});

	it("references every litwork agent by its litcodex-* agent_type and no bare role name", () => {
		for (const name of EXPECTED_AGENTS) {
			expect(LITWORK_DIRECTIVE).toContain(name);
		}
		// the bare reference-archive role names must NOT survive as standalone agent_type tokens.
		for (const bare of ["explorer", "librarian", "metis", "momus"]) {
			expect(new RegExp(`agent_type[^\\n]*["'\`]${bare}["'\`]`).test(LITWORK_DIRECTIVE)).toBe(false);
		}
	});
});

describe("litwork agents (agents/litcodex-*.toml plus the native default role)", () => {
	it("ships the six selectable roles plus the native generic default role", () => {
		const names = AGENT_FILES.map((f) => f.replace(/\.toml$/, "")).sort();
		expect(names).toEqual([...EXPECTED_AGENTS].sort());
	});

	it.each(AGENT_FILES)("%s has a valid schema, a native role name, and no legacy token", (file) => {
		const body = readFileSync(new URL(`../agents/${file}`, import.meta.url), "utf8");
		const nameMatch = body.match(/^name = "([^"]+)"/m);
		const expectedName = file === "litcodex-default.toml" ? "default" : file.replace(/\.toml$/, "");
		expect(nameMatch?.[1]).toBe(expectedName);
		if (file !== "litcodex-default.toml") expect(nameMatch?.[1]?.startsWith("litcodex-")).toBe(true);
		expect(body).toMatch(/^description = /m);
		expect(body).toMatch(/^model = /m);
		expect(body).toMatch(/developer_instructions = """/);
		expect(legacyHits(body)).toEqual([]);
	});

	it("litcodex-plan permits small plans and carries a minimum-first scope guard", () => {
		const body = readFileSync(new URL("../agents/litcodex-plan.toml", import.meta.url), "utf8");
		expect(body).toContain("single-task or few-task plan");
		expect(body).toContain("minimum-first");
		expect(body).toContain("reuse existing code");
	});

	it("litcodex-litwork-reviewer rejects minimum-first drift", () => {
		const body = readFileSync(new URL("../agents/litcodex-litwork-reviewer.toml", import.meta.url), "utf8");
		expect(body).toContain("minimum-first");
		expect(body).toContain("existing code");
		expect(body).toContain("standard library");
		expect(body).toContain("external-source");
	});
});

describe("directives/ dir", () => {
	it("contains litwork.md", () => {
		expect(readdirSync(DIRECTIVES_DIR)).toContain("litwork.md");
	});
});
