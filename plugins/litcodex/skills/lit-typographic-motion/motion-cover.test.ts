import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import { COVER, EXIT } from "./engine/constants.mjs";
import { artCheck, checkAssets } from "./engine/cover-assets.mjs";
import { CoverPool, CoverSession, capturePass } from "./engine/cover-capture.mjs";
import { coverGate, formatCoverReport, gifTiming, glyphHeights, motionMetrics, resample } from "./engine/cover-gate.mjs";
import { lanczosResize, lumaGrid } from "./engine/cover-image.mjs";
import { encodeCover, frameAt, img2webpArgs, loopTimes, maxLevelDiff, seekOrder } from "./engine/cover.mjs";
import { validateCoverTreatment } from "./engine/cover-treatment.mjs";
import { decodePng, encodePng } from "./engine/image.mjs";
import { evaluateDone, recordLook } from "./engine/look.mjs";
import { coverEncoderProbe, coverFlags, renderStatus, resolveRuntime } from "./engine/runtime.mjs";
import { fontRoutes, scanStage } from "./engine/stage.mjs";
import { validateTreatment } from "./engine/treatment.mjs";
import { decodeWebp, findDwebp, findImg2webp, parseWebp } from "./engine/webp.mjs";
import { coverTreatment } from "./fixtures/treatments.mjs";

// Cover mode (references/cover.md): the cover treatment, the loop kit and init script, the decoded-file
// gate, the look rounds and done-check, the studio parts (timed defects and window re-renders, the
// asset list, the cap-height floor, the seek-order check, pinned recipe rows and shipped negatives).
// Renders run on real Chrome with a pre-warmed fixture cache and skip, with the reason, without them.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const PAGES = join(skillRoot, "fixtures", "cover");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const LIBWEBP = Boolean(findImg2webp() && findDwebp());
const XDG = join(FIXTURES ?? "/nonexistent", "xdg");
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix: string) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	temps.push(dir);
	return dir;
};
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const cli = (args: string[]) => spawnSync(process.execPath, [RENDER, ...args], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: XDG }, timeout: 900000 });
const ready = (context: { skip: (reason: string) => void }) => {
	if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), false;
	if (!CHROME) return context.skip("Chrome not installed on this host"), false;
	if (!LIBWEBP) return context.skip("img2webp and dwebp (libwebp) not on PATH"), false;
	return true;
};
function coverRun(page: string, treatment: Record<string, unknown> = coverTreatment()) {
	const out = join(temp("motion-cover-"), "out");
	mkdirSync(out, { recursive: true });
	cpSync(join(PAGES, page), join(out, "cover"), { recursive: true });
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	return out;
}

describe("cover treatment (exit 16 names the field)", () => {
	it("accepts a cover treatment and derives the page, cover size, frame count and encode", () => {
		const t = validateCoverTreatment(coverTreatment());
		expect(t.page).toEqual([1200, 600]);
		expect(t.size).toEqual([1000, 500]);
		expect(t.frames).toBe(96);
		expect(t.encode).toEqual(COVER.encode);
		expect(validateCoverTreatment(coverTreatment({ aspect: "3:2" })).size).toEqual([960, 640]);
	});
	it("refuses film fields, sound, an invented tagline, a restated idea and out-of-range loops", () => {
		const bad: Array<[Record<string, unknown>, string]> = [
			[{ beats: [] }, "beats"],
			[{ copy: { source: "invented", lines: ["x"] } }, "copy"],
			[{ sound: { mode: "generated" } }, "sound"],
			[{ loopSec: 5 }, "loopSec"],
			[{ loopSec: 13 }, "loopSec"],
			[{ fps: 60 }, "fps"],
			[{ aspect: "16:9" }, "aspect"],
			[{ motto: { text: "Ship it before lunch", source: "user" } }, "motto.text"],
			[{ motto: { text: "Ship it", source: "project" } }, "motto.from"],
			[{ idea: "An animated cover for the top of the LOOPTEST readme." }, "idea"],
			[{ recipe: "slides" }, "recipe"],
			[{ title: { box: [0.5, 0.5, 0.6, 0.2], kind: "live" } }, "title.box"],
			[{ title: { box: [0.1, 0.1, 0.2, 0.2], kind: "drawn" } }, "title.kind"],
			[{ layers: { slow: "Bars drift.", mid: "A dot laps." } }, "layers.beat"],
			[{ ambition: "<one or two sentences>" }, "ambition"],
		];
		for (const [extra, field] of bad) expect(() => validateCoverTreatment(coverTreatment(extra)), JSON.stringify(extra)).toThrow(expect.objectContaining({ field }));
		expect(validateCoverTreatment(coverTreatment({ motto: { text: "Keep it lit", source: "project", from: "README.md" } })).motto.text).toBe("Keep it lit");
	});
	it("a film render refuses a cover treatment and names the cover command", () => {
		expect(() => validateTreatment(coverTreatment())).toThrow(/mode: this is a cover treatment: render it with `render\.mjs cover/u);
	});
});

describe("the loop kit and the cover init script", () => {
	const kit = readFileSync(join(skillRoot, "engine", "loop-kit.js"), "utf8");
	const sandbox: { LitLoop?: Record<string, (...args: never[]) => unknown> & { ease: Record<string, (...args: number[]) => number> } } = {};
	vm.runInNewContext(kit, sandbox);
	const L = sandbox.LitLoop as unknown as Record<string, (...args: number[]) => number> & { makeNoise: (seed: number) => unknown; loopNoise: (noise: unknown, t: number, offset: number) => number; rng: (seed: number) => () => number };
	it("every helper closes the loop: loop noise at t = 1 equals t = 0, events wrap the seam", () => {
		const noise = L.makeNoise(5);
		for (const offset of [0, 1.7, 9.3]) expect(Math.abs(L.loopNoise(noise, 0, offset) - L.loopNoise(noise, 1, offset))).toBeLessThan(1e-9);
		expect(Math.abs(L.swell(0) - L.swell(1))).toBeLessThan(1e-12);
		expect(L.cdist(0.98, 0.02)).toBeCloseTo(0.04, 9);
		expect(L.window(0.05, 0.9, 0.2)).toBeCloseTo(0.75, 9);
		expect(L.window(0.5, 0.9, 0.2)).toBe(-1);
		expect(L.steps(0.5, 2)).toBe(0.5);
		expect(L.cubicPulse(0, 0.1, 0.2)).toBe(0);
		expect(L.cubicPulse(0.3, 0.1, 0.3)).toBe(1);
		const a = L.rng(42);
		const b = L.rng(42);
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
	});
	it("the kit itself reads no clock and no unseeded entropy", () => {
		expect(kit.replace(/^\s*(?:\/\/|\/\*\*|\*).*$/gmu, "")).not.toMatch(/Math\.random\(|Date\.now\(|performance\.now\(|requestAnimationFrame\(/u);
	});
	it("the init script makes every clock and entropy source throw and records each call by name", () => {
		const init = readFileSync(join(skillRoot, "engine", "cover-init.js"), "utf8");
		class Performance {
			now() {
				return 1;
			}
		}
		const ctx: Record<string, unknown> = { Math: Object.create(Math), Date, Performance, performance: new Performance(), crypto: { getRandomValues: () => 1 }, document: { documentElement: null, addEventListener() {} } };
		ctx.window = ctx;
		vm.runInNewContext(init, ctx);
		const w = ctx as { Math: Math; Date: DateConstructor; performance: { now: () => number }; requestAnimationFrame: (cb: () => void) => void; setInterval: () => void; crypto: { getRandomValues: () => void }; __litCoverCalls: () => string[] };
		const building = [w.Math.random(), w.Math.random(), w.Math.random()];
		expect(building.every((x) => x >= 0 && x < 1)).toBe(true);
		const twin = { Math: Object.create(Math), Date, Performance: class {}, performance: {}, crypto: {}, document: { documentElement: null, addEventListener() {} } } as Record<string, unknown>;
		twin.window = twin;
		vm.runInNewContext(init, twin);
		expect([(twin.Math as Math).random(), (twin.Math as Math).random(), (twin.Math as Math).random()]).toEqual(building);
		expect(Array.from(w.__litCoverCalls())).toEqual([]);
		ctx.ready = true;
		expect(() => w.Math.random()).toThrow(/Math\.random is not allowed/u);
		expect(() => w.Date.now()).toThrow(/Date\.now is not allowed/u);
		expect(() => new w.Date()).toThrow(/Date is not allowed/u);
		expect(new w.Date(0).getTime()).toBe(0);
		expect(() => w.performance.now()).toThrow(/performance\.now is not allowed/u);
		expect(() => w.requestAnimationFrame(() => {})).toThrow(/requestAnimationFrame is not allowed/u);
		expect(() => w.crypto.getRandomValues()).toThrow(/getRandomValues is not allowed/u);
		expect(Array.from(w.__litCoverCalls())).toEqual(["Math.random", "Date.now", "Date", "performance.now", "requestAnimationFrame", "crypto.getRandomValues"]);
	});
	it("serves the loop kit beside the stage kit, and covers capture at 2x on CPU raster with the keychain flags", () => {
		expect(readFileSync(join(skillRoot, "engine", "stage.mjs"), "utf8")).toContain('"/lit/loop-kit.js"');
		const flags = coverFlags(1200, 600, 2);
		expect(flags).toEqual(expect.arrayContaining(["--force-device-scale-factor=2", "--disable-gpu-rasterization", "--disable-partial-raster", "--use-mock-keychain", "--password-store=basic", "--use-angle=swiftshader"]));
		expect(flags).not.toContain("--force-device-scale-factor=1");
		expect(fontRoutes("/nonexistent-cache").css).toMatch(/font-family: "JetBrains Mono";\n\tsrc: url\("\/lit\/fonts\/jetbrains-mono\.woff2"\) format\("woff2"\);\n\tfont-weight: 100 800;/u);
	});
});

describe("cover gate metrics (a fixed time grid, the loop as a ring)", () => {
	const flat = (v: number, n = 16) => Float32Array.from({ length: n }, (_, i) => v + (i % 2));
	it("a still loop is all still: nothing moves and the longest still run is the whole loop", () => {
		const m = motionMetrics({ lumas: Array.from({ length: 96 }, () => flat(10)), delays: Array(96).fill(63) });
		expect(m.movingFrac).toBe(0);
		expect(m.longestStillSec).toBeCloseTo(96 * 0.063, 9);
	});
	it("a travelling wave moves on every step with a seam like its neighbours; a reset is a seam spike", () => {
		const wave = Array.from({ length: 96 }, (_, i) => Float32Array.from({ length: 16 }, (_, k) => 100 + 60 * Math.sin(2 * Math.PI * (i / 96 + k / 16))));
		const m = motionMetrics({ lumas: wave, delays: Array(96).fill(63) });
		expect(m.movingFrac).toBe(1);
		expect(m.seamLocal).toBeGreaterThan(0.5);
		expect(m.seamLocal).toBeLessThan(1.5);
		expect(motionMetrics({ lumas: Array.from({ length: 96 }, (_, i) => flat(i)), delays: Array(96).fill(63) }).seamLocal).toBeGreaterThan(50);
	});
	it("merged frames are resampled on the grid, so a long frame reads as a hold", () => {
		expect(resample(["a", "b", "c"], [100, 300, 100], 50)).toEqual(["a", "a", "b", "b", "b", "b", "b", "b", "c", "c"]);
		expect(motionMetrics({ lumas: [flat(0), flat(80), flat(160)], delays: [1000, 3000, 1000] }).longestStillSec).toBeGreaterThanOrEqual(2.9);
	});
	it("the GIF fallback reads per-frame delays and the loop count from the container", () => {
		const head = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.from([4, 0, 4, 0, 0, 0, 0])]);
		const loop = Buffer.concat([Buffer.from([0x21, 0xff, 0x0b]), Buffer.from("NETSCAPE2.0", "latin1"), Buffer.from([3, 1, 0, 0, 0])]);
		const frame = (cs: number) => Buffer.from([0x21, 0xf9, 4, 0, cs & 255, cs >> 8, 0, 0, 0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0x80, 0, 0, 0, 255, 255, 255, 2, 2, 0x4c, 0x01, 0]);
		expect(gifTiming(Buffer.concat([head, loop, frame(6), frame(7), Buffer.from([0x3b])]))).toEqual({ delays: [60, 70], loop: 0, width: 4, height: 4 });
	});
	it("the report names every gate and the strict verdict", () => {
		const text = formatCoverReport({ pass: true, target: false, width: 1000, height: 500, format: "webp", sourceFrames: 128, sourceDurationSec: 8.064, bytes: 2_400_000, loop: 0, stepMs: 63, gates: { G1: { pass: true, target: false, bytes: 2_400_000 }, G2: { pass: true, target: true, medianD: 0.002 }, G6: { pass: null, capPx: 30 } } }, { strict: true });
		expect(text).toMatch(/^COVER gate --strict: PASS\(floor\)$/mu);
		expect(text).toContain("G1 pass(floor) bytes=2400000");
		expect(text).toContain("G6 INFO capPx=30");
	});
	it("img2webp gets frame 0 and the last edge frames at the edge quality, 63 ms per frame at 16 fps, no keyframe flags", () => {
		const args = img2webpArgs({ files: ["a", "b", "c", "d"], fps: 16, encode: { q: 80, edgeQ: 97, edgeFrames: 1, method: 4 }, out: "o.webp" });
		expect(args.slice(0, 7)).toEqual(["-loop", "0", "-lossy", "-q", "80", "-m", "4"]);
		const perFrame: string[] = [];
		for (let i = 7; i < args.length - 2; i += 5) perFrame.push(args.slice(i, i + 5).join(" "));
		expect(perFrame).toEqual(["-d 63 -q 97 a", "-d 63 -q 80 b", "-d 63 -q 80 c", "-d 63 -q 97 d"]);
		expect(args.join(" ")).not.toMatch(/-kmin|-kmax|mp4/u);
		expect(loopTimes(4)).toEqual([[0, 0], [1, 0.25], [2, 0.5], [3, 0.75]]);
		expect(frameAt([63, 126, 63], 100)).toBe(1);
	});
	it("the 2x capture is downsampled with Lanczos and the luma grid is about 300 px wide", () => {
		const out = lanczosResize(Buffer.alloc(40 * 20 * 4, 255), 40, 20, 20, 10);
		expect(out.length).toBe(20 * 10 * 4);
		expect(out.every((v: number) => v === 255)).toBe(true);
		const grid = lumaGrid(Buffer.alloc(1000 * 500 * 4), 1000, 500);
		expect([grid.w, grid.h]).toEqual([333, 166]);
	});
});

describe("the decoded file (img2webp + dwebp)", () => {
	it("decodes every frame, its duration and the loop count, composited as a browser shows it", (context) => {
		if (!LIBWEBP) return context.skip("img2webp and dwebp (libwebp) not on PATH");
		const dir = temp("motion-webp-");
		const files = Array.from({ length: 6 }, (_, i) => {
			const rgb = Buffer.alloc(64 * 32 * 3, 20);
			for (let y = 8; y < 24; y++) for (let x = i * 8; x < i * 8 + 12; x++) rgb.fill(230, (y * 64 + x) * 3, (y * 64 + x) * 3 + 3);
			const file = join(dir, `f${i}.png`);
			writeFileSync(file, encodePng(64, 32, rgb, 3, 1));
			return file;
		});
		const out = join(dir, "c.webp");
		const run = spawnSync(findImg2webp(), img2webpArgs({ files, fps: 16, encode: { q: 90, edgeQ: 97, edgeFrames: 2, method: 4 }, out }), { encoding: "utf8" });
		expect(run.status, run.stderr).toBe(0);
		expect(parseWebp(readFileSync(out))).toMatchObject({ loop: 0, width: 64, height: 32 });
		const edges: number[] = [];
		const info = decodeWebp(out, {
			onFrame: (_i: number, rgba: Uint8Array) => {
				let left = -1;
				for (let x = 0; x < 64 && left < 0; x++) if (rgba[(16 * 64 + x) * 4] > 128) left = x;
				edges.push(left);
			},
		});
		expect(info.frames).toBe(6);
		expect(info.durations).toEqual(Array(6).fill(63));
		expect(edges).toEqual([0, 8, 16, 24, 32, 40]);
	});
	it("a cover between 2 and 3 MiB passes FLOOR and misses TARGET: --strict exits 13, plain cover-gate exits 0", (context) => {
		if (!LIBWEBP) return context.skip("img2webp and dwebp (libwebp) not on PATH");
		const dir = temp("motion-heavy-");
		let seed = 7;
		const files = Array.from({ length: 96 }, (_, i) => {
			const rgb = Buffer.alloc(320 * 160 * 3);
			for (let p = 0; p < rgb.length; p += 3) {
				seed = (seed * 1103515245 + 12345) >>> 0;
				rgb[p] = rgb[p + 1] = rgb[p + 2] = seed >>> 24;
			}
			const file = join(dir, `f${String(i).padStart(3, "0")}.png`);
			writeFileSync(file, encodePng(320, 160, rgb, 3, 1));
			return file;
		});
		let picked: string | null = null;
		for (const q of [30, 40, 50, 60, 70]) {
			const out = join(dir, `q${q}.webp`);
			spawnSync(findImg2webp(), img2webpArgs({ files, fps: 16, encode: { q, edgeQ: q, edgeFrames: 0, method: 0 }, out }));
			const bytes = readFileSync(out).length;
			if (bytes > COVER.targetBytes && bytes <= COVER.maxBytes) {
				picked = out;
				break;
			}
		}
		if (!picked) return context.skip("could not land a noise cover between 2 and 3 MiB on this libwebp");
		const r = coverGate(picked);
		expect(r.gates.G1).toMatchObject({ pass: true, target: false });
		expect([r.pass, r.target]).toEqual([true, false]);
		const strict = cli(["cover-gate", "--file", picked, "--strict"]);
		expect(strict.status, strict.stdout + strict.stderr).toBe(EXIT.GATE_FAIL_QA);
		expect(strict.stdout).toMatch(/G1 pass\(floor\)/u);
		expect(cli(["cover-gate", "--file", picked]).status).toBe(EXIT.OK);
	});
});

/** A finished cover run on disk, the way the renderer writes it, without Chrome. */
function fakeCoverRun({ verdict = "PASS+TARGET", round = 1 } = {}) {
	const out = join(temp("motion-cover-done-"), "out");
	mkdirSync(join(out, "stills"), { recursive: true });
	writeFileSync(join(out, "treatment.json"), `${JSON.stringify(coverTreatment(), null, 2)}\n`);
	const files = ["frame-00.png", "poster.png", "seam.png", "sheet.png"].map((file, i) => {
		const png = Buffer.from(encodePng(8, 4, new Uint8Array(8 * 4 * 4).fill(10 + i * 9), 4, 1));
		writeFileSync(join(out, "stills", file), png);
		return { file, sha256: sha(png), kind: file === "frame-00.png" ? "frame" : file.replace(".png", "") };
	});
	const text = `${JSON.stringify({ schema: 1, kind: "cover", mode: "cover", round, width: 1000, height: 500, fps: 16, durationSec: 6.048, files }, null, 2)}\n`;
	writeFileSync(join(out, "stills", "manifest.json"), text);
	writeFileSync(join(out, "gate-report.txt"), `COVER gate --strict: ${verdict}\n`);
	writeFileSync(join(out, "manifest.json"), JSON.stringify({ mode: "cover", path: "cover", round, stillsManifestSha256: sha(text), treatmentSha256: sha(readFileSync(join(out, "treatment.json"))) }));
	return out;
}
/** Move the fake run to `round` (as a new render would: a new stills manifest and a new manifest). */
function rerender(out: string, round: number) {
	const path = join(out, "stills", "manifest.json");
	const text = `${JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), round }, null, 2)}\n`;
	writeFileSync(path, text);
	writeFileSync(join(out, "manifest.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")), round, stillsManifestSha256: sha(text) }));
}
const coverAnswers = (extra: Record<string, unknown> = {}) => ({
	viewed: ["stills/sheet.png", "stills/poster.png", "stills/seam.png"],
	change: "Sharpen the light edge from 60 px to 24 px so the encoder keeps it.",
	answers: [1, 2, 3, 4, 5, 6, 7, 8].map((q) => ({ q, verdict: [6, 7, 8].includes(q) ? "no" : "yes", frame: q === 2 ? "seam.png" : "sheet.png", observed: `Question ${q}: the orange dot sits at a different angle in every tile of row ${q}.` })),
	...extra,
});
const answersFile = (out: string, doc: unknown) => {
	const file = join(out, "answers.json");
	writeFileSync(file, JSON.stringify(doc));
	return file;
};
const defect = (extra: Record<string, unknown> = {}) => ({ t: 1.2, region: [340, 10, 330, 50], frame: "stills/sheet.png", observed: "The glint turns the last painted letter into a solid red block on the second tile.", cause: "Colour-dodge blend saturates coloured letters.", fix: "Run the glint in overlay blend.", ...extra });

describe("cover look rounds and the cover done-check", () => {
	it("a cover round answers the eight cover questions, needs no stills-only round 1 and no weakest beat", () => {
		const out = fakeCoverRun();
		const entry = recordLook(out, 1, answersFile(out, coverAnswers()));
		expect(entry).toMatchObject({ mode: "cover", needsAnotherRound: false, defects: [] });
		const nine = coverAnswers();
		nine.answers.push({ q: 9, verdict: "yes", frame: "sheet.png", observed: "A ninth answer about the sheet that a cover round does not ask for." });
		expect(() => recordLook(fakeCoverRun(), 1, answersFile(out, nine))).toThrow(/unknown question 9 \(a cover round answers 8\)/u);
	});
	it("damage, a slide read, a missing seam or a named designer change asks for another round", () => {
		const out = fakeCoverRun();
		const doc = coverAnswers();
		doc.answers[1].verdict = "no";
		doc.answers[6].verdict = "yes";
		doc.answers[7].verdict = "yes";
		expect(recordLook(out, 1, answersFile(out, doc)).openItems.map((item: string) => item.split(":")[0])).toEqual(["Q2", "Q7", "Q8"]);
	});
	it("done needs PASS+TARGET on the last render and two rounds, the last viewing the sheet, poster and seam pair", () => {
		const out = fakeCoverRun();
		expect(evaluateDone(out).status).toBe("not complete");
		recordLook(out, 1, answersFile(out, coverAnswers()));
		expect(evaluateDone(out).reason).toMatch(/at least 2 look rounds/u);
		rerender(out, 2);
		recordLook(out, 2, answersFile(out, coverAnswers({ change: undefined })));
		expect(evaluateDone(out)).toMatchObject({ status: "complete", mode: "cover" });
		writeFileSync(join(out, "gate-report.txt"), "COVER gate --strict: PASS(floor)\n");
		expect(evaluateDone(out).reason).toMatch(/did not reach every TARGET gate/u);
	});
	it("a last round that skipped the seam pair, or looked at an older render, is not done", () => {
		const out = fakeCoverRun();
		recordLook(out, 1, answersFile(out, coverAnswers()));
		rerender(out, 2);
		recordLook(out, 2, answersFile(out, coverAnswers({ viewed: ["stills/sheet.png", "stills/poster.png"], answers: coverAnswers().answers.map((a) => ({ ...a, frame: "sheet.png" })) })));
		expect(evaluateDone(out).reason).toMatch(/did not view seam\.png/u);
		rerender(out, 3);
		expect(evaluateDone(out).reason).toMatch(/older stills set/u);
	});
	it("a treatment edited after the render is not done", () => {
		const out = fakeCoverRun();
		writeFileSync(join(out, "treatment.json"), JSON.stringify(coverTreatment({ loopSec: 8 })));
		expect(evaluateDone(out).reason).toMatch(/treatment\.json changed after the last cover render/u);
	});
});

describe("C001: cover defects carry a time, a region and a frame of the current stills", () => {
	it("records up to three well-formed defects with the round", () => {
		const out = fakeCoverRun();
		const entry = recordLook(out, 1, answersFile(out, coverAnswers({ defects: [defect()] })));
		expect(entry.defects).toEqual([{ t: 1.2, region: [340, 10, 330, 50], frame: "sheet.png", observed: defect().observed, cause: defect().cause, fix: defect().fix }]);
		expect(Object.keys(entry.frames)).toContain("sheet.png");
	});
	it("refuses a defect with no time, a time past the loop, a frame outside the stills, a region off the cover, a bare observation, or a fourth defect", () => {
		const bad: Array<[Record<string, unknown>, RegExp]> = [
			[{ t: undefined }, /defect 1: t must be the loop time in seconds \(0 to 6\.048\)/u],
			[{ t: 9 }, /defect 1: t must be the loop time/u],
			[{ frame: "stills/beat-01.png" }, /defect 1: frame "stills\/beat-01\.png" is not in the latest stills set/u],
			[{ region: [900, 400, 300, 200] }, /defect 1: region must be \[x, y, w, h\] in whole pixels inside the 1000x500 cover/u],
			[{ observed: "red" }, /defect 1: observed must be a sentence/u],
			[{ fix: "" }, /defect 1: cause and fix must each say something concrete/u],
		];
		for (const [extra, message] of bad) {
			const out = fakeCoverRun();
			expect(() => recordLook(out, 1, answersFile(out, coverAnswers({ defects: [defect(extra)] }))), JSON.stringify(extra)).toThrow(message);
		}
		const out = fakeCoverRun();
		expect(() => recordLook(out, 1, answersFile(out, coverAnswers({ defects: [defect(), defect({ t: 2 }), defect({ t: 3 }), defect({ t: 4 })] })))).toThrow(/at most 3 defects per round/u);
	});
});

/** A painted-light cover dir: the good page, a small textured painting, and assets.json as `assets` builds it. */
function paintedRun({ assets, writeArt = true, extra = null }: { assets?: (hash: string) => unknown; writeArt?: boolean; extra?: string | null }) {
	const out = coverRun("good", coverTreatment({ recipe: "painted-light", recipeReason: "The painting carries the picture; the page relights it.", title: { box: [0.35, 0.03, 0.31, 0.09], kind: "painted" } }));
	mkdirSync(join(out, "cover", "assets"), { recursive: true });
	const rgb = Buffer.alloc(96 * 64 * 3);
	for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) rgb.fill(((x * 7) ^ (y * 13)) & 255, (y * 96 + x) * 3, (y * 96 + x) * 3 + 3);
	const png = Buffer.from(encodePng(96, 64, rgb, 3, 6));
	if (writeArt) writeFileSync(join(out, "cover", "assets", "base.png"), png);
	if (extra) writeFileSync(join(out, "cover", "assets", extra), png);
	if (assets) writeFileSync(join(out, "assets.json"), JSON.stringify(assets(sha(png))));
	return out;
}
const listed = (hash: string) => ({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "user", sha256: hash, box: [0.125, 0, 0.75, 1] }] });

describe("C007-C009: cover assets come from a checked list", () => {
	it("C007: a listed asset that is missing is BLOCKED_ASSET_MISSING (exit 22) and no frame is captured", () => {
		const out = paintedRun({ assets: listed, writeArt: false });
		const r = cli(["cover", "--out", out, "--round", "1"]);
		expect(r.status, r.stdout + r.stderr).toBe(EXIT.BLOCKED_ASSET_MISSING);
		expect(r.stderr).toMatch(/BLOCKED_ASSET_MISSING: cover\/assets\/base\.png is listed in assets\.json and missing; supply it or generate it, never draw a stand-in/u);
		expect(existsSync(join(out, ".run", "cover"))).toBe(false);
		expect(existsSync(join(out, "cover.webp"))).toBe(false);
	});
	it("the painted recipe with no listed base art is blocked; an unlisted raster or a changed file stops the run (exit 17)", () => {
		const none = cli(["cover", "--out", paintedRun({}), "--round", "1"]);
		expect(none.status, none.stderr).toBe(EXIT.BLOCKED_ASSET_MISSING);
		expect(none.stderr).toMatch(/the painted-light recipe needs its base art listed in assets\.json/u);
		const unlisted = cli(["cover", "--out", paintedRun({ assets: listed, extra: "logo.png" }), "--round", "1"]);
		expect(unlisted.status, unlisted.stderr).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(unlisted.stderr).toMatch(/cover\/assets\/logo\.png is a raster the page can load but assets\.json does not list/u);
		const changed = cli(["cover", "--out", paintedRun({ assets: () => listed("0".repeat(64)) }), "--round", "1"]);
		expect(changed.status, changed.stderr).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(changed.stderr).toMatch(/cover\/assets\/base\.png no longer matches its sha256 in assets\.json/u);
	});
	it("a malformed entry is a treatment fault (exit 16) and a check box must sit inside the art", () => {
		const out = paintedRun({ assets: (hash) => ({ assets: [{ ...listed(hash).assets[0], checkBox: [0.9, 0.9, 0.09, 0.09] }] }) });
		expect(() => checkAssets({ outDir: out, treatment: { recipe: "painted-light" }, files: scanStage(join(out, "cover")).files })).toThrow(/assets\.json assets\[0\]\.checkBox: must lie inside the art's box/u);
		expect(cli(["cover", "--out", out, "--round", "1"]).status).toBe(EXIT.BLOCKED_TREATMENT_INVALID);
	});
	it("C008: frame 0 must show the base art: SSIM of its box against the source scaled into it", () => {
		const art = Buffer.alloc(96 * 64 * 4);
		const frame = Buffer.alloc(200 * 100 * 4, 255);
		for (let y = 0; y < 64; y++)
			for (let x = 0; x < 96; x++) {
				const v = ((x * 7) ^ (y * 13)) & 255;
				art.fill(v, (y * 96 + x) * 4, (y * 96 + x) * 4 + 3);
				art[(y * 96 + x) * 4 + 3] = 255;
				frame.fill(v, ((10 + y) * 200 + 50 + x) * 4, ((10 + y) * 200 + 50 + x) * 4 + 3);
			}
		const box = [50 / 200, 10 / 100, 96 / 200, 64 / 100];
		const good = artCheck({ frame0: frame, width: 200, height: 100, art: { rgba: art, width: 96, height: 64 }, box });
		expect(good.pass).toBe(true);
		expect(good.ssim).toBeGreaterThan(0.99);
		const flat = artCheck({ frame0: Buffer.alloc(200 * 100 * 4, 40), width: 200, height: 100, art: { rgba: art, width: 96, height: 64 }, box });
		expect(flat.pass).toBe(false);
		expect(flat.ssim).toBeLessThan(COVER.artSsim);
	});
	it("C009: a generated asset becomes a label that completion prints for the reply", () => {
		const out = fakeCoverRun();
		writeFileSync(join(out, "assets.json"), JSON.stringify({ assets: [{ path: "cover/assets/base.png", role: "base-art", source: "generated", sha256: "a".repeat(64), box: [0.125, 0, 0.75, 1] }] }));
		recordLook(out, 1, answersFile(out, coverAnswers()));
		rerender(out, 2);
		recordLook(out, 2, answersFile(out, coverAnswers()));
		expect(evaluateDone(out).labels).toEqual(["the base art cover/assets/base.png is generated, not supplied: label it as generated in the reply"]);
		const r = cli(["completion", "--out", out]);
		expect(r.status, r.stdout + r.stderr).toBe(0);
		expect(r.stdout).toMatch(/^completion: complete - every TARGET gate passed/mu);
		expect(r.stdout).toMatch(/^label: the base art cover\/assets\/base\.png is generated, not supplied/mu);
	});
});

/** Mask frames at the cover size: six white glyphs `glyphPx` tall inside the title box, on black. */
function masks(glyphPx: number, count = 4) {
	const dir = join(temp("motion-g6-"), "masks");
	mkdirSync(dir, { recursive: true });
	for (let i = 0; i < count; i++) {
		const rgb = Buffer.alloc(1000 * 500 * 3);
		for (let g = 0; g < 6; g++) for (let y = 100; y < 100 + glyphPx; y++) for (let x = 120 + g * (glyphPx + 8); x < 120 + g * (glyphPx + 8) + Math.max(3, Math.round(glyphPx * 0.6)); x++) rgb.fill(255, (y * 1000 + x) * 3, (y * 1000 + x) * 3 + 3);
		writeFileSync(join(dir, `m${String(i).padStart(4, "0")}.png`), encodePng(1000, 500, rgb, 3, 1));
	}
	return dir;
}

describe("C010: G6, a cap-height floor at the README display width", () => {
	const box = [0.1, 0.15, 0.8, 0.3];
	it("letters 13 px tall on a 1000 px cover are about 10.8 px at 830 px: G6 fails", () => {
		const g = glyphHeights({ masksDir: masks(13), box, displayWidth: 830 });
		expect(g.capPx).toBeCloseTo(13 * 0.83, 0);
		expect(g.pass).toBe(false);
	});
	it("letters 60 px tall pass; a title painted into declared base art is exempt but still measured", () => {
		expect(glyphHeights({ masksDir: masks(60), box, displayWidth: 830 })).toMatchObject({ pass: true, glyphs: 6 });
		const exempt = glyphHeights({ masksDir: masks(13), box, displayWidth: 830, exempt: "painted into the base art cover/assets/base.png" });
		expect(exempt.pass).toBeNull();
		expect(exempt.reason).toMatch(/painted into the base art/u);
	});
	it("the gate carries G6 beside G5, never instead of it", () => {
		const gate = readFileSync(join(skillRoot, "engine", "cover-gate.mjs"), "utf8");
		expect(gate).toMatch(/gates\.G5 = /u);
		expect(gate).toMatch(/gates\.G6 = /u);
	});
});

describe("C012-C013 (units): the seek-order tolerance is the rasterizer's one level, nothing more", () => {
	it("a frame one level off passes, two levels off does not; the shuffle is seeded and not sequential", () => {
		const dir = temp("motion-seek-");
		const frame = (v: number) => {
			const file = join(dir, `f${v}.png`);
			writeFileSync(file, encodePng(16, 8, new Uint8Array(16 * 8 * 3).fill(v), 3, 1));
			return file;
		};
		expect(COVER.seekLevels).toBe(1);
		expect(maxLevelDiff(frame(100), frame(101))).toBe(1);
		expect(maxLevelDiff(frame(100), frame(102))).toBe(2);
		const order = seekOrder(96, 20261020);
		expect(new Set(order).size).toBe(16);
		expect(order).toEqual(seekOrder(96, 20261020));
		expect(order).not.toEqual([...order].sort((a, b) => a - b));
	});
});

describe("C014-C016 (rows): each recipe keeps its page and gate row; each negative names the gates it fails", () => {
	it("every recipe has a page and expected.json with the six numbers inside TARGET and at most 2 MiB", () => {
		for (const name of ["hero-3d", "painted-light", "weight-tide", "orbit-loop"]) {
			const doc = JSON.parse(readFileSync(join(skillRoot, "recipes", name, "expected.json"), "utf8"));
			for (const key of ["medianD", "movingFrac", "longestStillSec", "spike", "seamLocal", "bytes"]) expect(typeof doc.row[key], `${name}.${key}`).toBe("number");
			expect(doc.row.bytes).toBeLessThanOrEqual(COVER.targetBytes);
			expect(doc.row.seamLocal).toBeGreaterThanOrEqual(COVER.target.seamLow);
			expect(doc.row.seamLocal).toBeLessThanOrEqual(COVER.target.seamHigh);
			expect(doc.row.medianD).toBeGreaterThanOrEqual(COVER.target.medianD);
			expect(() => validateCoverTreatment(doc.treatment), name).not.toThrow();
			expect(existsSync(join(skillRoot, "recipes", name, "index.html")), name).toBe(true);
		}
		expect(readdirSync(join(skillRoot, "recipes"), { recursive: true }).some((f) => /\.(webp|gif|mp4|png)$/u.test(String(f)))).toBe(false);
	});
	it("the painted-light QA renders on the five-panel painting PAINTING.panels was measured on, not on the README art", () => {
		const base = readFileSync(join(skillRoot, "fixtures", "cover", "painted-light-base.png"));
		expect(base.length).toBe(2_399_201);
		expect(createHash("sha256").update(base).digest("hex")).toBe("955ccd875bd0da509ba850b76a83ac7aa76f2ecc5c019bcb2d04043e8d46179e");
		expect([base.readUInt32BE(16), base.readUInt32BE(20)]).toEqual([1536, 1024]);
		const page = readFileSync(join(skillRoot, "recipes", "painted-light", "index.html"), "utf8");
		expect(/panels: (\[\[.*?\]\]),/u.exec(page)?.[1]).toBe("[[13, 303], [320, 607], [623, 906], [921, 1208], [1224, 1526]]");
		const qa = readFileSync(join(repoRoot, "scripts", "qa-cover-recipes.mjs"), "utf8");
		expect(qa).toContain('"fixtures", "cover", "painted-light-base.png"');
		expect(qa).not.toContain("litfamily-machines.png");
		expect(JSON.parse(readFileSync(join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).base).toMatch(/^fixtures\/cover\/painted-light-base\.png /u);
	});
	it("the four negatives ship as pages with the FLOOR gates they must keep failing", () => {
		const named = { "title-slam": ["G2", "G3"], "card-scenes": ["G2"], "still-glow": ["G2", "G3"], "reset-sweep": ["G4"] };
		for (const [name, fails] of Object.entries(named)) {
			const declared = JSON.parse(readFileSync(join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8")).mustFail;
			expect(declared, name).toEqual(fails.map((gate) => `${gate}.floor`));
			expect(readFileSync(join(skillRoot, "recipes", "negatives", name, "index.html"), "utf8"), name).toMatch(/NEGATIVE, never a recipe/u);
		}
	});
	it("the recipe QA is wired as npm run qa:cover-recipes and runs the declared painted-light regression for --feather", () => {
		const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
		expect(pkg.scripts["qa:cover-recipes"]).toBe("node scripts/qa-cover-recipes.mjs");
		const reg = JSON.parse(readFileSync(join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).regressions["feather-150"];
		expect(reg.patch).toEqual({ find: "feather: 24,", replace: "feather: 150," });
		expect(readFileSync(join(skillRoot, "recipes", "painted-light", "index.html"), "utf8")).toContain(reg.patch.find);
	});
});

describe("the cover recipe QA proves a negative only by the gates it declares", () => {
	// An empty cache holds no motion runtime, so the renderer blocks before any capture.
	const qa = (args: string[]) =>
		spawnSync(process.execPath, [join(repoRoot, "scripts", "qa-cover-recipes.mjs"), "--out", temp("litcodex-cover-qa-"), ...args], {
			encoding: "utf8",
			timeout: 120000,
			env: { ...process.env, XDG_CACHE_HOME: temp("litcodex-no-runtime-") },
		});

	it("a crashed render never counts as a caught regression or negative", () => {
		const r = qa(["--feather", "150"]);
		expect(r.status, r.stdout + r.stderr).toBe(1);
		expect(r.stdout).toMatch(/^FAIL +regression painted-light feather-150 +not proven: the render did not complete and gate the decoded file \(exit \d+\)/mu);
		const n = qa(["--negatives"]);
		expect(n.status, n.stdout + n.stderr).toBe(1);
		for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"])
			expect(n.stdout).toMatch(new RegExp(`^FAIL +negative ${name} +not proven: the render did not complete`, "mu"));
		expect(n.stdout).toMatch(/^FAIL +regression painted-light feather-150 +not proven/mu);
	});

	it("a regression nobody declared is a QA failure, not a caught defect", () => {
		const r = qa(["--feather", "200"]);
		expect(r.status, r.stdout + r.stderr).toBe(1);
		expect(r.stdout).toMatch(/^FAIL +regression painted-light feather-200 +not proven: painted-light\/expected\.json declares no regression feather-200/mu);
	});

	it("the verdict needs a gated render and every declared gate failing; an undeclared FLOOR failure is not enough", async () => {
		const { judgeCase } = (await import(join(repoRoot, "scripts", "qa-cover-recipes.mjs"))) as {
			judgeCase: (mustFail: string[] | undefined, run: { status: number | null; manifest: unknown }) => { ok: boolean; why: string };
		};
		const gates = (over: Record<string, unknown> = {}) => ({
			G1: { pass: true, target: true },
			G2: { pass: true, target: true },
			G3: { pass: true, target: true },
			G4: { pass: true, target: true },
			...over,
		});
		const run = (status: number, g: Record<string, unknown> | null) => ({ status, manifest: g ? { gate: { gates: g } } : null });
		const failed = { pass: false, target: false };
		const missed = { pass: true, target: false };
		expect(judgeCase(["G1.target"], run(EXIT.BLOCKED_DEPS_NOT_PREWARMED, null)).ok).toBe(false);
		expect(judgeCase(["G1.target"], run(EXIT.BLOCKED_DEPS_NOT_PREWARMED, null)).why).toMatch(/did not complete/u);
		expect(judgeCase(["G1.target"], run(1, gates({ G1: missed }))).ok, "a crash exit with a stale manifest").toBe(false);
		expect(judgeCase(["G1.target"], run(EXIT.GATE_FAIL_QA, gates({ G4: missed }))).why).toMatch(/G1\.target did not fail/u);
		expect(judgeCase(["G1.target"], run(EXIT.GATE_FAIL_QA, gates({ G1: missed, G4: missed }))).ok).toBe(true);
		expect(judgeCase(["G1.target"], run(EXIT.GATE_FAIL_QA, gates({ G1: missed, G3: failed }))).why).toMatch(/G3\.floor, which it does not declare/u);
		expect(judgeCase(["G2.floor", "G3.floor"], run(EXIT.GATE_FAIL_QA, gates({ G2: failed }))).ok).toBe(false);
		expect(judgeCase(["G2.floor", "G3.floor"], run(EXIT.GATE_FAIL_QA, gates({ G2: failed, G3: failed }))).ok).toBe(true);
		expect(judgeCase(["G5.floor"], run(EXIT.GATE_FAIL_QA, gates())).why).toMatch(/G5 was not measured/u);
		expect(judgeCase([], run(EXIT.GATE_FAIL_QA, gates())).why).toMatch(/declares no gate/u);
		expect(judgeCase(undefined, run(EXIT.GATE_FAIL_QA, gates())).why).toMatch(/declares no gate/u);
	});

	it("every negative and regression declares the gates it must fail", () => {
		for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
			const doc = JSON.parse(readFileSync(join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8"));
			expect(doc.mustFail.length, name).toBeGreaterThan(0);
			for (const id of doc.mustFail) expect(id, name).toMatch(/^G[0-6]\.(floor|target)$/u);
		}
		const reg = JSON.parse(readFileSync(join(skillRoot, "recipes", "painted-light", "expected.json"), "utf8")).regressions["feather-150"];
		expect(reg.mustFail).toEqual(["G1.target"]);
		expect(reg.defect).toMatch(/look review/u);
	});
});

describe("doctor: the sixth probe names the cover encoder", () => {
	it("status reports img2webp and dwebp, the gifski fallback or exit 21", () => {
		expect(coverEncoderProbe({ PATH: "/nonexistent" }).line).toMatch(/^BLOCKED_NO_COVER_ENCODER: install libwebp \(img2webp, dwebp\) or gifski/u);
		expect(renderStatus({ chrome: "c", ffmpeg: "f", webgl2: "w", rendererWarning: "r", prewarm: "p", coverEncoder: "e", audio: "a", wordTiming: "t" })).toContain("Cover encoder: e");
	});
});

describe("cover renders on real Chrome, img2webp and the decoded-file gate", { timeout: 1800000 }, () => {
	it("a loop with three speed layers reaches every TARGET gate on the decoded file (C012: seek order identical)", (context) => {
		if (!ready(context)) return;
		const out = coverRun("good");
		const r = cli(["cover", "--out", out, "--round", "1"]);
		expect(r.status, r.stdout + r.stderr).toBe(0);
		expect(r.stdout).toMatch(/^COVER gate --strict: PASS\+TARGET$/mu);
		for (const file of ["cover.webp", "poster.png", "manifest.json", "gate-report.txt", "stills/sheet.png", "stills/seam.png", "stills/poster.png", "stills/frame-11.png", "stills/manifest.json"]) expect(existsSync(join(out, file)), file).toBe(true);
		const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
		expect(manifest).toMatchObject({ mode: "cover", frames: 96, encoder: "img2webp" });
		expect(manifest.gate.gates.G0.identical).toBe(96);
		expect(manifest.gate.gates.G5.min).toBeGreaterThanOrEqual(4.5);
		expect(manifest.gate.gates.FLASH.pass).toBe(true);
		expect(parseWebp(readFileSync(join(out, "cover.webp"))).loop).toBe(0);
		const report = readFileSync(join(out, "gate-report.txt"), "utf8");
		expect(report).toMatch(/^ {2}SEEK pass sampled=16 identical=16/mu);
		expect(report).toMatch(/^ {2}G6 pass capPx=/mu);
		expect(cli(["cover-gate", "--file", join(out, "cover.webp"), "--strict"]).status).toBe(0);
	});
	it("a page that reads Math.random is exit 18 naming the call; a page with no renderFrame is exit 17; a film treatment is exit 16", (context) => {
		if (!ready(context)) return;
		const random = cli(["cover", "--out", coverRun("random"), "--round", "1"]);
		expect(random.status, random.stdout + random.stderr).toBe(EXIT.STAGE_NONDETERMINISTIC);
		expect(random.stderr).toMatch(/STAGE_NONDETERMINISTIC: the cover page called Math\.random/u);
		const none = cli(["cover", "--out", coverRun("no-render"), "--round", "1"]);
		expect(none.status, none.stdout + none.stderr).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(none.stderr).toMatch(/defines no window\.renderFrame/u);
		const film = cli(["cover", "--out", coverRun("good", { ...coverTreatment(), mode: undefined }), "--round", "1"]);
		expect(film.status, film.stderr).toBe(EXIT.BLOCKED_TREATMENT_INVALID);
		expect(film.stderr).toMatch(/mode: this treatment is a film/u);
	});
	it("C013: a page that keeps state between frames fails the seek-order check, naming the frame and its time", (context) => {
		if (!ready(context)) return;
		const r = cli(["cover", "--out", coverRun("trails"), "--round", "1"]);
		expect(r.status, r.stdout + r.stderr).toBe(EXIT.STAGE_NONDETERMINISTIC);
		expect(r.stderr).toMatch(/STAGE_NONDETERMINISTIC: frame \d+ \(t = \d\.\d{3} s\) differs by up to \d+ levels when sought out of order/u);
	});
	it("C002: a window render sheets only frames inside [t0 - 0.5, t1 + 0.5] and never touches the delivered stills", (context) => {
		if (!ready(context)) return;
		const out = coverRun("good");
		const r = cli(["cover", "--out", out, "--round", "1", "--window", "2.0,2.5"]);
		expect(r.status, r.stdout + r.stderr).toBe(0);
		const dir = join(out, "windows", "round-1", "2.000-2.500");
		const doc = JSON.parse(readFileSync(join(dir, "window.json"), "utf8"));
		expect(doc.frames.length).toBeGreaterThanOrEqual(8);
		for (const f of doc.frames) {
			expect(f.t).toBeGreaterThanOrEqual(1.5 - 1e-9);
			expect(f.t).toBeLessThanOrEqual(3.0 + 1e-9);
		}
		expect(existsSync(join(dir, "sheet.png"))).toBe(true);
		expect(existsSync(join(out, "stills"))).toBe(false);
		expect(existsSync(join(out, "gate-report.txt"))).toBe(false);
		expect(r.stdout).toMatch(/a window render never counts as done/u);
	});
});

/** Capture the master pass only, encode it and gate the decoded file (negatives and recipe rows). */
async function quickGate(pageDir: string, treatment: Record<string, unknown>) {
	const t = validateCoverTreatment(treatment);
	const work = temp("motion-quick-");
	const frames = join(work, "frames");
	mkdirSync(frames, { recursive: true });
	const env = { ...process.env, XDG_CACHE_HOME: XDG };
	const runtime = resolveRuntime(env);
	const pool = new CoverPool();
	const session = await CoverSession.open({ runtime, scan: scanStage(pageDir), fonts: fontRoutes(runtime.dir), width: t.page[0], height: t.page[1], scale: COVER.captureScale, profileDir: join(work, "chrome"), env });
	try {
		await capturePass({ session, pool, times: loopTimes(t.frames), dir: frames, size: t.size });
	} finally {
		await session.close();
		await pool.close();
	}
	const files = readdirSync(frames).sort().map((name) => join(frames, name));
	return coverGate(encodeCover({ files, fps: t.fps, encode: t.encode, outDir: work, env }).file, { env });
}

describe("the painted recipe lets any machine be the cover hero", { timeout: 300000 }, () => {
	// A seven-panel painting as a flat grey plate: every lit pixel reads 128, every dimmed one less.
	const SEVEN = [[13, 217], [231, 435], [449, 653], [667, 872], [886, 1090], [1104, 1308], [1322, 1526]];
	const ANCHORS: Record<number, Array<Record<string, number | string>>> = {
		0: [{ cx: 68, cy: 385, rx: 20, ry: 7, kind: "eye" }, { cx: 97, cy: 373, rx: 16, ry: 7, kind: "eye" }, { cx: 61, cy: 689, rx: 32, ry: 32, kind: "core" }],
		3: [{ cx: 720, cy: 350, rx: 16, ry: 16, kind: "eye" }, { cx: 712, cy: 436, rx: 8, ry: 14, kind: "eye" }, { cx: 694, cy: 680, rx: 16, ry: 28, kind: "core" }],
	};
	const SCALE = 0.5859375;
	function heroStage(lead: number, glows: unknown) {
		const dir = temp("motion-hero-");
		const html = readFileSync(join(skillRoot, "recipes", "painted-light", "index.html"), "utf8");
		const painting = { src: "assets/base.png", width: 1536, height: 1024, panels: SEVEN, panelTop: 148, panelBottom: 945, lead, title: { box: [455, 32, 635, 88], gain: 1, maskLevel: 60 }, glows, accent: { cx: 902, cy: 987, rx: 60, ry: 22 } };
		const page = html.replace(/^const PAINTING = \{[\s\S]*?^\};$/mu, `const PAINTING = ${JSON.stringify(painting)};`);
		expect(page).not.toBe(html);
		mkdirSync(join(dir, "assets"), { recursive: true });
		writeFileSync(join(dir, "index.html"), page);
		writeFileSync(join(dir, "assets", "base.png"), encodePng(1536, 1024, Buffer.alloc(1536 * 1024 * 3, 128), 3, 1));
		return dir;
	}
	async function open(stageDir: string) {
		const env = { ...process.env, XDG_CACHE_HOME: XDG };
		const runtime = resolveRuntime(env);
		return CoverSession.open({ runtime, scan: scanStage(stageDir), fonts: fontRoutes(runtime.dir), width: 1200, height: 600, scale: COVER.captureScale, profileDir: join(temp("motion-hero-chrome-"), "p"), env });
	}
	/** Mean luminance of one panel (inset 40 painting px) in a device-scale capture of the 1200 x 600 page. */
	function panelLuma(png: Buffer, [x0, x1]: number[]) {
		const { width, channels, pixels } = decodePng(png);
		const s = width / 1200;
		const X0 = Math.round((150 + (x0 + 40) * SCALE) * s);
		const X1 = Math.round((150 + (x1 - 40) * SCALE) * s);
		const Y0 = Math.round((148 + 40) * SCALE * s);
		const Y1 = Math.round((945 - 40) * SCALE * s);
		let sum = 0;
		for (let y = Y0; y < Y1; y++)
			for (let x = X0; x < X1; x++) {
				const o = (y * width + x) * channels;
				sum += 0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2];
			}
		return sum / ((X1 - X0) * (Y1 - Y0));
	}

	it("a middle hero (panel 3 of 7) stays as bright as the source at frame 0 while a sleeping panel is dimmed", async (context) => {
		if (!ready(context)) return;
		const session = await open(heroStage(3, ANCHORS));
		try {
			await session.frame(0);
			const png = await session.capture();
			const hero = panelLuma(png, SEVEN[3]);
			const sleeper = panelLuma(png, SEVEN[5]);
			expect(hero, `hero panel luminance ${hero.toFixed(1)} against source 128`).toBeGreaterThanOrEqual(0.95 * 128);
			expect(sleeper, `sleeping panel luminance ${sleeper.toFixed(1)} should sit under the dim pool`).toBeLessThan(0.6 * 128);
		} finally {
			await session.close();
		}
	});
	it("the beat lights glow on the hero's own anchors, never on another machine", async (context) => {
		if (!ready(context)) return;
		for (const lead of [0, 3]) {
			const session = await open(heroStage(lead, ANCHORS));
			try {
				const halos = (await session.page.evaluate('[...document.querySelectorAll("#glows ellipse")].map((e) => [+e.getAttribute("cx"), +e.getAttribute("cy")])')) as number[][];
				expect(halos, `hero ${lead}`).toEqual(ANCHORS[lead].map((g) => [g.cx, g.cy]));
				for (const [cx] of halos) expect(cx >= SEVEN[lead][0] && cx <= SEVEN[lead][1], `hero ${lead}: glow at x ${cx} lies outside its panel`).toBe(true);
			} finally {
				await session.close();
			}
		}
	});
	it("a hero declared with no lights (an empty list) runs without beat lights", async (context) => {
		if (!ready(context)) return;
		const session = await open(heroStage(5, { ...ANCHORS, 5: [] }));
		try {
			expect(await session.page.evaluate('document.querySelectorAll("#glows ellipse").length')).toBe(0);
			await session.frame(0.25);
		} finally {
			await session.close();
		}
	});
	it("a hero with no light entry stops the page with a message naming the panel, instead of borrowing another machine's lights", async (context) => {
		if (!ready(context)) return;
		const started = Date.now();
		await expect(open(heroStage(5, ANCHORS))).rejects.toThrow(/STAGE_CONTRACT_ERROR: .*first page error: (?:Error: )?PAINTING\.glows has no entry for the lead panel 5/u);
		// It fails as soon as the page throws, not after the 60 s readiness wait.
		expect(Date.now() - started).toBeLessThan(20000);
	});
});

describe("C016-C017: the shipped slide-like negatives keep failing; the type recipes keep reaching TARGET", { timeout: 1800000 }, () => {
	for (const name of ["title-slam", "card-scenes", "still-glow", "reset-sweep"]) {
		it(`${name} fails exactly on its named gates`, async (context) => {
			if (!ready(context)) return;
			const expected = JSON.parse(readFileSync(join(skillRoot, "recipes", "negatives", name, "expected.json"), "utf8"));
			const r = await quickGate(join(skillRoot, "recipes", "negatives", name), coverTreatment({ brandWord: "LITCODEX", ...expected.treatment }));
			expect(Object.entries(r.gates).filter(([, g]) => (g as { pass: boolean | null }).pass === false).map(([k]) => k).sort()).toEqual(
				expected.mustFail.map((id: string) => id.replace(/\.floor$/u, "")),
			);
		});
	}
	for (const name of ["weight-tide", "orbit-loop"]) {
		it(`${name} still reaches TARGET`, async (context) => {
			if (!ready(context)) return;
			const expected = JSON.parse(readFileSync(join(skillRoot, "recipes", name, "expected.json"), "utf8"));
			const r = await quickGate(join(skillRoot, "recipes", name), expected.treatment);
			expect(r.target, JSON.stringify({ medianD: r.medianD, seamLocal: r.seamLocal, bytes: r.bytes })).toBe(true);
		});
	}
});
