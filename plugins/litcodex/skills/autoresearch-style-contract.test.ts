import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILL = fileURLToPath(new URL("./autoresearch/", import.meta.url));

const read = (relativePath: string): string => readFileSync(`${SKILL}${relativePath}`, "utf8");

// style_presets.py carries the whole shipped style contract, but rcparams() only
// takes effect if it runs before the figure is created. Resolving the file for a
// --check preflight and never applying it leaves that contract dead at plot time.
describe("autoresearch figure style contract #given/#when/#then", () => {
	it("tells figure scripts to apply rcparams before creating the figure", () => {
		const guide = read("references/visualization-guide.md");
		expect(guide).toContain("rcparams");
		// [\s\S] rather than . because the rule wraps across lines in markdown.
		expect(guide).toMatch(/before[\s\S]{0,40}plt\.(subplots|figure)/i);
	});

	it("repeats the ordering rule where the function is defined", () => {
		const presets = read("scripts/style_presets.py");
		expect(presets).toMatch(/before .*(plt\.subplots|plt\.figure|creating the figure)/i);
	});

	it("points at the scientific visualization skill for figure work", () => {
		expect(read("references/visualization-guide.md")).toContain("lit-scientific-visualization");
	});

	it("keeps the matplotlib preflight blocker", () => {
		expect(read("references/visualization-guide.md")).toContain("BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE");
	});
});
