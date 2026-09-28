import { describe, expect, it } from "vitest";

import { classifyCodexVersion } from "./codex-version.js";

describe("Codex CLI version classification", () => {
	it("recognizes a supported stable version on stdout", () => {
		expect(classifyCodexVersion("codex-cli 0.144.0\n")).toEqual({ kind: "tested", version: "0.144.0" });
	});

	it("recognizes a supported stable version on stderr", () => {
		expect(classifyCodexVersion("", "codex-cli 0.144.1\r\n")).toEqual({
			kind: "tested",
			version: "0.144.1",
		});
	});

	it("keeps unsupported stable versions separate from malformed output", () => {
		expect(classifyCodexVersion("codex-cli 0.143.9\r\n")).toEqual({ kind: "too-old", version: "0.143.9" });
		expect(classifyCodexVersion("codex-cli 0.145.0\r\n")).toEqual({ kind: "newer-stable", version: "0.145.0" });
		expect(classifyCodexVersion("codex-cli development-build\r\n")).toEqual({ kind: "unrecognized", version: null });
	});

	it("does not accept a prerelease as a stable version", () => {
		expect(classifyCodexVersion("codex-cli 0.145.0-alpha.4\r\n")).toEqual({
			kind: "prerelease",
			version: "0.145.0-alpha.4",
		});
	});

	it("keeps undocumented prefixes and bare numbers unrecognized", () => {
		expect(classifyCodexVersion("0.144.1\r\n")).toEqual({ kind: "unrecognized", version: null });
		expect(classifyCodexVersion("Codex CLI 0.144.1\r\n")).toEqual({ kind: "unrecognized", version: null });
		expect(classifyCodexVersion("wrapper: codex-cli 0.144.1\r\n")).toEqual({ kind: "unrecognized", version: null });
		expect(classifyCodexVersion("wrapper:\ncodex-cli 0.144.1\r\n")).toEqual({ kind: "unrecognized", version: null });
	});
});
