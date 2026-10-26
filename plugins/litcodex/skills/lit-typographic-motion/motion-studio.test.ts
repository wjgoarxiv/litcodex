import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT, Exit } from "./engine/constants.mjs";
import { BOARD, boardGrid, boardHtml } from "./engine/board.mjs";
import { demoPage, demoTreatment } from "./engine/gallery.mjs";
import { HOUSE_SCHEMA, readHouse, recordHouse } from "./engine/house.mjs";
import { linesPerShot, scaffoldCommand, scaffoldHtml } from "./engine/scaffold.mjs";
import { LAYOUT_IDS, LAYOUTS, pickStyle, readStyle, STYLE_IDS, sameBed, styleScript } from "./engine/styles.mjs";
import { TreatmentError, validateTreatment } from "./engine/treatment.mjs";
import { parseArgs, USAGE } from "./scripts/render.mjs";
import { RICH_REQUEST, richStage } from "./fixtures/rich-treatment.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// House styles as data, the style rules in the treatment validator, the layout grid, the scaffold, the
// board page, the gallery's demo and the new CLI modes. Chrome is not needed here; the board round on a
// real page is in motion-board.test.ts.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const temps: string[] = [];
const temp = (prefix: string) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	temps.push(dir);
	return dir;
};
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, any>;
function fieldOf(t: Json, options: Json = {}): string {
	try {
		validateTreatment(t, options);
	} catch (error) {
		expect(error).toBeInstanceOf(TreatmentError);
		return (error as TreatmentError).field;
	}
	return "";
}
const withBeat = (t: Json, i: number, patch: Json): Json => ({ ...t, beats: t.beats.map((b: Json, k: number) => (k === i ? { ...b, ...patch } : b)) });

describe("house styles are data", () => {
	it("ships four, each loaded from styles/<id>.json under its own schema", () => {
		expect(STYLE_IDS).toEqual(["swiss-signal", "tidal", "terminalcore", "paper"]);
		for (const id of STYLE_IDS) {
			const style = readStyle(id);
			expect(style.id).toBe(id);
			expect(style.schema).toBe("litcodex.motion-style/v1");
			expect(Object.keys(style.scale)).toEqual(["16:9", "9:16"]);
			expect(style.beds.some((bed: Json) => sameBed(bed, style.sound))).toBe(true);
			expect(style.accents.length).toBeGreaterThanOrEqual(3);
		}
	});
	it("keeps the three type presets and leaves paper stage-only", () => {
		expect(STYLE_IDS.filter((id) => readStyle(id).typePreset)).toEqual(["swiss-signal", "tidal", "terminalcore"]);
		expect(readStyle("paper").typePreset).toBeFalsy();
	});
	it("gives each style its own hand-offs, beds and faces", () => {
		expect(readStyle("terminalcore").transitions).toEqual(["cut", "wipe"]);
		expect(readStyle("paper").transitions).toContain("iris");
		expect(readStyle("tidal").transitions).toContain("dissolve");
		const beds = STYLE_IDS.map((id) => JSON.stringify(readStyle(id).beds));
		expect(new Set(beds).size).toBe(4);
		expect(readStyle("terminalcore").faces.display.family).toBe("VT323");
		expect(readStyle("paper").faces.display.family).toBe("Pretendard");
	});
	it("serves the layout zones and shot timeline to the page as /lit/style.js", () => {
		const t = richStage();
		const js = styleScript(readStyle("paper"), "16:9", t);
		expect(js).toContain("LitStyle");
		expect(js).toContain("LitTimeline");
		for (const layout of LAYOUT_IDS) expect(js).toContain(`"${layout}"`);
	});
});

describe("the style is a rule, not a pick", () => {
	it("takes a style the request names, then the house, then a keyword, then the genre, then the default", () => {
		const base = { path: "stage", house: null, genre: null };
		expect(pickStyle({ ...base, request: "make a terminalcore film" }).id).toBe("terminalcore");
		expect(pickStyle({ ...base, request: "make a film in the paper style" }).id).toBe("paper");
		expect(pickStyle({ ...base, request: "make a tidal film", house: { style: "paper" } }).id).toBe("tidal");
		expect(pickStyle({ ...base, request: "make a film", house: { style: "paper" } })).toMatchObject({ id: "paper", source: "house" });
		expect(pickStyle({ ...base, request: "a hacker terminal intro" })).toMatchObject({ id: "terminalcore", source: "keyword" });
		expect(pickStyle({ ...base, request: "a calm wave film" }).id).toBe("tidal");
		expect(pickStyle({ ...base, request: "a cozy handmade story" }).id).toBe("paper");
		expect(pickStyle({ ...base, request: "explain tax", genre: "explainer" })).toMatchObject({ id: "paper", source: "genre" });
		expect(pickStyle({ ...base, request: "a launch film", genre: "brand-mood" }).id).toBe("tidal");
		expect(pickStyle({ ...base, request: "a launch film" })).toMatchObject({ id: "swiss-signal", source: "default" });
	});
	it("skips paper on the type path, which has no preset for it", () => {
		expect(pickStyle({ request: "a cozy handmade poem", path: "type" }).id).toBe("swiss-signal");
		expect(pickStyle({ request: "explain tax", path: "type", genre: "explainer" }).id).toBe("swiss-signal");
	});
	it("refuses a style other than the one the rules choose, naming the style field", () => {
		const t = richStage();
		expect(fieldOf({ ...t, style: "tidal" })).toBe("style");
		expect(fieldOf({ ...t, style: "no-such-style" })).toBe("style");
		const { style, ...missing } = t;
		expect(fieldOf(missing)).toBe("style");
	});
	it("holds a new film to the project's house style unless the request names another", () => {
		const t = { ...richStage(), request: "make a short explainer video about a rain garden lit" };
		expect(fieldOf({ ...t, style: "paper" })).toBe("");
		expect(fieldOf({ ...t, style: "paper" }, { house: { style: "tidal" } })).toBe("style");
		expect(fieldOf({ ...t, request: `${t.request} in the paper style`, style: "paper" }, { house: { style: "tidal" } })).toBe("");
	});
});

describe("the register is the request's", () => {
	it("is rich unless the request asks for calm, and then it is minimal", () => {
		expect(fieldOf(richStage())).toBe("");
		expect(fieldOf({ ...richStage(), register: "minimal" })).toBe("register");
		expect(fieldOf({ ...richStage(), register: "bold" })).toBe("register");
		const calm = stageTreatment();
		expect(fieldOf(calm)).toBe("");
		expect(fieldOf({ ...calm, register: "rich" })).toBe("register");
	});
	it("requires a layered world with labels and camera moves in a rich stage film", () => {
		const t = richStage();
		const { world, ...none } = t;
		expect(fieldOf(none)).toBe("world");
		expect(fieldOf({ ...t, world: { ...t.world, layers: t.world.layers.slice(0, 2) } })).toBe("world.layers");
		expect(fieldOf({ ...t, world: { ...t.world, labels: t.world.labels.slice(0, 5) } })).toBe("world.labels");
		expect(fieldOf({ ...t, world: { ...t.world, camera: t.world.camera.slice(0, 1) } })).toBe("world.camera");
	});
	it("does not ask a minimal film for a world", () => {
		expect(stageTreatment().world).toBeUndefined();
		expect(fieldOf(stageTreatment())).toBe("");
	});
	it("gives a rich film a score and a minimal film the style's preset bed", () => {
		const t = richStage();
		expect(fieldOf({ ...t, sound: { ...t.sound, mode: "generated", palette: "felt", key: "F major", tempo: 96 } })).toBe("sound.mode");
		const calm = stageTreatment();
		expect(fieldOf({ ...calm, sound: { ...calm.sound, palette: "pulse" } })).toBe("sound.palette");
		expect(fieldOf({ ...calm, sound: { ...calm.sound, tempo: 85 } })).toBe("sound.palette");
	});
	it("accepts a 3D score in the style's own genre and refuses one outside the list", () => {
		const t = richStage();
		expect(fieldOf({ ...t, sound: { ...t.sound, genre: "garage" } })).toBe("");
		expect(fieldOf({ ...t, sound: { ...t.sound, genre: "polka" } })).toBe("sound.genre");
	});
});

describe("shots on the layout grid", () => {
	it("knows six layouts, each with zones for both formats", () => {
		expect(LAYOUT_IDS).toEqual(["title", "split", "split-alt", "stage", "hero", "full"]);
		for (const format of ["16:9", "9:16"]) for (const id of LAYOUT_IDS) expect(LAYOUTS[format][id]).toHaveProperty("subject");
		expect(LAYOUTS["16:9"].full.type).toBeNull();
	});
	it("keeps every type zone inside the title-safe area", () => {
		for (const format of ["16:9", "9:16"])
			for (const id of LAYOUT_IDS) {
				const z = LAYOUTS[format][id].type;
				if (!z) continue;
				expect(z[0]).toBeGreaterThanOrEqual(0.05 - 1e-9);
				expect(z[1]).toBeGreaterThanOrEqual(0.05 - 1e-9);
				expect(z[0] + z[2]).toBeLessThanOrEqual(0.95 + 1e-9);
				expect(z[1] + z[3]).toBeLessThanOrEqual(0.95 + 1e-9);
			}
	});
	it("documents the same zones the code uses", () => {
		const doc = readFileSync(join(skillRoot, "references", "studio.md"), "utf8");
		for (const id of LAYOUT_IDS) {
			expect(doc).toContain(`\`${id}\``);
			const z = LAYOUTS["16:9"][id].type;
			if (z) expect(doc).toContain(z.map((n: number) => n.toFixed(2)).join(", "));
		}
	});
	it.each(["layout", "hero", "transition"])("refuses a stage shot with no %s", (key) => {
		const t = richStage();
		const beats = t.beats.map((b: Json, i: number) => (i === 1 ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== key)) : b));
		expect(fieldOf({ ...t, beats })).toBe(`beats[1].${key}`);
	});
	it("refuses an unknown layout and a hand-off the style does not use", () => {
		const t = richStage();
		expect(fieldOf(withBeat(t, 1, { layout: "diagonal" }))).toBe("beats[1].layout");
		expect(fieldOf(withBeat(t, 0, { transition: "dissolve" }))).toBe("beats[0].transition");
		expect(fieldOf(withBeat(t, 3, { transition: "cut" }))).toBe("beats[3].transition");
	});
	it("refuses two adjacent shots on one layout, and a long film on two layouts", () => {
		const t = richStage();
		expect(fieldOf(withBeat(t, 1, { layout: "title" }))).toBe("beats[1].layout");
		const two = { ...t, beats: t.beats.map((b: Json, i: number) => ({ ...b, layout: i % 2 ? "split" : "title" })) };
		expect(fieldOf(two)).toBe("beats");
	});
	it("refuses copy lines on a full shot and indices outside the copy", () => {
		const t = richStage();
		expect(fieldOf(withBeat(withBeat(t, 1, { layout: "full" }), 1, { lines: [0] }))).toBe("beats[1].lines");
		expect(fieldOf(withBeat(t, 1, { lines: [9] }))).toBe("beats[1].lines");
		expect(fieldOf(withBeat(t, 1, { lines: [1] }))).toBe("");
	});
	it("keeps the stage palette and faces to the style's own", () => {
		const t = richStage();
		expect(fieldOf({ ...t, palette: [...t.palette.slice(0, 3), { hex: "#FF00FF", role: "neon" }] })).toBe("palette[3].hex");
		expect(fieldOf({ ...t, typePlan: { ...t.typePlan, faces: ["VT323"] } })).toBe("typePlan.faces");
	});
});

describe("the scaffold", () => {
	const rich = richStage();
	const page = scaffoldHtml(rich);
	it("writes the COPY block, one section per shot and one DRAW per shot", () => {
		expect(page).toContain("const COPY = [");
		for (const line of rich.copy.lines) expect(page).toContain(JSON.stringify(line));
		expect(page.match(/<section class="shot"/gu)).toHaveLength(rich.beats.length);
		expect(page.match(/\(s, svg, t\) => \{\},/gu)).toHaveLength(rich.beats.length);
		expect(page).toMatch(/define\(\{ width: 1920, height: 1080, fps: 60, duration: 16/u);
	});
	it("loads the style's css and js and places every shot's type and subject in its zones", () => {
		for (const route of ["/lit/fonts.css", "/lit/style.css", "/lit/style.js", "/lit/stage-kit.js"]) expect(page).toContain(route);
		expect(page).toContain('place(el.querySelector(\'[data-zone="subject"]\'), BEATS[i].layout, "subject")');
		expect(page).toContain('data-zone="type"');
	});
	it("writes only the hand-offs the style can use, never invents a library", () => {
		expect(page).not.toMatch(/<script[^>]+src="https?:/u);
		expect(page).not.toContain("three");
	});
	it("spreads copy over the shots with a type zone, first line first and last line last", () => {
		expect(linesPerShot({ beats: [{ layout: "title" }, { layout: "full" }, { layout: "stage" }], copy: { lines: ["a", "b", "c"] } })).toEqual([[0], [], [1, 2]]);
		expect(linesPerShot({ beats: [{ layout: "title" }, { layout: "split" }], copy: { lines: ["a", "b"] } })).toEqual([[0], [1]]);
		expect(linesPerShot({ beats: [{ layout: "title", lines: [1] }, { layout: "split", lines: [0] }], copy: { lines: ["a", "b"] } })).toEqual([[1], [0]]);
	});
	it("adds the three.js world for a 3D film only: import map, canvas, protagonist group, one WORLD per shot", () => {
		const solid = scaffoldHtml({ ...rich, depth: "3d" });
		expect(solid).toContain('"three": "/lit/three/three.module.js"');
		expect(solid).toContain('<canvas id="world"');
		expect(solid).toContain("const HERO = new THREE.Group()");
		expect(solid.match(/\(s, hero, cam, t\) => \{\},/gu)).toHaveLength(rich.beats.length);
		expect(page).not.toContain("importmap");
	});
	it("fits a 9:16 film to its own frame", () => {
		const vertical = scaffoldHtml({ ...stageTreatment({ format: "9:16" }) });
		expect(vertical).toMatch(/width: 1080, height: 1920/u);
	});
	it("writes <out>/stage/index.html from treatment.json and never replaces a page", () => {
		const out = temp("motion-scaffold-");
		writeFileSync(join(out, "treatment.json"), JSON.stringify(rich));
		const message = scaffoldCommand({ out, env: {} });
		expect(message).toContain("SCAFFOLD:");
		expect(message).toContain("--stills-only");
		expect(readFileSync(join(out, "stage", "index.html"), "utf8")).toBe(page);
		writeFileSync(join(out, "stage", "index.html"), "mine");
		expect(() => scaffoldCommand({ out, env: {} })).toThrow(/never overwrites/u);
		expect(readFileSync(join(out, "stage", "index.html"), "utf8")).toBe("mine");
	});
});

describe("the board page", () => {
	it("fits every shot count and both formats inside the usable area", () => {
		const usableW = BOARD.width - 2 * BOARD.margin;
		const usableH = BOARD.height - BOARD.header - BOARD.footer - BOARD.margin;
		for (const [w, h] of [[1920, 1080], [1080, 1920]])
			for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
				const g = boardGrid(n, w, h);
				expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
				expect(g.cols * g.tw + (g.cols - 1) * BOARD.gap, `${n} @ ${w}x${h}`).toBeLessThanOrEqual(usableW);
				expect(g.rows * (g.th + BOARD.caption) + (g.rows - 1) * BOARD.gap, `${n} @ ${w}x${h}`).toBeLessThanOrEqual(usableH);
				expect(Math.abs(g.tw / g.th - w / h)).toBeLessThan(0.02);
			}
	});
	it("shows the style, the shots with their layout and hand-off, the type zone and the verdict", () => {
		const t = richStage();
		const html = boardHtml({ treatment: t, stills: t.beats.map((_: Json, i: number) => `s0${i + 1}.png`), check: { rules: [{ id: "TEXT-OVERLAP", status: "PASS" }] } });
		expect(html).toContain("Paper Aa");
		expect(html).toContain("16:9");
		for (const b of t.beats) expect(html).toContain(b.layout);
		expect(html.match(/class="zone"/gu)).toHaveLength(t.beats.length);
		expect(html).toContain("layout check: PASS");
		expect(html).toContain("score (garage)");
	});
	it("names the failed rules in its footer and says when no check ran", () => {
		const t = richStage();
		const stills = t.beats.map((_: Json, i: number) => `s0${i + 1}.png`);
		expect(boardHtml({ treatment: t, stills, check: { rules: [{ id: "TEXT-ZONE", status: "FAIL" }, { id: "TEXT-OVERLAP", status: "PASS" }] } })).toContain("layout check: FAIL — TEXT-ZONE");
		expect(boardHtml({ treatment: t, stills })).toContain("not run on this render");
	});
	it("draws no zone box for a shot with no type zone and escapes the film's words", () => {
		const t = withBeat(richStage(), 1, { layout: "full", hero: "<script>alert(1)</script>" });
		const html = boardHtml({ treatment: t, stills: ["a.png", "b.png", "c.png", "d.png"] });
		expect(html.match(/class="zone"/gu)).toHaveLength(3);
		expect(html).not.toContain("<script>alert");
		expect(html).toContain("&lt;script&gt;");
	});
});

describe("the style gallery's demo", () => {
	it.each(STYLE_IDS.flatMap((id) => ["16:9", "9:16"].map((format) => [id, format])))("is a valid %s treatment at %s", (id, format) => {
		const t = demoTreatment(id, format);
		expect(() => validateTreatment(t, { examples: [] })).not.toThrow();
		expect(t.style).toBe(id);
		expect(t.beats.map((b: Json) => b.layout)).toEqual(["title", "split", "split-alt", "stage"]);
	});
	it("hands off with each style's own words and sounds its own bed", () => {
		const hands = (id: string) => demoTreatment(id).beats.slice(0, 3).map((b: Json) => b.transition);
		expect(hands("terminalcore")).toEqual(["cut", "wipe", "cut"]);
		expect(new Set(STYLE_IDS.map((id) => hands(id).join())).size).toBeGreaterThanOrEqual(3);
		const bpm = STYLE_IDS.map((id) => demoTreatment(id).sound.tempo);
		expect(new Set(bpm).size).toBe(4);
	});
	it("fills every DRAW slot of the scaffold, so the board shows a drawing", () => {
		const t = demoTreatment("paper");
		expect(scaffoldHtml(t).match(/\(s, svg, t\) => \{\},/gu)).toHaveLength(4);
		const page = demoPage(t);
		expect(page).not.toMatch(/\(s, svg, t\) => \{\},/u);
		expect(page.match(/^ {4}\(s, svg\) => \{$/gmu)).toHaveLength(4);
	});
});

describe("the house file", () => {
	it("records a passed film beside the output folder and holds the next film to its style", () => {
		const root = temp("motion-house-");
		const out = join(root, "film-1");
		mkdirSync(out);
		expect(readHouse(out)).toBeNull();
		const house = recordHouse(out, { style: "tidal", path: "stage", format: "16:9", durationSec: 12 });
		expect(house.schema).toBe(HOUSE_SCHEMA);
		expect(JSON.parse(readFileSync(join(root, "motion-house.json"), "utf8")).style).toBe("tidal");
		expect(readHouse(join(root, "film-2"))).toMatchObject({ style: "tidal" });
		recordHouse(join(root, "film-2"), { style: "paper", path: "stage", format: "16:9", durationSec: 10 });
		const again = readHouse(out);
		expect(again.style).toBe("tidal");
		expect(again.films.map((f: Json) => f.dir)).toEqual(["film-1", "film-2"]);
	});
	it("replaces a film re-rendered in the same folder and ignores a file it does not know", () => {
		const root = temp("motion-house-bad-");
		const out = join(root, "film");
		recordHouse(out, { style: "paper", path: "stage", format: "16:9", durationSec: 10 });
		recordHouse(out, { style: "paper", path: "stage", format: "9:16", durationSec: 11 });
		expect(readHouse(out).films).toHaveLength(1);
		writeFileSync(join(root, "motion-house.json"), JSON.stringify({ schema: "other/v1", style: "paper" }));
		expect(readHouse(out)).toBeNull();
		writeFileSync(join(root, "motion-house.json"), "{not json");
		expect(readHouse(out)).toBeNull();
	});
});

describe("the render CLI's new modes", () => {
	it("lists scaffold and styles in its usage and takes them as modes", () => {
		expect(USAGE).toContain("render.mjs scaffold --out <dir>");
		expect(USAGE).toContain("render.mjs styles --out <dir> [--format 16:9|9:16]");
		expect(parseArgs(["scaffold", "--out", "/o"])).toMatchObject({ mode: "scaffold", out: "/o" });
		expect(parseArgs(["styles", "--out", "/o", "--format", "9:16"])).toMatchObject({ mode: "styles", out: "/o", format: "9:16" });
	});
	it("treats --format as a value and refuses it without one", () => {
		expect(() => parseArgs(["styles", "--out", "/o", "--format"])).toThrow(/--format needs a value/u);
	});
	const run = (args: string[]) => spawnSync(process.execPath, [RENDER, ...args], { encoding: "utf8", timeout: 60000 });
	it("scaffold without --out exits 2 and names the switch", () => {
		const r = run(["scaffold"]);
		expect(r.status).toBe(EXIT.USAGE);
		expect(r.stderr).toContain("--out <dir> is required");
	});
	it("scaffold on an invalid treatment exits 16 naming the field and writes no page", () => {
		const out = temp("motion-scaffold-bad-");
		writeFileSync(join(out, "treatment.json"), JSON.stringify({ ...richStage(), style: "tidal" }));
		const r = run(["scaffold", "--out", out]);
		expect(r.status).toBe(EXIT.BLOCKED_TREATMENT_INVALID);
		expect(r.stderr).toContain("style:");
		expect(existsSync(join(out, "stage", "index.html"))).toBe(false);
	});
	it("scaffold writes the page, prints the next command, and refuses to run twice", () => {
		const out = temp("motion-scaffold-ok-");
		writeFileSync(join(out, "treatment.json"), JSON.stringify(richStage()));
		const first = run(["scaffold", "--out", out]);
		expect(first.status, first.stderr).toBe(EXIT.OK);
		expect(first.stdout).toContain("--stills-only");
		expect(readFileSync(join(out, "stage", "index.html"), "utf8")).toBe(scaffoldHtml(richStage()));
		expect(run(["scaffold", "--out", out]).status).toBe(EXIT.USAGE);
	});
	it("scaffold on a type-path treatment exits 2 and points at film", () => {
		const out = temp("motion-scaffold-type-");
		const t = { ...stageTreatment(), path: "type" };
		writeFileSync(join(out, "treatment.json"), JSON.stringify(t));
		const r = run(["scaffold", "--out", out]);
		expect([EXIT.USAGE, EXIT.BLOCKED_TREATMENT_INVALID]).toContain(r.status);
	});
	it("styles without --out exits 2, and a bad --format exits 2 before any render", () => {
		expect(run(["styles"]).status).toBe(EXIT.USAGE);
		const r = run(["styles", "--out", temp("motion-styles-"), "--format", "4:3"]);
		expect(r.status).toBe(EXIT.USAGE);
		expect(r.stderr).toContain("--format is 16:9 or 9:16");
	});
	it("a bare Exit carries its code", () => {
		expect(new Exit(EXIT.USAGE, "x").code).toBe(EXIT.USAGE);
	});
});
