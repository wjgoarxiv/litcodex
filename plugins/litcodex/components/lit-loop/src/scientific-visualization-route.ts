import {
	type GuardTranscriptInput,
	transcriptHasContextPressureMarker,
	transcriptHasDirectiveMarker,
} from "./guards.js";
import { SCIENTIFIC_VISUALIZATION_DIRECTIVE_MARKER } from "./markers.js";

/** True only for the complete case-insensitive bare invocation with optional edge whitespace. */
export function isExactBareScientificVisualizationPrompt(prompt: string): boolean {
	return /^\s*lit-scientific-visualization\s*$/iu.test(prompt);
}

/** Reserve the whitespace near miss so it cannot fall through to the generic bare-lit route. */
export function isScientificVisualizationWhitespaceNearMiss(prompt: string): boolean {
	return /^\s*lit\s+scientific\s+visualization\s*$/iu.test(prompt);
}

/** Apply transcript idempotency and context-pressure guards to the standalone science route. */
export function shouldSuppressScientificVisualizationInjection(transcriptPath: GuardTranscriptInput): boolean {
	return (
		transcriptHasDirectiveMarker(transcriptPath, SCIENTIFIC_VISUALIZATION_DIRECTIVE_MARKER) ||
		transcriptHasContextPressureMarker(transcriptPath)
	);
}
