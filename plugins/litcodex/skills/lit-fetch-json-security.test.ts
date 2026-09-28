import { describe, expect, it } from "vitest";

async function validateJson(body: Readonly<Record<string, unknown>>) {
	const module = await import("./lit-fetch/scripts/lib/validate.mjs");
	return module.validateResponse({
		status: 200,
		headers: { "content-type": "application/vnd.api+json" },
		body: JSON.stringify(body),
	});
}

describe("lit-fetch JSON error proof", () => {
	it.each([
		["plural errors", { errors: [{ detail: "upstream denied request ".repeat(30) }] }],
		["HTTP-like status and message", { status: 500, message: "internal server failure ".repeat(30) }],
		["singular non-null error", { error: { detail: "service unavailable ".repeat(30) } }],
	])("rejects a long vendor JSON %s document instead of treating length as content proof", async (_label, body) => {
		// Given/When: an HTTP 200 vendor JSON body carries a structural error shape.
		const result = await validateJson(body);

		// Then: the validator records weak error content, never content success.
		expect(result.classification).toBe("weak_content");
		expect(result.note).toBe("JSON error document");
	});

	it("keeps meaningful vendor JSON accepted when error fields are empty", async () => {
		// Given: a substantive vendor document with explicit empty error fields.
		const body = {
			data: [{ title: "verified record", abstract: "evidence ".repeat(30) }],
			error: null,
			errors: [],
		};

		// When: the same vendor boundary validates it.
		const result = await validateJson(body);

		// Then: meaningful data remains valid content.
		expect(result.classification).toBe("content_ok");
	});
});
