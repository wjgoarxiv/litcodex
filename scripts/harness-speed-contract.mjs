import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProviderFreeCohort } from "./harness-speed-contract-sample.mjs";
import { computeHarnessSpeedVerdict } from "./harness-speed-verdict.mjs";

const SCENARIO_SHA256 = "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be";
const ARMS = ["baseline", "candidate", "control"];
const PHASES = ["B0", "S1", "S2"];
const ARM_ORDERS = [
	["baseline", "candidate", "control"],
	["baseline", "control", "candidate"],
	["candidate", "baseline", "control"],
	["candidate", "control", "baseline"],
	["control", "baseline", "candidate"],
	["control", "candidate", "baseline"],
];
const RECORD_FIELDS = [
	"schema",
	"scenario_id",
	"product",
	"arm",
	"block",
	"order",
	"sequence",
	"phase",
	"prompt_bytes",
	"prompt_sha256",
	"response_bytes",
	"response_sha256",
	"sentinel_match",
	"route_observed",
	"output_policy_match",
	"correct",
	"failure_code",
	"timed_out",
	"start_offset_ms",
	"first_content_offset_ms",
	"final_receipt_offset_ms",
	"exit_offset_ms",
	"input_tokens",
	"cache_read_tokens",
	"cache_write_tokens",
	"output_tokens",
];
const COUNTER_FIELDS = ["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens"];
const FORBIDDEN_FIELDS = new Set([
	"prompt",
	"response",
	"transcript",
	"url",
	"requestid",
	"threadid",
	"sessionid",
	"credential",
	"authorization",
	"cookie",
	"apikey",
]);

export class HarnessSpeedContractError extends Error {
	constructor(code) {
		super(code);
		this.code = code;
	}
}

function fail(code) {
	throw new HarnessSpeedContractError(code);
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPrivacy(value) {
	if (Array.isArray(value)) {
		for (const item of value) assertPrivacy(item);
		return;
	}
	if (!isObject(value)) return;
	for (const [key, nested] of Object.entries(value)) {
		if (FORBIDDEN_FIELDS.has(key.toLowerCase().replaceAll(/[^a-z0-9]/gu, ""))) fail("FORBIDDEN_FIELD");
		assertPrivacy(nested);
	}
}

function assertExactFields(record) {
	for (const field of RECORD_FIELDS) if (!Object.hasOwn(record, field)) fail("MISSING_RECORD_FIELD");
	if (Object.keys(record).length !== RECORD_FIELDS.length) fail("UNEXPECTED_RECORD_FIELD");
}

function assertCounter(value) {
	if (value === "UNAVAILABLE") return;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) fail("INVALID_COUNTER");
	if (!Number.isSafeInteger(value)) fail("UNSAFE_COUNTER");
}

function assertOffset(value, allowUnavailable = false) {
	if (allowUnavailable && value === "UNAVAILABLE") return;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail("INVALID_TIME");
}

function assertTiming(record) {
	assertOffset(record.start_offset_ms);
	assertOffset(record.first_content_offset_ms, true);
	assertOffset(record.final_receipt_offset_ms);
	assertOffset(record.exit_offset_ms);
	const points =
		record.first_content_offset_ms === "UNAVAILABLE"
			? [record.start_offset_ms, record.final_receipt_offset_ms, record.exit_offset_ms]
			: [
					record.start_offset_ms,
					record.first_content_offset_ms,
					record.final_receipt_offset_ms,
					record.exit_offset_ms,
				];
	for (let index = 1; index < points.length; index += 1) {
		if (points[index] < points[index - 1]) fail("NON_MONOTONIC_TIME");
	}
	if (record.exit_offset_ms === record.start_offset_ms) fail("ZERO_BASELINE_LATENCY");
}

function assertRecord(record, expected, phase) {
	if (!isObject(record)) fail("INVALID_RECORD");
	assertExactFields(record);
	if (
		record.schema !== "litfamily.harness-speed/v1" ||
		record.scenario_id !== "litfamily-speed-lit-activation-v1" ||
		record.product !== "litcodex"
	)
		fail("INVALID_IDENTITY");
	if (record.arm !== expected.arm) fail("INVALID_ARM_ORDER");
	if (record.block !== expected.block || record.order !== expected.order) fail("INVALID_SESSION_ORDER");
	if (record.sequence !== expected.sequence) fail("INVALID_SEQUENCE");
	if (record.phase !== phase.id) fail("INVALID_PHASE_SEQUENCE");
	if (record.prompt_bytes !== phase.prompt_bytes || record.prompt_sha256 !== phase.prompt_sha256)
		fail("INVALID_PROMPT_IDENTITY");
	if (record.response_bytes !== phase.sentinel_bytes || record.response_sha256 !== phase.sentinel_sha256)
		fail("INVALID_RESPONSE_IDENTITY");
	for (const field of ["sentinel_match", "route_observed", "output_policy_match", "correct", "timed_out"]) {
		if (typeof record[field] !== "boolean") fail("INVALID_BOOLEAN");
	}
	const successful = record.sentinel_match && record.route_observed && record.output_policy_match && !record.timed_out;
	if (successful && record.failure_code !== null) fail("INVALID_FAILURE_CODE_SEMANTICS");
	if (!successful && (typeof record.failure_code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(record.failure_code)))
		fail("INVALID_FAILURE_CODE_SEMANTICS");
	const expectedCorrect = successful;
	if (record.correct !== expectedCorrect) fail("INCONSISTENT_CORRECTNESS");
	assertTiming(record);
	for (const field of COUNTER_FIELDS) assertCounter(record[field]);
}

export function validateScenarioBytes(bytes) {
	if (!Buffer.isBuffer(bytes) || bytes.length !== 1476 || sha256(bytes) !== SCENARIO_SHA256)
		fail("INVALID_SCENARIO_FIXTURE");
	let scenario;
	try {
		scenario = JSON.parse(bytes.toString("utf8"));
	} catch {
		fail("INVALID_SCENARIO_FIXTURE");
	}
	return scenario;
}

export function validateCohort(input, scenario) {
	assertPrivacy(input);
	if (
		!isObject(input) ||
		input.schema !== "litfamily.harness-speed/v1" ||
		input.scenario_id !== "litfamily-speed-lit-activation-v1" ||
		!Array.isArray(input.records)
	)
		fail("INVALID_COHORT");
	if (Object.keys(input).length !== 3) fail("UNEXPECTED_COHORT_FIELD");
	const observedArms = new Set(input.records.map((record) => record?.arm));
	if (ARMS.some((arm) => !observedArms.has(arm))) fail("MISSING_ARM");
	if (input.records.length !== 54) fail("INVALID_RECORD_COUNT");
	if (!isObject(scenario) || !Array.isArray(scenario.records) || scenario.records.length !== 3)
		fail("INVALID_SCENARIO_FIXTURE");
	let sequence = 1;
	for (const [blockIndex, arms] of ARM_ORDERS.entries()) {
		for (const [orderIndex, arm] of arms.entries()) {
			for (const phaseId of PHASES) {
				const phase = scenario.records.find((record) => record.id === phaseId);
				if (!phase) fail("INVALID_SCENARIO_FIXTURE");
				assertRecord(
					input.records[sequence - 1],
					{ arm, block: blockIndex + 1, order: orderIndex + 1, sequence },
					phase,
				);
				sequence += 1;
			}
		}
	}
	return computeHarnessSpeedVerdict(input.records);
}

function emit(value, exitCode) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
	process.exitCode = exitCode;
}

async function main() {
	try {
		const [mode, scenarioPath, cohortPath] = process.argv.slice(2);
		if (!scenarioPath || !["--self-check", "--cohort"].includes(mode)) fail("INVALID_ARGUMENTS");
		const scenario = validateScenarioBytes(readFileSync(scenarioPath));
		let cohort;
		if (mode === "--self-check") cohort = createProviderFreeCohort(scenario);
		else {
			if (!cohortPath) fail("INVALID_ARGUMENTS");
			try {
				cohort = JSON.parse(readFileSync(cohortPath, "utf8"));
			} catch {
				fail("INVALID_COHORT_JSON");
			}
		}
		emit(
			{
				...validateCohort(cohort, scenario),
				evidence_kind: mode === "--self-check" ? "provider-free-synthetic-self-check" : "cohort-file-validation",
				fixture_sha256: SCENARIO_SHA256,
				provider_calls_made_by_validator: 0,
			},
			0,
		);
	} catch (error) {
		const code = error instanceof HarnessSpeedContractError ? error.code : "UNEXPECTED_FAILURE";
		emit(
			{
				schema: "litfamily.harness-speed/v1",
				product: "litcodex",
				verdict: "INVALID",
				code,
				provider_calls_made_by_validator: 0,
			},
			2,
		);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
