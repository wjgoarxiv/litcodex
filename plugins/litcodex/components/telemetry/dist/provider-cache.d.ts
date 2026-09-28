/**
 * Local-only provider cache capability for Codex JSONL receipts.
 *
 * Codex exposes cache counters on `turn.completed.usage`. This adapter accepts
 * only that receipt shape, keeps only bounded numeric counters, and never
 * stores or returns prompt, transcript, model, provider, or response text.
 * The SessionStart hook remains a deliberately inert no-op; callers opt into
 * this measurement path explicitly with an already-parsed receipt event.
 */
declare const RECEIPT_SOURCE: "turn.completed.usage";
export declare const PROVIDER_CACHE_RECEIPT_FIELDS: readonly ["input_tokens", "cached_input_tokens"];
export declare const providerCacheCapability: Readonly<{
    readonly state: "capable";
    readonly surface: "turn.completed.usage";
    readonly receiptFields: readonly ["input_tokens", "cached_input_tokens"];
    readonly storage: "local-only numeric measurement";
    readonly liveMeasurement: "unproven until a receipt arrives";
    readonly rawPayloads: "ignored";
}>;
export type ProviderCacheReceipt = {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
};
export type ProviderCacheReceiptSequence = {
    readonly baseline: ProviderCacheReceipt | null;
    readonly snapshots: readonly ProviderCacheReceipt[];
};
export type ProviderCacheDelta = {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly uncachedInputTokens: number;
};
type ProviderCacheInvalidReason = "missing-baseline" | "numeric-overflow" | "cached-counter-exceeds-input" | "counter-reset" | "zero-input-delta" | "cached-delta-exceeds-input";
export type ProviderCacheMeasurement = {
    readonly status: "measured";
    readonly source: typeof RECEIPT_SOURCE;
    readonly receipts: number;
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly uncachedInputTokens: number;
    readonly cacheHitRatio: number;
    readonly deltas: readonly ProviderCacheDelta[];
} | {
    readonly status: "unavailable";
    readonly source: typeof RECEIPT_SOURCE;
    readonly receipts: 0;
    readonly reason: "no-authoritative-cache-fields";
} | {
    readonly status: "invalid";
    readonly source: typeof RECEIPT_SOURCE;
    readonly receipts: 0;
    readonly reason: ProviderCacheInvalidReason;
};
/**
 * Extract the cache counters from one Codex `turn.completed` JSONL event.
 * Unknown event shapes and invalid counters are rejected without exposing
 * their contents to callers.
 */
export declare function parseProviderCacheReceipt(event: unknown): ProviderCacheReceipt | null;
/**
 * Convert an explicit B0 plus ordered cumulative snapshots into per-turn
 * deltas. Missing receipts are unavailable; malformed sequences are invalid.
 * Neither outcome permits a cache claim from latency or event timing.
 */
export declare function measureProviderCacheReceipts(sequence: ProviderCacheReceiptSequence): ProviderCacheMeasurement;
export {};
