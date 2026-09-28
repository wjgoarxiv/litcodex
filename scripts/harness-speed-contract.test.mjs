import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateCohort, validateScenarioBytes } from "./harness-speed-contract.mjs";
import { createProviderFreeCohort } from "./harness-speed-contract-sample.mjs";
import { nearestRank } from "./harness-speed-verdict.mjs";

const fixturePath = fileURLToPath(new URL("./fixtures/litfamily-harness-speed-v1.json", import.meta.url));
const fixtureBytes = readFileSync(fixturePath);

function scenario() {
	return JSON.parse(fixtureBytes.toString("utf8"));
}

function cohort() {
	return createProviderFreeCohort(scenario());
}

function expectCode(input, code) {
	assert.throws(
		() => validateCohort(input, scenario()),
		(error) => error?.code === code,
	);
}

test("validates the byte-identical shared scenario when the product fixture is loaded", () => {
	// Given the checked-in product fixture bytes.
	// When the immutable scenario boundary parses them.
	const parsed = validateScenarioBytes(fixtureBytes);
	// Then its exact identity is retained without prompt normalization.
	assert.deepEqual(parsed, scenario());
});

test("passes the exact 54-record six-permutation cohort", () => {
	// Given a provider-free cohort with B0, S1, and S2 in every session.
	// When the exact contract computes its aggregate.
	const result = validateCohort(cohort(), scenario());
	// Then every unrounded gate passes.
	assert.equal(result.verdict, "PASS");
	assert.deepEqual(result.cohort, { records: 54, sessions_per_arm: 6, measured_turns_per_arm: 12 });
	assert.equal(result.metrics.paired_median_ratio, 0.85);
	assert.deepEqual(result.diagnostics, {
		cache_read_share: 0.2,
		uncached_input_per_correct_turn: 80,
		latency_saved_ms_per_1k_cache_read_tokens: 750,
	});
});

test("uses nearest-rank p50 and p95 without interpolation", () => {
	// Given twelve deliberately uneven source values.
	const values = [12, 1, 11, 2, 10, 3, 9, 4, 8, 5, 7, 6];
	// When the shared percentile rule selects its ranks.
	const result = { p50: nearestRank(values, 0.5), p95: nearestRank(values, 0.95) };
	// Then rank 6 and rank 12 are selected exactly.
	assert.deepEqual(result, { p50: 6, p95: 12 });
});

test("rejects a missing arm before a misleading cardinality claim", () => {
	// Given 54 records whose control labels were replaced.
	const input = cohort();
	for (const record of input.records) if (record.arm === "control") record.arm = "baseline";
	// When the cohort boundary checks arm identity, then it reports the missing arm.
	expectCode(input, "MISSING_ARM");
});

test("rejects a dropped turn hidden by a duplicate turn", () => {
	// Given a 54-record cohort with one record replaced by a duplicate.
	const input = cohort();
	input.records[8] = structuredClone(input.records[7]);
	// When sequence and session order are checked, then the duplicate is rejected.
	expectCode(input, "INVALID_SEQUENCE");
});

test("rejects wrong arm-slot order and prompt identity", async (t) => {
	await t.test("arm-slot order", () => {
		// Given a valid record assigned to the wrong 1-based arm slot.
		const input = cohort();
		input.records[0].order = 2;
		// When session order is checked, then the cohort is rejected.
		expectCode(input, "INVALID_SESSION_ORDER");
	});
	await t.test("prompt identity", () => {
		// Given a prompt hash that does not match the frozen phase.
		const input = cohort();
		input.records[0].prompt_sha256 = "0".repeat(64);
		// When prompt identity is checked, then the cohort is rejected.
		expectCode(input, "INVALID_PROMPT_IDENTITY");
	});
});

test("blocks candidate input inflation without rounding or denominator changes", () => {
	// Given one extra candidate input token.
	const input = cohort();
	input.records.find((record) => record.arm === "candidate" && record.phase === "S1").input_tokens += 1;
	// When the anti-padding gate sums all measured turns.
	const result = validateCohort(input, scenario());
	// Then the cohort is blocked even though latency still passes.
	assert.equal(result.verdict, "BLOCKED_INPUT_PADDING");
	assert.equal(result.gates.anti_padding, false);
});

test("blocks control drift above 20 percent", () => {
	// Given a control whose last six measured turns move by 21 percent.
	const input = cohort();
	const measured = input.records.filter((record) => record.arm === "control" && record.phase !== "B0");
	for (const record of measured.slice(6)) {
		record.first_content_offset_ms = 60;
		record.final_receipt_offset_ms = 100;
		record.exit_offset_ms = 121;
	}
	// When the early/late nearest-rank p95 drift is computed.
	const result = validateCohort(input, scenario());
	// Then environmental drift blocks the cohort.
	assert.equal(result.verdict, "BLOCKED_ENVIRONMENT_DRIFT");
	assert.equal(result.metrics.control_drift_ratio, 0.21);
});

test("rejects non-monotonic offsets", () => {
	// Given final receipt before first content.
	const input = cohort();
	input.records[0].first_content_offset_ms = 90;
	input.records[0].final_receipt_offset_ms = 80;
	// When timing is parsed, then the record is rejected.
	expectCode(input, "NON_MONOTONIC_TIME");
});

test("rejects unsafe, missing, and null counters", async (t) => {
	for (const [name, mutate, code] of [
		[
			"unsafe",
			(record) => {
				record.input_tokens = Number.MAX_SAFE_INTEGER + 1;
			},
			"UNSAFE_COUNTER",
		],
		[
			"missing",
			(record) => {
				delete record.cache_read_tokens;
			},
			"MISSING_RECORD_FIELD",
		],
		[
			"null",
			(record) => {
				record.output_tokens = null;
			},
			"INVALID_COUNTER",
		],
	]) {
		await t.test(name, () => {
			// Given one malformed counter representation.
			const input = cohort();
			mutate(input.records[0]);
			// When counters are parsed, then unavailable is never coerced to zero.
			expectCode(input, code);
		});
	}
});

test("rejects raw and high-cardinality fields", async (t) => {
	for (const field of ["prompt", "session_id"]) {
		await t.test(field, () => {
			// Given a forbidden field on an otherwise valid record.
			const input = cohort();
			input.records[0][field] = "untrusted body";
			// When the privacy boundary walks keys, then retained content is rejected.
			expectCode(input, "FORBIDDEN_FIELD");
		});
	}
});

test("enforces bidirectional null and coded failure semantics", async (t) => {
	await t.test("accepts null only for successful rows", () => {
		// Given a successful cohort with null failure markers.
		const input = cohort();
		for (const record of input.records) record.failure_code = null;
		// When the row boundary checks success and failure identity.
		const result = validateCohort(input, scenario());
		// Then the cohort remains valid and correct.
		assert.equal(result.verdict, "PASS");
	});
	await t.test("rejects a coded successful row", () => {
		// Given the old coded-success representation.
		const input = cohort();
		input.records[0].failure_code = "NONE";
		// When all correctness predicates are true, then a string marker is rejected.
		expectCode(input, "INVALID_FAILURE_CODE_SEMANTICS");
	});
	await t.test("rejects null for an unsuccessful row", () => {
		// Given a self-consistent timeout whose failure marker is null.
		const input = cohort();
		for (const record of input.records) record.failure_code = null;
		const failed = input.records.find((entry) => entry.arm === "candidate" && entry.phase === "S1");
		failed.correct = false;
		failed.timed_out = true;
		// When the unsuccessful row is parsed, then it requires a typed code.
		expectCode(input, "INVALID_FAILURE_CODE_SEMANTICS");
	});
});

test("blocks an incorrect, timed-out, failed turn", () => {
	// Given a self-consistent failed measured turn.
	const input = cohort();
	for (const entry of input.records) entry.failure_code = null;
	const record = input.records.find((entry) => entry.arm === "candidate" && entry.phase === "S1");
	record.correct = false;
	record.failure_code = "TIMEOUT";
	record.timed_out = true;
	// When correctness is aggregated.
	const result = validateCohort(input, scenario());
	// Then the full cohort is blocked with no discarded turn.
	assert.equal(result.verdict, "BLOCKED_CORRECTNESS");
	assert.equal(result.gates.correctness, false);
});

test("blocks the 0.8500001 threshold edge using unrounded values", () => {
	// Given every candidate duration at 85.00001 percent of baseline.
	const input = cohort();
	for (const record of input.records.filter((entry) => entry.arm === "candidate")) {
		record.first_content_offset_ms = 42.500005;
		record.final_receipt_offset_ms = 68.000008;
		record.exit_offset_ms = 85.00001;
	}
	// When latency gates compare their source values.
	const result = validateCohort(input, scenario());
	// Then formatting cannot turn the cohort into a pass.
	assert.equal(result.verdict, "BLOCKED_TARGET_NOT_MET");
	assert.equal(result.gates.candidate_p95, false);
	assert.ok(result.metrics.paired_median_ratio > 0.85);
});

test("reports diagnostics as UNAVAILABLE when authoritative counters are unavailable", () => {
	// Given safe explicit UNAVAILABLE diagnostics on every measured turn.
	const input = cohort();
	for (const record of input.records.filter((entry) => entry.phase !== "B0")) {
		record.cache_read_tokens = "UNAVAILABLE";
		record.cache_write_tokens = "UNAVAILABLE";
	}
	// When verdict metrics are computed.
	const result = validateCohort(input, scenario());
	// Then optional cache diagnostics are unavailable rather than zero.
	assert.deepEqual(result.diagnostics, {
		cache_read_share: "UNAVAILABLE",
		uncached_input_per_correct_turn: "UNAVAILABLE",
		latency_saved_ms_per_1k_cache_read_tokens: "UNAVAILABLE",
	});
});

test("runs the provider-free CLI self-check against the real fixture", () => {
	// Given the actual script entry and checked-in fixture.
	// When its self-check mode runs in a child process.
	const run = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("./harness-speed-contract.mjs", import.meta.url)), "--self-check", fixturePath],
		{ encoding: "utf8" },
	);
	// Then it exits cleanly with an aggregate PASS and no provider work.
	assert.equal(run.status, 0, run.stderr);
	const receipt = JSON.parse(run.stdout);
	assert.equal(receipt.verdict, "PASS");
	assert.equal(receipt.evidence_kind, "provider-free-synthetic-self-check");
	assert.equal(receipt.provider_calls_made_by_validator, 0);
});
