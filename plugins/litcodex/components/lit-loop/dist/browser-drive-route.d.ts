import { type GuardTranscriptInput } from "./guards.js";
/** True only for the complete browser-drive route or its exact Codex scoped shorthand. */
export declare function isExactBrowserDrivePrompt(prompt: string): boolean;
/** Alias that names the bare route while retaining the shorthand in the same exact route. */
export declare const isExactBareBrowserDrivePrompt: typeof isExactBrowserDrivePrompt;
/** Apply the existing per-mode idempotency and context-pressure guards to browser-drive. */
export declare function shouldSuppressBrowserDriveInjection(transcriptPath: GuardTranscriptInput): boolean;
