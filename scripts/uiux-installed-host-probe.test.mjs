import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { probeHost, runScenarioTable, SCENARIO_IDS } from "./uiux-installed-host-probe.mjs";

const roots = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function baseEnv(extra = {}) {
	const root = mkdtempSync(join(tmpdir(), "litcodex-host-probe-test-"));
	roots.push(root);
	return {
		cwd: root,
		env: {
			HOME: join(root, "home"),
			CODEX_HOME: join(root, "home", ".codex"),
			...extra,
		},
	};
}

function result({ exitCode = 0, stdout = "", stderr = "", spawnError, timedOut = false } = {}) {
	return { exitCode, stdout, stderr, spawnError, timedOut, durationMs: 1 };
}

it("scenario records omit executable argv and retain exact IDs, counts, and stream evidence", async () => {
	const pathCanary = `ghp_${"S".repeat(36)}`;
	const stdout = `${JSON.stringify({
		status: "PASS",
		count: 8,
		scenarios: SCENARIO_IDS.map((name) => ({
			name,
			actual: "PASS",
			expected: "PASS",
			assertions: [{ pass: true }, { pass: true }, { pass: true }],
		})),
	})}\n`;
	const calls = [];
	const scenario = await runScenarioTable(
		join("/repo", pathCanary),
		join("/installed", pathCanary),
		baseEnv({ [`SECRET_${pathCanary}`]: `npm_${"E".repeat(36)}` }),
		async (command, args) => {
			calls.push({ command, args });
			return result({ stdout, stderr: "safe warning" });
		},
	);
	const serialized = JSON.stringify(scenario.record);
	assert.equal(calls.length, 1);
	assert.equal(serialized.includes(pathCanary), false);
	assert.equal(Object.hasOwn(scenario.record, "command"), false);
	assert.deepEqual(scenario.record.scenarioIds, SCENARIO_IDS);
	assert.equal(scenario.record.scenarioCount, 8);
	assert.equal(scenario.record.semanticAssertions, 24);
	assert.equal(scenario.record.stdoutBytes, Buffer.byteLength(stdout));
	assert.match(scenario.record.stdoutSha256, /^[a-f0-9]{64}$/u);
	assert.equal(scenario.record.stderrEvidence.bytes, Buffer.byteLength("safe warning"));
	assert.match(scenario.record.stderrEvidence.sha256, /^[a-f0-9]{64}$/u);
});

async function runProbe({ scope = "doctor", responses, env, nonce = "fresh-nonce" }) {
	const calls = [];
	const queue = [...responses];
	const apiKey = typeof env?.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY : undefined;
	const setupEnv = Object.fromEntries(
		Object.entries(env ?? {}).filter(
			([name]) =>
				!/(?:api[_-]?key|auth(?:orization)?|cookie|credential|pass(?:word|phrase|wd)?|secret|session|token)/iu.test(
					name,
				),
		),
	);
	const base = baseEnv(setupEnv);
	const report = await probeHost({
		installedBin: "/sandbox/bin/litcodex",
		codexBin: "/repo/node_modules/.bin/codex",
		base,
		hostEnv: {
			HOME: base.env.HOME,
			CODEX_HOME: base.env.CODEX_HOME,
			PATH: "/usr/bin:/bin",
		},
		apiKey,
		scope,
		nonceFactory: () => nonce,
		runCommand(command, args, options) {
			calls.push({ command, args, options });
			return queue.shift() ?? result({ exitCode: 99, stderr: "unexpected call" });
		},
	});
	return { report, calls };
}

describe("installed host probe terminal states", () => {
	it("fails an unhealthy doctor even when its exit-4 JSON is well formed", async () => {
		const { report } = await runProbe({
			responses: [result({ exitCode: 4, stdout: '{"ok":false,"issues":["plugin missing"]}\n' })],
		});
		assert.equal(report.status, "FAIL_DOCTOR_UNHEALTHY");
		assert.equal(report.doctor.status, "FAIL_DOCTOR_UNHEALTHY");
		assert.equal(report.hostExecution.status, "NOT_REQUESTED");
	});

	it("persists only bounded doctor output evidence and a safe report summary", async () => {
		const secret = "sk-REVIEWSECRET123456789";
		const { report } = await runProbe({
			responses: [
				result({
					exitCode: 4,
					stdout: JSON.stringify({ ok: false, issues: [`OPENAI_API_KEY=${secret}`] }),
					stderr: `token=${secret}`,
				}),
			],
		});
		const serialized = JSON.stringify(report);
		assert.equal(serialized.includes(secret), false);
		assert.equal(Object.hasOwn(report.doctor, "stderr"), false);
		assert.equal(report.doctor.stderrEvidence.bytes > 0, true);
		assert.match(report.doctor.stderrEvidence.sha256, /^[a-f0-9]{64}$/u);
		assert.deepEqual(report.doctor.report, { ok: false, issueCount: 1 });
	});

	it("fails exit-zero malformed doctor output", async () => {
		const { report } = await runProbe({ responses: [result({ stdout: "not-json\n" })] });
		assert.equal(report.status, "FAIL_DOCTOR_MALFORMED");
		assert.equal(report.doctor.status, "FAIL_DOCTOR_MALFORMED");
	});

	it("types doctor timeout and missing executable failures", async () => {
		const timeout = (
			await runProbe({
				responses: [result({ exitCode: -1, stderr: "timed out", timedOut: true })],
			})
		).report;
		assert.equal(timeout.status, "FAIL_HOST_TIMEOUT");

		const missing = (
			await runProbe({
				responses: [
					result({
						exitCode: -1,
						spawnError: Object.assign(new Error("missing"), { code: "ENOENT" }),
					}),
				],
			})
		).report;
		assert.equal(missing.status, "FAIL_HOST_COMMAND_MISSING");
		assert.equal(missing.hostExecution.realCodex, false);
	});

	it("doctor scope passes without claiming model execution", async () => {
		const { report, calls } = await runProbe({
			env: { OPENAI_API_KEY: "doctor-must-not-see-this", AUTHORIZATION: "Bearer hidden" },
			responses: [result({ stdout: '{"ok":true,"issues":[]}\n' })],
		});
		assert.equal(report.status, "PASS");
		assert.equal(report.scope, "doctor");
		assert.equal(report.doctor.status, "PASS");
		assert.equal(report.hostExecution.status, "NOT_REQUESTED");
		assert.equal(report.hostExecution.realCodex, false);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
		assert.equal(calls[0].options.env.AUTHORIZATION, undefined);
	});

	it("refuses to start doctor when its credential-free CODEX_HOME contains auth.json", async () => {
		const base = baseEnv();
		mkdirSync(base.env.CODEX_HOME, { recursive: true });
		writeFileSync(join(base.env.CODEX_HOME, "auth.json"), '{"token":"must-not-be-read"}\n');
		let calls = 0;
		await assert.rejects(
			probeHost({
				installedBin: "/sandbox/bin/litcodex",
				codexBin: "/repo/node_modules/.bin/codex",
				base,
				hostEnv: {},
				apiKey: "host-only-key",
				runCommand() {
					calls += 1;
					return result({ stdout: '{"ok":true}\n' });
				},
			}),
			/doctor CODEX_HOME must not contain auth\.json/u,
		);
		assert.equal(calls, 0);
	});

	it("keeps absent or empty API keys as a typed auth block and gives no command a key", async () => {
		for (const env of [{}, { OPENAI_API_KEY: "  \t " }]) {
			const { report, calls } = await runProbe({
				scope: "full",
				env,
				responses: [result({ stdout: '{"ok":true}\n' })],
			});
			assert.equal(report.status, "BLOCKED_HOST_AUTH_UNAVAILABLE");
			assert.equal(report.hostExecution.status, "BLOCKED_HOST_AUTH_UNAVAILABLE");
			assert.equal(report.hostExecution.realCodex, false);
			assert.equal(calls.length, 1);
			assert.equal(
				calls.some(({ options }) => Object.hasOwn(options.env, "OPENAI_API_KEY")),
				false,
			);
		}
	});

	it("blocks the exact live Codex 0.144.0 responses websocket auth failure without claiming model execution", async () => {
		const authFailure =
			"2026-07-27T17:14:23.967031Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses";
		const { report, calls } = await runProbe({
			scope: "full",
			env: { OPENAI_API_KEY: "credential-present" },
			responses: [
				result({ stdout: '{"ok":true}\n' }),
				result({ exitCode: 1, stderr: `${authFailure}\n${authFailure}\n` }),
			],
		});

		assert.equal(report.status, "BLOCKED_HOST_AUTH_UNAVAILABLE");
		assert.equal(report.hostExecution.status, "BLOCKED_HOST_AUTH_UNAVAILABLE");
		assert.equal(report.hostExecution.realCodex, false);
		assert.deepEqual(report.hostExecution.attemptedSkillIds, ["frontend-ui-ux"]);
		assert.deepEqual(report.hostExecution.blockedSkillIds, ["frontend-ui-ux", "visual-qa"]);
		assert.equal(report.hostExecution.attempts[0]?.status, "BLOCKED_HOST_AUTH_UNAVAILABLE");
		assert.deepEqual(report.hostExecution.attempts[0]?.stderrEvidence.classifications, ["responses-websocket-401"]);
		assert.equal(Object.hasOwn(report.hostExecution.attempts[0], "stderr"), false);
		assert.equal(calls.length, 2);
	});

	it("classifies auth from transient stderr without persisting arbitrary secret-shaped child output", async () => {
		const secret = "sk-REVIEWSECRET123456789";
		const authFailure =
			"2026-07-27T17:14:23.967031Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses";
		const { report } = await runProbe({
			scope: "full",
			env: { OPENAI_API_KEY: "credential-present" },
			responses: [
				result({ stdout: '{"ok":true}\n' }),
				result({ exitCode: 1, stderr: `${authFailure}\ntoken=${secret}\n` }),
			],
		});
		const serialized = JSON.stringify(report);
		assert.equal(report.status, "BLOCKED_HOST_AUTH_UNAVAILABLE");
		assert.equal(serialized.includes(secret), false);
		assert.equal(serialized.includes("credential-present"), false);
		assert.equal(Object.hasOwn(report.hostExecution.attempts[0], "stderr"), false);
		assert.deepEqual(report.hostExecution.attempts[0].stderrEvidence.classifications, ["responses-websocket-401"]);
	});

	it("keeps near misses and unrelated 401 stderr as host execution failures", async () => {
		const liveLine =
			"2026-07-27T17:14:23.967031Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses";
		const misleadingStderr = [
			`diagnostic quote: ${liveLine}`,
			liveLine.replace("codex_api::endpoint::", "codex_api::client::"),
			liveLine.replace(" ERROR ", " INFO "),
			liveLine.replace("401 Unauthorized", "403 Forbidden"),
			liveLine.replace("wss://api.openai.com/v1/responses", "wss://api.openai.com/v1/chat/completions"),
			"authentication failed while reading local settings: HTTP error: 401 Unauthorized",
		];
		for (const stderr of misleadingStderr) {
			const { report } = await runProbe({
				scope: "full",
				env: { OPENAI_API_KEY: "credential-present" },
				responses: [result({ stdout: '{"ok":true}\n' }), result({ exitCode: 1, stderr })],
			});
			assert.equal(report.status, "FAIL_HOST_EXECUTION");
			assert.equal(report.hostExecution.status, "FAIL_HOST_EXECUTION");
			assert.equal(report.hostExecution.attempts[0]?.status, "FAIL_HOST_EXECUTION");
		}
	});

	it("does not classify the exact auth signature when Codex exits zero", async () => {
		const authFailure =
			"2026-07-27T17:14:23.967031Z ERROR codex_api::endpoint::responses_websocket: failed to connect to websocket: HTTP error: 401 Unauthorized, url: wss://api.openai.com/v1/responses";
		const { report } = await runProbe({
			scope: "full",
			env: { OPENAI_API_KEY: "credential-present" },
			responses: [result({ stdout: '{"ok":true}\n' }), result({ stderr: authFailure })],
		});
		assert.equal(report.status, "FAIL_HOST_MALFORMED");
		assert.equal(report.hostExecution.attempts[0]?.status, "FAIL_HOST_MALFORMED");
	});

	it("rejects misleading banner/pass strings in malformed JSONL", async () => {
		const { report } = await runProbe({
			scope: "full",
			env: { OPENAI_API_KEY: "credential-present" },
			responses: [
				result({ stdout: '{"ok":true}\n' }),
				result({ stdout: "banner 🔥 **LIT IGNITED · frontend-ui-ux** 🔥 UIUX_HOST_PROBE_PASS:fresh-nonce\n" }),
			],
		});
		assert.equal(report.status, "FAIL_HOST_MALFORMED");
		assert.equal(report.hostExecution.realCodex, true);
	});

	it("rejects valid JSONL whose agent message is not bound to the current nonce", async () => {
		const payload = JSON.stringify({
			type: "item.completed",
			item: {
				type: "agent_message",
				text: "🔥 **LIT IGNITED · frontend-ui-ux** 🔥\nUIUX_HOST_PROBE_PASS:stale-nonce",
			},
		});
		const { report } = await runProbe({
			scope: "full",
			env: { OPENAI_API_KEY: "credential-present" },
			responses: [result({ stdout: '{"ok":true}\n' }), result({ stdout: `${payload}\n` })],
		});
		assert.equal(report.status, "FAIL_HOST_MALFORMED");
	});

	it("invokes only the resolved CODEX_BIN and accepts nonce-bound agent JSONL", async () => {
		const responseFor = (id) =>
			`${JSON.stringify({
				type: "item.completed",
				item: {
					type: "agent_message",
					text: `🔥 **LIT IGNITED · ${id}** 🔥\nUIUX_HOST_PROBE_PASS:fresh-nonce`,
				},
			})}\n`;
		const { report, calls } = await runProbe({
			scope: "full",
			env: { OPENAI_API_KEY: "credential-present" },
			responses: [
				result({ stdout: '{"ok":true}\n' }),
				result({ stdout: responseFor("frontend-ui-ux") }),
				result({ stdout: responseFor("visual-qa") }),
			],
		});
		assert.equal(report.status, "PASS");
		assert.equal(report.hostExecution.realCodex, true);
		assert.equal(report.hostExecution.attempts.length, 2);
		assert.deepEqual(
			calls.slice(1).map(({ command }) => command),
			["/repo/node_modules/.bin/codex", "/repo/node_modules/.bin/codex"],
		);
		assert.ok(calls.slice(1).every(({ args }) => args.join(" ").includes("fresh-nonce")));
		assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
		assert.ok(
			calls
				.slice(1)
				.every(
					({ args, options }) =>
						args[0] === "exec" &&
						!args.includes("credential-present") &&
						options.env.OPENAI_API_KEY === "credential-present" &&
						options.env.CODEX_BIN === undefined,
				),
		);
	});
});
