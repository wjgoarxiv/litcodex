/** Compatibility aliases for one release; remove in the next minor release. */
export const SKILL_RENAMES = {
	hyperplan: "lit-crucible",
	"init-deep": "lit-init",
	"git-master": "lit-commit",
	teammode: "lit-team",
	"remove-ai-slops": "lit-burnoff",
	"ai-slop-remover": "lit-burnoff-file",
	"lit-korean": "lit-humanizer",
	"text-naturalization": "lit-humanizer",
	"korean-ai-slop-remover": "lit-humanizer",
	"public-page-reader": "lit-fetch",
	programming: "lit-code",
} as const;

export type RenamedSkillId = (typeof SKILL_RENAMES)[keyof typeof SKILL_RENAMES];

export function renamedSkillId(word: string): RenamedSkillId | undefined {
	return Object.entries(SKILL_RENAMES).find(([oldId]) => oldId === word.toLowerCase())?.[1];
}

export function skillRenameNote(raw: string): string {
	const oldId = raw.toLowerCase().replace(/^(?:\/|lit\s+|\$litcodex:)/u, "");
	const newId = renamedSkillId(oldId);
	return newId === undefined
		? ""
		: `Note: \`${oldId}\` was renamed to \`${newId}\`; the old name is removed in the next minor.`;
}

/** Match explicit invocations in code-masked text without overtaking an earlier bounded route. */
export function matchRenamedSkillInvocation(
	prompt: string,
	firstBoundedIndex: number,
): { readonly skillId: RenamedSkillId; readonly note: string } | null {
	const word = /^\s*(\/?[a-z-]+|\$litcodex:[a-z-]+)(?=\s|$)/iu.exec(prompt)?.[1]?.toLowerCase();
	const normalizedWord = word?.replace(/^\//u, "");
	for (const [oldId, newId] of Object.entries(SKILL_RENAMES)) {
		if (word?.startsWith("/") && newId !== "lit-humanizer") continue;
		if (normalizedWord === oldId || word === `$litcodex:${oldId}`)
			return { skillId: newId, note: skillRenameNote(oldId) };
		if (normalizedWord === newId) return { skillId: newId, note: "" };
	}
	for (const match of prompt.matchAll(/(?<![\p{L}\p{N}_$/:])\$litcodex:([a-z-]+)(?![\p{L}\p{N}_-])/giu)) {
		if (match.index >= firstBoundedIndex) break;
		const oldId = match[1];
		if (oldId === undefined) continue;
		const skillId = renamedSkillId(oldId);
		if (skillId !== undefined) return { skillId, note: skillRenameNote(oldId) };
	}
	return null;
}
