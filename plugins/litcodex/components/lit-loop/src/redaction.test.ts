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

// A secret in JSON or a quoted map puts the closing quote of the key before the colon, which the
// `key: value` rules did not match.
describe("redactSecrets handles JSON-style key/value credentials", () => {
	const quoted: readonly (readonly [string, string, string])[] = [
		["api_token", '{"api_token": "tok_Abc123SecretValue"}', "tok_Abc123SecretValue"],
		["apiKey", '{"apiKey":"abc123XYZ456"}', "abc123XYZ456"],
		["password with a space before the colon", '{"password" : "hunter2"}', "hunter2"],
		["a word-shaped password", '{"password": "correct"}', "correct"],
		["a single-quoted client secret", "{'client_secret': 'swordfish'}", "swordfish"],
		["an access token", '{"access_token":"ya29.a0AfH6SMB"}', "ya29.a0AfH6SMB"],
		["a refresh token", '{"refresh_token": "1//0gXyzRefresh"}', "1//0gXyzRefresh"],
		["an escaped quote in the value", '{"password": "pa\\"ss\\"word99"}', "word99"],
		["a numeric password", '{"password": 987654321}', "987654321"],
		["an Authorization header member", '{"Authorization": "Bearer abc.def-ghi"}', "abc.def-ghi"],
		["a secret key after other members", '{"user":"u","secret_key":"s3cr3tValue!","n":1}', "s3cr3tValue!"],
		["a token with a non-word value", '{"token": "x9Z-12345"}', "x9Z-12345"],
	];

	for (const [name, text, secret] of quoted) {
		it(`redacts ${name}`, () => {
			const out = redactSecrets(text);
			expect(out).not.toContain(secret);
			expect(out).toContain(REDACTED_SECRET);
		});
	}

	it("keeps the structure around the redacted value", () => {
		expect(redactSecrets('{"user":"u","password" : "hunter2","n":1}')).toBe(
			`{"user":"u","password" : "${REDACTED_SECRET}","n":1}`,
		);
	});

	for (const text of [
		'{"title": "Refactor the token bucket"}',
		'{"note": "Secret: the plan is simple"}',
		'{"token": "the plan is simple"}',
	]) {
		it(`preserves ordinary JSON ${JSON.stringify(text)}`, () => {
			expect(redactSecrets(text)).toBe(text);
		});
	}
});
