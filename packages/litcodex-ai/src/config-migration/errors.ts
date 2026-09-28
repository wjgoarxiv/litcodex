// M13 — machine-readable migration error + exit-code mapping (S13 errors.ts).
//
// The single throwable shape for the config-migration module. Install mode
// surfaces it; the CLI maps `code` to a distinct exit code so the installer
// (M12) can react. Session-start mode catches and swallows it (exit 0 always).

/** Closed set of failure classes the migration can raise. */
export type CodexConfigMigrationCode =
	| "UNSAFE_MODEL_ROUTE" // exact Luna or sub-high TERRA route is forbidden
	| "CONFIG_MALFORMED" // a config file could not be parsed/migrated safely
	| "CONFIG_UNWRITABLE" // mkdir/writeFile/read failed (permissions, read-only fs)
	| "BACKUP_FAILED" // could not create the pre-write backup
	| "STATE_UNWRITABLE"; // state file write failed (non-fatal in session-start mode)

/** Machine-readable migration error. `code` drives the install-mode exit code. */
export class CodexConfigMigrationError extends Error {
	readonly code: CodexConfigMigrationCode;
	readonly configPath: string | null;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(
		code: CodexConfigMigrationCode,
		message: string,
		configPath: string | null,
		details: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "CodexConfigMigrationError";
		this.code = code;
		this.configPath = configPath;
		this.details = details;
	}
}

/** Install-mode exit code for a migration error (parent Exit-code table). */
export function exitCodeForMigrationError(code: CodexConfigMigrationCode): number {
	switch (code) {
		case "UNSAFE_MODEL_ROUTE":
			return 2;
		case "CONFIG_MALFORMED":
			return 2;
		case "CONFIG_UNWRITABLE":
			return 3;
		case "BACKUP_FAILED":
			return 4;
		case "STATE_UNWRITABLE":
			return 3;
	}
}
