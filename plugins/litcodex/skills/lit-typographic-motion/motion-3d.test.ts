import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { BLENDER, blenderArgs, blenderCommand, cyclesSeed, findBlender, plateFrameCount, readPlate } from "./engine/blender.mjs";
import { CHROME_KEYCHAIN_FLAGS, EXIT, STAGE_ORIGIN } from "./engine/constants.mjs";
import { validateCoverTreatment } from "./engine/cover-treatment.mjs";
import { encodePng } from "./engine/image.mjs";
import { chromeLadder, coverFlags, findChrome, resolveRuntime, stageFlags } from "./engine/runtime.mjs";
import { capture, closeStage, fontRoutes, openStage, scanStage, stageRouter, stageRung, stepFrame } from "./engine/stage.mjs";
import { coverTreatment, stageTreatment } from "./fixtures/treatments.mjs";

// The 3D route (references/depth.md): the pinned three.js, the GPU rung and its fallback, the Blender
// plate, and the hero-3d cover. The static contract runs everywhere; the Chrome test skips with its
// reason printed when Chrome, the pre-warmed cache or a GPU rung is absent.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
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
const tinyPng = () => encodePng(2, 2, Buffer.alloc(16, 128));

describe("the vendored three.js r170", () => {
	const notices = readFileSync(join(skillRoot, "engine", "THIRD_PARTY_NOTICES"), "utf8");
	const files = ["three.module.js", "addons/environments/RoomEnvironment.js", "addons/geometries/RoundedBoxGeometry.js", "LICENSE"];
	for (const name of files) {
		it(`${name} matches the sha256 recorded in THIRD_PARTY_NOTICES`, () => {
			const line = notices.split("\n").find((l) => l.trim().startsWith(name));
			expect(line, `${name} is listed in THIRD_PARTY_NOTICES`).toBeTruthy();
			const recorded = /\b[0-9a-f]{64}\b/u.exec(line ?? "")?.[0];
			expect(sha256(readFileSync(join(skillRoot, "engine", "vendor", "three", name)))).toBe(recorded);
		});
	}
	it("ships the library unminified, with its MIT licence, and states the version and the source", () => {
		const lib = readFileSync(join(skillRoot, "engine", "vendor", "three", "three.module.js"), "utf8");
		expect(lib.split("\n").length).toBeGreaterThan(10000);
		expect(lib).toContain("const REVISION = '170'");
		expect(readFileSync(join(skillRoot, "engine", "vendor", "three", "LICENSE"), "utf8")).toContain("Permission is hereby granted");
		expect(notices).toContain("three@0.170.0");
		expect(notices).toMatch(/Tarball sha256 [0-9a-f]{64}/u);
	});
	it("keeps the addons' bare `three` import, which the page's import map resolves", () => {
		for (const addon of ["addons/environments/RoomEnvironment.js", "addons/geometries/RoundedBoxGeometry.js"]) expect(readFileSync(join(skillRoot, "engine", "vendor", "three", addon), "utf8")).toMatch(/from 'three'/u);
	});
});

describe("the stage router serves /lit/three/ and refuses everything else under it", () => {
	const fonts = { css: "", routes: new Map() };
	const run = async (path: string, extra: Record<string, unknown> = {}) => {
		const root = temp("motion-3d-router-");
		const record = { blocked: [] as string[], rejected: [] as string[], missing: [] as string[] };
		const reply: { status?: number; body?: Buffer | string; contentType?: string } = {};
		const route = {
			request: () => ({ url: () => `${STAGE_ORIGIN}${path}` }),
			fulfill: async (r: typeof reply) => Object.assign(reply, r),
			abort: async () => {},
		};
		await stageRouter({ root, fonts, record, ...extra })(route);
		return { reply, record };
	};
	it("answers the library and both addons with JavaScript", async () => {
		for (const sub of ["three.module.js", "addons/environments/RoomEnvironment.js", "addons/geometries/RoundedBoxGeometry.js"]) {
			const { reply, record } = await run(`/lit/three/${sub}`);
			expect(reply.status, sub).toBe(200);
			expect(reply.contentType).toContain("javascript");
			expect(Buffer.from(reply.body ?? "").length).toBeGreaterThan(1000);
			expect(record.missing).toEqual([]);
		}
	});
	it("records a missing file, a traversal and a non-script as missing, never as served", async () => {
		for (const path of ["/lit/three/nothing.js", "/lit/three/..%2fstage-kit.js", "/lit/three/addons%2f..%2f..%2floop-kit.js", "/lit/three/LICENSE", "/lit/three/addons/"]) {
			const { reply, record } = await run(path);
			expect(reply.status, path).not.toBe(200);
			expect(record.missing.length + record.rejected.length, path).toBeGreaterThan(0);
		}
	});
	it("serves /lit/style.css and /lit/style.js only when the film has a house style", async () => {
		const style = { css: ":root{--lit:1}", js: "window.STYLE=1;" };
		const withStyle = await run("/lit/style.css", { style });
		expect(withStyle.reply.status).toBe(200);
		expect(String(withStyle.reply.body)).toBe(style.css);
		expect(String((await run("/lit/style.js", { style })).reply.body)).toBe(style.js);
		const without = await run("/lit/style.css");
		expect(without.reply.status).toBe(404);
		expect(without.record.missing).toEqual(["/lit/style.css"]);
	});
});

describe("launch flags per rung", () => {
	it("the GPU rung is the platform's angle backend with page raster kept off the GPU", () => {
		for (const platform of ["darwin", "linux", "win32"]) {
			const gpu = stageFlags(1920, 1080, platform, "gpu");
			const [gpuLadder, softLadder] = chromeLadder(platform);
			expect(gpu.some((f) => f.startsWith("--use-angle=") && f !== "--use-angle=swiftshader"), platform).toBe(true);
			expect(gpu).not.toContain("--use-angle=swiftshader");
			expect(gpu).not.toContain("--enable-gpu-rasterization");
			expect(gpu).toEqual(expect.arrayContaining(["--disable-gpu-rasterization", "--disable-partial-raster", "--window-size=1920,1080", ...CHROME_KEYCHAIN_FLAGS]));
			for (const flag of gpuLadder.filter((f) => f !== "--enable-gpu-rasterization")) expect(gpu).toContain(flag);
			const soft = stageFlags(1920, 1080, platform, "software");
			expect(soft).toContain("--use-angle=swiftshader");
			for (const flag of softLadder) expect(soft).toContain(flag);
		}
	});
	it("defaults to the software rung, takes an options object and refuses an unknown rung", () => {
		expect(stageFlags(1920, 1080)).toEqual(stageFlags(1920, 1080, process.platform, "software"));
		expect(stageFlags({ width: 1080, height: 1920, platform: "darwin", rung: "gpu" })).toEqual(stageFlags(1080, 1920, "darwin", "gpu"));
		expect(() => stageFlags(1920, 1080, "darwin", "metal")).toThrow(/rung is gpu or software/u);
	});
	it("a cover passes its rung through and keeps the 2x scale and the CPU raster", () => {
		const gpu = coverFlags(1200, 600, 2, "darwin", "gpu");
		expect(gpu).toContain("--force-device-scale-factor=2");
		expect(gpu).toContain("--disable-gpu-rasterization");
		expect(gpu).not.toContain("--use-angle=swiftshader");
		expect(coverFlags(1200, 600, 2, "darwin")).toContain("--use-angle=swiftshader");
	});
});

describe("stageRung and the plate scan", () => {
	const stageOf = (frames: number, listed = frames) => {
		const dir = temp("motion-3d-plate-");
		const stage = join(dir, "stage");
		mkdirSync(join(stage, "plate"), { recursive: true });
		writeFileSync(join(stage, "index.html"), "<!doctype html><title>x</title>");
		const names = Array.from({ length: frames }, (_, i) => `${String(i + 1).padStart(6, "0")}.png`);
		for (const n of names) writeFileSync(join(stage, "plate", n), tinyPng());
		const bytes = tinyPng().length;
		writeFileSync(join(stage, "plate", "plate.json"), JSON.stringify({ kind: "final", blender: "4.5.0", device: "METAL", samples: 160, frames: names.slice(0, listed).map((name) => ({ name, bytes })) }));
		return { dir, stage };
	};
	it("asks for the GPU rung for a three.js world and the software rung for a flat film", () => {
		expect(stageRung({ depth: "3d", render3d: "three" }, { plate: null }, "/o")).toBe("gpu");
		expect(stageRung({ depth: "3d" }, { plate: null }, "/o")).toBe("gpu");
		expect(stageRung({ depth: "2d" }, { plate: null }, "/o")).toBe("software");
		expect(stageRung({}, { plate: null }, "/o")).toBe("software");
	});
	it("a Blender film needs its whole plate and then runs on the software rung", () => {
		const treatment = { depth: "3d", render3d: "blender", durationSec: 4 };
		expect(() => stageRung(treatment, { plate: null }, "/o")).toThrow(/plate\.json is missing/u);
		try {
			stageRung(treatment, { plate: { frames: new Array(30).fill({}) } }, "/o");
			throw new Error("should have thrown");
		} catch (error) {
			expect((error as { code: number }).code).toBe(EXIT.STAGE_CONTRACT_ERROR);
			expect((error as Error).message).toContain("30 frames");
			expect((error as Error).message).toContain("needs 120");
		}
		expect(stageRung(treatment, { plate: { frames: new Array(120).fill({}) } }, "/o")).toBe("software");
	});
	it("frames the plate lists are not page rasters, so 120 same-size frames are no flipbook", () => {
		const { stage } = stageOf(120);
		const scan = scanStage(stage);
		expect(scan.plate?.frames).toHaveLength(120);
		expect(scan.rasters).toEqual([]);
	});
	it("a frame the receipt does not list still counts as a raster and trips the flipbook limit", () => {
		const { stage } = stageOf(120, 100);
		expect(() => scanStage(stage)).toThrow(/flipbook|raster images/u);
	});
	it("a plate whose frame is missing or changed is no plate", () => {
		const { stage } = stageOf(3);
		expect(readPlate(stage)?.frames).toHaveLength(3);
		writeFileSync(join(stage, "plate", "000002.png"), Buffer.concat([tinyPng(), Buffer.from("x")]));
		expect(readPlate(stage)).toBeNull();
		rmSync(join(stage, "plate", "plate.json"));
		expect(readPlate(stage)).toBeNull();
	});
	it("allows scene.py at the stage root and refuses other file types", () => {
		const { stage } = stageOf(1);
		writeFileSync(join(stage, "scene.py"), "lit.camera((0, -5, 2), (0, 0, 0.5), 50)\n");
		expect(() => scanStage(stage)).not.toThrow();
		writeFileSync(join(stage, "extra.py"), "x = 1\n");
		expect(() => scanStage(stage)).toThrow(/not an allowed stage asset/u);
	});
});

describe("findBlender: found, never assumed", () => {
	const none = () => false;
	it("takes LITCODEX_BLENDER only when it exists and does not fall through when it does not", () => {
		expect(findBlender({ env: { LITCODEX_BLENDER: "/x/blender" }, exists: (p: string) => p === "/x/blender", platform: "linux" })).toEqual({ path: "/x/blender", source: "LITCODEX_BLENDER" });
		expect(findBlender({ env: { LITCODEX_BLENDER: "/x/blender", PATH: "/bin" }, exists: (p: string) => p === "/bin/blender", platform: "linux" })).toBeNull();
	});
	it("then the macOS app, then blender on PATH, then nothing", () => {
		expect(findBlender({ env: { PATH: "" }, exists: (p: string) => p === BLENDER.macApp, platform: "darwin" })).toEqual({ path: BLENDER.macApp, source: "app" });
		expect(findBlender({ env: { PATH: "/a:/b" }, exists: (p: string) => p === join("/b", "blender"), platform: "linux" })).toEqual({ path: join("/b", "blender"), source: "PATH" });
		expect(findBlender({ env: { PATH: "/a:/b" }, exists: (p: string) => p === BLENDER.macApp, platform: "linux" })).toBeNull();
		expect(findBlender({ env: { PATH: "/a" }, exists: none, platform: "darwin" })).toBeNull();
	});
});

describe("the Blender command line", () => {
	const treatment = { ...stageTreatment({ durationSec: 4 }), render3d: "blender", seed: 5, depth: "3d" };
	it("derives the Cycles seed below 2^31 from the treatment seed or from the request and idea", () => {
		expect(cyclesSeed({ seed: 5 })).toBe(5);
		expect(cyclesSeed({ seed: 2 ** 31 + 7 })).toBe(7);
		expect(cyclesSeed({ seed: 4294967295 })).toBe(2147483647);
		const derived = cyclesSeed({ request: "a", idea: "b" });
		expect(derived).toBeLessThan(2 ** 31);
		expect(derived).toBe(cyclesSeed({ request: "a", idea: "b" }));
		expect(derived).not.toBe(cyclesSeed({ request: "a", idea: "c" }));
	});
	it("renders a half-size, 40-sample preview at the beat midpoints", () => {
		const args = blenderArgs({ treatment, scene: "/s/scene.py", out: "/s/plate-preview", quality: "preview" });
		expect(args.slice(0, 4)).toEqual(["-b", "--factory-startup", "-P", BLENDER.runner]);
		const at = (flag: string) => args[args.indexOf(flag) + 1];
		expect(args[4]).toBe("--");
		expect([at("--width"), at("--height"), at("--percent"), at("--samples"), at("--device"), at("--fps"), at("--seed")]).toEqual(["1920", "1080", "50", "40", "METAL", "30", "5"]);
		expect(at("--stills")).toBe("0.667,2,3.333");
		expect(args).not.toContain("--frames");
	});
	it("renders the final plate at full size and 160 samples, one frame per 1/30 s", () => {
		const args = blenderArgs({ treatment, scene: "/s/scene.py", out: "/s/plate", quality: "final" });
		const at = (flag: string) => args[args.indexOf(flag) + 1];
		expect([at("--percent"), at("--samples"), at("--frames")]).toEqual(["100", "160", "1-120"]);
		expect(plateFrameCount(treatment)).toBe(120);
		expect(args).not.toContain("--stills");
		expect(() => blenderArgs({ treatment, scene: "s", out: "o", quality: "draft" as never })).toThrow(/preview or final/u);
	});
	it("the runner exists, compiles as Python and never reads the clock or random numbers into a frame", () => {
		const runner = readFileSync(BLENDER.runner, "utf8");
		expect(runner).toContain("scene.cycles.seed = a.seed");
		expect(runner).toContain("use_denoising");
		expect(runner).toContain("receipt.json");
		expect(runner).not.toMatch(/\brandom\b|time\.time|datetime/u);
	});
});

describe("blenderCommand with a fake blender", () => {
	const treatment = { ...stageTreatment({ durationSec: 1 }), render3d: "blender", seed: 9, depth: "3d" };
	/** An executable that logs its argv and writes what the real runner writes: PNGs and receipt.json. */
	const fake = (mode: "ok" | "fail" = "ok") => {
		const dir = temp("motion-3d-fake-");
		const script = join(dir, "blender");
		const png = tinyPng().toString("base64");
		writeFileSync(
			script,
			`#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const at = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
fs.writeFileSync(path.join(${JSON.stringify(dir)}, "argv.json"), JSON.stringify(args));
if (${JSON.stringify(mode)} === "fail") { console.error("Error: Python: scene.py line 3"); process.exit(1); }
const out = at("--out");
const names = at("--stills") ? at("--stills").split(",").map((_, i) => "still-" + String(i + 1).padStart(2, "0") + ".png") : Array.from({ length: Number(at("--frames").split("-")[1]) }, (_, i) => String(i + 1).padStart(6, "0") + ".png");
for (const n of names) fs.writeFileSync(path.join(out, n), Buffer.from(${JSON.stringify(png)}, "base64"));
fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ blender: "4.5.0", engine: "CYCLES", device: "METAL", samples: Number(at("--samples")), percent: Number(at("--percent")), files: names }));
`,
		);
		chmodSync(script, 0o755);
		return { script, argv: () => JSON.parse(readFileSync(join(dir, "argv.json"), "utf8")) as string[] };
	};
	const project = (scene = true) => {
		const out = temp("motion-3d-out-");
		mkdirSync(join(out, "stage"), { recursive: true });
		if (scene) writeFileSync(join(out, "stage", "scene.py"), "lit.camera((0, -5, 2), (0, 0, 0.5), 50)\n");
		return out;
	};
	it("renders the preview stills into stage/plate-preview/ with a plate.json that names the device and samples", async () => {
		const f = fake();
		const out = project();
		const result = await blenderCommand({ out, treatment, env: { LITCODEX_BLENDER: f.script } });
		expect(result.code).toBe(EXIT.OK);
		expect(result.message).toMatch(/^BLENDER preview: 3 stills/u);
		expect(f.argv()).toEqual(blenderArgs({ treatment, scene: join(out, "stage", "scene.py"), out: join(out, "stage", "plate-preview"), quality: "preview" }));
		const plate = JSON.parse(readFileSync(join(out, "stage", "plate-preview", "plate.json"), "utf8"));
		expect(plate).toMatchObject({ kind: "preview", device: "METAL", samples: 40, percent: 50, fps: 30 });
		expect(plate.frames.map((x: { name: string }) => x.name)).toEqual(["still-01.png", "still-02.png", "still-03.png"]);
	});
	it("renders the final plate as 000001.png ... and the stage scan then accepts it as a plate", async () => {
		const f = fake();
		const out = project();
		const result = await blenderCommand({ out, treatment, final: true, env: { LITCODEX_BLENDER: f.script } });
		expect(result.message).toMatch(/^BLENDER plate: 30 frames at 30 fps/u);
		expect(f.argv()[f.argv().indexOf("--frames") + 1]).toBe("1-30");
		writeFileSync(join(out, "stage", "index.html"), "<!doctype html><title>x</title>");
		const scan = scanStage(join(out, "stage"));
		expect(scan.plate?.frames).toHaveLength(30);
		expect(stageRung(treatment, scan, out)).toBe("software");
	});
	it("with no Blender it renders nothing, exits 0 and tells the director to fall back to three on the GPU rung", async () => {
		const out = project();
		const result = await blenderCommand({ out, treatment, env: { PATH: "/nonexistent-dir", LITCODEX_BLENDER: join(out, "missing") } });
		expect(result.code).toBe(EXIT.OK);
		expect(result.fallback).toBe(true);
		expect(result.message).toMatch(/^FALLBACK: no Blender found/u);
		expect(result.message).toContain('render3d to "three"');
		expect(existsSync(join(out, "stage", "plate"))).toBe(false);
	});
	it("refuses a film that is not render3d blender, and a missing scene, with the contract exits", async () => {
		const f = fake();
		await expect(blenderCommand({ out: project(), treatment: { ...treatment, render3d: "three" }, env: { LITCODEX_BLENDER: f.script } })).rejects.toMatchObject({ code: EXIT.USAGE });
		await expect(blenderCommand({ out: project(false), treatment, env: { LITCODEX_BLENDER: f.script } })).rejects.toMatchObject({ code: EXIT.STAGE_CONTRACT_ERROR });
	});
	it("a Blender run that fails ends as STAGE_CONTRACT_ERROR with the last lines of its output", async () => {
		const f = fake("fail");
		await expect(blenderCommand({ out: project(), treatment, env: { LITCODEX_BLENDER: f.script } })).rejects.toMatchObject({ code: EXIT.STAGE_CONTRACT_ERROR, message: expect.stringContaining("scene.py line 3") });
	});
});

describe("the hero-3d cover", () => {
	const hero = coverTreatment({ recipe: "hero-3d", recipeReason: "One object acting once per loop.", hero: "A rounded case with a hinged lid.", beat: "The lid opens and closes.", fps: 20 });
	it("is the first recipe and needs its hero and its beat", () => {
		expect(validateCoverTreatment(hero)).toMatchObject({ recipe: "hero-3d", frames: 120 });
		for (const key of ["hero", "beat"]) {
			const { [key]: _gone, ...rest } = hero as Record<string, unknown>;
			expect(() => validateCoverTreatment(rest)).toThrow(new RegExp(key, "u"));
		}
	});
	it("ships a page that builds its world on /lit/three/ through an import map and answers the cover protocol", () => {
		const page = readFileSync(join(skillRoot, "recipes", "hero-3d", "index.html"), "utf8");
		expect(page).toContain('"three": "/lit/three/three.module.js"');
		expect(page).toContain('"three/addons/": "/lit/three/addons/"');
		expect(page).toContain("window.renderFrame");
		expect(page).toContain("window.ready = true");
		expect(page).toContain("shadow.bias");
		expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org)/u);
		expect(page).not.toMatch(/Math\.random|Date\.now|performance\.now/u);
	});
	it("pins a gate row measured with the 3D settings and a treatment that validates", () => {
		const doc = JSON.parse(readFileSync(join(skillRoot, "recipes", "hero-3d", "expected.json"), "utf8"));
		expect(doc.settings).toMatchObject({ fps: 20, encode: { q: 94, edgeQ: 97, edgeFrames: 15 } });
		expect(doc.note).toMatch(/^(?:Measured|TODO\(render proof\))/u);
		expect(doc.row.seamLocal).toBeGreaterThan(0.25);
		expect(doc.row.seamLocal).toBeLessThan(2);
		expect(validateCoverTreatment(doc.treatment)).toMatchObject({ recipe: "hero-3d" });
	});
});

describe("references/depth.md", () => {
	const depth = readFileSync(join(skillRoot, "references", "depth.md"), "utf8");
	it("is dense and covers the route end to end", () => {
		expect(depth.split(/\s+/u).length).toBeGreaterThan(1400);
		for (const heading of ["## When 3D, and which kind", "## What the renderer gives you", "## The scaffold's world", "## Craft and the gate", "## Camera moves and the flash audit", "## The Blender rung"]) expect(depth, heading).toContain(heading);
		for (const term of ["/lit/three/", "GPU rung", "software rung", "findBlender", "LITCODEX_BLENDER", "LitStage.plate", "plate.json", "render3d", "MO-C-02", "MO-C-03", "exit 18", "One plate per film", "ASSET-USED", "slow the light change"]) expect(depth, term).toContain(term);
	});
	it("is reachable from the cover reference and names no sibling product", () => {
		const cover = readFileSync(join(skillRoot, "references", "cover.md"), "utf8");
		expect(cover).toContain("references/depth.md");
		expect(cover).toContain("hero-3d");
		expect(depth).not.toMatch(/CLAUDE_PLUGIN_ROOT|\.litclaude|Claude Code|LitClaude|claude -p/u);
	});
});

// The acceptance for the GPU rung: a fresh browser on the same rung reproduces a three.js frame byte
// for byte. Labelled skip when Chrome, the pre-warmed cache or a hardware WebGL2 rung is missing.
describe("GPU rung replay", { timeout: 300000 }, () => {
	const page = `<!doctype html><html><head><meta charset="utf-8"><script src="/lit/stage-kit.js"></script>
<script type="importmap">{ "imports": { "three": "/lit/three/three.module.js", "three/addons/": "/lit/three/addons/" } }</script>
<style>html,body{margin:0;background:#101820}canvas{position:absolute;left:0;top:0}</style></head><body><canvas id="w" width="320" height="180"></canvas>
<script>window.draw = null; LitStage.define({ width: 320, height: 180, fps: 30, duration: 2, render(t) { if (window.draw) window.draw(t); } });</script>
<script type="module">
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("w"), antialias: true, preserveDrawingBuffer: true });
renderer.setSize(320, 180, false);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
const cam = new THREE.PerspectiveCamera(35, 320 / 180, 0.1, 50);
cam.position.set(2.6, 1.8, 3.4);
cam.lookAt(0, 0.2, 0);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-2, 4, 3);
scene.add(key, new THREE.AmbientLight(0x6688aa, 0.6));
const box = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.8, 1, 5, 0.1), new THREE.MeshStandardMaterial({ color: 0xe0d9c8, roughness: 0.4 }));
scene.add(box);
window.draw = (t) => { box.rotation.y = t * Math.PI; renderer.render(scene, cam); };
window.draw(0);
</script></body></html>`;
	it("is byte-identical across two fresh browsers on one rung, or skips with the reason", async (context) => {
		if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache");
		const env = { ...process.env, XDG_CACHE_HOME: join(FIXTURES, "xdg") };
		if (!findChrome(env)) return context.skip("Chrome not installed on this host");
		const runtime = resolveRuntime(env);
		const dir = temp("motion-3d-gpu-");
		const stageDir = join(dir, "stage");
		mkdirSync(stageDir, { recursive: true });
		writeFileSync(join(stageDir, "index.html"), page);
		const scan = scanStage(stageDir);
		const fonts = fontRoutes(runtime.dir);
		const shoot = async (frame: number) => {
			const session = await openStage({ runtime, outDir: dir, scan, fonts, width: 320, height: 180, fps: 30, seed: 1, rung: "gpu" });
			try {
				await stepFrame(session, frame, true);
				return { png: await capture(session, 320, 180), renderer: session.gpuRenderer as string };
			} finally {
				await closeStage(session);
			}
		};
		let first: Awaited<ReturnType<typeof shoot>>;
		try {
			first = await shoot(12);
		} catch (error) {
			return context.skip(`the GPU rung is not available on this host: ${String((error as Error).message).split("\n")[0]}`);
		}
		const second = await shoot(12);
		const other = await shoot(40);
		expect(first.renderer).toBeTruthy();
		expect(first.png.equals(second.png)).toBe(true);
		expect(first.png.equals(other.png)).toBe(false);
		expect(pathToFileURL(runtime.dir).href).toBeTruthy();
	});
});
