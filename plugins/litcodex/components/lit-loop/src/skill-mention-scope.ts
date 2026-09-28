import { renamedSkillId } from "./skill-renames.js";
import type { LitTriggerToken } from "./trigger.js";

const LITCODEX_PLUGIN_NAME = "litcodex";
const CODEX_SKILL_MENTION_PATTERN = /\$([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)/gu;

export function isCodexSkillMentionToken(prompt: string, tokenIndex: number): boolean {
	let start = tokenIndex;
	while (start > 0 && !/\s/u.test(prompt[start - 1] ?? "")) {
		start -= 1;
	}
	let end = tokenIndex;
	while (end < prompt.length && !/\s/u.test(prompt[end] ?? "")) {
		end += 1;
	}
	const mention = prompt.slice(start, end);
	return mention.startsWith("$") && mention.includes(":") && tokenIndex > start;
}

export function scopedTokenForBareLit(prompt: string, tokenIndex: number): LitTriggerToken | null {
	const skillName = nearestLitcodexSkillNameBefore(prompt, tokenIndex);
	if (skillName === null || suppressesBareLitAfterCodexSkillMention(prompt, tokenIndex)) {
		return null;
	}
	return tokenForSkillName(skillName);
}

export function suppressesBareLitAfterCodexSkillMention(prompt: string, tokenIndex: number): boolean {
	return nearestLitcodexSkillNameBefore(prompt, tokenIndex) === "start-work";
}

function nearestLitcodexSkillNameBefore(prompt: string, tokenIndex: number): string | null {
	let scopedSkillName: string | null = null;
	for (const match of prompt.slice(0, tokenIndex).matchAll(CODEX_SKILL_MENTION_PATTERN)) {
		const pluginName = match[1]?.toLowerCase();
		const skillName = match[2]?.toLowerCase();
		if (pluginName !== LITCODEX_PLUGIN_NAME || skillName === undefined) {
			continue;
		}
		if (tokenForSkillName(skillName) !== null) {
			scopedSkillName = skillName;
		}
	}
	return scopedSkillName;
}

function tokenForSkillName(skillName: string): LitTriggerToken | null {
	switch (renamedSkillId(skillName) ?? skillName) {
		case "lit-loop":
			return "lit-loop";
		case "lit-plan":
			return "lit-plan";
		case "litwork":
			return "litwork";
		case "litgoal":
			return "litgoal";
		case "litresearch":
			return "litresearch";
		case "lit-recap":
			return "lit-recap";
		case "lit-comprehend":
			return "lit-comprehend";
		case "lit-crucible":
			return "lit-crucible";
		case "lit-init":
			return "lit-init";
		case "deep-interview":
			return "deep-interview";
		case "start-work":
			return "start-work";
		case "review-work":
			return "review-work";
		default:
			return null;
	}
}
