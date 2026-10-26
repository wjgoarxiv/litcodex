import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ASSET_LIMITS, assertPublicHost, pinnedFetch, assetUsed, checkProductFiles, cleanSvg, fetchAssets, normUrl, pageFacts, readmeImages, requestUrls, sniffImage } from "./engine/assets.mjs";
import { EXIT } from "./engine/constants.mjs";
import { validateCoverTreatment } from "./engine/cover-treatment.mjs";
import { encodePng } from "./engine/image.mjs";
import { main, parseArgs } from "./scripts/render.mjs";

// Fetching a linked product's real assets (references/cover.md, Named products). Everything the
// fetch returns is untrusted data; every network path here is a stub, so these tests never touch the net.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix: string) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	temps.push(dir);
	return dir;
};
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const png = (shade = 128) => encodePng(8, 8, Buffer.alloc(8 * 8 * 4, shade));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f63"/></svg>';
const publicHost = async () => [{ address: "93.184.216.34", family: 4 }];

type Reply = { status?: number; body?: Buffer | string; headers?: Record<string, string> };
/** A fetch that answers from a table by URL; an unlisted URL is a 404, and every request is recorded. */
const stub = (table: Record<string, Reply>) => {
	const seen: string[] = [];
	const fetchImpl = async (url: string) => {
		seen.push(url);
		const reply = table[url] ?? { status: 404 };
		return new Response(reply.body === undefined ? null : new Uint8Array(Buffer.from(reply.body)), { status: reply.status ?? 200, headers: reply.headers ?? {} });
	};
	return { fetchImpl, seen };
};
const REPO = "https://github.com/acme/widget";
const github = (extra: Record<string, Reply> = {}, readme = "# widget\n\n![logo](docs/logo.png)\n") => ({
	"https://api.github.com/repos/acme/widget": { body: JSON.stringify({ name: "widget", description: "A widget\u0007 for work.", homepage: "", topics: ["tools"], owner: { avatar_url: "https://avatars.githubusercontent.com/u/1" } }) },
	"https://api.github.com/repos/acme/widget/readme": { body: readme },
	"https://raw.githubusercontent.com/acme/widget/HEAD/docs/logo.png": { body: png(10) },
	"https://avatars.githubusercontent.com/u/1": { body: png(200) },
	...extra,
});

describe("sniffImage and cleanSvg: type from bytes, SVG without script", () => {
	it("names the five image kinds from their first bytes, and nothing else", () => {
		expect(sniffImage(png())).toBe("png");
		expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
		expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("webp");
		expect(sniffImage(Buffer.from("GIF89a\u0001\u0000"))).toBe("gif");
		expect(sniffImage(Buffer.from(SVG))).toBe("svg");
		expect(sniffImage(Buffer.from('<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
		expect(sniffImage(Buffer.from("<!doctype html><html><body>hi</body></html>"))).toBeNull();
		expect(sniffImage(Buffer.from("MZ\u0090\u0000"))).toBeNull();
		expect(sniffImage(Buffer.alloc(0))).toBeNull();
	});
	it("accepts a plain SVG and refuses script, handlers, foreign objects, entities and outside links", () => {
		expect(cleanSvg(SVG)).toBe(true);
		for (const bad of [
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>',
			'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
			'<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>',
			'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="data:text/html,x"/></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(x.css);</style></svg>',
			'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:x()"/></svg>',
		])
			expect(cleanSvg(bad), bad).toBe(false);
	});
});

describe("readmeImages and pageFacts", () => {
	const base = "https://raw.githubusercontent.com/acme/widget/HEAD/";
	it("resolves Markdown and <img> references, skips badges, http links and duplicates", () => {
		const md = [
			"![logo](docs/logo.png)",
			'<img alt="shot" src="img/screen.png" width="600">',
			"![build](https://img.shields.io/badge/build-passing-green.svg)",
			"![cov](https://codecov.io/gh/acme/widget/badge.svg)",
			"![plain](http://insecure.example/a.png)",
			"![again](docs/logo.png)",
			"![abs](https://cdn.example.org/hero.webp)",
		].join("\n");
		expect(readmeImages(md, base)).toEqual([`${base}docs/logo.png`, "https://cdn.example.org/hero.webp", `${base}img/screen.png`]);
	});
	it("reads og:image, the icon links, the title and the description of a product page", () => {
		const html = '<html><head><title> Widget | Tools </title><meta property="og:image" content="/og.png"><meta name="description" content="Make widgets."><link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/x.css"></head></html>';
		const facts = pageFacts(html, "https://widget.example.org/");
		expect(facts.images).toEqual([
			{ url: "https://widget.example.org/og.png", role: "photo" },
			{ url: "https://widget.example.org/favicon.png", role: "icon" },
		]);
		expect(facts.title).toBe("Widget | Tools");
		expect(facts.description).toBe("Make widgets.");
	});
});

describe("assertPublicHost: a fetch reaches public https hosts only", () => {
	it("accepts a name that resolves to a public address", async () => {
		await expect(assertPublicHost("https://widget.example.org/a.png", publicHost)).resolves.toBeUndefined();
	});
	it("refuses http, address literals, localhost, intranet names and names that resolve privately", async () => {
		const lookup = async (host: string) => [{ address: host === "rebind.example.org" ? "10.0.0.7" : "93.184.216.34" }];
		for (const [url, why] of [
			["http://widget.example.org/", /not https/u],
			["https://127.0.0.1/a.png", /address/u],
			["https://[::1]/a.png", /address/u],
			["https://localhost/a.png", /not a public host/u],
			["https://printer/a.png", /not a public host/u],
			["https://nas.local/a.png", /not a public host/u],
			["https://rebind.example.org/a.png", /private address/u],
		] as const)
			await expect(assertPublicHost(url, lookup), url).rejects.toThrow(why);
		await expect(assertPublicHost("https://gone.example.org/", async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).rejects.toThrow(/did not resolve/u);
	});
});

describe("the connection is pinned to the checked address, and the body is capped while it streams", () => {
	it("pinnedFetch refuses, at connect time, a name whose lookup answers privately", async () => {
		let lookups = 0;
		const lookup = (_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
			lookups += 1;
			if (options?.all) callback(null, [{ address: "10.0.0.7", family: 4 }]);
			else callback(null, "10.0.0.7", 4);
		};
		await expect(pinnedFetch("https://rebind.example.org/x.png", {}, { lookup })).rejects.toThrow(/private address/u);
		expect(lookups).toBe(1);
	});
	it("pinnedFetch refuses a private address literal, which the socket would connect to without any lookup", async () => {
		for (const url of ["https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/", "https://[::ffff:7f00:1]/"]) await expect(pinnedFetch(url, {}), url).rejects.toThrow(/private address/u);
	});
	it("pinnedFetch refuses a mixed answer when any address is private", async () => {
		const lookup = (_host: string, _options: unknown, callback: (...args: unknown[]) => void) => callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]);
		await expect(pinnedFetch("https://mixed.example.org/", {}, { lookup })).rejects.toThrow(/private address/u);
	});
	it("stops reading at the file limit when Content-Length is absent", async () => {
		let pulled = 0;
		const chunk = new Uint8Array(1024 * 1024).fill(7);
		const page = Buffer.from('<html><head><meta property="og:image" content="/big.png"></head></html>');
		const fetchImpl = async (url: string) => {
			if (url.endsWith("/big.png")) {
				const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; if (pulled > 40) controller.close(); else controller.enqueue(chunk); } });
				return new Response(body, { status: 200 });
			}
			return new Response(new Uint8Array(page), { status: 200, headers: { "content-length": String(page.length) } });
		};
		await fetchAssets({ out: temp("motion-assets-cap-"), url: "https://widget.example.org/", fetchImpl, lookup: publicHost }).catch(() => undefined);
		expect(pulled, "chunks pulled after the 4 MB cap").toBeLessThanOrEqual(6);
	});
	it("stops reading at the file limit when Content-Length understates the body", async () => {
		let pulled = 0;
		const chunk = new Uint8Array(1024 * 1024).fill(7);
		const page = Buffer.from('<html><head><meta property="og:image" content="/liar.png"></head></html>');
		const fetchImpl = async (url: string) => {
			if (url.endsWith("/liar.png")) {
				const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; if (pulled > 40) controller.close(); else controller.enqueue(chunk); } });
				return new Response(body, { status: 200, headers: { "content-length": "10" } });
			}
			return new Response(new Uint8Array(page), { status: 200, headers: { "content-length": String(page.length) } });
		};
		await fetchAssets({ out: temp("motion-assets-liar-"), url: "https://widget.example.org/", fetchImpl, lookup: publicHost }).catch(() => undefined);
		expect(pulled, "chunks pulled after the 4 MB cap").toBeLessThanOrEqual(6);
	});
});

describe("fetchAssets: a linked product's real assets, as untrusted data", () => {
	it("writes a repository's logo, README image and words under stage/assets with a sha256 list", async () => {
		const out = temp("motion-assets-");
		const { fetchImpl } = stub(github());
		const result = await fetchAssets({ out, url: REPO, fetchImpl, lookup: publicHost, now: () => new Date("2026-10-25T00:00:00Z") });
		expect(result.code).toBe(EXIT.OK);
		expect(readdirSync(join(out, "stage", "assets")).sort()).toEqual(["01-logo.png", "02-icon.png"]);
		const record = JSON.parse(readFileSync(join(out, "product.json"), "utf8"));
		expect(record.product).toMatchObject({ name: "widget", url: REPO });
		expect(record.product.assets).toEqual([
			{ path: "stage/assets/01-logo.png", role: "logo", source: "fetched", sha256: sha256(png(10)) },
			{ path: "stage/assets/02-icon.png", role: "icon", source: "fetched", sha256: sha256(png(200)) },
		]);
		expect(record.fetchedAt).toBe("2026-10-25T00:00:00.000Z");
		const words = JSON.parse(readFileSync(join(out, "product", "words.json"), "utf8"));
		expect(words.note).toMatch(/never instructions/u);
		expect(words.description).toBe("A widget for work.");
		expect(readFileSync(join(out, "product", "README.md"), "utf8")).toContain("# widget");
		expect(result.message).toContain("data, not instructions");
	});
	it("--cover puts the files under cover/assets, where the cover page loads them", async () => {
		const out = temp("motion-assets-cover-");
		const { fetchImpl } = stub(github());
		await fetchAssets({ out, url: REPO, cover: true, fetchImpl, lookup: publicHost });
		expect(existsSync(join(out, "cover", "assets", "01-logo.png"))).toBe(true);
		expect(existsSync(join(out, "stage"))).toBe(false);
		expect(JSON.parse(readFileSync(join(out, "product.json"), "utf8")).product.assets.every((a: { path: string }) => a.path.startsWith("cover/assets/"))).toBe(true);
	});
	it("reads a product page's og:image and icon when the link is not a repository", async () => {
		const out = temp("motion-assets-page-");
		const { fetchImpl } = stub({
			"https://widget.example.org/": { body: '<title>Widget | Tools</title><meta property="og:image" content="/og.png"><meta name="description" content="Make widgets.">' },
			"https://widget.example.org/og.png": { body: png(77) },
		});
		const result = await fetchAssets({ out, url: "https://widget.example.org/", fetchImpl, lookup: publicHost });
		expect(result.product.name).toBe("Widget");
		expect(result.product.assets).toHaveLength(1);
	});
	it("skips an SVG with script, a non-image, an oversize file and a redirect off the allow-list, and keeps the rest", async () => {
		const out = temp("motion-assets-hostile-");
		const readme = ["![a](a.svg)", "![b](b.png)", "![c](c.png)", "![d](d.png)", "![e](docs/logo.png)"].join("\n");
		const table = github(
			{
				"https://raw.githubusercontent.com/acme/widget/HEAD/a.svg": { body: '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("//evil")</script></svg>' },
				"https://raw.githubusercontent.com/acme/widget/HEAD/b.png": { body: "<html>login</html>" },
				"https://raw.githubusercontent.com/acme/widget/HEAD/c.png": { status: 302, headers: { location: "https://evil.example.net/steal.png" } },
				"https://raw.githubusercontent.com/acme/widget/HEAD/d.png": { body: png(5), headers: { "content-length": String(ASSET_LIMITS.fileBytes + 1) } },
			},
			readme,
		);
		const { fetchImpl, seen } = stub(table);
		const result = await fetchAssets({ out, url: REPO, fetchImpl, lookup: publicHost });
		expect(result.product.assets.map((a: { path: string }) => a.path)).toEqual(["stage/assets/01-logo.png", "stage/assets/02-icon.png"]);
		expect(seen).not.toContain("https://evil.example.net/steal.png");
		const skipped = JSON.parse(readFileSync(join(out, "product.json"), "utf8")).problems.join("\n");
		expect(skipped).toMatch(/script or outside links/u);
		expect(skipped).toMatch(/not an image/u);
		expect(skipped).toMatch(/outside the product's hosts/u);
		expect(skipped).toMatch(/limit/u);
	});
	it("never fetches a host that resolves privately", async () => {
		const out = temp("motion-assets-private-");
		const readme = "![x](https://internal.example.org/x.png)\n![logo](docs/logo.png)";
		const { fetchImpl, seen } = stub(github({ "https://internal.example.org/x.png": { body: png(3) } }, readme));
		const lookup = async (host: string) => [{ address: host === "internal.example.org" ? "192.168.1.5" : "93.184.216.34" }];
		const result = await fetchAssets({ out, url: REPO, fetchImpl, lookup });
		expect(seen).not.toContain("https://internal.example.org/x.png");
		expect(result.product.assets).toHaveLength(2);
	});
	it("with nothing reachable it writes the unreachable record and exits 22 BLOCKED_ASSET_MISSING", async () => {
		const out = temp("motion-assets-none-");
		const { fetchImpl } = stub({});
		await expect(fetchAssets({ out, url: "https://widget.example.org/", fetchImpl, lookup: publicHost })).rejects.toMatchObject({ code: EXIT.BLOCKED_ASSET_MISSING, message: expect.stringContaining("never draw an invented product screen") });
		const record = JSON.parse(readFileSync(join(out, "product.json"), "utf8"));
		expect(record.product.unreachable).toMatch(/404/u);
		expect(record.product.assets).toBeUndefined();
	});
	it("refuses a link that is not https before any request", async () => {
		const { fetchImpl, seen } = stub({});
		await expect(fetchAssets({ out: temp("motion-assets-http-"), url: "http://widget.example.org/", fetchImpl, lookup: publicHost })).rejects.toMatchObject({ code: EXIT.USAGE });
		await expect(fetchAssets({ out: temp("motion-assets-bad-"), url: "not a link", fetchImpl, lookup: publicHost })).rejects.toMatchObject({ code: EXIT.USAGE });
		expect(seen).toEqual([]);
	});
});

describe("ASSET-USED and the product files check", () => {
	const product = (assets: Array<{ path: string; role: string; source: string; sha256: string }>) => ({ product: { name: "widget", url: REPO, assets } });
	const asset = { path: "stage/assets/01-logo.png", role: "logo", source: "fetched", sha256: sha256(png(10)) };
	const filesOf = (page: string) => {
		const dir = temp("motion-asset-used-");
		writeFileSync(join(dir, "index.html"), page);
		mkdirSync(join(dir, "assets"));
		writeFileSync(join(dir, "assets", "01-logo.png"), png(10));
		return [
			{ rel: "index.html", path: join(dir, "index.html") },
			{ rel: join("assets", "01-logo.png"), path: join(dir, "assets", "01-logo.png") },
		];
	};
	it("is absent without a product or without listed assets", () => {
		expect(assetUsed({}, filesOf("x"))).toBeNull();
		expect(assetUsed(product([]), filesOf("x"))).toBeNull();
	});
	it("passes when the page names a listed file and fails, naming the files, when it names none", () => {
		const pass = assetUsed(product([asset]), filesOf('<img src="assets/01-logo.png">'));
		expect(pass).toMatchObject({ id: "ASSET-USED", status: "PASS" });
		const fail = assetUsed(product([asset]), filesOf('<svg><circle r="4"/></svg>'));
		expect(fail).toMatchObject({ id: "ASSET-USED", status: "FAIL" });
		expect(fail?.detail).toContain("01-logo.png");
	});
	it("checkProductFiles: unreachable and missing are exit 22, a changed file is exit 17, intact files pass", () => {
		const out = temp("motion-product-files-");
		mkdirSync(join(out, "stage", "assets"), { recursive: true });
		expect(() => checkProductFiles(out, {})).not.toThrow();
		expect(() => checkProductFiles(out, { product: { name: "widget", url: REPO, unreachable: "404" } })).toThrow(/BLOCKED_ASSET_MISSING/u);
		const missing = () => checkProductFiles(out, product([asset]));
		expect(missing).toThrow(expect.objectContaining({ code: EXIT.BLOCKED_ASSET_MISSING }));
		writeFileSync(join(out, ...asset.path.split("/")), png(10));
		expect(missing).not.toThrow();
		writeFileSync(join(out, ...asset.path.split("/")), png(11));
		expect(missing).toThrow(expect.objectContaining({ code: EXIT.STAGE_CONTRACT_ERROR }));
	});
	it("normUrl and requestUrls compare a link as written in a request", () => {
		expect(normUrl("HTTPS://GitHub.com/Acme/Widget.git/.")).toBe("https://github.com/acme/widget");
		expect(requestUrls("make a cover for https://github.com/acme/widget, please (see https://widget.example.org/).")).toEqual(["https://github.com/acme/widget", "https://widget.example.org"]);
		expect(requestUrls("no link here")).toEqual([]);
	});
});

describe("a cover that names a product", () => {
	const base = (extra: Record<string, unknown>) => ({
		mode: "cover",
		request: "A cover for https://github.com/acme/widget with its logo.",
		idea: "A case opens beside a still name.",
		recipe: "hero-3d",
		recipeReason: "One object acting once per loop.",
		hero: "A rounded case with a lit core.",
		beat: "The lid opens and closes.",
		brandWord: "WIDGET",
		aspect: "2:1",
		loopSec: 8,
		fps: 20,
		layers: { slow: "The case turns once.", mid: "The camera breathes.", beat: "The lid opens." },
		system: { rule: "One turn rule.", copies: "One case.", offset: "None." },
		title: { box: [0.05, 0.36, 0.43, 0.14], kind: "live" },
		ambition: "The case reads as a product.",
		...extra,
	});
	it("must set product when the request links one, and the url must be that link", () => {
		expect(() => validateCoverTreatment(base({}))).toThrow(/render.mjs assets .* --cover/u);
		expect(() => validateCoverTreatment(base({ product: { name: "widget", url: "https://github.com/other/thing" } }))).toThrow(/must be the link the request gives/u);
		expect(validateCoverTreatment(base({ product: { name: "widget", url: "https://github.com/Acme/Widget.git" } }))).toMatchObject({ recipe: "hero-3d" });
		expect(() => validateCoverTreatment(base({ product: { url: REPO } }))).toThrow(/product\.name/u);
	});
});

describe("the assets and blender switches through the real argv path", () => {
	it("--cover and --preview are switches: they never swallow the next option", () => {
		const a = parseArgs(["assets", "--cover", "--out", "/o", "--url", REPO]);
		expect([a.flags.has("cover"), a.out, a.url, a.cover]).toEqual([true, "/o", REPO, undefined]);
		const b = parseArgs(["assets", "--out", "/o", "--url", REPO, "--cover"]);
		expect([b.flags.has("cover"), b.out, b.url]).toEqual([true, "/o", REPO]);
		const c = parseArgs(["blender", "--preview", "--out", "/o"]);
		expect([c.flags.has("preview"), c.flags.has("final"), c.out]).toEqual([true, false, "/o"]);
		const d = parseArgs(["blender", "--out", "/o", "--final"]);
		expect([d.flags.has("final"), d.out]).toEqual([true, "/o"]);
		expect(parseArgs(["assets", "--out", "/o", "--url", REPO]).flags.has("cover")).toBe(false);
	});
	const run = (args: string[]) => {
		const result = spawnSync(process.execPath, [RENDER, ...args], { encoding: "utf8" });
		return { code: result.status, text: `${result.stdout}${result.stderr}` };
	};
	it("assets needs --out and --url, wherever --cover sits, and fetches https links only", () => {
		const out = temp("motion-cli-assets-");
		for (const args of [["assets", "--cover", "--out", out], ["assets", "--out", out, "--cover"], ["assets", "--url", REPO, "--cover"]]) {
			const r = run(args);
			expect(r.code, args.join(" ")).toBe(EXIT.USAGE);
			expect(r.text).toContain("assets needs --out <dir> --url <link>");
		}
		const insecure = run(["assets", "--cover", "--out", out, "--url", "http://widget.example.org/"]);
		expect(insecure.code).toBe(EXIT.USAGE);
		expect(insecure.text).toContain("https links only");
		expect(existsSync(join(out, "product.json"))).toBe(false);
	});
	it("main returns the usage code for the same cases without a child process", async () => {
		const out = temp("motion-main-assets-");
		expect(await main(["assets", "--cover", "--out", out, "--url", "ftp://widget.example.org/"])).toBe(EXIT.USAGE);
		expect(await main(["blender", "--preview", "--final", "--out", out])).toBe(EXIT.USAGE);
	});
	it("blender refuses --preview with --final, and a film that is not render3d blender, before any render", () => {
		const out = temp("motion-cli-blender-");
		const both = run(["blender", "--preview", "--final", "--out", out]);
		expect(both.code).toBe(EXIT.USAGE);
		expect(both.text).toContain("--preview or --final, not both");
		const none = run(["blender", "--out", out]);
		expect(none.code).not.toBe(EXIT.OK);
	});
	it("usage lists both new modes", () => {
		const r = run(["--help"]);
		expect(r.text).toContain("render.mjs assets --out <dir> --url <link> [--cover]");
		expect(r.text).toContain("render.mjs blender --out <dir> [--preview | --final]");
	});
});
