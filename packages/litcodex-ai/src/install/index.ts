// M12 / T17 — installer barrel + process-facing route entrypoints (S12 §cli routes).
//
// These are the functions the top-level dispatcher (src/cli.ts) calls for the `install`/`doctor`/
// `uninstall` routes. They own the ONE real default `spawn` (always `codex`, never an exec-wrapper), parse
// argv into typed `InstallOptions`, and return an integer exit code. `--dry-run` returns BEFORE any
// spawn or fs write (renders the plan only). Unknown/bad flags exit 1.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import readline from "node:readline/promises";
import { migrateCodexConfig, readLitCodexOutputStyleId } from "../config-migration/index.js";
import {
	humanLabel,
	preflightLabel,
	renderBanner,
	renderInstallFailure,
	renderInstallReceipt,
	renderPreflightIntro,
	renderStepIntro,
	renderStepResult,
	Spinner,
	shouldDecorate,
} from "../ui.js";
import { codexSpawnInvocation, type ReadonlyFsLike, resolveCodexHome, type SpawnLike } from "./codex.js";
import { renderDoctorText, runDoctor } from "./doctor.js";
import { exitCodeForInstallError, InstallError, toErrorJson } from "./errors.js";
import { type ExecuteDeps, executeInstallPlan } from "./execute.js";
import { listPayloadEntries, readRegularFileBuffer } from "./file-walk.js";
import { promptModelRoute, renderModelRouteSummary, waitForModelRouteConfirmation } from "./install-model-prompt.js";
import type { OutputStyleId } from "./install-options.js";
import { hasExplicitModelRouteFlags, parseInstallOptions } from "./install-options.js";
import { renderPlainInstallResult } from "./install-output.js";
import { motionRuntimeStatus, prepareMotionRuntime, renderMotionRuntime } from "./motion-runtime.js";
import { officeRuntimeNotice, officeRuntimeStatus, prepareOfficeRuntime } from "./office-runtime.js";
import { type MarketplaceSource, resolveBundledMarketplaceSource } from "./package-root.js";
import { buildInstallPlan } from "./plan.js";
import { renderInstallPlan } from "./render-plan.js";
import { createBlockingSpinnerMotion } from "./spinner-motion.js";
import type { InstallOptions, InstallResult } from "./types.js";
import { runUninstall } from "./uninstall.js";

export { renderDoctorText, runDoctor } from "./doctor.js";
export { INSTALL_ERROR_CODES, InstallError, toErrorJson } from "./errors.js";
export { executeInstallPlan } from "./execute.js";
export { renderCapability } from "./install-output.js";
export { buildInstallPlan } from "./plan.js";
export { INSTALL_PLAN_HEADER, renderInstallPlan } from "./render-plan.js";
export type { DoctorReport, InstallOptions, InstallResult, InstallStep } from "./types.js";

/** Process IO sink (injectable for tests; defaults to the real process streams). */
export interface RouteIo {
	readonly stdout: NodeJS.WritableStream;
	readonly stderr: NodeJS.WritableStream;
	readonly env: NodeJS.ProcessEnv;
	readonly repoRoot: string;
}

/** The real default spawn: argv array, with Windows script shims routed through ComSpec. */
const realSpawn: SpawnLike = (cmd, args, opts) => {
	const invocation = codexSpawnInvocation(cmd, args, opts.env ?? process.env);
	const res = spawnSync(invocation.command, [...invocation.args], {
		stdio: opts.stdio,
		encoding: "utf8",
		timeout: opts.timeout,
		shell: invocation.shell,
		windowsVerbatimArguments: invocation.windowsVerbatimArguments || opts.windowsVerbatimArguments === true,
		...(opts.env === undefined ? {} : { env: opts.env }),
		...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
	});
	const out: { status: number | null; error?: Error; stdout?: string; stderr?: string } = {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
	};
	if (res.error) {
		out.error = res.error;
	}
	return out;
};

const realFs: ReadonlyFsLike = {
	existsSync,
	readFileSync: (p, enc) => readFileSync(p, enc),
	readFileBufferSync: readRegularFileBuffer,
	listFilesRecursive: listPayloadEntries,
};

const realWriteFs = {
	existsSync,
	mkdirSync: (p: string, o: { recursive: true }) => {
		mkdirSync(p, o);
	},
	readdirSync: (p: string) => readdirSync(p) as string[],
	readFileSync: (p: string, e: "utf8") => readFileSync(p, e),
	writeFileSync: (p: string, d: string) => {
		writeFileSync(p, d);
	},
};

function defaultIo(): RouteIo {
	return {
		stdout: process.stdout,
		stderr: process.stderr,
		env: process.env,
		repoRoot: process.cwd(),
	};
}

const STYLE_MENU = [
	{ styleId: "off" as OutputStyleId, label: "None / keep current", hint: "Leave output style unchanged" },
	{ styleId: "asd-ste100" as OutputStyleId, label: "ASD-STE100 (English)", hint: "Simplified Technical English" },
	{
		styleId: "asd-ste100-ko" as OutputStyleId,
		label: "ASD-STE100 (한국어)",
		hint: "Simplified Technical English (Korean)",
	},
	{ styleId: "eli5" as OutputStyleId, label: "ELI5 (English)", hint: "Explain Like I'm 5" },
	{ styleId: "eli5-ko" as OutputStyleId, label: "ELI5 (한국어)", hint: "ELI5 (Korean)" },
] as const;

const PACKAGE_VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;

function formatStyleChoice(index: number, label: string, hint: string): string {
	return `  ${String(index).padStart(2, " ")}. ${label} - ${hint}`;
}

async function chooseStyleIndex(
	rl: readline.Interface,
	stdout: NodeJS.WritableStream,
	defaultIndex: number,
): Promise<number> {
	stdout.write("\nChoose an output style for LitCodex responses.\n");
	for (const [i, choice] of STYLE_MENU.entries()) {
		stdout.write(`${formatStyleChoice(i, choice.label, choice.hint)}\n`);
	}
	const answer = (
		(await rl.question(`Select 0-${String(STYLE_MENU.length - 1)} [${String(defaultIndex)}]: `)) ?? ""
	).trim();
	if (answer.length === 0) return defaultIndex;
	const selected = Number.parseInt(answer, 10);
	if (Number.isInteger(selected) && selected >= 0 && selected < STYLE_MENU.length) return selected;
	throw new InstallError("LITCODEX_INSTALL_BAD_FLAG", `Invalid style selection: ${answer}`, { flag: "--style" });
}

function interactiveInstall(opts: InstallOptions, io: RouteIo): boolean {
	const isTTY = process.stdin.isTTY === true && Boolean((io.stdout as NodeJS.WriteStream).isTTY);
	return isTTY && !opts.noTui && !opts.json && !opts.yes && !opts.dryRun && io.env["CI"] === undefined;
}

function installReadline(opts: InstallOptions, io: RouteIo): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: io.stdout,
		// Plain prompts must not re-enable readline's cursor escapes just because stdout is a TTY.
		terminal: shouldDecorate({
			isTty: Boolean((io.stdout as NodeJS.WriteStream).isTTY),
			env: io.env,
			noTui: opts.noTui,
			json: opts.json,
		}),
	});
}

/**
 * Contract §Prompt order: lead model+effort then helper model+effort, before the product's own
 * style prompt. Skipped (defaults kept) for --yes, non-TTY, --json, --no-tui, CI, or any explicit
 * model-route flag. Returns the (possibly updated) options plus whether prompting happened.
 */
async function promptModelRouteIfNeeded(
	args: readonly string[],
	opts: InstallOptions,
	io: RouteIo,
): Promise<{ readonly opts: InstallOptions; readonly prompted: boolean }> {
	if (!interactiveInstall(opts, io) || hasExplicitModelRouteFlags(args)) {
		return { opts, prompted: false };
	}
	const rl = installReadline(opts, io);
	try {
		const route = await promptModelRoute(rl, io.stdout);
		return {
			opts: {
				...opts,
				profile: route.profile,
				leadModel: route.leadModel,
				effort: route.effort,
				subagentModel: route.subagentModel,
				subagentEffort: route.subagentEffort,
			},
			prompted: true,
		};
	} finally {
		rl.close();
	}
}

/** Contract §Summary card: print the route and wait for Enter before the first write. */
async function confirmModelRouteSummary(opts: InstallOptions, io: RouteIo, color: boolean): Promise<void> {
	io.stdout.write(renderModelRouteSummary(opts, opts.codexHome));
	const rl = installReadline(opts, io);
	try {
		await waitForModelRouteConfirmation(rl, color);
	} finally {
		rl.close();
	}
}

async function promptOutputStyleIfNeeded(opts: InstallOptions, io: RouteIo): Promise<OutputStyleId | undefined> {
	if (opts.style !== undefined) return opts.style as OutputStyleId;
	if (!interactiveInstall(opts, io)) return undefined;

	let currentStyleId: string | undefined;
	try {
		const configContent = readFileSync(join(opts.codexHome, "config.toml"), "utf8");
		currentStyleId = readLitCodexOutputStyleId(configContent);
	} catch {
		// config absent or unreadable — leave default at 0
	}
	const defaultIndex =
		currentStyleId !== undefined
			? Math.max(
					0,
					STYLE_MENU.findIndex((m) => m.styleId === currentStyleId),
				)
			: 0;

	const rl = installReadline(opts, io);
	try {
		const index = await chooseStyleIndex(rl, io.stdout, defaultIndex);
		return STYLE_MENU[index]?.styleId ?? "off";
	} finally {
		rl.close();
	}
}

function emitError(io: RouteIo, err: unknown): number {
	const json = toErrorJson(err);
	io.stderr.write(`${JSON.stringify(json)}\n`);
	io.stderr.write(`[litcodex] ${json.error.message}\n`);
	return err instanceof InstallError ? exitCodeForInstallError(err.code) : 1;
}

function writeCommandBanner(io: RouteIo, args: readonly string[]): void {
	if (args.includes("--json") || args.includes("--no-tui")) return;
	io.stdout.write(
		renderBanner({
			version: PACKAGE_VERSION,
			env: io.env,
			color:
				shouldDecorate({
					isTty: Boolean((io.stdout as NodeJS.WriteStream).isTTY),
					env: io.env,
					noTui: args.includes("--no-tui"),
					json: args.includes("--json"),
				}) && !args.includes("--dry-run"),
		}),
	);
}

/** `litcodex install [flags]` — render plan (dry-run) or execute against `codex`. */
export async function runInstallCli(args: readonly string[], io: RouteIo = defaultIo()): Promise<number> {
	let opts: InstallOptions;
	try {
		opts = parseInstallOptions(args, io);
	} catch (err) {
		return emitError(io, err instanceof Error ? err : new Error(String(err)));
	}

	const decorate = shouldDecorate({
		isTty: Boolean((io.stdout as NodeJS.WriteStream).isTTY),
		env: io.env,
		noTui: opts.noTui,
		json: opts.json,
	});
	const banner =
		!opts.json && !opts.noTui
			? renderBanner({ version: PACKAGE_VERSION, env: io.env, color: decorate && !opts.dryRun })
			: "";
	if (banner) io.stdout.write(banner);

	let prompted = false;
	let effectiveStyle: OutputStyleId | undefined;
	try {
		const routePrompt = await promptModelRouteIfNeeded(args, opts, io);
		opts = routePrompt.opts;
		prompted = routePrompt.prompted;
		effectiveStyle = await promptOutputStyleIfNeeded(opts, io);
		if (prompted) await confirmModelRouteSummary(opts, io, decorate);
	} catch (err) {
		return emitError(io, err instanceof Error ? err : new Error(String(err)));
	}

	const plan = buildInstallPlan(opts);

	if (opts.dryRun) {
		// ZERO spawns, ZERO fs writes: render and return.
		io.stdout.write(`${renderInstallPlan(plan)}\n`);
		return 0;
	}

	let result: InstallResult;
	let activeSpinner: Spinner | undefined;
	let activityPending = false;
	let marketplaceSource: MarketplaceSource | undefined;
	try {
		if (!args.includes("--repo")) marketplaceSource = resolveBundledMarketplaceSource();
		const executeDeps: ExecuteDeps = {
			spawn: realSpawn,
			fs: realFs,
			env: io.env,
			now: () => Date.now(),
			repoRoot: io.repoRoot,
			migrateConfig: migrateCodexConfig,
			force: opts.force,
			codexHome: opts.codexHome,
			writeFs: realWriteFs,
			profile: opts.profile,
			leadModel: opts.leadModel,
			effort: opts.effort,
			subagentModel: opts.subagentModel,
			subagentEffort: opts.subagentEffort,
			...(effectiveStyle === undefined ? {} : { style: effectiveStyle }),
			reconfigure: opts.reconfigure,
			enforceCapabilityPreflight: true,
			...(decorate ? {} : { onWarning: (message: string) => io.stderr.write(`Warning: ${message}\n`) }),
			...(marketplaceSource === undefined ? {} : { marketplaceSourceDir: marketplaceSource.root }),
		};
		if (decorate) {
			io.stdout.write(`${renderPreflightIntro(opts.codexHome, true)}\n`);

			const motion = io.stdout === process.stdout ? createBlockingSpinnerMotion(process.stdout.fd) : undefined;
			const spinner = new Spinner(io.stdout, true, motion);
			activeSpinner = spinner;
			let stepIndex = 0;
			result = await executeInstallPlan(plan, {
				...executeDeps,
				onPreflightStart: (stage) => {
					activityPending = true;
					spinner.start(preflightLabel(stage));
				},
				onPreflightEnd: (preflightResult) => {
					const label = `${preflightLabel(preflightResult.stage)}: ${preflightResult.detail}`;
					if (preflightResult.status === "ok") spinner.succeed(label);
					else spinner.skip(label);
					activityPending = false;
				},
				onStepStart: (step) => {
					activityPending = true;
					io.stdout.write(`${renderStepIntro(step, stepIndex, plan.length, opts.codexHome, true)}\n`);
					spinner.start(humanLabel(step.kind));
				},
				onStepEnd: (stepResult) => {
					const label = humanLabel(stepResult.kind);
					const completedLabel = `${label}: ${stepResult.detail}`;
					switch (stepResult.status) {
						case "ok":
							spinner.succeed(completedLabel);
							break;
						case "skipped":
							spinner.skip(completedLabel);
							break;
						case "failed":
							spinner.fail(completedLabel);
							break;
					}
					io.stdout.write(renderStepResult(stepResult, true));
					io.stdout.write("\n");
					stepIndex += 1;
					activityPending = false;
				},
			});
		} else {
			result = await executeInstallPlan(plan, executeDeps);
		}
	} catch (err) {
		if (decorate) {
			if (activityPending) activeSpinner?.fail("Current operation stopped");
			io.stderr.write(renderInstallFailure(toErrorJson(err), true));
			return err instanceof InstallError ? exitCodeForInstallError(err.code) : 1;
		}
		return emitError(io, err instanceof Error ? err : new Error(String(err)));
	} finally {
		marketplaceSource?.cleanup();
	}

	const officeRuntime = result.ok ? prepareOfficeRuntime(opts.codexHome, spawnSync, io.env) : undefined;
	if (officeRuntime) io.stderr.write(`[litcodex] ${officeRuntimeNotice(officeRuntime.ready)}\n`);
	const motionRuntime = result.ok ? prepareMotionRuntime(opts.codexHome, [], spawnSync, io.env) : undefined;
	if (motionRuntime) io.stderr.write(`[litcodex] ${motionRuntime.receipt}\n`);
	if (opts.json) {
		io.stdout.write(`${JSON.stringify(result)}\n`);
	} else if (decorate) {
		io.stdout.write(
			renderInstallReceipt(result, {
				model: opts.leadModel,
				effort: opts.effort,
				subagentModel: opts.subagentModel,
				subagentEffort: opts.subagentEffort,
				color: true,
			}),
		);
	} else io.stdout.write(renderPlainInstallResult(result));
	return result.ok ? 0 : 3;
}

/**
 * `litcodex doctor [--json]` — read-only health report. Exit 0 when ok, 4 otherwise.
 * Doctor diagnostics never modify Codex config, install state, or plugin state. The top-level CLI
 * envelope around an eligible successful interactive doctor may display a cached advisory notice
 * and schedule a detached fixed-registry refresh that writes only `~/.litcodex/update-check.json`
 * and its product-owned locks. Failed, --json, --dry-run, non-TTY, CI, and opt-out doctor runs remain
 * side-effect-free.
 */
export function runDoctorCli(args: readonly string[], io: RouteIo = defaultIo()): number {
	const json = args.includes("--json");
	writeCommandBanner(io, args);
	const report = runDoctor({ spawn: realSpawn, fs: realFs, env: io.env, repoRoot: io.repoRoot });
	const officeRuntime = officeRuntimeStatus(resolveCodexHome(io.env), spawnSync, io.env);
	const motionRuntime = motionRuntimeStatus(resolveCodexHome(io.env), spawnSync, io.env);
	if (json) {
		io.stdout.write(`${JSON.stringify({ ...report, officeRuntime, motionRuntime })}\n`);
	} else {
		io.stdout.write(
			`${renderDoctorText(report)}\n  office runtime: ${officeRuntime.ready ? "ready" : "missing"}\n${renderMotionRuntime(motionRuntime, "  ")}\n`,
		);
	}
	return report.ok ? 0 : 4;
}

/** `litcodex uninstall [--json]` — remove the registered plugin via `codex plugin remove`. */
export function runUninstallCli(args: readonly string[], io: RouteIo = defaultIo()): number {
	const json = args.includes("--json");
	writeCommandBanner(io, args);
	const codexHome = resolveCodexHome(io.env);
	const env = io.env;
	const codexBin = env["CODEX_BIN"]?.trim() && existsSync(env["CODEX_BIN"].trim()) ? env["CODEX_BIN"].trim() : "codex";
	const result = runUninstall({
		codexBin,
		codexHome,
		spawn: realSpawn,
		fs: {
			existsSync,
			readdirSync: (path) => readdirSync(path),
			rmSync,
			rmdirSync: (path) => rmdirSync(path),
			readFileSync: (path, enc) => readFileSync(path, enc),
			writeFileSync: (path, data) => {
				writeFileSync(path, data);
			},
		},
	});

	if (json) {
		io.stdout.write(`${JSON.stringify(result)}\n`);
	} else if (result.ok) {
		io.stdout.write("litcodex uninstall: complete\n");
	} else {
		io.stderr.write("[litcodex] uninstall: codex plugin remove failed\n");
	}
	return result.ok ? 0 : 3;
}
