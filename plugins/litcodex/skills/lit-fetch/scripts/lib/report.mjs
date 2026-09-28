import { redactTextForEvidence, redactUrlForEvidence } from "./redaction.mjs";

export function recordValidationAttempt(attempts, url, verdict) {
	recordAttempt(attempts, {
		routeId: "validate_content",
		url,
		status: verdict.status,
		verdict: verdict.classification,
		terminal: verdict.classification === "content_ok" || verdict.stop === true,
		reason: verdict.note || `validated as ${verdict.classification}`,
		evidence: { status: verdict.status, excerpt: verdict.excerpt, note: verdict.note },
	});
}

export function recordAttempt(attempts, attempt) {
	const index = attempts.length;
	const sourceUrl = attempt.url ?? "";
	attempts.push({
		attemptId: `attempt-${index + 1}`,
		index,
		routeId: attempt.routeId,
		url: redactUrlForEvidence(sourceUrl),
		status: attempt.status ?? attempt.evidence?.status ?? 0,
		verdict: attempt.verdict,
		terminal: attempt.terminal === true,
		reason: redactTextForEvidence(attempt.reason ?? "", sourceUrl),
		evidence: sanitizeEvidence(attempt.evidence ?? {}, sourceUrl),
	});
}

export function safetyReport(url, routesTried, routesSkipped, reason, attempts, planned = [], maxBytes) {
	const verdict = { classification: "blocked_for_safety", status: 0, note: reason, excerpt: "", stop: true };
	return withTrace(
		{
			url: redactUrlForEvidence(url),
			classification: "blocked_for_safety",
			routesTried,
			routesSkipped,
			evidence: sanitizeEvidence({ status: 0, excerpt: "", note: reason }, url),
			remainingRisk: "blocked before unsafe network access",
			plannedRoutes: planned.map((route) => route.id),
			routesUntried: untriedRoutes(planned, routesTried, verdict),
		},
		url,
		verdict,
		attempts,
		maxBytes,
	);
}

export function contentReport(url, routesTried, routesSkipped, attempts, verdict, planned, maxBytes) {
	return withTrace(
		{
			url: redactUrlForEvidence(url),
			classification: "content_ok",
			routesTried,
			routesSkipped,
			evidence: sanitizeEvidence({ status: verdict.status, excerpt: verdict.excerpt, note: verdict.note }, url),
			remainingRisk: "none",
			plannedRoutes: planned.map((route) => route.id),
			routesUntried: untriedRoutes(planned, routesTried, verdict),
		},
		url,
		verdict,
		attempts,
		maxBytes,
	);
}

export function finalReport(url, routesTried, routesSkipped, attempts, verdict, planned, evidence, maxBytes) {
	return withTrace(
		{
			url: redactUrlForEvidence(url),
			classification: verdict.classification,
			routesTried,
			routesSkipped,
			evidence: sanitizeEvidence(evidence, url),
			remainingRisk: verdict.stop ? "terminal public-only stop classification" : "partial or weak content",
			plannedRoutes: planned.map((route) => route.id),
			routesUntried: untriedRoutes(planned, routesTried, verdict),
		},
		url,
		verdict,
		attempts,
		maxBytes,
	);
}

function withTrace(report, url, verdict, attempts, maxBytes) {
	return {
		...report,
		contentSafety: {
			classification: "untrusted_fetched_content",
			handling: "inert_data_only",
			instructionsExecuted: false,
		},
		routesSkipped: report.routesSkipped.map((route) => ({
			...route,
			reason: redactTextForEvidence(route.reason, url),
		})),
		routeCoverageComplete: report.routesUntried.length === 0,
		attempts,
		finalVerdict: finalVerdict(url, verdict, attempts),
		claimGraph: claimGraph(url, verdict, attempts),
		retryBudget: retryBudget(maxBytes),
	};
}

function untriedRoutes(planned, routesTried, verdict) {
	const tried = new Set(routesTried);
	const terminalReason = verdict.stop ? `terminal ${verdict.classification} verdict` : `${verdict.classification} reached`;
	return planned
		.filter((route) => !tried.has(route.id))
		.map((route) => ({
			id: route.id,
			url: redactUrlForEvidence(route.url),
			reason: `${terminalReason}; route left untried: ${route.reason}`,
		}));
}

function finalVerdict(url, verdict, attempts) {
	const pointer = terminalPointer(attempts);
	const attempt = pointer === null ? null : attempts[pointer];
	return {
		classification: verdict.classification,
		success: verdict.classification === "content_ok",
		confidence: confidenceFor(verdict),
		reason: redactTextForEvidence(verdict.note || `validated as ${verdict.classification}`, url),
		uncertainty: uncertaintyFor(verdict).map((entry) => redactTextForEvidence(entry, url)),
		source: {
			type: "runtime_attempt",
			routeId: attempt?.routeId ?? "unknown",
			url: attempt?.url ?? redactUrlForEvidence(url),
			status: attempt?.status ?? verdict.status ?? 0,
		},
		evidencePointer: pointer === null ? "attempts[]" : `attempts[${pointer}]`,
	};
}

function claimGraph(url, verdict, attempts) {
	const final = finalVerdict(url, verdict, attempts);
	return [
		{
			claimId: "lit-fetch.final-classification",
			claim: `Runtime classified ${redactUrlForEvidence(url)} as ${verdict.classification}.`,
			source: final.source,
			confidence: final.confidence,
			uncertainty: final.uncertainty,
			evidence: [final.evidencePointer],
		},
	];
}

function terminalPointer(attempts) {
	for (let index = attempts.length - 1; index >= 0; index -= 1) {
		if (attempts[index].routeId === "validate_content" || attempts[index].terminal) return index;
	}
	return attempts.length === 0 ? null : attempts.length - 1;
}

function confidenceFor(verdict) {
	if (verdict.classification === "content_ok" || verdict.stop === true || verdict.classification === "blocked_for_safety") {
		return "high";
	}
	return "medium";
}

function uncertaintyFor(verdict) {
	if (verdict.classification === "content_ok") return [];
	if (verdict.stop) return [`terminal ${verdict.classification} public-only stop; no bypass attempted`];
	if (verdict.classification === "blocked_for_safety") return ["blocked before unsafe network access"];
	return [verdict.note || "partial or weak content"];
}

function retryBudget(maxBytes) {
	return {
		maxAttemptsPerRoute: 1,
		maxRedirects: 5,
		maxResponseBytes: maxBytes,
		retryPolicy: "no automatic retry after terminal stops",
	};
}

function sanitizeEvidence(evidence, sourceUrl) {
	return {
		...evidence,
		excerpt: redactTextForEvidence(evidence.excerpt ?? "", sourceUrl),
		note: redactTextForEvidence(evidence.note ?? "", sourceUrl),
	};
}
