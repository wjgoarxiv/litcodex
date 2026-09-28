import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

export const SKILL_IDS = [
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

export const EXACT_PAYLOADS = {
	autoconference: AUTOCONFERENCE_PAYLOAD_HASHES,
	autoresearch: AUTORESEARCH_PAYLOAD_HASHES,
	"browser-drive": BROWSER_DRIVE_PAYLOAD_HASHES,
	"deep-interview": DEEP_INTERVIEW_PAYLOAD_HASHES,
	"frontend-ui-ux": FRONTEND_UIUX_PAYLOAD_HASHES,
	"lit-humanizer": HUMANIZER_PAYLOAD_HASHES,
	"lit-diagram-drawer": DIAGRAM_DRAWER_PAYLOAD_HASHES,
	"lit-docx": DOCX_PAYLOAD_HASHES,
	"lit-pptx": PPTX_PAYLOAD_HASHES,
	"lit-typographic-motion": MOTION_PAYLOAD_HASHES,
	"readme-studio": README_STUDIO_PAYLOAD_HASHES,
	"visual-qa": VISUAL_QA_PAYLOAD_HASHES,
	"structural-search": STRUCTURAL_SEARCH_PAYLOAD_HASHES,
	"coding-session-audit": CODING_SESSION_AUDIT_PAYLOAD_HASHES,
	wikify: WIKIFY_PAYLOAD_HASHES,
} as const;

export const REQUIRED_SKILL_RESOURCES = [
	"lsp/references/runtime-triage.md",
	...Object.entries(EXACT_PAYLOADS).flatMap(([skillId, hashes]) =>
		Object.keys(hashes)
			.filter((path) => path !== "SKILL.md")
			.map((path) => `${skillId}/${path}`),
	),
];

export function catalogFs(installed: ReadonlySet<string>, marketplaceRoot: string) {
	const skillsRoot = join(marketplaceRoot, "plugins", "litcodex", "skills");
	const sourceRoot = fileURLToPath(new URL("../../../plugins/litcodex/skills/", import.meta.url));
	return {
		existsSync: (path: string) => installed.has(path),
		listFilesRecursive: (root: string) => {
			const skillId = root.slice(root.lastIndexOf("/") + 1) as keyof typeof EXACT_PAYLOADS;
			return skillId in EXACT_PAYLOADS ? Object.keys(EXACT_PAYLOADS[skillId]) : [];
		},
		readFileBufferSync: (path: string) => readFileSync(join(sourceRoot, path.slice(skillsRoot.length + 1))),
	};
}
