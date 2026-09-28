import { isAbsolute } from "node:path";

export const CANONICAL = Object.freeze({ scenario: "lit-plan-transition-v1", order: "ABBA", blocks: 4, turns: 5 });
export const CLEANUP = Object.freeze({ childProcesses: 0, tempHomes: 0, tarballs: 0, rawBuffers: 0 });
export const SESSION_ORDER = Object.freeze([
	["active", "control"],
	["control", "active"],
	["control", "active"],
	["active", "control"],
]);

export function parseRunnerArgs(argv) {
	const options = {
		live: false,
		promptInputGate: false,
		model: "gpt-5.6-luna",
		...CANONICAL,
		output: undefined,
		codex: "codex",
		fakeFailure: undefined,
		expectedArtifactSha256: undefined,
		repoRoot: undefined,
		expectedPromptDelta: undefined,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--live") options.live = true;
		else if (arg === "--prompt-input-gate") options.promptInputGate = true;
		else if (
			[
				"--model",
				"--scenario",
				"--order",
				"--blocks",
				"--turns",
				"--output",
				"--codex",
				"--fake-failure",
				"--expected-artifact-sha256",
				"--repo-root",
				"--expected-prompt-delta",
			].includes(arg)
		) {
			const value = argv[index + 1];
			if (value === undefined) throw new Error("INVALID_COHORT_CONFIG");
			index += 1;
			const key =
				arg === "--fake-failure"
					? "fakeFailure"
					: arg === "--expected-artifact-sha256"
						? "expectedArtifactSha256"
						: arg === "--repo-root"
							? "repoRoot"
							: arg === "--expected-prompt-delta"
								? "expectedPromptDelta"
								: arg.slice(2);
			options[key] = key === "blocks" || key === "turns" || key === "expectedPromptDelta" ? Number(value) : value;
		} else throw new Error("INVALID_COHORT_CONFIG");
	}
	if (
		options.scenario !== CANONICAL.scenario ||
		options.order !== CANONICAL.order ||
		options.blocks !== CANONICAL.blocks ||
		options.turns !== CANONICAL.turns ||
		(options.fakeFailure !== undefined &&
			!["rate-limit", "missing-usage", "timeout"].includes(options.fakeFailure)) ||
		(options.live && options.fakeFailure !== undefined) ||
		(options.promptInputGate && (options.live || options.fakeFailure !== undefined)) ||
		(options.repoRoot !== undefined && (!options.promptInputGate || !isAbsolute(options.repoRoot))) ||
		(options.expectedPromptDelta !== undefined &&
			(!options.promptInputGate ||
				!Number.isSafeInteger(options.expectedPromptDelta) ||
				options.expectedPromptDelta < 1)) ||
		(options.expectedArtifactSha256 !== undefined &&
			(!options.live || !/^[a-f0-9]{64}$/u.test(options.expectedArtifactSha256))) ||
		typeof options.model !== "string" ||
		options.model.trim() === ""
	) {
		throw new Error("INVALID_COHORT_CONFIG");
	}
	return options;
}
