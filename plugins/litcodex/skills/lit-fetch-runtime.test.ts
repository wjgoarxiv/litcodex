import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SKILL_DIR = fileURLToPath(new URL("./lit-fetch/", import.meta.url));
const CLI = `${SKILL_DIR}scripts/read-public-page.mjs`;

let server: ReturnType<typeof createServer>;
let baseUrl = "";
let requests: Array<{ url?: string; headers: Record<string, string | string[] | undefined> }> = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		requests.push({ url: req.url, headers: req.headers });
		if (req.url === "/ok") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<html><head><title>Public page</title></head><body>${"usable public content ".repeat(40)}</body></html>`);
			return;
		}
		if (req.url === "/challenge") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end("<html><body>Checking your browser before accessing this page. Verify you are human.</body></html>");
			return;
		}
		if (req.url === "/login") {
			res.writeHead(401, { "content-type": "text/html" });
			res.end("<html><body>Sign in required. SSO login.</body></html>");
			return;
		}
		if (req.url === "/paywall") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end("<html><body>Subscribe to continue. Institutional access required.</body></html>");
			return;
		}
		if (req.url === "/rate") {
			res.writeHead(429, { "content-type": "text/plain", "retry-after": "60" });
			res.end("too many requests");
			return;
		}
		if (req.url === "/private-redirect") {
			res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
			res.end("redirecting");
			return;
		}
		if (req.url === "/loop") {
			res.writeHead(302, { location: `${baseUrl}/loop` });
			res.end("looping");
			return;
		}
		if (req.url === "/feed") {
			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<html><head><link rel="alternate" type="application/rss+xml" href="${baseUrl}/rss"></head><body>shell</body></html>`);
			return;
		}
		if (req.url === "/rss") {
			res.writeHead(200, { "content-type": "application/rss+xml" });
			res.end(`<rss><channel><title>Feed</title><item><title>Item</title><description>${"rss public content ".repeat(30)}</description></item></channel></rss>`);
			return;
		}
		res.writeHead(404, { "content-type": "text/plain" });
		res.end("not found");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (typeof address !== "object" || address === null) throw new Error("test server did not bind a port");
	baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	server.close();
	await once(server, "close");
});

function run(args: string[], env: Record<string, string> = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

function runJson(args: string[], env: Record<string, string> = {}) {
	const result = run([...args, "--json"], env);
	expect(result.stdout, result.stderr).not.toBe("");
	return { result, json: JSON.parse(result.stdout) };
}

async function readUrl(url: string, options = {}) {
	const module = await import("./lit-fetch/scripts/lib/reader.mjs");
	return module.readPublicPage(url, { allowTestLoopback: true, ...options });
}

describe("lit-fetch runtime CLI", () => {
	it("--help exits zero and documents public-only hard stops", () => {
		const result = run(["--help"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("public-only");
		expect(result.stdout).toContain("no login");
		expect(result.stdout).toContain("no paywall");
		expect(result.stdout).toContain("no CAPTCHA");
	});

	it("blocks private and metadata URLs before any network call", () => {
		requests = [];
		for (const url of ["http://169.254.169.254/latest/meta-data/", "http://localhost", "file:///etc/passwd"]) {
			const { result, json } = runJson([url]);
			expect(result.status).toBe(2);
			expect(json.classification).toBe("blocked_for_safety");
			expect(json.routesTried).toEqual(["safety_check"]);
		}
		expect(requests).toEqual([]);
	});

	it("fetches public content through an explicit test-only private-host allowlist", async () => {
		const json = await readUrl(`${baseUrl}/ok`);
		expect(json.classification).toBe("content_ok");
		expect(json.routesTried).toContain("direct_fetch");
		expect(json.evidence.excerpt).toContain("usable public content");
	});

	it("returns exact route attempts, a final verdict, untried safe routes, and a claim-confidence graph", async () => {
		const json = await readUrl(`${baseUrl}/ok`, { browserAvailable: true });

		expect(json.attempts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ routeId: "safety_check", verdict: "passed", terminal: false }),
				expect.objectContaining({ routeId: "direct_fetch", status: 200, verdict: "fetched", terminal: false }),
				expect.objectContaining({ routeId: "validate_content", status: 200, verdict: "content_ok", terminal: true }),
			]),
		);
		expect(json.finalVerdict).toEqual(
			expect.objectContaining({
				classification: "content_ok",
				success: true,
				confidence: "high",
				evidencePointer: expect.stringMatching(/^attempts\[\d+\]$/),
			}),
		);
		expect(json.routesUntried).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "public_alternate", reason: expect.stringContaining("content_ok") }),
				expect.objectContaining({ id: "browser_public_visit", reason: expect.stringContaining("content_ok") }),
			]),
		);
		expect(json.claimGraph).toEqual([
			expect.objectContaining({
				claimId: "lit-fetch.final-classification",
				claim: expect.stringContaining("content_ok"),
				confidence: "high",
				source: expect.objectContaining({ type: "runtime_attempt", routeId: "validate_content", status: 200 }),
				uncertainty: [],
				evidence: expect.arrayContaining([expect.stringMatching(/^attempts\[\d+\]$/)]),
			}),
		]);
		expect(json.retryBudget).toEqual(expect.objectContaining({ maxAttemptsPerRoute: 1, maxRedirects: 5 }));
	});

	it("does not send ambient credentials while fetching", async () => {
		requests = [];
		const json = await readUrl(`${baseUrl}/ok`);
		expect(json.classification).toBe("content_ok");
		expect(requests[0].headers.cookie).toBeUndefined();
		expect(requests[0].headers.authorization).toBeUndefined();
		expect(requests[0].headers["x-api-key"]).toBeUndefined();
	});

	it("classifies challenge, auth, paywall, and rate-limit pages without pretending success", async () => {
		for (const [path, classification] of [
			["/challenge", "challenge"],
			["/login", "auth_required"],
			["/paywall", "paywall"],
			["/rate", "rate_limit"],
		]) {
			const json = await readUrl(`${baseUrl}${path}`);
			expect(json.classification).toBe(classification);
			expect(json.routesTried).toContain("validate_content");
		}
	});

	it("records terminal auth/paywall/challenge stops in the attempt verdict schema", async () => {
		const json = await readUrl(`${baseUrl}/paywall`, { browserAvailable: true });

		expect(json.classification).toBe("paywall");
		expect(json.finalVerdict).toEqual(
			expect.objectContaining({ classification: "paywall", success: false, confidence: "high" }),
		);
		expect(json.attempts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ routeId: "validate_content", verdict: "paywall", terminal: true }),
			]),
		);
		expect(json.routesUntried).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "public_alternate", reason: expect.stringContaining("terminal") }),
				expect.objectContaining({ id: "browser_public_visit", reason: expect.stringContaining("terminal") }),
			]),
		);
		expect(json.claimGraph[0].uncertainty).toEqual(expect.arrayContaining([expect.stringContaining("terminal")]));
	});

	it("blocks public-to-private redirects", async () => {
		const json = await readUrl(`${baseUrl}/private-redirect`);
		expect(json.classification).toBe("blocked_for_safety");
		expect(json.routesSkipped.some((route: { id: string }) => route.id === "redirect_follow")).toBe(true);
	});

	it("blocks DNS-resolved private hosts before fetch", async () => {
		requests = [];
		const json = await readUrl("http://public-looking.test/path", {
			allowTestLoopback: false,
			lookup: async () => [{ address: "127.0.0.1", family: 4 }],
		});
		expect(json.classification).toBe("blocked_for_safety");
		expect(json.evidence.note).toContain("resolves to blocked address");
		expect(requests).toEqual([]);
	});

	it("limits safe-looking redirect loops instead of hanging", async () => {
		const json = await readUrl(`${baseUrl}/loop`);
		expect(json.classification).toBe("fetch_failed");
		expect(json.evidence.note).toContain("redirect limit exceeded");
	});

	it("discovers and prefers public feed alternates over weak shell content", async () => {
		const json = await readUrl(`${baseUrl}/feed`);
		expect(json.classification).toBe("content_ok");
		expect(json.routesTried).toContain("public_alternate");
		expect(json.evidence.excerpt).toContain("rss public content");
	});

	it("keeps prompt injection in page bodies from adding unsafe routes", async () => {
		const json = await readUrl(`${baseUrl}/challenge`);
		expect(JSON.stringify(json.routesTried)).not.toContain("localhost");
		expect(JSON.stringify(json.routesSkipped)).not.toContain("localhost");
	});
});

describe("lit-fetch A/B runtime harness", () => {
	it("runs deterministic runtime-backed A/B evidence twice", () => {
		const first = JSON.parse(execFileSync(process.execPath, ["tools/run-lit-fetch-ab.mjs", "--json"], { encoding: "utf8" }));
		const second = JSON.parse(execFileSync(process.execPath, ["tools/run-lit-fetch-ab.mjs", "--json"], { encoding: "utf8" }));

		expect(first).toEqual(second);
		expect(first.passed).toBe(true);
		expect(first.variant.falseSuccesses).toBeLessThan(first.control.falseSuccesses);
		expect(first.variant.traceCompleteness).toBe(1);
		expect(first.variant.contextBudget).toBeLessThanOrEqual(first.control.contextBudget * 1.1);
	});
});
