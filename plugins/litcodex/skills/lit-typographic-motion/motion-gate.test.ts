import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FlashDetector, countFlashes } from "./engine/flash.mjs";
import { evaluate, timelineRules } from "./engine/gate.mjs";
import { contrastFrame, passingRun } from "./fixtures/gate-fixture.mjs";
import { promote } from "./scripts/render.mjs";

type Run = ReturnType<typeof passingRun>;
const statusOf = (run: Run, id: string) => evaluate(run).find((r: { id: string }) => r.id === id)?.status;
const failing = (run: Run) => evaluate(run).filter((r: { status: string }) => r.status === "FAIL").map((r: { id: string }) => r.id);

// Frames are 320x180 (one pixel per 6x6-logical-px audit cell) so the audit stays fast.
const W = 320;
const H = 180;
const encode = (l: number) => Math.round(Math.max(0, Math.min(1, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)) * 255);
function solid(l: number, rgb?: [number, number, number]) {
	const bytes = new Uint8Array(W * H * 4);
	const v = encode(l);
	for (let i = 0; i < bytes.length; i += 4) bytes.set(rgb ?? [v, v, v], i), (bytes[i + 3] = 255);
	return bytes;
}
function withFlashes(run: Run, frames: Uint8Array[]) {
	const detector = new FlashDetector(W, H);
	frames.forEach((bytes, f) => {
		run.frames[f].flash = detector.ingest(bytes);
	});
	return run;
}

describe("MO-C-03 excursion flash audit", { timeout: 120000 }, () => {
	it("passes the clean baseline", () => {
		expect(statusOf(passingRun(), "MO-C-03")).toBe("PASS");
	});
	it("fails fixture (i): full-frame pulse 0.05<->0.55, 6-frame attack and decay, 4 per second", () => {
		const frames = Array.from({ length: 120 }, (_, f) => {
			const k = f % 15;
			return solid(0.05 + 0.5 * (k < 6 ? k / 6 : k < 12 ? 1 - (k - 6) / 6 : 0));
		});
		expect(statusOf(withFlashes(passingRun(), frames), "MO-C-03")).toBe("FAIL");
	});
	it("fails fixture (ii): a 700x400 block toggling black/white 4 times a second", () => {
		const frames = Array.from({ length: 120 }, (_, f) => {
			const b = solid(0.02);
			if (Math.floor(f / 7.5) % 2 === 1) for (let y = 30; y < 30 + Math.round(400 / 6); y++) for (let x = 50; x < 50 + Math.round(700 / 6); x++) b.set([255, 255, 255], (y * W + x) * 4);
			return b;
		});
		expect(statusOf(withFlashes(passingRun(), frames), "MO-C-03")).toBe("FAIL");
	});
	it("fails 4 flashes placed in the final second of a non-looping master (both wrap sites removed)", () => {
		const frames = Array.from({ length: 360 }, (_, f) => solid(f >= 300 && Math.floor((f - 300) / 7.5) % 2 === 0 ? 0.9 : 0.02));
		const run = withFlashes(passingRun(), frames);
		const master = countFlashes(run.frames.map((l) => l.flash), 60, false);
		expect(master.general.flashes).toBe(4);
		expect(statusOf(run, "MO-C-03")).toBe("FAIL");
	});
	it("counts red flashes per window, not over the whole film", () => {
		const spaced = Array.from({ length: 360 }, (_, f) => solid(0, [f % 60 < 8 ? 255 : 40, 0, 0]));
		expect(statusOf(withFlashes(passingRun(), spaced), "MO-C-03")).toBe("PASS");
		const dense = Array.from({ length: 360 }, (_, f) => solid(0, [f >= 60 && f < 120 && Math.floor((f - 60) / 7.5) % 2 === 0 ? 255 : 40, 0, 0]));
		const run = withFlashes(passingRun(), dense);
		expect(countFlashes(run.frames.map((l) => l.flash), 60, false).red.flashes).toBeGreaterThan(3);
		expect(statusOf(run, "MO-C-03")).toBe("FAIL");
	});
	it("audits the preview frames looping across the seam", () => {
		const run = passingRun();
		const marks: Record<number, [number, number]> = { 48: [1, 0], 51: [0, 1], 54: [1, 0], 57: [0, 1], 0: [1, 0], 3: [0, 1], 6: [1, 0], 9: [0, 1] };
		const records = Array.from({ length: 60 }, (_, f) => ({ f, g: marks[f] ?? [0, 0], r: [0, 0] }));
		expect(countFlashes(records, 30, false).general.flashes).toBeLessThanOrEqual(3);
		expect(countFlashes(records, 30, true).general.flashes).toBe(4);
		run.preview = { records, fps: 30 };
		expect(statusOf(run, "MO-C-03")).toBe("FAIL");
	});
	it("fails a full-frame luminance step in one frame pair (MO-SH-04a)", () => {
		const frames = Array.from({ length: 20 }, (_, f) => solid(f < 10 ? 0.02 : 0.5));
		expect(statusOf(withFlashes(passingRun(), frames), "MO-SH-04a")).toBe("FAIL");
	});
});

describe("gate fixtures: one failing case per measurable HARD or CAP row", () => {
	it("baseline passes every rule", () => {
		expect(failing(passingRun())).toEqual([]);
	});
	it("MO-C-01: a frame with draws: 0 is a GLSL gap", () => {
		const run = passingRun();
		for (const line of run.passLog.get(42) ?? []) line.draws = 0;
		expect(failing(run)).toContain("MO-C-01");
	});
	it("MO-C-01 / MO-SH-00: an empty passRanges list", () => {
		const run = passingRun();
		run.manifest.passRanges = [];
		expect(failing(run)).toEqual(expect.arrayContaining(["MO-C-01", "MO-SH-00"]));
	});
	it("MO-SH-00a: a manifest range with a frame missing from the log", () => {
		const run = passingRun();
		run.passLog.set(100, (run.passLog.get(100) ?? []).filter((l) => l.pass !== "dither"));
		expect(failing(run)).toContain("MO-SH-00a");
	});
	it("MO-C-02 / MO-A-04: an unlabelled software renderer", () => {
		const run = passingRun();
		run.manifest.renderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)";
		expect(failing(run)).toEqual(expect.arrayContaining(["MO-C-02", "MO-A-04"]));
	});
	it("MO-SH-09: a labelled software renderer without the downgrade", () => {
		const run = passingRun();
		run.manifest.renderer = "llvmpipe (LLVM 17)";
		run.manifest.softwareRenderer = true;
		expect(failing(run)).toContain("MO-SH-09");
	});
	it("MO-C-04: a glyph box past title-safe", () => {
		const run = passingRun();
		run.frames[50].textBoxes[0].bbox = [80, 400, 900, 520];
		expect(failing(run)).toContain("MO-C-04");
	});
	it("MO-C-05: a non-glyph element past action-safe", () => {
		const run = passingRun();
		run.frames[50].elements[0].bbox = [20, 560, 900, 562];
		expect(failing(run)).toContain("MO-C-05");
	});
	it("MO-C-06: body type under 4.5:1 and large type under 3:1, including a gradient fill", () => {
		const body = passingRun();
		const small = contrastFrame(330, "#5A5E66", "#0C0E13");
		small.line.textBoxes[0].fontSizePx = 24;
		small.line.textBoxes[0].weight = 400;
		body.frames[330].textBoxes = small.line.textBoxes;
		body.contrast = [small];
		expect(failing(body)).toContain("MO-C-06");
		const large = passingRun();
		const dim = contrastFrame(330, "#30343A", "#0C0E13");
		large.frames[330].textBoxes = dim.line.textBoxes;
		large.contrast = [dim];
		expect(failing(large)).toContain("MO-C-06");
		const gradient = passingRun();
		const frame = contrastFrame(330, "#E9EBE4", "#0C0E13");
		for (let i = 0; i < frame.mask.length; i++) if (frame.mask[i] && i % 480 < 130) frame.rgba.set([20, 22, 26], i * 4);
		frame.line.textBoxes[0].fill = "gradient";
		gradient.frames[330].textBoxes = frame.line.textBoxes;
		gradient.contrast = [frame];
		expect(failing(gradient)).toContain("MO-C-06");
	});
	it("MO-C-07/08: a hold under the reading floor", () => {
		const run = passingRun();
		run.manifest.timeline[2].holdSec = 0.2;
		expect(failing(run)).toContain("MO-C-08");
		const en = passingRun();
		en.manifest.timeline[0].text = "A quiet harbor wakes before the gulls and the bells and the ferries begin to call out";
		expect(failing(en)).toContain("MO-C-07");
	});
	it("MO-A-15 / MO-A-16: a cut more than a frame off the beat, and a scene under 2 beats", () => {
		const off = passingRun();
		off.manifest.timeline[1].start = 3.05;
		expect(failing(off)).toContain("MO-A-15");
		const short = passingRun();
		short.manifest.timeline[1].holdSec = 1.0;
		expect(failing(short)).toContain("MO-A-16");
	});
	it("MO-A-13: a reveal that splits a 어절", () => {
		const run = passingRun();
		run.manifest.timeline[4].text = "돌아";
		expect(failing(run)).toContain("MO-A-13");
	});
	it("MO-C-09: an rgbaSha256 mismatch fails; a SwiftShader-confirmed hardware pair only warns", () => {
		const run = passingRun();
		run.determinism = { frames: [{ frame: 180, video: "a", rerender: "b" }] };
		expect(failing(run)).toContain("MO-C-09");
		run.determinism = { frames: [{ frame: 180, video: "a", rerender: "b" }], swiftshader: [{ frame: 180, a: "c", b: "c" }] } as never;
		expect(statusOf(run, "MO-C-09")).toBe("WARN");
	});
	it("MO-C-10/11/12: wrong ffprobe tags, low resolution, low fps, short film", () => {
		for (const patch of [{ colorSpace: "bt470bg" }, { pixFmt: "yuv444p" }, { colorRange: "pc" }, { width: 1280, height: 720 }, { fps: 24 }, { duration: 2 }]) {
			const run = passingRun();
			run.probe = { ...run.probe, ...patch };
			expect(failing(run), JSON.stringify(patch)).toContain("MO-C-10/11/12");
		}
	});
	it("MO-C-13: preview over 3 MB, poster over 1 MB", () => {
		const preview = passingRun();
		preview.exports.preview.bytes = 3_200_000;
		expect(failing(preview)).toContain("MO-C-13");
		const poster = passingRun();
		poster.exports.poster.bytes = 1_100_000;
		expect(failing(poster)).toContain("MO-C-13");
	});
	it("MO-C-14: an unsettled reduced-motion still", () => {
		const run = passingRun();
		run.stillInk = 600;
		expect(failing(run)).toContain("MO-C-14");
	});
	it("MO-SH-10: showGuides true", () => {
		const run = passingRun();
		run.manifest.passRanges[0].params.showGuides = true;
		expect(failing(run)).toContain("MO-SH-10");
	});
	it("MO-SH-07: persistence on a non-stateful scene, and CRT flicker over 0.06", () => {
		const run = passingRun();
		run.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: 1, params: { flickerAmp: 0.03, flickerAmpRealized: 0.03, persistenceEnabled: true, sceneStateful: false }, downgraded: false });
		expect(failing(run)).toContain("MO-SH-07");
		const flicker = passingRun();
		flicker.manifest.passRanges.push({ pass: "crt", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: 1, params: { flickerAmp: 0.08, flickerAmpRealized: 0.08, persistenceEnabled: false, sceneStateful: false }, downgraded: false });
		expect(failing(flicker)).toContain("MO-SH-07");
	});
	it("MO-C-29: a third saturated cluster, the accent in two entries, the accent above 10% of frames", () => {
		const third = passingRun();
		third.frames[10].fills.push({ source: "a", color: "#0F7A82", w: 40, h: 40 }, { source: "b", color: "#D9A441", w: 40, h: 40 }, { source: "c", color: "#C0306A", w: 40, h: 40 });
		expect(failing(third)).toContain("MO-C-29");
		const twoEntries = passingRun();
		for (let f = 0; f < 360; f++) twoEntries.frames[f].fills.push({ source: "signal", color: "#0F7A82", w: 40, h: 40 });
		twoEntries.frames[10].fills.push({ source: "accent", color: "#D9A441", w: 30, h: 30 });
		twoEntries.frames[200].fills.push({ source: "accent", color: "#D9A441", w: 30, h: 30 });
		expect(failing(twoEntries)).toContain("MO-C-29");
		const tooLong = passingRun();
		for (let f = 0; f < 360; f++) tooLong.frames[f].fills.push({ source: "signal", color: "#0F7A82", w: 40, h: 40 });
		for (let f = 190; f < 260; f++) tooLong.frames[f].fills.push({ source: "accent", color: "#D9A441", w: 30, h: 30 });
		expect(failing(tooLong)).toContain("MO-C-29");
	});
	it("MO-D-02: p95 over the hardware ceiling", () => {
		const run = passingRun();
		run.perf = { frames: 120, p50: 20, p95: 55, max: 80 };
		expect(failing(run)).toContain("MO-D-02");
	});
	it("MO-D-03: a near-black empty run", () => {
		const run = passingRun();
		for (let f = 200; f < 350; f++) {
			run.frames[f].glyphInkPixels = 0;
			run.frames[f].p995 = 0.01;
		}
		expect(failing(run)).toContain("MO-D-03");
	});
	it("MO-D-04: a missing glyph", () => {
		const run = passingRun();
		run.coverage = [{ char: "☃", codepoint: "U+2603", fontKey: "archivo-w100-400" }];
		expect(failing(run)).toContain("MO-D-04");
	});
	it("MO-C-25: display tracking past -0.04em, and negative tracking on the machine voice", () => {
		const display = passingRun();
		display.frames[5].textBoxes[0].trackingEm = -0.06;
		expect(failing(display)).toContain("MO-C-25");
		const machine = passingRun();
		machine.frames[5].textBoxes[0].voice = "machine";
		machine.frames[5].textBoxes[0].trackingEm = -0.01;
		expect(failing(machine)).toContain("MO-C-25");
	});
	it("MO-FT-04: tracking or width motion on a Hangul run", () => {
		const tracking = passingRun();
		tracking.frames[200].textBoxes[0].trackingEm = 0.02;
		expect(failing(tracking)).toContain("MO-FT-04");
		const width = passingRun();
		width.frames[200].textBoxes[0].widthPct = 75;
		expect(failing(width)).toContain("MO-FT-04");
	});
	it("MO-A-33: synthetic Hangul weight or a condensed Hangul face", () => {
		const run = passingRun();
		run.frames[200].textBoxes[0].weight = 600;
		expect(failing(run)).toContain("MO-A-33");
		const scaled = passingRun();
		scaled.frames[200].textBoxes[0].scaleX = 0.8;
		expect(failing(scaled)).toContain("MO-A-33");
	});
	it("MO-A-35: outlined or haloed type", () => {
		const run = passingRun();
		run.frames[3].textBoxes[0].outline = true;
		expect(failing(run)).toContain("MO-A-35");
	});
	it("MO-C-26: multi-line line-height under its floor; MO-C-27: a Latin paragraph card outside 60-75ch", () => {
		const lh = passingRun();
		lh.frames[4].textBoxes[0].block = { lines: 2, lineHeight: 1.2 };
		expect(failing(lh)).toContain("MO-C-26");
		const measure = passingRun();
		measure.frames[4].textBoxes[0].block = { lines: 2, lineHeight: 1.5, kind: "paragraph", lineTexts: ["x".repeat(90), "y".repeat(64)] };
		expect(failing(measure)).toContain("MO-C-27");
	});
	it("MO-FT-05: a Korean block broken inside a 어절", () => {
		const run = passingRun();
		run.frames[250].blocks = [{ elementId: "s2/title", sourceText: "작은 배가 돌아온다", lines: ["작은 배가 돌아", "온다"] }];
		expect(failing(run)).toContain("MO-FT-05");
	});
	it("MO-FT-08: a stroke face outside the EMS five", () => {
		const run = passingRun();
		run.frames[6].textBoxes.push({ ...run.frames[6].textBoxes[0], voice: "signature", fontFile: "fonts/stroke/HersheySans1.svg" });
		expect(failing(run)).toContain("MO-FT-08");
	});
	it("MO-A-58: an invert change off a cut, an invert held under 2 beats, and an out-of-range override", () => {
		const off = passingRun();
		for (let f = 50; f < 360; f++) off.frames[f].post.invert = true;
		expect(failing(off)).toContain("MO-A-58");
		const brief = passingRun();
		for (let f = 180; f < 360; f++) brief.frames[f].post.invert = true;
		for (let f = 181; f < 360; f++) brief.frames[f].post.invert = false;
		expect(failing(brief)).toContain("MO-A-58");
		const range = passingRun();
		range.frames[9].post.flash = 1.5;
		expect(failing(range)).toContain("MO-A-58");
	});
	it("MO-SH-03: three events inside one second of a shot across sources", () => {
		const run = passingRun();
		run.frames[20].events = ["glitch-hit"];
		run.frames[40].events = ["flash-rise"];
		run.frames[70].events = ["boot-flicker"];
		expect(failing(run)).toContain("MO-SH-03");
	});
	it("MO-SH-05 / MO-SH-06: glitch over 2 hits/s or 20% area; surge over 2/s or with a short attack or decay", () => {
		const glitch = passingRun();
		glitch.manifest.passRanges.push({ pass: "glitch", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: 7, params: { hitRatePerSec: 1.5, hitRatePerSecRealized: 2.4, areaCapPct: 12 }, downgraded: false });
		expect(failing(glitch)).toContain("MO-SH-05");
		const area = passingRun();
		area.manifest.passRanges.push({ pass: "glitch", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: 7, params: { hitRatePerSec: 1.5, hitRatePerSecRealized: 1, areaCapPct: 25 }, downgraded: false });
		expect(failing(area)).toContain("MO-SH-05");
		for (const params of [{ surgeCapPerSec: 3, surgeAttackSec: 0.15, surgeDecaySec: 0.25, surgeCountRealized: 1 }, { surgeCapPerSec: 2, surgeAttackSec: 0.05, surgeDecaySec: 0.25, surgeCountRealized: 1 }, { surgeCapPerSec: 2, surgeAttackSec: 0.15, surgeDecaySec: 0.05, surgeCountRealized: 1 }]) {
			const surge = passingRun();
			surge.manifest.passRanges.push({ pass: "tidal-gradient", frameStart: 0, frameEnd: 179, sceneId: "title-slam", shotIndex: 0, seed: 7, params, downgraded: false });
			expect(failing(surge), JSON.stringify(params)).toContain("MO-SH-06");
		}
	});
	it("MO-SH-08: a dither reseed inside a shot; MO-SH-01: a seed off the formula", () => {
		const reseed = passingRun();
		const line = reseed.passLog.get(90)?.find((l) => l.pass === "dither");
		if (line) line.uniforms.u_seed = 12345;
		expect(failing(reseed)).toEqual(expect.arrayContaining(["MO-SH-08", "MO-SH-01"]));
		const formula = passingRun();
		formula.manifest.passRanges[1].seed = 99;
		expect(failing(formula)).toContain("MO-SH-01");
	});
	it("MO-A-51: chromeFlags that are not a ladder rung", () => {
		const run = passingRun();
		run.manifest.chromeFlags = ["--no-sandbox"];
		expect(failing(run)).toContain("MO-A-51");
	});
	it("MO-A-37..41: a missing export", () => {
		const run = passingRun();
		run.exports.poster.present = false;
		expect(failing(run)).toContain("MO-A-37..41");
	});
	it("pre-flight timeline rules run on their own before any frame", () => {
		const run = passingRun();
		run.manifest.timeline[0].holdSec = 0.3;
		expect(timelineRules(run.manifest).find((r: { id: string }) => r.id === "MO-C-07")?.status).toBe("FAIL");
	});
});

describe("MO-C-16 withholding", () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});
	it("a surviving MO-C-03 FAIL leaves no film, preview or poster at deliverable names", () => {
		const out = mkdtempSync(join(tmpdir(), "motion-withhold-"));
		dirs.push(out);
		mkdirSync(join(out, ".run"));
		for (const name of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) writeFileSync(join(out, ".run", name), "x");
		const withheld = promote(out, { previewEncoder: "img2webp" }, [{ id: "MO-C-03", status: "FAIL" }]);
		expect(withheld).toBe(true);
		for (const name of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) expect(existsSync(join(out, name)), name).toBe(false);
		expect(readdirSync(join(out, "withheld")).sort()).toEqual(["film.mp4", "poster.png", "preview.webp", "reduced-motion.png"]);
	});
	it("a non-flash FAIL still delivers the exports for inspection", () => {
		const out = mkdtempSync(join(tmpdir(), "motion-deliver-"));
		dirs.push(out);
		mkdirSync(join(out, ".run"));
		for (const name of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) writeFileSync(join(out, ".run", name), "x");
		expect(promote(out, { previewEncoder: "img2webp" }, [{ id: "MO-C-06", status: "FAIL" }])).toBe(false);
		for (const name of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) expect(existsSync(join(out, name)), name).toBe(true);
	});
});
