import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	measureProviderCacheReceipts,
	parseProviderCacheReceipt,
} from "../plugins/litcodex/components/telemetry/dist/provider-cache.js";

export { evaluateLocalPrefixGate } from "./provider-cache-ab-local.mjs";

import { CANONICAL, CLEANUP, SESSION_ORDER } from "./provider-cache-ab-options.mjs";

export { CANONICAL, CLEANUP, parseRunnerArgs, SESSION_ORDER } from "./provider-cache-ab-options.mjs";

export class CohortRunError extends Error {
	constructor(cause, completionCount) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = "CohortRunError";
		this.completionCount = completionCount;
	}
}

export function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

export function readScenario(file) {
	const bytes = readFileSync(file);
	const parsed = JSON.parse(bytes.toString("utf8"));
	if (
		parsed?.schema !== "litcodex.provider-cache-scenario/v1" ||
		parsed?.scenario !== CANONICAL.scenario ||
		!Array.isArray(parsed.records) ||
		parsed.records.length !== 6 ||
		parsed.records.map((record) => record.id).join(",") !== "B0,S1,S2,S3,S4,S5"
	) {
		throw new Error("INVALID_SCENARIO_FIXTURE");
	}
	for (const record of parsed.records) {
		if (typeof record.prompt !== "string" || typeof record.canary !== "string")
			throw new Error("INVALID_SCENARIO_FIXTURE");
	}
	return { scenario: parsed, sha256: sha256(bytes), bytes: bytes.byteLength };
}

export function parseCodexTurn(stdout, canary) {
	let threadId;
	let receipt = null;
	let completedReceipts = 0;
	let response = "";
	for (const line of stdout.split(/\r?\n/)) {
		if (line.trim() === "") continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			throw new Error("MALFORMED_JSONL");
		}
		if (event?.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
		if (
			event?.type === "item.completed" &&
			event.item?.type === "agent_message" &&
			typeof event.item.text === "string"
		) {
			response += event.item.text;
		}
		if (event?.type === "turn.completed") {
			completedReceipts += 1;
			receipt = parseProviderCacheReceipt(event);
		}
	}
	if (completedReceipts !== 1 || receipt === null) throw new Error("MISSING_AUTHORITATIVE_USAGE");
	return {
		threadId,
		receipt,
		correct: response.includes(canary),
		responseSha256: sha256(response),
		responseBytes: Buffer.byteLength(response),
	};
}

export function summarizeSessions(sessions) {
	const byArm = {};
	for (const arm of ["active", "control"]) {
		const selected = sessions.filter((session) => session.arm === arm);
		const deltas = selected.flatMap((session) => session.measurement.deltas);
		const latencies = selected.flatMap((session) => session.turns.map((turn) => turn.latencyMs));
		const inputTokens = deltas.reduce((sum, delta) => sum + delta.inputTokens, 0);
		const cachedInputTokens = deltas.reduce((sum, delta) => sum + delta.cachedInputTokens, 0);
		const ranked = [...latencies].sort((left, right) => left - right);
		byArm[arm] = {
			status: "measured",
			sessions: selected.length,
			turns: deltas.length,
			inputTokens,
			cachedInputTokens,
			uncachedInputTokens: inputTokens - cachedInputTokens,
			cacheHitRatio: cachedInputTokens / inputTokens,
			p95LatencyMs: ranked[Math.ceil(ranked.length * 0.95) - 1],
			correctnessPassed: selected.flatMap((session) => session.turns).filter((turn) => turn.correct).length,
		};
	}
	return byArm;
}

export function fakeSessions(scenario) {
	let ordinal = 0;
	return SESSION_ORDER.flatMap((pair, blockIndex) =>
		pair.map((arm) => {
			ordinal += 1;
			const baseline = { inputTokens: ordinal * 1000, cachedInputTokens: ordinal * 800 };
			const snapshots = scenario.records.slice(1).map((_, turnIndex) => ({
				inputTokens: baseline.inputTokens + (turnIndex + 1) * 100,
				cachedInputTokens: baseline.cachedInputTokens + (turnIndex + 1) * (arm === "active" ? 98 : 90),
			}));
			const measurement = measureProviderCacheReceipts({ baseline, snapshots });
			if (measurement.status !== "measured") throw new Error("FAKE_MEASUREMENT_INVALID");
			return {
				block: blockIndex + 1,
				arm,
				measurement,
				turns: scenario.records.slice(1).map((record, turnIndex) => ({
					id: record.id,
					latencyMs: 100 + blockIndex * 10 + turnIndex,
					correct: true,
					responseSha256: sha256(record.canary),
					responseBytes: Buffer.byteLength(record.canary),
				})),
			};
		}),
	);
}

export function publicBlocks(sessions) {
	return SESSION_ORDER.map((order, index) => ({
		block: index + 1,
		order,
		sessions: sessions
			.filter((session) => session.block === index + 1)
			.map((session) => ({ arm: session.arm, measurement: session.measurement, turns: session.turns })),
	}));
}

export function baseReceipt(status, mode, code, completionCount = 0) {
	return {
		schema: "litcodex.provider-cache-ab/v1",
		status,
		mode,
		...(code === undefined ? {} : { code }),
		order: CANONICAL.order,
		completionCount,
		cleanup: { ...CLEANUP },
	};
}

export function publicScenario(scenarioMeta) {
	return {
		id: CANONICAL.scenario,
		sha256: scenarioMeta.sha256,
		bytes: scenarioMeta.bytes,
		records: scenarioMeta.scenario.records.map((record) => ({
			id: record.id,
			promptSha256: sha256(record.prompt),
			promptBytes: Buffer.byteLength(record.prompt),
		})),
	};
}

export function preflightReceipt(options, scenarioMeta, status, code, runnerSha256, completionCount = 0) {
	return {
		...baseReceipt(status, options.live ? "live" : "fake", code, completionCount),
		model: { requested: options.model },
		runnerSha256,
		scenario: publicScenario(scenarioMeta),
	};
}

export function publicReceipt(mode, options, scenarioMeta, sessions, identity, artifact, runnerSha256) {
	const summary = summarizeSessions(sessions);
	return {
		schema: "litcodex.provider-cache-ab/v1",
		status: "measured",
		mode,
		order: CANONICAL.order,
		blocks: publicBlocks(sessions),
		completionCount: 48,
		model: { requested: options.model },
		identity,
		artifact,
		runnerSha256,
		scenario: publicScenario(scenarioMeta),
		active: summary.active,
		control: summary.control,
		cleanup: { ...CLEANUP },
	};
}

export function classifyFailure(error) {
	if (error instanceof CohortRunError) return classifyFailure(error.cause);
	if (
		(error?.name === "HostAuthError" || error?.name === "ProcessProbeError" || error?.name === "SkillProbeError") &&
		typeof error?.code === "string"
	) {
		return error.code;
	}
	const message = String(error?.message ?? error);
	const typed = message.match(
		/^(BLOCKED_[A-Z_]+|PROMPT_INPUT_[A-Z_]+|SKILL_[A-Z_]+|APP_SERVER_[A-Z_]+|LOCAL_PROBE_[A-Z_]+|PLUGIN_INVENTORY_[A-Z_]+|EXTRA_PLUGIN_INSTALLED|PACK_ARTIFACT_INVALID|SANDBOX_AUTH_FILE_FORBIDDEN|CODEX_EXECUTABLE_NOT_FOUND)/u,
	)?.[1];
	if (typed !== undefined) return typed;
	if (message.startsWith("PROCESS_NONZERO:")) return "PROCESS_NONZERO";
	if (/rate.?limit|429/i.test(message)) return "PROVIDER_RATE_LIMIT";
	if (/auth|api.?key|401|unauthorized/i.test(message)) return "PROVIDER_AUTH_FAILURE";
	if (/MISSING_AUTHORITATIVE_USAGE/.test(message)) return "MISSING_AUTHORITATIVE_USAGE";
	if (/CORRECTNESS_FAILURE/.test(message)) return "CORRECTNESS_FAILURE";
	return "RUNNER_EXECUTION_FAILED";
}
