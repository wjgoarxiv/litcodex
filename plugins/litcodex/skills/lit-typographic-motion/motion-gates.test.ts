import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { busyShare, luminanceBand, regionFill } from "./engine/image.mjs";
import { recordLook } from "./engine/look.mjs";
import { deadAirRule, flatFrameRule } from "./engine/stage-gate.mjs";
import { BOARD_RULES, overlapFaults, qaSamples, richFillRule, styleFaults, styleRules } from "./engine/stage-qa.mjs";
import { readStyle } from "./engine/styles.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// The gate rules a house style and a rich frame add: TEXT-OVERLAP, TEXT-ON-STYLE, TEXT-ZONE,
// FLAT-FRAME, DEAD-AIR and RICH-FILL. The rule functions are tested on built data; each rule also
// fails on a real page in real Chrome (skipped, with the reason printed, without Chrome or a
// pre-warmed fixture cache) and the good page passes them all.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const PAGES = join(skillRoot, "fixtures", "stage");
const DRIVER = join(skillRoot, "fixtures", "gates-driver.mjs");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** An opaque RGBA frame of one colour, with `paint(x, y)` returning another colour to draw over it. */
function frame(width: number, height: number, ground: number[], paint: (x: number, y: number) => number[] | null = () => null) {
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const [r, g, b] = paint(x, y) ?? ground;
			rgba.set([r, g, b, 255], (y * width + x) * 4);
		}
	return rgba;
}
const CREAM = [243, 237, 226];
const INK = [12, 14, 19];
const stripes = (x: number, y: number) => ((Math.floor((x + y) / 12) & 1) === 0 ? [60, 70, 90] : null);

describe("frame measures", () => {
	it("busyShare is 0 on a flat frame of any colour, small for one object, and near 1 on a filled frame", () => {
		expect(busyShare(frame(480, 270, CREAM), 480, 270)).toBe(0);
		expect(busyShare(frame(480, 270, INK), 480, 270)).toBe(0);
		const dot = busyShare(frame(480, 270, INK, (x, y) => (x < 40 && y < 40 ? CREAM : null)), 480, 270);
		expect(dot).toBeGreaterThan(0);
		expect(dot).toBeLessThan(0.025);
		expect(busyShare(frame(480, 270, INK, stripes), 480, 270)).toBeGreaterThan(0.9);
	});
	it("regionFill reports the empty half of a frame region by region (4 x 3, row by row)", () => {
		const half = regionFill(frame(480, 270, INK, (x, y) => (x < 240 ? stripes(x, y) : null)), 480, 270);
		expect(half).toHaveLength(12);
		for (let r = 0; r < 3; r++) {
			expect(half[r * 4]).toBeGreaterThan(0.5);
			expect(half[r * 4 + 1]).toBeGreaterThan(0.5);
			expect(half[r * 4 + 2]).toBe(0);
			expect(half[r * 4 + 3]).toBe(0);
		}
	});
	it("luminanceBand has no spread on a flat cream frame (which the near-black rule cannot see) and a wide one on a drawn frame", () => {
		const flat = luminanceBand(frame(64, 36, CREAM), 0.005, 0.995);
		expect(flat.high - flat.low).toBeLessThan(0.02);
		expect(flat.high).toBeGreaterThan(0.5);
		const drawn = luminanceBand(frame(64, 36, INK, stripes), 0.005, 0.995);
		expect(drawn.high - drawn.low).toBeGreaterThan(0.02);
	});
});

const rows = (count: number, make: (f: number) => Record<string, number>) => Array.from({ length: count }, (_, f) => ({ frame: f, ...make(f) }));
const spread = (flat: boolean) => ({ p005: flat ? 0.9 : 0.05, p995: flat ? 0.9 : 0.8 });

describe("FLAT-FRAME", () => {
	it("fails a middle run of empty frames longer than a second, in a light frame too", () => {
		const frames = rows(180, (f) => spread(f >= 60 && f < 135));
		const rule = flatFrameRule(frames, 30);
		expect(rule).toMatchObject({ id: "FLAT-FRAME", status: "FAIL" });
		expect(rule.detail).toContain("2.50 s");
		expect(rule.detail).toContain("from 2.00 s");
	});
	it("passes one second of it, and lets the opening and the close hold one second more", () => {
		expect(flatFrameRule(rows(180, (f) => spread(f >= 60 && f < 90)), 30).status).toBe("PASS");
		expect(flatFrameRule(rows(180, (f) => spread(f < 55 || f >= 125)), 30).status).toBe("PASS");
		expect(flatFrameRule(rows(180, (f) => spread(f < 65)), 30).status).toBe("FAIL");
	});
	it("is not applicable when the spread was not recorded", () => {
		expect(flatFrameRule(rows(10, () => ({ p995: 0.5 })), 30).status).toBe("N/A");
	});
});

describe("DEAD-AIR", () => {
	const busy = (dead: (f: number) => boolean) => rows(180, (f) => ({ busy: dead(f) ? 0.011 : 0.2 }));
	it("fails a run of near-empty frames longer than half a second", () => {
		const rule = deadAirRule(busy((f) => f >= 60 && f < 80), 30);
		expect(rule).toMatchObject({ id: "DEAD-AIR", status: "FAIL" });
		expect(rule.detail).toContain("0.67 s");
	});
	it("passes half a second, and a build from nothing at the opening or a fade at the close", () => {
		expect(deadAirRule(busy((f) => f >= 60 && f < 75), 30).status).toBe("PASS");
		expect(deadAirRule(busy((f) => f < 27), 30).status).toBe("PASS");
		expect(deadAirRule(busy((f) => f >= 180 - 30), 30).status).toBe("PASS");
		expect(deadAirRule(busy((f) => f < 28), 30).status).toBe("FAIL");
		expect(deadAirRule(busy((f) => f >= 180 - 34), 30).status).toBe("FAIL");
	});
	it("is not applicable when the busy share was not recorded", () => {
		expect(deadAirRule(rows(10, () => ({ p995: 0.5 })), 30).status).toBe("N/A");
	});
});

describe("RICH-FILL", () => {
	const full = Array.from({ length: 12 }, () => 0.6);
	const sparse = Array.from({ length: 12 }, (_, i) => (i < 5 ? 0.6 : 0.02));
	it("fails a rich film that leaves more than two regions empty in more than one shot", () => {
		const rule = richFillRule("rich", [{ beat: 0, regions: full }, { beat: 1, regions: sparse }, { beat: 2, regions: sparse }]);
		expect(rule).toMatchObject({ id: "RICH-FILL", status: "FAIL" });
		expect(rule.detail).toContain("beat 2 has 7 of 12 regions empty");
	});
	it("lets one shot breathe, passes two empty regions per shot, and skips a minimal film", () => {
		expect(richFillRule("rich", [{ beat: 0, regions: full }, { beat: 1, regions: sparse }]).status).toBe("PASS");
		const two = Array.from({ length: 12 }, (_, i) => (i < 2 ? 0.02 : 0.6));
		expect(richFillRule("rich", [{ beat: 0, regions: two }, { beat: 1, regions: two }, { beat: 2, regions: two }]).status).toBe("PASS");
		expect(richFillRule("minimal", [{ beat: 0, regions: sparse }, { beat: 1, regions: sparse }]).status).toBe("N/A");
	});
	it("is not applicable without a measurement", () => {
		expect(richFillRule("rich", []).status).toBe("N/A");
	});
});

const run = (text: string, rects: number[][], extra: Record<string, unknown> = {}) => ({ text, rects, decor: false, opacity: 1, ...extra });

describe("TEXT-OVERLAP", () => {
	it("flags two visible runs whose rects cover more than 8 % of the smaller one, with the frame", () => {
		const faults = overlapFaults([{ run: run("Back by three", [[200, 850, 700, 940]]), count: 900 }, { run: run("12:04", [[260, 860, 360, 910]]), count: 80 }], 120);
		expect(faults).toEqual(['"Back by three" x "12:04"@120']);
		expect(overlapFaults([{ run: run("a", [[0, 0, 100, 50]]), count: 90 }, { run: run("b", [[50, 0, 150, 50]]), count: 90 }], 7, true)[0]).toContain("@7 (cut)");
	});
	it("passes runs side by side, decor text and a pseudo-element run over its own element", () => {
		expect(overlapFaults([{ run: run("a", [[0, 0, 100, 50]]), count: 90 }, { run: run("b", [[110, 0, 210, 50]]), count: 90 }], 1)).toEqual([]);
		expect(overlapFaults([{ run: run("a", [[0, 0, 100, 50]]), count: 90 }, { run: run("tick", [[0, 0, 100, 50]], { decor: true }), count: 90 }], 1)).toEqual([]);
		expect(overlapFaults([{ run: run("a", [[0, 0, 100, 50]]), count: 90 }, { run: run("•", [[0, 0, 100, 50]], { pseudo: true }), count: 90 }], 1)).toEqual([]);
	});
});

describe("TEXT-ON-STYLE and TEXT-ZONE", () => {
	const style = readStyle("swiss-signal");
	const ok = { style, rich: false, format: "16:9", width: 1920, height: 1080, layout: "title", isCopy: true, frame: 40, box: [200, 420, 1500, 560] };
	const good = run("Tide pool at noon", [[200, 420, 1500, 560]], { color: "rgb(233, 235, 228)", family: "Archivo", fontSizePx: 128, gradient: false });
	const kinds = (extra: Record<string, unknown>, over: Record<string, unknown> = {}) => styleFaults({ ...ok, run: { ...good, ...extra }, ...over }).map((f: { kind: string }) => f.kind);
	it("passes copy on the style's colour, face and scale inside its zone", () => {
		expect(kinds({})).toEqual([]);
	});
	it("fails a colour off the style's text roles, and allows an accent colour only in a rich film", () => {
		expect(kinds({ color: "rgb(255, 61, 255)" })).toEqual(["colour"]);
		const accent = style.accents[0].color;
		const channels = [1, 3, 5].map((i) => Number.parseInt(accent.slice(i, i + 2), 16));
		expect(kinds({ color: `rgb(${channels.join(", ")})` })).toEqual(["colour"]);
		expect(kinds({ color: `rgb(${channels.join(", ")})` }, { rich: true })).toEqual([]);
	});
	it("fails a face outside the style and a size off its type scale", () => {
		expect(kinds({ family: "VT323" })).toEqual(["face"]);
		expect(kinds({ fontSizePx: 90 })).toEqual(["scale"]);
		expect(kinds({ fontSizePx: 90, family: "VT323", color: "rgb(255, 61, 255)" }).sort()).toEqual(["colour", "face", "scale"]);
	});
	it("holds other text to the scale as a warning only", () => {
		expect(kinds({ fontSizePx: 90 }, { isCopy: false })).toEqual(["scaleOther"]);
		expect(kinds({ family: "VT323", color: "rgb(1, 2, 3)" }, { isCopy: false })).toEqual([]);
	});
	it("fails copy outside the shot's type zone, and any copy in a full shot", () => {
		expect(kinds({}, { layout: "split", box: [1200, 400, 1700, 480] })).toEqual(["zone"]);
		expect(kinds({}, { layout: "split", box: [160, 400, 700, 480] })).toEqual([]);
		expect(kinds({}, { layout: "full" })).toEqual(["zone"]);
		expect(kinds({}, { layout: "stage", format: "16:9", box: [200, 420, 1500, 560] })).toEqual(["zone"]);
	});
	it("builds the three rules from the findings", () => {
		const none = { overlap: [], colour: [], face: [], scale: [], scaleOther: [], zone: [] };
		expect(styleRules({ style, format: "16:9", found: none, crossed: true }).map((r: { id: string; status: string }) => `${r.id} ${r.status}`)).toEqual(["TEXT-OVERLAP PASS", "TEXT-ON-STYLE PASS", "TEXT-ZONE PASS"]);
		const bad = styleRules({ style, format: "16:9", found: { ...none, overlap: ['"a" x "b"@3'], colour: ['"x"@1 rgb(1, 2, 3)'], zone: ['"y"@2 outside the split type zone'] }, crossed: false });
		expect(bad.map((r: { status: string }) => r.status)).toEqual(["FAIL", "FAIL", "FAIL"]);
		expect(bad[1].detail).toContain("colour off the swiss-signal text roles");
		expect(styleRules({ style, format: "16:9", found: { ...none, scaleOther: ['"z"@1 90px'] }, crossed: false })[1].status).toBe("WARN");
	});
});

describe("QA samples", () => {
	const treatment = { beats: [{ t0: 0, t1: 2 }, { t0: 2, t1: 4 }, { t0: 4, t1: 6 }] };
	it("adds every second frame within 0.4 s of each cut as a cut sample", () => {
		const samples = qaSamples(treatment, 30, 180, { cuts: true });
		const cuts = [...samples].filter(([, s]) => s.kind === "cut").map(([f]) => f);
		expect(cuts).toContain(48);
		expect(cuts).toContain(72);
		expect(Math.min(...cuts.filter((f) => f > 30 && f < 90))).toBe(48);
		expect(cuts.every((f) => f % 2 === 0)).toBe(true);
		expect(samples.get(48)).toMatchObject({ beat: 0 });
		expect(samples.get(66)).toMatchObject({ beat: 1 });
		expect([...qaSamples(treatment, 30, 180)].some(([, s]) => s.kind === "cut")).toBe(false);
	});
	it("takes only the midpoints and the cut frames for a board", () => {
		const samples = qaSamples(treatment, 30, 180, { cuts: true, board: true });
		expect([...samples.values()].some((s) => s.kind === "settled")).toBe(false);
		expect([...samples].filter(([, s]) => s.kind === "mid").map(([f]) => f)).toEqual([30, 90, 150]);
		expect(BOARD_RULES).toEqual(["TEXT-OVERLAP", "TEXT-ON-STYLE", "TEXT-ZONE"]);
	});
});

const ready = (context: { skip: (reason: string) => void }) => {
	if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), false;
	if (!CHROME) return context.skip("Chrome not installed on this host"), false;
	return true;
};
type Beats = [number, number][];
function styled(lines: string[], layouts: string[], beats: Beats, durationSec: number, register: "rich" | "minimal" = "rich") {
	const base = stageTreatment({ durationSec, fps: 30, beats, lines });
	return { ...base, style: "swiss-signal", register, beats: base.beats.map((beat: Record<string, unknown>, i: number) => ({ ...beat, layout: layouts[i], hero: "subject", transition: "cut" })) };
}
function drive(page: string, treatment: unknown, mode = "full") {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-gates-")));
	temps.push(dir);
	const out = join(dir, "out");
	mkdirSync(join(out, "stage"), { recursive: true });
	cpSync(join(PAGES, page), join(out, "stage"), { recursive: true });
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	const result = spawnSync(process.execPath, [DRIVER, out, mode], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") }, timeout: 800000 });
	const report = existsSync(join(out, "gate-report.txt")) ? readFileSync(join(out, "gate-report.txt"), "utf8") : "";
	return { out, result, report };
}
const line = (report: string, id: string) => report.split("\n").find((l) => l.trimStart().startsWith(`${id} `)) ?? "";
const COPY = ["Tide pool at noon", "Low water", "Back by three"];
const SPANS: Beats = [[0, 2], [2, 4], [4, 6]];

describe("the gate rules on real pages", { timeout: 900000 }, () => {
	it("passes a rich film that is on its house style, in its zones, with nothing over anything and no empty frame", (context) => {
		if (!ready(context)) return;
		const { result, report, out } = drive("gates-good", styled(COPY, ["title", "split", "stage"], SPANS, 6));
		expect(result.status, `${result.stderr}\n${report}`).toBe(0);
		for (const id of ["TEXT-OVERLAP", "TEXT-ON-STYLE", "TEXT-ZONE", "FLAT-FRAME", "DEAD-AIR", "RICH-FILL", "MO-D-03"]) expect(line(report, id), id).toMatch(/PASS/u);
		const log = readFileSync(join(out, "render.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.frame !== undefined);
		expect(log).toHaveLength(180);
		expect(log.every((l) => typeof l.p005 === "number" && typeof l.busy === "number" && l.busy > 0.5)).toBe(true);
	});
	it("fails copy off the style's colour, face, size and zone, text over text and a rich film that leaves its frame empty", (context) => {
		if (!ready(context)) return;
		const { result, report } = drive("gates-bad", styled(COPY, ["title", "split", "stage"], SPANS, 6));
		expect(result.status, result.stderr).toBe(EXIT.GATE_FAIL_QA);
		expect(line(report, "TEXT-ON-STYLE")).toMatch(/FAIL .*colour off the swiss-signal.*face outside the style.*size off the type scale/u);
		expect(line(report, "TEXT-ZONE")).toMatch(/FAIL .*Low water.*outside the split type zone/u);
		expect(line(report, "TEXT-OVERLAP")).toMatch(/FAIL .*Back by three.*12:04/u);
		expect(line(report, "RICH-FILL")).toMatch(/FAIL .*2 of 3 beat midpoints leave the frame empty/u);
	});
	it("names text that crosses at a cut, which no beat midpoint shows, in the board check", (context) => {
		if (!ready(context)) return;
		const treatment = styled(COPY.slice(0, 2), ["title", "title"], [[0, 2], [2, 4]], 4);
		const { result, out } = drive("gates-cut", treatment, "board");
		expect(result.status, result.stderr).toBe(0);
		const board = JSON.parse(readFileSync(join(out, "board-qa.json"), "utf8"));
		expect(board.rules.map((r: { id: string }) => r.id)).toEqual(["TEXT-OVERLAP", "TEXT-ON-STYLE", "TEXT-ZONE"]);
		const overlap = board.rules[0];
		expect(overlap.status).toBe("FAIL");
		expect(overlap.detail).toContain("(cut)");
		expect(board.perBeat).toHaveLength(2);
		expect(board.perBeat.flatMap((b: { overlap: string[] }) => b.overlap).length).toBeGreaterThan(0);
	});
	it("fails a light frame with nothing on it for 2.5 s although the near-black rule passes", (context) => {
		if (!ready(context)) return;
		const { result, report } = drive("gates-flat", stageTreatment({ durationSec: 6, fps: 30, lines: [COPY[0]] }));
		expect(result.status, result.stderr).toBe(EXIT.GATE_FAIL_QA);
		expect(line(report, "FLAT-FRAME")).toMatch(/FAIL .*2\.5\d s of empty frames from 2\.00 s/u);
		expect(line(report, "MO-D-03")).toMatch(/PASS/u);
	});
	it("fails two seconds of one round object on the ground (not flat, still empty)", (context) => {
		if (!ready(context)) return;
		const { result, report } = drive("gates-dead", stageTreatment({ durationSec: 6, fps: 30, lines: [COPY[0]] }));
		expect(result.status, result.stderr).toBe(EXIT.GATE_FAIL_QA);
		expect(line(report, "DEAD-AIR")).toMatch(/FAIL .*near-empty frames from 2\.00 s/u);
		expect(line(report, "FLAT-FRAME")).toMatch(/PASS/u);
	});
});

describe("film look rounds: the turn question and defects", () => {
	const FILES = ["beat-01.png", "beat-02.png", "beat-03.png", "cut-01-02.png", "cut-02-03.png", "contact-sheet.png", "poster.png"];
	function setup(story: boolean) {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-gates-look-")));
		temps.push(dir);
		const stills = join(dir, "stills");
		mkdirSync(stills, { recursive: true });
		const files = FILES.map((file, i) => {
			writeFileSync(join(stills, file), `png-${i}`);
			return { file, sha256: "", kind: file.startsWith("beat") ? "beat" : "x", frames: [i] };
		});
		for (const f of files) f.sha256 = createHash("sha256").update(readFileSync(join(stills, f.file))).digest("hex");
		writeFileSync(join(stills, "manifest.json"), JSON.stringify({ schema: 1, kind: "stills-only", round: 1, width: 1920, height: 1080, fps: 30, files }));
		writeFileSync(join(dir, "treatment.json"), JSON.stringify({ ...stageTreatment(), ...(story ? { story: { expect: "a", turn: "the crab turns", beat: 1, payoff: "p" } } : { story: undefined }) }));
		return dir;
	}
	const sentence = (file: string) => `In ${file} the drawn basin is clearly visible against the dark ground.`;
	function answers(count: number, turnFrame = "beat-02.png", extra: Record<string, unknown> = {}) {
		return {
			viewed: FILES,
			weakestBeat: 2,
			change: "moved the basin lower",
			answers: Array.from({ length: count }, (_, i) => {
				const q = i + 1;
				const frame = q === 10 ? turnFrame : q === 1 ? "contact-sheet.png" : FILES[i % 3];
				return { q, verdict: [4, 7, 8, 9].includes(q) ? "no" : "yes", frame, observed: q === 1 ? "A stranger would say this film is for: people on a coast walk." : sentence(frame) };
			}),
			...extra,
		};
	}
	const write = (dir: string, body: unknown) => {
		const file = join(dir, "answers.json");
		writeFileSync(file, JSON.stringify(body));
		return file;
	};
	it("asks the tenth question of a film with a story, on the turn beat's own still", () => {
		const dir = setup(true);
		expect(() => recordLook(dir, 1, write(dir, answers(9)))).toThrow(/question 10 is not answered/u);
		expect(() => recordLook(dir, 1, write(dir, answers(10, "beat-03.png")))).toThrow(/answer it on the turn shot's still beat-02\.png/u);
		const entry = recordLook(dir, 1, write(dir, answers(10)));
		expect(entry.answers).toHaveLength(10);
		expect(entry.needsAnotherRound).toBe(false);
	});
	it("asks for another round when the turn does not land", () => {
		const dir = setup(true);
		const body = answers(10);
		body.answers[9].verdict = "no";
		expect(recordLook(dir, 1, write(dir, body))).toMatchObject({ needsAnotherRound: true, openItems: [expect.stringMatching(/^Q10:/u)] });
	});
	it("keeps nine questions for a treatment without a story, and refuses a tenth", () => {
		const dir = setup(false);
		expect(() => recordLook(dir, 1, write(dir, answers(10)))).toThrow(/unknown question 10/u);
		expect(recordLook(dir, 1, write(dir, answers(9))).answers).toHaveLength(9);
	});
	it("records up to three timed defects on a film round, each with a time, a region and a frame", () => {
		const dir = setup(true);
		const defect = { t: 2.5, region: [100, 200, 300, 120], frame: "beat-02.png", observed: "The caption overlaps the crab shell at the left edge of the basin.", cause: "the caption box sits inside the subject zone", fix: "move the caption into the type zone" };
		const entry = recordLook(dir, 1, write(dir, answers(10, "beat-02.png", { defects: [defect] })));
		expect(entry.defects).toEqual([defect]);
		expect(Object.keys(entry.frames)).toContain("beat-02.png");
		const again = setup(true);
		expect(() => recordLook(again, 1, write(again, answers(10, "beat-02.png", { defects: [{ ...defect, t: 99 }] })))).toThrow(/defect 1: t must be the time in seconds/u);
		expect(() => recordLook(again, 1, write(again, answers(10, "beat-02.png", { defects: [defect, defect, defect, defect] })))).toThrow(/at most 3 defects/u);
	});
});
