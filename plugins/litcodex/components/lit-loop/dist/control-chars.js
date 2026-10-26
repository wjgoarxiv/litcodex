// src/control-chars.ts — record text is data. Strings that came from a repository, a rollout or a state file
// are stripped of C0/C1 controls (ESC, CSI, OSC and BEL among them) and of zero-width and bidi format
// characters before the brief, the text HUD or the card text prints them. A leaf module, so the card, the
// HUD and the collector can all use it.
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/gu;
export function clean(text) {
    return text.replace(CONTROL, "");
}
/** Every string inside a plain value, cleaned; numbers, booleans and null pass through. */
export function cleanDeep(value) {
    if (typeof value === "string")
        return clean(value);
    if (Array.isArray(value))
        return value.map((item) => cleanDeep(item));
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)]));
    }
    return value;
}
/** A multi-line text with each line cleaned; the line breaks stay. */
export function cleanLines(text) {
    return text.split("\n").map(clean).join("\n");
}
