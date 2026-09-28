import { probeMarketplaceRegistration, probePluginInstalled, type SpawnLike } from "./codex.js";
import { InstallError } from "./errors.js";
import { canonicalMarketplacePath, LITCODEX_MARKETPLACE, LITCODEX_PLUGIN, LITCODEX_PLUGIN_REF } from "./marketplace.js";
import type { InstallStep, InstallStepResult } from "./types.js";

export interface RegistrationDeps {
	readonly spawn: SpawnLike;
	readonly force?: boolean;
	readonly refreshPlugin?: boolean;
}

export function runRegistration(
	step: InstallStep,
	codexBin: string,
	deps: RegistrationDeps,
	target: "marketplace" | "plugin",
): InstallStepResult {
	if (target === "marketplace") return registerMarketplace(step, codexBin, deps);
	return registerPlugin(step, codexBin, deps);
}

function registerMarketplace(step: InstallStep, codexBin: string, deps: RegistrationDeps): InstallStepResult {
	const desired = step.command?.at(-1);
	const current = probeMarketplaceRegistration(codexBin, deps.spawn);
	if (current !== null && desired !== undefined && samePath(current.source, desired) && deps.force !== true) {
		return skipped(step, `${LITCODEX_MARKETPLACE} marketplace already registered`);
	}
	const receipts: string[] = [];
	if (current !== null) {
		if (probePluginInstalled(codexBin, deps.spawn)) {
			receipts.push(...spawnMutation(codexBin, ["plugin", "remove", LITCODEX_PLUGIN_REF], deps, "plugin"));
		}
		receipts.push(
			...spawnMutation(codexBin, ["plugin", "marketplace", "remove", LITCODEX_MARKETPLACE], deps, "marketplace"),
		);
	}
	receipts.push(...spawnStep(step, codexBin, deps, "marketplace"));
	return ok(step, `${LITCODEX_MARKETPLACE} marketplace registered`, receipts);
}

function registerPlugin(step: InstallStep, codexBin: string, deps: RegistrationDeps): InstallStepResult {
	const present = probePluginInstalled(codexBin, deps.spawn);
	const receipts: string[] = [];
	if (present && deps.refreshPlugin === true) {
		receipts.push(...spawnMutation(codexBin, ["plugin", "remove", LITCODEX_PLUGIN_REF], deps, "plugin"));
	} else if (present && deps.force !== true) {
		return skipped(step, `${LITCODEX_PLUGIN}@${LITCODEX_MARKETPLACE} plugin already registered`);
	}
	receipts.push(...spawnStep(step, codexBin, deps, "plugin"));
	return ok(step, `${LITCODEX_PLUGIN}@${LITCODEX_MARKETPLACE} plugin registered`, receipts);
}

function spawnStep(
	step: InstallStep,
	codexBin: string,
	deps: RegistrationDeps,
	target: "marketplace" | "plugin",
): readonly string[] {
	return step.command === null ? [] : spawnMutation(codexBin, step.command.slice(1), deps, target);
}

function spawnMutation(
	codexBin: string,
	args: readonly string[],
	deps: RegistrationDeps,
	target: "marketplace" | "plugin",
): readonly string[] {
	const res = deps.spawn(codexBin, args, { stdio: "pipe" });
	if (!res.error && res.status !== null && res.status === 0) return outputLines(res.stdout, res.stderr);
	throw new InstallError(
		target === "marketplace" ? "LITCODEX_INSTALL_MARKETPLACE_ADD_FAILED" : "LITCODEX_INSTALL_PLUGIN_ADD_FAILED",
		`codex ${args.join(" ")} failed`,
		{ status: res.status, signalKilled: res.status === null, stdout: res.stdout ?? "", stderr: res.stderr ?? "" },
	);
}

function outputLines(stdout: string | undefined, stderr: string | undefined): readonly string[] {
	return `${stdout ?? ""}\n${stderr ?? ""}`
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function samePath(current: string | null, desired: string): boolean {
	if (current === null) return false;
	return canonicalMarketplacePath(current) === canonicalMarketplacePath(desired);
}

function ok(step: InstallStep, detail: string, receipts: readonly string[]): InstallStepResult {
	return { kind: step.kind, status: "ok", detail, ...(receipts.length === 0 ? {} : { receipts }) };
}

function skipped(step: InstallStep, detail: string): InstallStepResult {
	return { kind: step.kind, status: "skipped", detail };
}
