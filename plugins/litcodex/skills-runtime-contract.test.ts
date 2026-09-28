import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMMENT_CHECKER_SKILL,
	filesUnder,
	LIT_CRUCIBLE_SKILL,
	LSP_SETUP_SKILL,
	LSP_SKILL,
	legacyHits,
	PACKAGE_README,
	REPO_README,
	SKILLS_DIR,
	skillMarkdown,
	skillNames,
	TEST_SURFACE,
} from "./skills-validation-fixtures.js";

describe("plugin-root skill runtime contracts", () => {
	it("bundled private-skill adapters are discoverable and documented on their real Codex routes", () => {
		const packageReadme = readFileSync(PACKAGE_README, "utf8");
		const repoReadme = readFileSync(REPO_README, "utf8");
		for (const name of ["lit-handoff", "lit-scientific-visualization"]) {
			expect(skillNames).toContain(name);
			expect(packageReadme).toContain(`$litcodex:${name}`);
		}
		expect(packageReadme).toContain("exact bare `handoff`");
		expect(packageReadme).toMatch(/exact bare\s+`lit-scientific-visualization` hook route/u);
		expect(packageReadme).toContain("does not install Python dependencies");
		const activationIntro = repoReadme.slice(
			repoReadme.indexOf("## Activate lit"),
			repoReadme.indexOf("## The lit command family"),
		);
		expect(activationIntro).toContain("exact bare `handoff`");
		expect(activationIntro).toContain("<lit-scientific-visualization-mode>");
		expect(activationIntro).toContain("exact-only routes");
	});

	it("lit-crucible skill is discoverable with a LitCodex-native adversarial planning contract", () => {
		const md = skillMarkdown(LIT_CRUCIBLE_SKILL);
		expect(md, `${LIT_CRUCIBLE_SKILL}/SKILL.md should exist`).not.toBe("");
		expect(md).toMatch(/^name:\s*lit-crucible\s*$/m);
		expect(md).toContain(`🔥 **LIT IGNITED · ${LIT_CRUCIBLE_SKILL}** 🔥`);
		expect(md).toContain("adversarial planning");
		expect(md).toContain("lit-plan");
		expect(legacyHits(md)).toEqual([]);
	});

	it("lsp skill documents the bundled inert hook instead of unavailable MCP tool calls", () => {
		const md = skillMarkdown(LSP_SKILL);
		expect(md, `${LSP_SKILL}/SKILL.md should exist`).not.toBe("");
		expect(md).not.toMatch(/mcp__lsp__/i);
		expect(md).not.toMatch(
			/\blsp\.(?:status|diagnostics|goto_definition|find_references|symbols|prepare_rename|rename)\b/,
		);
		expect(md).toContain("MCP LSP server is not bundled");
		expect(md).toContain("PostToolUse");
		expect(md).toContain("emits no diagnostics");
	});

	it("lsp-setup docs and scripts do not point at the absent lsp-tools engine", () => {
		const root = `${SKILLS_DIR}${LSP_SETUP_SKILL}/`;
		const checkedFiles = [
			`${root}SKILL.md`,
			...filesUnder(`${root}scripts/`, (relativePath) => relativePath.endsWith(".ts")),
			...filesUnder(`${root}references/`, (relativePath) => relativePath.endsWith(".md")),
		];
		const bannedClaims = [
			/packages\/lsp-tools-mcp/i,
			/lsp-tools-mcp engine/i,
			/call the `lsp` MCP/i,
			/bun \.\.\/\.\.\/scripts\/verify-lsp\.ts/i,
		] as const;
		const hits = checkedFiles.flatMap((path) => {
			const text = readFileSync(path, "utf8");
			return bannedClaims.filter((claim) => claim.test(text)).map((claim) => `${path}:${claim.source}`);
		});
		expect(hits).toEqual([]);
		expect(skillMarkdown(LSP_SETUP_SKILL)).toContain("unavailable in this LitCodex build");
		const verify = readFileSync(`${root}scripts/verify-lsp.ts`, "utf8");
		expect(verify).toContain("node:child_process");
		expect(verify).toContain("textDocument/publishDiagnostics");
		expect(verify).toContain("Content-Length");
		expect(verify).not.toMatch(/loadModule|executeLspDiagnostics/);
	});

	it("comment-checker skill makes the optional missing engine behavior explicit", () => {
		const md = skillMarkdown(COMMENT_CHECKER_SKILL);
		expect(md, `${COMMENT_CHECKER_SKILL}/SKILL.md should exist`).not.toBe("");
		expect(md).toContain("optional checker engine");
		expect(md).toContain("missing engine");
		expect(md).toContain("emits no hook output");
		expect(md).not.toMatch(/automatic comment-checker feedback/i);
		expect(md).not.toMatch(/reports a warning after a patch/i);
	});

	it("future Korean prose tests and fixtures do not carry forbidden external identifiers", () => {
		const hits = TEST_SURFACE.flatMap((path, index) =>
			legacyHits(readFileSync(path, "utf8")).map((_, hitIndex) => `surface-${index + 1}:term-${hitIndex + 1}`),
		);
		expect(hits).toEqual([]);
	});
});
