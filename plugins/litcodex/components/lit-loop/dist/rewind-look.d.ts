/**
 * Mark `sessionId` as running lit-adhd. The workspace is the one the session's pointer already names, so a run from a
 * subfolder cannot leave state beside the wrong folder; with no pointer it is the run's own folder. A turn the hook
 * already recorded as lit-adhd is left as it is, so that turn's Stop card still matches. Never throws.
 */
export declare function markRewindLook(cwd: string, sessionId: string, env: NodeJS.ProcessEnv, now?: number): void;
