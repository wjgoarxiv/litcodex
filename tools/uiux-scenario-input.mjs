import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const FINDING_SEVERITY = {
	FINDING_FOCUS_ORDER_BROKEN: "high",
	FINDING_WCAG_1_4_3_CONTRAST: "high",
	FINDING_COLOR_ONLY_STATE: "high",
	FINDING_NONVISUAL_FALLBACK_MISSING: "high",
	FINDING_DESTRUCTIVE_ACTION_UNGUARDED: "critical",
	FINDING_TOUCH_TARGET_UNDERSIZED: "major",
	FINDING_MOBILE_OVERFLOW: "high",
	FINDING_REDUCED_MOTION_UNSUPPORTED: "high",
	FINDING_TOKEN_BYPASS: "high",
	FINDING_DUPLICATED_PRIMITIVE: "major",
	FINDING_REFERENCE_DIMENSION_MISMATCH: "major",
	FINDING_SCREENSHOT_SUBSTITUTION: "major",
	FINDING_ZWJ_WIDTH_DRIFT: "major",
	FINDING_BORDER_TOPOLOGY: "major",
};

export const SCENARIOS = [
	{
		artifact: "01-public-service-form-ko.json",
		name: "public-service-form-ko",
		tier: "smoke",
		expected: "FAIL",
		finding_codes: ["FINDING_FOCUS_ORDER_BROKEN", "FINDING_WCAG_1_4_3_CONTRAST"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "02-fintech-dashboard.json",
		name: "fintech-dashboard",
		tier: "full",
		expected: "FAIL",
		finding_codes: ["FINDING_COLOR_ONLY_STATE", "FINDING_NONVISUAL_FALLBACK_MISSING"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "03-healthcare-mobile.json",
		name: "healthcare-mobile",
		tier: "full",
		expected: "FAIL",
		finding_codes: ["FINDING_DESTRUCTIVE_ACTION_UNGUARDED", "FINDING_TOUCH_TARGET_UNDERSIZED"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "04-saas-landing-responsive.json",
		name: "saas-landing-responsive",
		tier: "smoke",
		expected: "FAIL",
		finding_codes: ["FINDING_MOBILE_OVERFLOW", "FINDING_REDUCED_MOTION_UNSUPPORTED"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "05-brownfield-design-system.json",
		name: "brownfield-design-system",
		tier: "full",
		expected: "FAIL",
		finding_codes: ["FINDING_TOKEN_BYPASS", "FINDING_DUPLICATED_PRIMITIVE"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "06-reference-fidelity.json",
		name: "reference-fidelity",
		tier: "reference-fidelity",
		expected: "FAIL",
		finding_codes: ["FINDING_REFERENCE_DIMENSION_MISMATCH", "FINDING_SCREENSHOT_SUBSTITUTION"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "07-cjk-terminal-dashboard.json",
		name: "cjk-terminal-dashboard",
		tier: "full",
		expected: "FAIL",
		finding_codes: ["FINDING_ZWJ_WIDTH_DRIFT", "FINDING_BORDER_TOPOLOGY"],
		blocked_codes: [],
		review_rounds: 2,
	},
	{
		artifact: "08-missing-capture-auth-review.json",
		name: "missing-capture-auth-review",
		tier: "smoke",
		expected: "BLOCKED",
		finding_codes: [],
		blocked_codes: [
			"BLOCKED_AUTH_UNAVAILABLE",
			"BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
			"BLOCKED_RENDERER_UNAVAILABLE",
		],
		review_rounds: 1,
	},
];

const inside = (root, path) => {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

function strictRoot(path, label) {
	const resolved = resolve(path);
	const stat = lstatSync(resolved);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
	return realpathSync(resolved);
}

export function parseScenarioArgs(args) {
	const valued = new Set(["--installed-root", "--fixtures", "--scenario"]);
	const values = new Map();
	let json = false;
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (flag === "--json") {
			if (json) throw new Error("SCENARIO_ARGUMENT_INVALID: duplicate --json");
			json = true;
		} else {
			const value = args[index + 1];
			if (!valued.has(flag) || values.has(flag) || value === undefined || value.startsWith("--")) {
				throw new Error("SCENARIO_ARGUMENT_INVALID: unknown, duplicate, or valueless argument");
			}
			values.set(flag, value);
			index += 1;
		}
	}
	if (values.size !== 3 || values.get("--scenario") !== "all" || !json) {
		throw new Error("SCENARIO_ARGUMENT_INVALID: require exact approved flags");
	}
	return {
		installedRoot: strictRoot(values.get("--installed-root"), "installed root"),
		fixtureRoot: strictRoot(values.get("--fixtures"), "fixture root"),
	};
}

export function resolveInstalledAsset(root, suffix) {
	for (const candidate of [
		join(root, "marketplace/plugins/litcodex/skills/visual-qa", suffix),
		join(root, "plugins/litcodex/skills/visual-qa", suffix),
	]) {
		try {
			const stat = lstatSync(candidate);
			if (stat.isFile() && !stat.isSymbolicLink() && inside(root, realpathSync(candidate))) return candidate;
		} catch {}
	}
	throw new Error(`SCENARIO_INSTALLED_ROOT_INVALID: ${suffix} missing`);
}

export function loadScenarioFixtures(root) {
	const names = readdirSync(root).sort();
	if (JSON.stringify(names) !== JSON.stringify(SCENARIOS.map(({ artifact }) => artifact))) {
		throw new Error("SCENARIO_FIXTURE_SET_INVALID");
	}
	return SCENARIOS.map(({ artifact, ...fixture }) => {
		const path = join(root, artifact);
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || !inside(root, realpathSync(path)) || stat.size > 16_384) {
			throw new Error(`SCENARIO_FIXTURE_INVALID: ${artifact}`);
		}
		if (`${JSON.stringify(fixture)}\n` !== readFileSync(path, "utf8")) {
			throw new Error(`SCENARIO_FIXTURE_INVALID: ${artifact}`);
		}
		return { artifact, ...fixture };
	});
}
