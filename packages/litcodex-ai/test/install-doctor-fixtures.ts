import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { desiredAgentRoutes, installedAgentPath } from "../src/install/agent-routing.js";
import { HANDOFF_SOURCE_HASHES } from "../src/install/bundled-skill-manifests.js";
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
	HIJACK_PAYLOAD_HASHES,
	HUMANIZER_PAYLOAD_HASHES,
	MOTION_PAYLOAD_HASHES,
	PPTX_PAYLOAD_HASHES,
	README_STUDIO_PAYLOAD_HASHES,
	SCHEMATIC_PAYLOAD_HASHES,
	STRUCTURAL_SEARCH_PAYLOAD_HASHES,
	VISUAL_QA_PAYLOAD_HASHES,
	WIKIFY_PAYLOAD_HASHES,
} from "../src/install/skill-resource-hashes.js";

export const codexBin = resolve("/usr/local/bin/codex");
export const codexHome = resolve("/tmp/test-codex-home");
export const sentinelPath = join(codexHome, "agents", "litcodex-litwork-reviewer.toml");

const completeAgentTomls = new Map(
	desiredAgentRoutes().map((route) => [
		installedAgentPath(codexHome, route.file),
		`model = "${route.model}"\nmodel_reasoning_effort = "${route.effort}"\n`,
	]),
);

export function doctorDeps(
	fsFiles: string[],
	rootConfig?: string,
	marketplaceSource = join(codexHome, "marketplaces", "litcodex"),
	pluginVersion = "1.0.53",
	codexVersion = "0.144.0",
	handoffAvailable = true,
	// Kept so positional callers keep their argument order; lit-scientific-visualization is a stub now and the
	// doctor checks no vendored source for it.
	_retiredScientificVisualizationSlot = true,
	payloadMutation?: {
		readonly tamper?:
			| "handoff"
			| "uiux-visual-qa"
			| "humanizer"
			| "lit-diagram-drawer"
			| "lit-schematic"
			| "lit-hijack";
		readonly extra?: "handoff" | "uiux-visual-qa";
		readonly missing?: "lit-diagram-drawer" | "lit-schematic" | "lit-hijack" | "card-server";
	},
): Parameters<typeof runDoctor>[0] {
	const configPath = join(codexHome, "config.toml");
	const marketplaceManifest = join(codexHome, "marketplaces", "litcodex", ".agents", "plugins", "marketplace.json");
	const pluginManifest = join(
		codexHome,
		"marketplaces",
		"litcodex",
		"plugins",
		"litcodex",
		".codex-plugin",
		"plugin.json",
	);
	const hooksManifest = join(codexHome, "marketplaces", "litcodex", "plugins", "litcodex", "hooks", "hooks.json");
	const pluginRoot = join(codexHome, "marketplaces", "litcodex", "plugins", "litcodex");
	const cardServer = join(pluginRoot, "components", "lit-loop", "dist", "card-server.js");
	const skillsRoot = join(pluginRoot, "skills");
	const vendorRoot = join(pluginRoot, "vendor");
	const handoffRoot = join(skillsRoot, "lit-handoff");
	const handoffOriginalRoot = join(vendorRoot, "handoff");
	const handoffFiles = [
		join(handoffRoot, "SKILL.md"),
		join(vendorRoot, "NOTICE"),
		join(vendorRoot, "licenses", "022_handoff-MIT.txt"),
		join(vendorRoot, "provenance", "022_handoff.md"),
		join(handoffOriginalRoot, "SKILL.md"),
		join(handoffOriginalRoot, "evals", "evals.json"),
		join(handoffOriginalRoot, "examples", "HANDOFF-example-generic-auth-refactor.md"),
		join(handoffOriginalRoot, "templates", "HANDOFF.md"),
	];
	const skillCatalogRoot = join(codexHome, "marketplaces", "litcodex", "plugins", "litcodex", "skills");
	const frontendUiuxRoot = join(skillCatalogRoot, "frontend-ui-ux");
	const humanizerRoot = join(skillCatalogRoot, "lit-humanizer");
	const diagramDrawerRoot = join(skillCatalogRoot, "lit-diagram-drawer");
	const autoconferenceRoot = join(skillCatalogRoot, "autoconference");
	const autoresearchRoot = join(skillCatalogRoot, "autoresearch");
	const browserDriveRoot = join(skillCatalogRoot, "browser-drive");
	const deepInterviewRoot = join(skillCatalogRoot, "deep-interview");
	const docxRoot = join(skillCatalogRoot, "lit-docx");
	const pptxRoot = join(skillCatalogRoot, "lit-pptx");
	const schematicRoot = join(skillCatalogRoot, "lit-schematic");
	const hijackRoot = join(skillCatalogRoot, "lit-hijack");
	const motionRoot = join(skillCatalogRoot, "lit-typographic-motion");
	const readmeStudioRoot = join(skillCatalogRoot, "readme-studio");
	const visualQaRoot = join(skillCatalogRoot, "visual-qa");
	const structuralSearchRoot = join(skillCatalogRoot, "structural-search");
	const codingSessionAuditRoot = join(skillCatalogRoot, "coding-session-audit");
	const wikifyRoot = join(skillCatalogRoot, "wikify");
	const skillCatalogFiles = [
		...CANONICAL_SKILL_IDS.map((skillId) => join(skillCatalogRoot, skillId, "SKILL.md")),
		...CANONICAL_SKILL_RESOURCE_PATHS.map((resourcePath) => join(skillCatalogRoot, resourcePath)),
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
				(skillCatalogFiles.includes(path) &&
					!(payloadMutation?.missing === "lit-diagram-drawer" && path === join(diagramDrawerRoot, "SKILL.md")) &&
					!(payloadMutation?.missing === "lit-schematic" && path === join(schematicRoot, "SKILL.md")) &&
					!(payloadMutation?.missing === "lit-hijack" && path === join(hijackRoot, "SKILL.md"))) ||
				path === marketplaceManifest ||
				path === pluginManifest ||
				path === hooksManifest ||
				(path === cardServer && payloadMutation?.missing !== "card-server") ||
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
				if (root === frontendUiuxRoot) {
					const paths = Object.keys(FRONTEND_UIUX_PAYLOAD_HASHES);
					return payloadMutation?.extra === "uiux-visual-qa" ? [...paths, "scripts/rogue.mjs"] : paths;
				}
				if (root === humanizerRoot) return Object.keys(HUMANIZER_PAYLOAD_HASHES);
				if (root === diagramDrawerRoot) return Object.keys(DIAGRAM_DRAWER_PAYLOAD_HASHES);
				if (root === docxRoot) return Object.keys(DOCX_PAYLOAD_HASHES);
				if (root === pptxRoot) return Object.keys(PPTX_PAYLOAD_HASHES);
				if (root === schematicRoot) return Object.keys(SCHEMATIC_PAYLOAD_HASHES);
				if (root === hijackRoot) return Object.keys(HIJACK_PAYLOAD_HASHES);
				if (root === motionRoot) return Object.keys(MOTION_PAYLOAD_HASHES);
				if (root === visualQaRoot) return Object.keys(VISUAL_QA_PAYLOAD_HASHES);
				if (root === structuralSearchRoot) return Object.keys(STRUCTURAL_SEARCH_PAYLOAD_HASHES);
				if (root === codingSessionAuditRoot) return Object.keys(CODING_SESSION_AUDIT_PAYLOAD_HASHES);
				if (root === wikifyRoot) return Object.keys(WIKIFY_PAYLOAD_HASHES);
				return [];
			},
			readFileBufferSync: (path) => {
				if (path.startsWith(skillCatalogRoot + sep)) {
					const relativePath = path.slice(skillCatalogRoot.length + 1);
					if (
						payloadMutation?.tamper === "uiux-visual-qa" &&
						relativePath === join("frontend-ui-ux", "SKILL.md")
					) {
						return Buffer.from("tampered");
					}
					if (payloadMutation?.tamper === "humanizer" && relativePath === join("lit-humanizer", "SKILL.md")) {
						return Buffer.from("tampered");
					}
					if (
						payloadMutation?.tamper === "lit-diagram-drawer" &&
						relativePath === join("lit-diagram-drawer", "SKILL.md")
					) {
						return Buffer.from("tampered");
					}
					if (payloadMutation?.tamper === "lit-schematic" && relativePath === join("lit-schematic", "SKILL.md")) {
						return Buffer.from("tampered");
					}
					if (payloadMutation?.tamper === "lit-hijack" && relativePath === join("lit-hijack", "SKILL.md")) {
						return Buffer.from("tampered");
					}
					return readFileSync(join(REPO_ROOT, "plugins/litcodex/skills", relativePath));
				}
				if (path.startsWith(handoffOriginalRoot + sep)) {
					const relativePath = path.slice(handoffOriginalRoot.length + 1);
					if (payloadMutation?.tamper === "handoff" && relativePath === "SKILL.md") {
						return Buffer.from("tampered");
					}
					return readFileSync(join(REPO_ROOT, "plugins/litcodex/vendor/handoff", relativePath));
				}
				throw new Error(`unexpected binary read: ${path}`);
			},
		},
		env: { CODEX_BIN: codexBin, CODEX_HOME: codexHome },
		repoRoot: REPO_ROOT,
		verifyHook: () => undefined,
	};
}
