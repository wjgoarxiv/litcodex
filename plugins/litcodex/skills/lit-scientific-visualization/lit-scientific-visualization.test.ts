import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SKILL_ROOT = fileURLToPath(new URL("./", import.meta.url));
const ORIGINAL_ROOT = `${SKILL_ROOT}../../vendor/scientific-visualization/`;
const EXPECTED_MANIFEST = "b1b8f1bf8791daecdbb00dc70631cd955e72976664d302af0bc81e218b9cec3b";
const ORIGINAL_FILES = {
	"SKILL.md": "d6084a7e3adf283157820ea20dbe1b46fa22fa1be17b138ab1203be550f4ef68",
	"assets/color_palettes.py": "ffea28da930406ecb11bbeaebfc530dfac40b772827a7653f449cb3b0bb35309",
	"assets/nature.mplstyle": "6a7343788bf772b7e1bc813d094f7bafa97c1e5544586e7b76002ad8547229b6",
	"assets/presentation.mplstyle": "e3ee23f0470d7fb07a0be75cd1210e231becfc2f5267aa404e4186aa077a3339",
	"assets/publication.mplstyle": "18447af3bc47310d23fc27255413c23d8bbe3ff441463cc54fcecdfacd205bea",
	"evals/evals.json": "366dc61b6e042f08f28bf33f2534feea80219d771b84497ec7094b30263e935b",
	"references/color_palettes.md": "0298691c8de8379570488a7b7768663971bc20af1fb05d464c5438d43a21dcfa",
	"references/journal_requirements.md": "56fdde590a9d778547dbcb609b77d86f1f31865e803bcecca5d8c4c72b91b3c7",
	"references/matplotlib_examples.md": "c99cd4f83e2452773e9580e2fa0984e61433c7a9b57ca0d2562dc400dfe4f83d",
	"references/mdanalysis_martini_visualization.md":
		"abcb3c61f1c3984ba9014d9ae197b726d23c1df844dc90988ecc4d8f0e349bfe",
	"references/publication_guidelines.md": "d9f5d0f115872c4c190a11d83432d44635e38ef9f1740db471fcc70f4c91dd2c",
	"references/seaborn_for_publications.md":
		"2da2147ae8974b4b5d16096c1484b982d5d1e5f91113808ebfd12111a0a6597a",
	"scripts/figure_export.py": "b22c7708afaf2a1cfa4f821eb9230d4262f1d52948af7f0815855aa9d0960403",
	"scripts/style_presets.py": "e9d450bd4ab6b11303b02d5029177c8d49466cc597648d12de0ecdb7620f64c4",
	"tests/test_figure_export.py": "b18414369e6721ad93d417914114d71af006248675eb20bb1f4989c48ec9a58e",
	"tests/test_style_presets.py": "ff0e190196480848f1fea2398220038771f386ee7967a0ef122b0dfbca3aed46",
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

function sha256(bytes: NodeJS.ArrayBufferView | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

describe("lit-scientific-visualization canonical payload", () => {
	it("contains exactly the 16 authorized Git-tracked files with per-file and aggregate parity", () => {
		const expectedPaths = Object.keys(ORIGINAL_FILES).sort();
		expect(filesUnder(ORIGINAL_ROOT)).toEqual(expectedPaths);
		const records = expectedPaths.map((path) => {
			const digest = sha256(readFileSync(`${ORIGINAL_ROOT}${path}`));
			expect(digest, path).toBe(ORIGINAL_FILES[path as keyof typeof ORIGINAL_FILES]);
			return `${digest}  045_scientific-visualization/${path}\n`;
		});
		expect(sha256(records.join(""))).toBe(EXPECTED_MANIFEST);
		expect(filesUnder(ORIGINAL_ROOT).some((path) => path.includes("__pycache__") || path.endsWith(".pyc"))).toBe(
			false,
		);
	});

	it("uses native picker, scoped, and exact-hook routes with package-local source resolution", () => {
		const adapter = readFileSync(`${SKILL_ROOT}SKILL.md`, "utf8");
		for (const required of [
			"🔥 **LIT IGNITED · lit-scientific-visualization** 🔥",
			"$litcodex:lit-scientific-visualization",
			"Codex skill picker",
			"exact complete prompt",
			"<lit-scientific-visualization-mode>",
			"bare_user_prompt_submit_route: true",
			'hook_mode_marker: "<lit-scientific-visualization-mode>"',
			"../../vendor/scientific-visualization/SKILL.md",
			"../../vendor/scientific-visualization/scripts",
			"../../vendor/scientific-visualization/assets",
			"read the authored SKILL.md in full",
		])
			expect(adapter).toContain(required);
		const priorities = [
			adapter.indexOf("system and developer instructions"),
			adapter.indexOf("repo-local AGENTS.md and output requirements"),
			adapter.indexOf("authored 045_scientific-visualization SKILL.md read in full"),
		];
		expect(priorities[0]).toBeGreaterThan(-1);
		expect(priorities[1]).toBeGreaterThan(priorities[0] ?? -1);
		expect(priorities[2]).toBeGreaterThan(priorities[1] ?? -1);
	});

	it("keeps MIT licensing, provenance, and CP/SDS notice outside the immutable source", () => {
		expect(readFileSync(`${SKILL_ROOT}../../vendor/licenses/045_scientific-visualization-MIT.txt`, "utf8")).toContain("MIT License");
		const provenance = readFileSync(`${SKILL_ROOT}../../vendor/provenance/045_scientific-visualization.md`, "utf8");
		expect(provenance).toContain(EXPECTED_MANIFEST);
		expect(provenance).toContain("16 Git-tracked files");
		const notice = readFileSync(`${SKILL_ROOT}../../vendor/NOTICE`, "utf8");
		for (const required of ["CP/SDS", "Paul Tol", "ColorBrewer"]) expect(notice).toContain(required);
		for (const name of ["LICENSE", "PROVENANCE.md", "NOTICE"])
			expect(existsSync(`${SKILL_ROOT}${name}`)).toBe(false);
	});
});
