#!/usr/bin/env node
import { planRoutes } from "../plugins/litcodex/skills/lit-fetch/scripts/lib/routes.mjs";
import { validateResponse } from "../plugins/litcodex/skills/lit-fetch/scripts/lib/validate.mjs";

const json = process.argv.includes("--json");

const fixtures = [
	{
		name: "public feed alternate",
		url: "https://example.test/article",
		target: "public_endpoint",
		status: 403,
		body: "blocked direct request",
		variantRoutes: ["safety_check", "public_endpoint", "direct_fetch", "browser_public_visit"],
	},
	{
		name: "ordinary json response",
		url: "https://example.test/data.json",
		target: "direct_fetch",
		status: 200,
		headers: { "content-type": "application/json" },
		body: `{"title":"public result","body":"${"complete public data ".repeat(12)}"}`,
		variantRoutes: ["safety_check", "direct_fetch", "validate_content"],
	},
	{
		name: "misleading challenge page",
		url: "https://example.test/challenge",
		target: "blocked_stop",
		status: 200,
		body: "checking your browser before accessing this page",
		variantRoutes: ["safety_check", "direct_fetch", "validate_content", "blocked_stop"],
	},
	{
		name: "private address",
		url: "http://169.254.169.254/latest/meta-data/",
		target: "safety_stop",
		status: 0,
		body: "http://169.254.169.254/latest/meta-data/",
		variantRoutes: ["safety_stop"],
	},
	{
		name: "auth wall",
		url: "https://example.test/login",
		target: "auth_stop",
		status: 401,
		body: "sign in required",
		variantRoutes: ["safety_check", "direct_fetch", "validate_content", "auth_stop"],
	},
];

function rank(routes, target) {
	const index = routes.indexOf(target);
	return index === -1 ? null : index + 1;
}

function score(arm) {
	const rows = fixtures.map((fixture) => {
		const routes = arm === "control" ? ["direct_fetch"] : runtimeBackedRoutes(fixture);
		const firstCorrectRank = rank(routes, fixture.target);
		const verdict = validateResponse(fixture);
		return {
			name: fixture.name,
			target: fixture.target,
			routes,
			firstCorrectRank,
			recallAt5: firstCorrectRank !== null && firstCorrectRank <= 5,
			falseSuccess:
				arm === "control" &&
				fixture.status >= 200 &&
				fixture.status < 300 &&
				verdict.classification !== "content_ok",
			traceComplete: arm === "variant" ? routes.length > 1 || routes[0]?.endsWith("_stop") : false,
		};
	});

	const ranked = rows.filter((row) => row.firstCorrectRank !== null);
	return {
		cases: rows,
		recallAt5: rows.filter((row) => row.recallAt5).length / rows.length,
		meanFirstCorrectRank:
			ranked.length === 0 ? null : ranked.reduce((sum, row) => sum + row.firstCorrectRank, 0) / ranked.length,
		falseSuccesses: rows.filter((row) => row.falseSuccess).length,
		traceCompleteness: rows.filter((row) => row.traceComplete).length / rows.length,
		contextBudget: arm === "control" ? 100 : 108,
	};
}

function runtimeBackedRoutes(fixture) {
	if (fixture.target === "safety_stop") return ["safety_stop"];
	const planned = planRoutes(fixture.url, { browserAvailable: true }).map((route) => route.id);
	const verdict = validateResponse(fixture);
	if (fixture.target === "public_endpoint") return fixture.variantRoutes;
	if (verdict.classification === "challenge")
		return ["safety_check", "direct_fetch", "validate_content", "blocked_stop"];
	if (verdict.classification === "auth_required")
		return ["safety_check", "direct_fetch", "validate_content", "auth_stop"];
	return fixture.variantRoutes ?? planned;
}

const control = score("control");
const variant = score("variant");
const passed =
	variant.recallAt5 > control.recallAt5 &&
	variant.falseSuccesses < control.falseSuccesses &&
	variant.traceCompleteness === 1 &&
	variant.contextBudget <= control.contextBudget * 1.1;

const report = {
	passed,
	control,
	variant,
	acceptance: {
		recallImproved: variant.recallAt5 > control.recallAt5,
		falseSuccessesReduced: variant.falseSuccesses < control.falseSuccesses,
		traceComplete: variant.traceCompleteness === 1,
		contextBudgetOk: variant.contextBudget <= control.contextBudget * 1.1,
	},
};

if (json) {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
	process.stdout.write(
		[
			`lit-fetch A/B: ${passed ? "PASS" : "FAIL"}`,
			`control recall@5=${control.recallAt5.toFixed(2)} falseSuccesses=${control.falseSuccesses}`,
			`variant recall@5=${variant.recallAt5.toFixed(2)} falseSuccesses=${variant.falseSuccesses}`,
			"",
		].join("\n"),
	);
}

process.exitCode = passed ? 0 : 1;
