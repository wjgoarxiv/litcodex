import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: ReturnType<typeof createServer>;
let baseUrl = "";

beforeAll(async () => {
	server = createServer((request, response) => {
		if (request.url?.startsWith("/oversized")) {
			response.writeHead(200, { "content-type": "text/html" });
			response.end(`<html><body>${"bounded response ".repeat(200)}</body></html>`);
			return;
		}
		response.writeHead(200, { "content-type": "text/html" });
		response.end(`<html><body>${"usable public content ".repeat(30)}</body></html>`);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (typeof address !== "object" || address === null) throw new Error("test server did not bind");
	baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	server.close();
	await once(server, "close");
});

async function validate(input: Readonly<Record<string, unknown>>) {
	const module = await import("./lit-fetch/scripts/lib/validate.mjs");
	return module.validateResponse(input);
}

async function readUrl(url: string, options: Readonly<Record<string, unknown>> = {}) {
	const module = await import("./lit-fetch/scripts/lib/reader.mjs");
	return module.readPublicPage(url, { allowTestLoopback: true, ...options });
}

describe("lit-fetch hardening", () => {
	it("bounds response bytes before materializing the complete body", async () => {
		const report = await readUrl(`${baseUrl}/oversized`, { maxBytes: 128 });

		expect(report.classification).toBe("content_too_large");
		expect(report.evidence.note).toContain("128");
		expect(report.retryBudget.maxResponseBytes).toBe(128);
	});

	it("gives HTTP error status precedence over misleading body language", async () => {
		const result = await validate({
			status: 500,
			headers: { "content-type": "text/html" },
			body: `<html><body>Sign in required. ${"server failure ".repeat(20)}</body></html>`,
			url: "https://example.test/",
		});

		expect(result.classification).toBe("fetch_failed");
		expect(result.note).toBe("HTTP 500");
	});

	it("accepts meaningful vendor JSON but rejects problem and empty JSON", async () => {
		const vendor = await validate({
			status: 200,
			headers: { "content-type": "application/vnd.api+json" },
			body: JSON.stringify({ data: [{ title: "verified record", abstract: "evidence ".repeat(30) }] }),
		});
		const problem = await validate({
			status: 200,
			headers: { "content-type": "application/problem+json" },
			body: JSON.stringify({ title: "Upstream unavailable", detail: "error ".repeat(30) }),
		});
		const empty = await validate({
			status: 200,
			headers: { "content-type": "application/vnd.api+json" },
			body: JSON.stringify({ data: [] }),
		});

		expect(vendor.classification).toBe("content_ok");
		expect(problem.classification).toBe("weak_content");
		expect(empty.classification).toBe("weak_content");
	});

	it("classifies PDF and octet-stream payloads as binary rather than text success", async () => {
		for (const contentType of ["application/pdf", "application/octet-stream"]) {
			const result = await validate({
				status: 200,
				headers: { "content-type": contentType },
				body: `%PDF-1.7\n${"binary-looking payload ".repeat(20)}`,
			});
			expect(result.classification).toBe("binary_content");
			expect(result.stop).toBe(true);
		}
	});

	it.each(["", "text/plain", "application/x-pdf", "text/pdf"])(
		"recognizes a PDF magic signature independently of content type %s",
		async (contentType) => {
			const result = await validate({
				status: 200,
				headers: contentType === "" ? {} : { "content-type": contentType },
				body: `%PDF-1.7\n${"binary-looking payload ".repeat(20)}`,
			});

			expect(result.classification).toBe("binary_content");
			expect(result.stop).toBe(true);
		},
	);

	it("does not classify ordinary prose that mentions a PDF signature as binary", async () => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/plain" },
			body: `This article explains why the %PDF- signature identifies a PDF artifact. ${"Ordinary explanatory prose. ".repeat(20)}`,
		});

		expect(result.classification).toBe("content_ok");
	});

	it("rejects a generic HTML error template even when it is long", async () => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/html" },
			body: `<html><title>Error</title><body>Something went wrong. ${"request failed ".repeat(30)}</body></html>`,
		});

		expect(result.classification).toBe("weak_content");
		expect(result.note).toContain("error template");
	});

	it.each([
		["title", "Access Denied"],
		["h1", "Request Rejected"],
		["title", "Service Unavailable"],
	])("rejects a dominant HTML error template marked by <%s>%s", async (tag, heading) => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/html" },
			body: `<html><${tag}>${heading}</${tag}><body>${"gateway diagnostic filler ".repeat(30)}</body></html>`,
		});

		expect(result.classification).toBe("weak_content");
		expect(result.note).toContain("error template");
	});

	it("keeps ordinary article prose about access-error phrases as content", async () => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/html" },
			body: `<html><title>Incident response language study</title><article><p>An ordinary article discusses the phrases Access Denied, Request Rejected, Service Unavailable, and Something went wrong without being an access-error template.</p><p>${"Evidence-backed explanatory prose. ".repeat(20)}</p></article></html>`,
		});

		expect(result.classification).toBe("content_ok");
	});

	it("keeps long research prose discussing auth, paywall, and challenge phrases as content", async () => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/html" },
			body: `<html><title>Access-control language research</title><article><p>This study compares sign in prompts, login walls, paywall notices, captcha challenges, and bot check language as research subjects.</p><p>${"The analysis cites evidence without asking the reader to authenticate. ".repeat(20)}</p></article></html>`,
		});

		expect(result.classification).toBe("content_ok");
	});

	it.each([
		"Sign In Interface Research",
		"Paywall Economics in Digital Media",
		"CAPTCHA and Bot Check Evaluation",
		"Not Found: Archival Loss on the Web",
	])("keeps an ordinary article title containing an interstitial phrase as content: %s", async (title) => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/html" },
			body: `<html><title>${title}</title><article><p>${"Evidence-backed explanatory prose about the research topic. ".repeat(20)}</p></article></html>`,
		});

		expect(result.classification).toBe("content_ok");
	});

	it.each([
		"This study discusses sign in required screens as an interface-design research subject.",
		"Researchers compare subscribe to continue notices across public news sites.",
		"The paper evaluates verify you are human and bot check wording without presenting a challenge.",
		"An archival methods note explains why a resource may be not found after a site migration.",
	])("keeps short study prose containing a wall phrase as content: %s", async (body) => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/plain" },
			body: `${body} ${"Substantive evidence and analysis. ".repeat(4)}`,
		});

		expect(result.classification).toBe("content_ok");
	});

	it("detects a short leading sign-in instruction as an auth wall", async () => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/plain" },
			body: `Sign in required. Enter your account password to continue. ${"Restricted account surface. ".repeat(4)}`,
		});

		expect(result.classification).toBe("auth_required");
	});

	it.each([
		[
			"auth_required",
			'<main><form action="/login"><label>Password</label><input type="password" name="password"><button>Sign in</button></form></main>',
		],
		[
			"paywall",
			'<main><div class="paywall"><h2>Subscribe to continue</h2><p>A subscription is required.</p></div></main>',
		],
		[
			"challenge",
			'<main><div class="challenge"><h2>Verify you are human</h2><p>Complete this bot check.</p></div></main>',
		],
	])("detects a long real %s interstitial from structural wall evidence", async (classification, interstitial) => {
		const result = await validate({
			status: 200,
			headers: { "content-type": "text/html" },
			body: `<html><title>Welcome</title><body>${interstitial}<footer>${"Generic footer navigation and legal text. ".repeat(40)}</footer></body></html>`,
		});

		expect(result.classification).toBe(classification);
	});

});
