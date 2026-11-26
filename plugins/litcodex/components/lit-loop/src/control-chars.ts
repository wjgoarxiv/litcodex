// src/control-chars.ts — record text is data. Strings that came from a repository, a rollout or a state file
// are stripped of whole CSI sequences, C0/C1 controls (ESC, OSC and BEL among them), zero-width and bidi format
// characters and half surrogate pairs before the brief, the text HUD or the card text prints them. A leaf module, so the card, the
// HUD and the collector can all use it.

/** A colour code or another control sequence with its tail, which would read as text once ESC is gone. */
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu;
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩\ud800-\udfff]/gu;
/** Half a surrogate pair as JSON.stringify writes it; an escaped backslash before `ud83d` is text. */
const LONE_ESCAPE = /(?<!\\)((?:\\\\)*)\\ud[89a-f][0-9a-f]{2}/giu;
/** Characters as a reader sees them. */
export const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function clean(text: string): string {
	return withoutCodes(text).replace(CONTROL, "");
}

export function withoutCodes(text: string): string {
	return text.replace(CSI, "");
}

/** At most `max` UTF-16 units of `text`, ending after a whole character as a reader sees it. */
export function clipped(text: string, max: number): string {
	if (text.length <= max) return text;
	let end = 0;
	for (const { segment, index } of graphemes.segment(text)) {
		if (index + segment.length > max) break;
		end = index + segment.length;
	}
	return text.slice(0, end);
}

/** Hook output as Codex takes it: half a surrogate pair anywhere in it makes Codex refuse the whole JSON. */
export function hookJson(text: string): string {
	return text.replace(LONE_ESCAPE, "$1\ufffd");
}

/** Every string inside a plain value, cleaned; numbers, booleans and null pass through. */
export function cleanDeep<T>(value: T): T {
	if (typeof value === "string") return clean(value) as T;
	if (Array.isArray(value)) return value.map((item) => cleanDeep(item)) as T;
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDeep(item)])) as T;
	}
	return value;
}

/** A multi-line text with each line cleaned; the line breaks stay. */
export function cleanLines(text: string): string {
	return text.split("\n").map(clean).join("\n");
}
