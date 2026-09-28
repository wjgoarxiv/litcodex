import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POST_FIELDS, READING } from "./engine/constants.mjs";
import { fitsCeiling, planPasses } from "./engine/passes.mjs";
import { PRESETS, pickPreset } from "./engine/presets.mjs";
import { buildTimeline, normalizeBrief } from "./engine/timeline.mjs";
import { countUnits, eojeols, glyphX, layoutLine, plain, readingFloor, scriptRuns, smart } from "./engine/type.mjs";
import { fnv1a32, mulberry32, passSeed, subSampleTimes } from "./engine/util.mjs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));

describe("seeded randomness (MO-SH-01, MO-A-23)", () => {
	it("fnv1a32 matches the FNV-1a 32-bit vectors and the spec's worked seed", () => {
		expect(fnv1a32("")).toBe(2166136261);
		expect(fnv1a32("a")).toBe(3826002220);
		expect(fnv1a32("foobar")).toBe(3214735720);
		expect(passSeed(20260926, "title-slam", 0, "dither")).toBe(3693088578);
	});
	it("mulberry32 matches an independent implementation", () => {
		const a = mulberry32(1);
		expect([a(), a(), a()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
		const b = mulberry32(20260926);
		expect([b(), b(), b()]).toEqual([0.550729513168335, 0.35494965384714305, 0.9950056211091578]);
	});
	it("no visual engine file reads the clock or an unseeded random source", () => {
		for (const name of ["browser-app.js", "compose.mjs", "scenes.mjs", "passes.mjs", "stroke.mjs", "type.mjs", "util.mjs", "timeline.mjs"]) {
			const source = readFileSync(join(skillRoot, "engine", name), "utf8");
			expect(source, name).not.toMatch(/Math\.random\(|Date\.now\(/u);
			if (name !== "browser-app.js") expect(source, name).not.toMatch(/performance\.now\(/u);
		}
		const app = readFileSync(join(skillRoot, "engine", "browser-app.js"), "utf8");
		expect(app.match(/performance\.now\(\)/gu)?.length, "only the MO-D-02 perf timer reads the clock").toBe(2);
	});
});

describe("sub-sample times (MO-A-28)", () => {
	it("pins N samples across the shutter, centred on the frame and clamped at 0", () => {
		expect(subSampleTimes(60, 60, 4, 0.5)).toEqual([1 - 0.1875 / 60, 1 - 0.0625 / 60, 1 + 0.0625 / 60, 1 + 0.1875 / 60]);
		expect(subSampleTimes(0, 60, 4, 0.5)[0]).toBe(0);
		expect(subSampleTimes(12, 60, 1, 0.5)).toEqual([0.2]);
	});
});

describe("the one reading floor (MO-C-07/08)", () => {
	it("gives a 4-어절 line with 14 Hangul syllables a 2.8 s floor", () => {
		const line = "바닷가 작은 도서관이 새벽마다 문을";
		expect(eojeols(line)).toHaveLength(5);
		const four = "새벽에 조용한 도서관이 문을열어";
		expect(eojeols(four)).toHaveLength(4);
		expect(countUnits(four).H).toBe(14);
		expect(readingFloor(four, "line")).toBeCloseTo(2.8, 10);
	});
	it("uses the Latin words term, the 0.9 s line floor, the 0.5 s word floor and the 0.35 s reveal floor", () => {
		expect(readingFloor("Hello", "line")).toBe(READING.lineFloorLatin);
		expect(readingFloor("one two three four five six seven", "line")).toBeCloseTo(7 / 3.3, 10);
		expect(readingFloor("Go", "word")).toBe(0.5);
		expect(readingFloor("an extraordinarily long reveal", "reveal")).toBe(0.35);
		expect(readingFloor("밤", "line")).toBe(1.0);
	});
	it("mixes both terms for mixed-script text", () => {
		expect(readingFloor("LIT 스튜디오 오픈 2026", "line")).toBeCloseTo(0.2 * 6 + 2 / 3.3, 10);
	});
});

describe("script runs and 어절 breaks (MO-FT-04/05)", () => {
	it("attaches digits to the adjacent run and splits exactly at the script boundary", () => {
		expect(scriptRuns("2026년").map((r) => [r.script, r.text])).toEqual([["hangul", "2026년"]]);
		expect(scriptRuns("LIT팀").map((r) => [r.script, r.text])).toEqual([["latin", "LIT"], ["hangul", "팀"]]);
		expect(scriptRuns("LIT 스튜디오").map((r) => [r.script, r.text])).toEqual([["latin", "LIT "], ["hangul", "스튜디오"]]);
	});
	it("breaks only at whitespace", () => {
		expect(eojeols("  작은 배가\t돌아온다 ")).toEqual(["작은", "배가", "돌아온다"]);
	});
	it("builds reveal steps from whole 어절 and never splits one", () => {
		const brief = normalizeBrief({ lines: ["Open", "새벽 바다에 작은 불빛이 켜진다", "End"] });
		const { timeline } = buildTimeline(brief);
		const reveals = timeline.filter((e: { kind: string }) => e.kind === "reveal").map((e: { text: string }) => e.text);
		expect(reveals).toEqual(["새벽", "바다에", "작은", "불빛이", "켜진다"]);
	});
});

describe("typographic punctuation (MO-A-34)", () => {
	it("smart() and plain() round-trip the brief's own text", () => {
		expect(smart(`"Don't wait..." she said`)).toBe("“Don’t wait…” she said");
		expect(plain("“Don’t wait…”")).toBe(`"Don't wait..."`);
	});
});

describe("kerned glyph positions (MO-A-32)", () => {
	const book = {
		metrics: () => ({ upm: 1000, ascent: 800, descent: -200, capHeight: 700 }),
		glyph: (_key: string, char: string) => ({ id: char, index: char.charCodeAt(0), advance: 500, glyph: char, entry: { empty: char === " ", box: [0, -700, 500, 0] } }),
		kerning: (_key: string, left: { glyph: string } | null, right: { glyph: string }) => (left?.glyph === "A" && right.glyph === "V" ? -80 : 0),
	};
	it("places piece i at its position in the kerned run, including the pair before it", () => {
		const layout = layoutLine(book, "AVA", { latin: "x", hangul: "x" }, 100);
		expect(glyphX(layout, 1)).toBeCloseTo(50 - 8, 10);
		expect(glyphX(layout, 2)).toBeCloseTo(100 - 8, 10);
		const slice = layoutLine(book, "A", { latin: "x", hangul: "x" }, 100).width;
		expect(glyphX(layout, 1)).not.toBe(slice);
	});
	it("keeps Hangul runs at zero tracking inside a tracked mixed line", () => {
		const layout = layoutLine(book, "AB 가나", { latin: "x", hangul: "y" }, 100, 0.1);
		expect(layout.runs.map((r: { script: string; trackingEm: number }) => [r.script, r.trackingEm])).toEqual([["latin", 0.1], ["hangul", 0]]);
	});
});

describe("post override ranges (MO-A-58)", () => {
	it("fixes a type, range and neutral value for every field", () => {
		expect(Object.keys(POST_FIELDS).sort()).toEqual(["bloom", "bloomKnee", "bloomRadius", "bloomThreshold", "ca", "exposure", "fade", "flash", "grain", "halation", "vignette", "zoom"]);
		expect(POST_FIELDS.fade.neutral).toBe(1);
		expect(POST_FIELDS.bloomThreshold.neutral).toBe(0.85);
		expect(POST_FIELDS.zoom.neutral).toBe(1);
		for (const preset of Object.values(PRESETS)) {
			for (const [field, spec] of Object.entries(POST_FIELDS)) {
				const value = (preset.post as unknown as Record<string, number>)[field];
				expect(value, `${preset.id}.${field}`).toBeGreaterThanOrEqual(spec.min);
				if (spec.max !== null) expect(value, `${preset.id}.${field}`).toBeLessThanOrEqual(spec.max);
			}
		}
	});
});

describe("preset auto-pick (MO-B-00)", () => {
	it("matches whole words, takes the first matching row, and lets an explicit style win", () => {
		expect(pickPreset({ lines: ["a night shift at the terminal"] }).id).toBe("terminalcore");
		expect(pickPreset({ lines: ["terminally calm"] }).id).toBe("tidal");
		expect(pickPreset({ lines: ["our workflow system status"] }).id).toBe("swiss-signal");
		expect(pickPreset({ lines: ["결제 시스템 개편"] }).id).toBe("swiss-signal");
		expect(pickPreset({ lines: ["잔잔한 오후"] }).id).toBe("tidal");
		expect(pickPreset({ lines: ["금물결 축제"] }).id).toBe("swiss-signal");
		expect(pickPreset({ lines: ["CRT glow on a calm sea"] }).id).toBe("terminalcore");
		expect(pickPreset({ preset: "tidal", lines: ["hacker console"] })).toEqual({ id: "tidal", reason: "agent default" });
		expect(pickPreset({ preset: "tidal", presetSource: "user", lines: ["hacker console"] })).toEqual({ id: "tidal", reason: "user-specified" });
	});
});

describe("event ceiling at design time (MO-SH-03)", () => {
	it("never schedules more than 2 events in any 1 s window of a shot", () => {
		expect(fitsCeiling([0.1, 0.5], 0.9)).toBe(false);
		expect(fitsCeiling([0.1, 0.5], 1.2)).toBe(true);
		const brief = normalizeBrief({ lines: ["BOOT", "one two three four five six seven eight nine", "PORT 7 · TIDE OK · LAMP ON · FUEL LOW", "END"], preset: "terminalcore" });
		const plan = buildTimeline(brief);
		const { events } = planPasses({ preset: PRESETS.terminalcore, shots: plan.shots, runSeed: 7, softwareGL: false, fps: 60, stateful: true });
		for (const shot of plan.shots) {
			const times = events.filter((e: { shotId: string }) => e.shotId === shot.id).map((e: { t: number }) => e.t);
			for (const t of times) expect(times.filter((u: number) => u >= t && u < t + 1).length).toBeLessThanOrEqual(2);
		}
	});
});

describe("adaptation boundary", () => {
	it("ships only this engine's own modules (no method-only upstream file)", () => {
		expect(readdirSync(join(skillRoot, "engine")).sort()).toEqual(["NOTICE", "THIRD_PARTY_NOTICES", "browser-app.js", "completion.mjs", "compose.mjs", "constants.mjs", "driver.mjs", "encode.mjs", "flash.mjs", "fonts.mjs", "gate.mjs", "image.mjs", "look.mjs", "passes.mjs", "presets.mjs", "report.mjs", "runtime.mjs", "scenes.mjs", "sound.mjs", "stage-gate.mjs", "stage-init.js", "stage-kit.js", "stage-qa.js", "stage-qa.mjs", "stage-render.mjs", "stage-worker.mjs", "stage.mjs", "stroke.mjs", "timeline.mjs", "treatment.mjs", "type.mjs", "util.mjs"]);
	});
});
