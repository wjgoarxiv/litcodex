import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateLocalHookTimingGate, measureInstalledHookTimings } from "./provider-cache-ab-process.mjs";

const COMPONENTS = ["telemetry", "auto-update", "rules", "start-work-continuation", "lit-loop", "wikify-knowledge"];

function createHookFixture(prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	const pluginRoot = join(root, "plugin");
	const fixtureRoot = join(root, "fixture");
	for (const component of COMPONENTS) {
		const cli = join(pluginRoot, "components", component, "dist", "cli.js");
		mkdirSync(join(cli, ".."), { recursive: true });
		writeFileSync(cli, "// fixture\n");
	}
	mkdirSync(fixtureRoot, { recursive: true });
	return { root, pluginRoot, fixtureRoot };
}

test("installed local speed probe records reconciled aggregate and per-handler monotonic timings without output text", async () => {
	const fixture = createHookFixture("litcodex-local-speed-unit-");
	let tick = 0;
	const rawMarker = "RAW_HOOK_OUTPUT_MUST_NOT_PERSIST";
	const runCommand = async (_executable, args) => {
		const cli = args[0];
		const route = args.at(-1);
		if (cli.includes("lit-loop")) {
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					hookSpecificOutput: { additionalContext: `<lit-plan-mode>${rawMarker}</lit-plan-mode>` },
				}),
				stderr: "",
			};
		}
		if (cli.includes("rules") && route === "session-start") {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: rawMarker } }),
				stderr: "",
			};
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	};
	try {
		const receipt = await measureInstalledHookTimings({
			pluginRoot: fixture.pluginRoot,
			fixtureRoot: fixture.fixtureRoot,
			env: {},
			prompt: "lit\nfixture",
			samples: 2,
			runCommand,
			now: () => tick++,
		});
		assert.equal(receipt.providerCompletions, 0);
		assert.equal(receipt.samples, 2);
		assert.deepEqual(
			receipt.sessionStart.handlers.map(({ id }) => id),
			["telemetry", "auto-update", "rules"],
		);
		assert.deepEqual(
			receipt.userPromptSubmit.handlers.map(({ id }) => id),
			["start-work-continuation", "lit-loop", "rules", "wikify-knowledge"],
		);
		assert.equal(receipt.sessionStart.reconciliation.allSamplesPass, true);
		assert.equal(receipt.userPromptSubmit.reconciliation.allSamplesPass, true);
		assert.equal(
			receipt.sessionStart.handlers.every(({ outputPolicyPass }) => outputPolicyPass),
			true,
		);
		assert.equal(
			receipt.userPromptSubmit.handlers.every(({ outputPolicyPass }) => outputPolicyPass),
			true,
		);
		assert.equal(JSON.stringify(receipt).includes(rawMarker), false);
		assert.equal(JSON.stringify(receipt).includes("stdout"), false);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});

test("installed local speed gate blocks misleading success output without retaining it", async () => {
	const fixture = createHookFixture("litcodex-local-speed-misleading-");
	let tick = 0;
	const rawMarker = "MISLEADING_SUCCESS_OUTPUT_MUST_NOT_PERSIST";
	const runCommand = async (_executable, args) => {
		const cli = args[0];
		const route = args.at(-1);
		if (cli.includes("lit-loop")) {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: "<lit-plan-mode />" } }),
				stderr: "",
			};
		}
		if (cli.includes("rules") && route === "session-start") {
			return {
				exitCode: 0,
				stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: "rules" } }),
				stderr: "",
			};
		}
		return { exitCode: 0, stdout: cli.includes("telemetry") ? rawMarker : "", stderr: "" };
	};
	try {
		const receipt = await measureInstalledHookTimings({
			pluginRoot: fixture.pluginRoot,
			fixtureRoot: fixture.fixtureRoot,
			env: {},
			prompt: "lit\nfixture",
			samples: 1,
			runCommand,
			now: () => tick++,
		});
		assert.deepEqual(evaluateLocalHookTimingGate(receipt), {
			status: "BLOCKED",
			code: "BLOCKED_LOCAL_HOOK_OUTPUT_POLICY",
			event: "sessionStart",
		});
		assert.equal(JSON.stringify(receipt).includes(rawMarker), false);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
});
