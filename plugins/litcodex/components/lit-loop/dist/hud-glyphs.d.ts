/** Terminals that draw the two caps without any font. */
export declare function drawsRoundCaps(env: NodeJS.ProcessEnv): boolean;
/** Whether the plain lines of a narrow window use the caps. */
export declare function narrowRoundCaps(env: NodeJS.ProcessEnv): boolean;
/** Whether the card uses the caps. */
export declare function roundGlyphs(env: NodeJS.ProcessEnv, iconFont?: () => boolean): boolean;
/** Whether a font file named like a Nerd Font is installed; at most `limit` names, no links, false on any doubt. */
export declare function hasIconFont(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, folders?: readonly string[], limit?: number): boolean;
