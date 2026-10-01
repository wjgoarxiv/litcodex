import { readFileSync } from "node:fs";
import { join } from "node:path";

import { desiredAgentRoutes, installedAgentPath } from "../src/install/agent-routing.js";
import {
	HANDOFF_SOURCE_HASHES,
	SCIENTIFIC_VISUALIZATION_SOURCE_HASHES,
} from "../src/install/bundled-skill-manifests.js";
import type { runDoctor } from "../src/install/doctor.js";
import { REPO_ROOT } from "../src/install/install-test-helpers.js";
import { CANONICAL_SKILL_IDS, CANONICAL_SKILL_RESOURCE_PATHS } from "../src/install/skill-catalog.js";
import {
	AUTOCONFERENCE_PAYLOAD_HASHES,
	AUTORESEARCH_PAYLOAD_HASHES,
	BROWSER_DRIVE_PAYLOAD_HASHES,
	CODING_SESSION_AUDIT_PAYLOAD_HASHES,
	DEEP_INTERVIEW_PAYLOAD_HASHES,
	DIAGRAM_DRAWER_PAYLOAD_HASHES,
	DOCX_PAYLOAD_HASHES,
	FRONTEND_UIUX_PAYLOAD_HASHES,
	HUMANIZER_PAYLOAD_HASHES,
	MOTION_PAYLOAD_HASHES,
	PPTX_PAYLOAD_HASHES,
	README_STUDIO_PAYLOAD_HASHES,
	STRUCTURAL_SEARCH_PAYLOAD_HASHES,
	VISUAL_QA_PAYLOAD_HASHES,
	WIKIFY_PAYLOAD_HASHES,
} from "../src/install/skill-resource-hashes.js";

export const codexBin = "/usr/local/bin/codex";
export const codexHome = "/tmp/test-codex-home";
export const sentinelPath = `${codexHome}/agents/litcodex-litwork-reviewer.toml`;

const completeAgentTomls = new Map(
	desiredAgentRoutes().map((route) => [
		installedAgentPath(codexHome, route.file),
		`model = "${route.model}"\nmodel_reasoning_effort = "${route.effort}"\n`,
	]),
);

export function doctorDeps(
	fsFiles: string[],
	rootConfig?: string,
	marketplaceSource = `${codexHome}/marketplaces/litcodex`,
	pluginVersion = "1.0.14",
	codexVersion = "0.144.0",
	handoffAvailable = true,
	scientificVisualizationAvailable = true,
	payloadMutation?: {
		readonly tamper?: "handoff" | "scientific-visualization" | "uiux-visual-qa" | "humanizer" | "lit-diagram-drawer";
		readonly extra?: "handoff" | "scientific-visualization" | "uiux-visual-qa";
		readonly missing?: "lit-diagram-drawer";
	},
): Parameters<typeof runDoctor>[0] {
	const configPath = `${codexHome}/config.toml`;
	const marketplaceManifest = `${codexHome}/marketplaces/litcodex/.agents/plugins/marketplace.json`;
	const pluginManifest = `${codexHome}/marketplaces/litcodex/plugins/litcodex/.codex-plugin/plugin.json`;
	const hooksManifest = `${codexHome}/marketplaces/litcodex/plugins/litcodex/hooks/hooks.json`;
	const pluginRoot = `${codexHome}/marketplaces/litcodex/plugins/litcodex`;
	const skillsRoot = `${pluginRoot}/skills`;
	const vendorRoot = `${pluginRoot}/vendor`;
	const handoffRoot = `${skillsRoot}/lit-handoff`;
	const handoffOriginalRoot = `${vendorRoot}/handoff`;
	const handoffFiles = [
		`${handoffRoot}/SKILL.md`,
		`${vendorRoot}/NOTICE`,
		`${vendorRoot}/licenses/022_handoff-MIT.txt`,
		`${vendorRoot}/licenses/045_scientific-visualization-MIT.txt`,
		`${vendorRoot}/provenance/022_handoff.md`,
		`${vendorRoot}/provenance/045_scientific-visualization.md`,
		`${handoffOriginalRoot}/SKILL.md`,
		`${handoffOriginalRoot}/evals/evals.json`,
		`${handoffOriginalRoot}/examples/HANDOFF-example-generic-auth-refactor.md`,
		`${handoffOriginalRoot}/templates/HANDOFF.md`,
	];
	const scientificVisualizationRoot = `${skillsRoot}/lit-scientific-visualization`;
	const scientificVisualizationOriginalRoot = `${vendorRoot}/scientific-visualization`;
	const scientificVisualizationFiles = [
		`${scientificVisualizationRoot}/SKILL.md`,
		`${scientificVisualizationRoot}/scripts/dependency-preflight.py`,
		`${vendorRoot}/NOTICE`,
		`${vendorRoot}/licenses/022_handoff-MIT.txt`,
		`${vendorRoot}/licenses/045_scientific-visualization-MIT.txt`,
		`${vendorRoot}/provenance/022_handoff.md`,
		`${vendorRoot}/provenance/045_scientific-visualization.md`,
		`${scientificVisualizationOriginalRoot}/SKILL.md`,
		`${scientificVisualizationOriginalRoot}/scripts/style_presets.py`,
		`${scientificVisualizationOriginalRoot}/scripts/figure_export.py`,
		`${scientificVisualizationOriginalRoot}/assets/color_palettes.py`,
		`${scientificVisualizationOriginalRoot}/assets/nature.mplstyle`,
		`${scientificVisualizationOriginalRoot}/assets/presentation.mplstyle`,
		`${scientificVisualizationOriginalRoot}/assets/publication.mplstyle`,
		`${scientificVisualizationOriginalRoot}/evals/evals.json`,
		`${scientificVisualizationOriginalRoot}/references/color_palettes.md`,
		`${scientificVisualizationOriginalRoot}/references/journal_requirements.md`,
		`${scientificVisualizationOriginalRoot}/references/matplotlib_examples.md`,
		`${scientificVisualizationOriginalRoot}/references/mdanalysis_martini_visualization.md`,
		`${scientificVisualizationOriginalRoot}/references/publication_guidelines.md`,
		`${scientificVisualizationOriginalRoot}/references/seaborn_for_publications.md`,
		`${scientificVisualizationOriginalRoot}/tests/test_figure_export.py`,
		`${scientificVisualizationOriginalRoot}/tests/test_style_presets.py`,
	];
	const skillCatalogRoot = `${codexHome}/marketplaces/litcodex/plugins/litcodex/skills`;
	const frontendUiuxRoot = `${skillCatalogRoot}/frontend-ui-ux`;
	const humanizerRoot = `${skillCatalogRoot}/lit-humanizer`;
	const diagramDrawerRoot = `${skillCatalogRoot}/lit-diagram-drawer`;
	const autoconferenceRoot = `${skillCatalogRoot}/autoconference`;
	const autoresearchRoot = `${skillCatalogRoot}/autoresearch`;
	const browserDriveRoot = `${skillCatalogRoot}/browser-drive`;
	const deepInterviewRoot = `${skillCatalogRoot}/deep-interview`;
	const docxRoot = `${skillCatalogRoot}/lit-docx`;
	const pptxRoot = `${skillCatalogRoot}/lit-pptx`;
	const motionRoot = `${skillCatalogRoot}/lit-typographic-motion`;
	const readmeStudioRoot = `${skillCatalogRoot}/readme-studio`;
	const visualQaRoot = `${skillCatalogRoot}/visual-qa`;
	const structuralSearchRoot = `${skillCatalogRoot}/structural-search`;
	const codingSessionAuditRoot = `${skillCatalogRoot}/coding-session-audit`;
	const wikifyRoot = `${skillCatalogRoot}/wikify`;
	const skillCatalogFiles = [
		...CANONICAL_SKILL_IDS.map((skillId) => `${skillCatalogRoot}/${skillId}/SKILL.md`),
		...CANONICAL_SKILL_RESOURCE_PATHS.map((resourcePath) => `${skillCatalogRoot}/${resourcePath}`),
	];
	return {
		spawn: (_cmd, args) => {
			const sub = args.join(" ");
			if (sub === "--version") return { status: 0, stdout: `codex-cli ${codexVersion}\n` };
			if (sub === "debug models --bundled") {
				return {
					status: 0,
					stdout: JSON.stringify({
						models: [
							{ slug: "gpt-5.6", context_window: 372_000 },
							{ slug: "gpt-5.6-terra", context_window: 372_000 },
							{ slug: "gpt-5.6-luna", context_window: 372_000 },
						],
					}),
				};
			}
			if (sub === "plugin marketplace list --json") {
				return {
					status: 0,
					stdout: JSON.stringify([{ name: "litcodex", sourceType: "path", source: marketplaceSource }]),
				};
			}
			if (sub === "plugin marketplace list") return { status: 0, stdout: "litcodex\n" };
			if (sub === "plugin list") return { status: 0, stdout: "litcodex@litcodex  installed, enabled  0.3.8\n" };
			return { status: 0, stdout: JSON.stringify({ checks: { "config.load": { status: "ok" } } }) };
		},
		fs: {
			existsSync: (path) =>
				fsFiles.includes(path) ||
				(fsFiles.includes(sentinelPath) && completeAgentTomls.has(path)) ||
				(handoffAvailable && handoffFiles.includes(path)) ||
				(scientificVisualizationAvailable && scientificVisualizationFiles.includes(path)) ||
				(skillCatalogFiles.includes(path) &&
					!(payloadMutation?.missing === "lit-diagram-drawer" && path === `${diagramDrawerRoot}/SKILL.md`)) ||
				path === marketplaceManifest ||
				path === pluginManifest ||
				path === hooksManifest ||
				(rootConfig !== undefined && path === configPath),
			readFileSync: (path) =>
				completeAgentTomls.has(path)
					? (completeAgentTomls.get(path) ?? "")
					: path === configPath
						? (rootConfig ?? "")
						: path === pluginManifest
							? JSON.stringify({ name: "litcodex", version: pluginVersion })
							: path === marketplaceManifest
								? '{"name":"litcodex","plugins":[{"name":"litcodex"}]}'
								: path === hooksManifest
									? '{"hooks":{"UserPromptSubmit":[]}}'
									: "",
			listFilesRecursive: (root) => {
				if (root === autoconferenceRoot) return Object.keys(AUTOCONFERENCE_PAYLOAD_HASHES);
				if (root === autoresearchRoot) return Object.keys(AUTORESEARCH_PAYLOAD_HASHES);
				if (root === browserDriveRoot) return Object.keys(BROWSER_DRIVE_PAYLOAD_HASHES);
				if (root === deepInterviewRoot) return Object.keys(DEEP_INTERVIEW_PAYLOAD_HASHES);
				if (root === readmeStudioRoot) return Object.keys(README_STUDIO_PAYLOAD_HASHES);
				if (root === handoffOriginalRoot && handoffAvailable) {
					const paths = Object.keys(HANDOFF_SOURCE_HASHES);
					return payloadMutation?.extra === "handoff" ? [...paths, "__pycache__/rogue.pyc"] : paths;
				}
				if (root === scientificVisualizationOriginalRoot && scientificVisualizationAvailable) {
					const paths = Object.keys(SCIENTIFIC_VISUALIZATION_SOURCE_HASHES);
					return payloadMutation?.extra === "scientific-visualization"
						? [...paths, "__pycache__/rogue.pyc"]
						: paths;
				}
				if (root === frontendUiuxRoot) {
					const paths = Object.keys(FRONTEND_UIUX_PAYLOAD_HASHES);
					return payloadMutation?.extra === "uiux-visual-qa" ? [...paths, "scripts/rogue.mjs"] : paths;
				}
				if (root === humanizerRoot) return Object.keys(HUMANIZER_PAYLOAD_HASHES);
				if (root === diagramDrawerRoot) return Object.keys(DIAGRAM_DRAWER_PAYLOAD_HASHES);
				if (root === docxRoot) return Object.keys(DOCX_PAYLOAD_HASHES);
				if (root === pptxRoot) return Object.keys(PPTX_PAYLOAD_HASHES);
				if (root === motionRoot) return Object.keys(MOTION_PAYLOAD_HASHES);
				if (root === visualQaRoot) return Object.keys(VISUAL_QA_PAYLOAD_HASHES);
				if (root === structuralSearchRoot) return Object.keys(STRUCTURAL_SEARCH_PAYLOAD_HASHES);
				if (root === codingSessionAuditRoot) return Object.keys(CODING_SESSION_AUDIT_PAYLOAD_HASHES);
				if (root === wikifyRoot) return Object.keys(WIKIFY_PAYLOAD_HASHES);
				return [];
			},
			readFileBufferSync: (path) => {
				if (
					path.startsWith(`${skillCatalogRoot}/autoconference/`) ||
					path.startsWith(`${skillCatalogRoot}/autoresearch/`) ||
					path.startsWith(`${skillCatalogRoot}/browser-drive/`) ||
					path.startsWith(`${skillCatalogRoot}/deep-interview/`) ||
					path.startsWith(`${skillCatalogRoot}/frontend-ui-ux/`) ||
					path.startsWith(`${skillCatalogRoot}/lit-humanizer/`) ||
					path.startsWith(`${skillCatalogRoot}/lit-diagram-drawer/`) ||
					path.startsWith(`${skillCatalogRoot}/lit-docx/`) ||
					path.startsWith(`${skillCatalogRoot}/lit-pptx/`) ||
					path.startsWith(`${skillCatalogRoot}/lit-typographic-motion/`) ||
					path.startsWith(`${skillCatalogRoot}/readme-studio/`) ||
					path.startsWith(`${skillCatalogRoot}/visual-qa/`) ||
					path.startsWith(`${skillCatalogRoot}/structural-search/`) ||
					path.startsWith(`${skillCatalogRoot}/coding-session-audit/`) ||
					path.startsWith(`${skillCatalogRoot}/wikify/`)
				) {
					const relativePath = path.slice(skillCatalogRoot.length + 1);
					if (
						payloadMutation?.tamper === "uiux-visual-qa" &&
						relativePath === "frontend-ui-ux/scripts/validate-design-contract.mjs"
					) {
						return Buffer.from("tampered");
					}
					if (payloadMutation?.tamper === "humanizer" && relativePath === "lit-humanizer/SKILL.md") {
						return Buffer.from("tampered");
					}
					if (payloadMutation?.tamper === "lit-diagram-drawer" && relativePath === "lit-diagram-drawer/SKILL.md") {
						return Buffer.from("tampered");
					}
					return readFileSync(join(REPO_ROOT, "plugins/litcodex/skills", relativePath));
				}
				if (path.startsWith(`${handoffOriginalRoot}/`)) {
					const relativePath = path.slice(handoffOriginalRoot.length + 1);
					if (payloadMutation?.tamper === "handoff" && relativePath === "SKILL.md") {
						return Buffer.from("tampered");
					}
					return readFileSync(join(REPO_ROOT, "plugins/litcodex/vendor/handoff", relativePath));
				}
				if (path.startsWith(`${scientificVisualizationOriginalRoot}/`)) {
					const relativePath = path.slice(scientificVisualizationOriginalRoot.length + 1);
					if (payloadMutation?.tamper === "scientific-visualization" && relativePath === "SKILL.md") {
						return Buffer.from("tampered");
					}
					return readFileSync(join(REPO_ROOT, "plugins/litcodex/vendor/scientific-visualization", relativePath));
				}
				throw new Error(`unexpected binary read: ${path}`);
			},
		},
		env: { CODEX_BIN: codexBin, CODEX_HOME: codexHome },
		repoRoot: REPO_ROOT,
		verifyHook: () => undefined,
	};
}
