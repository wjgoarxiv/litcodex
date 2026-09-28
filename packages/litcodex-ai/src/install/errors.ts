// M12 / T17 — typed installer error + JSON renderer (S12 §errors.ts).

export const INSTALL_ERROR_CODES = [
	"LITCODEX_INSTALL_CODEX_NOT_FOUND",
	"LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED",
	"LITCODEX_INSTALL_HOST_PROBE_FAILED",
	"LITCODEX_INSTALL_MARKETPLACE_ADD_FAILED",
	"LITCODEX_INSTALL_PLUGIN_ADD_FAILED",
	"LITCODEX_INSTALL_HOOKS_MISSING",
	"LITCODEX_INSTALL_AGENTS_MISSING",
	"LITCODEX_INSTALL_UNSAFE_MODEL_ROUTE",
	"LITCODEX_INSTALL_CONFIG_WRITE_FAILED",
	"LITCODEX_INSTALL_HOST_CONFIG_INCOMPATIBLE",
	"LITCODEX_INSTALL_UNKNOWN_COMMAND",
	"LITCODEX_INSTALL_BAD_FLAG",
] as const;

export type InstallErrorCode = (typeof INSTALL_ERROR_CODES)[number];

export class InstallError extends Error {
	override readonly name = "InstallError";
	readonly code: InstallErrorCode;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(code: InstallErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
		super(message);
		this.code = code;
		this.details = details;
	}
}

export interface InstallErrorEnvelope {
	readonly ok: false;
	readonly error: {
		readonly code: string;
		readonly message: string;
		readonly details: Readonly<Record<string, unknown>>;
	};
}

/** Process exit code for an installer error (S12 §Exit-code table). */
export function exitCodeForInstallError(code: InstallErrorCode): number {
	switch (code) {
		case "LITCODEX_INSTALL_UNKNOWN_COMMAND":
		case "LITCODEX_INSTALL_BAD_FLAG":
			return 1;
		case "LITCODEX_INSTALL_CODEX_NOT_FOUND":
		case "LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED":
		case "LITCODEX_INSTALL_HOST_PROBE_FAILED":
			return 2;
		case "LITCODEX_INSTALL_MARKETPLACE_ADD_FAILED":
		case "LITCODEX_INSTALL_PLUGIN_ADD_FAILED":
		case "LITCODEX_INSTALL_HOOKS_MISSING":
		case "LITCODEX_INSTALL_AGENTS_MISSING":
		case "LITCODEX_INSTALL_UNSAFE_MODEL_ROUTE":
		case "LITCODEX_INSTALL_CONFIG_WRITE_FAILED":
		// Same exit code the incompatible-host-config case already returned when it
		// was misreported as a rejected managed write; only the code name is new.
		case "LITCODEX_INSTALL_HOST_CONFIG_INCOMPATIBLE":
			return 3;
	}
}

/** Machine-readable error envelope (written to stderr alongside a human prefix line). */
export function toErrorJson(err: unknown): InstallErrorEnvelope {
	if (err instanceof InstallError) {
		return { ok: false, error: { code: err.code, message: err.message, details: { ...err.details } } };
	}
	const message = err instanceof Error ? err.message : String(err);
	return { ok: false, error: { code: "LITCODEX_INSTALL_UNKNOWN_COMMAND", message, details: {} } };
}
