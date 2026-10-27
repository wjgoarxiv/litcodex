/**
 * Absolute paths the plan's todos name outside `projectRoot` that no `Scope roots:` line covers, in order of
 * first mention. Empty when the plan is covered.
 */
export declare function scopeRootGaps(text: string, projectRoot: string, home: string): string[];
/** The line a planner pastes to declare `path`; read access is the default to widen deliberately. */
export declare function scopeRootLine(path: string): string;
