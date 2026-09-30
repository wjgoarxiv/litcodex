import { describe, expect, it } from "vitest";

import { FALLBACK_CATALOG, type ReasoningProfile } from "./catalog.js";
import { decideCatalogApplication, selectedProfile } from "./gpt56-policy.js";

const target = selectedProfile("luna", "max");

function decide(current: Partial<ReasoningProfile>, reconfigure = false) {
	return decideCatalogApplication({ current, target, catalog: FALLBACK_CATALOG, reconfigure });
}

describe("GPT-5.6 exact classifier contract", () => {
	it.each([
		["fresh", {}, "fresh", null, true, true],
		["managed legacy", FALLBACK_CATALOG.managedProfiles[0]?.match ?? {}, "managed_legacy", "gpt-5.5", false, true],
		[
			"current SOL alias",
			{ model: "gpt-5.6", model_reasoning_effort: "high" },
			"existing_managed",
			"gpt-5.6",
			false,
			true,
		],
		[
			"TERRA",
			{ model: "gpt-5.6-terra", model_reasoning_effort: "high" },
			"existing_managed",
			"gpt-5.6-terra",
			false,
			true,
		],
		["existing explicit SOL", { model: "gpt-5.6-sol" }, "explicit_sol_dispatch", "gpt-5.6-sol", false, false],
		["LUNA", { model: "gpt-5.6-luna" }, "existing_managed", "gpt-5.6-luna", false, false],
		[
			"Astra",
			{ model: "gpt-6-astra", model_reasoning_effort: "xhigh" },
			"existing_managed",
			"gpt-6-astra",
			false,
			true,
		],
		[
			"previous-generation GPT-6 Sol",
			{ model: "gpt-6-sol", model_reasoning_effort: "xhigh" },
			"existing_managed",
			"gpt-6-sol",
			false,
			true,
		],
		[
			"GPT-6.1 Sol",
			{ model: "gpt-6.1-sol", model_reasoning_effort: "xhigh" },
			"existing_managed",
			"gpt-6.1-sol",
			false,
			true,
		],
		["5.60 boundary", { model: "gpt-5.60" }, "custom", "gpt-5.60", false, false],
		["provider-qualified custom", { model: "custom/gpt-5.6-sol" }, "custom", "custom/gpt-5.6-sol", false, false],
	] as const)("classifies %s without changing apply behavior", (_name, current, expectedClass, original, apply, managed) => {
		expect(decide(current)).toMatchObject({ class: expectedClass, originalDispatchId: original, apply, managed });
	});

	it("keeps exact managed legacy apply behavior under explicit reconfigure", () => {
		const current = FALLBACK_CATALOG.managedProfiles[0]?.match ?? {};
		expect(decide(current, true)).toMatchObject({ class: "managed_legacy", apply: true, managed: true });
	});

	it("selects the public alias for the SOL CLI selector", () => {
		expect(selectedProfile("sol", "high")).toEqual({ model: "gpt-5.6", model_reasoning_effort: "high" });
	});

	it("selects the public alias for the LUNA CLI selector", () => {
		expect(target).toEqual({ model: "gpt-5.6-luna", model_reasoning_effort: "max" });
	});

	it("selects the formal Astra model with its requested effort", () => {
		expect(selectedProfile("astra", "medium")).toEqual({ model: "gpt-6-astra", model_reasoning_effort: "medium" });
	});

	it("does not widen legacy profile selection to Astra-only efforts", () => {
		// @ts-expect-error low is intentionally not a legacy profile effort.
		expect(() => selectedProfile("sol", "low")).toThrow(/gpt-5\.6 requires high, xhigh, or max/);
	});

	it("keeps a state-matched public alias classified as current managed output", () => {
		const current = { model: "gpt-5.6", model_reasoning_effort: "high" };
		expect(
			decideCatalogApplication({
				current,
				target,
				catalog: FALLBACK_CATALOG,
				previousState: { catalogVersion: "current", written: current, managed: true },
				reconfigure: false,
			}),
		).toMatchObject({ class: "existing_managed", apply: false, managed: true, reason: "current" });
	});

	it("does not authorize automatic explicit SOL migration even when durable state matches", () => {
		const current = {
			model: "gpt-5.6-sol",
			model_reasoning_effort: "xhigh",
			model_context_window: 372_000,
			model_auto_compact_token_limit: 334_800,
		};
		expect(
			decideCatalogApplication({
				current,
				target,
				catalog: FALLBACK_CATALOG,
				previousState: { catalogVersion: "owned", written: current, managed: true },
				reconfigure: false,
			}),
		).toMatchObject({ class: "managed_legacy", apply: false, managed: true, reason: "managed-legacy" });
	});
});
