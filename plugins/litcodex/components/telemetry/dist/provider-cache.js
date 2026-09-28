/**
 * Local-only provider cache capability for Codex JSONL receipts.
 *
 * Codex exposes cache counters on `turn.completed.usage`. This adapter accepts
 * only that receipt shape, keeps only bounded numeric counters, and never
 * stores or returns prompt, transcript, model, provider, or response text.
 * The SessionStart hook remains a deliberately inert no-op; callers opt into
 * this measurement path explicitly with an already-parsed receipt event.
 */
const RECEIPT_SOURCE = "turn.completed.usage";
export const PROVIDER_CACHE_RECEIPT_FIELDS = Object.freeze(["input_tokens", "cached_input_tokens"]);
export const providerCacheCapability = Object.freeze({
    state: "capable",
    surface: RECEIPT_SOURCE,
    receiptFields: PROVIDER_CACHE_RECEIPT_FIELDS,
    storage: "local-only numeric measurement",
    liveMeasurement: "unproven until a receipt arrives",
    rawPayloads: "ignored",
});
/**
 * Extract the cache counters from one Codex `turn.completed` JSONL event.
 * Unknown event shapes and invalid counters are rejected without exposing
 * their contents to callers.
 */
export function parseProviderCacheReceipt(event) {
    if (!isRecord(event) || event["type"] !== "turn.completed")
        return null;
    const usage = event["usage"];
    if (!isRecord(usage))
        return null;
    const inputTokens = nonNegativeSafeInteger(usage["input_tokens"]);
    const cachedInputTokens = nonNegativeSafeInteger(usage["cached_input_tokens"]);
    if (inputTokens === null || cachedInputTokens === null || cachedInputTokens > inputTokens)
        return null;
    return { inputTokens, cachedInputTokens };
}
/**
 * Convert an explicit B0 plus ordered cumulative snapshots into per-turn
 * deltas. Missing receipts are unavailable; malformed sequences are invalid.
 * Neither outcome permits a cache claim from latency or event timing.
 */
export function measureProviderCacheReceipts(sequence) {
    if (sequence.baseline === null)
        return invalidMeasurement("missing-baseline");
    if (sequence.snapshots.length === 0) {
        return {
            status: "unavailable",
            source: RECEIPT_SOURCE,
            receipts: 0,
            reason: "no-authoritative-cache-fields",
        };
    }
    if (!hasSafeCounters(sequence.baseline))
        return invalidMeasurement("numeric-overflow");
    if (sequence.baseline.cachedInputTokens > sequence.baseline.inputTokens) {
        return invalidMeasurement("cached-counter-exceeds-input");
    }
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let previous = sequence.baseline;
    const deltas = [];
    for (const snapshot of sequence.snapshots) {
        if (!hasSafeCounters(snapshot))
            return invalidMeasurement("numeric-overflow");
        if (snapshot.cachedInputTokens > snapshot.inputTokens) {
            return invalidMeasurement("cached-counter-exceeds-input");
        }
        if (snapshot.inputTokens < previous.inputTokens || snapshot.cachedInputTokens < previous.cachedInputTokens) {
            return invalidMeasurement("counter-reset");
        }
        const inputDelta = snapshot.inputTokens - previous.inputTokens;
        const cachedDelta = snapshot.cachedInputTokens - previous.cachedInputTokens;
        if (inputDelta === 0)
            return invalidMeasurement("zero-input-delta");
        if (cachedDelta > inputDelta)
            return invalidMeasurement("cached-delta-exceeds-input");
        const nextInputTokens = safeAdd(inputTokens, inputDelta);
        const nextCachedInputTokens = safeAdd(cachedInputTokens, cachedDelta);
        if (nextInputTokens === null || nextCachedInputTokens === null) {
            return invalidMeasurement("numeric-overflow");
        }
        deltas.push({
            inputTokens: inputDelta,
            cachedInputTokens: cachedDelta,
            uncachedInputTokens: inputDelta - cachedDelta,
        });
        inputTokens = nextInputTokens;
        cachedInputTokens = nextCachedInputTokens;
        previous = snapshot;
    }
    return {
        status: "measured",
        source: RECEIPT_SOURCE,
        receipts: sequence.snapshots.length,
        inputTokens,
        cachedInputTokens,
        uncachedInputTokens: inputTokens - cachedInputTokens,
        cacheHitRatio: cachedInputTokens / inputTokens,
        deltas,
    };
}
function invalidMeasurement(reason) {
    return { status: "invalid", source: RECEIPT_SOURCE, receipts: 0, reason };
}
function hasSafeCounters(receipt) {
    return (nonNegativeSafeInteger(receipt.inputTokens) !== null && nonNegativeSafeInteger(receipt.cachedInputTokens) !== null);
}
function nonNegativeSafeInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function safeAdd(left, right) {
    const sum = left + right;
    return Number.isSafeInteger(sum) ? sum : null;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
