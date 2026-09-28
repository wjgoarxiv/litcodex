import { isIP } from "node:net";
import { redactUrlForEvidence } from "./redaction.mjs";

const SUPPORTED_SCHEMES = new Set(["http:", "https:"]);

export function assessUrlSafety(rawUrl, options = {}) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		return blocked("MALFORMED_URL", rawUrl, "URL cannot be parsed");
	}
	if (url.username || url.password) {
		return blocked("URL_CREDENTIALS_FORBIDDEN", url.href, "URL userinfo is forbidden for lit-fetch targets");
	}

	if (!SUPPORTED_SCHEMES.has(url.protocol)) {
		return blocked("UNSUPPORTED_SCHEME", url.href, "Only http: and https: URLs are lit-fetch targets");
	}

	const host = normalizeHost(url.hostname);
	if (!host) return blocked("MALFORMED_URL", url.href, "URL host is empty or malformed");
	if (isBlockedHost(host, options)) {
		return blocked("BLOCKED_PRIVATE_HOST", url.href, `Host ${host} is local, private, link-local, or metadata-addressed`);
	}

	return { ok: true, mayFetch: true, code: "OK", normalizedUrl: url.href, url, reason: "public URL preflight passed" };
}

export function assessRedirectSafety(fromUrl, location, options = {}) {
	let next;
	try {
		next = new URL(location, fromUrl);
	} catch {
		return blocked("MALFORMED_REDIRECT", String(location), "Redirect target cannot be parsed");
	}
	const safety = assessUrlSafety(next.href, options);
	if (!safety.ok) {
		return { ...safety, code: "BLOCKED_REDIRECT", reason: `Unsafe redirect target: ${safety.reason}` };
	}
	return safety;
}

export async function assessResolvedHostSafety(rawUrl, options = {}) {
	const safety = assessUrlSafety(rawUrl, options);
	if (!safety.ok) return safety;
	const host = safety.url.hostname;
	const literalFamily = isIP(normalizeHost(host));
	if (literalFamily !== 0) {
		return { ...safety, resolvedAddresses: [{ address: normalizeHost(host), family: literalFamily }] };
	}
	const lookup = options.lookup;
	if (typeof lookup !== "function") {
		return blocked("DNS_LOOKUP_UNAVAILABLE", safety.normalizedUrl, "A pinned public DNS resolution is required");
	}
	let records;
	try {
		records = await lookup(host);
	} catch {
		return blocked("DNS_LOOKUP_FAILED", safety.normalizedUrl, "DNS lookup failed before a pinned public connection was available");
	}
	const addresses = [];
	for (const record of Array.isArray(records) ? records : [records]) {
		const address = normalizeHost(typeof record === "string" ? record : record?.address);
		const family = isIP(address);
		if (family === 0) {
			return blocked("DNS_INVALID_ADDRESS", safety.normalizedUrl, `Host ${host} returned a non-IP DNS address`);
		}
		if (isBlockedHost(address, { ...options, allowTestLoopback: false })) {
			return blocked("BLOCKED_RESOLVED_PRIVATE_HOST", safety.normalizedUrl, `Host ${host} resolves to blocked address ${address}`);
		}
		if (!addresses.some((candidate) => candidate.address === address)) addresses.push({ address, family });
	}
	if (addresses.length === 0) {
		return blocked("DNS_NO_ADDRESSES", safety.normalizedUrl, `Host ${host} returned no IP addresses`);
	}
	return { ...safety, resolvedAddresses: addresses };
}

function blocked(code, url, reason) {
	return { ok: false, mayFetch: false, code, normalizedUrl: redactUrlForEvidence(url), reason };
}

function normalizeHost(hostname) {
	return String(hostname ?? "")
		.trim()
		.toLowerCase()
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.replace(/\.$/, "");
}

function isBlockedHost(host, options = {}) {
	if (options.allowTestLoopback === true && (host === "127.0.0.1" || host === "localhost" || host === "::1")) {
		return false;
	}
	if (host === "localhost" || host.endsWith(".localhost")) return true;

	const ipv4 = parseIPv4Host(host);
	if (ipv4 && isBlockedIPv4(ipv4)) return true;

	if (host.includes(":")) return isBlockedIPv6(host);
	return false;
}

function parseIPv4Host(host) {
	if (/^\d+$/.test(host)) {
		const value = Number(host);
		if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff) {
			return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
		}
	}
	if (/^0x[0-9a-f]+$/i.test(host)) {
		const value = Number.parseInt(host.slice(2), 16);
		if (Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff) {
			return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
		}
	}
	const parts = host.split(".");
	if (parts.length !== 4) return null;
	const octets = parts.map((part) => {
		if (/^0x[0-9a-f]+$/i.test(part)) return Number.parseInt(part.slice(2), 16);
		if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
		if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
		return Number.NaN;
	});
	if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
	return octets;
}

function isBlockedIPv4([a, b]) {
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168)
	);
}

function isBlockedIPv6(host) {
	const lower = canonicalIPv6(host);
	if (lower === "::" || lower === "::1") return true;
	const firstHextet = Number.parseInt(lower.split(":", 1)[0] ?? "", 16);
	if (Number.isInteger(firstHextet) && (firstHextet & 0xffc0) === 0xfe80) return true;
	if (Number.isInteger(firstHextet) && (firstHextet & 0xffc0) === 0xfec0) return true;
	if (Number.isInteger(firstHextet) && (firstHextet & 0xff00) === 0xff00) return true;
	if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
	const mapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (!mapped) return false;
	const high = Number.parseInt(mapped[1], 16);
	const low = Number.parseInt(mapped[2], 16);
	return isBlockedIPv4([(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255]);
}

function canonicalIPv6(host) {
	try {
		return normalizeHost(new URL(`http://[${host}]/`).hostname);
	} catch {
		return host.toLowerCase();
	}
}
