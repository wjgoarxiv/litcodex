#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { loadScenarioFixtures, parseScenarioArgs, resolveInstalledAsset } from "./uiux-scenario-input.mjs";
import { buildScenario, detectScenario, scenarioAssertions } from "./uiux-scenario-library.mjs";

const NOW = new Date("2026-07-25T06:00:00.000Z");

async function main() {
	const options = parseScenarioArgs(process.argv.slice(2));
	const fixtures = loadScenarioFixtures(options.fixtureRoot);
	const validator = await import(
		`${pathToFileURL(resolveInstalledAsset(options.installedRoot, "scripts/validate-evidence.mjs")).href}?scenario=1`
	);
	const tui = await import(
		`${pathToFileURL(resolveInstalledAsset(options.installedRoot, "scripts/tui-grid.mjs")).href}?scenario=1`
	);
	const scenarios = fixtures.map((fixture) => {
		const bundle = buildScenario(fixture.name);
		const detection = detectScenario(fixture.name, tui.checkTui);
		const evaluation = validator.validateEvidence(bundle, fixture.tier, NOW);
		const assertions = scenarioAssertions(fixture, detection, evaluation);
		const criticalHighDetected = detection.findings.filter(({ severity }) =>
			["critical", "high"].includes(severity),
		).length;
		return {
			name: fixture.name,
			artifact: fixture.artifact,
			tier: fixture.tier,
			expected: fixture.expected,
			actual: evaluation.verdict,
			finding_codes: detection.findings.map(({ code }) => code),
			blocked_codes: evaluation.blocked_codes,
			critical_high_detected: criticalHighDetected,
			review_rounds: fixture.review_rounds,
			...detection.facts,
			assertions,
		};
	});
	const pass = scenarios.every((scenario) => scenario.assertions.every((assertion) => assertion.pass));
	const seededCriticalHighDetected = scenarios.reduce((count, scenario) => count + scenario.critical_high_detected, 0);
	const falsePassCount = scenarios.filter(({ expected, actual }) => expected !== "PASS" && actual === "PASS").length;
	const maxReviewRounds = Math.max(...scenarios.map(({ review_rounds }) => review_rounds));
	process.stdout.write(
		`${JSON.stringify({
			status: pass ? "PASS" : "FAIL",
			count: scenarios.length,
			seeded_critical_high_detected: seededCriticalHighDetected,
			false_pass_count: falsePassCount,
			max_review_rounds: maxReviewRounds,
			scenarios,
		})}\n`,
	);
	if (!pass) process.exitCode = 1;
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 2;
});
