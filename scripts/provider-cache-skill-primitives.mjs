import { createHash } from "node:crypto";

export const PROMPTS = Object.freeze({
	"deep-interview": "deep-interview clarify this request",
	"lit-crucible": "lit-crucible this release",
	"lit-init": "lit-init --max-depth=2",
	"lit-comprehend": "lit-comprehend",
	"lit-plan": "lit plan this",
	"lit-recap": "lit-recap --brief",
	"lit-scientific-visualization": "lit-scientific-visualization",
	litgoal: "litgoal bind release readiness",
	"review-work": "review-work this diff",
});

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const countExact = (text, needle) => text.split(needle).length - 1;
export const normalized = (text) => text.replace(/\r\n?/gu, "\n").trim();

export class SkillProbeError extends Error {
	constructor(code, diagnostic) {
		super(code);
		this.name = "SkillProbeError";
		this.code = code;
		this.diagnostic = diagnostic;
	}
}

export function bodyAfterFrontmatter(markdown) {
	const delimiter = markdown.indexOf("\n---\n", 4);
	if (!markdown.startsWith("---\n") || delimiter < 0) throw new Error("SKILL_FRONTMATTER_INVALID");
	return markdown.slice(delimiter + 5);
}
