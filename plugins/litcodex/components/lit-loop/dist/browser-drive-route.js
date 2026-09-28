import { transcriptHasContextPressureMarker, transcriptHasDirectiveMarker, } from "./guards.js";
import { BROWSER_DRIVE_DIRECTIVE_MARKER } from "./markers.js";
/** True only for the complete browser-drive route or its exact Codex scoped shorthand. */
export function isExactBrowserDrivePrompt(prompt) {
    return /^\s*(?:browser-drive|\$litcodex:browser-drive)\s*$/iu.test(prompt);
}
/** Alias that names the bare route while retaining the shorthand in the same exact route. */
export const isExactBareBrowserDrivePrompt = isExactBrowserDrivePrompt;
/** Apply the existing per-mode idempotency and context-pressure guards to browser-drive. */
export function shouldSuppressBrowserDriveInjection(transcriptPath) {
    return (transcriptHasDirectiveMarker(transcriptPath, BROWSER_DRIVE_DIRECTIVE_MARKER) ||
        transcriptHasContextPressureMarker(transcriptPath));
}
