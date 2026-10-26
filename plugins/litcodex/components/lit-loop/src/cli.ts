#!/usr/bin/env node
// src/cli.ts — M06-owned component bin dispatcher (A2 §3/§6.4, A3 addendum A1).
//
// Bin `litcodex-lit-loop` → dist/cli.js, the target the aggregate hooks.json invokes. Knows four route
// prefixes — `hook`, `loop`, `rewind` and `stage` — and NO `config` route (config migration is
// owned by the separate litcodex-ai installer bin, not this dispatcher).
//
// Exit-code table (A3 addendum A1.2):
//   0  — route ran to completion (hook activation / hook no-op / a loop subcommand that succeeded)
//   1  — DISPATCHER unknown command (argv[2] not `hook`/`loop`, or `hook` with a second token
//         ≠ user-prompt-submit, or `loop` with an unknown subcommand). Plain-text stderr, no JSON.
//   2  — M06 hook route malformed/oversized stdin (LitHookError JSON on stderr; owned by hook-cli).
//   3/4/5 — M09 loop route (ships at T14).
//
// `main` NEVER calls process.exit (the shebang wrapper does); it resolves exactly one integer, so
// the dispatcher is unit-testable with an injected argv array.

import {
	runPostCompactHookCli,
	runPostToolUseLiveHookCli,
	runPreToolUseCreateGoalGuardCli,
	runPreToolUseLiveHookCli,
	runSessionStartHookCli,
	runStopPlanPersistenceHookCli,
	runSubagentHookCli,
	runUserPromptSubmitHookCli,
} from "./hook-cli.js";
import { loopCommand } from "./loop-cli.js";
import { rewindCommand, stageCommand } from "./rewind-cli.js";

const UNKNOWN_COMMAND = "lit-loop: unknown command\n";

/**
 * Dispatch one argv vector to a route and resolve its exit code. Pure of process.exit; writes only
 * to the injected streams.
 */
export async function main(
	argv: readonly string[],
	stdin: NodeJS.ReadableStream,
	stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
): Promise<number> {
	const command = argv[2];
	const subcommand = argv[3];

	if (command === "hook") {
		if (subcommand === "user-prompt-submit") return runUserPromptSubmitHookCli(stdin, stdout, stderr);
		if (subcommand === "pre-tool-use") return runPreToolUseCreateGoalGuardCli(stdin, stdout, stderr);
		if (subcommand === "stop") return runStopPlanPersistenceHookCli(stdin, stdout, stderr);
		if (subcommand === "session-start") return runSessionStartHookCli(stdin, stdout, stderr);
		if (subcommand === "post-compact") return runPostCompactHookCli(stdin, stdout, stderr);
		if (subcommand === "pre-tool-use-live") return runPreToolUseLiveHookCli(stdin, stdout, stderr);
		if (subcommand === "post-tool-use-live") return runPostToolUseLiveHookCli(stdin, stdout, stderr);
		if (subcommand === "subagent-start") return runSubagentHookCli("start", stdin);
		if (subcommand === "subagent-stop") return runSubagentHookCli("stop", stdin);
		stderr.write(UNKNOWN_COMMAND);
		return 1;
	}

	if (command === "loop") {
		// T14: route to M09's loopCommand (argv past `loop`); it resolves one exit code (0/1/2/3/4/5)
		// and never calls process.exit. The `doctor` subcommand is still the M09 stub until M11/T16.
		return loopCommand(argv.slice(3), { stdout, stderr, stdin });
	}

	// `rewind` prints the lit-adhd brief data; `stage` records the stage and k/n of the work on top of the stack.
	if (command === "rewind") return rewindCommand(argv.slice(3), { stdout, stderr });
	if (command === "stage") return stageCommand(argv.slice(3), { stdout, stderr });

	stderr.write(UNKNOWN_COMMAND);
	return 1;
}

main(process.argv, process.stdin, process.stdout, process.stderr).then((code) => {
	process.exit(code);
});
