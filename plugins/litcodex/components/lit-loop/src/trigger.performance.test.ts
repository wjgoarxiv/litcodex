import { describe, expect, it } from "vitest";
import { isLitTriggerPrompt } from "./trigger.js";

describe("trigger performance", () => {
	it("runs in linear time on huge input", () => {
		const big = `${"a".repeat(2_000_000)}split${"b".repeat(2_000_000)}`;
		const start = Date.now();
		const result = isLitTriggerPrompt(big);
		const ms = Date.now() - start;
		expect(result).toBe(false);
		expect(ms).toBeLessThan(200);
	});
});
