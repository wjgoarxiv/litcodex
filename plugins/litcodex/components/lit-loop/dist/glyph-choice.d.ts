export declare const GLYPHS_ENV = "LITCODEX_HUD_GLYPHS";
export declare const GLYPH_CHOICES: readonly ["auto", "round", "square"];
export type GlyphChoice = (typeof GLYPH_CHOICES)[number];
export interface SavedGlyphs {
    readonly glyphs: GlyphChoice;
    readonly from: "user" | "terminal";
}
/** The choice a word of the environment names; null when it names none. */
export declare function glyphsWord(value: string | undefined): GlyphChoice | null;
export declare function glyphsPath(env: NodeJS.ProcessEnv): string | null;
/** The saved choice; a missing, corrupt or linked file is none, and so is one in a linked folder. */
export declare function savedGlyphs(env: NodeJS.ProcessEnv): SavedGlyphs | null;
/** Why the choice cannot be saved, checked before an install writes anything; null when it can. */
export declare function glyphsProblem(env: NodeJS.ProcessEnv): string | null;
/** Why a state file is not to be written: it or its folder is a link, or something else stands in its place. */
export declare function stateFileProblem(path: string): string | null;
export declare function saveGlyphs(env: NodeJS.ProcessEnv, glyphs: GlyphChoice, from: SavedGlyphs["from"]): boolean;
/** Forgets the choice; a link or anything that is no regular file stays. */
export declare function removeGlyphs(env: NodeJS.ProcessEnv): void;
/** The environment's word, else the saved choice, else auto. */
export declare function chosenGlyphs(env: NodeJS.ProcessEnv): GlyphChoice;
/** Whether the chat card's pills end round: only where the saved choice says so, since a hook cannot see the window. */
export declare function cardCaps(env: NodeJS.ProcessEnv): boolean;
