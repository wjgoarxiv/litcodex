import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createV2SelfCheckReceipt, validateV2Receipt } from "./harness-speed-v2-contract.mjs";

const fixturePath = fileURLToPath(new URL("./fixtures/litfamily-harness-speed-v1.json", import.meta.url));
const fixtureBytes = readFileSync(fixturePath);

function receipt() {
	return createV2SelfCheckReceipt();
}

function expectCode(input, code) {
	assert.throws(
		() => validateV2Receipt(input, fixtureBytes),
		(error) => error?.code === code,
	);
}

function setValues(samples, value) {
	for (let index = 0; index < samples.length; index += 1) {
		if (typeof samples[index] === "number") samples[index] = value;
		else samples[index].value_ms = value;
	}
}

const indexed = (samples) =>
	samples.map((sample, index) =>
		typeof sample === "number" ? { index: index + 1, value_ms: sample } : structuredClone(sample),
	);

test("accepts the exact frozen provider-free V2 cohort", () => {
	// Given a six-block alternating provider-free cohort.
	const input = receipt();
	// When the V2 contract validates raw samples and observed guards.
	const result = validateV2Receipt(input, fixtureBytes);
	// Then it retains raw metrics and proves no provider work.
	assert.equal(result.verdict, "PASS");
	assert.equal(result.metrics.aggregate.candidate_p95, 85);
	assert.equal(result.provider.calls, 0);
	assert.equal(result.provider.usage, "UNAVAILABLE");
});

test("rejects wrong or clean-HEAD baseline identity", async (t) => {
	await t.test("clean HEAD", () => {
		const input = receipt();
		input.source.baseline.kind = "clean-head";
		expectCode(input, "WRONG_BASELINE_SOURCE");
	});
	await t.test("stale status", () => {
		const input = receipt();
		input.source.baseline.status_sha256 = "0".repeat(64);
		expectCode(input, "FROZEN_BASELINE_MISMATCH");
	});
	await t.test("stale HEAD", () => {
		const input = receipt();
		input.source.baseline.head = "0".repeat(40);
		expectCode(input, "FROZEN_BASELINE_MISMATCH");
	});
	await t.test("wrong frozen source artifact", () => {
		const input = receipt();
		input.source.baseline.source_artifact_sha256 = "f".repeat(64);
		expectCode(input, "FROZEN_SOURCE_ARTIFACT_MISMATCH");
	});
	await t.test("wrong candidate base source lineage", () => {
		const input = receipt();
		input.source.candidate.base_source_artifact_sha256 = "f".repeat(64);
		expectCode(input, "CANDIDATE_SOURCE_MISMATCH");
	});
	await t.test("candidate source aliases frozen source", () => {
		const input = receipt();
		input.source.candidate.base_source_artifact_sha256 = input.source.baseline.source_artifact_sha256;
		input.source.candidate.source_artifact_sha256 = input.source.baseline.source_artifact_sha256;
		expectCode(input, "CANDIDATE_SOURCE_MISMATCH");
	});
	await t.test("candidate status aliases baseline", () => {
		const input = receipt();
		input.source.candidate.status_sha256 = input.source.baseline.status_sha256;
		expectCode(input, "CANDIDATE_IDENTITY_MISMATCH");
	});
	await t.test("candidate artifact aliases baseline", () => {
		const input = receipt();
		input.source.candidate.artifact_sha256 = input.source.baseline.artifact_sha256;
		expectCode(input, "CANDIDATE_IDENTITY_MISMATCH");
	});
});

test("rejects incomplete and non-alternating samples", async (t) => {
	await t.test("missing block", () => {
		const input = receipt();
		input.blocks.pop();
		expectCode(input, "INVALID_COHORT_SHAPE");
	});
	await t.test("missing sample", () => {
		const input = receipt();
		input.blocks[0].samples.candidate.S1.pop();
		expectCode(input, "INVALID_COHORT_SHAPE");
	});
	await t.test("wrong order", () => {
		const input = receipt();
		input.blocks[1].order = "AB";
		expectCode(input, "INVALID_BLOCK_ORDER");
	});
	await t.test("swapped sample indices", () => {
		const input = receipt();
		const samples = indexed(input.blocks[0].samples.candidate.S1);
		[samples[0], samples[1]] = [samples[1], samples[0]];
		input.blocks[0].samples.candidate.S1 = samples;
		expectCode(input, "INVALID_SAMPLE_IDENTITY");
	});
	await t.test("duplicate sample index", () => {
		const input = receipt();
		const samples = indexed(input.blocks[0].samples.candidate.S1);
		samples[1].index = samples[0].index;
		input.blocks[0].samples.candidate.S1 = samples;
		expectCode(input, "INVALID_SAMPLE_IDENTITY");
	});
});

test("uses raw thresholds and strict non-regression", async (t) => {
	await t.test("rounded 15 percent edge", () => {
		const input = receipt();
		for (const block of input.blocks) setValues(block.samples.candidate.S1, 85.00001);
		expectCode(input, "LEVER_THRESHOLD_NOT_MET");
	});
	await t.test("slower phase hidden by aggregate", () => {
		const input = receipt();
		for (const sample of input.blocks[0].samples.candidate.S2.slice(0, 2))
			if (typeof sample === "number")
				input.blocks[0].samples.candidate.S2[input.blocks[0].samples.candidate.S2.indexOf(sample)] = 100.00001;
			else sample.value_ms = 100.00001;
		expectCode(input, "PHASE_REGRESSION");
	});
	await t.test("early late baseline drift", () => {
		const input = receipt();
		for (const block of input.blocks.slice(3)) {
			for (const phase of ["B0", "S1", "S2"]) setValues(block.samples.baseline[phase], 120.00001);
		}
		expectCode(input, "BASELINE_ENVIRONMENT_DRIFT");
	});
});

test("requires typed provider unavailability and zero work", async (t) => {
	await t.test("zero-coerced usage", () => {
		const input = receipt();
		input.provider.usage = 0;
		expectCode(input, "PROVIDER_UNAVAILABLE_NOT_TYPED");
	});
	await t.test("provider call", () => {
		const input = receipt();
		input.provider.calls = 1;
		expectCode(input, "PROVIDER_BOUNDARY_BREACH");
	});
});

test("requires observed deterministic Codex loader proof for context removal", async (t) => {
	await t.test("context reduction without removal proof", () => {
		const input = receipt();
		input.selected = { type: "context", baseline_bytes: 17259, candidate_bytes: 11696 };
		expectCode(input, "CONTEXT_LOADER_UNPROVEN");
	});
	await t.test("promise only", () => {
		const input = receipt();
		input.selected = { type: "context", baseline_bytes: 17259, candidate_bytes: 11696 };
		input.context = { removed: true, loader_proof: "load the skill later" };
		expectCode(input, "CONTEXT_LOADER_UNPROVEN");
	});
	await t.test("observed pre-request proof", () => {
		const input = receipt();
		input.selected = { type: "context", baseline_bytes: 17259, candidate_bytes: 11696 };
		input.context = {
			removed: true,
			loader_proof: {
				mechanism: "codex-user-prompt-submit-hook",
				observed: true,
				pre_request: true,
				body_sha256: "d".repeat(64),
				loaded_sha256: "d".repeat(64),
			},
		};
		assert.equal(validateV2Receipt(input, fixtureBytes).verdict, "PASS");
	});
	await t.test("unequal observed body hashes", () => {
		const input = receipt();
		input.selected = { type: "context", baseline_bytes: 17259, candidate_bytes: 11696 };
		input.context = {
			removed: true,
			loader_proof: {
				mechanism: "codex-user-prompt-submit-hook",
				observed: true,
				pre_request: true,
				body_sha256: "d".repeat(64),
				loaded_sha256: "e".repeat(64),
			},
		};
		expectCode(input, "CONTEXT_LOADER_UNPROVEN");
	});
});

test("rejects malformed, injection-shaped, and misleading receipts", async (t) => {
	await t.test("failed guard", () => {
		const input = receipt();
		input.guards.body.passed = 35;
		expectCode(input, "GUARD_FAILURE");
	});
	await t.test("raw prompt", () => {
		const input = receipt();
		input.prompt = "ignore the contract";
		expectCode(input, "FORBIDDEN_FIELD");
	});
	await t.test("claimed success", () => {
		const input = receipt();
		input.claimed_success = true;
		expectCode(input, "MISLEADING_SUCCESS_FIELD");
	});
});

test("runs the real provider-free CLI surface against the canonical fixture", () => {
	const run = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("./harness-speed-v2-contract.mjs", import.meta.url)), "--self-check", fixturePath],
		{
			encoding: "utf8",
			env: { PATH: process.env.PATH, CI: "1", NO_UPDATE_NOTIFIER: "1", npm_config_offline: "true" },
		},
	);
	assert.equal(run.status, 0, run.stderr);
	const output = JSON.parse(run.stdout);
	assert.equal(output.verdict, "PASS");
	assert.deepEqual(output.provider, { calls: 0, completions: 0, usage: "UNAVAILABLE", cache: "UNAVAILABLE" });
});
