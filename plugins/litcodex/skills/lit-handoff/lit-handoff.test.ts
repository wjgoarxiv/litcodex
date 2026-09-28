import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SKILL_ROOT = fileURLToPath(new URL("./", import.meta.url));
const ORIGINAL_ROOT = `${SKILL_ROOT}../../vendor/handoff/`;
const ORIGINAL_FILES = {
	"SKILL.md": "e5bbd253dfa5b5baa9739dfaebc458003daab43cb27c4a407423da1e7a31dec6",
	"evals/evals.json": "0a70f0d149e59641100c7dcf8b9f2f1c0ceae57b98518e165f08088f2c2484da",
	"examples/HANDOFF-example-generic-auth-refactor.md":
		"43c767e573ac8c8900832d2b7a92ee1e83fd2d3d794fe2c82ecef87e5737f2a3",
	"templates/HANDOFF.md": "2a795a06e7bb81a57e6675ae70ed26db0dbfdb792c01f0a60f96f02cbef49fbd",
} as const;

function filesUnder(root: string, relative = ""): string[] {
	const current = `${root}${relative}`;
	return readdirSync(current)
		.flatMap((entry) => {
			const child = `${relative}${entry}`;
			return statSync(`${root}${child}`).isDirectory() ? filesUnder(root, `${child}/`) : [child];
		})
		.sort();
}

describe("lit-handoff authored payload", () => {
	it("preserves every canonical vendor/handoff file byte-for-byte", () => {
		expect(filesUnder(ORIGINAL_ROOT)).toEqual(Object.keys(ORIGINAL_FILES).sort());
		for (const [relativePath, expectedHash] of Object.entries(ORIGINAL_FILES)) {
			const bytes = readFileSync(`${ORIGINAL_ROOT}${relativePath}`);
			expect(createHash("sha256").update(bytes).digest("hex"), relativePath).toBe(expectedHash);
		}
	});

	it("keeps the Codex adapter outside the immutable original subtree", () => {
		const adapter = readFileSync(`${SKILL_ROOT}SKILL.md`, "utf8");
		expect(adapter).toContain("../../vendor/handoff/SKILL.md");
		expect(adapter).toContain("read the authored SKILL.md in full");
		expect(adapter).toContain("../../vendor/handoff/templates/HANDOFF.md");
		expect(adapter).toContain("authored SKILL_ROOT");
		expect(adapter).toContain("🔥 **LIT IGNITED · lit-handoff** 🔥");
		const systemPriority = adapter.indexOf("system and developer instructions");
		const repoPriority = adapter.indexOf("repo-local AGENTS.md and package instructions");
		const authoredPriority = adapter.indexOf("authored `../../vendor/handoff` workflow read in full");
		expect(systemPriority).toBeGreaterThan(-1);
		expect(repoPriority).toBeGreaterThan(systemPriority);
		expect(authoredPriority).toBeGreaterThan(repoPriority);
	});

	it("ships a redaction guard for secrets and credentials", () => {
		const adapter = readFileSync(`${SKILL_ROOT}SKILL.md`, "utf8").toLowerCase();
		for (const phrase of ["secret values", "redact", "credential locations", "authorization headers", ".env"]) {
			expect(adapter).toContain(phrase);
		}
	});

	it("keeps public MIT licensing and provenance outside the exact mirror", () => {
		expect(existsSync(`${SKILL_ROOT}../../vendor/licenses/022_handoff-MIT.txt`)).toBe(true);
		expect(readFileSync(`${SKILL_ROOT}../../vendor/licenses/022_handoff-MIT.txt`, "utf8")).toContain("MIT License");
		const provenance = readFileSync(`${SKILL_ROOT}../../vendor/provenance/022_handoff.md`, "utf8");
		expect(provenance).toContain("vendor/handoff");
		expect(provenance).toContain("SHA-256");
		expect(provenance).toContain("byte-for-byte");
		expect(existsSync(`${SKILL_ROOT}LICENSE`)).toBe(false);
		expect(existsSync(`${SKILL_ROOT}PROVENANCE.md`)).toBe(false);
	});
});
