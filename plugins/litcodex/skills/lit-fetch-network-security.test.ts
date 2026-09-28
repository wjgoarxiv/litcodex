import { afterEach, describe, expect, it, vi } from "vitest";

type PinnedLookup = (
	host: string,
	options: Readonly<{ all?: boolean }>,
	callback: (error: Error | null, address: string, family: number) => void,
) => void;

type RequestOptions = Readonly<{
	lookup: PinnedLookup;
}>;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe.sequential("lit-fetch DNS binding", () => {
	it.each([
		"http://[fe90::1]/",
		"http://[ff02::1]/",
		"http://[::ffff:127.0.0.1]/",
		"http://[::ffff:169.254.1.1]/",
		"http://[fec0::1]/",
		"http://224.0.0.1/",
	])("blocks a non-public literal address before transport: %s", async (url) => {
		// Given/When: a link-local, multicast, or reserved literal crosses the URL boundary.
		const module = await import("./lit-fetch/scripts/lib/safety.mjs");
		const result = module.assessUrlSafety(url);

		// Then: the literal is rejected before any DNS or request seam exists.
		expect(result).toMatchObject({ ok: false, mayFetch: false, code: "BLOCKED_PRIVATE_HOST" });
	});

	it.each([
		"fe90::1",
		"ff02::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:169.254.1.1",
		"::ffff:a9fe:101",
		"fec0::1",
		"224.0.0.1",
	])(
		"blocks a non-public DNS answer before creating a pinned transport: %s",
		async (address) => {
			// Given: a public-looking hostname whose safety lookup returns a non-public address.
			const module = await import("./lit-fetch/scripts/lib/safety.mjs");

			// When: the hostname passes through resolved-host validation.
			const result = await module.assessResolvedHostSafety("http://public-looking.test/", {
				lookup: async () => [{ address }],
			});

			// Then: the answer is rejected and never becomes a pinned address set.
			expect(result).toMatchObject({ ok: false, mayFetch: false, code: "BLOCKED_RESOLVED_PRIVATE_HOST" });
			expect(result.resolvedAddresses).toBeUndefined();
		},
	);

	it("pins the validated public address so a second private DNS answer cannot reach transport", async () => {
		// Given: a hostname that resolves public during validation and private on any second resolution.
		const module = await import("./lit-fetch/scripts/lib/fetch.mjs");
		let sourceLookupCalls = 0;
		let pinnedTransportAddress = "";
		let globalFetchCalls = 0;
		const rebindingLookup = async () => {
			sourceLookupCalls += 1;
			return [{ address: sourceLookupCalls === 1 ? "203.0.113.10" : "127.0.0.1", family: 4 }];
		};
		vi.stubGlobal("fetch", async () => {
			globalFetchCalls += 1;
			await rebindingLookup();
			return new Response("unsafe independently resolved response", { status: 200 });
		});
		const requestImpl = async (_url: string, options: RequestOptions) => {
			pinnedTransportAddress = await resolvePinnedAddress(options.lookup);
			return new Response("pinned public response body ".repeat(20), {
				status: 200,
				headers: { "content-type": "text/plain" },
			});
		};

		// When: fetchPublic validates and opens the request through its transport seam.
		const result = await module.fetchPublic("http://rebind.test/article", {
			lookup: rebindingLookup,
			requestImpl,
		});

		// Then: only one authoritative resolution occurs and transport receives that public address.
		expect(result.ok).toBe(true);
		expect(sourceLookupCalls).toBe(1);
		expect(pinnedTransportAddress).toBe("203.0.113.10");
		expect(globalFetchCalls).toBe(0);
	});

	it("pins a separately validated public address at every redirect hop", async () => {
		// Given: two redirect hosts that each return a private address on any second resolution.
		const module = await import("./lit-fetch/scripts/lib/fetch.mjs");
		const lookupCounts = new Map<string, number>();
		const pinnedAddresses: string[] = [];
		const rebindingLookup = async (host: string) => {
			const count = (lookupCounts.get(host) ?? 0) + 1;
			lookupCounts.set(host, count);
			return [{ address: count === 1 ? "203.0.113.10" : "127.0.0.1", family: 4 }];
		};
		vi.stubGlobal("fetch", async () => {
			throw new Error("global fetch must not resolve redirect hosts");
		});
		const requestImpl = async (requestUrl: string, options: RequestOptions) => {
			pinnedAddresses.push(await resolvePinnedAddress(options.lookup));
			if (requestUrl.includes("first.rebind.test")) {
				return new Response("redirecting", {
					status: 302,
					headers: { location: "http://second.rebind.test/final" },
				});
			}
			return new Response("redirect destination content ".repeat(20), {
				status: 200,
				headers: { "content-type": "text/plain" },
			});
		};

		// When: the runtime follows the public redirect through the injected transport.
		const result = await module.fetchPublic("http://first.rebind.test/start", { lookup: rebindingLookup, requestImpl });

		// Then: both hosts resolve exactly once and both connections use only the validated public answer.
		expect(result.ok).toBe(true);
		expect(Object.fromEntries(lookupCounts)).toEqual({ "first.rebind.test": 1, "second.rebind.test": 1 });
		expect(pinnedAddresses).toEqual(["203.0.113.10", "203.0.113.10"]);
	});
});

function resolvePinnedAddress(lookup: PinnedLookup): Promise<string> {
	return new Promise((resolve, reject) => {
		lookup("rebind.test", { all: false }, (error, address) => {
			if (error) reject(error);
			else resolve(address);
		});
	});
}
