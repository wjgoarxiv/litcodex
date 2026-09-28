import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FRONTEND_UIUX_PAYLOAD_HASHES } from "../../../../packages/litcodex-ai/src/install/skill-resource-hashes.js";
import { uiuxDesignContract } from "../../../../tools/uiux-design-contract.mjs";
import { runUserPromptSubmitHook } from "../../components/lit-loop/src/codex-hook.js";
import { validateDesignContract } from "./scripts/validate-design-contract.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const skill = readFileSync(new URL("./SKILL.md", import.meta.url), "utf8");

function runtimeFiles(root: string): string[] {
	const files: string[] = [];
	const pending = [""];
	while (pending.length > 0) {
		const directory = pending.pop() ?? "";
		for (const name of readdirSync(`${root}${directory}`)) {
			const path = directory === "" ? name : `${directory}/${name}`;
			const stat = lstatSync(`${root}${path}`);
			if (stat.isDirectory() && path !== "fixtures") pending.push(path);
			else if (stat.isDirectory()) continue;
			else if (!path.endsWith(".test.ts")) files.push(path);
		}
	}
	return files.sort();
}

describe("frontend-ui-ux picker-native characterization", () => {
	it("grounds page hierarchy and accessibility in the user's goal", () => {
		expect(skill).toContain("Lead with the user's primary information and actions");
		const detail = readFileSync(new URL("./references/complete-contract.md", import.meta.url), "utf8");
		expect(detail).toContain("derive the information hierarchy from the user's task");
		expect(detail).toContain("Inspect every appearance mode actually shipped");
	});

	it("checks visible interactions in a real render", () => {
		expect(skill).toContain("navigation, links, and visible controls");
		const detail = readFileSync(new URL("./references/complete-contract.md", import.meta.url), "utf8");
		expect(detail).toContain("Every visible control or status indicator must have truthful behavior");
	});

	it("keeps interactive pages functional and straightforward to run", () => {
		expect(skill).toContain("implement the interactions needed for the user's task");
		const detail = readFileSync(new URL("./references/complete-contract.md", import.meta.url), "utf8");
		expect(detail).toContain("derive the essential user flows from the stated outcome");
		expect(detail).toContain("Document and exercise the actual launch path");
	});

	it("keeps the model-facing entrypoint bounded and routes dense detail lazily", () => {
		expect(Buffer.byteLength(skill, "utf8")).toBeLessThanOrEqual(4096);
		expect(skill).toContain("references/complete-contract.md");
		const detail = new URL("./references/complete-contract.md", import.meta.url);
		expect(existsSync(detail)).toBe(true);
		expect(Buffer.byteLength(readFileSync(detail, "utf8"), "utf8")).toBeGreaterThanOrEqual(15_000);
	});

	it("documents the installed validator's public flag interface", () => {
		expect(skill).toContain('validate-design-contract.mjs" --input design-contract.json');
		expect(skill).not.toContain('validate-design-contract.mjs" contract.json');
	});

	it("derives validator and resource paths from the exact host-selected skill file", () => {
		expect(skill).toContain("FRONTEND_UIUX_SKILL_FILE");
		expect(skill).toContain("FRONTEND_UIUX_SKILL_ROOT");
		expect(skill).toContain('node "$FRONTEND_UIUX_SKILL_ROOT/scripts/validate-design-contract.mjs" --input design-contract.json');
		expect(skill).toContain("The exact host-selected SKILL.md path anchors every validator/resource lookup");
		expect(skill).not.toContain("/marketplaces/litcodex/plugins/litcodex/skills/frontend-ui-ux");
		expect(skill).not.toMatch(/plugins\/cache\/litcodex\/litcodex\/\d/u);
	});

	it("routes the canonical library lazily while keeping imported scripts inert", () => {
		expect(skill).toContain("references/canonical-library.md");
		const route = readFileSync(new URL("./references/canonical-library.md", import.meta.url), "utf8");
		expect(route).toContain("verify-canonical-corpus.mjs");
		expect(route).toContain("must remain inert");
		expect(route).toContain("do not execute");
		expect(route).toContain("167");
		expect(route).toContain("2,596,349");
	});

	it("keeps optional narrative checks advisory", () => {
		const evidenceReview = readFileSync(new URL("./references/evidence-review.md", import.meta.url), "utf8");
		expect(evidenceReview, "G13_GUIDANCE_PRESENT: evidence-review.md must name the optional narrative check").toMatch(
			/Optional narrative check/u,
		);
		expect(
			evidenceReview,
			"G13_OPTIONAL_ADVISORY_QUESTIONS: evidence-review.md must keep narrative questions advisory",
		).toMatch(/implied narrative or progression[\s\S]*?semantic feel[\s\S]*?not schema fields/u);
		expect(
			evidenceReview,
			"G13_PRESERVES_EXISTING_CONTRACT: visual-qa must own rendered evidence and verdicts",
		).toMatch(/does not assign a rendered verdict[\s\S]*?visual-qa owns rendered evidence and verdicts/u);
	});

	it("routes the authored default direction profile outside the immutable corpus", () => {
		expect(skill).toContain("references/default-editorial-pixel.json");
		const profile = new URL("./references/default-editorial-pixel.json", import.meta.url);
		expect(existsSync(profile)).toBe(true);
		expect(profile.pathname).not.toContain("/_canonical-corpus/");
	});

	it("teaches beta material evidence and the current host-provenance boundary in the lazy contract", () => {
		const detail = readFileSync(new URL("./references/complete-contract.md", import.meta.url), "utf8");
		expect(detail).toContain("litfamily.design-contract/v1beta2");
		expect(detail).toContain("schemas/design-contract.v1beta2.json");
		expect(detail).toContain("schemas/design-contract.v1beta1.json");
		expect(detail).toContain('--input "design-contract.json"');
		expect(detail).toMatch(/material PNG/i);
		expect(detail).toContain("--evidence-root");
		expect(detail).toContain("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
		expect(detail).toMatch(/host-proven/i);
		expect(detail).not.toContain("Create a finite `litfamily.design-contract/v1alpha1`");
	});

	it("stays out of UserPromptSubmit routing", () => {
		for (const prompt of ["$litcodex:frontend-ui-ux design this", "$litcodex:visual-qa inspect this"]) {
			expect(runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt }).kind).toBe("noop");
		}
	});
});

describe("frontend-ui-ux clean-room product contract", () => {
	it("keeps its authored default direction outside the immutable reference corpus", () => {
		const profileUrl = new URL("./references/default-editorial-pixel.json", import.meta.url);
		expect(profileUrl.pathname).not.toContain("/_canonical-corpus/");
		expect(existsSync(profileUrl), "the authored default profile must ship").toBe(true);
		if (!existsSync(profileUrl)) return;

		const profile = JSON.parse(readFileSync(profileUrl, "utf8")) as {
			schema_id: string;
			spacing: { base_px: number; microstep_px: number; desktop_section_gap_px: [number, number]; mobile_section_gap_px: [number, number] };
			typography: {
				display_px: { desktop: [number, number]; mobile: [number, number] };
				latin_leading: [number, number];
				korean_leading: [number, number];
				body_leading: [number, number];
			};
			principles: string[];
		};
		expect(profile.schema_id).toBe("litfamily.frontend-default-profile/v1");
		expect(profile.spacing).toEqual({
			base_px: 8,
			microstep_px: 4,
			desktop_section_gap_px: [80, 128],
			mobile_section_gap_px: [40, 64],
		});
		expect(profile.typography).toEqual({
			display_px: { desktop: [56, 104], mobile: [36, 56] },
			latin_leading: [0.95, 1.05],
			korean_leading: [1.12, 1.25],
			body_leading: [1.5, 1.7],
		});
		expect(profile.principles).toEqual(
			expect.arrayContaining([
				"oversized editorial headings with deliberate line breaks",
				"terminal micro-labels and thin boundaries",
				"original crisp pixel illustrations",
				"asymmetric composition with atmospheric fields",
			]),
		);
	});

	it("requires original crisp pixel illustration as the unspecified-direction visual anchor", () => {
		const profile = JSON.parse(
			readFileSync(new URL("./references/default-editorial-pixel.json", import.meta.url), "utf8"),
		) as {
			pixel_illustration?: {
				default_when_unspecified?: boolean;
				composition_role?: string;
				authorship?: string;
				grid?: {
					minimum_rendered_cell_css_px?: number;
					vector_rendering?: string;
					raster_rendering?: string;
				};
				integration?: string[];
				not_sufficient?: string[];
			};
		};
		expect(profile.pixel_illustration, "the default profile must specify a pixel illustration contract").toMatchObject({
			default_when_unspecified: true,
			composition_role: "primary visual anchor",
			authorship: "original and task-specific",
			grid: {
				minimum_rendered_cell_css_px: 6,
				vector_rendering: "grid-aligned rect cells with crisp edges",
				raster_rendering: "nearest-neighbor scaling without smoothing",
			},
		});
		expect(profile.pixel_illustration?.integration).toEqual(
			expect.arrayContaining([
				"Tie the illustration subject to the requested product or content, not just interface chrome.",
				"Keep the artwork prominent and recognizable at 320px without horizontal overflow.",
			]),
		);
		expect(profile.pixel_illustration?.not_sufficient).toEqual(
			expect.arrayContaining([
				"Smooth orbit or line art as the only featured illustration.",
				"An isolated pixel icon or background grid without an integrated subject illustration.",
			]),
		);

		const interview = readFileSync(new URL("./references/production-interview.md", import.meta.url), "utf8");
		expect(interview).toMatch(/When visual direction is absent, apply the authored default profile[\s\S]*?original crisp pixel illustration[\s\S]*?primary visual anchor/u);
		expect(interview).toMatch(/320px[\s\S]*?390px[\s\S]*?1440px[\s\S]*?visible and recognizable without horizontal overflow/u);
		expect(interview).toMatch(/smooth vector curves as the only featured artwork[\s\S]*?pixel icon\/background grid alone/u);
	});

	it("defines and validates the finite design contract through production code", () => {
		const schema = JSON.parse(readFileSync(new URL("./schemas/design-contract.v1alpha1.json", import.meta.url), "utf8"));
		const serialized = JSON.stringify(schema);
		for (const concept of ["inventory", "routes", "states", "viewports", "accessibility", "accepted_exceptions"]) {
			expect(serialized).toContain(concept);
		}
		expect(validateDesignContract(uiuxDesignContract({ id: "frontend-contract" }))).toMatchObject({
			valid: true,
			issues: [],
		});
		expect(skill).toContain("litfamily.design-contract/v1beta2");
		expect(serialized).toContain("WCAG 2.2 AA");
	});

	it("keeps activation intent-scoped and review/plan-only work read-only", () => {
		const detail = readFileSync(new URL("./references/complete-contract.md", import.meta.url), "utf8");
		expect(skill).toContain("automatic_route: false");
		expect(skill).toMatch(/Do not write because the user only mentioned a keyword[\s\S]*?Review-only and plan-only work is read-only/u);
		expect(detail).toContain("there is no mandatory interview count");
		expect(detail).toContain("A fully populated schema is not a prerequisite");
		expect(detail).toContain("implemented result, rendered preview, and material gap");
	});

	it("keeps validation local, read-only, and network-free", () => {
		const source = readFileSync(new URL("./scripts/validate-design-contract.mjs", import.meta.url), "utf8");
		for (const forbidden of [/node:https?/, /node:net/, /\bfetch\s*\(/, /\bchild_process\b/]) {
			expect(source).not.toMatch(forbidden);
		}
	});

	it("pins every installed frontend resource by its current hash", () => {
		expect(Object.keys(FRONTEND_UIUX_PAYLOAD_HASHES).sort()).toEqual(runtimeFiles(skillRoot));
		for (const [relativePath, expected] of Object.entries(FRONTEND_UIUX_PAYLOAD_HASHES)) {
			const path = `${skillRoot}${relativePath}`;
			expect(existsSync(path), relativePath).toBe(true);
			expect(createHash("sha256").update(readFileSync(path)).digest("hex"), relativePath).toBe(expected);
		}
	});

	it("requires every exact frontend resource in the package manifest", () => {
		const manifest = JSON.parse(readFileSync(`${repoRoot}tools/pack-payload-manifest.json`, "utf8")) as {
			packages: Array<{
				name: string;
				requiredPaths: string[];
				exactFileSets: Array<{ prefix: string; allowedPaths: string[] }>;
				verifiedCorpusCopies?: Array<{ sourceRoot: string; destinationPrefix: string }>;
			}>;
		};
		const installer = manifest.packages.find((entry) => entry.name === "@litfamily/litcodex");
		const packagePrefix = "marketplace/plugins/litcodex/skills/frontend-ui-ux/";
		const frontendFiles = installer?.exactFileSets.find(
			(entry) => entry.prefix === packagePrefix,
		)?.allowedPaths;
		const verifiedCopies = installer?.verifiedCorpusCopies ?? [];
		for (const relativePath of Object.keys(FRONTEND_UIUX_PAYLOAD_HASHES)) {
			const explicitlyAllowed = frontendFiles?.includes(relativePath) ?? false;
			const dynamicallyExpanded = verifiedCopies.some((copy) => {
				if (!copy.destinationPrefix.startsWith(packagePrefix)) return false;
				const copiedRelativePrefix = copy.destinationPrefix.slice(packagePrefix.length);
				return relativePath.startsWith(copiedRelativePrefix);
			});
			expect(explicitlyAllowed || dynamicallyExpanded, relativePath).toBe(true);
		}
		expect(frontendFiles).toContain("references/default-editorial-pixel.json");
		expect(
			frontendFiles,
		).toContain("schemas/design-contract.v1beta2.json");
	});
});
