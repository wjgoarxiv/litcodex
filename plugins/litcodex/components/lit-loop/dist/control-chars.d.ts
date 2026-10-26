export declare function clean(text: string): string;
/** Every string inside a plain value, cleaned; numbers, booleans and null pass through. */
export declare function cleanDeep<T>(value: T): T;
/** A multi-line text with each line cleaned; the line breaks stay. */
export declare function cleanLines(text: string): string;
