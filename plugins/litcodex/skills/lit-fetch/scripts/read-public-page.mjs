#!/usr/bin/env node
import { readPublicPage } from "./lib/reader.mjs";

const HELP = `lit-fetch runtime (Node stdlib only)

Usage:
  node scripts/read-public-page.mjs <public-url> [--json] [--trace] [--browser-available]

Policy:
  public-only; no login; no paywall; no CAPTCHA; no credential replay; no access-control bypass.
  Blocks localhost, private IPs, link-local/metadata hosts, unsupported schemes, and unsafe redirects.
  Revalidates and DNS-pins every redirect hop; default timeout 12s, redirects 5, response 1,000,000 bytes.
  Advertised feeds/JSON/oEmbed are validated content routes, never automatic successes.
  Browser fallback is host-driven only; this stdlib runtime does not import cookies or alter fingerprints.

Evidence:
  JSON includes plannedRoutes, attempts[], routesSkipped, routesUntried, routeCoverageComplete,
  finalVerdict, claimGraph, contentSafety, and bounded retryBudget.
  plannedRoutes is deterministic route order, not a web-search relevance score.
  Query values, fragments, URL userinfo, and matching values in excerpts are redacted.
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	process.stdout.write(HELP);
	process.exit(0);
}

const json = args.includes("--json");
const browserAvailable = args.includes("--browser-available");
const url = args.find((arg) => !arg.startsWith("--"));
if (!url) {
	process.stderr.write("lit-fetch: missing <public-url>\n");
	process.exit(2);
}

const report = await readPublicPage(url, {
	browserAvailable,
	allowTestLoopback: process.env.LITCODEX_PUBLIC_READER_ALLOW_TEST_PRIVATE === "1",
});

if (json) {
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
	process.stdout.write(
		[
			`URL: ${report.url}`,
			`classification: ${report.classification}`,
			`routes tried: ${report.routesTried.join(", ")}`,
			`routes skipped: ${report.routesSkipped.map((route) => `${route.id} (${route.reason})`).join(", ") || "none"}`,
			`evidence: status=${report.evidence.status}; ${report.evidence.excerpt || report.evidence.note}`,
			`final verdict: confidence=${report.finalVerdict.confidence}; evidence=${report.finalVerdict.evidencePointer}`,
			`remaining risk: ${report.remainingRisk}`,
			"",
		].join("\n"),
	);
}

if (report.classification === "content_ok") process.exit(0);
if (report.classification === "blocked_for_safety") process.exit(2);
process.exit(1);
