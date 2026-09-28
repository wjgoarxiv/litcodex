// Self-contained LitCodex CLI dispatcher. Side-effecting child processes remain
// behind dedicated modules; unknown routes return a plain usage error.
// `dispatch` is pure; `runCli` owns install/config/loop/hook process routes.

import { createRequire } from "node:module";
import { runForegroundAutoUpdate } from "./auto-update.js";
import {
	readEffortChoice,
	readLeadModelChoice,
	readModelChoice,
	readSubagentEffortChoice,
	readSubagentModelChoice,
} from "./cli-model-route.js";
import { acceptedModelIds, FALLBACK_CATALOG } from "./config-migration/catalog.js";
import { runConfigMigrateCli } from "./config-migration/cli.js";
import { resolveCodexHome } from "./install/codex.js";
import { runDoctorCli, runInstallCli, runUninstallCli } from "./install/index.js";
import { managedMarketplaceRoot } from "./install/marketplace.js";
import { motionRuntimeStatus, prepareMotionRuntime, renderMotionRuntime } from "./install/motion-runtime.js";
import { officeRuntimeNotice, officeRuntimeStatus, prepareOfficeRuntime } from "./install/office-runtime.js";
import { buildInstallPlan } from "./install/plan.js";
import { renderInstallPlan } from "./install/render-plan.js";
import { renderBanner, shouldDecorate } from "./ui.js";
import { maybeNotifyAndRefresh } from "./update-check.js";

/** Error code emitted when a subcommand is not in the routing table. */
export const UNKNOWN_COMMAND_CODE = "LITCODEX_INSTALL_UNKNOWN_COMMAND" as const;

/** Router usage code (EX_USAGE) for an unknown `config` sub-subcommand. */
export const CONFIG_USAGE_EXIT_CODE = 64 as const;

/** Outcome of dispatching an argv vector. Pure: no process side effects. */
export interface DispatchResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/** A route handler for the PURE router. Receives args AFTER the subcommand token. */
type RouteHandler = (rest: readonly string[], dryRun: boolean) => DispatchResult;

const manifest = createRequire(import.meta.url)("../package.json") as { version: string };

const ok = (stdout: string): DispatchResult => ({ stdout, stderr: "", exitCode: 0 });

/**
 * Pure dry-run install plan renderer for the synchronous router. Resolves typed options from the
 * process env WITHOUT any spawn or fs write, then renders the ordered LitCodex plan text.
 */
function renderInstallDryRun(rest: readonly string[]): string {
	const codexHome = resolveCodexHome(process.env);
	const plan = buildInstallPlan({
		dryRun: true,
		noTui: rest.includes("--no-tui"),
		autonomous: rest.includes("--codex-autonomous"),
		force: rest.includes("--force"),
		json: rest.includes("--json"),
		yes: rest.includes("--yes"),
		profile: readModelChoice(rest),
		leadModel: readLeadModelChoice(rest),
		effort: readEffortChoice(rest),
		subagentModel: readSubagentModelChoice(rest),
		subagentEffort: readSubagentEffortChoice(rest),
		reconfigure: rest.includes("--reconfigure") || rest.includes("--managed-upgrade"),
		codexHome,
		repoUrl: managedMarketplaceRoot(codexHome),
		repoRoot: process.cwd(),
	});
	return `${renderInstallPlan(plan)}\n`;
}

/**
 * Pure synchronous router. For `install --dry-run` it renders the real plan (pure). For the other
 * side-effecting routes it returns a non-error placeholder (the real work runs in `runCli`), so the
 * routing-level contract (known route ≠ exit 1, no forwarder token) is unit-testable without I/O.
 */
const ROUTES: Readonly<Record<string, RouteHandler>> = {
	install: (rest, dryRun) => (dryRun ? ok(renderInstallDryRun(rest)) : ok("litcodex install\n")),
	doctor: () => ok("litcodex doctor\n"),
	uninstall: () => ok("litcodex uninstall\n"),
	"office-runtime": (rest) =>
		rest[0] === "install" || rest[0] === "status"
			? ok(`litcodex office-runtime ${rest[0]}\n`)
			: { stdout: "", stderr: "Usage: litcodex office-runtime install|status\n", exitCode: 64 },
	"motion-runtime": (rest) =>
		(rest[0] === "install" && rest.slice(1).every((flag) => flag === "--audio" || flag === "--word-timing")) ||
		(rest[0] === "status" && rest.length === 1)
			? ok(`litcodex motion-runtime ${rest.join(" ")}\n`)
			: {
					stdout: "",
					stderr: "Usage: litcodex motion-runtime install [--audio] [--word-timing] | status\n",
					exitCode: 64,
				},
	config: configRouteHandler,
	loop: () => ok("litcodex loop\n"),
	hook: () => ok("litcodex hook\n"),
};

/**
 * Synchronous arm of the `config` route. The real `config migrate` work is async and is run by
 * `runCli` BEFORE `dispatch`; this sync handler only handles routing-level outcomes: an unknown
 * sub-subcommand → usage exit 64; a recognized `config migrate` → exit 0 placeholder.
 */
function configRouteHandler(rest: readonly string[]): DispatchResult {
	if (rest[0] === "migrate") {
		return ok("");
	}
	const sub = rest[0] ?? "<none>";
	return {
		stdout: "",
		stderr: `litcodex config: unknown subcommand "${sub}". Did you mean \`config migrate\`?\n`,
		exitCode: CONFIG_USAGE_EXIT_CODE,
	};
}

const KNOWN_SUBCOMMANDS = Object.keys(ROUTES);

function renderHelp(): string {
	const modelIds = acceptedModelIds().join("|");
	return [
		"litcodex — self-contained LitCodex CLI for Codex",
		"",
		"Usage:",
		"  litcodex install [--dry-run] [options]   Install LitCodex into Codex",
		"  litcodex doctor                          Diagnose the LitCodex install",
		"  litcodex office-runtime install|status   Prepare or inspect Office dependencies",
		"  litcodex motion-runtime install|status   Prepare or inspect film renderer dependencies",
		"  Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.",
		"  litcodex uninstall                       Remove LitCodex from Codex",
		"  litcodex config migrate                  Migrate Codex config for LitCodex",
		"  litcodex loop <sub>                      Run a Lit-Loop subcommand",
		"  litcodex hook user-prompt-submit         Run the UserPromptSubmit hook",
		"  litcodex --dry-run <command>             Resolve a command without applying it",
		"  litcodex --help                          Show this help",
		"  litcodex --version                       Show the @litfamily/litcodex version",
		"",
		"Install model options:",
		`  --model <${modelIds}> Select the LEAD model (default: ${FALLBACK_CATALOG.current.model})`,
		"  --effort <low|medium|high|xhigh|max|ultra> Select LEAD reasoning effort (catalog validated)",
		`  --subagent-model <${modelIds}> Select the helper route (default: ${FALLBACK_CATALOG.roles["default"]?.model ?? FALLBACK_CATALOG.current.model})`,
		"  --subagent-effort <low|medium|high|xhigh|max|ultra> Select helper effort (catalog validated)",
		"  --yes                                    Keep defaults; never prompt",
		"  --reconfigure                           Explicitly apply the choice to the root model/effort",
		"  --no-auto-update                        Skip the foreground update barrier for this command",
		"",
		"Examples:",
		"  litcodex install",
		"  litcodex doctor",
		"  litcodex --dry-run install --no-tui",
		"",
	].join("\n");
}

function renderUnknown(subcommand: string): DispatchResult {
	const usage = [
		`${UNKNOWN_COMMAND_CODE}: unknown subcommand "${subcommand}".`,
		`Known subcommands: ${KNOWN_SUBCOMMANDS.join(", ")}.`,
		"Run `litcodex --help` for usage.",
		"",
	].join("\n");
	return { stdout: "", stderr: usage, exitCode: 1 };
}

function writeCliBanner(argv: readonly string[]): void {
	if (argv.includes("--json") || argv.includes("--no-tui")) return;
	process.stdout.write(
		renderBanner({
			version: manifest.version,
			color:
				shouldDecorate({
					isTty: Boolean((process.stdout as NodeJS.WriteStream).isTTY),
					env: process.env,
					noTui: argv.includes("--no-tui"),
					json: argv.includes("--json"),
				}) && !argv.includes("--dry-run"),
		}),
	);
}

/**
 * Pure dispatcher. Parses argv (already sliced past `node bin`), strips the position-independent
 * `--dry-run` flag, answers `--help`/`--version` locally, and routes the first non-flag token.
 * Unknown token → exit 1. No process spawns. No forwarding.
 */
export function dispatch(argv: readonly string[]): DispatchResult {
	const dryRun = argv.includes("--dry-run");
	const rest = argv.filter((token) => token !== "--dry-run");

	if (rest.includes("--help") || rest.includes("-h")) {
		return ok(renderHelp());
	}
	if (rest.includes("--version") || rest.includes("-v")) {
		return ok(`${manifest.version}\n`);
	}

	const subcommand = rest[0];
	if (subcommand === undefined) {
		return ok(renderHelp());
	}

	const handler = ROUTES[subcommand];
	if (handler === undefined) {
		return renderUnknown(subcommand);
	}
	return handler(rest.slice(1), dryRun);
}

/**
 * Async process entry used by `bin/litcodex.js`. It owns the side-effecting routes: install/doctor/
 * uninstall (install/* modules, which are the ONLY code that ever spawns `codex`), `config migrate`
 * (M13, in-process), and the bundled `@litcodex/lit-loop` runtime routes `loop`/`hook`. Returns the
 * integer exit code; the bin owns `process.exit`. No forwarding, no exec-wrapper, no harness.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
	const dryRun = argv.includes("--dry-run");
	const rest = argv.filter((token) => token !== "--dry-run");
	const head = rest[0];
	const isHelp = rest.includes("--help") || rest.includes("-h");
	const isVersion = rest.includes("--version") || rest.includes("-v");

	if (!isHelp && !isVersion) {
		if (head === "config" && rest[1] === "migrate") {
			const passthrough = dryRun ? [...rest.slice(2), "--dry-run"] : rest.slice(2);
			if (!passthrough.includes("--session-start")) writeCliBanner(passthrough);
			return runConfigMigrateCli(passthrough);
		}

		if (head === "install") {
			// Preserve position-independent --dry-run: pass the args after `install`, re-injecting
			// --dry-run (which `rest` already stripped) so the flag survives regardless of position.
			const installArgs = dryRun ? [...rest.slice(1), "--dry-run"] : rest.slice(1);
			const exitCode = await runInstallCli(installArgs);
			const barrierExitCode = notifyAfterManagementCommand("install", argv, exitCode);
			return barrierExitCode ?? exitCode;
		}
		if (head === "doctor") {
			const exitCode = runDoctorCli(rest.slice(1));
			const barrierExitCode = notifyAfterManagementCommand("doctor", argv, exitCode);
			return barrierExitCode ?? exitCode;
		}
		if (head === "office-runtime") {
			const mode = rest[1];
			if (mode !== "install" && mode !== "status") return dispatchExit(dispatch(argv));
			const codexHome = resolveCodexHome(process.env);
			const result = mode === "install" ? prepareOfficeRuntime(codexHome) : officeRuntimeStatus(codexHome);
			process.stdout.write(`${officeRuntimeNotice(result.ready)}\n`);
			return result.ready ? 0 : mode === "install" ? 3 : 4;
		}
		if (head === "motion-runtime") {
			const mode = rest[1];
			const flags = rest.slice(2);
			const valid =
				(mode === "install" && flags.every((flag) => flag === "--audio" || flag === "--word-timing")) ||
				(mode === "status" && flags.length === 0);
			if (!valid) return dispatchExit(dispatch(argv));
			const codexHome = resolveCodexHome(process.env);
			if (mode === "install") {
				const result = prepareMotionRuntime(codexHome, flags);
				process.stdout.write(
					`${result.output}${renderMotionRuntime(result.status)}\n[litcodex] ${result.receipt}\n`,
				);
				return result.exitCode === 0 ? 0 : result.exitCode === 14 ? 14 : 3;
			}
			const report = motionRuntimeStatus(codexHome);
			process.stdout.write(`${renderMotionRuntime(report)}\n`);
			return report.ready ? 0 : 4;
		}
		if (head === "uninstall") {
			return runUninstallCli(rest.slice(1));
		}
		if (head === "loop") {
			const { loopCommand } = await import("@litcodex/lit-loop/dist/loop-cli.js");
			return loopCommand(rest.slice(1), { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin });
		}
		if (head === "hook") {
			if (rest[1] !== "user-prompt-submit" && rest[1] !== "stop") {
				return dispatchExit(renderUnknown(rest[1] ?? "hook"));
			}
			const hooks = await import("@litcodex/lit-loop/dist/hook-cli.js");
			return rest[1] === "stop"
				? hooks.runStopPlanPersistenceHookCli(process.stdin, process.stdout, process.stderr)
				: hooks.runUserPromptSubmitHookCli(process.stdin, process.stdout, process.stderr);
		}
	}

	// The human-facing dispatcher routes get the same banner as install/doctor/uninstall. Machine
	// routes return above so their JSON/additionalContext protocols remain byte-for-byte intact.
	const result = dispatch(argv);
	const exitCode = dispatchExit(result);
	if (!isVersion && result.exitCode === 0 && result.stdout.length > 0) {
		writeCliBanner(argv);
	}
	return exitCode;
}

/** Update notices run only after a successful management command has completed. */
function notifyAfterManagementCommand(
	command: "install" | "doctor",
	argv: readonly string[],
	exitCode: number,
): number | undefined {
	const gate = {
		current: manifest.version,
		command,
		argv,
		exitCode,
		stdinTty: Boolean((process.stdin as NodeJS.ReadStream).isTTY),
		stdoutTty: Boolean((process.stdout as NodeJS.WriteStream).isTTY),
		stderrTty: Boolean((process.stderr as NodeJS.WriteStream).isTTY),
		env: process.env,
	};
	const foregroundReceipt = runForegroundAutoUpdate({
		...gate,
		current: manifest.version,
		stderr: process.stderr,
	});
	maybeNotifyAndRefresh({
		...gate,
		current: manifest.version,
		stderr: process.stderr,
	});
	if (foregroundReceipt?.status === "unknown-state" || foregroundReceipt?.status === "failed") return 3;
	return undefined;
}

/** Write a pure dispatch result to the process streams and return its exit code. */
function dispatchExit(result: DispatchResult): number {
	if (result.stdout) {
		process.stdout.write(result.stdout);
	}
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	return result.exitCode;
}
