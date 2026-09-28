const CHALLENGE = /checking your browser|verify you are human|captcha|bot check|enable javascript/i;
const AUTH = /sign\s*in|required login|log in|sso login|authentication required|account required/i;
const PAYWALL = /subscribe to continue|subscription required|institutional access|members only|paywall/i;
const RATE = /too many requests|rate limit|retry-after/i;
const NOT_FOUND = /not found|deleted|private or deleted|gone/i;
const AUTH_HEADING = /^(?:sign\s*in|log\s*in|login|sign\s*in required|login required|authentication required|account required)$/i;
const PAYWALL_HEADING = /^(?:subscribe to continue|subscription required|institutional access|members only|paywall)$/i;
const NOT_FOUND_HEADING = /^(?:404(?: page)? not found|page not found|not found|gone|content deleted|content not found)$/i;
const CHALLENGE_HEADING = /^(?:captcha|verify you are human|checking your browser|bot check|security check)$/i;
const RATE_HEADING = /^(?:too many requests|rate limit(?:ed)?|retry later)$/i;
const ERROR_HEADING = /^(?:error|server error|request failed|access denied|request rejected|service unavailable|something went wrong)$/i;
const SHORT_AUTH = /^(?:(?:sign|log)\s*in|login)(?: required| to (?:continue|access))\b|^(?:authentication|account) required\b/i;
const SHORT_PAYWALL = /^(?:subscribe to continue|subscription required|institutional access required|members only)\b/i;
const SHORT_NOT_FOUND = /^(?:(?:404 |page |content )?not found|gone)(?:[.!]|$)/i;
const SHORT_CHALLENGE = /^(?:verify you are human|checking your browser|complete (?:the|this) captcha|bot check required)\b/i;
const SHORT_RATE = /^(?:too many requests|rate limit(?:ed)?|retry later)\b/i;

export function validateResponse({ status = 0, headers = {}, body = "", url = "", tooLarge = false, maxBytes = 0 }) {
	const text = extractVisibleText(String(body));
	const lowerHeaders = normalizeHeaders(headers);
	const contentType = lowerHeaders["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

	if (status === 0) return verdict("fetch_failed", false, text, status, url, body || "fetch failed");
	if (status === 429 || lowerHeaders["retry-after"]) return verdict("rate_limit", true, text, status, url);
	if (status === 401 || status === 403) return verdict("auth_required", true, text, status, url);
	if (status === 404 || status === 410) return verdict("not_found", true, text, status, url);
	if (status >= 400) return verdict("fetch_failed", false, text, status, url, `HTTP ${status}`);
	if (tooLarge) return verdict("content_too_large", true, text, status, url, `response exceeds ${maxBytes} bytes`);
	if (hasPdfSignature(body)) return verdict("binary_content", true, text, status, url, "PDF magic signature");
	if (isBinary(contentType)) return verdict("binary_content", true, text, status, url, `binary content type: ${contentType}`);
	if (isJson(contentType)) return validateJson(body, text, status, url, contentType);
	if (isDominantMarker(body, text, RATE_HEADING, SHORT_RATE)) return verdict("rate_limit", true, text, status, url);
	if (isDominantMarker(body, text, AUTH_HEADING, SHORT_AUTH) || hasAuthForm(body)) {
		return verdict("auth_required", true, text, status, url);
	}
	if (isDominantMarker(body, text, PAYWALL_HEADING, SHORT_PAYWALL) || hasClassedWall(body, "paywall", PAYWALL)) {
		return verdict("paywall", true, text, status, url);
	}
	if (isDominantMarker(body, text, NOT_FOUND_HEADING, SHORT_NOT_FOUND)) {
		return verdict("not_found", true, text, status, url);
	}
	if (isDominantMarker(body, text, CHALLENGE_HEADING, SHORT_CHALLENGE) || hasClassedWall(body, "challenge", CHALLENGE)) {
		return verdict("challenge", true, text, status, url);
	}
	if (isHtmlErrorTemplate(contentType, body, text)) return verdict("weak_content", false, text, status, url, "generic HTML error template");
	if (isScriptOnlyShell(body, text)) return verdict("weak_content", false, text, status, url, "script-only shell");
	if (status >= 200 && status < 300 && text.length >= 120) return verdict("content_ok", false, text, status, url);
	return verdict("weak_content", false, text, status, url, text.length < 120 ? "body too small" : "incomplete content");
}

export function extractVisibleText(body) {
	return body
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s+/g, " ")
		.trim();
}

function verdict(classification, stop, text, status, url, note = "") {
	return {
		classification,
		stop,
		status,
		url,
		note,
		excerpt: text.slice(0, 500),
	};
}

function normalizeHeaders(headers) {
	const out = {};
	for (const [key, value] of Object.entries(headers ?? {})) out[key.toLowerCase()] = String(value);
	return out;
}

function validateJson(body, text, status, url, contentType) {
	if (contentType === "application/problem+json") {
		return verdict("weak_content", false, text, status, url, "problem JSON is an error document");
	}
	let parsed;
	try {
		parsed = JSON.parse(String(body));
	} catch {
		return verdict("weak_content", false, text, status, url, "invalid JSON");
	}
	if (isEmptyJsonValue(parsed)) return verdict("weak_content", false, text, status, url, "empty JSON");
	if (isErrorJsonValue(parsed)) return verdict("weak_content", false, text, status, url, "JSON error document");
	return text.length >= 120
		? verdict("content_ok", false, text, status, url)
		: verdict("weak_content", false, text, status, url, "body too small");
}

function isScriptOnlyShell(body, text) {
	return /<script\b/i.test(body) && /id=["']?(root|app)/i.test(body) && text.length < 80;
}

function isJson(contentType) {
	return contentType === "application/json" || contentType.endsWith("+json") || contentType === "text/json";
}

function isBinary(contentType) {
	return (
		contentType === "application/pdf" ||
		contentType === "application/x-pdf" ||
		contentType === "application/acrobat" ||
		contentType === "applications/vnd.pdf" ||
		contentType === "text/pdf" ||
		contentType === "text/x-pdf" ||
		contentType === "application/octet-stream"
	);
}

function hasPdfSignature(body) {
	return String(body).startsWith("%PDF-");
}

function isEmptyJsonValue(value) {
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value !== "object" || value === null) return String(value).trim().length === 0;
	const keys = Object.keys(value);
	if (keys.length === 0) return true;
	return ["data", "items", "results"].some((key) => Array.isArray(value[key]) && value[key].length === 0);
}

function isErrorJsonValue(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const fields = new Map(Object.entries(value).map(([key, fieldValue]) => [key.toLowerCase(), fieldValue]));
	if (hasErrorValue(fields.get("error")) || hasErrorValue(fields.get("errors"))) return true;
	const status = Number(fields.get("status"));
	return Number.isInteger(status) && status >= 400 && status <= 599 && hasErrorValue(fields.get("message"));
}

function hasErrorValue(value) {
	if (value === null || value === undefined || value === false) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return Boolean(value);
}

function isHtmlErrorTemplate(contentType, body, text) {
	if (contentType !== "text/html" && !/<html\b/i.test(body)) return false;
	return hasStructuralMarker(
		body,
		ERROR_HEADING,
	);
}

function isDominantMarker(body, text, structuralMarker, shortMarker) {
	return hasStructuralMarker(body, structuralMarker) || (text.length <= 600 && shortMarker.test(text.slice(0, 350)));
}

function hasStructuralMarker(body, marker) {
	for (const match of String(body).matchAll(/<(title|h1)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
		if (marker.test(extractVisibleText(match[2] ?? ""))) return true;
	}
	return false;
}

function hasAuthForm(body) {
	for (const match of String(body).matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
		const form = match[0];
		if (/<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(form) && AUTH.test(extractVisibleText(form).slice(0, 1000))) {
			return true;
		}
	}
	return false;
}

function hasClassedWall(body, kind, marker) {
	const tokenPattern =
		kind === "paywall"
			? /^(?:paywall|subscription-wall|content-gate|metered-wall)$/i
			: /^(?:challenge|captcha|bot-check|human-check)$/i;
	for (const match of String(body).matchAll(/<(div|section|aside|dialog)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
		const tokens = [...String(match[2] ?? "").matchAll(/\b(?:class|id)\s*=\s*["']([^"']+)["']/gi)].flatMap(
			(attribute) => String(attribute[1] ?? "").split(/\s+/),
		);
		if (tokens.some((token) => tokenPattern.test(token)) && marker.test(extractVisibleText(match[3] ?? "").slice(0, 1000))) {
			return true;
		}
	}
	return false;
}
