#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "../plugins/litcodex/skills/visual-qa/scripts/strict-input.mjs";
import { resolveNpmInvocation } from "./npm-command.mjs";
import { discoverAndHook, probeHost, runScenarioTable } from "./uiux-installed-host-probe.mjs";
import {
	assert,
	assertBetaDesignContract,
	assertRepositoryCodexIdentity,
	boundedErrorMessage,
	captureRepositoryCodexIdentity,
	commandRecordAsync,
	designContract,
	evidenceBundle,
	outputEvidence,
	ProbeTerminalError,
	runProbeLifecycle,
	timedAsync,
	verifyLockedCodexAsync,
} from "./uiux-installed-probe-helpers.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidencePath = join(repoRoot, ".litcodex/evidence/task-uiux-installed-receipt.json");
const NOW = "2026-07-25T06:00:00.000Z";

function documentedBlock(skillRoot, marker) {
	const markdown = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
	const matches = [...markdown.matchAll(/```bash\n([\s\S]*?)\n```/g)]
		.map((match) => match[1] ?? "")
		.filter((block) => block.includes(marker));
	assert(matches.length === 1, `expected one documented block for ${marker}, found ${matches.length}`);
	return matches[0];
}

async function commandTextRecordAsync(name, command, args, options, stdoutMarker, runCommand) {
	const result = await runCommand(command, args, options);
	assert(
		result.exitCode === 0,
		`${name} exit ${result.exitCode}: ${boundedErrorMessage(result.stderr, "command failed")}`,
	);
	assert(result.stdout.includes(stdoutMarker), `${name} stdout missing ${stdoutMarker}`);
	return {
		name,
		exitCode: result.exitCode,
		durationMs: result.durationMs,
		stdoutBytes: Buffer.byteLength(result.stdout),
		stdoutSha256: createHash("sha256").update(result.stdout).digest("hex"),
		stderrEvidence: outputEvidence(result.stderr),
	};
}

const CREDENTIAL_ENV_NAME =
	/(?:api[_-]?key|auth(?:orization)?|cookie|credential|pass(?:word|phrase|wd)?|private[_-]?key|secret|session|token|access[_-]?key|askpass|netrc)/iu;
const HOST_EXEC_RUNTIME_KEYS = [
	"HOME",
	"CODEX_HOME",
	"PATH",
	"TMPDIR",
	"TMP",
	"TEMP",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"COLORTERM",
	"NO_COLOR",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"PATHEXT",
];

function proxyContainsCredentials(value) {
	if (typeof value !== "string" || value.trim() === "") return false;
	try {
		const parsed = new URL(value);
		return parsed.username !== "" || parsed.password !== "";
	} catch {
		return true;
	}
}

export function credentialFreeSetupEnv(home, codexHome, prefix, codexBin, ambient = process.env) {
	const env = {};
	for (const [name, value] of Object.entries(ambient)) {
		if (value === undefined) continue;
		if (
			name === "HOME" ||
			name === "CODEX_HOME" ||
			name === "CODEX_BIN" ||
			name.startsWith("LITCODEX_") ||
			name.startsWith("CODEX_") ||
			name.startsWith("NPM_CONFIG_") ||
			name.startsWith("npm_config_") ||
			CREDENTIAL_ENV_NAME.test(name)
		) {
			continue;
		}
		if (/^(?:ALL|HTTP|HTTPS)_PROXY$/iu.test(name) && proxyContainsCredentials(value)) continue;
		env[name] = value;
	}
	env.HOME = home;
	env.CODEX_HOME = codexHome;
	env.CODEX_BIN = codexBin;
	env.npm_config_prefix = prefix;
	env.PATH = `${dirname(codexBin)}${delimiter}${ambient.PATH ?? ""}`;
	env.NO_UPDATE_NOTIFIER = "1";
	return env;
}

export function minimalHostExecEnv(setupEnv) {
	const env = {};
	for (const name of HOST_EXEC_RUNTIME_KEYS) {
		const value = setupEnv[name];
		if (typeof value === "string" && value !== "" && !CREDENTIAL_ENV_NAME.test(name)) env[name] = value;
	}
	return env;
}

function assertAuthFreeCodexHome(codexHome, phase) {
	assert(!existsSync(join(codexHome, "auth.json")), `${phase} CODEX_HOME must not contain auth.json`);
}

export async function semanticProbe({
	root,
	tarball,
	prefix,
	setupEnv,
	hostEnv,
	setupCommands = [],
	scope,
	codexBin,
	signal,
	apiKey,
	runCommand = timedAsync,
	nonceFactory,
	codexIdentity,
	assertCodexIdentity = assertRepositoryCodexIdentity,
}) {
	const project = join(root, "home/project");
	const installedPackage = join(prefix, "lib/node_modules/@litfamily/litcodex");
	const managedMarketplace = join(setupEnv.CODEX_HOME, "marketplaces/litcodex");
	assertAuthFreeCodexHome(setupEnv.CODEX_HOME, "semantic and doctor");
	assert(existsSync(managedMarketplace), "installed public surface did not create the managed marketplace");
	const skills = join(managedMarketplace, "plugins/litcodex/skills");
	const frontendRoot = join(skills, "frontend-ui-ux");
	const visualRoot = join(skills, "visual-qa");
	const autoresearchRoot = join(skills, "autoresearch");
	const autoconferenceRoot = join(skills, "autoconference");
	const installedBin = join(prefix, "bin/litcodex");
	mkdirSync(project, { recursive: true });
	const evidenceRoot = join(project, "evidence-root");
	mkdirSync(join(evidenceRoot, "captures"), { recursive: true });
	const contract = designContract();
	assertBetaDesignContract(contract);
	const captureBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPgEpH7DwABpAE8k4sOtwAAAABJRU5ErkJggg==",
		"base64",
	);
	const nonImageBytes = Buffer.from("not a PNG", "utf8");
	const bundle = evidenceBundle(contract, { captureBytes });
	assert(
		bundle.evidence_manifest.schema_id === "litfamily.evidence-manifest/v1beta1",
		"installed evidence must be beta",
	);
	const variants = {
		"evidence-bundle.json": bundle,
		"missing-evidence-bundle.json": evidenceBundle(contract, {
			captureBytes,
			capturePath: "captures/missing.png",
		}),
		"non-image-evidence-bundle.json": evidenceBundle(contract, {
			captureBytes: nonImageBytes,
			capturePath: "captures/not-image.png",
		}),
		"stale-evidence-bundle.json": evidenceBundle(contract, {
			captureBytes,
			capturedAt: "2026-07-25T04:59:20.000Z",
			createdAt: "2026-07-25T05:00:00.000Z",
		}),
		"root-escape-evidence-bundle.json": evidenceBundle(contract, {
			captureBytes,
			capturePath: "../outside.png",
		}),
		"symlink-evidence-bundle.json": evidenceBundle(contract, {
			captureBytes,
			capturePath: "captures/linked.png",
		}),
		"reviewer-block-evidence-bundle.json": evidenceBundle(contract, { captureBytes, full: true }),
	};
	const files = {
		design: join(project, "design-contract.json"),
		tui: join(project, "capture.txt"),
		reference: join(project, "reference.png"),
		actual: join(project, "actual.png"),
	};
	writeFileSync(files.design, `${JSON.stringify(contract)}\n`);
	for (const [name, value] of Object.entries(variants)) {
		writeFileSync(join(project, name), `${JSON.stringify(value)}\n`);
	}
	writeFileSync(join(evidenceRoot, "captures", "primary.png"), captureBytes);
	writeFileSync(join(evidenceRoot, "captures", "not-image.png"), nonImageBytes);
	const outsideCapture = join(project, "outside.png");
	writeFileSync(outsideCapture, captureBytes);
	symlinkSync(outsideCapture, join(evidenceRoot, "captures", "linked.png"));
	writeFileSync(files.tui, "┌────┐\n│한글│\n└────┘\n");
	writeFileSync(files.reference, readFileSync(join(repoRoot, "plugins/litcodex/assets/logo.png")));
	writeFileSync(files.actual, readFileSync(join(repoRoot, "plugins/litcodex/assets/logo.png")));
	const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
	const provenanceRunCommand = (command, args, options) => {
		assertCodexIdentity(codexIdentity);
		return runCommand(command, args, options);
	};
	const hostRunCommand = (command, args, options) => {
		assertCodexIdentity(codexIdentity);
		if (command !== codexBin || args[0] !== "exec") return runCommand(command, args, options);
		const env = { ...options.env };
		delete env.OPENAI_API_KEY;
		if (normalizedApiKey !== "") env.OPENAI_API_KEY = normalizedApiKey;
		return runCommand(command, args, { ...options, env });
	};
	const base = { cwd: project, env: setupEnv, signal };
	const helperEnv = { ...setupEnv };
	delete helperEnv.AUTORESEARCH_ROOT;
	delete helperEnv.AUTOCONFERENCE_ROOT;
	const helperBase = { ...base, env: helperEnv };
	const visualDesignValidator = join(visualRoot, "scripts/validate-design-contract.mjs");
	const evidenceValidator = join(visualRoot, "scripts/validate-evidence.mjs");
	const visualCli = join(visualRoot, "scripts/cli.mjs");
	const evidenceArgs = (input, tier = "smoke") => [
		evidenceValidator,
		"--input",
		input,
		"--tier",
		tier,
		"--now",
		NOW,
		"--evidence-root",
		"evidence-root",
	];
	const commands = [
		await commandTextRecordAsync(
			"documented-autoresearch-helper",
			"python3",
			[
				join(autoresearchRoot, "scripts/init_research.py"),
				"--goal",
				"verify installed helper resolution",
				"--metric",
				"score",
				"--direction",
				"maximize",
				"--output",
				"autoresearch-helper",
			],
			helperBase,
			"scaffolded",
			provenanceRunCommand,
		),
		await commandTextRecordAsync(
			"documented-autoconference-helper",
			"python3",
			[
				join(autoconferenceRoot, "scripts/init_conference.py"),
				"--goal",
				"verify installed helper resolution",
				"--mode",
				"qualitative",
				"--criteria",
				"installed helper executes",
				"--output",
				"autoconference-helper",
			],
			helperBase,
			"scaffolded",
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"documented-design-validator",
			"sh",
			["-c", documentedBlock(frontendRoot, "--input design-contract.json")],
			base,
			0,
			{ valid: true },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-visual-design-validator",
			process.execPath,
			[visualDesignValidator, "--input", "design-contract.json"],
			base,
			0,
			{ valid: true },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-pass",
			process.execPath,
			evidenceArgs("evidence-bundle.json"),
			base,
			0,
			{ verdict: "PASS" },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-missing",
			process.execPath,
			evidenceArgs("missing-evidence-bundle.json"),
			base,
			0,
			{ verdict: "FAIL" },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-non-image",
			process.execPath,
			evidenceArgs("non-image-evidence-bundle.json"),
			base,
			0,
			{ verdict: "FAIL" },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-stale",
			process.execPath,
			evidenceArgs("stale-evidence-bundle.json"),
			base,
			0,
			{ verdict: "BLOCKED", blocked_codes: ["BLOCKED_EVIDENCE_STALE"] },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-root-escape",
			process.execPath,
			evidenceArgs("root-escape-evidence-bundle.json"),
			base,
			0,
			{ verdict: "FAIL" },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-symlink",
			process.execPath,
			evidenceArgs("symlink-evidence-bundle.json"),
			base,
			0,
			{ verdict: "FAIL" },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"installed-beta-evidence-reviewer-block",
			process.execPath,
			evidenceArgs("reviewer-block-evidence-bundle.json", "full"),
			base,
			0,
			{ verdict: "BLOCKED", blocked_codes: ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"] },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"documented-image-diff",
			process.execPath,
			[visualCli, "image-diff", "reference.png", "actual.png"],
			base,
			0,
			{ similarityScore: 100 },
			provenanceRunCommand,
		),
		await commandRecordAsync(
			"documented-tui-check",
			process.execPath,
			[visualCli, "tui-check", "capture.txt", "--cols", "80"],
			base,
			0,
			{ controlSequencesValid: true },
			provenanceRunCommand,
		),
	];
	const scenario = await runScenarioTable(repoRoot, installedPackage, base, provenanceRunCommand);
	commands.push(scenario.record);
	const { discovery, hooks } = await discoverAndHook(skills, installedBin, base, provenanceRunCommand);
	const host = await probeHost({
		installedBin,
		codexBin,
		base,
		hostEnv,
		apiKey: normalizedApiKey === "" ? "" : "provenance-bound-auth",
		scope,
		runCommand: hostRunCommand,
		nonceFactory,
	});
	return {
		schema: "litcodex.uiux-installed-probe/v4",
		scope,
		status: host.status,
		package: {
			tarballSha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"),
			installedPackagePresent: existsSync(installedPackage),
			managedMarketplacePresent: existsSync(managedMarketplace),
			sourceFallbackUnavailable: !existsSync(join(installedPackage, "plugins/litcodex/skills/visual-qa")),
		},
		setupCommands,
		semanticCommands: commands,
		discovery,
		hooks,
		doctor: host.doctor,
		hostExecution: host.hostExecution,
		counts: {
			setupCommands: setupCommands.length,
			semanticCommands: commands.length,
			discoveredSkills: discovery.length,
			zeroStdoutHooks: hooks.filter(({ stdoutBytes }) => stdoutBytes === 0).length,
			scenarios: scenario.result.count,
			scenarioAssertions: scenario.result.scenarios.reduce((sum, item) => sum + item.assertions.length, 0),
		},
	};
}

function scopeFrom(argv) {
	const index = argv.indexOf("--scope");
	const scope = index === -1 ? "full" : argv[index + 1];
	if ((scope !== "doctor" && scope !== "full") || (index !== -1 && index + 2 !== argv.length)) {
		throw new ProbeTerminalError("FAIL_HOST_EXECUTION", "arguments", "usage: --scope <doctor|full>");
	}
	return scope;
}

function commandFailure(phase, result) {
	if (result.aborted) throw new Error(`${phase} interrupted`);
	if (result.timedOut || result.spawnError?.code === "ETIMEDOUT") {
		throw new ProbeTerminalError("FAIL_HOST_TIMEOUT", phase, `${phase} timed out`);
	}
	if (result.spawnError?.code === "ENOENT" || result.spawnError?.code === "EACCES") {
		throw new ProbeTerminalError("FAIL_HOST_COMMAND_MISSING", phase, `${phase} command unavailable`);
	}
	if (result.exitCode !== 0) {
		throw new ProbeTerminalError("FAIL_HOST_EXECUTION", phase, `${phase} exited ${result.exitCode}`, {
			exitCode: result.exitCode,
			stderrEvidence: outputEvidence(result.stderr),
		});
	}
}

function strictObject(stdout, phase) {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new ProbeTerminalError("FAIL_HOST_MALFORMED", phase, `${phase} did not emit one JSON object`);
	}
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new ProbeTerminalError("FAIL_HOST_MALFORMED", phase, `${phase} JSON was not an object`);
	}
	return parsed;
}

function executable(path) {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function setupInstalledProbe({
	root,
	prefix,
	home,
	codexHome,
	codexBin,
	setupEnv,
	signal,
	runCommand = timedAsync,
	codexIdentity,
	assertCodexIdentity = assertRepositoryCodexIdentity,
}) {
	const pack = join(root, "pack");
	const project = join(home, "project");
	for (const path of [pack, prefix, codexHome, project]) mkdirSync(path, { recursive: true });
	assertAuthFreeCodexHome(codexHome, "setup");
	const provenanceRunCommand = (command, args, options) => {
		assertCodexIdentity(codexIdentity);
		return runCommand(command, args, options);
	};
	const firstHost = await verifyLockedCodexAsync({
		codexBin,
		signal,
		env: setupEnv,
		runCommand: provenanceRunCommand,
	});
	const packNpm = resolveNpmInvocation([
		"pack",
		"--workspace=packages/litcodex-ai",
		"--pack-destination",
		pack,
		"--json",
	]);
	const packed = await provenanceRunCommand(packNpm.command, packNpm.args, {
		cwd: repoRoot,
		env: setupEnv,
		timeout: 120_000,
		signal,
	});
	commandFailure("npm-pack", packed);
	const tarballs = readdirSync(pack).filter((name) => name.endsWith(".tgz"));
	if (tarballs.length !== 1) {
		throw new ProbeTerminalError("FAIL_HOST_MALFORMED", "npm-pack", `expected one tarball, found ${tarballs.length}`);
	}
	const tarball = join(pack, tarballs[0]);
	const installNpm = resolveNpmInvocation(["install", "-g", "--prefix", prefix, tarball]);
	const installed = await provenanceRunCommand(installNpm.command, installNpm.args, {
		cwd: root,
		env: setupEnv,
		timeout: 120_000,
		signal,
	});
	commandFailure("npm-install-global", installed);
	assertAuthFreeCodexHome(codexHome, "postinstall");
	const secondHost = await verifyLockedCodexAsync({
		codexBin,
		signal,
		env: setupEnv,
		runCommand: provenanceRunCommand,
	});
	const installedBin = join(prefix, "bin/litcodex");
	if (!executable(installedBin)) {
		throw new ProbeTerminalError(
			"FAIL_HOST_COMMAND_MISSING",
			"installed-litcodex",
			"packed global install did not provide an executable litcodex",
		);
	}
	const install = await provenanceRunCommand(installedBin, ["install", "--no-tui", "--codex-autonomous", "--json"], {
		cwd: project,
		env: setupEnv,
		timeout: 120_000,
		signal,
	});
	commandFailure("litcodex-install", install);
	const installReport = strictObject(install.stdout, "litcodex-install");
	if (
		installReport.ok !== true ||
		!Array.isArray(installReport.steps) ||
		installReport.steps.some((step) => step?.status === "failed")
	) {
		throw new ProbeTerminalError("FAIL_HOST_EXECUTION", "litcodex-install", "installer reported unhealthy state");
	}
	assertAuthFreeCodexHome(codexHome, "installed semantic and doctor");
	return {
		tarball,
		installedBin,
		setupCommands: [
			{
				name: "codex-version-before",
				exitCode: firstHost.exitCode,
				durationMs: firstHost.durationMs,
				stdoutBytes: firstHost.stdoutBytes,
				stdoutSha256: firstHost.stdoutSha256,
				stderrEvidence: firstHost.stderrEvidence,
			},
			{
				name: "npm-pack",
				exitCode: packed.exitCode,
				durationMs: packed.durationMs,
				stdoutBytes: Buffer.byteLength(packed.stdout),
				stdoutSha256: createHash("sha256").update(packed.stdout).digest("hex"),
				stderrEvidence: outputEvidence(packed.stderr),
			},
			{
				name: "npm-install-global",
				exitCode: installed.exitCode,
				durationMs: installed.durationMs,
				stdoutBytes: Buffer.byteLength(installed.stdout),
				stdoutSha256: createHash("sha256").update(installed.stdout).digest("hex"),
				stderrEvidence: outputEvidence(installed.stderr),
			},
			{
				name: "codex-version-after",
				exitCode: secondHost.exitCode,
				durationMs: secondHost.durationMs,
				stdoutBytes: secondHost.stdoutBytes,
				stdoutSha256: secondHost.stdoutSha256,
				stderrEvidence: secondHost.stderrEvidence,
			},
			{
				name: "litcodex-install",
				exitCode: install.exitCode,
				durationMs: install.durationMs,
				stdoutBytes: Buffer.byteLength(install.stdout),
				stdoutSha256: createHash("sha256").update(install.stdout).digest("hex"),
				stderrEvidence: outputEvidence(install.stderr),
			},
		],
	};
}

export async function runInstalledProbe(argv = process.argv.slice(2)) {
	let root = null;
	let scope = "full";
	const runId = randomUUID();
	const receipt = await runProbeLifecycle({
		evidencePath,
		runId,
		operation: async ({ signal }) => {
			scope = scopeFrom(argv);
			const requestedCodexBin = process.env.CODEX_BIN?.trim() ?? "";
			const codexIdentity = captureRepositoryCodexIdentity({ repoRoot, codexBin: requestedCodexBin });
			const codexBin = codexIdentity.codexBin;
			root = mkdtempSync(join(tmpdir(), "lit-uiux-installed-"));
			const prefix = join(root, "npm-prefix");
			const home = join(root, "home");
			const codexHome = join(home, ".codex");
			const setupEnv = credentialFreeSetupEnv(home, codexHome, prefix, codexBin);
			const hostEnv = minimalHostExecEnv(setupEnv);
			const apiKey = scope === "full" ? process.env.OPENAI_API_KEY : undefined;
			const setup = await setupInstalledProbe({
				root,
				prefix,
				home,
				codexHome,
				codexBin,
				setupEnv,
				signal,
				codexIdentity,
			});
			const probe = await semanticProbe({
				root,
				tarball: setup.tarball,
				prefix,
				setupEnv,
				hostEnv,
				setupCommands: setup.setupCommands,
				scope,
				codexBin,
				signal,
				apiKey,
				codexIdentity,
			});
			if (probe.status !== "PASS") {
				probe.failure = {
					phase: probe.doctor.status === "PASS" ? "host-execution" : "doctor",
					message: `required ${scope} scope ended ${probe.status}`,
				};
			}
			return probe;
		},
		cleanup: async () => {
			if (root !== null) await rm(root, { recursive: true, force: true });
			return { sandboxRoot: root, removed: root === null || !existsSync(root) };
		},
	});
	process.stdout.write(
		`uiux installed probe: ${receipt.status} (${receipt.counts?.semanticCommands ?? 0} semantic, ${receipt.counts?.scenarios ?? 0} scenarios, host=${receipt.hostExecution?.status ?? "NOT_RUN"})\n`,
	);
	return receipt.interruption?.exitCode ?? (receipt.status === "PASS" ? 0 : 1);
}

if (isMain(import.meta.url)) {
	try {
		process.exitCode = await runInstalledProbe();
	} catch (error) {
		process.stderr.write(
			`uiux installed probe: FAIL_HOST_EXECUTION: ${boundedErrorMessage(error, "unexpected probe failure")}\n`,
		);
		process.exitCode = 1;
	}
}
