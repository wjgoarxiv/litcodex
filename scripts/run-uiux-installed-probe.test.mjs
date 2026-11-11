import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { resolveNpmInvocation } from "./npm-command.mjs";
import * as installedProbe from "./run-uiux-installed-probe.mjs";

const roots = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(label) {
	const root = mkdtempSync(join(tmpdir(), label));
	roots.push(root);
	return root;
}

function processResult({ exitCode = 0, stdout = "", stderr = "" } = {}) {
	return {
		exitCode,
		stdout,
		stderr,
		durationMs: 1,
		stdoutBytes: Buffer.byteLength(stdout),
		stderrBytes: Buffer.byteLength(stderr),
	};
}

function assertCredentialFree(env) {
	for (const name of Object.keys(env)) {
		assert.doesNotMatch(
			name,
			/(?:api[_-]?key|auth|cookie|credential|pass(?:word|phrase|wd)?|secret|session|token)/iu,
		);
	}
}

it("rejects an exact-version absolute spoof before execution or credential exposure", () => {
	const root = temporaryRoot("litcodex-uiux-spoof-");
	const spoof = join(root, "codex-spoof");
	const capturePath = join(root, "captured-key");
	const repoRoot = join(import.meta.dirname, "..");
	const evidencePath = join(repoRoot, ".litcodex/evidence/task-uiux-installed-receipt.json");
	const archiveDirectory = join(repoRoot, ".litcodex/evidence/task-uiux-installed-runs");
	const previousEvidence = existsSync(evidencePath) ? readFileSync(evidencePath) : null;
	const previousArchives = new Set(existsSync(archiveDirectory) ? readdirSync(archiveDirectory) : []);
	writeFileSync(
		spoof,
		`#!/bin/sh\nprintf '%s' "$OPENAI_API_KEY" > ${JSON.stringify(capturePath)}\nprintf 'codex-cli 0.163.0\\n'\n`,
	);
	chmodSync(spoof, 0o755);
	try {
		const result = spawnSync(process.execPath, [join(import.meta.dirname, "run-uiux-installed-probe.mjs")], {
			cwd: repoRoot,
			encoding: "utf8",
			env: {
				...process.env,
				CODEX_BIN: spoof,
				OPENAI_API_KEY: "must-never-reach-spoof",
			},
		});
		assert.equal(result.status, 1);
		assert.equal(existsSync(capturePath), false);
		const persistedText = readFileSync(evidencePath, "utf8");
		const persisted = JSON.parse(persistedText);
		assert.equal(persisted.status, "BLOCKED_HOST_UNAVAILABLE");
		assert.equal(persisted.failure.phase, "codex-provenance");
		assert.equal(persistedText.includes("must-never-reach-spoof"), false);
		assert.equal(persistedText.includes(spoof), false);
		const newArchives = readdirSync(archiveDirectory).filter((name) => !previousArchives.has(name));
		assert.equal(newArchives.length, 1);
		const archivedText = readFileSync(join(archiveDirectory, newArchives[0]), "utf8");
		assert.deepEqual(JSON.parse(archivedText), persisted);
		assert.equal(archivedText.includes("must-never-reach-spoof"), false);
		assert.equal(archivedText.includes(spoof), false);
	} finally {
		if (previousEvidence === null) rmSync(evidencePath, { force: true });
		else writeFileSync(evidencePath, previousEvidence);
		if (existsSync(archiveDirectory)) {
			for (const name of readdirSync(archiveDirectory)) {
				if (!previousArchives.has(name)) rmSync(join(archiveDirectory, name), { force: true });
			}
		}
	}
});

it("keeps pack, install, postinstall, installer, and Codex version checks credential-free", async () => {
	const root = temporaryRoot("litcodex-uiux-setup-env-");
	const home = join(root, "home");
	const codexHome = join(home, ".codex");
	const prefix = join(root, "prefix");
	const codexBin = join(root, "locked", "codex");
	mkdirSync(join(root, "locked"), { recursive: true });
	writeFileSync(codexBin, "#!/bin/sh\nexit 0\n");
	chmodSync(codexBin, 0o755);

	const ambient = {
		PATH: "/usr/bin:/bin",
		LANG: "C.UTF-8",
		SAFE_RUNTIME_FLAG: "retained-for-setup",
		OPENAI_API_KEY: "setup-must-not-see-this",
		NPM_TOKEN: "npm-must-not-see-this",
		HTTP_COOKIE: "cookie-must-not-leak",
		AUTHORIZATION: "Bearer must-not-leak",
		AWS_ACCESS_KEY_ID: "key-must-not-leak",
		SSH_AUTH_SOCK: "/credential/socket",
		GIT_ASKPASS: "/credential/askpass",
		HTTPS_PROXY: "https://proxy-user:proxy-password@example.test:8443",
	};
	const setupEnv = installedProbe.credentialFreeSetupEnv(home, codexHome, prefix, codexBin, ambient);
	assert.equal(setupEnv.SAFE_RUNTIME_FLAG, "retained-for-setup");
	assertCredentialFree(setupEnv);
	assert.equal(
		Object.values(setupEnv).some((value) => String(value).includes("must-not")),
		false,
	);

	const calls = [];
	const identityCheckCallCounts = [];
	const packNpm = resolveNpmInvocation([
		"pack",
		"--workspace=packages/litcodex-ai",
		"--pack-destination",
		join(root, "pack"),
		"--json",
	]);
	const installNpm = resolveNpmInvocation(["install", "-g", "--prefix", prefix, "placeholder.tgz"]);
	const runCommand = async (command, args, options) => {
		calls.push({ command, args, options });
		assert.deepEqual(options.env, setupEnv);
		assertCredentialFree(options.env);
		if (command === codexBin) return processResult({ stdout: "codex-cli 0.163.0\n" });
		if (command === packNpm.command && args.includes("pack")) {
			const destination = args[args.indexOf("--pack-destination") + 1];
			mkdirSync(destination, { recursive: true });
			writeFileSync(join(destination, "litcodex-ai-0.3.49.tgz"), "packed");
			return processResult({ stdout: "[]\n" });
		}
		if (command === installNpm.command && args.includes("install")) {
			const installedBin = join(prefix, "bin", "litcodex");
			mkdirSync(join(prefix, "bin"), { recursive: true });
			writeFileSync(installedBin, "#!/bin/sh\nexit 0\n");
			chmodSync(installedBin, 0o755);
			return processResult();
		}
		if (command === join(prefix, "bin", "litcodex")) {
			return processResult({ stdout: '{"ok":true,"steps":[]}\n' });
		}
		return processResult({ exitCode: 99, stderr: "unexpected command" });
	};

	const setup = await installedProbe.setupInstalledProbe({
		root,
		prefix,
		home,
		codexHome,
		codexBin,
		setupEnv,
		runCommand,
		codexIdentity: {},
		assertCodexIdentity: () => {
			identityCheckCallCounts.push(calls.length);
		},
	});

	assert.equal(setup.setupCommands.length, 5);
	assert.deepEqual(identityCheckCallCounts, [0, 1, 2, 3, 4]);
	assert.deepEqual(
		calls.map(({ command, args }) => [command, args[0]]),
		[
			[codexBin, "--version"],
			[packNpm.command, packNpm.args[0]],
			[installNpm.command, installNpm.args[0]],
			[codexBin, "--version"],
			[join(prefix, "bin", "litcodex"), "install"],
		],
	);
});

it("gives helpers, hooks, and doctor no auth while only both exact Codex exec children get the key", async () => {
	const root = temporaryRoot("litcodex-uiux-semantic-env-");
	const prefix = join(root, "prefix");
	const home = join(root, "home");
	const codexHome = join(home, ".codex");
	const codexBin = join(root, "locked", "codex");
	const installedBin = join(prefix, "bin", "litcodex");
	const installedPackage = join(prefix, "lib/node_modules/@litfamily/litcodex");
	const skills = join(codexHome, "marketplaces/litcodex/plugins/litcodex/skills");
	const frontendRoot = join(skills, "frontend-ui-ux");
	const visualRoot = join(skills, "visual-qa");
	const autoresearchRoot = join(skills, "autoresearch");
	const autoconferenceRoot = join(skills, "autoconference");
	for (const path of [
		installedPackage,
		frontendRoot,
		visualRoot,
		autoresearchRoot,
		autoconferenceRoot,
		join(prefix, "bin"),
		join(root, "pack"),
	]) {
		mkdirSync(path, { recursive: true });
	}
	writeFileSync(join(autoresearchRoot, "SKILL.md"), "loaded autoresearch skill\n");
	writeFileSync(join(autoconferenceRoot, "SKILL.md"), "loaded autoconference skill\n");
	writeFileSync(join(root, "pack", "litcodex-ai.tgz"), "packed");
	// The two interface skills are same-name stubs now; the probe still discovers them and binds the host run.
	writeFileSync(join(frontendRoot, "SKILL.md"), "frontend-ui-ux stub\n");
	writeFileSync(join(visualRoot, "SKILL.md"), "visual-qa stub\n");

	const setupEnv = installedProbe.credentialFreeSetupEnv(home, codexHome, prefix, codexBin, {
		PATH: "/usr/bin:/bin",
		LANG: "C.UTF-8",
		SAFE_RUNTIME_FLAG: "setup-only",
		OPENAI_API_KEY: "must-not-enter-setup",
		SESSION_TOKEN: "must-not-enter-setup",
	});
	const hostEnv = installedProbe.minimalHostExecEnv(setupEnv);
	const apiKey = "exact-host-exec-key";
	const calls = [];
	const identityCheckCallCounts = [];
	const responseFor = (id) =>
		`${JSON.stringify({
			type: "item.completed",
			item: {
				type: "agent_message",
				text: `🔥 **LIT IGNITED · ${id}** 🔥\nUIUX_HOST_PROBE_PASS:nonce`,
			},
		})}\n`;
	const runCommand = async (command, args, options) => {
		calls.push({ command, args, options });
		if (command === "python3" && args[0]?.endsWith("init_research.py")) {
			return processResult({ stdout: "Research project scaffolded\n" });
		}
		if (command === "python3" && args[0]?.endsWith("init_conference.py")) {
			return processResult({ stdout: "Conference scaffolded\n" });
		}
		if (command === installedBin && args[0] === "hook") return processResult();
		if (command === installedBin && args[0] === "doctor") {
			return processResult({ stdout: '{"ok":true,"issues":[]}\n' });
		}
		if (command === codexBin && args[0] === "exec") {
			const id = args.at(-1).includes("frontend-ui-ux") ? "frontend-ui-ux" : "visual-qa";
			return processResult({ stdout: responseFor(id) });
		}
		return processResult({ exitCode: 99, stderr: "unexpected command" });
	};

	const report = await installedProbe.semanticProbe({
		root,
		tarball: join(root, "pack", "litcodex-ai.tgz"),
		prefix,
		setupEnv,
		hostEnv,
		apiKey,
		scope: "full",
		codexBin,
		runCommand,
		nonceFactory: () => "nonce",
		codexIdentity: {},
		assertCodexIdentity: () => {
			identityCheckCallCounts.push(calls.length);
		},
	});

	assert.equal(report.status, "PASS");
	assert.equal(report.counts.semanticCommands, 2);
	assert.deepEqual(
		report.semanticCommands.map(({ name }) => name),
		["documented-autoresearch-helper", "documented-autoconference-helper"],
	);
	assert.deepEqual(
		identityCheckCallCounts,
		calls.map((_, index) => index),
	);
	const codexExecCalls = calls.filter(({ command, args }) => command === codexBin && args[0] === "exec");
	const nonCodexCalls = calls.filter(({ command, args }) => command !== codexBin || args[0] !== "exec");
	assert.equal(codexExecCalls.length, 2);
	assert.equal(nonCodexCalls.length, 5);
	for (const { options } of nonCodexCalls) {
		assert.equal(options.env.AUTORESEARCH_ROOT, undefined);
		assert.equal(options.env.AUTOCONFERENCE_ROOT, undefined);
		assertCredentialFree(options.env);
		assert.equal(Object.values(options.env).includes(apiKey), false);
	}
	const helperCalls = calls.filter(({ command }) => command === "python3");
	assert.deepEqual(
		helperCalls.map(({ args }) => args[0]),
		[join(autoresearchRoot, "scripts/init_research.py"), join(autoconferenceRoot, "scripts/init_conference.py")],
	);
	assert.deepEqual(
		helperCalls.map(({ args }) => args[args.indexOf("--output") + 1]),
		["autoresearch-helper", "autoconference-helper"],
	);
	for (const { args, options } of codexExecCalls) {
		assert.equal(args[0], "exec");
		assert.equal(args.includes(apiKey), false);
		assert.deepEqual(options.env, { ...hostEnv, OPENAI_API_KEY: apiKey });
		assert.equal(options.env.SAFE_RUNTIME_FLAG, undefined);
		assert.equal(options.env.CODEX_BIN, undefined);
		assert.equal(options.env.npm_config_prefix, undefined);
	}
	assert.equal(JSON.stringify(report).includes(apiKey), false);
});
