export declare function noticeHash(text: string): string;
export declare function shownNoticesPath(dataRoot: string): string;
/** True only when a well-formed line of the record carries this hash. */
export declare function wasShown(dataRoot: string, hash: string): boolean;
/** Append one line. Never throws and never writes through a symlink or past the cap. */
export declare function markShown(dataRoot: string, hash: string, now?: number): void;
