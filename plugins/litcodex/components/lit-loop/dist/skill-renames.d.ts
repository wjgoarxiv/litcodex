/** Compatibility aliases for one release; remove in the next minor release. */
export declare const SKILL_RENAMES: {
    readonly hyperplan: "lit-crucible";
    readonly "init-deep": "lit-init";
    readonly "git-master": "lit-commit";
    readonly teammode: "lit-team";
    readonly "remove-ai-slops": "lit-burnoff";
    readonly "ai-slop-remover": "lit-burnoff-file";
    readonly "lit-korean": "lit-humanizer";
    readonly "text-naturalization": "lit-humanizer";
    readonly "korean-ai-slop-remover": "lit-humanizer";
    readonly "public-page-reader": "lit-fetch";
    readonly programming: "lit-code";
};
export type RenamedSkillId = (typeof SKILL_RENAMES)[keyof typeof SKILL_RENAMES];
export declare function renamedSkillId(word: string): RenamedSkillId | undefined;
export declare function skillRenameNote(raw: string): string;
/** Match explicit invocations in code-masked text without overtaking an earlier bounded route. */
export declare function matchRenamedSkillInvocation(prompt: string, firstBoundedIndex: number): {
    readonly skillId: RenamedSkillId;
    readonly note: string;
} | null;
