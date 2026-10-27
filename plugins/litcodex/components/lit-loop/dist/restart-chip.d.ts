/** The version this process loaded, or null when its manifest cannot be read. */
export declare function loadedPluginVersion(): string | null;
/** The version the installer last put in place for the Codex home in `env`, or null. */
export declare function installedPluginVersion(env: NodeJS.ProcessEnv): string | null;
/** `restart to <installed>` when `installed` is a newer plain version than `loaded`; null otherwise. */
export declare function restartChip(loaded: string | null, installed: string | null): string | null;
