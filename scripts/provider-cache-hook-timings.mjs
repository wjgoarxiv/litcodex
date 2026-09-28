import { join } from "node:path";
import { performance } from "node:perf_hooks";

const LOCAL_SPEED_HANDLERS = Object.freeze({
	sessionStart: Object.freeze([
		{ id: "telemetry", component: "telemetry", route: "session-start" },
		{ id: "auto-update", component: "auto-update", route: "session-start" },
		{ id: "rules", component: "rules", route: "session-start" },
	]),
	userPromptSubmit: Object.freeze([
		{ id: "start-work-continuation", component: "start-work-continuation", route: "user-prompt-submit" },
		{ id: "lit-loop", component: "lit-loop", route: "user-prompt-submit" },
		{ id: "rules", component: "rules", route: "user-prompt-submit" },
		{ id: "wikify-knowledge", component: "wikify-knowledge", route: "user-prompt-submit" },
	]),
});

function nearestRank(values, percentile) {
	const ranked = [...values].sort((left, right) => left - right);
	return ranked[Math.max(0, Math.ceil(percentile * ranked.length) - 1)];
}

function timingSummary(samples) {
	return {
		p50Ms: nearestRank(samples, 0.5),
		p95Ms: nearestRank(samples, 0.95),
		minMs: Math.min(...samples),
		maxMs: Math.max(...samples),
	};
}

function summarizeHookEvent(handlers, handlerSamples, aggregateSamples) {
	const reconciliationSamples = aggregateSamples.map((aggregateMs, index) => {
		const handlerSumMs = handlerSamples.reduce((sum, handler) => sum + handler.samplesMs[index], 0);
		return { aggregateMs, handlerSumMs, overheadMs: aggregateMs - handlerSumMs, pass: aggregateMs >= handlerSumMs };
	});
	return {
		handlers: handlers.map((handler, index) => ({
			id: handler.id,
			...timingSummary(handlerSamples[index].samplesMs),
			outputBytes: handlerSamples[index].outputBytes,
			outputPolicyPass: handlerSamples[index].outputPolicyPass.every(Boolean),
		})),
		aggregate: timingSummary(aggregateSamples),
		reconciliation: {
			allSamplesPass: reconciliationSamples.every((sample) => sample.pass),
			samples: reconciliationSamples,
		},
	};
}

function hookOutputPolicy(eventKey, handlerId, stdout) {
	if (eventKey === "sessionStart" && handlerId === "rules") {
		try {
			return typeof JSON.parse(stdout)?.hookSpecificOutput?.additionalContext === "string";
		} catch {
			return false;
		}
	}
	if (eventKey === "userPromptSubmit" && handlerId === "lit-loop") {
		try {
			return JSON.parse(stdout)?.hookSpecificOutput?.additionalContext?.includes("<lit-plan-mode>") === true;
		} catch {
			return false;
		}
	}
	return stdout === "";
}

/** Measure installed local hook subprocesses only; retain timings and byte counts, never output text. */
export async function measureInstalledHookTimings({
	pluginRoot,
	fixtureRoot,
	env,
	prompt,
	samples = 9,
	runCommand,
	now = performance.now.bind(performance),
}) {
	if (!Number.isSafeInteger(samples) || samples < 1) throw new Error("LOCAL_SPEED_SAMPLES_INVALID");
	const events = [
		{
			key: "sessionStart",
			handlers: LOCAL_SPEED_HANDLERS.sessionStart,
			payload: (sample) => ({
				hook_event_name: "SessionStart",
				session_id: `local-speed-session-${sample}`,
				transcript_path: null,
				cwd: fixtureRoot,
				model: "gpt-5.6-luna",
				permission_mode: "default",
				source: "startup",
			}),
		},
		{
			key: "userPromptSubmit",
			handlers: LOCAL_SPEED_HANDLERS.userPromptSubmit,
			payload: (sample) => ({
				hook_event_name: "UserPromptSubmit",
				session_id: `local-speed-session-${sample}`,
				turn_id: `local-speed-turn-${sample}`,
				transcript_path: null,
				cwd: fixtureRoot,
				model: "gpt-5.6-luna",
				permission_mode: "default",
				prompt,
			}),
		},
	];
	const receipt = { schema: "litcodex.local-hook-speed/v1", providerCompletions: 0, samples, clock: "monotonic" };
	for (const event of events) {
		const handlerSamples = event.handlers.map(() => ({ samplesMs: [], outputBytes: [], outputPolicyPass: [] }));
		const aggregateSamples = [];
		for (let sample = 0; sample < samples; sample += 1) {
			const aggregateStarted = now();
			for (const [index, handler] of event.handlers.entries()) {
				const cli = join(pluginRoot, "components", handler.component, "dist", "cli.js");
				const started = now();
				const result = await runCommand(process.execPath, [cli, "hook", handler.route], {
					cwd: fixtureRoot,
					env,
					input: JSON.stringify(event.payload(sample)),
				});
				const ended = now();
				if (result.exitCode !== undefined && result.exitCode !== 0)
					throw new Error(`LOCAL_HOOK_NONZERO:${handler.id}`);
				handlerSamples[index].samplesMs.push(ended - started);
				handlerSamples[index].outputBytes.push(Buffer.byteLength(result.stdout ?? ""));
				handlerSamples[index].outputPolicyPass.push(hookOutputPolicy(event.key, handler.id, result.stdout ?? ""));
			}
			aggregateSamples.push(now() - aggregateStarted);
		}
		receipt[event.key] = summarizeHookEvent(event.handlers, handlerSamples, aggregateSamples);
	}
	return receipt;
}

export function evaluateLocalHookTimingGate(receipt) {
	for (const eventKey of ["sessionStart", "userPromptSubmit"]) {
		const event = receipt?.[eventKey];
		if (event?.reconciliation?.allSamplesPass !== true) {
			return { status: "BLOCKED", code: "BLOCKED_LOCAL_HOOK_TIMING_RECONCILIATION", event: eventKey };
		}
		if (!Array.isArray(event.handlers) || event.handlers.some((handler) => handler.outputPolicyPass !== true)) {
			return { status: "BLOCKED", code: "BLOCKED_LOCAL_HOOK_OUTPUT_POLICY", event: eventKey };
		}
	}
	return { status: "PASS" };
}
