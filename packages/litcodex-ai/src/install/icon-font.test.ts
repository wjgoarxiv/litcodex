// `install --round`: what it adds, what it refuses, and what uninstall takes away. No test touches the network.
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	addIconFont,
	ICON_FONT,
	type IconFontDeps,
	type IconFontPins,
	iconFontPlanLine,
	removeIconFont,
} from "./icon-font.js";

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A zip of these entries, every other one deflated, read by its central directory alone. */
function zip(entries: Readonly<Record<string, Buffer>>): Buffer {
	const parts: Buffer[] = [];
	const directory: Buffer[] = [];
	let offset = 0;
	Object.entries(entries).forEach(([name, bytes], index) => {
		const method = index % 2 === 0 ? 8 : 0;
		const data = method === 8 ? deflateRawSync(bytes) : bytes;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(name.length, 26);
		const head = Buffer.alloc(46);
		head.writeUInt32LE(0x02014b50, 0);
		head.writeUInt16LE(method, 10);
		head.writeUInt32LE(data.length, 20);
		head.writeUInt32LE(bytes.length, 24);
		head.writeUInt16LE(name.length, 28);
		head.writeUInt32LE(offset, 42);
		parts.push(local, Buffer.from(name), data);
		directory.push(head, Buffer.from(name));
		offset += 30 + name.length + data.length;
	});
	const listing = Buffer.concat(directory);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(listing.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, listing, end]);
}

const FONT = Buffer.from("the font, over and over. ".repeat(50));
const LICENSE = Buffer.from("MIT");
const ARCHIVE = zip({ "SymbolsNerdFontMono-Regular.ttf": FONT, "README.md": Buffer.from("x"), LICENSE });
const PINS: IconFontPins = {
	...ICON_FONT,
	archiveSha256: sha(ARCHIVE),
	files: ICON_FONT.files.map((file) => ({ ...file, sha256: sha(file.font ? FONT : LICENSE) })),
};

function setup(over: Partial<IconFontDeps> = {}, archive = ARCHIVE) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-icon-font-")));
	roots.push(root);
	const home = join(root, "home");
	const codexHome = join(home, ".codex");
	mkdirSync(codexHome, { recursive: true });
	const source = join(root, "archive.zip");
	writeFileSync(source, archive);
	const spawned: (readonly string[])[] = [];
	const deps: IconFontDeps = {
		env: { HOME: home, LITCODEX_ICON_FONT_SOURCE: source },
		platform: "linux",
		codexHome,
		pins: PINS,
		spawn: (command, args) => {
			spawned.push([command, ...args]);
			return { status: 0 };
		},
		// The system folders of the machine that runs the tests are not part of them.
		hasIconFont: (dir) => existsSync(dir) && readdirSync(dir).some((name) => /Nerd.*\.ttf$/u.test(name)),
		...over,
	};
	const dir = join(home, ".local", "share", "fonts");
	const font = join(dir, "SymbolsNerdFontMono-Regular.ttf");
	const license = join(dir, "SymbolsNerdFontMono-LICENSE.txt");
	const manifest = join(codexHome, "litcodex", "icon-font.json");
	return { root, home, codexHome, source, deps, dir, font, license, manifest, spawned };
}

describe("the pins", () => {
	it("name one official release, small enough to hold in memory", () => {
		expect(ICON_FONT.url).toBe(
			"https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip",
		);
		expect(ICON_FONT.archiveMaxBytes).toBe(8 * 1024 * 1024);
		expect(ICON_FONT.archiveSha256).toBe("fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc");
		expect(ICON_FONT.files.map(({ name, sha256 }) => [name, sha256])).toEqual([
			["SymbolsNerdFontMono-Regular.ttf", "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749"],
			["SymbolsNerdFontMono-LICENSE.txt", "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847"],
		]);
	});
});

describe("adding the font", () => {
	it("writes the font and its licence, records both and refreshes the font cache", async () => {
		const { deps, dir, font, license, manifest, spawned } = setup();
		const result = await addIconFont(deps);
		expect(result).toMatchObject({ status: "added" });
		expect(result.line).toBe(`ICON_FONT: added SymbolsNerdFontMono-Regular.ttf to ${dir}`);
		expect(readFileSync(font)).toEqual(FONT);
		expect(readFileSync(license)).toEqual(LICENSE);
		expect(JSON.parse(readFileSync(manifest, "utf8")).files).toEqual([
			{ path: font, sha256: sha(FONT) },
			{ path: license, sha256: sha(LICENSE) },
		]);
		expect(spawned).toEqual([["fc-cache", "-f", dir]]);
		expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	it("goes to the per-user folder of each platform", async () => {
		const mac = setup({ platform: "darwin" });
		await addIconFont(mac.deps);
		expect(existsSync(join(mac.home, "Library", "Fonts", "SymbolsNerdFontMono-Regular.ttf"))).toBe(true);
		expect(mac.spawned).toEqual([]);
		const xdg = setup();
		const data = join(xdg.root, "data");
		await addIconFont({ ...xdg.deps, env: { ...xdg.deps.env, XDG_DATA_HOME: data } });
		expect(existsSync(join(data, "fonts", "SymbolsNerdFontMono-Regular.ttf"))).toBe(true);
		const relative = setup();
		await addIconFont({ ...relative.deps, env: { ...relative.deps.env, XDG_DATA_HOME: "data" } });
		expect(existsSync(relative.font)).toBe(true);
	});

	it("adds nothing on Windows or where an icon font is already here", async () => {
		const windows = setup({ platform: "win32" });
		expect(await addIconFont(windows.deps)).toMatchObject({ status: "unsupported" });
		const here = setup();
		mkdirSync(here.dir, { recursive: true });
		writeFileSync(join(here.dir, "MyNerdFont-Regular.ttf"), "");
		const result = await addIconFont(here.deps);
		expect(result).toMatchObject({ status: "present" });
		expect(result.line).toContain("nothing added");
		expect(readdirSync(here.dir)).toEqual(["MyNerdFont-Regular.ttf"]);
		expect(existsSync(here.manifest)).toBe(false);
	});

	it("leaves another licence file alone and still adds the font", async () => {
		const { deps, dir, font, license, manifest } = setup();
		mkdirSync(dir, { recursive: true });
		writeFileSync(license, "mine");
		expect(await addIconFont(deps)).toMatchObject({ status: "added" });
		expect(readFileSync(license, "utf8")).toBe("mine");
		expect(JSON.parse(readFileSync(manifest, "utf8")).files).toEqual([{ path: font, sha256: sha(FONT) }]);
	});

	it("keeps a font recorded by an earlier run in another folder", async () => {
		const { deps, root, font, manifest } = setup();
		const data = join(root, "data");
		await addIconFont({ ...deps, env: { ...deps.env, XDG_DATA_HOME: data } });
		await addIconFont(deps);
		const paths = JSON.parse(readFileSync(manifest, "utf8")).files.map((file: { path: string }) => file.path);
		expect(paths).toContain(font);
		expect(paths).toContain(join(data, "fonts", "SymbolsNerdFontMono-Regular.ttf"));
	});

	it("survives a font cache that cannot be refreshed", async () => {
		const { deps } = setup({
			spawn: () => {
				throw new Error("no fc-cache");
			},
		});
		expect(await addIconFont(deps)).toMatchObject({ status: "added" });
	});
});

describe("what it refuses, with the install going on", () => {
	const refused = async (over: Partial<IconFontDeps>, why: RegExp, archive = ARCHIVE): Promise<void> => {
		const at = setup(over, archive);
		const result = await addIconFont(at.deps);
		expect(result.status).toBe("failed");
		expect(result.why).toMatch(why);
		expect(result.line).toBe(`ICON_FONT: not added (${result.why})`);
		expect(result.line).not.toContain("\n");
		expect(existsSync(at.font)).toBe(false);
		expect(existsSync(at.manifest)).toBe(false);
	};

	it("a changed archive, a changed file and no zip", async () => {
		await refused({ pins: ICON_FONT }, /SHA-256/u);
		const files = PINS.files.map((file) => ({ ...file, sha256: sha(Buffer.from("other")) }));
		await refused({ pins: { ...PINS, files } }, /SHA-256/u);
		const text = Buffer.from("no zip at all, only words that go on for a while");
		await refused({ pins: { ...PINS, archiveSha256: sha(text) } }, /zip/u, text);
		const lacking = zip({ LICENSE });
		await refused({ pins: { ...PINS, archiveSha256: sha(lacking) } }, /has no/u, lacking);
	});

	it("an archive over the cap, from a file and from the network", async () => {
		await refused({ pins: { ...PINS, archiveMaxBytes: 10 } }, /larger/u);
		const body = async function* (): AsyncGenerator<Uint8Array> {
			for (;;) yield new Uint8Array(1024 * 1024);
		};
		const fetchImpl = (async () => ({ ok: true, headers: new Headers(), body: body() })) as unknown as typeof fetch;
		const at = setup();
		const env = { HOME: at.home };
		const result = await addIconFont({ ...at.deps, env, fetchImpl });
		expect(result).toMatchObject({ status: "failed", why: "the download is larger than 8 MiB" });
	});

	it("a linked folder, its parent or the file's place, also when it appears during the download", async () => {
		const fonts = setup();
		const elsewhere = join(fonts.root, "elsewhere");
		mkdirSync(elsewhere);
		mkdirSync(join(fonts.home, ".local", "share"), { recursive: true });
		symlinkSync(elsewhere, fonts.dir);
		expect((await addIconFont(fonts.deps)).why).toMatch(/is a link/u);

		const parent = setup();
		const target = join(parent.root, "elsewhere");
		mkdirSync(target);
		symlinkSync(target, join(parent.home, ".local"));
		expect((await addIconFont(parent.deps)).why).toMatch(/is a link/u);
		expect(readdirSync(target)).toEqual([]);

		const file = setup();
		mkdirSync(file.dir, { recursive: true });
		symlinkSync(join(file.root, "nowhere.ttf"), file.font);
		expect((await addIconFont({ ...file.deps, hasIconFont: () => false })).why).toMatch(/already there/u);
		expect(lstatSync(file.font).isSymbolicLink()).toBe(true);

		const late = setup();
		const lateTarget = join(late.root, "elsewhere");
		mkdirSync(lateTarget);
		const fetchImpl = (async () => {
			mkdirSync(join(late.home, ".local", "share"), { recursive: true });
			symlinkSync(lateTarget, late.dir);
			return new Response(new Uint8Array(ARCHIVE));
		}) as unknown as typeof fetch;
		const result = await addIconFont({ ...late.deps, env: { HOME: late.home }, fetchImpl });
		expect(result.why).toMatch(/is a link/u);
		expect(readdirSync(lateTarget)).toEqual([]);
	});

	it("a linked folder anywhere above an XDG_DATA_HOME outside the home folder", async () => {
		for (const parts of [["link"], ["link", "share"], ["link", "a", "b", "share"]]) {
			const at = setup();
			const target = join(at.root, "elsewhere");
			mkdirSync(join(target, ...parts.slice(1)), { recursive: true });
			symlinkSync(target, join(at.root, "link"));
			const env = { ...at.deps.env, XDG_DATA_HOME: join(at.root, ...parts) };
			const result = await addIconFont({ ...at.deps, env, hasIconFont: () => false });
			expect(result, parts.join("/")).toMatchObject({ status: "failed", why: `${join(at.root, "link")} is a link` });
			expect(readdirSync(join(target, ...parts.slice(1)))).toEqual([]);
		}
	});

	it.skipIf(process.platform !== "darwin")("but goes through the links the system itself has", async () => {
		// /var and /tmp are links on every Mac; tmpdir() stands under the first.
		for (const base of [tmpdir(), "/tmp"]) {
			const at = setup();
			const data = join(mkdtempSync(join(base, "litcodex-icon-font-link-")), "share");
			roots.push(join(data, ".."));
			expect(realpathSync(base)).not.toBe(base);
			const env = { ...at.deps.env, XDG_DATA_HOME: data };
			expect(await addIconFont({ ...at.deps, env })).toMatchObject({ status: "added" });
			expect(existsSync(join(data, "fonts", "SymbolsNerdFontMono-Regular.ttf"))).toBe(true);
			expect(removeIconFont({ ...at.deps, env })).toContain(data);
		}
	});

	it("a record it cannot keep, with the font taken back", async () => {
		const at = setup();
		mkdirSync(at.manifest, { recursive: true });
		expect((await addIconFont(at.deps)).status).toBe("failed");
		expect(existsSync(at.font)).toBe(false);

		const late = setup();
		const fetchImpl = (async () => {
			mkdirSync(join(late.codexHome, "litcodex"), { recursive: true });
			symlinkSync(join(late.root, "x"), late.manifest);
			return new Response(new Uint8Array(ARCHIVE));
		}) as unknown as typeof fetch;
		const result = await addIconFont({ ...late.deps, env: { HOME: late.home }, fetchImpl });
		expect(result.status).toBe("failed");
		expect(existsSync(late.font)).toBe(false);
		expect(existsSync(late.license)).toBe(false);
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"a folder it may not write to, with no file left behind",
		async () => {
			const at = setup();
			mkdirSync(at.dir, { recursive: true });
			chmodSync(at.dir, 0o555);
			const result = await addIconFont(at.deps);
			chmodSync(at.dir, 0o755);
			expect(result).toMatchObject({ status: "failed" });
			expect(readdirSync(at.dir)).toEqual([]);
		},
	);

	it("a network that says no", async () => {
		const at = setup();
		const env = { HOME: at.home };
		const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
		expect((await addIconFont({ ...at.deps, env, fetchImpl: missing })).why).toBe("the download answered HTTP 404");
		const offline = (async () => {
			throw new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "ENOTFOUND" }) });
		}) as unknown as typeof fetch;
		expect((await addIconFont({ ...at.deps, env, fetchImpl: offline })).why).toBe(
			"the download failed (fetch failed, ENOTFOUND)",
		);
	});
});

describe("the 60 second limit", () => {
	it("is on the signal the download gets", async () => {
		const at = setup();
		const made: { ms: number; signal: AbortSignal }[] = [];
		const timeout = AbortSignal.timeout.bind(AbortSignal);
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			const signal = timeout(ms);
			made.push({ ms, signal });
			return signal;
		});
		let given: AbortSignal | null | undefined;
		const fetchImpl = (async (_url: string, init: RequestInit) => {
			given = init.signal;
			return new Response(new Uint8Array(ARCHIVE));
		}) as unknown as typeof fetch;
		await addIconFont({ ...at.deps, env: { HOME: at.home }, fetchImpl });
		expect(made.map(({ ms }) => ms)).toEqual([60_000]);
		expect(given).toBe(made[0]?.signal);
	});

	it("ends a download that stops halfway", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/zip" });
			response.write("only the first bytes");
		});
		await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
		const { port } = server.address() as AddressInfo;
		const at = setup();
		const pins = { ...PINS, url: `http://127.0.0.1:${port}/font.zip` };
		const result = await addIconFont({ ...at.deps, env: { HOME: at.home }, pins, limitMs: 200 });
		server.closeAllConnections();
		await new Promise((closed) => server.close(closed));
		expect(result).toMatchObject({ status: "failed", why: "the download took longer than 60 seconds" });
		expect(existsSync(at.font)).toBe(false);
	});
});

describe("the dry run line", () => {
	it("names the file and the folder and writes nothing", () => {
		const at = setup();
		const add = `Would add the icon font SymbolsNerdFontMono-Regular.ttf to ${at.dir}`;
		const env = { HOME: at.home };
		expect(iconFontPlanLine({ ...at.deps, env })).toBe(`${add} (downloaded from ${PINS.url})`);
		expect(iconFontPlanLine(at.deps)).toBe(`${add} (taken from ${at.source})`);
		expect(existsSync(at.dir)).toBe(false);
		expect(iconFontPlanLine(setup({ platform: "win32" }).deps)).toContain("Windows");
		expect(iconFontPlanLine(setup({ hasIconFont: () => true }).deps)).toContain("already here");
	});
});

describe("uninstall", () => {
	it("removes what it wrote and says what other products may then draw", async () => {
		const at = setup();
		await addIconFont(at.deps);
		const line = removeIconFont(at.deps);
		expect(line).toContain(at.font);
		expect(line).toMatch(/other products .*square ends/u);
		expect(existsSync(at.font)).toBe(false);
		expect(existsSync(at.license)).toBe(false);
		expect(existsSync(at.manifest)).toBe(false);
		expect(removeIconFont(at.deps)).toBeNull();
	});

	it("keeps a file that changed, became a link or sits where LitCodex never writes", async () => {
		const at = setup();
		await addIconFont(at.deps);
		writeFileSync(at.license, "changed");
		const stray = join(at.home, "SymbolsNerdFontMono-Regular.ttf");
		writeFileSync(stray, FONT);
		const other = join(at.dir, "other.ttf");
		writeFileSync(other, FONT);
		const record = JSON.parse(readFileSync(at.manifest, "utf8"));
		for (const path of [stray, other, `${at.dir}/../fonts/SymbolsNerdFontMono-Regular.ttf`])
			record.files.push({ path, sha256: sha(FONT) });
		record.files.push(null, 7, { path: 1 }, { path: "fonts/SymbolsNerdFontMono-Regular.ttf", sha256: sha(FONT) });
		writeFileSync(at.manifest, JSON.stringify(record));
		removeIconFont(at.deps);
		expect(existsSync(at.font)).toBe(false);
		expect(readFileSync(at.license, "utf8")).toBe("changed");
		expect(existsSync(stray)).toBe(true);
		expect(existsSync(other)).toBe(true);
	});

	it("goes through no linked folder and never throws", async () => {
		const at = setup();
		await addIconFont(at.deps);
		const elsewhere = join(at.root, "elsewhere");
		mkdirSync(elsewhere);
		writeFileSync(join(elsewhere, "SymbolsNerdFontMono-Regular.ttf"), FONT);
		rmSync(at.dir, { recursive: true });
		symlinkSync(elsewhere, at.dir);
		expect(() => removeIconFont(at.deps)).not.toThrow();
		expect(existsSync(join(elsewhere, "SymbolsNerdFontMono-Regular.ttf"))).toBe(true);

		for (const text of ["not json", "[]", '{"files":{}}', '{"files":"x"}']) {
			const odd = setup();
			mkdirSync(join(odd.codexHome, "litcodex"));
			writeFileSync(odd.manifest, text);
			expect(() => removeIconFont(odd.deps)).not.toThrow();
		}
		const folder = setup();
		mkdirSync(folder.manifest, { recursive: true });
		expect(removeIconFont(folder.deps)).toBeNull();
	});
});
