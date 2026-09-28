import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rename as renameAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, it } from "node:test";
import { pathToFileURL } from "node:url";

import * as helpers from "./uiux-installed-probe-helpers.mjs";

const roots = [];

function runEvidencePath(evidencePath, runId) {
	return join(dirname(evidencePath), "task-uiux-installed-runs", `${runId}.json`);
}

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it("atomically invalidates stale PASS before the sentinel read, then writes terminal cleanup", async () => {
	assert.equal(typeof helpers.runProbeLifecycle, "function");
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-lifecycle-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	writeFileSync(evidencePath, '{"runId":"stale","status":"PASS"}\n');

	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "fresh-run",
		now: () => "2026-07-27T12:00:00.000Z",
		readSentinel: () => {
			const inProgress = JSON.parse(readFileSync(evidencePath, "utf8"));
			const archivedInProgress = JSON.parse(readFileSync(runEvidencePath(evidencePath, "fresh-run"), "utf8"));
			assert.equal(inProgress.runId, "fresh-run");
			assert.equal(inProgress.status, "IN_PROGRESS");
			assert.equal(archivedInProgress.runId, "fresh-run");
			assert.equal(archivedInProgress.status, "IN_PROGRESS");
			return { path: "/real/.codex/config.toml", exists: true, sha256: "same" };
		},
		operation: () => {
			throw new helpers.ProbeTerminalError("FAIL_HOST_EXECUTION", "install", "installed command failed");
		},
		cleanup: () => ({ sandboxRoot: join(root, "sandbox"), removed: true }),
	});

	const persisted = JSON.parse(readFileSync(evidencePath, "utf8"));
	assert.equal(receipt.status, "FAIL_HOST_EXECUTION");
	assert.equal(persisted.runId, "fresh-run");
	assert.equal(persisted.status, "FAIL_HOST_EXECUTION");
	assert.equal(persisted.failure.phase, "install");
	assert.deepEqual(persisted.cleanup, { removed: true });
	assert.equal(persisted.liveSentinel.unchanged, true);
	assert.notEqual(persisted.runId, "stale");
	assert.deepEqual(JSON.parse(readFileSync(runEvidencePath(evidencePath, "fresh-run"), "utf8")), persisted);
});

it("persists thrown non-terminal exceptions as fresh execution failures", async () => {
	assert.equal(typeof helpers.runProbeLifecycle, "function");
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-throw-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "throw-run",
		now: () => "2026-07-27T12:00:00.000Z",
		readSentinel: () => ({ path: "/real/.codex/config.toml", exists: false, sha256: null }),
		operation: () => {
			throw new Error("unexpected");
		},
		cleanup: () => ({ sandboxRoot: null, removed: true }),
	});
	assert.equal(receipt.status, "FAIL_HOST_EXECUTION");
	assert.equal(receipt.failure.phase, "unexpected-exception");
	assert.equal(JSON.parse(readFileSync(evidencePath, "utf8")).runId, "throw-run");
});

it("blocks before operation, still cleans up, and replaces stale PASS when the before sentinel read throws", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-before-sentinel-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	writeFileSync(evidencePath, '{"runId":"stale-pass","status":"PASS"}\n');
	let reads = 0;
	let operationInvoked = false;
	let cleanupInvoked = false;
	const secret = "sk-config-secret-must-not-persist";

	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "before-read-failure",
		now: () => "2026-07-27T12:00:00.000Z",
		readSentinel: () => {
			reads += 1;
			if (reads === 1) {
				throw Object.assign(new Error(`api_key=${secret} ${"x".repeat(1_000)}`), { code: "EACCES" });
			}
			return { path: "/real/.codex/config.toml", exists: true, sha256: "a".repeat(64) };
		},
		operation: () => {
			operationInvoked = true;
			return { status: "PASS" };
		},
		cleanup: () => {
			cleanupInvoked = true;
			return { sandboxRoot: null, removed: true };
		},
	});

	const persistedText = readFileSync(evidencePath, "utf8");
	const persisted = JSON.parse(persistedText);
	assert.equal(operationInvoked, false);
	assert.equal(cleanupInvoked, true);
	assert.equal(reads, 2);
	assert.equal(receipt.status, "BLOCKED_HOST_CONFIG_UNREADABLE");
	assert.equal(persisted.runId, "before-read-failure");
	assert.equal(persisted.status, "BLOCKED_HOST_CONFIG_UNREADABLE");
	assert.equal(persisted.failure.phase, "live-sentinel-before");
	assert.equal(persisted.liveSentinel.before.status, "ERROR");
	assert.equal(persisted.liveSentinel.before.error.code, "EACCES");
	assert.deepEqual(persisted.liveSentinel.after, {
		exists: true,
		sha256: "a".repeat(64),
	});
	assert.equal(Object.hasOwn(persisted.liveSentinel, "unchanged"), false);
	assert.deepEqual(persisted.cleanup, { removed: true });
	assert.equal(persistedText.includes(secret), false);
	assert.ok(persisted.failure.message.length <= 240);
	assert.notEqual(persisted.runId, "stale-pass");
});

it("fails after a completed operation, preserves the before sentinel, and persists cleanup when the after read throws", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-after-sentinel-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	let reads = 0;
	let cleanupInvoked = false;
	const before = { path: "/real/.codex/config.toml", exists: true, sha256: "b".repeat(64) };

	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "after-read-failure",
		now: () => "2026-07-27T12:00:00.000Z",
		readSentinel: () => {
			reads += 1;
			if (reads === 1) return before;
			throw Object.assign(new Error("postflight read failed"), { code: "EIO" });
		},
		operation: () => ({ status: "PASS", scope: "doctor" }),
		cleanup: () => {
			cleanupInvoked = true;
			return { sandboxRoot: join(root, "sandbox"), removed: true };
		},
	});

	const persisted = JSON.parse(readFileSync(evidencePath, "utf8"));
	assert.equal(cleanupInvoked, true);
	assert.equal(receipt.status, "FAIL_HOST_EXECUTION");
	assert.equal(persisted.runId, "after-read-failure");
	assert.equal(persisted.failure.phase, "live-sentinel-after");
	assert.deepEqual(persisted.liveSentinel.before, { exists: true, sha256: "b".repeat(64) });
	assert.equal(persisted.liveSentinel.after.status, "ERROR");
	assert.equal(persisted.liveSentinel.after.error.code, "EIO");
	assert.equal(Object.hasOwn(persisted.liveSentinel, "unchanged"), false);
	assert.deepEqual(persisted.cleanup, { removed: true });
});

it("persists both sentinel diagnostics and cleanup when both reads throw", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-both-sentinels-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	let reads = 0;
	let operationInvoked = false;
	let cleanupInvoked = false;

	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "both-read-failures",
		now: () => "2026-07-27T12:00:00.000Z",
		readSentinel: () => {
			reads += 1;
			throw Object.assign(new Error(`sentinel read ${reads} failed`), { code: reads === 1 ? "EACCES" : "EIO" });
		},
		operation: () => {
			operationInvoked = true;
			return { status: "PASS" };
		},
		cleanup: () => {
			cleanupInvoked = true;
			return { sandboxRoot: null, removed: true };
		},
	});

	const persisted = JSON.parse(readFileSync(evidencePath, "utf8"));
	assert.equal(operationInvoked, false);
	assert.equal(cleanupInvoked, true);
	assert.equal(reads, 2);
	assert.equal(receipt.status, "BLOCKED_HOST_CONFIG_UNREADABLE");
	assert.equal(persisted.failure.phase, "live-sentinel-before");
	assert.equal(persisted.liveSentinel.before.error.code, "EACCES");
	assert.equal(persisted.liveSentinel.after.error.code, "EIO");
	assert.equal(Object.hasOwn(persisted.liveSentinel, "unchanged"), false);
	assert.deepEqual(persisted.cleanup, { removed: true });
});

it("keeps the normal PASS sentinel hashes and typed cleanup receipt", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-normal-pass-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	const sentinel = { path: "/real/.codex/config.toml", exists: true, sha256: "c".repeat(64) };
	const persistedSentinel = { exists: true, sha256: "c".repeat(64) };

	const beforeSigintListeners = process.listenerCount("SIGINT");
	const beforeSigtermListeners = process.listenerCount("SIGTERM");
	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "normal-pass",
		now: () => "2026-07-27T12:00:00.000Z",
		readSentinel: () => sentinel,
		operation: () => ({ status: "PASS", scope: "doctor" }),
		cleanup: () => ({ sandboxRoot: join(root, "sandbox"), removed: true }),
	});

	const persisted = JSON.parse(readFileSync(evidencePath, "utf8"));
	assert.equal(receipt.status, "PASS");
	assert.equal(persisted.status, "PASS");
	assert.deepEqual(persisted.liveSentinel, {
		before: persistedSentinel,
		after: persistedSentinel,
		unchanged: true,
	});
	assert.deepEqual(persisted.cleanup, { removed: true });
	assert.equal(process.listenerCount("SIGINT"), beforeSigintListeners);
	assert.equal(process.listenerCount("SIGTERM"), beforeSigtermListeners);
});

it("retains distinct doctor, full, and doctor terminal receipts while latest points to the last run", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-sequential-runs-test-"));
	roots.push(root);
	const evidencePath = join(root, "task-uiux-installed-receipt.json");
	const sentinel = { path: "/real/.codex/config.toml", exists: false, sha256: null };
	const runs = [
		{ runId: "doctor-first", scope: "doctor", status: "PASS", timestamp: "2026-07-28T01:00:00.000Z" },
		{
			runId: "full-no-auth",
			scope: "full",
			status: "BLOCKED_HOST_AUTH_UNAVAILABLE",
			timestamp: "2026-07-28T01:01:00.000Z",
		},
		{ runId: "doctor-last", scope: "doctor", status: "PASS", timestamp: "2026-07-28T01:02:00.000Z" },
	];

	for (const run of runs) {
		await helpers.runProbeLifecycle({
			evidencePath,
			runId: run.runId,
			now: () => run.timestamp,
			readSentinel: () => sentinel,
			operation: () => ({ status: run.status, scope: run.scope }),
			cleanup: () => ({ sandboxRoot: join(root, run.runId), removed: true }),
		});
	}

	const archiveDirectory = join(root, "task-uiux-installed-runs");
	assert.deepEqual(readdirSync(archiveDirectory).sort(), runs.map(({ runId }) => `${runId}.json`).sort());
	for (const run of runs) {
		const archived = JSON.parse(readFileSync(runEvidencePath(evidencePath, run.runId), "utf8"));
		assert.equal(archived.runId, run.runId);
		assert.equal(archived.scope, run.scope);
		assert.equal(archived.status, run.status);
		assert.deepEqual(archived.cleanup, { removed: true });
		assert.equal(archived.startedAt, run.timestamp);
		assert.equal(archived.endedAt, run.timestamp);
	}
	const latest = JSON.parse(readFileSync(evidencePath, "utf8"));
	assert.equal(latest.runId, "doctor-last");
	assert.equal(latest.status, "PASS");
	assert.equal(
		readdirSync(archiveDirectory).some((name) => name.endsWith(".tmp")),
		false,
	);
	if (process.platform !== "win32") {
		assert.equal(statSync(archiveDirectory).mode & 0o777, 0o700);
		assert.equal(statSync(evidencePath).mode & 0o777, 0o600);
		for (const run of runs) assert.equal(statSync(runEvidencePath(evidencePath, run.runId)).mode & 0o777, 0o600);
	}
});

it("projects successful operation evidence without any path, argv, environment, or raw-stream canaries", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-success-secret-test-"));
	roots.push(root);
	const evidencePath = join(root, "task-uiux-installed-receipt.json");
	const canaries = {
		repoRoot: `npm_${"R".repeat(36)}`,
		tempRoot: `ghp_${"T".repeat(36)}`,
		npmPrefix: `sk-proj-${"P".repeat(32)}`,
		codexPath: `github_pat_${"C".repeat(32)}`,
		commandArg: `xoxb-${"A".repeat(24)}`,
		environmentName: `SECRET_${`gho_${"N".repeat(36)}`}`,
		environmentValue: `AIza${"V".repeat(24)}`,
	};
	const scenarioIds = [
		"public-service-form-ko",
		"fintech-dashboard",
		"healthcare-mobile",
		"saas-landing-responsive",
		"brownfield-design-system",
		"reference-fidelity",
		"cjk-terminal-dashboard",
		"missing-capture-auth-review",
	];
	const semanticNames = [
		"documented-autoresearch-helper",
		"documented-autoconference-helper",
		"documented-design-validator",
		"installed-visual-design-validator",
		"installed-beta-evidence-pass",
		"installed-beta-evidence-missing",
		"installed-beta-evidence-non-image",
		"installed-beta-evidence-stale",
		"installed-beta-evidence-root-escape",
		"installed-beta-evidence-symlink",
		"installed-beta-evidence-reviewer-block",
		"documented-image-diff",
		"documented-tui-check",
		"scenario-table",
	];
	const commandRecords = semanticNames.map((name, index) => ({
		name,
		command: [join("/tmp", canaries.codexPath, "bin"), `--arg=${canaries.commandArg}`],
		exitCode: 0,
		durationMs: index + 0.5,
		stdout: `raw stdout ${canaries.tempRoot}`,
		stderr: `raw stderr ${canaries.npmPrefix}`,
		stdoutBytes: 20 + index,
		stdoutSha256: `${index + 1}`.repeat(64),
		stderrEvidence: { bytes: 0, sha256: "f".repeat(64) },
		...(name === "scenario-table" ? { scenarioIds, semanticAssertions: 44 } : {}),
	}));

	await helpers.runProbeLifecycle({
		evidencePath,
		runId: "safe-success-receipt",
		readSentinel: () => ({
			path: join("/config", canaries.repoRoot, "config.toml"),
			exists: false,
			sha256: null,
		}),
		operation: () => ({
			status: "PASS",
			scope: "doctor",
			cwd: join("/repo", canaries.repoRoot),
			sandboxCwd: join("/tmp", canaries.tempRoot),
			environmentVariableNames: [canaries.environmentName],
			environment: { [canaries.environmentName]: canaries.environmentValue },
			package: {
				tarballSha256: "a".repeat(64),
				installedOrigin: join("/prefix", canaries.npmPrefix, "litcodex-ai"),
				managedMarketplaceOrigin: join("/home", canaries.tempRoot, "marketplace"),
				installedPackagePresent: true,
				managedMarketplacePresent: true,
				sourceFallbackUnavailable: true,
			},
			setupCommands: [
				{
					name: "codex-version-before",
					command: [join("/bin", canaries.codexPath), canaries.commandArg],
					exitCode: 0,
					durationMs: 1,
					stdoutBytes: 19,
					stdoutSha256: "b".repeat(64),
					stderrEvidence: { bytes: 0, sha256: "c".repeat(64) },
				},
			],
			semanticCommands: commandRecords,
			discovery: [
				{ id: "frontend-ui-ux", sha256: "d".repeat(64), path: join("/skills", canaries.repoRoot) },
				{ id: "visual-qa", sha256: "e".repeat(64) },
			],
			hooks: [
				{ id: "frontend-ui-ux", exitCode: 0, stdoutBytes: 0, durationMs: 1 },
				{ id: "visual-qa", exitCode: 0, stdoutBytes: 0, durationMs: 1 },
			],
			doctor: {
				status: "PASS",
				exitCode: 0,
				stdout: `raw doctor ${canaries.environmentValue}`,
				stderr: `raw doctor error ${canaries.commandArg}`,
				stdoutBytes: 24,
				stdoutSha256: "1".repeat(64),
				stderrEvidence: { bytes: 0, sha256: "2".repeat(64) },
				report: { ok: true, issueCount: 0 },
			},
			hostExecution: {
				status: "NOT_REQUESTED",
				realCodex: false,
				attemptedSkillIds: [],
				blockedSkillIds: [],
				attempts: [
					{
						id: "frontend-ui-ux",
						status: "PASS",
						exitCode: 0,
						command: [join("/bin", canaries.codexPath), canaries.commandArg],
						stdout: canaries.environmentValue,
						stderr: canaries.environmentName,
						stdoutBytes: 10,
						stdoutSha256: "3".repeat(64),
						stderrEvidence: { bytes: 0, sha256: "4".repeat(64) },
					},
				],
			},
			counts: {
				setupCommands: 5,
				semanticCommands: 14,
				discoveredSkills: 2,
				zeroStdoutHooks: 2,
				scenarios: 8,
				scenarioAssertions: 44,
			},
		}),
		cleanup: () => ({ sandboxRoot: join("/tmp", canaries.tempRoot), removed: true }),
	});

	const latestText = readFileSync(evidencePath, "utf8");
	const archivedText = readFileSync(runEvidencePath(evidencePath, "safe-success-receipt"), "utf8");
	for (const canary of Object.values(canaries)) {
		assert.equal(latestText.includes(canary), false);
		assert.equal(archivedText.includes(canary), false);
	}
	const latest = JSON.parse(latestText);
	assert.deepEqual(JSON.parse(archivedText), latest);
	assert.equal(latest.status, "PASS");
	assert.equal(latest.scope, "doctor");
	assert.deepEqual(latest.package, {
		tarballSha256: "a".repeat(64),
		installedPackagePresent: true,
		managedMarketplacePresent: true,
		sourceFallbackUnavailable: true,
	});
	assert.deepEqual(
		latest.semanticCommands.map(({ name }) => name),
		semanticNames,
	);
	assert.equal(
		latest.semanticCommands.some((record) => Object.hasOwn(record, "command")),
		false,
	);
	assert.deepEqual(latest.semanticCommands[13].scenarioIds, scenarioIds);
	assert.equal(latest.semanticCommands[13].semanticAssertions, 44);
	assert.deepEqual(latest.setupCommands[0], {
		name: "codex-version-before",
		exitCode: 0,
		durationMs: 1,
		stdoutBytes: 19,
		stdoutSha256: "b".repeat(64),
		stderrEvidence: { bytes: 0, sha256: "c".repeat(64) },
	});
	assert.equal(latest.counts.semanticCommands, 14);
	assert.equal(latest.counts.scenarios, 8);
	assert.equal(latest.doctor.status, "PASS");
	assert.equal(latest.doctor.stdoutSha256, "1".repeat(64));
	assert.equal(Object.hasOwn(latest.doctor, "stdout"), false);
	assert.equal(Object.hasOwn(latest.doctor, "stderr"), false);
	assert.equal(latest.hostExecution.status, "NOT_REQUESTED");
	assert.equal(latest.hostExecution.attempts.length, 1);
	assert.equal(latest.hostExecution.attempts[0].stdoutSha256, "3".repeat(64));
	assert.equal(Object.hasOwn(latest.hostExecution.attempts[0], "command"), false);
	assert.equal(Object.hasOwn(latest.hostExecution.attempts[0], "stdout"), false);
	assert.equal(Object.hasOwn(latest.hostExecution.attempts[0], "stderr"), false);
	assert.equal(Object.hasOwn(latest, "cwd"), false);
	assert.equal(Object.hasOwn(latest, "sandboxCwd"), false);
	assert.equal(Object.hasOwn(latest, "environmentVariableNames"), false);
});

it("command records retain only bounded names and typed stream evidence", async () => {
	const commandCanary = `npm_${"Q".repeat(36)}`;
	const semanticOutput = JSON.stringify({ status: "PASS" });
	const record = await helpers.commandRecordAsync(
		"focused-command",
		process.execPath,
		["--eval", `process.stdout.write('${semanticOutput}')`, commandCanary],
		{},
		0,
		{ status: "PASS" },
	);
	const serialized = JSON.stringify(record);
	assert.equal(serialized.includes(commandCanary), false);
	assert.equal(serialized.includes(process.execPath), false);
	assert.equal(Object.hasOwn(record, "command"), false);
	assert.equal(record.name, "focused-command");
	assert.equal(record.exitCode, 0);
	assert.equal(record.stdoutBytes, Buffer.byteLength(semanticOutput));
	assert.match(record.stdoutSha256, /^[a-f0-9]{64}$/u);
	assert.deepEqual(record.stderrEvidence, { bytes: 0, sha256: createHash("sha256").update("").digest("hex") });
});

it("semantic command records reject contradictory trailing JSON after PASS", async () => {
	await assert.rejects(
		helpers.commandRecordAsync(
			"strict-semantic-command",
			process.execPath,
			[
				"--eval",
				`process.stdout.write('${JSON.stringify({ verdict: "PASS" })}\\n${JSON.stringify({ verdict: "FAIL" })}\\n')`,
			],
			{},
			0,
			{ verdict: "PASS" },
		),
		/exactly one JSON object/u,
	);
});

it("semantic command records reject duplicate verdict keys before typed assertions", async () => {
	await assert.rejects(
		helpers.commandRecordAsync(
			"duplicate-key-semantic-command",
			process.execPath,
			["--eval", `process.stdout.write('${'{"verdict":"FAIL","verdict":"PASS"}'}')`],
			{},
			0,
			{ verdict: "PASS" },
		),
		/duplicate JSON key/u,
	);
});

it("redacts npm pack/install terminal details and never persists environment values", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-secret-test-"));
	roots.push(root);
	const secret = "sk-REVIEWSECRET123456789";

	for (const phase of ["npm-pack", "npm-install-global"]) {
		const evidencePath = join(root, `${phase}.json`);
		await helpers.runProbeLifecycle({
			evidencePath,
			runId: `${phase}-secret-run`,
			readSentinel: () => ({ path: "/real/.codex/config.toml", exists: false, sha256: null }),
			operation: () => {
				throw new helpers.ProbeTerminalError("FAIL_HOST_EXECUTION", phase, `token=${secret}`, {
					stderr: `OPENAI_API_KEY=${secret}\narbitrary token=${secret}`,
					env: { OPENAI_API_KEY: secret, SAFE_NAME: "must-not-persist" },
					nested: [{ token: secret }],
				});
			},
			cleanup: () => ({ sandboxRoot: null, removed: true }),
		});

		const persistedText = readFileSync(evidencePath, "utf8");
		const archivedText = readFileSync(runEvidencePath(evidencePath, `${phase}-secret-run`), "utf8");
		const persisted = JSON.parse(persistedText);
		assert.equal(persisted.failure.phase, phase);
		assert.equal(persistedText.includes(secret), false);
		assert.equal(archivedText.includes(secret), false);
		assert.equal(persistedText.includes("must-not-persist"), false);
		assert.equal(archivedText.includes("must-not-persist"), false);
		assert.equal(Object.hasOwn(persisted.failure, "stderr"), false);
		assert.equal(Object.hasOwn(persisted.failure, "environmentVariableNames"), false);
		assert.equal(persisted.failure.stderrEvidence.bytes > 0, true);
		assert.match(persisted.failure.stderrEvidence.sha256, /^[a-f0-9]{64}$/u);
	}
});

it("persists only typed terminal and cleanup details across nested standard secret canaries", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-nested-secret-test-"));
	roots.push(root);
	const evidencePath = join(root, "receipt.json");
	const canaries = {
		npm: `npm_${"N".repeat(36)}`,
		github: `ghp_${"G".repeat(36)}`,
		githubFineGrained: `github_pat_${"F".repeat(32)}`,
		bearer: "bearer-value-CANARY-123456789",
		basic: "QmFzaWNVc2VyOkNBTkFSWVBhc3N3b3Jk",
		apiKey: "api-key-CANARY-123456789",
		password: "password-CANARY-123456789",
		cookie: "cookie-CANARY-123456789",
		urlPassword: "url-password-CANARY-123456789",
		privateKey: "private-key-CANARY-123456789",
	};
	const rawStderr = `diagnostic output ${canaries.npm} ${canaries.github}`;
	const message = `Benign diagnostic retained; Authorization: Bearer ${canaries.bearer}`;

	const receipt = await helpers.runProbeLifecycle({
		evidencePath,
		runId: "nested-secret-run",
		readSentinel: () => ({
			path: join(root, canaries.github, "config.toml"),
			exists: false,
			sha256: null,
			arbitrary: { token: canaries.npm },
		}),
		operation: () => {
			throw new helpers.ProbeTerminalError("FAIL_HOST_EXECUTION", "npm-pack", message, {
				exitCode: 17,
				durationMs: 12.5,
				stderr: rawStderr,
				codexBin: join(root, canaries.npm, "codex"),
				env: { OPENAI_API_KEY: canaries.apiKey },
				stack: `Error: ${canaries.password}`,
				nested: [
					{ npmToken: canaries.npm, githubToken: canaries.github },
					{
						authorization: `Bearer ${canaries.bearer}`,
						basicAuthorization: `Basic ${canaries.basic}`,
						api_key: canaries.apiKey,
						password: canaries.password,
						cookie: `session=${canaries.cookie}`,
						url: `https://user:${canaries.urlPassword}@example.test/private`,
						privateKey: `-----BEGIN PRIVATE KEY-----\n${canaries.privateKey}\n-----END PRIVATE KEY-----`,
					},
				],
			});
		},
		cleanup: () => ({
			sandboxRoot: join(root, canaries.githubFineGrained),
			removed: true,
			timedOut: false,
			nested: { cookie: canaries.cookie },
		}),
	});

	const persistedText = readFileSync(evidencePath, "utf8");
	const persisted = JSON.parse(persistedText);
	for (const canary of Object.values(canaries)) assert.equal(persistedText.includes(canary), false);
	assert.equal(persistedText.includes("-----BEGIN PRIVATE KEY-----"), false);
	assert.equal(receipt.status, "FAIL_HOST_EXECUTION");
	assert.equal(persisted.failure.phase, "npm-pack");
	assert.match(persisted.failure.message, /^Benign diagnostic retained;/u);
	assert.ok(persisted.failure.message.length <= 240);
	assert.equal(persisted.failure.exitCode, 17);
	assert.equal(persisted.failure.durationMs, 12.5);
	assert.deepEqual(persisted.failure.stderrEvidence, {
		bytes: Buffer.byteLength(rawStderr),
		sha256: createHash("sha256").update(rawStderr).digest("hex"),
	});
	assert.equal(Object.hasOwn(persisted.failure, "codexBin"), false);
	assert.equal(Object.hasOwn(persisted.failure, "env"), false);
	assert.equal(Object.hasOwn(persisted.failure, "environmentVariableNames"), false);
	assert.equal(Object.hasOwn(persisted.failure, "nested"), false);
	assert.equal(Object.hasOwn(persisted.failure, "stack"), false);
	assert.deepEqual(persisted.cleanup, { removed: true, timedOut: false });
	assert.deepEqual(persisted.liveSentinel, {
		before: { exists: false, sha256: null },
		after: { exists: false, sha256: null },
		unchanged: true,
	});
	const archivedText = readFileSync(runEvidencePath(evidencePath, "nested-secret-run"), "utf8");
	for (const canary of Object.values(canaries)) assert.equal(archivedText.includes(canary), false);
	assert.deepEqual(JSON.parse(archivedText), persisted);
});

it("fails closed and removes temporary files when the initial archive write fails", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-archive-write-failure-test-"));
	roots.push(root);
	const evidencePath = join(root, "task-uiux-installed-receipt.json");
	const archiveDirectory = join(root, "task-uiux-installed-runs");
	writeFileSync(evidencePath, '{"runId":"stale","status":"PASS"}\n');
	let operationInvoked = false;

	await assert.rejects(
		helpers.runProbeLifecycle({
			evidencePath,
			runId: "archive-write-failure",
			readSentinel: () => ({ exists: false, sha256: null }),
			operation: () => {
				operationInvoked = true;
				return { status: "PASS" };
			},
			cleanup: () => ({ removed: true }),
			receiptIo: {
				writeFile: async (path, ...args) => {
					if (dirname(path) === archiveDirectory)
						throw Object.assign(new Error("archive write failed"), { code: "EIO" });
					return writeFileAsync(path, ...args);
				},
			},
		}),
		{ code: "EIO" },
	);

	assert.equal(operationInvoked, false);
	assert.notEqual(JSON.parse(readFileSync(evidencePath, "utf8")).status, "PASS");
	assert.equal(existsSync(runEvidencePath(evidencePath, "archive-write-failure")), false);
	assert.deepEqual(readdirSync(archiveDirectory), []);
});

it("fails closed on terminal archive rename failure while preserving both IN_PROGRESS receipts and cleanup", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-archive-rename-failure-test-"));
	roots.push(root);
	const evidencePath = join(root, "task-uiux-installed-receipt.json");
	const archivedPath = runEvidencePath(evidencePath, "archive-rename-failure");
	let cleanupInvoked = false;

	await assert.rejects(
		helpers.runProbeLifecycle({
			evidencePath,
			runId: "archive-rename-failure",
			readSentinel: () => ({ exists: false, sha256: null }),
			operation: () => ({ status: "PASS", scope: "doctor" }),
			cleanup: () => {
				cleanupInvoked = true;
				return { sandboxRoot: join(root, "secret-sandbox"), removed: true };
			},
			receiptIo: {
				rename: async (from, to) => {
					if (to === archivedPath) throw Object.assign(new Error("archive rename failed"), { code: "EIO" });
					return renameAsync(from, to);
				},
			},
		}),
		{ code: "EIO" },
	);

	assert.equal(cleanupInvoked, true);
	assert.equal(JSON.parse(readFileSync(evidencePath, "utf8")).status, "IN_PROGRESS");
	assert.equal(JSON.parse(readFileSync(archivedPath, "utf8")).status, "IN_PROGRESS");
	assert.deepEqual(readdirSync(dirname(archivedPath)), ["archive-rename-failure.json"]);
});

it("centrally redacts bounded human diagnostics without dropping benign context", () => {
	const cases = [
		[`npm_${"N".repeat(36)}`, (secret) => `path=/tmp/${secret}/codex`],
		[`gho_${"G".repeat(36)}`, (secret) => `github token ${secret}`],
		[`sk-proj-${"S".repeat(32)}`, (secret) => `OpenAI failure ${secret}`],
		[`xapp-1-${"A".repeat(24)}`, (secret) => `Slack app failure ${secret}`],
		["bearer-value-CANARY-123456789", (secret) => `Authorization: Bearer ${secret}`],
		["QmFzaWNVc2VyOkNBTkFSWVBhc3N3b3Jk", (secret) => `Basic ${secret}`],
		["api-key-CANARY-123456789", (secret) => `API_KEY=${secret}`],
		["password-CANARY-123456789", (secret) => `Password: ${secret}`],
		["cookie-CANARY-123456789", (secret) => `Set-Cookie: session=${secret}`],
		["url-password-CANARY-123456789", (secret) => `https://user:${secret}@example.test/path`],
		["private-key-CANARY-123456789", (secret) => `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`],
	];
	for (const [secret, secretText] of cases) {
		const diagnostic = helpers.boundedErrorMessage(`Benign context; ${secretText(secret)}`, "fallback");
		assert.match(diagnostic, /^Benign context;/u);
		assert.equal(diagnostic.includes(secret), false);
		assert.ok(diagnostic.length <= 240);
	}
});

async function waitFor(check, description, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.fail(`timed out waiting for ${description}`);
}

function spawnInterruptibleLifecycle(root, runId, cleanupDelayMs = 0, nestedCommand = true, cleanupHangs = false) {
	const evidencePath = join(root, "receipt.json");
	const archivedPath = runEvidencePath(evidencePath, runId);
	const sandbox = join(root, "sandbox");
	const readyPath = join(root, "operation-ready");
	const cleanupPath = join(root, "cleanup-active");
	const workerPidPath = join(root, "worker-pid");
	const workerExitPath = join(root, "worker-exit.json");
	writeFileSync(evidencePath, '{"runId":"stale","status":"PASS"}\n');
	const helperUrl = pathToFileURL(join(import.meta.dirname, "uiux-installed-probe-helpers.mjs")).href;
	const source = `
		import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
		import { runProbeLifecycle, timedAsync } from ${JSON.stringify(helperUrl)};
		const evidencePath = ${JSON.stringify(evidencePath)};
		const sandbox = ${JSON.stringify(sandbox)};
		await runProbeLifecycle({
			evidencePath,
			runId: ${JSON.stringify(runId)},
			cleanupTimeoutMs: ${cleanupHangs ? 100 : 1_000},
			readSentinel: () => ({ path: "/real/.codex/config.toml", exists: false, sha256: null }),
			operation: async ({ signal }) => {
				mkdirSync(sandbox, { recursive: true });
				${
					nestedCommand
						? `const worker = ${JSON.stringify(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(workerPidPath)}, String(process.pid)); writeFileSync(${JSON.stringify(readyPath)}, "ready\\n"); setInterval(() => {}, 1000);`)};
				const result = await timedAsync(process.execPath, ["--input-type=module", "--eval", worker], { signal });
				writeFileSync(${JSON.stringify(workerExitPath)}, JSON.stringify({
					pid: Number(readFileSync(${JSON.stringify(workerPidPath)}, "utf8")),
					exitCode: result.exitCode,
					signal: result.signal,
					aborted: result.aborted,
				}) + "\\n");
				if (signal.aborted || result.aborted) throw signal.reason;`
						: `writeFileSync(${JSON.stringify(readyPath)}, "ready\\n");
				await new Promise((resolve, reject) => {
					const timer = setInterval(() => {}, 1000);
					signal.addEventListener("abort", () => { clearInterval(timer); reject(signal.reason); }, { once: true });
				});`
				}
				return { status: "PASS" };
			},
			cleanup: async () => {
				writeFileSync(${JSON.stringify(cleanupPath)}, "active\\n");
				${cleanupHangs ? "await new Promise(() => {});" : ""}
				await new Promise((resolve) => setTimeout(resolve, ${cleanupDelayMs}));
				rmSync(sandbox, { recursive: true, force: true });
				return { sandboxRoot: sandbox, removed: !existsSync(sandbox) };
			},
		});
	`;
	const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	return {
		archivedPath,
		child,
		cleanupPath,
		evidencePath,
		readyPath,
		sandbox,
		workerExitPath,
		workerPidPath,
		stderr: () => stderr,
	};
}

function assertTimedWorkerExited(fixture, expectedPid = Number(readFileSync(fixture.workerPidPath, "utf8"))) {
	const workerExit = JSON.parse(readFileSync(fixture.workerExitPath, "utf8"));
	// timedAsync records this exact child's exit after its close event; a later PID lookup can observe a reused PID.
	assert.equal(workerExit.pid, expectedPid);
	assert.equal(workerExit.aborted, true);
	if (process.platform === "win32") assert.notEqual(workerExit.exitCode, 0);
	else {
		assert.equal(workerExit.exitCode, -1);
		assert.equal(workerExit.signal, "SIGTERM");
	}
}

async function waitForClose(child, stderr) {
	let timeout;
	const outcome = await Promise.race([
		new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
		new Promise((_, reject) => {
			timeout = setTimeout(() => reject(new Error(`child did not exit: ${stderr()}`)), 5_000);
		}),
	]);
	clearTimeout(timeout);
	return outcome;
}

for (const [signal, expectedExitCode] of [
	["SIGINT", 130],
	["SIGTERM", 143],
]) {
	it(`handles ${signal} during a real active lifecycle with cleanup and a terminal receipt`, async () => {
		const root = mkdtempSync(join(tmpdir(), `litcodex-probe-${signal.toLowerCase()}-test-`));
		roots.push(root);
		const fixture = spawnInterruptibleLifecycle(root, `${signal.toLowerCase()}-run`);
		await waitFor(() => existsSync(fixture.readyPath), "active operation");
		fixture.child.kill(signal);
		const outcome = await waitForClose(fixture.child, fixture.stderr);
		const receipt = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
		assert.equal(outcome.code, expectedExitCode);
		assert.equal(outcome.signal, null);
		assert.equal(receipt.runId, `${signal.toLowerCase()}-run`);
		assert.equal(receipt.status, "INTERRUPTED_SIGNAL");
		assert.equal(receipt.interruption.signal, signal);
		assert.deepEqual(receipt.cleanup, { removed: true });
		assert.deepEqual(JSON.parse(readFileSync(fixture.archivedPath, "utf8")), receipt);
		assert.equal(existsSync(fixture.sandbox), false);
		assert.notEqual(receipt.runId, "stale");
		assertTimedWorkerExited(fixture);
	});
}

it("coalesces a repeated signal during cleanup without leaking handlers or hanging", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-repeated-signal-test-"));
	roots.push(root);
	const fixture = spawnInterruptibleLifecycle(root, "repeated-signal-run", 250);
	await waitFor(() => existsSync(fixture.readyPath), "active operation");
	fixture.child.kill("SIGINT");
	await waitFor(() => existsSync(fixture.cleanupPath), "active cleanup");
	fixture.child.kill("SIGTERM");
	const outcome = await waitForClose(fixture.child, fixture.stderr);
	const receipt = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
	assert.equal(outcome.code, 130);
	assert.equal(receipt.status, "INTERRUPTED_SIGNAL");
	assert.equal(receipt.interruption.signal, "SIGINT");
	assert.equal(receipt.interruption.repeated, true);
	assert.equal(receipt.cleanup.removed, true);
	assert.deepEqual(JSON.parse(readFileSync(fixture.archivedPath, "utf8")), receipt);
	assert.equal(existsSync(fixture.sandbox), false);
	assertTimedWorkerExited(fixture);
});

it("bounds a hanging cleanup after interruption and persists the incomplete cleanup result", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-hanging-cleanup-test-"));
	roots.push(root);
	const fixture = spawnInterruptibleLifecycle(root, "hanging-cleanup-run", 0, true, true);
	await waitFor(() => existsSync(fixture.readyPath), "active operation");
	fixture.child.kill("SIGTERM");
	const outcome = await waitForClose(fixture.child, fixture.stderr);
	const receipt = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
	assert.equal(outcome.code, 143);
	assert.equal(receipt.status, "INTERRUPTED_SIGNAL");
	assert.deepEqual(receipt.cleanup, { removed: false, timedOut: true });
	assert.deepEqual(JSON.parse(readFileSync(fixture.archivedPath, "utf8")), receipt);
	assert.equal(existsSync(fixture.sandbox), true);
});

it("invalidates stale PASS before abrupt SIGKILL even though cleanup cannot run", async () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-probe-sigkill-test-"));
	roots.push(root);
	const fixture = spawnInterruptibleLifecycle(root, "sigkill-run", 0, false);
	await waitFor(() => existsSync(fixture.readyPath), "active operation");
	fixture.child.kill("SIGKILL");
	const outcome = await waitForClose(fixture.child, fixture.stderr);
	const receipt = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
	assert.equal(outcome.code, null);
	assert.equal(outcome.signal, "SIGKILL");
	assert.equal(receipt.runId, "sigkill-run");
	assert.equal(receipt.status, "IN_PROGRESS");
	assert.deepEqual(JSON.parse(readFileSync(fixture.archivedPath, "utf8")), receipt);
	assert.notEqual(receipt.status, "PASS");
	assert.equal(Object.hasOwn(receipt, "cleanup"), false);
});

it("blocks a lock-owned Codex executable missing before preflight without ambient fallback", () => {
	assert.equal(typeof helpers.verifyLockedCodex, "function");
	let invoked = false;
	assert.throws(
		() =>
			helpers.verifyLockedCodex({
				codexBin: "/repo/node_modules/.bin/codex",
				isExecutable: () => false,
				runCommand: () => {
					invoked = true;
				},
			}),
		(error) => error.status === "BLOCKED_HOST_UNAVAILABLE" && error.phase === "codex-preflight-before",
	);
	assert.equal(invoked, false);
});

it("blocks when the lock-owned executable disappears after version preflight", () => {
	assert.equal(typeof helpers.verifyLockedCodex, "function");
	let checks = 0;
	assert.throws(
		() =>
			helpers.verifyLockedCodex({
				codexBin: "/repo/node_modules/.bin/codex",
				isExecutable: () => ++checks === 1,
				runCommand: (command, args) => {
					assert.equal(command, "/repo/node_modules/.bin/codex");
					assert.deepEqual(args, ["--version"]);
					return { exitCode: 0, stdout: "codex-cli 0.144.0\n", stderr: "", durationMs: 1 };
				},
			}),
		(error) => error.status === "BLOCKED_HOST_UNAVAILABLE" && error.phase === "codex-preflight-after",
	);
	assert.equal(checks, 2);
});
