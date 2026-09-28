import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSelfCheckSource, FIXTURE_SHA256, sourceIdentityError } from "./harness-speed-v2-identity.mjs";
import { armSampleValues, blocksError, createSelfCheckBlocks, PHASES } from "./harness-speed-v2-samples.mjs";

const TOP_FIELDS = ["schema", "product", "mode", "source", "blocks", "guards", "provider", "selected", "context"];
const GUARD_TOTALS = Object.freeze({
	correctness: 180,
	body: 36,
	generated: 36,
	explicit_selectors: 9,
	compaction: 9,
	reactivation: 9,
	session_start_hooks: 3,
	user_prompt_submit_hooks: 4,
});
const FORBIDDEN_FIELDS = new Set([
	"prompt",
	"response",
	"transcript",
	"url",
	"credential",
	"authorization",
	"cookie",
	"apikey",
]);

export class HarnessSpeedV2ContractError extends Error {
	constructor(code) {
		super(code);
		this.code = code;
	}
}

function fail(code) {
	throw new HarnessSpeedV2ContractError(code);
}

function hash(value) {
	return createHash("sha256").update(value).digest("hex");
}

function object(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields) {
	if (
		!object(value) ||
		Object.keys(value).length !== fields.length ||
		fields.some((field) => !Object.hasOwn(value, field))
	)
		fail("MALFORMED_RECEIPT");
}

function privacy(value) {
	if (Array.isArray(value)) {
		for (const item of value) privacy(item);
		return;
	}
	if (!object(value)) return;
	for (const [key, nested] of Object.entries(value)) {
		const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
		if (normalized === "claimedsuccess") fail("MISLEADING_SUCCESS_FIELD");
		if (FORBIDDEN_FIELDS.has(normalized)) fail("FORBIDDEN_FIELD");
		privacy(nested);
	}
}

function source(value) {
	const error = sourceIdentityError(value);
	if (error !== null) fail(error);
}

function blocks(value) {
	const error = blocksError(value);
	if (error !== null) fail(error);
}

export function nearestRankV2(values, percentile) {
	const ranked = [...values].sort((left, right) => left - right);
	return ranked[Math.ceil(ranked.length * percentile) - 1];
}

function metrics(input) {
	const summarize = (values) => ({ p50: nearestRankV2(values, 0.5), p95: nearestRankV2(values, 0.95) });
	const aggregate = {
		baseline: summarize(armSampleValues(input, "baseline")),
		candidate: summarize(armSampleValues(input, "candidate")),
	};
	const phase = Object.fromEntries(
		PHASES.map((id) => [
			id,
			{
				baseline: summarize(armSampleValues(input, "baseline", id)),
				candidate: summarize(armSampleValues(input, "candidate", id)),
			},
		]),
	);
	const early = nearestRankV2(armSampleValues(input, "baseline", null, input.blocks.slice(0, 3)), 0.95);
	const late = nearestRankV2(armSampleValues(input, "baseline", null, input.blocks.slice(3)), 0.95);
	return { aggregate, phase, baseline_drift: Math.abs(late - early) / early };
}

function guards(value) {
	exactFields(value, Object.keys(GUARD_TOTALS));
	for (const [name, total] of Object.entries(GUARD_TOTALS)) {
		exactFields(value[name], ["passed", "total"]);
		if (value[name].passed !== total || value[name].total !== total) fail("GUARD_FAILURE");
	}
}

function provider(value) {
	exactFields(value, ["calls", "completions", "usage", "cache"]);
	if (value.calls !== 0 || value.completions !== 0) fail("PROVIDER_BOUNDARY_BREACH");
	if (value.usage !== "UNAVAILABLE" || value.cache !== "UNAVAILABLE") fail("PROVIDER_UNAVAILABLE_NOT_TYPED");
}

function context(value) {
	exactFields(value, ["removed", "loader_proof"]);
	if (typeof value.removed !== "boolean") fail("MALFORMED_RECEIPT");
	if (!value.removed) return;
	const proof = value.loader_proof;
	if (!object(proof)) fail("CONTEXT_LOADER_UNPROVEN");
	exactFields(proof, ["mechanism", "observed", "pre_request", "body_sha256", "loaded_sha256"]);
	if (
		proof.mechanism !== "codex-user-prompt-submit-hook" ||
		proof.observed !== true ||
		proof.pre_request !== true ||
		!/^[0-9a-f]{64}$/u.test(proof.body_sha256) ||
		proof.loaded_sha256 !== proof.body_sha256
	)
		fail("CONTEXT_LOADER_UNPROVEN");
}

function selected(value, computed) {
	if (!object(value) || !["latency", "context"].includes(value.type)) fail("MALFORMED_RECEIPT");
	if (value.type === "latency") {
		exactFields(value, ["type", "phase"]);
		if (!PHASES.includes(value.phase)) fail("MALFORMED_RECEIPT");
		const phase = computed.phase[value.phase];
		if ((phase.baseline.p95 - phase.candidate.p95) / phase.baseline.p95 < 0.15) fail("LEVER_THRESHOLD_NOT_MET");
	} else {
		exactFields(value, ["type", "baseline_bytes", "candidate_bytes"]);
		if (
			![value.baseline_bytes, value.candidate_bytes].every(Number.isSafeInteger) ||
			value.baseline_bytes <= 0 ||
			value.candidate_bytes < 0
		)
			fail("MALFORMED_RECEIPT");
		if ((value.baseline_bytes - value.candidate_bytes) / value.baseline_bytes < 0.25) fail("LEVER_THRESHOLD_NOT_MET");
	}
}

function fixture(bytes) {
	if (!Buffer.isBuffer(bytes) || bytes.length !== 1476 || hash(bytes) !== FIXTURE_SHA256)
		fail("INVALID_SCENARIO_FIXTURE");
}

export function validateV2Receipt(input, fixtureBytes) {
	privacy(input);
	exactFields(input, TOP_FIELDS);
	fixture(fixtureBytes);
	if (
		input.schema !== "litcodex.harness-speed-v2/v1" ||
		input.product !== "litcodex" ||
		input.mode !== "provider-free"
	)
		fail("MALFORMED_RECEIPT");
	source(input.source);
	blocks(input.blocks);
	guards(input.guards);
	provider(input.provider);
	if (input.selected?.type === "context" && input.context?.removed !== true) fail("CONTEXT_LOADER_UNPROVEN");
	context(input.context);
	const computed = metrics(input);
	if (computed.baseline_drift > 0.2) fail("BASELINE_ENVIRONMENT_DRIFT");
	if (
		computed.aggregate.candidate.p50 > computed.aggregate.baseline.p50 ||
		computed.aggregate.candidate.p95 > computed.aggregate.baseline.p95
	)
		fail("AGGREGATE_REGRESSION");
	if (PHASES.some((phase) => computed.phase[phase].candidate.p95 > computed.phase[phase].baseline.p95))
		fail("PHASE_REGRESSION");
	selected(input.selected, computed);
	return {
		schema: input.schema,
		product: input.product,
		verdict: "PASS",
		metrics: {
			aggregate: {
				baseline_p50: computed.aggregate.baseline.p50,
				baseline_p95: computed.aggregate.baseline.p95,
				candidate_p50: computed.aggregate.candidate.p50,
				candidate_p95: computed.aggregate.candidate.p95,
			},
			phase: computed.phase,
			baseline_drift_ratio: computed.baseline_drift,
		},
		provider: input.provider,
	};
}

export function createV2SelfCheckReceipt() {
	return {
		schema: "litcodex.harness-speed-v2/v1",
		product: "litcodex",
		mode: "provider-free",
		source: createSelfCheckSource(),
		blocks: createSelfCheckBlocks(),
		guards: Object.fromEntries(Object.entries(GUARD_TOTALS).map(([name, total]) => [name, { passed: total, total }])),
		provider: { calls: 0, completions: 0, usage: "UNAVAILABLE", cache: "UNAVAILABLE" },
		selected: { type: "latency", phase: "S1" },
		context: { removed: false, loader_proof: null },
	};
}

async function main() {
	try {
		const [mode, fixturePath] = process.argv.slice(2);
		if (mode !== "--self-check" || !fixturePath) fail("INVALID_ARGUMENTS");
		process.stdout.write(
			`${JSON.stringify(validateV2Receipt(createV2SelfCheckReceipt(), readFileSync(fixturePath)), null, 2)}\n`,
		);
	} catch (error) {
		process.stdout.write(
			`${JSON.stringify({ schema: "litcodex.harness-speed-v2/v1", product: "litcodex", verdict: "INVALID", code: error?.code ?? "UNEXPECTED_FAILURE", provider: { calls: 0, completions: 0, usage: "UNAVAILABLE", cache: "UNAVAILABLE" } }, null, 2)}\n`,
		);
		process.exitCode = 2;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
