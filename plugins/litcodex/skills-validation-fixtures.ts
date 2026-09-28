import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILLS_DIR = fileURLToPath(new URL("./skills/", import.meta.url));
export const PLUGIN_JSON = fileURLToPath(new URL("./.codex-plugin/plugin.json", import.meta.url));
export const PACKAGE_README = fileURLToPath(new URL("../../packages/litcodex-ai/README.md", import.meta.url));
export const REPO_README = fileURLToPath(new URL("../../README.md", import.meta.url));
export const TEST_SURFACE = [
	fileURLToPath(new URL("./skills-validation.test.ts", import.meta.url)),
	fileURLToPath(new URL("./skills-activation-policy.test.ts", import.meta.url)),
	fileURLToPath(new URL("./orchestration-contract.test.ts", import.meta.url)),
];
export const KOREAN_PROSE_SKILL = "lit-humanizer";
export const LIT_CRUCIBLE_SKILL = "lit-crucible";
export const LSP_SKILL = "lsp";
export const LSP_SETUP_SKILL = "lsp-setup";
export const COMMENT_CHECKER_SKILL = "comment-checker";
export const KOREAN_PROSE_REQUIRED_REFERENCES = [
	"references/ko-patterns.md",
	"references/rewrite-playbook.md",
	"references/prompt-injection-handling.md",
] as const;
export const TOP_LEVEL_SKILL_WORD_FLOOR = 42_789;
export const DESCRIPTION_BYTE_CEILING = 180;
export const skillNames = existsSync(SKILLS_DIR)
	? readdirSync(SKILLS_DIR).filter((name) => existsSync(`${SKILLS_DIR}${name}/SKILL.md`))
	: [];
export const EXPLICIT_ONLY_CANDIDATES = new Set([
	"browser-drive",
	"deep-interview",
	"lit-diagram-drawer",
	"lit-crucible",
	"lit-init",
	"lit-comprehend",
	"lit-handoff",
	"lit-plan",
	"lit-recap",
	"lit-scientific-visualization",
	"litgoal",
	"review-work",
]);
export const PINNED_IMPLICIT = new Set(["lit-loop", "litwork", "litresearch", "start-work", "wikify"]);
export const CATALOG_TRIGGER_LEXEMES: Readonly<Record<string, readonly string[]>> = {
	autoconference: ["collaborative", "research"],
	autoresearch: ["research"],
	"browser-drive": ["browser", "page"],
	"coding-session-audit": ["codex", "session"],
	"comment-checker": ["comment-checker", "hook"],
	debugging: ["runtime", "debug"],
	"deep-interview": ["socratic", "request"],
	"frontend-ui-ux": ["interface", "design"],
	"lit-diagram-drawer": ["diagram", "architecture"],
	"lit-docx": ["report", "document"],
	"lit-commit": ["git", "commit"],
	"lit-crucible": ["planning", "lit-plan"],
	"lit-init": ["agents.md"],
	"lit-humanizer": ["humanize", "prose"],
	"lit-comprehend": ["explainer", "understanding"],
	"lit-handoff": ["handoff.md", "resumable"],
	"lit-loop": ["evidence", "checkpointed"],
	"lit-plan": ["planning", "plan"],
	"lit-pptx": ["slides", "presentation"],
	"lit-typographic-motion": ["film", "typography"],
	"lit-recap": ["recap", "status"],
	"lit-scientific-visualization": ["scientific", "figures"],
	"litcodex-contribute-bug-fix": ["bug-fix", "pr"],
	"litcodex-doctor": ["diagnose", "install"],
	"litcodex-report-bug": ["bug", "issue"],
	litgoal: ["goal", "success criteria"],
	litresearch: ["research", "litresearch"],
	litwork: ["implementation", "evidence"],
	lsp: ["lsp", "hook"],
	"lsp-setup": ["language-server", "diagnostics"],
	"lit-code": ["typescript", "tdd"],
	"lit-fetch": ["public", "page"],
	refactor: ["restructure", "behavior"],
	"lit-burnoff": ["ai", "code"],
	"lit-burnoff-file": ["ai", "file"],
	"review-work": ["review", "implementation"],
	"readme-studio": ["readme", "cover"],
	rules: ["rules", "injected"],
	"start-work": ["approved", "plan"],
	"structural-search": ["syntax", "search"],
	"lit-team": ["team", "codex"],
	"visual-qa": ["visual", "evidence"],
	wikify: ["markdown", "wiki"],
};

const SUBSTRING = [
	["ultra", "work"].join(""),
	["spark", "shell"].join(""),
	["sisyphus", "labs"].join(""),
	["lazy", "codex"].join(""),
	["oh-my-", "openagent"].join(""),
	["open", "code"].join(""),
];
const BOUNDED = [["o", "m", "o"].join(""), ["u", "l", "w"].join("")];

export function legacyHits(text: string): string[] {
	const lower = text.toLowerCase();
	const hits: string[] = [];
	for (const token of SUBSTRING) if (lower.includes(token)) hits.push(token);
	for (const token of BOUNDED) {
		if (new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(lower)) hits.push(token);
	}
	return hits;
}

export function referencedResources(markdown: string): string[] {
	return [...markdown.matchAll(/`(references\/[^`]+)`/g)]
		.map((match) => match[1] as string)
		.filter((relativePath) => !relativePath.includes("<") && !relativePath.includes("*"));
}

export function relativeMarkdownHrefs(markdown: string): string[] {
	return [...markdown.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)/g)]
		.map((match) => match[1] ?? match[2] ?? "")
		.filter(
			(href) => href !== "" && !href.startsWith("#") && !href.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(href),
		)
		.map((href) => decodeURIComponent(href.split(/[?#]/, 1)[0]))
		.filter(Boolean);
}

export function skillMarkdown(name: string): string {
	const path = `${SKILLS_DIR}${name}/SKILL.md`;
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function skillDescription(markdown: string): string {
	const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? "";
	const lines = frontmatter.split("\n");
	const index = lines.findIndex((line) => line.startsWith("description:"));
	if (index < 0) return "";
	const first = lines[index]?.slice("description:".length).trim() ?? "";
	if (first !== ">-" && first !== "|") return first.replace(/^"|"$/gu, "");
	return lines
		.slice(index + 1)
		.filter((line) => /^\s+/u.test(line))
		.map((line) => line.trim())
		.join(" ");
}

function whitespaceWordCount(text: string): number {
	const trimmed = text.trim();
	return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export function topLevelSkillWordCounts(): Array<[string, number]> {
	return skillNames.map((name) => [name, whitespaceWordCount(skillMarkdown(name))]);
}

export function filesUnder(root: string, predicate: (relativePath: string) => boolean): string[] {
	const paths: string[] = [];
	const stack = [""];
	while (stack.length > 0) {
		const relativeDir = stack.pop() ?? "";
		for (const entry of readdirSync(`${root}${relativeDir}`)) {
			const relativePath = relativeDir.length === 0 ? entry : `${relativeDir}${entry}`;
			const absolutePath = `${root}${relativePath}`;
			if (statSync(absolutePath).isDirectory()) stack.push(`${relativePath}/`);
			else if (predicate(relativePath)) paths.push(absolutePath);
		}
	}
	return paths.sort();
}

export function skillFrontmatterNames(): string[] {
	return skillNames
		.map((name) => readFileSync(`${SKILLS_DIR}${name}/SKILL.md`, "utf8").match(/^name:\s*(\S+)\s*$/m)?.[1])
		.filter((name): name is string => name !== undefined);
}

export function resolveSkillLink(skillPath: string, href: string): string {
	return resolve(dirname(skillPath), href);
}
