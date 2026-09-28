import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { assessRedirectSafety, assessResolvedHostSafety, assessUrlSafety } from "./safety.mjs";

const DEFAULT_MAX_BYTES = 1_000_000;

export async function fetchPublic(url, options = {}) {
	const safety = assessUrlSafety(url, options);
	if (!safety.ok) return { ok: false, safety, status: 0, headers: {}, body: "", finalUrl: url };
	const resolvedSafety = await assessResolvedHostSafety(safety.normalizedUrl, {
		...options,
		lookup: options.lookup ?? defaultLookup,
	});
	if (!resolvedSafety.ok) {
		return { ok: false, safety: resolvedSafety, status: 0, headers: {}, body: "", finalUrl: safety.normalizedUrl };
	}
	if ((options.redirectDepth ?? 0) > 5) {
		return { ok: false, safety, status: 0, headers: {}, body: "redirect limit exceeded", finalUrl: safety.normalizedUrl };
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
	try {
		const requestImpl = options.requestImpl ?? requestPinned;
		const response = await requestImpl(safety.normalizedUrl, {
			signal: controller.signal,
			lookup: createPinnedLookup(resolvedSafety.resolvedAddresses),
			headers: {
				accept: "text/html,application/xhtml+xml,application/xml,application/json,text/plain;q=0.9,*/*;q=0.5",
				"user-agent": "LitCodex lit-fetch/1.0 (+public-only; no credentials)",
			},
		});
		const headers = Object.fromEntries(response.headers.entries());
		if (response.status >= 300 && response.status < 400 && headers.location) {
			const redirectSafety = assessRedirectSafety(safety.normalizedUrl, headers.location, options);
			if (!redirectSafety.ok) {
				return { ok: false, safety: redirectSafety, status: response.status, headers, body: "", finalUrl: safety.normalizedUrl };
			}
			return fetchPublic(redirectSafety.normalizedUrl, { ...options, redirectDepth: (options.redirectDepth ?? 0) + 1 });
		}
		const bounded = await readBoundedBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
		return { ok: true, safety, status: response.status, headers, ...bounded, finalUrl: response.url || safety.normalizedUrl };
	} catch (error) {
		return { ok: false, safety, status: 0, headers: {}, body: String(error?.message ?? error), finalUrl: safety.normalizedUrl };
	} finally {
		clearTimeout(timeout);
	}
}

function createPinnedLookup(addresses) {
	return (_host, lookupOptions, callback) => {
		if (lookupOptions?.all === true) {
			callback(null, addresses.map(({ address, family }) => ({ address, family })));
			return;
		}
		const first = addresses[0];
		if (!first) {
			callback(new Error("pinned DNS address set is empty"));
			return;
		}
		callback(null, first.address, first.family);
	};
}

function requestPinned(url, options) {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const request = (parsed.protocol === "https:" ? httpsRequest : httpRequest)(parsed, {
			method: "GET",
			headers: options.headers,
			lookup: options.lookup,
			signal: options.signal,
		}, (response) => {
			const headers = new Headers();
			for (const [name, value] of Object.entries(response.headers)) {
				for (const item of Array.isArray(value) ? value : [value]) {
					if (item !== undefined) headers.append(name, String(item));
				}
			}
			resolve({
				status: response.statusCode ?? 0,
				headers,
				body: Readable.toWeb(response),
				url: parsed.href,
			});
		});
		request.once("error", reject);
		request.end();
	});
}

async function readBoundedBody(response, maxBytes) {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		await response.body?.cancel();
		return { body: "", tooLarge: true, bytesRead: 0, maxBytes };
	}
	if (response.body === null) return { body: "", tooLarge: false, bytesRead: 0, maxBytes };

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = "";
	let bytesRead = 0;
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		bytesRead += result.value.byteLength;
		if (bytesRead > maxBytes) {
			await reader.cancel();
			return { body, tooLarge: true, bytesRead, maxBytes };
		}
		body += decoder.decode(result.value, { stream: true });
	}
	body += decoder.decode();
	return { body, tooLarge: false, bytesRead, maxBytes };
}

async function defaultLookup(host) {
	return dnsLookup(host, { all: true, verbatim: true });
}
