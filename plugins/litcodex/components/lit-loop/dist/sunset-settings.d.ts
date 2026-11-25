export declare const SUNSET_HINT = "\u2600 New: a live LIT sunset under Codex. Run `npx @litfamily/litcodex sunset on`, then start Codex again.";
export interface SunsetRecord {
    readonly choice: "on" | "off" | null;
    /** The experimental feature's value before `on`; null when config.toml did not set it. */
    readonly featureBefore: "true" | "false" | null;
    /** Table headers `on` added to config.toml. */
    readonly added: readonly string[];
}
export declare const NO_RECORD: SunsetRecord;
export declare function readSunsetRecord(home: string): SunsetRecord | null;
export declare function writeSunsetRecord(home: string, record: SunsetRecord): boolean;
/** The hint, the first time only; null when it was shown, answered, or cannot be remembered. */
export declare function takeSunsetHint(env: NodeJS.ProcessEnv): string | null;
