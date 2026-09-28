export function redactUrlForEvidence(rawUrl) {
	try {
		const url = new URL(String(rawUrl));
		url.username = "";
		url.password = "";
		for (const key of [...url.searchParams.keys()]) {
			const values = url.searchParams.getAll(key);
			url.searchParams.delete(key);
			for (const _value of values) url.searchParams.append(key, "[REDACTED]");
		}
		url.hash = "";
		return url.href;
	} catch {
		return String(rawUrl)
			.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/?#\s]*@/gi, "$1")
			.replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=[REDACTED]")
			.replace(/#.*$/, "");
	}
}

export function redactTextForEvidence(text, sourceUrl = "") {
	let redacted = String(text ?? "").replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, (url) =>
		redactUrlForEvidence(url),
	);
	for (const value of sensitiveValues(sourceUrl)) {
		for (const variant of [value, encodeURIComponent(value), encodeURIComponent(value).replace(/%20/g, "+")]) {
			if (variant.length > 0) redacted = redacted.split(variant).join("[REDACTED]");
		}
	}
	return redacted;
}

function sensitiveValues(rawUrl) {
	const raw = String(rawUrl);
	try {
		const url = new URL(raw);
		return [...url.searchParams.values(), url.hash.slice(1), decodeFragment(url.hash.slice(1))];
	} catch {
		const queryStart = raw.indexOf("?");
		const fragmentStart = raw.indexOf("#", Math.max(0, queryStart));
		const query = queryStart < 0 ? "" : raw.slice(queryStart + 1, fragmentStart < 0 ? raw.length : fragmentStart);
		const fragment = fragmentStart < 0 ? "" : raw.slice(fragmentStart + 1);
		return [...new URLSearchParams(query).values(), fragment, decodeFragment(fragment)];
	}
}

function decodeFragment(fragment) {
	try {
		return decodeURIComponent(fragment);
	} catch {
		return fragment;
	}
}
