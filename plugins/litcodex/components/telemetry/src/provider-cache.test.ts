import { describe, expect, it } from "vitest";

import {
	measureProviderCacheReceipts,
	type ProviderCacheReceipt,
	parseProviderCacheReceipt,
	providerCacheCapability,
} from "./provider-cache.js";

const BASELINE = { inputTokens: 1_000, cachedInputTokens: 400 } as const;
const CUMULATIVE_SNAPSHOTS = [
	{ inputTokens: 1_200, cachedInputTokens: 500 },
	{ inputTokens: 1_500, cachedInputTokens: 800 },
	{ inputTokens: 1_700, cachedInputTokens: 960 },
	{ inputTokens: 2_000, cachedInputTokens: 1_200 },
	{ inputTokens: 2_400, cachedInputTokens: 1_520 },
] as const satisfies readonly ProviderCacheReceipt[];

describe("provider cache receipt measurement", () => {
	it("#given the Codex receipt surface #when capability is reported #then it is local numeric and live-unproven until observed", () => {
		// given / when
		const capability = providerCacheCapability;

		// then
		expect(capability).toEqual({
			state: "capable",
			surface: "turn.completed.usage",
			receiptFields: ["input_tokens", "cached_input_tokens"],
			storage: "local-only numeric measurement",
			liveMeasurement: "unproven until a receipt arrives",
			rawPayloads: "ignored",
		});
	});

	it("#given a Codex turn completion with cached input fields #when parsed #then it preserves only numeric cache facts", () => {
		// given
		const event = {
			type: "turn.completed",
			usage: {
				input_tokens: 1_000,
				cached_input_tokens: 400,
				output_tokens: 12,
				agent_message: "untrusted text must not be retained",
			},
		};

		// when
		const receipt = parseProviderCacheReceipt(event);

		// then
		expect(receipt).toEqual({ inputTokens: 1_000, cachedInputTokens: 400 });
	});

	it("#given B0 and cumulative S1-S5 snapshots #when measured #then it reports turn deltas instead of summing snapshots", () => {
		// given / when
		const measurement = measureProviderCacheReceipts({
			baseline: BASELINE,
			snapshots: CUMULATIVE_SNAPSHOTS,
		});

		// then
		expect(measurement).toEqual({
			status: "measured",
			source: "turn.completed.usage",
			receipts: 5,
			inputTokens: 1_400,
			cachedInputTokens: 1_120,
			uncachedInputTokens: 280,
			cacheHitRatio: 0.8,
			deltas: [
				{ inputTokens: 200, cachedInputTokens: 100, uncachedInputTokens: 100 },
				{ inputTokens: 300, cachedInputTokens: 300, uncachedInputTokens: 0 },
				{ inputTokens: 200, cachedInputTokens: 160, uncachedInputTokens: 40 },
				{ inputTokens: 300, cachedInputTokens: 240, uncachedInputTokens: 60 },
				{ inputTokens: 400, cachedInputTokens: 320, uncachedInputTokens: 80 },
			],
		});
	});

	it("#given no B0 #when a cumulative sequence is measured #then it fails closed", () => {
		// given / when
		const measurement = measureProviderCacheReceipts({
			baseline: null,
			snapshots: CUMULATIVE_SNAPSHOTS,
		});

		// then
		expect(measurement).toEqual({
			status: "invalid",
			source: "turn.completed.usage",
			receipts: 0,
			reason: "missing-baseline",
		});
	});

	it.each([
		{
			name: "duplicate counters",
			baseline: BASELINE,
			snapshot: BASELINE,
			reason: "zero-input-delta",
		},
		{
			name: "decreasing counters",
			baseline: BASELINE,
			snapshot: { inputTokens: 999, cachedInputTokens: 399 },
			reason: "counter-reset",
		},
		{
			name: "cached delta above input delta",
			baseline: BASELINE,
			snapshot: { inputTokens: 1_100, cachedInputTokens: 550 },
			reason: "cached-delta-exceeds-input",
		},
		{
			name: "unsafe counter",
			baseline: BASELINE,
			snapshot: { inputTokens: Number.MAX_SAFE_INTEGER + 1, cachedInputTokens: 550 },
			reason: "numeric-overflow",
		},
	] as const)("#given $name #when measured #then it returns typed invalid status", ({
		baseline,
		snapshot,
		reason,
	}) => {
		// given / when
		const measurement = measureProviderCacheReceipts({ baseline, snapshots: [snapshot] });

		// then
		expect(measurement).toEqual({
			status: "invalid",
			source: "turn.completed.usage",
			receipts: 0,
			reason,
		});
	});

	it("#given no authoritative cached input fields #when measured #then it returns unavailable instead of guessing", () => {
		// given / when
		const measurement = measureProviderCacheReceipts({ baseline: BASELINE, snapshots: [] });

		// then
		expect(measurement).toEqual({
			status: "unavailable",
			source: "turn.completed.usage",
			receipts: 0,
			reason: "no-authoritative-cache-fields",
		});
	});

	it("#given malformed or incomplete events #when parsed #then they are rejected without retaining input", () => {
		// given
		const invalidEvents = [
			{ type: "turn.completed", usage: { input_tokens: 1_000 } },
			{ type: "turn.completed", usage: { input_tokens: -1, cached_input_tokens: 0 } },
			{ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 101 } },
			{ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 1.5 } },
			{ type: "item.completed", item: { text: "untrusted content" } },
		];

		// when
		const parsed = invalidEvents.map(parseProviderCacheReceipt);

		// then
		expect(parsed).toEqual([null, null, null, null, null]);
	});

	it("#given prompt-like extra fields #when parsed and measured #then no raw input survives the numeric contract", () => {
		// given
		const secretSentinel = "LCPC_PRIVATE_SENTINEL";
		const event = {
			type: "turn.completed",
			usage: { input_tokens: 1_200, cached_input_tokens: 500 },
			prompt: secretSentinel,
			response: secretSentinel,
			request_id: secretSentinel,
		};

		// when
		const receipt = parseProviderCacheReceipt(event);
		const measurement = measureProviderCacheReceipts({
			baseline: BASELINE,
			snapshots: receipt === null ? [] : [receipt],
		});

		// then
		expect(JSON.stringify({ receipt, measurement })).not.toContain(secretSentinel);
	});
});
