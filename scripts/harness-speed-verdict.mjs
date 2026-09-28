const UNAVAILABLE = "UNAVAILABLE";

export function nearestRank(values, percentile) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function duration(record) {
	return record.exit_offset_ms - record.start_offset_ms;
}

function numericSum(records, key) {
	let total = 0;
	for (const record of records) {
		if (record[key] === UNAVAILABLE) return UNAVAILABLE;
		total += record[key];
	}
	return total;
}

function armMetrics(records) {
	const latencies = records.map(duration);
	return {
		p50_ms: nearestRank(latencies, 0.5),
		p95_ms: nearestRank(latencies, 0.95),
		total_e2e_ms: latencies.reduce((total, value) => total + value, 0),
		total_input_tokens: numericSum(records, "input_tokens"),
	};
}

function cacheDiagnostics(baseline, candidate) {
	const candidateInput = numericSum(candidate, "input_tokens");
	const candidateRead = numericSum(candidate, "cache_read_tokens");
	if (candidateInput === UNAVAILABLE || candidateRead === UNAVAILABLE || candidateInput <= 0) {
		return {
			cache_read_share: UNAVAILABLE,
			uncached_input_per_correct_turn: UNAVAILABLE,
			latency_saved_ms_per_1k_cache_read_tokens: UNAVAILABLE,
		};
	}
	const uncached = candidateInput - candidateRead;
	const cacheReadShare = candidateRead / candidateInput;
	const uncachedPerTurn = uncached >= 0 ? uncached / candidate.length : UNAVAILABLE;
	const baselineTotal = baseline.map(duration).reduce((total, value) => total + value, 0);
	const candidateTotal = candidate.map(duration).reduce((total, value) => total + value, 0);
	const latencySaved = candidateRead > 0 ? (baselineTotal - candidateTotal) / (candidateRead / 1000) : UNAVAILABLE;
	return {
		cache_read_share: cacheReadShare,
		uncached_input_per_correct_turn: uncachedPerTurn,
		latency_saved_ms_per_1k_cache_read_tokens: latencySaved,
	};
}

function correctnessPass(records, arm) {
	const selected = records.filter((record) => record.arm === arm);
	const warmups = selected.filter((record) => record.phase === "B0");
	const measured = selected.filter((record) => record.phase !== "B0");
	return (
		warmups.length === 6 &&
		measured.length === 12 &&
		[...warmups, ...measured].every((record) => record.correct && !record.timed_out && record.failure_code === null)
	);
}

export function computeHarnessSpeedVerdict(records) {
	const measured = records.filter((record) => record.phase !== "B0");
	const baseline = measured.filter((record) => record.arm === "baseline");
	const candidate = measured.filter((record) => record.arm === "candidate");
	const control = measured.filter((record) => record.arm === "control");
	const baselineMetrics = armMetrics(baseline);
	const candidateMetrics = armMetrics(candidate);
	const controlMetrics = armMetrics(control);
	const pairedRatios = baseline.map((baselineRecord) => {
		const candidateRecord = candidate.find(
			(record) => record.block === baselineRecord.block && record.phase === baselineRecord.phase,
		);
		return duration(candidateRecord) / duration(baselineRecord);
	});
	const earlyControlP95 = nearestRank(control.slice(0, 6).map(duration), 0.95);
	const lateControlP95 = nearestRank(control.slice(6).map(duration), 0.95);
	const controlDrift = Math.abs(lateControlP95 - earlyControlP95) / earlyControlP95;
	const pairedMedian = nearestRank(pairedRatios, 0.5);
	const correctness = ["baseline", "candidate", "control"].every((arm) => correctnessPass(records, arm));
	const inputAvailable =
		baselineMetrics.total_input_tokens !== UNAVAILABLE && candidateMetrics.total_input_tokens !== UNAVAILABLE;
	const gates = {
		correctness,
		candidate_p95: candidateMetrics.p95_ms <= baselineMetrics.p95_ms * 0.85,
		candidate_p50: candidateMetrics.p50_ms <= baselineMetrics.p50_ms,
		paired_median: pairedMedian <= 0.85,
		control_drift: controlDrift <= 0.2,
		anti_padding: inputAvailable && candidateMetrics.total_input_tokens <= baselineMetrics.total_input_tokens,
	};
	let verdict = "PASS";
	if (!gates.correctness) verdict = "BLOCKED_CORRECTNESS";
	else if (!gates.control_drift) verdict = "BLOCKED_ENVIRONMENT_DRIFT";
	else if (!inputAvailable) verdict = "BLOCKED_INPUT_TOKENS_UNAVAILABLE";
	else if (!gates.anti_padding) verdict = "BLOCKED_INPUT_PADDING";
	else if (!gates.candidate_p95 || !gates.candidate_p50 || !gates.paired_median) verdict = "BLOCKED_TARGET_NOT_MET";
	return {
		schema: "litfamily.harness-speed/v1",
		scenario_id: "litfamily-speed-lit-activation-v1",
		product: "litcodex",
		verdict,
		cohort: { records: 54, sessions_per_arm: 6, measured_turns_per_arm: 12 },
		metrics: {
			baseline: baselineMetrics,
			candidate: candidateMetrics,
			control: controlMetrics,
			paired_median_ratio: pairedMedian,
			control_early_p95_ms: earlyControlP95,
			control_late_p95_ms: lateControlP95,
			control_drift_ratio: controlDrift,
		},
		gates,
		diagnostics: cacheDiagnostics(baseline, candidate),
	};
}
