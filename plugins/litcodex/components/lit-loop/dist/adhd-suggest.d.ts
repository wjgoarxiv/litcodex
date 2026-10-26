export declare const SUGGEST_DIR = ".litcodex/adhd";
/** A record untouched for less than this belongs to a session that has not had a break. */
export declare const BREAK_MS: number;
/** A record older than this is no longer recent work. */
export declare const RECENT_MS: number;
/** One offer per folder in this long. */
export declare const QUIET_MS: number;
export declare const SUGGESTION: string;
/** The offer for a session that just opened, or null when it was made lately, there is nothing earlier, or state is unsafe. */
export declare function adhdSuggestion(cwd: string, sessionId: string, now?: number): string | null;
