import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { SpawnLike } from "../install/codex.js";
import { type HostCapabilities, modelContextsForWrites, probeHostCapabilities } from "../install/host-capabilities.js";
import { acceptedModelIds, canonicalModelId, FALLBACK_CATALOG, modelDefinition } from "./catalog.js";
import { CodexConfigMigrationError, exitCodeForMigrationError } from "./errors.js";
import type { Gpt56Profile, ReasoningEffort } from "./gpt56-policy.js";
import type { MigrateOptions, MigrateResult, MigrationMode } from "./index.js";
import { migrateCodexConfig } from "./index.js";

export interface ConfigMigrateCliArgs {
	readonly sessionStart: boolean;
	readonly json: boolean;
	readonly cwd: string | null;
	readonly dryRun: boolean;
	readonly reconfigure: boolean;
	readonly profile: Gpt56Profile;
	readonly model: string;
	readonly effort: ReasoningEffort;
}

export interface ConfigMigrateCliDeps {
	readonly preflight?: (profile: Gpt56Profile, effort: ReasoningEffort, model?: string) => HostCapabilities;
}

class ConfigMigrateArgumentError extends Error {
	readonly flag: string;

	constructor(message: string, flag: string) {
		super(message);
		this.name = "ConfigMigrateArgumentError";
		this.flag = flag;
	}
}

export function parseConfigMigrateArgs(argv: readonly string[]): ConfigMigrateCliArgs {
	let sessionStart = false;
	let json = false;
	let dryRun = false;
	let reconfigure = false;
	let model = FALLBACK_CATALOG.current.model;
	let profile: Gpt56Profile = modelDefinition(model)?.configProfile ?? "astra";
	let effort = FALLBACK_CATALOG.current.model_reasoning_effort as ReasoningEffort;
	let effortExplicit = false;
	let cwd: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--session-start") sessionStart = true;
		else if (arg === "--json") json = true;
		else if (arg === "--dry-run") dryRun = true;
		else if (arg === "--reconfigure" || arg === "--managed-upgrade") reconfigure = true;
		else if (arg === "--model") {
			const value = argv[index + 1];
			const canonical = canonicalModelId(value);
			const definition = modelDefinition(canonical);
			if (definition === undefined || canonical === undefined) throw invalidModel();
			profile = definition.configProfile;
			model = canonical;
			if (!effortExplicit) effort = definition.recommendedEffort;
			index += 1;
		} else if (arg === "--effort") {
			const value = argv[index + 1];
			if (!isReasoningEffort(value)) throw invalidEffort();
			effort = value;
			effortExplicit = true;
			index += 1;
		} else if (arg === "--cwd") {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) throw invalidValue("--cwd requires a value", "--cwd");
			cwd = value;
			index += 1;
		} else if (arg?.startsWith("--cwd=")) {
			cwd = arg.slice("--cwd=".length);
			if (cwd === "") throw invalidValue("--cwd requires a value", "--cwd");
		} else if (arg !== undefined) throw invalidValue(`unknown option ${JSON.stringify(arg)}`, arg);
	}
	const definition = modelDefinition(model);
	if (definition === undefined || !definition.configurableEfforts.includes(effort)) throw invalidEffort(model);
	return { sessionStart, json, cwd, dryRun, reconfigure, profile, model, effort };
}

export async function runConfigMigrateCli(
	argv: readonly string[],
	out: (text: string) => void = (text) => process.stdout.write(text),
	err: (text: string) => void = (text) => process.stderr.write(text),
	deps: ConfigMigrateCliDeps = {},
): Promise<number> {
	let args: ConfigMigrateCliArgs;
	try {
		args = parseConfigMigrateArgs(argv);
	} catch (error) {
		if (!(error instanceof ConfigMigrateArgumentError)) throw error;
		err(
			`${JSON.stringify({ ok: false, code: "CONFIG_INVALID_OPTION", message: error.message, details: { flag: error.flag } })}\n`,
		);
		return 2;
	}
	const mode: MigrationMode = args.sessionStart ? "session-start" : "install";
	const capabilities = (deps.preflight ?? directPreflight)(args.profile, args.effort, args.model);
	if (capabilities.concurrency.status === "unavailable") {
		err(
			`${JSON.stringify({ ok: false, code: "CONFIG_PREFLIGHT_FAILED", message: "config migrate preflight unavailable", capabilities })}\n`,
		);
		return args.sessionStart ? 0 : 2;
	}
	const options: MigrateOptions = {
		mode,
		cwd: args.cwd ?? process.cwd(),
		reconfigure: args.reconfigure,
		profile: args.profile,
		modelOverride: args.model,
		effort: args.effort,
		modelContexts: modelContextsForWrites(),
	};
	let result: MigrateResult;
	try {
		result = await migrateCodexConfig({ ...options, dryRun: true });
		if (!args.dryRun) result = await migrateCodexConfig(options);
	} catch (error) {
		if (args.sessionStart) return 0;
		if (error instanceof CodexConfigMigrationError) {
			err(`${JSON.stringify({ ok: false, code: error.code, message: error.message, details: error.details })}\n`);
			return exitCodeForMigrationError(error.code);
		}
		throw error;
	}
	if (args.json) out(`${JSON.stringify({ ...result, capabilities })}\n`);
	else out(renderText(result, capabilities));
	return 0;
}

function directPreflight(profile: Gpt56Profile, effort: ReasoningEffort, model?: string): HostCapabilities {
	const override = process.env["CODEX_BIN"]?.trim();
	const codexBin = override !== undefined && override !== "" ? override : "codex";
	if (override !== undefined && override !== "" && !existsSync(override)) {
		return unavailableCapabilities("codex-binary-unavailable", override);
	}
	const spawn: SpawnLike = (command, argv, options) => {
		const result = spawnSync(command, [...argv], {
			encoding: "utf8",
			stdio: options.stdio,
			timeout: options.timeout,
		});
		return {
			status: result.status,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			...(result.error === undefined ? {} : { error: result.error }),
		};
	};
	return probeHostCapabilities(codexBin, spawn, {
		profile,
		effort,
		...(model === undefined ? {} : { model }),
		env: process.env,
	});
}

function unavailableCapabilities(reason: string, observedSource: string): HostCapabilities {
	const report = { status: "unavailable" as const, reason, observedSource };
	return {
		concurrency: report,
		autoCompaction: report,
		modelContexts: Object.fromEntries(acceptedModelIds().map((model) => [model, null])),
	};
}

function renderText(result: MigrateResult, capabilities: HostCapabilities): string {
	const userModified = result.skipped.filter((skip) => skip.reason === "user-modified");
	const preserved = result.skipped.filter((skip) => skip.reason === "preserved");
	const lines = [
		`litcodex config: ${result.changed.length} updated, ${result.backups.length} backup(s), ${preserved.length} preserved, ${userModified.length} user-modified`,
		...result.changed.map((path) => `updated: ${path}`),
		...result.backups.map((path) => `backup: ${path}`),
		...preserved.map((skip) => `skipped: ${skip.path} (preserved; use --reconfigure only after review)`),
		...userModified.map((skip) => `skipped: ${skip.path} (user-modified)`),
		`capability concurrency: ${capabilityText(capabilities.concurrency)}`,
		`probe-only explicit context/auto-compaction override: ${capabilityText(capabilities.autoCompaction)}`,
	];
	return `${lines.join("\n")}\n`;
}

function capabilityText(report: HostCapabilities["concurrency"]): string {
	return `${report.status}; reason=${report.reason}; source=${report.observedSource}`;
}

function isReasoningEffort(value: string | undefined): value is ReasoningEffort {
	return (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max" ||
		value === "ultra"
	);
}

function invalidModel(): ConfigMigrateArgumentError {
	return invalidValue(`--model requires one of: ${acceptedModelIds().join(", ")}`, "--model");
}

function invalidEffort(model?: string): ConfigMigrateArgumentError {
	return invalidValue(
		`--effort requires one of: ${(modelDefinition(model)?.configurableEfforts ?? []).join(", ")}`,
		"--effort",
	);
}

function invalidValue(message: string, flag: string): ConfigMigrateArgumentError {
	return new ConfigMigrateArgumentError(message, flag);
}
