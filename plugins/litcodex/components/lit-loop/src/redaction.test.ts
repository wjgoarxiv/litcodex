import { describe, expect, it } from "vitest";

import { REDACTED_SECRET, redactSecrets } from "./redaction.js";

// redactSecrets rewrites goal objectives, run instructions, brief.md, and observation records, so a
// false positive silently changes what the user asked for. These cases pin both directions: ordinary
// prose must survive byte-identical, and every known credential shape must still be replaced.

describe("redactSecrets leaves ordinary prose unchanged", () => {
	const prose = [
		"Ship a basic dashboard first",
		"Add basic auth support",
		"Document the auth: none default",
		"Secret: the plan is simple",
		"Refactor the token bucket rate limiter",
		"the skill never shows a basic example",
		"token refreshing works",
	];

	for (const text of prose) {
		it(`preserves ${JSON.stringify(text)}`, () => {
			expect(redactSecrets(text)).toBe(text);
		});
	}
});

describe("redactSecrets still replaces credential shapes", () => {
	const credentials: readonly (readonly [string, string])[] = [
		["an Authorization Bearer header", `Authorization: Bearer ${"A".repeat(24)}`],
		["a bare lowercase bearer scheme", "deploy uses bearer TOKENVALUE1234"],
		["a Basic base64 credential", "Basic dXNlcjpzdXBlcnNlY3JldA=="],
		["a numeric password value", "password: hunter2"],
		["a word-shaped password value", "password=correct"],
		["an api key assignment", "api_key=abc123XYZ456"],
		["a client secret assignment", "client_secret: swordfish"],
		// Pins rule order: the high-signal key must win over the ambiguous `auth` alternative.
		["a high-signal key with a plain-word value", "auth_token: none"],
		["a stripe live key", "sk_live_ABCDEFGHIJ0123456789"],
		["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"],
		["a github token", `ghp_${"a".repeat(36)}`],
	];

	for (const [name, text] of credentials) {
		it(`redacts ${name}`, () => {
			expect(redactSecrets(text)).toContain(REDACTED_SECRET);
		});
	}
});

describe("redactSecrets handles short key/value credentials", () => {
	const shortCredentials = ["token=x", "secret=q", "auth=ok", "token:abc", "secret:xy"];

	for (const text of shortCredentials) {
		it(`redacts ${JSON.stringify(text)}`, () => {
			expect(redactSecrets(text)).toContain(REDACTED_SECRET);
		});
	}

	for (const text of ["Secret: the plan is simple", "Token: the plan is simple", "auth: none default"]) {
		it(`preserves prose ${JSON.stringify(text)}`, () => {
			expect(redactSecrets(text)).toBe(text);
		});
	}
});
