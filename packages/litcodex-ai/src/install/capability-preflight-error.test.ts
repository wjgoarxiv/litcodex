import { describe, expect, it } from "vitest";

import { capabilityPreflightError } from "./capability-preflight-error.js";
import type { HostCapabilities } from "./host-capabilities.js";

function capabilities(reason: string): HostCapabilities {
	return {
		concurrency: {
			status: "unavailable",
			reason,
			observedSource: "codex-cli unknown strict-config + version policy",
		},
		autoCompaction: {
			status: "unavailable",
			reason: "codex-version-unrecognized",
			observedSource: "codex debug models",
		},
		modelContexts: { "gpt-5.6": null, "gpt-5.6-terra": null, "gpt-5.6-luna": null },
	};
}

describe("Codex capability preflight errors", () => {
	it("explains that unrecognized output is not a stable-version policy rejection", () => {
		const error = capabilityPreflightError(capabilities("codex-version-unrecognized"));

		expect(error.code).toBe("LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED");
		expect(error.message).toMatch(/could not determine the Codex CLI version/i);
		expect(error.message).not.toContain("supported stable release");
	});

	it("keeps prerelease output on the unsupported stable-release path", () => {
		const error = capabilityPreflightError(capabilities("codex-version-prerelease"));

		expect(error.message).toContain("supported stable release");
	});
});

describe("host config incompatibility is reported separately from rejected managed settings", () => {
	// A no-override baseline probe distinguishes the two causes. Measured on
	// codex-cli 0.144.0 against a real ~/.codex/config.toml: the same config fails
	// `config.load` with LitCodex's overrides AND with no overrides at all, while an
	// empty CODEX_HOME accepts the overrides. The overrides were never the cause.
	it("names the host config and the resolved binary, not the managed settings", () => {
		const error = capabilityPreflightError(capabilities("host-config-incompatible"), "/repo/node_modules/.bin/codex");
		expect(error.message).toContain("/repo/node_modules/.bin/codex");
		expect(error.message).toContain("existing Codex configuration");
		expect(error.message).not.toContain("managed settings");
	});

	it("still blames the managed settings when the baseline probe accepted the host config", () => {
		const error = capabilityPreflightError(capabilities("strict-config-rejected"), "/usr/local/bin/codex");
		expect(error.message).toContain("managed settings");
		expect(error.message).toContain("/usr/local/bin/codex");
	});

	it("uses Codex's own reported detail instead of the generic version guess when available", () => {
		const withDetail: HostCapabilities = {
			...capabilities("host-config-incompatible"),
			concurrency: {
				status: "unavailable",
				reason: "host-config-incompatible",
				observedSource: "codex-cli unknown strict-config + version policy",
				detail: "config could not be loaded: failed to load bootstrap configuration",
			},
		};
		const error = capabilityPreflightError(withDetail);
		expect(error.message).toContain(
			"Codex reported: config could not be loaded: failed to load bootstrap configuration",
		);
		expect(error.message).not.toContain("This usually means that Codex is older");
	});

	it("falls back to the generic explanation when no detail was observed", () => {
		const error = capabilityPreflightError(capabilities("host-config-incompatible"));
		expect(error.message).toContain("This usually means that Codex is older");
	});

	it("names the resolved binary in the version-too-old message", () => {
		const error = capabilityPreflightError(capabilities("codex-version-too-old"), "/repo/node_modules/.bin/codex");
		expect(error.message).toContain("/repo/node_modules/.bin/codex");
	});

	it("omits the binary clause when the resolved path is unknown", () => {
		const error = capabilityPreflightError(capabilities("strict-config-rejected"));
		expect(error.message).toContain("managed settings");
		expect(error.message).not.toContain("resolved Codex");
	});
});
