import { InstallError } from "./errors.js";
import type { HostCapabilities } from "./host-capabilities.js";

/**
 * Name the Codex the probe actually ran. The resolved binary is not always the one
 * the user expects: npx puts `node_modules/.bin` at the front of PATH, so an install
 * started inside a repository that pins @openai/codex probes that pin instead of the
 * system Codex, and the failure otherwise reads identically.
 */
function resolvedClause(codexBin?: string): string {
	return codexBin === undefined ? "" : ` The resolved Codex was ${codexBin}.`;
}

export function capabilityPreflightError(capabilities: HostCapabilities, codexBin?: string): InstallError {
	const reason = capabilities.concurrency.reason;
	const resolved = resolvedClause(codexBin);
	if (reason === "codex-version-too-old") {
		return new InstallError(
			"LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED",
			`LitCodex requires Codex CLI 0.144.0 or newer; upgrade Codex and rerun install.${resolved}`,
			{ capabilities },
		);
	}
	if (reason === "codex-version-unrecognized") {
		return new InstallError(
			"LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED",
			`Could not determine the Codex CLI version from \`codex --version\` stdout or stderr; verify the Codex executable and rerun install.${resolved}`,
			{ capabilities },
		);
	}
	if (reason === "codex-version-prerelease") {
		return new InstallError(
			"LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED",
			`This Codex CLI build is not a supported stable release; install a stable Codex version and rerun install.${resolved}`,
			{ capabilities },
		);
	}
	if (reason === "host-probe-timeout") {
		return new InstallError(
			"LITCODEX_INSTALL_HOST_PROBE_FAILED",
			`Codex host validation timed out; no install mutation was attempted.${resolved}`,
			{ capabilities },
		);
	}
	// The baseline probe replays the same doctor call with zero LitCodex overrides.
	// When that also fails, the existing Codex configuration on this machine is what
	// the resolved binary cannot load, and LitCodex's managed settings are innocent.
	if (reason === "host-config-incompatible") {
		const detail = capabilities.concurrency.detail;
		const explanation =
			detail === undefined
				? " This usually means that Codex is older than the one that last wrote the configuration."
				: ` Codex reported: ${detail}.`;
		return new InstallError(
			"LITCODEX_INSTALL_HOST_CONFIG_INCOMPATIBLE",
			`The existing Codex configuration on this machine could not be loaded by the Codex that ran, with or without LitCodex settings; no install mutation was attempted.${resolved}${explanation}`,
			{ capabilities },
		);
	}
	return new InstallError(
		"LITCODEX_INSTALL_CONFIG_WRITE_FAILED",
		`Codex strict config rejected LitCodex managed settings; no install mutation was attempted.${resolved}`,
		{ capabilities },
	);
}
