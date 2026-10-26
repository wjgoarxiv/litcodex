import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkProductFiles } from "./engine/assets.mjs";
import { EXIT } from "./engine/constants.mjs";
import { TreatmentError, validateTreatment } from "./engine/treatment.mjs";
import { richStage } from "./fixtures/rich-treatment.mjs";
import { stageTreatment, typeTreatment } from "./fixtures/treatments.mjs";

// The story, the protagonist, a named product and the preview switch: what makes a treatment a film
// about something rather than a list of shots.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, any>;
function fieldOf(t: Json): string {
	try {
		validateTreatment(t);
	} catch (error) {
		expect(error).toBeInstanceOf(TreatmentError);
		return (error as TreatmentError).field;
	}
	return "";
}
const without = (t: Json, key: string): Json => Object.fromEntries(Object.entries(t).filter(([k]) => k !== key));

describe("story", () => {
	it("is required, with an expectation, a turn, a shot and a payoff", () => {
		const t = richStage();
		expect(fieldOf(without(t, "story"))).toBe("story");
		expect(fieldOf({ ...t, story: "a drop falls" })).toBe("story");
		for (const key of ["expect", "turn", "payoff"]) expect(fieldOf({ ...t, story: { ...t.story, [key]: "" } }), key).toBe(`story.${key}`);
		expect(fieldOf({ ...t, story: { ...t.story, beat: undefined } })).toBe("story.beat");
	});
	it("refuses a turn that is the expectation, a placeholder and a story told in paragraphs", () => {
		const t = richStage();
		expect(fieldOf({ ...t, story: { ...t.story, turn: t.story.expect } })).toBe("story.turn");
		expect(fieldOf({ ...t, story: { ...t.story, turn: "<what happens instead>" } })).toBe("story.turn");
		expect(fieldOf({ ...t, story: { ...t.story, payoff: "One. Two. Three." } })).toBe("story.payoff");
	});
	it("lands the turn after the opening and before the end of the film", () => {
		const t = richStage();
		expect(fieldOf({ ...t, story: { ...t.story, beat: 0 } })).toBe("story.beat");
		expect(fieldOf({ ...t, story: { ...t.story, beat: t.beats.length } })).toBe("story.beat");
		expect(fieldOf({ ...t, story: { ...t.story, beat: 1.5 } })).toBe("story.beat");
		expect(fieldOf({ ...t, story: { ...t.story, beat: 1 } })).toBe("");
	});
	it("is asked of the type path too", () => {
		const t = typeTreatment(["Hello there", "Good night"]);
		expect(fieldOf(without(t, "story"))).toBe("story");
	});
});

describe("protagonist", () => {
	it("is required on the stage path and says what it is, what it looks like and what it does", () => {
		const t = richStage();
		expect(fieldOf(without(t, "protagonist"))).toBe("protagonist");
		expect(fieldOf({ ...t, protagonist: { ...t.protagonist, name: "" } })).toBe("protagonist.name");
		expect(fieldOf({ ...t, protagonist: { ...t.protagonist, kind: "weather" } })).toBe("protagonist.kind");
		expect(fieldOf({ ...t, protagonist: { ...t.protagonist, look: "" } })).toBe("protagonist.look");
		expect(fieldOf({ ...t, protagonist: { ...t.protagonist, acts: [] } })).toBe("protagonist.acts");
	});
	it("acts in shots that exist, once per shot", () => {
		const t = richStage();
		const acts = (list: Json[]) => ({ ...t, protagonist: { ...t.protagonist, acts: list } });
		expect(fieldOf(acts([...t.protagonist.acts, { beat: 9, action: "leaves" }]))).toBe("protagonist.acts[4].beat");
		expect(fieldOf(acts([...t.protagonist.acts, { beat: 0, action: "again" }]))).toBe("protagonist.acts[4].beat");
	});
	it("carries at least half the film and is on screen where the turn lands", () => {
		const t = richStage();
		const one = { ...t, protagonist: { ...t.protagonist, acts: [t.protagonist.acts[2]] } };
		expect(fieldOf(one)).toBe("protagonist.acts");
		const offTurn = { ...t, protagonist: { ...t.protagonist, acts: [t.protagonist.acts[0], t.protagonist.acts[1], t.protagonist.acts[3]] } };
		expect(fieldOf(offTurn)).toBe("protagonist.acts");
	});
	it("is not asked of the type path, where the words are the film", () => {
		expect(fieldOf(typeTreatment(["Hello there", "Good night"]))).toBe("");
	});
});

describe("a named product", () => {
	const LINK = "https://github.com/acme/widget";
	const sha = (text: string) => createHash("sha256").update(text).digest("hex");
	const request = `make a short explainer video about ${LINK} lit`;
	const asset = (extra: Json = {}) => ({ path: "stage/assets/01-logo.png", role: "logo", source: "fetched", sha256: sha("logo"), ...extra });
	const linked = (product: Json | null = { name: "widget", url: LINK, assets: [asset()] }): Json => {
		const t = { ...richStage(), request };
		return product ? { ...t, product, subject: { ...t.subject, source: "user" }, inventions: t.inventions.filter((s: string) => !s.includes("Maple Street rain garden")) } : t;
	};
	const noInvented = (t: Json): Json => ({ ...t, copy: { source: "invented", lines: t.copy.lines }, inventions: ["all four copy lines"] });

	it("requires the product when the request links one, and names the command that fetches it", () => {
		expect(fieldOf(noInvented(linked(null)))).toBe("product");
		try {
			validateTreatment(noInvented(linked(null)));
		} catch (error) {
			expect((error as Error).message).toContain("render.mjs assets");
		}
	});
	it("accepts the link the request gives, with a listed real asset", () => {
		expect(fieldOf(noInvented(linked()))).toBe("");
		expect(fieldOf(noInvented(linked({ name: "widget", url: `${LINK}/`, assets: [asset()] })))).toBe("");
	});
	it("refuses another link, a nameless product and an invented subject", () => {
		expect(fieldOf(noInvented(linked({ name: "widget", url: "https://github.com/other/thing", assets: [asset()] })))).toBe("product.url");
		expect(fieldOf(noInvented(linked({ name: "", url: LINK, assets: [asset()] })))).toBe("product.name");
		const t = noInvented(linked());
		expect(fieldOf({ ...t, subject: { ...t.subject, source: "invented", name: "the widget" }, inventions: ["the widget", "all four copy lines"] })).toBe("subject.source");
	});
	it("checks each listed asset's path, role, source and hash", () => {
		const bad = (extra: Json) => fieldOf(noInvented(linked({ name: "widget", url: LINK, assets: [asset(extra)] })));
		expect(bad({ path: "elsewhere/logo.png" })).toBe("product.assets[0].path");
		expect(bad({ path: "stage/assets/../../x.png" })).toBe("product.assets[0].path");
		expect(bad({ role: "mascot" })).toBe("product.assets[0].role");
		expect(bad({ source: "guessed" })).toBe("product.assets[0].source");
		expect(bad({ sha256: "abc" })).toBe("product.assets[0].sha256");
		expect(fieldOf(noInvented(linked({ name: "widget", url: LINK, assets: [] })))).toBe("product.assets");
	});
	it("takes an unreachable product with its reason, and asks for one", () => {
		expect(fieldOf(noInvented(linked({ name: "widget", url: LINK, unreachable: "the page answered 404" })))).toBe("");
		expect(fieldOf(noInvented(linked({ name: "widget", url: LINK, unreachable: "" })))).toBe("product.unreachable");
	});
	it("exits 22 before any render when the product is unreachable or a listed file is missing or changed", () => {
		const out = realpathSync(mkdtempSync(join(tmpdir(), "motion-product-")));
		temps.push(out);
		const t = { product: { name: "widget", url: LINK, assets: [asset()] } };
		expect(() => checkProductFiles(out, t)).toThrow(expect.objectContaining({ code: EXIT.BLOCKED_ASSET_MISSING, message: expect.stringContaining("stage/assets/01-logo.png") }));
		mkdirSync(join(out, "stage", "assets"), { recursive: true });
		writeFileSync(join(out, "stage", "assets", "01-logo.png"), "changed");
		expect(() => checkProductFiles(out, t)).toThrow(expect.objectContaining({ code: EXIT.STAGE_CONTRACT_ERROR }));
		writeFileSync(join(out, "stage", "assets", "01-logo.png"), "logo");
		expect(() => checkProductFiles(out, t)).not.toThrow();
		expect(() => checkProductFiles(out, { product: { name: "widget", url: LINK, unreachable: "404" } })).toThrow(expect.objectContaining({ code: EXIT.BLOCKED_ASSET_MISSING, message: expect.stringContaining("never draw invented product screens") }));
		expect(() => checkProductFiles(out, {})).not.toThrow();
	});
});

describe("preview and the other switches the request owns", () => {
	it("takes preview only when the request asks for a preview or storyboard first", () => {
		const t = richStage();
		expect(fieldOf({ ...t, preview: true })).toBe("preview");
		expect(fieldOf({ ...t, request: `${t.request} Show me the storyboard first.`, preview: true })).toBe("");
		expect(fieldOf({ ...t, preview: "yes" })).toBe("preview");
	});
	it("takes 30 fps only when the request asks for it", () => {
		expect(fieldOf({ ...richStage(), fps: 30 })).toBe("fps");
		expect(fieldOf({ ...stageTreatment(), fps: 30 })).toBe("");
	});
	it("takes 9:16 only for a vertical request", () => {
		expect(fieldOf({ ...richStage(), format: "9:16" })).toBe("format");
	});
	it("takes the genre a genre word in the request fixes", () => {
		expect(fieldOf({ ...richStage(), genre: "announcement" })).toBe("genre");
	});
});

describe("the references say what the validator asks", () => {
	const read = (name: string) => readFileSync(join(skillRoot, "references", name), "utf8");
	it("names the sections the validator's messages point to", () => {
		const treatment = read("treatment.md");
		for (const heading of ["## Story", "## Protagonist", "## Named products", "## Sound"]) expect(treatment).toContain(heading);
		const studio = read("studio.md");
		for (const heading of ["## Register: rich is the default", "## House styles", "## Choosing the style", "## Shots and layouts", "## Scaffold", "## The board round", "## Style rules in the gate", "## The house file"]) expect(studio).toContain(heading);
	});
	it("lists the new fields in the treatment's field reference", () => {
		const treatment = read("treatment.md");
		for (const field of ["`style`", "`register`", "`story`", "`protagonist`", "`world`", "`depth`, `render3d`", "`product`", "`preview`", "`layout`, `hero`, `transition`"]) expect(treatment, field).toContain(field);
	});
});
