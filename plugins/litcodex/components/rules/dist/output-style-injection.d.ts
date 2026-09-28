export declare const OUTPUT_STYLE_IDS: readonly ["off", "asd-ste100", "asd-ste100-ko", "eli5", "eli5-ko"];
export type OutputStyleId = (typeof OUTPUT_STYLE_IDS)[number];
/**
 * Load and return the output-style file text for the style configured in CODEX_HOME/config.toml.
 * Returns "" for "off", unset, or any error (fail-open). Never throws.
 */
export declare function loadOutputStyleText(env?: NodeJS.ProcessEnv): string;
