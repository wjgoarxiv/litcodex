import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: ReturnType<typeof createServer>;
let baseUrl = "";
let requestCount = 0;

beforeAll(async () => {
	server = createServer((request, response) => {
		requestCount += 1;
		if (request.url === "/redirect-echo-secrets") {
			response.writeHead(302, {
				location: `${baseUrl}/echo-secrets?token=REDIRECT%20VALUE#REDIRECT%20FRAGMENT`,
			});
			response.end("redirecting");
			return;
		}
		if (request.url?.startsWith("/echo-secrets")) {
			const parsed = new URL(request.url, baseUrl);
			const value = parsed.searchParams.get("token") ?? "";
			const fragment = value.startsWith("REDIRECT") ? "REDIRECT FRAGMENT" : "PRIVATE FRAGMENT";
			response.writeHead(200, { "content-type": "text/html" });
			response.end(
				`<html><body>${request.url} decoded ${value}; encoded ${encodeURIComponent(value)}; plus ${encodeURIComponent(value).replace(/%20/g, "+")}; fragment ${fragment}; encoded-fragment ${encodeURIComponent(fragment)}. ${"usable public evidence ".repeat(30)}</body></html>`,
			);
			return;
		}
		if (request.url === "/alternate-start") {
			response.writeHead(200, { "content-type": "text/html" });
			response.end(
				`<html><head><link rel="alternate" type="application/rss+xml" href="${baseUrl}/alternate-advertised"></head><body>shell</body></html>`,
			);
			return;
		}
		if (request.url === "/alternate-advertised") {
			response.writeHead(302, {
				location: `${baseUrl}/alternate-target?token=ALTERNATE_REDIRECT_SECRET#ALTERNATE_REDIRECT_FRAGMENT`,
			});
			response.end("redirecting");
			return;
		}
		if (request.url?.startsWith("/alternate-target")) {
			response.writeHead(200, { "content-type": "application/rss+xml" });
			response.end(
				`<rss><channel><description>${request.url} ${"alternate public evidence ".repeat(30)}</description></channel></rss>`,
			);
			return;
		}
		if (request.url === "/redirect-secret") {
			response.writeHead(302, {
				location: `${baseUrl}/redirect-target?token=REDIRECT_SECRET_SENTINEL#REDIRECT_FRAGMENT_SENTINEL`,
			});
			response.end("redirecting");
			return;
		}
		response.writeHead(200, { "content-type": "text/html" });
		response.end(`<html><body>redirect echo ${request.url} ${"usable redirected content ".repeat(30)}</body></html>`);
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

async function readUrl(url: string) {
	const module = await import("./lit-fetch/scripts/lib/reader.mjs");
	return module.readPublicPage(url, { allowTestLoopback: true });
}

describe("lit-fetch report redaction", () => {
	it("rejects URL userinfo before network use and removes it from the complete receipt", async () => {
		// Given: a fetchable test URL containing explicit username and password sentinels.
		requestCount = 0;
		const credentialUrl = baseUrl.replace("http://", "http://alice:TOP_SECRET_PASSWORD@");

		// When: the public reader evaluates the hostile URL.
		const report = await readUrl(`${credentialUrl}/ok?token=QUERY_SECRET#FRAGMENT_SECRET`);
		const serialized = JSON.stringify(report);

		// Then: it fails closed before the server sees a request and no credential survives.
		expect(report.classification).toBe("blocked_for_safety");
		expect(report.attempts[0]).toMatchObject({ verdict: "blocked_for_safety", terminal: true });
		expect(requestCount).toBe(0);
		expect(serialized).not.toContain("alice");
		expect(serialized).not.toContain("TOP_SECRET_PASSWORD");
		expect(serialized).not.toContain("QUERY_SECRET");
		expect(serialized).not.toContain("FRAGMENT_SECRET");
	});

	it("sanitizes userinfo from parseable and malformed evidence URLs", async () => {
		// Given: valid and malformed evidence strings that both contain URL credentials.
		const module = await import("./lit-fetch/scripts/lib/redaction.mjs");
		const inputs = [
			"https://alice:VALID_PASSWORD@example.test/path?token=VALID_QUERY#VALID_FRAGMENT",
			"https://bob:MALFORMED_PASSWORD@example .test/path?token=MALFORMED_QUERY#MALFORMED_FRAGMENT",
		];

		// When: each string passes through URL and surrounding-text serialization.
		const serialized = JSON.stringify(
			inputs.flatMap((input) => [module.redactUrlForEvidence(input), module.redactTextForEvidence(`redirect ${input}`, input)]),
		);

		// Then: credential, query-value, and fragment sentinels are absent on both paths.
		for (const secret of ["alice", "bob", "VALID_PASSWORD", "MALFORMED_PASSWORD", "VALID_QUERY", "MALFORMED_QUERY", "VALID_FRAGMENT", "MALFORMED_FRAGMENT"]) {
			expect(serialized).not.toContain(secret);
		}
	});

	it("redacts every query value and removes fragments across the complete report", async () => {
		const report = await readUrl(
			`${baseUrl}/ok?token=FAKE_SECRET_SENTINEL&next=PRIVATE_TARGET_SENTINEL#PRIVATE_FRAGMENT_SENTINEL`,
		);
		const serialized = JSON.stringify(report);

		expect(serialized).not.toContain("FAKE_SECRET_SENTINEL");
		expect(serialized).not.toContain("PRIVATE_TARGET_SENTINEL");
		expect(serialized).not.toContain("PRIVATE_FRAGMENT_SENTINEL");
		expect(serialized).toContain("token");
		expect(serialized).toContain("next");
		expect(report.routeCoverageComplete).toBe(false);
		expect(report.routesUntried.length).toBeGreaterThan(0);
	});

	it("redacts decoded and encoded forms when evidence echoes a query value", async () => {
		const module = await import("./lit-fetch/scripts/lib/redaction.mjs");
		const redacted = module.redactTextForEvidence(
			"decoded PRIVATE VALUE; percent PRIVATE%20VALUE; plus PRIVATE+VALUE; fragment PRIVATE FRAGMENT",
			"https://example.test/?token=PRIVATE%20VALUE#PRIVATE%20FRAGMENT",
		);

		expect(redacted).not.toContain("PRIVATE VALUE");
		expect(redacted).not.toContain("PRIVATE%20VALUE");
		expect(redacted).not.toContain("PRIVATE+VALUE");
		expect(redacted).not.toContain("PRIVATE FRAGMENT");
	});

	it("uses the redirect final URL to redact query values echoed in validation evidence", async () => {
		const report = await readUrl(`${baseUrl}/redirect-secret`);
		const serialized = JSON.stringify(report);

		expect(report.classification).toBe("content_ok");
		expect(report.url).toContain("/redirect-target");
		expect(serialized).toContain("token");
		expect(serialized).not.toContain("REDIRECT_SECRET_SENTINEL");
		expect(serialized).not.toContain("REDIRECT_FRAGMENT_SENTINEL");
	});

	it("uses an alternate redirect final URL for validation, reporting, and redaction", async () => {
		const report = await readUrl(`${baseUrl}/alternate-start`);
		const serialized = JSON.stringify(report);

		expect(report.classification).toBe("content_ok");
		expect(report.url).toContain("/alternate-target");
		expect(report.routesTried).toContain("public_alternate");
		expect(serialized).toContain("token");
		expect(serialized).not.toContain("ALTERNATE_REDIRECT_SECRET");
		expect(serialized).not.toContain("ALTERNATE_REDIRECT_FRAGMENT");
	});

	it("removes raw and encoded source and redirect URL values echoed by page-controlled evidence", async () => {
		// Given: direct and redirected pages that echo decoded, percent-encoded, and plus-encoded URL values.
		const direct = await readUrl(`${baseUrl}/echo-secrets?token=PRIVATE%20VALUE#PRIVATE%20FRAGMENT`);
		const redirected = await readUrl(`${baseUrl}/redirect-echo-secrets`);

		// When: both complete runtime reports are serialized.
		const serialized = JSON.stringify([direct, redirected]);

		// Then: no source/redirect query or fragment representation survives page-controlled evidence.
		for (const secret of [
			"PRIVATE VALUE",
			"PRIVATE%20VALUE",
			"PRIVATE+VALUE",
			"PRIVATE FRAGMENT",
			"PRIVATE%20FRAGMENT",
			"REDIRECT VALUE",
			"REDIRECT%20VALUE",
			"REDIRECT+VALUE",
			"REDIRECT FRAGMENT",
			"REDIRECT%20FRAGMENT",
		]) {
			expect(serialized).not.toContain(secret);
		}
		expect(direct.contentSafety.handling).toBe("inert_data_only");
		expect(redirected.contentSafety.handling).toBe("inert_data_only");
	});
});
