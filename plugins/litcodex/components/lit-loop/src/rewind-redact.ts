// src/rewind-redact.ts — redaction for every string the lit-adhd collector emits.
//
// Credential shapes and URI userinfo come from the shared set in redaction.ts; `NAME=value` pairs with a
// secret-like name lose their value; any substring equal to a current environment value of eight or more
// characters is replaced (compared here, never printed); the home directory becomes `~`. Path-shaped and
// locale or terminal values are not credentials and stay, or every path in the brief would be blanked.

import { REDACTED_SECRET, redactSecrets } from "./redaction.js";

export const REWIND_MASK = "[redacted]";

const SECRET_NAME = /KEY|TOKEN|SECRET|PASS|AUTH|COOKIE/iu;
const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"'`]+)/gu;
const PLAIN_ENV_NAMES =
	/^(?:PATH|HOME|PWD|OLDPWD|SHELL|USER|LOGNAME|LANG|LANGUAGE|TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|COLORTERM|EDITOR|VISUAL|PAGER|TMPDIR|SHLVL|LC_[A-Z]+|XPC_[A-Z_]+|__CF[A-Z_]*|COMMAND_MODE|_)$/u;

/** Environment values that could be credentials, longest first so a value inside another is not split. */
function envSecrets(env: NodeJS.ProcessEnv): string[] {
	return Object.entries(env)
		.filter(
			([name, value]) =>
				typeof value === "string" &&
				value.length >= 8 &&
				!PLAIN_ENV_NAMES.test(name) &&
				!/^[~/]/u.test(value) &&
				!value.includes(":/") &&
				!/^(?:true|false|\d+)$/iu.test(value),
		)
		.map(([, value]) => value as string)
		.sort((a, b) => b.length - a.length);
}

/** A redactor bound to one environment and home, so the environment scan happens once per run. */
export function makeRedactor(env: NodeJS.ProcessEnv, home: string | null): (input: string) => string {
	const values = envSecrets(env);
	return (input) => {
		if (input === "") return input;
		let text = input;
		for (const value of values) if (text.includes(value)) text = text.split(value).join(REWIND_MASK);
		text = text.replace(ASSIGNMENT, (match, name: string) =>
			SECRET_NAME.test(name) ? `${name}=${REWIND_MASK}` : match,
		);
		text = redactSecrets(text).split(REDACTED_SECRET).join(REWIND_MASK);
		if (home !== null && home.length > 1) text = text.split(home).join("~");
		return text;
	};
}
