import type { LitTriggerToken } from "./trigger.js";
export declare function isCodexSkillMentionToken(prompt: string, tokenIndex: number): boolean;
export declare function scopedTokenForBareLit(prompt: string, tokenIndex: number): LitTriggerToken | null;
export declare function suppressesBareLitAfterCodexSkillMention(prompt: string, tokenIndex: number): boolean;
