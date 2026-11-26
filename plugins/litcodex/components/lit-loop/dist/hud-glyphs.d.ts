/** Terminals that draw the two caps without any font. */
export declare function drawsRoundCaps(env: NodeJS.ProcessEnv): boolean;
/** Whether every pill, gauge and button uses the caps: the one answer for the HUD and the installer. */
export declare function roundGlyphs(env: NodeJS.ProcessEnv, iconFont?: () => boolean): boolean;
/** Whether this terminal is known to draw the caps, with or without a font. */
export declare function terminalDrawsCaps(env: NodeJS.ProcessEnv): boolean;
/** `XDG_DATA_HOME` when it is usable: its specification says to ignore a relative one. */
export declare function xdgDataHome(env: NodeJS.ProcessEnv): string | null;
/** Whether a font file named like a Nerd Font is installed; at most `limit` names, no links, false on any doubt. */
export declare function hasIconFont(env: NodeJS.ProcessEnv, platform?: NodeJS.Platform, folders?: readonly string[], limit?: number): boolean;
