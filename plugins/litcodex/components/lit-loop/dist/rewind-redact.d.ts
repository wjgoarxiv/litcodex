export declare const REWIND_MASK = "[redacted]";
/** A redactor bound to one environment and home, so the environment scan happens once per run. */
export declare function makeRedactor(env: NodeJS.ProcessEnv, home: string | null): (input: string) => string;
