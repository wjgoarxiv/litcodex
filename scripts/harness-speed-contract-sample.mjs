const ARM_ORDERS = [
	["baseline", "candidate", "control"],
	["baseline", "control", "candidate"],
	["candidate", "baseline", "control"],
	["candidate", "control", "baseline"],
	["control", "baseline", "candidate"],
	["control", "candidate", "baseline"],
];

function durationFor(arm) {
	if (arm === "candidate") return 85;
	return 100;
}

export function createProviderFreeCohort(scenario) {
	const records = [];
	let sequence = 1;
	for (const [blockIndex, arms] of ARM_ORDERS.entries()) {
		for (const [orderIndex, arm] of arms.entries()) {
			for (const phase of scenario.records) {
				const duration = durationFor(arm);
				records.push({
					schema: "litfamily.harness-speed/v1",
					scenario_id: scenario.scenario_id,
					product: "litcodex",
					arm,
					block: blockIndex + 1,
					order: orderIndex + 1,
					sequence,
					phase: phase.id,
					prompt_bytes: phase.prompt_bytes,
					prompt_sha256: phase.prompt_sha256,
					response_bytes: phase.sentinel_bytes,
					response_sha256: phase.sentinel_sha256,
					sentinel_match: true,
					route_observed: true,
					output_policy_match: true,
					correct: true,
					failure_code: null,
					timed_out: false,
					start_offset_ms: 0,
					first_content_offset_ms: duration * 0.5,
					final_receipt_offset_ms: duration * 0.8,
					exit_offset_ms: duration,
					input_tokens: 100,
					cache_read_tokens: arm === "candidate" ? 20 : 10,
					cache_write_tokens: 0,
					output_tokens: 5,
				});
				sequence += 1;
			}
		}
	}
	return { schema: "litfamily.harness-speed/v1", scenario_id: scenario.scenario_id, records };
}
