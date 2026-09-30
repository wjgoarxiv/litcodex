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
