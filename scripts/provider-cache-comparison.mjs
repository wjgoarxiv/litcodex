const BLOCKS = 4;
const COMPLETIONS = 48;
const TURNS_PER_ARM = 20;

function same(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function finite(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function validReceipt(receipt) {
	return (
		receipt?.schema === "litcodex.provider-cache-ab/v1" &&
		receipt.status === "measured" &&
		receipt.mode === "live" &&
		receipt.order === "ABBA" &&
		receipt.completionCount === COMPLETIONS &&
		Array.isArray(receipt.blocks) &&
		receipt.blocks.length === BLOCKS &&
		[receipt.active, receipt.control].every(
			(arm) =>
				arm?.status === "measured" &&
				arm.turns === TURNS_PER_ARM &&
				finite(arm.cacheHitRatio) &&
				finite(arm.p95LatencyMs) &&
				arm.correctnessPassed === TURNS_PER_ARM,
		)
	);
}

function firstTransitionExcess(receipt) {
	const uncached = { active: 0, control: 0 };
	for (const block of receipt.blocks) {
		for (const session of block.sessions) {
			const first = session?.measurement?.deltas?.[0];
			if (!first || ![first.inputTokens, first.cachedInputTokens].every(Number.isSafeInteger)) return undefined;
			uncached[session.arm] += first.inputTokens - first.cachedInputTokens;
		}
	}
	return uncached.active - uncached.control;
}

function privacyPass(receipt) {
	const forbiddenKeys = new Set(["threadId", "thread_id", "prompt", "response", "authPath", "home"]);
	let pass = true;
	const visit = (value) => {
		if (typeof value === "string" && (/\/Users\//u.test(value) || /LCPC_[A-Z0-9_]+/u.test(value))) pass = false;
		if (Array.isArray(value)) value.forEach(visit);
		else if (value !== null && typeof value === "object") {
			for (const [key, nested] of Object.entries(value)) {
				if (forbiddenKeys.has(key)) pass = false;
				visit(nested);
			}
		}
	};
	visit(receipt);
	return pass;
}

function cleanupPass(receipt) {
	return receipt?.cleanup !== undefined && Object.values(receipt.cleanup).every((value) => value === 0);
}

export function compareProviderCohorts({ baseline, candidate, expectedArtifactSha256, approvedRunnerSha256 }) {
	if (!validReceipt(baseline) || !validReceipt(candidate)) {
		return { verdict: "BLOCKED_RECEIPT_UNAVAILABLE", comparison: null, acceptance: null };
	}
	const identity = {
		codexExecutable: baseline.identity?.executableSha256 === candidate.identity?.executableSha256,
		codexVersion: baseline.identity?.versionSha256 === candidate.identity?.versionSha256,
		requestedModel: baseline.model?.requested === candidate.model?.requested,
		scenario: same(baseline.scenario, candidate.scenario),
		orderAndCardinality: baseline.order === candidate.order && baseline.completionCount === candidate.completionCount,
		candidateArtifact: candidate.artifact?.sha256 === expectedArtifactSha256,
		approvedRunner: candidate.runnerSha256 === approvedRunnerSha256,
	};
	if (Object.values(identity).includes(false)) {
		return { verdict: "BLOCKED_STALE_CANDIDATE", comparison: { identity }, acceptance: null };
	}
	const baselineExcess = firstTransitionExcess(baseline);
	const candidateExcess = firstTransitionExcess(candidate);
	if (![baselineExcess, candidateExcess].every(Number.isSafeInteger)) {
		return { verdict: "BLOCKED_RECEIPT_UNAVAILABLE", comparison: null, acceptance: null };
	}
	const controlShareMovement = Math.abs(candidate.control.cacheHitRatio - baseline.control.cacheHitRatio);
	const controlP95Movement =
		Math.abs(candidate.control.p95LatencyMs - baseline.control.p95LatencyMs) / baseline.control.p95LatencyMs;
	const gates = {
		identityMatch: true,
		candidateActiveStrictlyAbove95Percent: candidate.active.cacheHitRatio > 0.95,
		activeCorrectness20Of20: candidate.active.correctnessPassed === TURNS_PER_ARM,
		activeP95AtMost110PercentOfBaseline: candidate.active.p95LatencyMs <= baseline.active.p95LatencyMs * 1.1,
		candidatePluginExcessAtMostHalfBaseline: candidateExcess * 2 <= baselineExcess,
		controlShareMovementAtMost5PercentagePoints: controlShareMovement <= 0.05,
		controlP95MovementAtMost20Percent: controlP95Movement <= 0.2,
		privacyAllowlist: privacyPass(candidate),
		cleanupZero: cleanupPass(candidate),
	};
	let verdict = "PASS";
	if (!gates.controlShareMovementAtMost5PercentagePoints || !gates.controlP95MovementAtMost20Percent)
		verdict = "BLOCKED_PROVIDER_DRIFT";
	else if (!gates.privacyAllowlist) verdict = "BLOCKED_PRIVACY_GUARD";
	else if (!gates.cleanupZero) verdict = "BLOCKED_CLEANUP";
	else if (Object.values(gates).includes(false)) verdict = "BLOCKED_TARGET_NOT_MET";
	return {
		verdict,
		comparison: {
			schema: "litcodex.provider-cache-comparison/v1",
			verdict,
			identity,
			baseline: {
				activeCacheReadShare: baseline.active.cacheHitRatio,
				controlCacheReadShare: baseline.control.cacheHitRatio,
				activeP95LatencyMs: baseline.active.p95LatencyMs,
				controlP95LatencyMs: baseline.control.p95LatencyMs,
				pluginExcessS1UncachedTokens: baselineExcess,
			},
			candidate: {
				activeCacheReadShare: candidate.active.cacheHitRatio,
				controlCacheReadShare: candidate.control.cacheHitRatio,
				activeP95LatencyMs: candidate.active.p95LatencyMs,
				controlP95LatencyMs: candidate.control.p95LatencyMs,
				pluginExcessS1UncachedTokens: candidateExcess,
			},
			movement: {
				controlSharePercentagePoints: controlShareMovement * 100,
				controlP95Ratio: controlP95Movement,
				activeP95Ratio: candidate.active.p95LatencyMs / baseline.active.p95LatencyMs,
				pluginExcessReductionRatio: (baselineExcess - candidateExcess) / baselineExcess,
			},
		},
		acceptance: {
			schema: "litcodex.provider-cache-acceptance/v1",
			verdict,
			branch: "FIRST_TRANSITION_EXCESS",
			gates,
			providerCompletions: {
				baseline: COMPLETIONS,
				candidate: COMPLETIONS,
				matchedPairTotal: COMPLETIONS * 2,
				automaticRetry: false,
			},
		},
	};
}
