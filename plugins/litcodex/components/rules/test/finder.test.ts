import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findRuleCandidates } from "../src/rules/finder.js";
import type { RuleCandidate } from "../src/rules/types.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function makeProject(): { projectRoot: string; homeRoot: string; targetPath: string } {
	const projectRoot = mkdtempSync(join(tmpdir(), "codex-rules-finder-project-"));
	const homeRoot = mkdtempSync(join(tmpdir(), "codex-rules-finder-home-"));
	tempDirectories.push(projectRoot, homeRoot);
	mkdirSync(join(projectRoot, "src", ".litcodex", "rules"), { recursive: true });
	mkdirSync(join(projectRoot, ".litcodex", "rules"), { recursive: true });
	mkdirSync(join(homeRoot, ".litcodex", "rules"), { recursive: true });
	writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "fixture" }));
	writeFileSync(join(projectRoot, "AGENTS.md"), "Project rule\n");
	writeFileSync(join(projectRoot, "CLAUDE.md"), "Claude rule\n");
	writeFileSync(join(projectRoot, "src", ".litcodex", "rules", "local.md"), "Local rule\n");
	writeFileSync(join(projectRoot, ".litcodex", "rules", "root.md"), "Root rule\n");
	writeFileSync(join(homeRoot, ".litcodex", "rules", "global.md"), "Global rule\n");
	const targetPath = join(projectRoot, "src", "app.ts");
	writeFileSync(targetPath, "export const app = true;\n");
	return { projectRoot, homeRoot, targetPath };
}

function candidateSummary(candidate: RuleCandidate): string {
	return `${candidate.source}:${candidate.distance}:${candidate.relativePath}`;
}

describe("findRuleCandidates", () => {
	it("#given project and user-home rules #when target file is inside project #then candidates keep source distance", () => {
		// given
		const { projectRoot, homeRoot, targetPath } = makeProject();

		// when
		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: targetPath,
			homeDir: homeRoot,
			disabledSources: new Set(["plugin-bundled"]),
		});

		// then
		expect(candidates.map(candidateSummary)).toEqual([
			".litcodex/rules:0:src/.litcodex/rules/local.md",
			".litcodex/rules:1:.litcodex/rules/root.md",
			"~/.litcodex/rules:9999:.litcodex/rules/global.md",
		]);
	});

	it("#given disabled source #when finding candidates #then matching source is omitted", () => {
		// given
		const { projectRoot, homeRoot, targetPath } = makeProject();

		// when
		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: targetPath,
			homeDir: homeRoot,
			disabledSources: new Set([".litcodex/rules", "~/.litcodex/rules", "plugin-bundled"]),
		});

		// then
		expect(candidates.map(candidateSummary)).toEqual([]);
	});

	it("#given skip user home #when finding candidates #then only project rules are returned", () => {
		// given
		const { projectRoot, homeRoot, targetPath } = makeProject();

		// when
		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: targetPath,
			homeDir: homeRoot,
			skipUserHome: true,
			disabledSources: new Set(["plugin-bundled"]),
		});

		// then
		expect(candidates.map(candidateSummary)).toEqual([
			".litcodex/rules:0:src/.litcodex/rules/local.md",
			".litcodex/rules:1:.litcodex/rules/root.md",
		]);
	});
});
