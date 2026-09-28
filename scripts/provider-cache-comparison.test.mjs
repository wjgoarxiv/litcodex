import assert from "node:assert/strict";
import test from "node:test";
import { compareProviderCohorts } from "./provider-cache-comparison.mjs";

function receipt({
	artifact = "candidate",
	runner = "runner",
	activeShare = 0.97,
	controlShare = 0.93,
	activeP95 = 100,
	controlP95 = 100,
	activeFirst = 200,
	controlFirst = 100,
} = {}) {
	const session = (arm) => ({
		arm,
		measurement: { deltas: [{ inputTokens: arm === "active" ? activeFirst : controlFirst, cachedInputTokens: 0 }] },
	});
	return {
		schema: "litcodex.provider-cache-ab/v1",
		status: "measured",
		mode: "live",
		order: "ABBA",
		completionCount: 48,
		blocks: Array.from({ length: 4 }, () => ({ sessions: [session("active"), session("control")] })),
		identity: { executableSha256: "codex", versionSha256: "version" },
		model: { requested: "gpt-5.6-luna" },
		scenario: { id: "scenario", sha256: "scenario-hash" },
		artifact: { sha256: artifact },
		runnerSha256: runner,
		active: {
			status: "measured",
			turns: 20,
			cacheHitRatio: activeShare,
			p95LatencyMs: activeP95,
			correctnessPassed: 20,
		},
		control: {
			status: "measured",
			turns: 20,
			cacheHitRatio: controlShare,
			p95LatencyMs: controlP95,
			correctnessPassed: 20,
		},
		cleanup: { childProcesses: 0, tempHomes: 0, tarballs: 0, rawBuffers: 0 },
	};
}

test("FIRST_TRANSITION_EXCESS comparison passes the exact branch gates", () => {
	const baseline = receipt({
		artifact: "baseline",
		runner: "old",
		activeShare: 0.951,
		activeP95: 110,
		activeFirst: 400,
	});
	const candidate = receipt({ activeFirst: 200 });
	assert.equal(
		compareProviderCohorts({
			baseline,
			candidate,
			expectedArtifactSha256: "candidate",
			approvedRunnerSha256: "runner",
		}).verdict,
		"PASS",
	);
});

test("comparison blocks stale artifacts and control drift", () => {
	const baseline = receipt({ artifact: "baseline", runner: "old", activeFirst: 400 });
	const candidate = receipt({ activeFirst: 200 });
	assert.equal(
		compareProviderCohorts({ baseline, candidate, expectedArtifactSha256: "stale", approvedRunnerSha256: "runner" })
			.verdict,
		"BLOCKED_STALE_CANDIDATE",
	);
	const drifted = receipt({ activeFirst: 200, controlShare: 0.8 });
	assert.equal(
		compareProviderCohorts({
			baseline,
			candidate: drifted,
			expectedArtifactSha256: "candidate",
			approvedRunnerSha256: "runner",
		}).verdict,
		"BLOCKED_PROVIDER_DRIFT",
	);
});
