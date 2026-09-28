import { describe, expect, it } from "vitest";
import { SCAFFOLD_PLACEHOLDER } from "../src/_scaffold.js";

describe("scaffold smoke", () => {
	it("imports the workspace sentinel source directly and it is frozen", () => {
		expect(SCAFFOLD_PLACEHOLDER).toEqual({});
		expect(Object.isFrozen(SCAFFOLD_PLACEHOLDER)).toBe(true);
	});
});
