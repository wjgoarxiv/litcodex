import { transcriptHasContextPressureMarker, transcriptHasDirectiveMarker, } from "./guards.js";
import { HANDOFF_DIRECTIVE_MARKER } from "./markers.js";
/** True only for the complete, case-insensitive bare invocation with optional edge whitespace. */
export function isExactBareHandoffPrompt(prompt) {
    return /^\s*handoff\s*$/iu.test(prompt);
}
/** Apply transcript idempotency and context-pressure guards to the dedicated handoff route. */
export function shouldSuppressHandoffInjection(transcriptPath) {
    return (transcriptHasDirectiveMarker(transcriptPath, HANDOFF_DIRECTIVE_MARKER) ||
        transcriptHasContextPressureMarker(transcriptPath));
}
