export declare const standard: readonly string[];
export declare const banner: readonly string[];
export declare const micro: readonly string[];
export type ColorMode = "truecolor" | "256" | "none";
/** The standard mark in a 28-column field, with an arbitrary product label alongside. */
export declare function lockup(productName: string): string[];
export declare function supportsBlocks(env: NodeJS.ProcessEnv): boolean;
/** Pipe-safe and model-safe; Codex >=0.156 renders hook systemMessage control characters literally. */
export declare function activationMessage(discipline: string, _env?: NodeJS.ProcessEnv): string;
export declare function colorMode(opts: {
    readonly isTty: boolean;
    readonly env: NodeJS.ProcessEnv;
    readonly json?: boolean;
}): ColorMode;
/** Flat Ignition cell colors preserve glyphs and leave appended lockup labels unpainted. */
export declare function colorize(rows: readonly string[], opts: {
    readonly mode: ColorMode;
    readonly shadow?: string;
}): string[];
/** Codex statusMessage is one header span, so use the permitted one-line session lockup. */
export declare const sessionLockup = "LIT \u00B7 codex";
export declare function microLine(discipline: string): string;
