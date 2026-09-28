import { type GuardTranscriptInput } from "./guards.js";
/** True only for the complete, case-insensitive bare invocation with optional edge whitespace. */
export declare function isExactBareHandoffPrompt(prompt: string): boolean;
/** Apply transcript idempotency and context-pressure guards to the dedicated handoff route. */
export declare function shouldSuppressHandoffInjection(transcriptPath: GuardTranscriptInput): boolean;
