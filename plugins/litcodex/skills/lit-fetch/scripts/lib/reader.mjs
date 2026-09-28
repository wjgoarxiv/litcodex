import { fetchPublic } from "./fetch.mjs";
import { assessUrlSafety } from "./safety.mjs";
import { discoverAlternates, planRoutes } from "./routes.mjs";
import { validateResponse } from "./validate.mjs";
import {
	contentReport,
	finalReport,
	recordAttempt,
	recordValidationAttempt,
	safetyReport,
} from "./report.mjs";

const DEFAULT_MAX_BYTES = 1_000_000;

export async function readPublicPage(rawUrl, options = {}) {
	const allowTestLoopback = options.allowTestLoopback === true;
	const routesTried = [];
	const routesSkipped = [];
	const attempts = [];
	const maxBytes = positiveByteLimit(options.maxBytes);
	const safetyOptions = { allowTestLoopback, timeoutMs: options.timeoutMs, lookup: options.lookup, maxBytes };
	const safety = assessUrlSafety(rawUrl, safetyOptions);
	routesTried.push("safety_check");
	recordAttempt(attempts, {
		routeId: "safety_check",
		url: safety.normalizedUrl,
		verdict: safety.ok ? "passed" : "blocked_for_safety",
		terminal: !safety.ok,
		reason: safety.reason,
		evidence: { status: 0, note: safety.reason },
	});
	if (!safety.ok) return safetyReport(rawUrl, routesTried, routesSkipped, safety.reason, attempts, [], maxBytes);

	const planned = planRoutes(safety.normalizedUrl, { browserAvailable: options.browserAvailable === true });
	const direct = await fetchWithTrace("direct_fetch", safety.normalizedUrl, safetyOptions, routesTried, routesSkipped, attempts);
	if (direct.blocked)
		return safetyReport(safety.normalizedUrl, routesTried, routesSkipped, direct.reason, attempts, planned, maxBytes);
	const directVerdict = validateResponse(direct);
	routesTried.push("validate_content");
	recordValidationAttempt(attempts, direct.url, directVerdict);

	if (directVerdict.classification === "content_ok") {
		return contentReport(direct.url, routesTried, routesSkipped, attempts, directVerdict, planned, maxBytes);
	}
	if (!directVerdict.stop) {
		for (const alternate of discoverAlternates(direct.url, direct.body)) {
			const alt = await fetchWithTrace("public_alternate", alternate, safetyOptions, routesTried, routesSkipped, attempts);
			if (alt.blocked) continue;
			const altVerdict = validateResponse(alt);
			routesTried.push("validate_content");
			recordValidationAttempt(attempts, alt.url, altVerdict);
			if (altVerdict.classification === "content_ok") {
				return contentReport(alt.url, routesTried, routesSkipped, attempts, altVerdict, planned, maxBytes);
			}
		}
	}

	const skippedBrowser = options.browserAvailable === true ? "not invoked by stdlib runtime" : "host browser surface unavailable";
	routesSkipped.push({ id: "browser_public_visit", reason: skippedBrowser });
	return finalReport(
		direct.url,
		routesTried,
		routesSkipped,
		attempts,
		directVerdict,
		planned,
		{ status: direct.status, excerpt: directVerdict.excerpt, note: directVerdict.note },
		maxBytes,
	);
}

async function fetchWithTrace(id, url, options, routesTried, routesSkipped, attempts) {
	routesTried.push(id);
	const fetched = await fetchPublic(url, options);
	if (!fetched.ok && fetched.safety?.code === "BLOCKED_REDIRECT") {
		routesSkipped.push({ id: "redirect_follow", reason: fetched.safety.reason });
		recordAttempt(attempts, {
			routeId: id,
			url,
			status: fetched.status,
			verdict: "blocked_for_safety",
			terminal: true,
			reason: fetched.safety.reason,
			evidence: { status: fetched.status, note: fetched.safety.reason },
		});
		return { blocked: true, reason: fetched.safety.reason };
	}
	if (!fetched.ok && fetched.safety?.ok === false) {
		routesSkipped.push({ id, reason: fetched.safety.reason });
		recordAttempt(attempts, {
			routeId: id,
			url,
			status: fetched.status,
			verdict: "blocked_for_safety",
			terminal: true,
			reason: fetched.safety.reason,
			evidence: { status: fetched.status, note: fetched.safety.reason },
		});
		return { blocked: true, reason: fetched.safety.reason };
	}
	recordAttempt(attempts, {
		routeId: id,
		url: fetched.finalUrl,
		status: fetched.status,
		verdict: fetched.ok ? "fetched" : "fetch_failed",
		terminal: false,
		reason: fetched.ok ? "HTTP response captured for validation" : fetched.body,
		evidence: { status: fetched.status, note: fetched.ok ? "response body captured" : fetched.body },
	});
	return { ...fetched, url: fetched.finalUrl };
}

function positiveByteLimit(value) {
	return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}
