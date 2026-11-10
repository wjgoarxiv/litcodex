/**
 * True when reading `root` belongs to the Codex host rather than to the plan: this session's own rollout file, the
 * Codex home's `AGENTS.md`, `skills/`, `agents/` and `litcodex/` folders, the transcript Codex named, or this
 * plugin. Such a read never needs a boundary. A folder under `sessions/` is not included, since listing it shows
 * other sessions. The protected-path check runs first and always wins.
 */
export declare function isHostOwnedRead(root: string, sessionId: string, env?: NodeJS.ProcessEnv, transcriptPath?: string): boolean;
