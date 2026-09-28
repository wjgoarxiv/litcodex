import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { runPromptInputArm } from "./install-smoke-context-probes.mjs";
import { resolveNpmInvocation } from "./npm-command.mjs";
import { CLEANUP, parseCodexTurn, publicScenario, sha256 } from "./provider-cache-ab-core.mjs";
import {
	findExplicitOnlySkillNames,
	runBareAndCompactionGuards,
	runExplicitSkillProbes,
} from "./provider-cache-skill-probes.mjs";

export { parsePromptInput } from "./install-smoke-context-probes.mjs";
export {
	evaluateLocalHookTimingGate,
	measureInstalledHookTimings,
} from "./provider-cache-hook-timings.mjs";
export {
	ProcessProbeError,
	resolveExecutable,
	runBoundedProcess,
	runCommand,
} from "./provider-cache-process-control.mjs";

import { evaluateLocalHookTimingGate, measureInstalledHookTimings } from "./provider-cache-hook-timings.mjs";
import { resolveExecutable, runCommand } from "./provider-cache-process-control.mjs";

export async function installPackedPlugin({ root, codex, env, repoRoot, signal }) {
	const packDir = join(root, "pack");
	const installPrefix = join(root, "installed");
	const activeTemplate = join(root, "active-template");
	for (const folder of [packDir, installPrefix, activeTemplate]) mkdirSync(folder, { recursive: true });
	const packNpm = resolveNpmInvocation([
		"pack",
		"--workspace=packages/litcodex-ai",
		"--pack-destination",
		packDir,
		"--json",
	]);
	const pack = await runCommand(packNpm.command, packNpm.args, { cwd: repoRoot, env, timeoutMs: 60_000, signal });
	const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
	if (tarballs.length !== 1) throw new Error("PACK_ARTIFACT_INVALID");
	const tarball = join(packDir, tarballs[0]);
	const installNpm = resolveNpmInvocation(["install", "--prefix", installPrefix, tarball]);
	await runCommand(installNpm.command, installNpm.args, {
		cwd: root,
		env,
		timeoutMs: 60_000,
		signal,
	});
	const marketplace = join(installPrefix, "node_modules/@litfamily/litcodex/marketplace");
	const activeEnv = { ...env, HOME: activeTemplate, CODEX_HOME: join(activeTemplate, ".codex") };
	mkdirSync(activeEnv.CODEX_HOME, { recursive: true });
	await runCommand(codex, ["plugin", "marketplace", "add", marketplace, "--json"], {
		cwd: root,
		env: activeEnv,
		timeoutMs: 60_000,
		signal,
	});
	await runCommand(codex, ["plugin", "add", "litcodex@litcodex", "--json"], {
		cwd: root,
		env: activeEnv,
		timeoutMs: 60_000,
		signal,
	});
	if (existsSync(join(activeEnv.CODEX_HOME, "auth.json"))) throw new Error("SANDBOX_AUTH_FILE_FORBIDDEN");
	const cacheRoot = join(activeEnv.CODEX_HOME, "plugins/cache/litcodex/litcodex");
	const versions = existsSync(cacheRoot)
		? readdirSync(cacheRoot).filter((name) => statSync(join(cacheRoot, name)).isDirectory())
		: [];
	if (versions.length !== 1) throw new Error("PLUGIN_INVENTORY_CACHE_INVALID");
	const pluginRoot = join(cacheRoot, versions[0]);
	if (!existsSync(join(pluginRoot, "skills"))) throw new Error("PLUGIN_INVENTORY_CACHE_INVALID");
	return {
		activeTemplate,
		pluginRoot,
		artifact: { sha256: sha256(readFileSync(tarball)), bytes: statSync(tarball).size },
		packStdoutSha256: sha256(pack.stdout),
	};
}

export async function runProviderTurn(codex, args, env, cwd, record, signal, onCompletion) {
	const started = performance.now();
	const result = await runCommand(codex, args, { cwd, env, timeoutMs: 60_000, signal });
	const latencyMs = Math.ceil(performance.now() - started);
	const parsed = parseCodexTurn(result.stdout, record.canary);
	if (!parsed.correct) throw new Error("CORRECTNESS_FAILURE");
	onCompletion();
	return { parsed, latencyMs, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr) };
}

export async function runPromptInputGate({
	options,
	scenarioMeta,
	baseEnv,
	repoRoot,
	runnerSha256,
	signal,
	processEnv,
}) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-prompt-input-"));
	try {
		const env = { ...processEnv, ...baseEnv };
		delete env.CODEX_HOME;
		delete env.OPENAI_API_KEY;
		const codex = resolveExecutable(options.codex, env);
		const version = await runCommand(codex, ["--version"], { cwd: root, env, timeoutMs: 10_000, signal });
		const packed = await installPackedPlugin({ root, codex, env, repoRoot, signal });
		const controlTemplate = join(root, "control-template");
		const fixtureRoot = join(root, "fixture");
		mkdirSync(join(controlTemplate, ".codex"), { recursive: true });
		mkdirSync(fixtureRoot, { recursive: true });
		const runProbe = (executable, args, probeOptions) =>
			runCommand(executable, args, { ...probeOptions, timeoutMs: 60_000, signal });
		const arms = {};
		for (const arm of ["active", "control"]) {
			arms[arm] = await runPromptInputArm({
				root,
				template: arm === "active" ? packed.activeTemplate : controlTemplate,
				arm,
				codex,
				env,
				fixtureRoot,
				model: options.model,
				prompt: scenarioMeta.scenario.records[1].prompt,
				runCommand: runProbe,
			});
		}
		const deltaBytes = arms.active.promptInput.totalBytes - arms.control.promptInput.totalBytes;
		if (arms.active.promptInput.totalBytes <= 0 || arms.control.promptInput.totalBytes <= 0 || deltaBytes <= 0) {
			throw new Error("PROMPT_INPUT_DELTA_INVALID");
		}
		const explicitOnlySkills = findExplicitOnlySkillNames(packed.pluginRoot);
		const explicitSelection = await runExplicitSkillProbes({
			codex,
			activeHome: packed.activeTemplate,
			pluginRoot: packed.pluginRoot,
			cwd: fixtureRoot,
			names: explicitOnlySkills,
			env,
		});
		const hookReactivation = await runBareAndCompactionGuards({
			pluginRoot: packed.pluginRoot,
			cwd: fixtureRoot,
			names: explicitOnlySkills,
			env,
			runCommand: runProbe,
		});
		const timingHome = join(root, "hook-timing-home");
		const timingData = join(root, "hook-timing-data");
		mkdirSync(timingHome, { recursive: true });
		mkdirSync(timingData, { recursive: true });
		const hookTimings = await measureInstalledHookTimings({
			pluginRoot: packed.pluginRoot,
			fixtureRoot,
			env: { ...env, HOME: timingHome, CODEX_HOME: join(timingHome, ".codex"), PLUGIN_DATA: timingData },
			prompt: scenarioMeta.scenario.records[1].prompt,
			runCommand: runProbe,
		});
		const hookTimingGate = evaluateLocalHookTimingGate(hookTimings);
		const promptDeltaGate =
			options.expectedPromptDelta === undefined
				? { status: "NOT_REQUESTED" }
				: deltaBytes === options.expectedPromptDelta
					? { status: "PASS", expectedBytes: options.expectedPromptDelta, actualBytes: deltaBytes }
					: {
							status: "BLOCKED",
							code: "BLOCKED_LOCAL_PREFIX_DRIFT",
							expectedBytes: options.expectedPromptDelta,
							actualBytes: deltaBytes,
						};
		const blockedGate = [promptDeltaGate, hookTimingGate].find((gate) => gate.status === "BLOCKED");
		return {
			schema: "litcodex.provider-cache-prompt-input/v1",
			status: blockedGate === undefined ? "measured" : "blocked",
			...(blockedGate === undefined ? {} : { code: blockedGate.code }),
			mode: "prompt-input-gate",
			providerCompletions: 0,
			model: { requested: options.model },
			identity: {
				executableSha256: sha256(readFileSync(codex)),
				versionSha256: sha256(version.stdout.trim()),
				versionBytes: Buffer.byteLength(version.stdout.trim()),
			},
			artifact: { ...packed.artifact, packStdoutSha256: packed.packStdoutSha256 },
			runnerSha256,
			scenario: publicScenario(scenarioMeta),
			prompt: scenarioMeta.scenario.records[1].id,
			active: arms.active,
			control: arms.control,
			deltaBytes,
			promptDeltaGate,
			hookTimings,
			hookTimingGate,
			skillGuards: { explicitOnlySkills, explicitSelection, hookReactivation },
			cleanup: { ...CLEANUP, authLinks: 0, promptInputFiles: 0 },
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
