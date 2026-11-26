/** Characters as a reader sees them. */
export declare const graphemes: Intl.Segmenter;
export declare function clean(text: string): string;
export declare function withoutCodes(text: string): string;
/** At most `max` UTF-16 units of `text`, ending after a whole character as a reader sees it. */
export declare function clipped(text: string, max: number): string;
/** Hook output as Codex takes it: half a surrogate pair anywhere in it makes Codex refuse the whole JSON. */
export declare function hookJson(text: string): string;
/** Every string inside a plain value, cleaned; numbers, booleans and null pass through. */
export declare function cleanDeep<T>(value: T): T;
/** A multi-line text with each line cleaned; the line breaks stay. */
export declare function cleanLines(text: string): string;
