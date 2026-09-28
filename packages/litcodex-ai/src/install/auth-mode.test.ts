import { describe, expect, it } from "vitest";

import { type AuthMode, detectAuthMode } from "./auth-mode.js";
import type { ReadonlyFsLike } from "./codex.js";

function fakeFs(files: ReadonlyMap<string, string>): ReadonlyFsLike {
	return {
		existsSync: (path) => files.has(path),
		readFileSync: (path) => {
			const value = files.get(path);
			if (value === undefined) throw new Error(`no such file: ${path}`);
			return value;
		},
	};
}

const CODEX_HOME = "/tmp/test-codex-home";
const AUTH_PATH = `${CODEX_HOME}/auth.json`;

describe("detectAuthMode", () => {
	it("returns 'chatgpt' when tokens object contains id_token", () => {
		const auth = JSON.stringify({
			tokens: { id_token: "fake-id-token", access_token: "fake-at", refresh_token: "fake-rt", account_id: "acct" },
			auth_mode: "chatgpt",
			last_refresh: "2026-07-29T00:00:00Z",
		});
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, auth]])), CODEX_HOME)).toBe("chatgpt" satisfies AuthMode);
	});

	it("returns 'api-key' when OPENAI_API_KEY is present and no tokens", () => {
		const auth = JSON.stringify({ OPENAI_API_KEY: "sk-fake-key" });
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, auth]])), CODEX_HOME)).toBe("api-key" satisfies AuthMode);
	});

	it("returns 'api-key' when OPENAI_API_KEY is present even with empty tokens", () => {
		const auth = JSON.stringify({ OPENAI_API_KEY: "sk-fake-key", tokens: {} });
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, auth]])), CODEX_HOME)).toBe("api-key" satisfies AuthMode);
	});

	it("returns 'chatgpt' when both OPENAI_API_KEY and tokens with id_token are present", () => {
		const auth = JSON.stringify({
			OPENAI_API_KEY: "sk-fake-key",
			tokens: { id_token: "fake-id", access_token: "fake-at", refresh_token: "fake-rt", account_id: "acct" },
			auth_mode: "chatgpt",
		});
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, auth]])), CODEX_HOME)).toBe("chatgpt" satisfies AuthMode);
	});

	it("returns 'unknown' when auth.json is absent", () => {
		expect(detectAuthMode(fakeFs(new Map()), CODEX_HOME)).toBe("unknown" satisfies AuthMode);
	});

	it("returns 'unknown' when auth.json contains invalid JSON", () => {
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, "not-json"]])), CODEX_HOME)).toBe("unknown" satisfies AuthMode);
	});

	it("returns 'unknown' when auth.json is an empty object", () => {
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, "{}"]])), CODEX_HOME)).toBe("unknown" satisfies AuthMode);
	});

	it("returns 'unknown' when auth.json is an array", () => {
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, "[]"]])), CODEX_HOME)).toBe("unknown" satisfies AuthMode);
	});

	it("returns 'unknown' when tokens exists but has no id_token and no OPENAI_API_KEY", () => {
		const auth = JSON.stringify({ tokens: { access_token: "at" } });
		expect(detectAuthMode(fakeFs(new Map([[AUTH_PATH, auth]])), CODEX_HOME)).toBe("unknown" satisfies AuthMode);
	});
});
