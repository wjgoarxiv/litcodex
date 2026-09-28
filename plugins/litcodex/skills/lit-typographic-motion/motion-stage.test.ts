import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { CHROME_KEYCHAIN_FLAGS, CHROME_STAGE_FLAGS, EXIT } from "./engine/constants.mjs";
import { decodePng, encodePng } from "./engine/image.mjs";
import { stageFlags } from "./engine/runtime.mjs";
import { fontRoutes, scanStage } from "./engine/stage.mjs";
import { framePlan } from "./engine/stage-render.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// The stage path on real Chrome (director brief 6a-6f). Renders skip, with the reason printed,
// when Chrome or a pre-warmed fixture cache is absent; the static contract tests always run.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const PAGES = join(skillRoot, "fixtures", "stage");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Treatment = ReturnType<typeof stageTreatment>;
function stageRun(page: string | Record<string, string | Buffer>, treatment: Treatment = stageTreatment()) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-stage-")));
	temps.push(dir);
	const out = join(dir, "out");
	mkdirSync(join(out, "stage"), { recursive: true });
	if (typeof page === "string") cpSync(join(PAGES, page), join(out, "stage"), { recursive: true });
	else for (const [name, body] of Object.entries(page)) writeFileSync(join(out, "stage", name), body);
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	return out;
}
const render = (out: string, extra: string[] = []) => spawnSync(process.execPath, [RENDER, "stage", "--out", out, ...extra], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") }, timeout: 600000 });
const ready = (context: { skip: (reason: string) => void }) => {
	if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), false;
	if (!CHROME) return context.skip("Chrome not installed on this host"), false;
	return true;
};
const pixel = (file: string, x: number, y: number): number[] => {
	const image = decodePng(readFileSync(file));
	const i = (y * image.width + x) * 4;
	return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
};
const page = (body: string, script = "LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4 });") => `<!doctype html><html><head><meta charset="utf-8"><script src="/lit/stage-kit.js"></script></head><body style="margin:0;background:#123">${body}<script>${script}</script></body></html>`;

describe("the kit (6b)", () => {
	const kit = readFileSync(join(skillRoot, "engine", "stage-kit.js"), "utf8");
	it("stays within 60 KB raw, unminified, with no imports", () => {
		expect(Buffer.byteLength(kit, "utf8")).toBeLessThanOrEqual(60 * 1024);
		expect(kit).not.toMatch(/^\s*import\s|require\(/mu);
		expect(kit.split("\n").length).toBeGreaterThan(200);
	});
	it("exposes every primitive the reference documents", () => {
		const doc = readFileSync(join(skillRoot, "references", "stage.md"), "utf8");
		for (const name of ["define", "text", "ease", "cubicBezier", "spring", "kf", "at", "stagger", "seq", "rand", "splitText", "drawPath", "morph", "clip", "maskSweep", "mix"]) {
			expect(kit).toMatch(new RegExp(`\\b${name}\\b`, "u"));
			expect(doc).toContain(`LitStage.${name}`);
		}
		expect(doc).toContain("Multi-subpath morphs are unsupported");
		expect(doc).toContain("COPY");
	});
});

describe("stage launch flags (6d)", () => {
	it("is the software rung plus every stage flag and both keychain flags, sized to the frame", () => {
		for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
			const flags = stageFlags(w, h);
			expect(flags).toEqual(expect.arrayContaining(["--use-angle=swiftshader", ...CHROME_STAGE_FLAGS, ...CHROME_KEYCHAIN_FLAGS, `--window-size=${w},${h}`]));
			expect(flags).not.toContain("--use-angle=metal");
			expect(flags.join(" ")).not.toMatch(/deterministic-mode|beginFrame/u);
		}
		for (const flag of ["--run-all-compositor-stages-before-draw", "--disable-checker-imaging", "--disable-new-content-rendering-timeout", "--disable-threaded-animation", "--disable-threaded-scrolling", "--disable-image-animation-resync", "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars", "--mute-audio", "--force-device-scale-factor=1", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--metrics-recording-only", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE lit.stage"]) expect(CHROME_STAGE_FLAGS).toContain(flag);
	});
	it("serves the product's faces with font-display: block", () => {
		const fonts = fontRoutes("/nonexistent-cache");
		expect(fonts.css).toContain('font-family: "Archivo"');
		expect(fonts.css).toContain('font-family: "PretendardGOV"');
		expect(fonts.css.match(/font-display: block/gu)?.length).toBe(fonts.routes.size);
	});
});

describe("static pre-flight scan (exits 17 and 19 before any browser)", () => {
	const scanOf = (files: Record<string, string | Buffer>) => {
		const out = stageRun(files);
		try {
			scanStage(join(out, "stage"));
			return null;
		} catch (error) {
			return error as { code: number; message: string };
		}
	};
	it("a forbidden element exits 17 naming it", () => {
		const error = scanOf({ "index.html": page('<video src="clip.mp4"></video>') });
		expect(error?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(error?.message).toContain("<video>");
	});
	it("a forbidden API exits 17 naming it", () => {
		const error = scanOf({ "index.html": page("", "const a = new AudioContext();") });
		expect(error?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(error?.message).toContain("AudioContext");
	});
	it("an external URL, a protocol-relative URL, a preconnect link and a WebSocket exit 19", () => {
		expect(scanOf({ "index.html": page('<img src="https://example.com/x.png">') })?.code).toBe(EXIT.STAGE_NETWORK_REQUEST);
		expect(scanOf({ "index.html": page('<img src="//cdn.example.com/x.png">') })?.code).toBe(EXIT.STAGE_NETWORK_REQUEST);
		expect(scanOf({ "index.html": page('<link rel="preconnect" href="/x">') })?.code).toBe(EXIT.STAGE_NETWORK_REQUEST);
		expect(scanOf({ "index.html": page("", "const s = new WebSocket('ws://127.0.0.1:1');") })?.code).toBe(EXIT.STAGE_NETWORK_REQUEST);
	});
	it("allows SVG namespace URIs", () => {
		expect(scanOf({ "index.html": page('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"></svg>') })).toBeNull();
	});
	it("a flipbook of 10 same-size rasters, an animated PNG, and a disallowed asset type exit 17", () => {
		const png = Buffer.from(encodePng(4, 4, new Uint8Array(64), 4, 1));
		const files: Record<string, string | Buffer> = { "index.html": page("") };
		for (let i = 0; i < 10; i++) files[`f${i}.png`] = png;
		expect(scanOf(files)?.message).toMatch(/flipbook/u);
		const apng = Buffer.concat([png.subarray(0, 33), Buffer.from([0, 0, 0, 8]), Buffer.from("acTL"), Buffer.alloc(8), Buffer.alloc(4), png.subarray(33)]);
		expect(scanOf({ "index.html": page(""), "a.png": apng })?.message).toMatch(/animated raster/u);
		expect(scanOf({ "index.html": page(""), "clip.mp4": "x" })?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
	});
	it("a symlink that leaves the stage folder is rejected", () => {
		const out = stageRun({ "index.html": page("") });
		symlinkSync(join(out, "treatment.json"), join(out, "stage", "leak.json"));
		expect(() => scanStage(join(out, "stage"))).toThrow(/leaves the stage folder/u);
	});
});

describe("frame plan (6f sample frames, 9 stills)", () => {
	it("samples 8 to 16 frames including 0, the last frame and every beat's first frame", () => {
		const t = stageTreatment({ durationSec: 20, beats: Array.from({ length: 10 }, (_, i) => [i * 2, i * 2 + 2]) });
		const plan = framePlan(t, 60, 1200);
		expect(plan.determinism.length).toBeGreaterThanOrEqual(8);
		expect(plan.determinism.length).toBeLessThanOrEqual(16);
		expect(plan.determinism).toContain(0);
		expect(plan.determinism).toContain(1199);
		const small = framePlan(stageTreatment(), 30, 120);
		expect(small.determinism.length).toBeGreaterThanOrEqual(8);
		for (const beat of small.beats) expect(small.determinism).toContain(beat.start);
		expect(small.cuts.map((c: { frames: number[] }) => c.frames)).toEqual([[34, 40, 46], [74, 80, 86]]);
		expect(small.sheet).toHaveLength(12);
	});
});

describe("stage capture on real Chrome", { timeout: 900000 }, () => {
	it("GREEN: a clock-only page renders, passes the gate and replays to the same pixels", (context) => {
		if (!ready(context)) return;
		const out = stageRun("clock");
		const result = render(out);
		expect(result.status, result.stderr).toBe(0);
		const report = readFileSync(join(out, "gate-report.txt"), "utf8");
		expect(report).toMatch(/MO-C-09 determinism:\s+PASS/u);
		expect(report).toMatch(/^QA gate: PASS/mu);
		const stills = JSON.parse(readFileSync(join(out, "stills", "manifest.json"), "utf8"));
		expect(stills.files.map((f: { kind: string }) => f.kind).sort()).toEqual(["beat", "beat", "beat", "poster", "sheet", "strip", "strip"]);
	});
	it("GREEN: blur, backdrop-filter, blend modes, shadows, feGaussianBlur, canvas shadowBlur and a WebGL shader stay deterministic", (context) => {
		if (!ready(context)) return;
		const out = stageRun("effects");
		const result = render(out);
		expect(result.status, result.stderr).toBe(0);
		const report = readFileSync(join(out, "gate-report.txt"), "utf8");
		expect(report).toMatch(/MO-C-09 determinism:\s+PASS/u);
		expect(report).toMatch(/MO-C-02 WebGL tier:\s+PASS/u);
	});
	it("RED: a page that paints performance.timeOrigin exits 18 naming the frame", (context) => {
		if (!ready(context)) return;
		const result = render(stageRun("red-timeorigin"));
		expect(result.status, result.stderr).toBe(EXIT.STAGE_NONDETERMINISTIC);
		expect(result.stderr).toMatch(/STAGE_NONDETERMINISTIC: frame \d+/u);
	});
	it("RED: a page that paints crypto.getRandomValues exits 18 naming the region", (context) => {
		if (!ready(context)) return;
		const result = render(stageRun("red-random"));
		expect(result.status, result.stderr).toBe(EXIT.STAGE_NONDETERMINISTIC);
		expect(result.stderr).toMatch(/region x \d+-\d+, y \d+-\d+/u);
	});
	it("a CSS transition started by a timer at 2 s shows 10 % of its colour at 2.1 s", (context) => {
		if (!ready(context)) return;
		const out = stageRun("transition", stageTreatment({ beats: [[0, 1.5], [1.5, 2.7], [2.7, 4]] }));
		const result = render(out, ["--stills-only"]);
		expect(result.status, result.stderr).toBe(0);
		const [r, g, b] = pixel(join(out, "stills", "beat-02.png"), 960, 540);
		for (const v of [r, g, b]) expect(Math.abs(v - 26)).toBeLessThanOrEqual(3);
		expect(pixel(join(out, "stills", "beat-01.png"), 960, 540)).toEqual([0, 0, 0]);
	});
	it("a WAAPI finished.then chain visibly continues", (context) => {
		if (!ready(context)) return;
		const out = stageRun("finished", stageTreatment({ beats: [[0, 1.4], [1.4, 2.6], [2.6, 4]] }));
		const result = render(out, ["--stills-only"]);
		expect(result.status, result.stderr).toBe(0);
		const green = (x: number) => {
			const [r, g, b] = pixel(join(out, "stills", "beat-02.png"), x, 540);
			return g > 150 && r < 130 && b < 130;
		};
		expect(green(760)).toBe(true);
		expect(green(260)).toBe(false);
	});
	it("a 1080x1920 kit film encodes at 1080x1920 with a portrait flash grid", (context) => {
		if (!ready(context)) return;
		const out = stageRun("portrait", stageTreatment({ format: "9:16", lines: ["Leaf to lantern"] }));
		const result = render(out);
		expect(result.status, result.stderr).toBe(0);
		const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(out, "film.mp4")], { encoding: "utf8" });
		expect(probe.stdout.trim()).toBe("1080,1920");
		expect(readFileSync(join(out, "gate-report.txt"), "utf8")).toContain("180x320 cells");
		expect(decodePng(readFileSync(join(out, "stills", "beat-01.png"))).height).toBe(1920);
	});
	it("runtime contract: an obfuscated AudioContext exits 17, a WebSocket or an external fetch exits 19, a traversal exits 17", (context) => {
		if (!ready(context)) return;
		expect(render(stageRun({ "index.html": page("", "try { new window['Audio' + 'Context'](); } catch {} LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4 });") }), ["--stills-only"]).status).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(render(stageRun({ "index.html": page("", "try { new window['Web' + 'Socket']('ws://127.0.0.1:9'); } catch {} LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4 });") }), ["--stills-only"]).status).toBe(EXIT.STAGE_NETWORK_REQUEST);
		expect(render(stageRun({ "index.html": page("", "fetch('http' + '://example.com/x').catch(() => {}); LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4 });") }), ["--stills-only"]).status).toBe(EXIT.STAGE_NETWORK_REQUEST);
		expect(render(stageRun({ "index.html": page("", "fetch('/..%2F..%2Ftreatment.json').catch(() => {}); LitStage.define({ width: 1920, height: 1080, fps: 30, duration: 4 });") }), ["--stills-only"]).status).toBe(EXIT.STAGE_CONTRACT_ERROR);
	});
	it("a page that declares the wrong frame size, or never defines the film, exits 17", (context) => {
		if (!ready(context)) return;
		const wrong = render(stageRun({ "index.html": page("", "LitStage.define({ width: 1280, height: 720, fps: 30, duration: 4 });") }), ["--stills-only"]);
		expect(wrong.status).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(wrong.stderr).toContain("exactly 1920x1080");
		expect(render(stageRun({ "index.html": page("", "") }), ["--stills-only"]).status).toBe(EXIT.STAGE_CONTRACT_ERROR);
	});
});
