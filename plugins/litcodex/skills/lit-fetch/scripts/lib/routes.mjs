export function planRoutes(url, options = {}) {
	const routes = [{ id: "safety_check", url, reason: "always first" }];
	if (options.policyStop) {
		routes.push({ id: "stop_policy", url, reason: "login, paywall, CAPTCHA, or access-control bypass requested" });
		return routes;
	}
	routes.push({ id: "public_alternate", url, reason: "feed, JSON, oEmbed, or canonical public endpoint when advertised" });
	routes.push({ id: "direct_fetch", url, reason: "original public URL" });
	for (const variant of buildVariants(url)) routes.push({ id: "fetch_variant", url: variant, reason: "canonical/mobile/www variant" });
	if (options.browserAvailable) routes.push({ id: "browser_public_visit", url, reason: "optional normal public browser surface" });
	return routes;
}

export function buildVariants(rawUrl) {
	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		return [];
	}
	const variants = new Set();
	const stripped = new URL(url.href);
	for (const key of [...stripped.searchParams.keys()]) {
		if (/^(utm_|fbclid$|gclid$)/i.test(key)) stripped.searchParams.delete(key);
	}
	if (stripped.href !== url.href) variants.add(stripped.href);
	if (url.hostname.startsWith("www.")) {
		const noWww = new URL(url.href);
		noWww.hostname = url.hostname.slice(4);
		variants.add(noWww.href);
	} else if (!url.hostname.startsWith("m.")) {
		const www = new URL(url.href);
		www.hostname = `www.${url.hostname}`;
		variants.add(www.href);
		const mobile = new URL(url.href);
		mobile.hostname = `m.${url.hostname}`;
		variants.add(mobile.href);
	}
	return [...variants].filter((variant) => variant !== url.href).slice(0, 3);
}

export function discoverAlternates(baseUrl, body) {
	const found = [];
	for (const match of String(body).matchAll(/<link\b[^>]*rel=["'][^"']*alternate[^"']*["'][^>]*>/gi)) {
		const tag = match[0];
		if (!/(rss|atom|json|oembed)/i.test(tag)) continue;
		const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
		if (!href) continue;
		try {
			found.push(new URL(href, baseUrl).href);
		} catch {
			// Ignore malformed advertised alternates; direct fetch trace remains authoritative.
		}
	}
	return [...new Set(found)].slice(0, 3);
}
