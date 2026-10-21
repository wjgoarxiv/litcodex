export interface ModelMetadata {
    readonly slug: string;
    readonly contextWindow: number;
}
export type ModelMetadataResult = {
    readonly state: "available";
    readonly metadata: ModelMetadata;
} | {
    readonly state: "unavailable";
    readonly reason: "model-not-found" | "malformed-metadata" | "host-probe-failed";
};
export declare function resetModelMetadataCacheForTests(): void;
export declare function resolveModelMetadata(model: string, structuredCatalog?: string): ModelMetadataResult;
export type ManagedModelSlug = "gpt-6-astra" | "gpt-6.1-sol" | "gpt-6-sol" | "gpt-6-luna" | "gpt-5.6" | "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna";
export declare function managedGpt56Slug(model: string): ManagedModelSlug | null;
export interface ShellFreeCommand {
    readonly command: string;
    readonly args: readonly string[];
}
export interface ShellFreeOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
    readonly exists?: (file: string) => boolean;
    readonly read?: (file: string) => string;
}
/**
 * How to spawn a user-installed CLI without a shell. On Windows npm installs Codex as a codex.cmd
 * shim, which Node refuses to spawn without a shell (CVE-2024-27980) and a bare "codex" never finds,
 * so the shim is unwrapped to the script or binary it launches; no argument passes through cmd.exe.
 */
export declare function shellFreeCommand(name: string, args: readonly string[], { env, platform, exists, read, }?: ShellFreeOptions): ShellFreeCommand;
