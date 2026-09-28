import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const RUNNER = join(process.cwd(), "scripts/run-provider-cache-ab.mjs");
const SCENARIO = join(process.cwd(), "scripts/fixtures/provider-cache-lit-plan-transition-v1.json");

function runRunner(args, env = process.env) {
	return spawnSync(process.execPath, [RUNNER, ...args], {
		cwd: process.cwd(),
		env,
		encoding: "utf8",
		timeout: 10_000,
	});
}

test("provider cache scenario contains the exact immutable six-record contract", () => {
	const exists = existsSync(SCENARIO);
	const scenario = exists ? JSON.parse(readFileSync(SCENARIO, "utf8")) : null;
	assert.equal(exists, true);
	assert.deepEqual(scenario, {
		schema: "litcodex.provider-cache-scenario/v1",
		scenario: "lit-plan-transition-v1",
		records: [
			{ id: "B0", prompt: "Benchmark fixture. Reply with exactly LCPC_B0_OK.", canary: "LCPC_B0_OK" },
			{
				id: "S1",
				prompt:
					"lit plan. Benchmark-only request: plan three concise checks for preserving a stable synthetic prefix. Do not use tools. End with exactly LCPC_S1_OK.",
				canary: "LCPC_S1_OK",
			},
			{
				id: "S2",
				prompt:
					"Continue the benchmark plan by naming one cache-metric correctness check. Do not use tools. End with exactly LCPC_S2_OK.",
				canary: "LCPC_S2_OK",
			},
			{
				id: "S3",
				prompt: "Continue by naming one p95 latency check. Do not use tools. End with exactly LCPC_S3_OK.",
				canary: "LCPC_S3_OK",
			},
			{
				id: "S4",
				prompt:
					"Continue by naming one local-evidence privacy check. Do not use tools. End with exactly LCPC_S4_OK.",
				canary: "LCPC_S4_OK",
			},
			{
				id: "S5",
				prompt:
					"Finish with one sentence stating the greater-than-95-percent acceptance gate. Do not use tools. End with exactly LCPC_S5_OK.",
				canary: "LCPC_S5_OK",
			},
		],
	});
});

test("fake mode emits one privacy-bounded ABBA cohort with 48 completions", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-test-"));
	const output = join(root, "result.json");
	try {
		const secret = "provider-secret-must-not-leak";
		const result = runRunner(["--model", "gpt-5.6-luna", "--output", output], {
			...process.env,
			OPENAI_API_KEY: secret,
		});
		assert.equal(result.status, 0, result.stderr);
		const receipt = JSON.parse(readFileSync(output, "utf8"));
		assert.equal(receipt.schema, "litcodex.provider-cache-ab/v1");
		assert.equal(receipt.status, "measured");
		assert.equal(receipt.mode, "fake");
		assert.equal(receipt.order, "ABBA");
		assert.equal(receipt.blocks.length, 4);
		assert.deepEqual(
			receipt.blocks.map((block) => block.order),
			[
				["active", "control"],
				["control", "active"],
				["control", "active"],
				["active", "control"],
			],
		);
		assert.equal(
			receipt.blocks.every((block) => block.sessions.every((session) => session.measurement.receipts === 5)),
			true,
		);
		assert.equal(receipt.completionCount, 48);
		assert.equal(receipt.active.correctnessPassed, 20);
		assert.equal(receipt.control.correctnessPassed, 20);
		assert.deepEqual(receipt.cleanup, { childProcesses: 0, tempHomes: 0, tarballs: 0, rawBuffers: 0 });
		const serialized = JSON.stringify(receipt);
		assert.equal(serialized.includes("LCPC_"), false);
		assert.equal(serialized.includes("Benchmark fixture"), false);
		assert.equal(serialized.includes(secret), false);
		assert.match(receipt.identity.executableSha256, /^[a-f0-9]{64}$/);
		assert.match(receipt.runnerSha256, /^[a-f0-9]{64}$/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fake failure fixtures fail closed with typed zero-work receipts", () => {
	for (const [fixture, code] of [
		["rate-limit", "PROVIDER_RATE_LIMIT"],
		["missing-usage", "MISSING_AUTHORITATIVE_USAGE"],
		["timeout", "PROCESS_TIMEOUT"],
	]) {
		const result = runRunner(["--fake-failure", fixture]);
		assert.equal(result.status, 1);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.status, "invalid");
		assert.equal(receipt.code, code);
		assert.equal(receipt.completionCount, 0);
		assert.deepEqual(receipt.cleanup, { childProcesses: 0, tempHomes: 0, tarballs: 0, rawBuffers: 0 });
	}
});

test("live mode without reusable host auth blocks before provider work", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-no-auth-"));
	const env = { ...process.env, HOME: root, CODEX_HOME: join(root, ".codex") };
	mkdirSync(env.CODEX_HOME, { recursive: true });
	delete env.OPENAI_API_KEY;
	try {
		const result = runRunner(["--live", "--model", "gpt-5.6-luna"], env);
		assert.equal(result.status, 2);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.status, "blocked");
		assert.equal(receipt.code, "BLOCKED_HOST_AUTH_UNAVAILABLE");
		assert.equal(receipt.completionCount, 0);
		assert.deepEqual(receipt.cleanup, { childProcesses: 0, tempHomes: 0, tarballs: 0, rawBuffers: 0 });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("live mode does not require OPENAI_API_KEY when a host auth source exists", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-credential-"));
	const codexHome = join(root, ".codex");
	mkdirSync(codexHome, { recursive: true });
	writeFileSync(join(codexHome, "auth.json"), "opaque-test-auth", { mode: 0o600 });
	const env = { ...process.env, HOME: root, CODEX_HOME: codexHome };
	delete env.OPENAI_API_KEY;
	try {
		const result = runRunner(["--live", "--codex", join(root, "missing-codex")], env);
		assert.equal(result.status, 1, result.stderr);
		const receipt = JSON.parse(result.stdout);
		assert.equal(receipt.status, "invalid");
		assert.equal(receipt.code, "RUNNER_EXECUTION_FAILED");
		assert.equal(receipt.completionCount, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an explicit output path retains a privacy-bounded auth block for resumable evidence", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-provider-cache-block-"));
	const output = join(root, "blocked.json");
	const env = { ...process.env, HOME: root, CODEX_HOME: join(root, ".codex") };
	mkdirSync(env.CODEX_HOME, { recursive: true });
	delete env.OPENAI_API_KEY;
	try {
		const result = runRunner(["--live", "--output", output], env);
		assert.equal(result.status, 2);
		assert.equal(result.stdout, "");
		const receipt = JSON.parse(readFileSync(output, "utf8"));
		assert.equal(receipt.code, "BLOCKED_HOST_AUTH_UNAVAILABLE");
		assert.equal(receipt.completionCount, 0);
		assert.deepEqual(receipt.cleanup, { childProcesses: 0, tempHomes: 0, tarballs: 0, rawBuffers: 0 });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("non-canonical cohort flags fail closed without an output artifact", () => {
	const result = runRunner(["--blocks", "5"]);
	assert.equal(result.status, 2);
	const receipt = JSON.parse(result.stdout);
	assert.equal(receipt.status, "invalid");
	assert.equal(receipt.code, "INVALID_COHORT_CONFIG");
	assert.equal(receipt.completionCount, 0);
});
