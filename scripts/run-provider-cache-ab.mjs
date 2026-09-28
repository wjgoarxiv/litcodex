#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
	assertHostAuthBoundary,
	assertHostAuthUnchanged,
	captureHostAuthBoundary,
	findHostAuthSource,
	runLiveSession,
	verifyChatGptLogin,
} from "./provider-cache-ab-auth.mjs";
import {
	baseReceipt,
	CohortRunError,
	classifyFailure,
	fakeSessions,
	parseRunnerArgs,
	preflightReceipt,
	publicReceipt,
	readScenario,
	SESSION_ORDER,
	sha256,
} from "./provider-cache-ab-core.mjs";
import {
	installPackedPlugin,
	resolveExecutable,
	runCommand,
	runPromptInputGate,
} from "./provider-cache-ab-process.mjs";
import { emitProviderCacheReceipt, promptInputFailureReceipt } from "./provider-cache-runner-output.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_SCENARIO = join(HERE, "fixtures/provider-cache-lit-plan-transition-v1.json");
const RUNNER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
const BASE_ENV = Object.freeze({
	NO_UPDATE_NOTIFIER: "1",
	LITCODEX_NO_UPDATE_CHECK: "1",
	LITCODEX_NO_AUTO_UPDATE: "1",
});
const RUN_ABORT = new AbortController();
process.once("SIGINT", () => RUN_ABORT.abort());
process.once("SIGTERM", () => RUN_ABORT.abort());

async function runLive(options, scenarioMeta) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-ab-"));
	let completionCount = 0;
	let authSource;
	let authBoundary;
	let receipt;
	let runError;
	const authLinks = [];
	try {
		const env = { ...process.env, ...BASE_ENV };
		delete env.CODEX_HOME;
		delete env.OPENAI_API_KEY;
		const codex = resolveExecutable(options.codex, env);
		const reuseHostAuth = async () => {
			authSource = findHostAuthSource(env);
			authBoundary = captureHostAuthBoundary(authSource);
			await verifyChatGptLogin({
				root,
				codex,
				env,
				source: authSource,
				boundary: authBoundary,
				signal: RUN_ABORT.signal,
				onAuthLink: (linked) => authLinks.push(linked),
			});
		};
		if (options.expectedArtifactSha256 === undefined) await reuseHostAuth();
		const version = await runCommand(codex, ["--version"], {
			cwd: root,
			env,
			timeoutMs: 10_000,
			signal: RUN_ABORT.signal,
		});
		const identity = {
			executableSha256: sha256(readFileSync(codex)),
			versionSha256: sha256(version.stdout.trim()),
			versionBytes: Buffer.byteLength(version.stdout.trim()),
			authMode: "chatgpt",
		};
		const packed = await installPackedPlugin({
			root,
			codex,
			env,
			repoRoot: REPO_ROOT,
			signal: RUN_ABORT.signal,
		});
		if (options.expectedArtifactSha256 !== undefined && packed.artifact.sha256 !== options.expectedArtifactSha256) {
			throw new Error("BLOCKED_STALE_CANDIDATE");
		}
		if (options.expectedArtifactSha256 !== undefined) await reuseHostAuth();
		const controlTemplate = join(root, "control-template");
		const fixtureRoot = join(root, "fixture");
		mkdirSync(join(controlTemplate, ".codex"), { recursive: true });
		mkdirSync(fixtureRoot, { recursive: true });
		const sessions = [];
		let ordinal = 0;
		for (const [blockIndex, pair] of SESSION_ORDER.entries()) {
			for (const arm of pair) {
				ordinal += 1;
				sessions.push(
					await runLiveSession({
						root,
						template: arm === "active" ? packed.activeTemplate : controlTemplate,
						arm,
						block: blockIndex + 1,
						ordinal,
						codex,
						model: options.model,
						scenario: scenarioMeta.scenario,
						env,
						fixtureRoot,
						authSource,
						authBoundary,
						signal: RUN_ABORT.signal,
						onAuthLink: (linked) => authLinks.push(linked),
						onCompletion: () => {
							completionCount += 1;
						},
					}),
				);
			}
		}
		receipt = publicReceipt(
			"live",
			options,
			scenarioMeta,
			sessions,
			identity,
			{ ...packed.artifact, packStdoutSha256: packed.packStdoutSha256 },
			RUNNER_SHA256,
		);
	} catch (error) {
		runError = error;
	}
	try {
		if (authSource !== undefined && authBoundary !== undefined) {
			for (const linked of authLinks) assertHostAuthBoundary(authSource, authBoundary, linked);
			assertHostAuthUnchanged(authSource, authBoundary);
		}
	} catch (error) {
		runError = error;
	}
	rmSync(root, { recursive: true, force: true });
	if (runError !== undefined) throw new CohortRunError(runError, completionCount);
	if (receipt === undefined) throw new CohortRunError(new Error("RUNNER_RESULT_MISSING"), completionCount);
	return receipt;
}

async function main() {
	let options;
	try {
		options = parseRunnerArgs(process.argv.slice(2));
	} catch {
		emitProviderCacheReceipt(baseReceipt("invalid", "none", "INVALID_COHORT_CONFIG"), undefined, 2);
		return;
	}
	let scenarioMeta;
	try {
		scenarioMeta = readScenario(DEFAULT_SCENARIO);
	} catch {
		emitProviderCacheReceipt(
			baseReceipt("invalid", options.live ? "live" : "fake", "INVALID_SCENARIO_FIXTURE"),
			options.output,
			2,
		);
		return;
	}
	try {
		if (options.fakeFailure !== undefined) {
			const codes = {
				"rate-limit": "PROVIDER_RATE_LIMIT",
				"missing-usage": "MISSING_AUTHORITATIVE_USAGE",
				timeout: "PROCESS_TIMEOUT",
			};
			emitProviderCacheReceipt(
				preflightReceipt(options, scenarioMeta, "invalid", codes[options.fakeFailure], RUNNER_SHA256),
				options.output,
				1,
			);
			return;
		}
		const receipt = options.promptInputGate
			? await runPromptInputGate({
					options,
					scenarioMeta,
					baseEnv: BASE_ENV,
					repoRoot: options.repoRoot ?? REPO_ROOT,
					runnerSha256: RUNNER_SHA256,
					signal: RUN_ABORT.signal,
					processEnv: process.env,
				})
			: options.live
				? await runLive(options, scenarioMeta)
				: publicReceipt(
						"fake",
						options,
						scenarioMeta,
						fakeSessions(scenarioMeta.scenario),
						{
							executableSha256: sha256("fake-codex/v1"),
							versionSha256: sha256("fake-codex 1"),
							versionBytes: 12,
						},
						{ sha256: sha256("fake-packed-plugin/v1"), bytes: 21 },
						RUNNER_SHA256,
					);
		emitProviderCacheReceipt(receipt, options.output, receipt.status === "blocked" ? 2 : 0);
	} catch (error) {
		const code = classifyFailure(error);
		const blocked = code.startsWith("BLOCKED_");
		if (options.promptInputGate) {
			emitProviderCacheReceipt(
				promptInputFailureReceipt(
					options,
					scenarioMeta,
					RUNNER_SHA256,
					blocked ? "blocked" : "invalid",
					code,
					error?.diagnostic,
				),
				options.output,
				blocked ? 2 : 1,
			);
			return;
		}
		emitProviderCacheReceipt(
			preflightReceipt(
				options,
				scenarioMeta,
				blocked ? "blocked" : "invalid",
				code,
				RUNNER_SHA256,
				Number.isSafeInteger(error?.completionCount) ? error.completionCount : 0,
			),
			options.output,
			blocked ? 2 : 1,
		);
	}
}

await main();
