import { type GuardTranscriptInput } from "./guards.js";
/** True only for the complete case-insensitive bare invocation with optional edge whitespace. */
export declare function isExactBareScientificVisualizationPrompt(prompt: string): boolean;
/** Reserve the whitespace near miss so it cannot fall through to the generic bare-lit route. */
export declare function isScientificVisualizationWhitespaceNearMiss(prompt: string): boolean;
/** Apply transcript idempotency and context-pressure guards to the standalone science route. */
export declare function shouldSuppressScientificVisualizationInjection(transcriptPath: GuardTranscriptInput): boolean;
