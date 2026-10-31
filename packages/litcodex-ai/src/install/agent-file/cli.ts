// `litcodex agent-file` routes: the project section writer, the install-time consent
// step, and the `config agentFile` switch. None of them spawns a child process.

import { statSync } from "node:fs";
import { join, resolve } from "node:path";

import { applyInstructionFile, instructionFileState } from "./apply.js";
import {
	ATTRIBUTION_MODES,
	type AttributionMode,
	readAttributionMode,
	storedAttributionMode,
	writeAttributionMode,
} from "./attribution.js";
import { AGENT_FILE_ID, AGENT_FILE_MODES, type AgentFileMode, globalBody, projectBody } from "./bodies.js";
import { readAgentFileMode, writeAgentFileMode } from "./mode.js";

/** One `AGENT_FILE:` status line for an apply result. */
export const agentFileLine = (result: { status: string; path: string; backup?: string }): string =>
	`AGENT_FILE: ${result.status} ${result.path}${result.backup ? ` (backup: ${result.backup})` : ""}`;

/** The global instruction file for one Codex home. */
export const agentFilePath = (codexHome: string): string => join(codexHome, "AGENTS.md");

/** The question an interactive install asks before touching the global file. */
export const AGENT_FILE_QUESTION =
	"Add the short LitFamily block to your global AGENTS.md? Your own text stays as it is. [Y/n] ";

/** The one extra question an interactive install asks once, right after the block is accepted. */
export const ATTRIBUTION_QUESTION =
	"Also add one line asking the model not to add AI attribution to commits or pull requests? [y/N] ";

/** What a dry run says about the section instead of writing it. */
export const agentFileDryRunLine = (codexHome: string): string =>
	`Would add the LitFamily block to ${agentFilePath(codexHome)} (asks first; --yes adds it, --no-agent-file skips)`;

/**
 * `litcodex agent-file project [--dir <path>]`: the project section in the repo's
 * `AGENTS.md`. No backup copy here: in a repo it would sit untracked beside
 * `AGENTS.md` and could be committed. A mistyped `--dir` is never created.
 */
export const runAgentFileProjectCli = (
	rest: readonly string[],
	deps: { cwd: string; out: NodeJS.WritableStream; err: NodeJS.WritableStream; version: string },
): number => {
	const [sub, ...args] = rest;
	if (sub === "--help" || sub === "-h") {
		deps.out.write("Usage: litcodex agent-file project [--dir <path>]\n");
		return 0;
	}
	if (sub !== "project") {
		deps.err.write("Usage: litcodex agent-file project [--dir <path>]\n");
		return 64;
	}
	let dir = deps.cwd;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--dir" && args[index + 1]) {
			dir = resolve(deps.cwd, args[index + 1] as string);
			index += 1;
			continue;
		}
		deps.err.write(`Unknown agent-file option: ${args[index]}\n`);
		return 64;
	}
	let isDirectory = false;
	try {
		isDirectory = statSync(dir).isDirectory();
	} catch {
		// Missing: reported below, never created.
	}
	if (!isDirectory) {
		deps.err.write(`agent-file: ${dir} is not an existing folder\n`);
		return 64;
	}
	const agents = applyInstructionFile({
		path: join(dir, "AGENTS.md"),
		id: AGENT_FILE_ID,
		version: deps.version,
		body: projectBody(),
		action: "install",
		backup: false,
		createParent: false,
	});
	deps.out.write(`${agentFileLine(agents)}\n`);
	return agents.status.startsWith("refused") ? 1 : 0;
};

/** Writes or refreshes the global section; returns the printed `AGENT_FILE:` line. */
export const writeGlobalAgentFile = (
	codexHome: string,
	version: string,
	attribution: AttributionMode = "keep",
): string =>
	agentFileLine(
		applyInstructionFile({
			path: agentFilePath(codexHome),
			id: AGENT_FILE_ID,
			version,
			body: globalBody({ attribution }),
			action: "install",
		}),
	);

/** Removes the global section; returns the printed `AGENT_FILE:` line. */
export const removeGlobalAgentFile = (codexHome: string, version: string): string =>
	agentFileLine(
		applyInstructionFile({
			path: agentFilePath(codexHome),
			id: AGENT_FILE_ID,
			version,
			body: globalBody(),
			action: "uninstall",
		}),
	);

/**
 * The install-time consent step. `--yes` writes; the skip flag and the stored `off`
 * mode leave the file alone; without a prompt a non-interactive install only says how
 * to add the section, and never stores a mode. The caller passes `prompt` only for a
 * genuinely interactive install (TTY, not `--no-tui`/`--json`, no CI).
 */
export const runInstallAgentFile = async (options: {
	env: NodeJS.ProcessEnv;
	stdout: NodeJS.WritableStream;
	codexHome: string;
	version: string;
	yes: boolean;
	noAgentFile: boolean;
	dryRun: boolean;
	/** Machine-readable install: return the line for the JSON report, write nothing to stdout. */
	json?: boolean;
	prompt?: () => Promise<boolean>;
	/** Asked once, only after the block is accepted and no attribution choice is stored yet. */
	attributionPrompt?: () => Promise<boolean>;
}): Promise<string> => {
	const say = (line: string): string => {
		if (options.json !== true) options.stdout.write(`${line}\n`);
		return line;
	};
	const path = agentFilePath(options.codexHome);
	if (options.noAgentFile || readAgentFileMode({ env: options.env, codexHome: options.codexHome }) === "off") {
		return say(`AGENT_FILE: off (${path} left as it is; turn on: litcodex config agentFile on)`);
	}
	const state = instructionFileState({ path, id: AGENT_FILE_ID, version: options.version });
	if (state === "symlink" || state === "not-file" || state === "not-utf8") {
		return say(`AGENT_FILE: ${state} ${path}; left as it is`);
	}
	if (options.dryRun) return say(agentFileDryRunLine(options.codexHome));
	const attribution = (): AttributionMode => readAttributionMode({ env: options.env, codexHome: options.codexHome });
	if (options.yes) return say(writeGlobalAgentFile(options.codexHome, options.version, attribution()));
	if (options.prompt === undefined) {
		return say(`AGENT_FILE: skipped (add the LitFamily block to ${path}: litcodex config agentFile on)`);
	}
	const confirmed = await options.prompt();
	if (!confirmed) {
		writeAgentFileMode(options.codexHome, "off");
		return say("AGENT_FILE: off (turn on later: litcodex config agentFile on)");
	}
	if (options.attributionPrompt !== undefined && storedAttributionMode(options.codexHome) === undefined) {
		writeAttributionMode(options.codexHome, (await options.attributionPrompt()) ? "off" : "keep");
	}
	return say(writeGlobalAgentFile(options.codexHome, options.version, attribution()));
};

/** `litcodex config agentFile <on|off>`: the switch acts at once on the global file. */
export const runConfigAgentFileCli = (
	rest: readonly string[],
	deps: {
		env: NodeJS.ProcessEnv;
		out: NodeJS.WritableStream;
		err: NodeJS.WritableStream;
		codexHome: string;
		version: string;
	},
): number => {
	const [mode] = rest;
	if (!(AGENT_FILE_MODES as readonly string[]).includes(mode as string) || rest.length !== 1) {
		deps.err.write(
			`litcodex config agentFile: unknown subcommand "${rest[0] ?? "<none>"}". Usage: litcodex config agentFile <on|off>\n`,
		);
		return 64;
	}
	try {
		writeAgentFileMode(deps.codexHome, mode as AgentFileMode);
	} catch (error) {
		deps.err.write(`litcodex config agentFile: ${(error as Error).message}\n`);
		return 3;
	}
	const line =
		mode === "off"
			? removeGlobalAgentFile(deps.codexHome, deps.version)
			: writeGlobalAgentFile(
					deps.codexHome,
					deps.version,
					readAttributionMode({ env: deps.env, codexHome: deps.codexHome }),
				);
	deps.out.write(`agentFile ${(mode as string).padEnd(5)} (${AGENT_FILE_MODES.join(", ")})\n`);
	deps.out.write(`${line}\n`);
	return 0;
};

/**
 * `litcodex config attribution <keep|off>`. `off` stores the choice and, when the block is already in the
 * global AGENTS.md, adds the request line to it; `keep` takes the line out again. Nothing here writes
 * config.toml, and the output says why the line cannot be a guarantee.
 */
export const runConfigAttributionCli = (
	rest: readonly string[],
	deps: {
		env: NodeJS.ProcessEnv;
		out: NodeJS.WritableStream;
		err: NodeJS.WritableStream;
		codexHome: string;
		version: string;
	},
): number => {
	const [mode] = rest;
	if (!(ATTRIBUTION_MODES as readonly string[]).includes(mode as string) || rest.length !== 1) {
		deps.err.write(
			`litcodex config attribution: unknown subcommand "${rest[0] ?? "<none>"}". Usage: litcodex config attribution <keep|off>\n`,
		);
		return 64;
	}
	try {
		writeAttributionMode(deps.codexHome, mode as AttributionMode);
	} catch (error) {
		deps.err.write(`litcodex config attribution: ${(error as Error).message}\n`);
		return 3;
	}
	deps.out.write(`attribution ${(mode as string).padEnd(5)} (${ATTRIBUTION_MODES.join(", ")})\n`);
	const state = instructionFileState({
		path: agentFilePath(deps.codexHome),
		id: AGENT_FILE_ID,
		version: deps.version,
	});
	if (state.startsWith("present") || state.startsWith("stale")) {
		deps.out.write(
			`${writeGlobalAgentFile(deps.codexHome, deps.version, readAttributionMode({ env: deps.env, codexHome: deps.codexHome }))}\n`,
		);
	} else {
		deps.out.write(
			`The global AGENTS.md has no LitFamily block (${state}), so the line is applied the next time the LitFamily block is written (litcodex config agentFile on).\n`,
		);
	}
	deps.out.write(
		"Codex adds its own Co-authored-by trailer and pull request line from an account setting in your ChatGPT settings, not from config.toml, and LitCodex never writes config.toml for this. The line in the block is a request to the model, not a guarantee.\n",
	);
	return 0;
};
