import assert from "node:assert/strict";
import test from "node:test";

test("prompt-input gate parses host arrays without retaining raw text or provider work", async () => {
	const core = await import("./provider-cache-ab-core.mjs");
	const processBoundary = await import("./provider-cache-ab-process.mjs");
	const contextBoundary = await import("./install-smoke-context-probes.mjs");
	const rawMarker = "IGNORE_PRIOR_RULES_RAW_MARKER";
	const hostArray = JSON.stringify([
		{
			type: "message",
			role: "developer",
			id: "item-1",
			content: [{ type: "input_text", text: rawMarker }],
			internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
		},
	]);
	assert.equal(typeof core.parseRunnerArgs, "function");
	assert.equal(typeof processBoundary.parsePromptInput, "function");
	const options = core.parseRunnerArgs(["--prompt-input-gate", "--model", "gpt-5.6-luna"]);
	const parsed = processBoundary.parsePromptInput(hostArray);
	const hostItemWithoutId = JSON.parse(hostArray);
	delete hostItemWithoutId[0].id;
	assert.equal(options.promptInputGate, true);
	assert.equal(parsed.totalBytes, Buffer.byteLength(rawMarker));
	assert.equal(parsed.identitySha256, parsed.sha256);
	assert.equal(parsed.items.length, 1);
	assert.equal(JSON.stringify(parsed).includes(rawMarker), false);
	assert.equal(processBoundary.parsePromptInput(JSON.stringify(hostItemWithoutId)).items.length, 1);
	assert.throws(() => processBoundary.parsePromptInput("{}"), /PROMPT_INPUT_NOT_ARRAY/);
	assert.throws(
		() => processBoundary.parsePromptInput(hostArray.replace('"turn_id"', '"unknown"')),
		/PROMPT_INPUT_UNKNOWN_FIELD/,
	);
	assert.throws(
		() => processBoundary.parsePromptInput(JSON.stringify([...JSON.parse(hostArray), ...JSON.parse(hostArray)])),
		/PROMPT_INPUT_DUPLICATE_ROLE_ITEM/,
	);
	assert.throws(
		() =>
			contextBoundary.parsePluginInventory(
				JSON.stringify({
					available: [],
					installed: [{ name: "unexpected", pluginId: "x@y", version: "1", enabled: true }],
				}),
				[],
			),
		/PROMPT_INPUT_UNKNOWN_FIELD|EXTRA_PLUGIN_INSTALLED/,
	);
});

test("local prefix admission uses exact identity and integer arithmetic", async () => {
	const core = await import("./provider-cache-ab-core.mjs");
	const arm = (bytes, hash = "control-hash") => ({
		promptInput: { totalBytes: bytes, sha256: hash, identitySha256: hash },
	});
	const baseline = {
		identity: { executableSha256: "codex", versionSha256: "version" },
		model: { requested: "gpt-5.6-luna" },
		scenario: { sha256: "scenario" },
		prompt: "S1",
		active: arm(32_307, "baseline-active"),
		control: arm(8_034),
		deltaBytes: 24_273,
	};
	const passing = { ...baseline, active: arm(20_000, "candidate-active"), deltaBytes: 11_966 };
	const weak = { ...baseline, active: arm(21_000, "candidate-active"), deltaBytes: 12_966 };
	assert.deepEqual(core.evaluateLocalPrefixGate(baseline, passing), {
		status: "PASS",
		code: "LOCAL_PREFIX_REDUCTION_ACCEPTED",
		baselineDeltaBytes: 24_273,
		candidateDeltaBytes: 11_966,
		twiceCandidateDeltaBytes: 23_932,
	});
	assert.equal(core.evaluateLocalPrefixGate(baseline, weak).code, "BLOCKED_LOCAL_PREFIX_REDUCTION");
	assert.equal(
		core.evaluateLocalPrefixGate(baseline, { ...passing, control: arm(8_034, "changed") }).code,
		"BLOCKED_PROMPT_INPUT_IDENTITY",
	);
});

test("live artifact pin is validated before provider work", async () => {
	const core = await import("./provider-cache-ab-core.mjs");
	const digest = "a".repeat(64);
	assert.equal(core.parseRunnerArgs(["--live", "--expected-artifact-sha256", digest]).expectedArtifactSha256, digest);
	assert.throws(() => core.parseRunnerArgs(["--expected-artifact-sha256", digest]), /INVALID_COHORT_CONFIG/);
	assert.throws(() => core.parseRunnerArgs(["--live", "--expected-artifact-sha256", "bad"]), /INVALID_COHORT_CONFIG/);
	assert.equal(core.classifyFailure(new Error("BLOCKED_STALE_CANDIDATE")), "BLOCKED_STALE_CANDIDATE");
});

test("explicit skill request summary proves one exact full body without retaining request text", async () => {
	const probes = await import("./provider-cache-skill-probes.mjs");
	const skill = "---\nname: lit-plan\ndescription: Plan work.\n---\n\n# Plan body\n";
	const request = { input: [{ content: [{ type: "input_text", text: `<skill>${skill.trim()}</skill>` }] }] };
	const summary = probes.summarizeSkillRequest(request, "lit-plan", skill);
	assert.equal(summary.fullSkillOccurrences, 1);
	assert.equal(summary.bodyOccurrences, 1);
	assert.equal(JSON.stringify(summary).includes("Plan body"), false);
});

test("prompt-input local lane accepts only an absolute isolated source root and an exact positive delta", async () => {
	const core = await import("./provider-cache-ab-core.mjs");
	const options = core.parseRunnerArgs([
		"--prompt-input-gate",
		"--repo-root",
		process.cwd(),
		"--expected-prompt-delta",
		"11696",
	]);
	assert.equal(options.repoRoot, process.cwd());
	assert.equal(options.expectedPromptDelta, 11_696);
	assert.throws(() => core.parseRunnerArgs(["--repo-root", process.cwd()]), /INVALID_COHORT_CONFIG/);
	assert.throws(() => core.parseRunnerArgs(["--prompt-input-gate", "--repo-root", "."]), /INVALID_COHORT_CONFIG/);
	assert.throws(
		() => core.parseRunnerArgs(["--prompt-input-gate", "--expected-prompt-delta", "0"]),
		/INVALID_COHORT_CONFIG/,
	);
});
