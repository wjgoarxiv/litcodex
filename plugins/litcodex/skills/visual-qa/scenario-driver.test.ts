import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXPECTED_PLAN = [
	{
		name: "public-service-form-ko",
		expected: "FAIL",
		finding_codes: ["FINDING_FOCUS_ORDER_BROKEN", "FINDING_WCAG_1_4_3_CONTRAST"],
		blocked_codes: [],
	},
	{
		name: "fintech-dashboard",
		expected: "FAIL",
		finding_codes: ["FINDING_COLOR_ONLY_STATE", "FINDING_NONVISUAL_FALLBACK_MISSING"],
		blocked_codes: [],
	},
	{
		name: "healthcare-mobile",
		expected: "FAIL",
		finding_codes: ["FINDING_DESTRUCTIVE_ACTION_UNGUARDED", "FINDING_TOUCH_TARGET_UNDERSIZED"],
		blocked_codes: [],
		mutation_count: 0,
	},
	{
		name: "saas-landing-responsive",
		expected: "FAIL",
		finding_codes: ["FINDING_MOBILE_OVERFLOW", "FINDING_REDUCED_MOTION_UNSUPPORTED"],
		blocked_codes: [],
	},
	{
		name: "brownfield-design-system",
		expected: "FAIL",
		finding_codes: ["FINDING_TOKEN_BYPASS", "FINDING_DUPLICATED_PRIMITIVE"],
		blocked_codes: [],
		source_pointer: "tokens/button.css:12",
	},
	{
		name: "reference-fidelity",
		expected: "FAIL",
		finding_codes: ["FINDING_REFERENCE_DIMENSION_MISMATCH", "FINDING_SCREENSHOT_SUBSTITUTION"],
		blocked_codes: [],
		similarity_override: false,
	},
	{
		name: "cjk-terminal-dashboard",
		expected: "FAIL",
		finding_codes: ["FINDING_ZWJ_WIDTH_DRIFT", "FINDING_BORDER_TOPOLOGY"],
		blocked_codes: [],
		osc_inert: true,
	},
	{
		name: "missing-capture-auth-review",
		expected: "BLOCKED",
		finding_codes: [],
		blocked_codes: [
			"BLOCKED_AUTH_UNAVAILABLE",
			"BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
			"BLOCKED_RENDERER_UNAVAILABLE",
		],
	},
] as const;

describe("visual-qa required scenario driver", () => {
	it("runs the exact eight seeded artifacts against an installed-root-shaped tree", () => {
		const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
		const entrypoint = new URL("../../../../tools/run-uiux-visual-qa-scenarios.mjs", import.meta.url);
		const fixtureRoot = fileURLToPath(new URL("../../../../tools/scenarios/uiux-visual-qa/", import.meta.url));
		const args = [
			entrypoint.pathname,
			"--installed-root",
			repoRoot,
			"--fixtures",
			fixtureRoot,
			"--scenario",
			"all",
			"--json",
		];
		const first = spawnSync(process.execPath, args, { encoding: "utf8" });
		const second = spawnSync(process.execPath, args, { encoding: "utf8" });
		expect(first.status, first.stderr).toBe(0);
		expect(second.status, second.stderr).toBe(0);
		expect(second.stdout).toBe(first.stdout);
		const result = JSON.parse(first.stdout) as {
			readonly status?: string;
			readonly count?: number;
			readonly seeded_critical_high_detected?: number;
			readonly false_pass_count?: number;
			readonly max_review_rounds?: number;
			readonly scenarios?: readonly {
				readonly name?: string;
				readonly artifact?: string;
				readonly expected?: string;
				readonly actual?: string;
				readonly finding_codes?: readonly string[];
				readonly blocked_codes?: readonly string[];
				readonly review_rounds?: number;
				readonly mutation_count?: number;
				readonly source_pointer?: string;
				readonly similarity_override?: boolean;
				readonly osc_inert?: boolean;
				readonly assertions?: readonly { readonly pass?: boolean }[];
			}[];
		};
		expect(result).toMatchObject({
			status: "PASS",
			count: 8,
			seeded_critical_high_detected: 8,
			false_pass_count: 0,
			max_review_rounds: 2,
		});
		expect(
			result.scenarios?.map(
				({
					name,
					expected,
					finding_codes,
					blocked_codes,
					mutation_count,
					source_pointer,
					similarity_override,
					osc_inert,
				}) => ({
					name,
					expected,
					finding_codes,
					blocked_codes,
					...(mutation_count === undefined ? {} : { mutation_count }),
					...(source_pointer === undefined ? {} : { source_pointer }),
					...(similarity_override === undefined ? {} : { similarity_override }),
					...(osc_inert === undefined ? {} : { osc_inert }),
				}),
			),
		).toEqual(EXPECTED_PLAN);
		for (const scenario of result.scenarios ?? []) {
			expect(scenario.artifact).toMatch(/^\d{2}-[a-z-]+\.json$/);
			expect(scenario.actual).toBe(scenario.expected);
			expect(scenario.assertions?.length).toBeGreaterThan(0);
			expect(scenario.assertions?.every((assertion) => assertion.pass)).toBe(true);
			expect(scenario.review_rounds).toBeGreaterThanOrEqual(1);
			expect(scenario.review_rounds).toBeLessThanOrEqual(2);
		}
	});

	it("requires exact singleton flags and rejects duplicate or unknown arguments", () => {
		const entrypoint = new URL("../../../../tools/run-uiux-visual-qa-scenarios.mjs", import.meta.url);
		for (const args of [
			[],
			["--installed-root", "."],
			["--unknown", "."],
			[
				"--installed-root",
				".",
				"--fixtures",
				".",
				"--fixtures",
				".",
				"--scenario",
				"all",
				"--json",
			],
			["--installed-root", ".", "--fixtures", ".", "--scenario", "smoke", "--json"],
		]) {
			const run = spawnSync(process.execPath, [entrypoint.pathname, ...args], { encoding: "utf8" });
			expect(run.status).not.toBe(0);
			expect(run.stderr).toContain("SCENARIO_ARGUMENT_INVALID");
		}
	});
});
