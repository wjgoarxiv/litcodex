import { join } from "node:path";
import { payloadExact } from "./bundled-skills.js";
import type { ReadonlyFsLike } from "./codex.js";
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
} from "./skill-resource-hashes.js";

/**
 * The Codex-native skill directories shipped in the LitCodex marketplace payload.
 *
 * Keep this catalog explicit: `litcodex doctor` uses it to prove that an installed
 * marketplace has every supported skill entry point, while the companion test
 * compares it with the repository's package contract.
 */
export const CANONICAL_SKILL_IDS = [
	"autoconference",
	"autoresearch",
	"browser-drive",
	"coding-session-audit",
	"comment-checker",
	"debugging",
	"deep-interview",
	"frontend-ui-ux",
	"lit-burnoff",
	"lit-burnoff-file",
	"lit-code",
	"lit-commit",
	"lit-comprehend",
	"lit-crucible",
	"lit-diagram-drawer",
	"lit-docx",
	"lit-fetch",
	"lit-handoff",
	"lit-humanizer",
	"lit-init",
	"lit-loop",
	"lit-plan",
	"lit-pptx",
	"lit-recap",
	"lit-scientific-visualization",
	"lit-team",
	"lit-typographic-motion",
	"litcodex-contribute-bug-fix",
	"litcodex-doctor",
	"litcodex-report-bug",
	"litgoal",
	"litresearch",
	"litwork",
	"lsp",
	"lsp-setup",
	"readme-studio",
	"refactor",
	"review-work",
	"rules",
	"start-work",
	"structural-search",
	"visual-qa",
	"wikify",
] as const;

export const CANONICAL_SKILL_RESOURCE_PATHS = [
	"lsp/references/runtime-triage.md",
	...Object.keys(AUTOCONFERENCE_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `autoconference/${path}`),
	...Object.keys(AUTORESEARCH_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `autoresearch/${path}`),
	...Object.keys(BROWSER_DRIVE_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `browser-drive/${path}`),
	...Object.keys(DEEP_INTERVIEW_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `deep-interview/${path}`),
	...Object.keys(FRONTEND_UIUX_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `frontend-ui-ux/${path}`),
	...Object.keys(HUMANIZER_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `lit-humanizer/${path}`),
	...Object.keys(DIAGRAM_DRAWER_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `lit-diagram-drawer/${path}`),
	...Object.keys(DOCX_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `lit-docx/${path}`),
	...Object.keys(PPTX_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `lit-pptx/${path}`),
	...Object.keys(MOTION_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `lit-typographic-motion/${path}`),
	...Object.keys(README_STUDIO_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `readme-studio/${path}`),
	...Object.keys(VISUAL_QA_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `visual-qa/${path}`),
	...Object.keys(STRUCTURAL_SEARCH_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `structural-search/${path}`),
	...Object.keys(CODING_SESSION_AUDIT_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `coding-session-audit/${path}`),
	...Object.keys(WIKIFY_PAYLOAD_HASHES)
		.filter((path) => path !== "SKILL.md")
		.map((path) => `wikify/${path}`),
] as const;

export interface SkillCatalogPayloadReport {
	readonly complete: boolean;
	readonly missingSkillIds: readonly string[];
	readonly missingResourcePaths: readonly string[];
}

/** Read-only installed-payload probe used by `litcodex doctor`. */
export function probeSkillCatalogPayload(
	fs: Pick<ReadonlyFsLike, "existsSync" | "listFilesRecursive" | "readFileBufferSync">,
	marketplaceRoot: string,
): SkillCatalogPayloadReport {
	const skillsRoot = join(marketplaceRoot, "plugins", "litcodex", "skills");
	const missingSkillIds = CANONICAL_SKILL_IDS.filter(
		(skillId) => !fs.existsSync(join(skillsRoot, skillId, "SKILL.md")),
	);
	const missingResourcePaths = CANONICAL_SKILL_RESOURCE_PATHS.filter(
		(resourcePath) => !fs.existsSync(join(skillsRoot, resourcePath)),
	);
	const exactPayloads = [
		["autoconference", AUTOCONFERENCE_PAYLOAD_HASHES],
		["autoresearch", AUTORESEARCH_PAYLOAD_HASHES],
		["browser-drive", BROWSER_DRIVE_PAYLOAD_HASHES],
		["deep-interview", DEEP_INTERVIEW_PAYLOAD_HASHES],
		["frontend-ui-ux", FRONTEND_UIUX_PAYLOAD_HASHES],
		["lit-humanizer", HUMANIZER_PAYLOAD_HASHES],
		["lit-diagram-drawer", DIAGRAM_DRAWER_PAYLOAD_HASHES],
		["lit-docx", DOCX_PAYLOAD_HASHES],
		["lit-pptx", PPTX_PAYLOAD_HASHES],
		["lit-typographic-motion", MOTION_PAYLOAD_HASHES],
		["readme-studio", README_STUDIO_PAYLOAD_HASHES],
		["visual-qa", VISUAL_QA_PAYLOAD_HASHES],
		["structural-search", STRUCTURAL_SEARCH_PAYLOAD_HASHES],
		["coding-session-audit", CODING_SESSION_AUDIT_PAYLOAD_HASHES],
		["wikify", WIKIFY_PAYLOAD_HASHES],
	] as const;
	const invalidResourcePaths = exactPayloads
		.filter(([skillId, hashes]) => !payloadExact(fs, join(skillsRoot, skillId), hashes))
		.map(([skillId]) => `<${skillId}-payload-integrity>`);
	const unhealthyResourcePaths = [...missingResourcePaths, ...invalidResourcePaths];
	return {
		complete: missingSkillIds.length === 0 && unhealthyResourcePaths.length === 0,
		missingSkillIds,
		missingResourcePaths: unhealthyResourcePaths,
	};
}
