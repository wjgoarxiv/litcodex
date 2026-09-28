import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, outputEvidence, timedAsync } from "./uiux-installed-probe-helpers.mjs";

export const SCENARIO_IDS = [
	"public-service-form-ko",
	"fintech-dashboard",
	"healthcare-mobile",
	"saas-landing-responsive",
	"brownfield-design-system",
	"reference-fidelity",
	"cjk-terminal-dashboard",
	"missing-capture-auth-review",
];

export async function runScenarioTable(repoRoot, installedPackage, base, runCommand = timedAsync) {
	const command = [
		process.execPath,
		join(repoRoot, "tools/run-uiux-visual-qa-scenarios.mjs"),
		"--installed-root",
		installedPackage,
		"--fixtures",
		join(repoRoot, "tools/scenarios/uiux-visual-qa"),
		"--scenario",
		"all",
		"--json",
	];
	const run = await runCommand(command[0], command.slice(1), base);
	assert(run.exitCode === 0, `scenario driver failed with exit ${run.exitCode}`);
	const result = JSON.parse(run.stdout);
	assert(result.status === "PASS" && result.count === 8, "scenario summary is not exact 8/8 PASS");
	assert(
		JSON.stringify(result.scenarios.map(({ name }) => name)) === JSON.stringify(SCENARIO_IDS),
		"scenario IDs drifted",
	);
	assert(
		result.scenarios.every(
			({ assertions, actual, expected }) =>
				actual === expected && assertions.length >= 3 && assertions.every(({ pass }) => pass === true),
		),
		"scenario semantic assertion failed",
	);
	return {
		result,
		record: {
			name: "scenario-table",
			exitCode: run.exitCode,
			durationMs: run.durationMs,
			stdoutBytes: Buffer.byteLength(run.stdout),
			stdoutSha256: createHash("sha256").update(run.stdout).digest("hex"),
			stderrEvidence: outputEvidence(run.stderr),
			scenarioIds: SCENARIO_IDS,
			scenarioCount: result.count,
			semanticAssertions: result.scenarios.reduce((sum, item) => sum + item.assertions.length, 0),
		},
	};
}

export async function discoverAndHook(skills, installedBin, base, runCommand = timedAsync) {
	const discovery = ["frontend-ui-ux", "visual-qa"].map((id) => {
		const path = join(skills, id, "SKILL.md");
		assert(existsSync(path), `${id} SKILL.md missing`);
		return { id, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
	});
	const hooks = [];
	for (const { id } of discovery) {
		const result = await runCommand(installedBin, ["hook", "user-prompt-submit"], {
			...base,
			input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `$litcodex:${id} verify` }),
		});
		assert(result.exitCode === 0 && Buffer.byteLength(result.stdout) === 0, `${id} hook contract failed`);
		hooks.push({ id, exitCode: result.exitCode, stdoutBytes: 0, durationMs: result.durationMs });
	}
	return { discovery, hooks };
}

function processFailure(result) {
	const errorCode = result.spawnError?.code;
	if (result.timedOut || errorCode === "ETIMEDOUT") return "FAIL_HOST_TIMEOUT";
	if (errorCode === "ENOENT" || errorCode === "EACCES") return "FAIL_HOST_COMMAND_MISSING";
	return null;
}

function nonzeroHostFailure(result) {
	if (result.exitCode === 0) return null;
	const responsesWebsocketAuthFailure =
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}) ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized, url: wss:\/\/api\.openai\.com\/v1\/responses$/u;
	if (result.stderr.split(/\r?\n/u).some((line) => responsesWebsocketAuthFailure.test(line))) {
		return "BLOCKED_HOST_AUTH_UNAVAILABLE";
	}
	return "FAIL_HOST_EXECUTION";
}

function stderrClassifications(result) {
	return nonzeroHostFailure(result) === "BLOCKED_HOST_AUTH_UNAVAILABLE" ? ["responses-websocket-401"] : [];
}

function doctorResult(result) {
	const processStatus = processFailure(result);
	if (processStatus !== null) return { status: processStatus, json: null };
	let parsed;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		return { status: "FAIL_DOCTOR_MALFORMED", json: null };
	}
	if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object" || typeof parsed.ok !== "boolean") {
		return { status: "FAIL_DOCTOR_MALFORMED", json: null };
	}
	return {
		status: result.exitCode === 0 && parsed.ok === true ? "PASS" : "FAIL_DOCTOR_UNHEALTHY",
		json: { ok: parsed.ok, issueCount: Array.isArray(parsed.issues) ? parsed.issues.length : 0 },
	};
}

function parseBoundAgentMessage(stdout, id, nonce) {
	const lines = stdout.split(/\r?\n/u).filter((line) => line.trim() !== "");
	if (lines.length === 0) return false;
	const events = [];
	try {
		for (const line of lines) events.push(JSON.parse(line));
	} catch {
		return false;
	}
	const banner = `🔥 **LIT IGNITED · ${id}** 🔥`;
	const marker = `UIUX_HOST_PROBE_PASS:${nonce}`;
	return events.some((event) => {
		if (
			event === null ||
			typeof event !== "object" ||
			event.type !== "item.completed" ||
			event.item === null ||
			typeof event.item !== "object" ||
			event.item.type !== "agent_message" ||
			typeof event.item.text !== "string"
		) {
			return false;
		}
		const messageLines = event.item.text.split(/\r?\n/u).map((line) => line.trim());
		return messageLines.includes(banner) && messageLines.includes(marker);
	});
}

export async function probeHost({
	installedBin,
	codexBin,
	base,
	hostEnv,
	apiKey,
	scope = "full",
	runCommand = timedAsync,
	nonceFactory = () => randomUUID(),
}) {
	assert(!existsSync(join(base.env.CODEX_HOME, "auth.json")), "doctor CODEX_HOME must not contain auth.json");
	const doctorRun = await runCommand(installedBin, ["doctor", "--json"], { ...base, timeout: 60_000 });
	const doctorEvaluation = doctorResult(doctorRun);
	const doctor = {
		status: doctorEvaluation.status,
		exitCode: doctorRun.exitCode,
		stdoutBytes: Buffer.byteLength(doctorRun.stdout),
		stdoutSha256: createHash("sha256").update(doctorRun.stdout).digest("hex"),
		stderrEvidence: outputEvidence(doctorRun.stderr),
		report: doctorEvaluation.json,
	};
	const notRequested = {
		status: "NOT_REQUESTED",
		realCodex: false,
		attemptedSkillIds: [],
		blockedSkillIds: [],
		attempts: [],
	};
	if (doctor.status !== "PASS") {
		return { scope, status: doctor.status, doctor, hostExecution: notRequested };
	}
	if (scope === "doctor") {
		return { scope, status: "PASS", doctor, hostExecution: notRequested };
	}

	const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
	const authAvailable = normalizedApiKey !== "";
	const skillIds = ["frontend-ui-ux", "visual-qa"];
	if (!authAvailable) {
		return {
			scope,
			status: "BLOCKED_HOST_AUTH_UNAVAILABLE",
			doctor,
			hostExecution: {
				...notRequested,
				status: "BLOCKED_HOST_AUTH_UNAVAILABLE",
				blockedSkillIds: skillIds,
			},
		};
	}

	const attempts = [];
	let terminalStatus = "PASS";
	let realCodex = false;
	for (const [index, id] of skillIds.entries()) {
		const nonce = nonceFactory(id, index);
		const marker = `UIUX_HOST_PROBE_PASS:${nonce}`;
		const run = await runCommand(
			codexBin,
			[
				"exec",
				"--json",
				"--sandbox",
				"read-only",
				"--skip-git-repo-check",
				`Select $litcodex:${id}. Emit the required banner, then emit exactly ${marker}. Do not use tools.`,
			],
			{
				cwd: base.cwd,
				env: { ...hostEnv, OPENAI_API_KEY: normalizedApiKey },
				signal: base.signal,
				timeout: 60_000,
			},
		);
		let status = processFailure(run);
		if (status === null) status = nonzeroHostFailure(run);
		realCodex ||=
			status !== "BLOCKED_HOST_AUTH_UNAVAILABLE" &&
			run.spawnError?.code !== "ENOENT" &&
			run.spawnError?.code !== "EACCES";
		if (status === null && !parseBoundAgentMessage(run.stdout, id, nonce)) status = "FAIL_HOST_MALFORMED";
		status ??= "PASS";
		attempts.push({
			id,
			status,
			exitCode: run.exitCode,
			stdoutBytes: Buffer.byteLength(run.stdout),
			stdoutSha256: createHash("sha256").update(run.stdout).digest("hex"),
			stderrEvidence: outputEvidence(run.stderr, stderrClassifications(run)),
		});
		if (status !== "PASS") {
			terminalStatus = status;
			break;
		}
	}
	return {
		scope,
		status: terminalStatus,
		doctor,
		hostExecution: {
			status: terminalStatus,
			realCodex,
			attemptedSkillIds: attempts.map(({ id }) => id),
			blockedSkillIds:
				terminalStatus === "PASS"
					? []
					: skillIds.filter((id) => attempts.find((attempt) => attempt.id === id)?.status !== "PASS"),
			attempts,
		},
	};
}
