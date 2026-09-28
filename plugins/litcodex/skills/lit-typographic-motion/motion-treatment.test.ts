import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { normalizeText, shippedExamples, TreatmentError, validateTreatment } from "./engine/treatment.mjs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

type Json = Record<string, any>;
const REQUEST = "make a short explainer video about how a rain garden filters street runoff lit";

/** A valid stage treatment for an explainer request that names no film words. */
function stageTreatment(): Json {
	return {
		request: REQUEST,
		genre: "explainer",
		path: "stage",
		pathReason: "the film shows water moving through soil layers, which needs drawn shapes",
		idea: "Follow one raindrop from a curb cut down through mulch, sand and roots until it reaches clean groundwater.",
		audience: "neighbours deciding whether to plant a rain garden",
		channel: "community newsletter embed, played with sound",
		format: "16:9",
		formatReason: "the newsletter player is landscape",
		durationSec: 16,
		subject: { name: "Maple Street rain garden", source: "invented", specifics: ["a planted dip beside the curb that catches runoff", "three soil layers under native sedges", "built by the block association"] },
		beats: [
			{ t0: 0, t1: 4, purpose: "question", onScreen: "a storm drain swallowing oily water", motion: "rain streaks fall, the drain gulps", sound: "low pulse, a hit on the cut" },
			{ t0: 4, t1: 8, purpose: "steps", onScreen: "cross-section of mulch, sand and roots", motion: "layers slide in from below", sound: "rise into the change" },
			{ t0: 8, t1: 12, purpose: "result", onScreen: "the droplet turning clear at the bottom", motion: "a mask wipe follows the droplet", sound: "pad opens" },
			{ t0: 12, t1: 16, purpose: "recap", onScreen: "the garden at street level with a label", motion: "match cut back to the curb", sound: "closing cadence" },
		],
		visualDevices: [
			{ kind: "illustration", role: "subject", beats: [0, 1, 2, 3] },
			{ kind: "diagram", role: "support", beats: [1, 2] },
			{ kind: "particles", role: "texture", beats: [0] },
		],
		typePlan: { faces: ["Archivo", "PretendardGOV"], hierarchy: "one short label per beat, the recap line largest", maxWordsOnScreen: 7 },
		palette: [
			{ hex: "#10202A", role: "night soil ground" },
			{ hex: "#E8F1EC", role: "label type" },
			{ hex: "#5FB38A", role: "living roots" },
		],
		sound: { mode: "generated", plan: "a soft pulse that brightens as the water clears", palette: "felt", key: "D minor", tempo: 92 },
		copy: { source: "invented", lines: ["Where does the storm go?", "Mulch, sand, roots", "Clear water below", "Maple Street, block 4"] },
		inventions: ["Maple Street rain garden", "built by the block association", "all four copy lines"],
		ambition: "Every cut should be a match cut on the droplet, with the soil layers drawn in depth so the filtering reads without words.",
	};
}

function expectField(t: Json, field: string) {
	let error: unknown = null;
	try {
		validateTreatment(t);
	} catch (caught) {
		error = caught;
	}
	expect(error, `expected ${field}`).toBeInstanceOf(TreatmentError);
	expect((error as TreatmentError).field).toBe(field);
}

describe("treatment validator (exit 16 with the field name)", () => {
	it("accepts a complete stage treatment", () => {
		expect(() => validateTreatment(stageTreatment())).not.toThrow();
	});
	it.each(["request", "genre", "path", "pathReason", "idea", "audience", "channel", "format", "formatReason", "durationSec", "beats", "subject", "visualDevices", "typePlan", "palette", "sound", "copy", "inventions", "ambition"])("a missing %s", (field) => {
		const t = stageTreatment();
		delete t[field];
		expectField(t, field);
	});
	it("placeholder values", () => {
		const t = stageTreatment();
		t.audience = "<who watches>";
		expectField(t, "audience");
		const u = stageTreatment();
		u.durationSec = "<4–90>";
		expectField(u, "durationSec");
	});
	it("a treatment copied from a shipped example", () => {
		const examples = shippedExamples();
		expect(examples.length).toBeGreaterThan(0);
		const t = stageTreatment();
		const example = examples[0] as Json;
		const strip = (v: string) => v.replace(/[<>]/gu, "");
		t.idea = strip(example.idea);
		t.audience = strip(example.audience);
		t.channel = strip(example.channel);
		t.ambition = strip(example.ambition);
		t.beats = t.beats.map((b: Json, i: number) => ({ ...b, purpose: strip(example.beats[i % example.beats.length].purpose), onScreen: strip(example.beats[i % example.beats.length].onScreen), motion: strip(example.beats[i % example.beats.length].motion), sound: strip(example.beats[i % example.beats.length].sound) }));
		expectField(t, "copiedExample");
	});
	it("an idea that restates the request", () => {
		const t = stageTreatment();
		t.idea = "A short explainer video about how a rain garden filters street runoff.";
		expectField(t, "idea");
	});
	it("invented copy that restates the request", () => {
		const t = stageTreatment();
		t.copy.lines[1] = "how a rain garden filters";
		expectField(t, "copy.lines[1]");
	});
	it("a user copy line that is not in the request", () => {
		const t = stageTreatment();
		t.request = 'make a video with the words "roots hold the rain" lit';
		t.copy = { source: "user", lines: ["roots hold the rain", "and the street stays dry"] };
		expectField(t, "copy.lines[1]");
	});
	it("a stage treatment with no subject device", () => {
		const t = stageTreatment();
		t.visualDevices = t.visualDevices.map((d: Json) => (d.role === "subject" ? { ...d, role: "support" } : d));
		expectField(t, "visualDevices");
	});
	it("a subject device that covers under half the film", () => {
		const t = stageTreatment();
		t.visualDevices[0].beats = [0];
		expectField(t, "visualDevices");
	});
	it("only texture kinds", () => {
		const t = stageTreatment();
		t.visualDevices = [
			{ kind: "illustration", role: "subject", beats: [0, 1, 2, 3] },
			{ kind: "gradient", role: "texture", beats: [0, 1] },
			{ kind: "grid", role: "texture", beats: [2, 3] },
		];
		expectField(t, "visualDevices");
	});
	it("path type with no user copy and no type-led cue", () => {
		const t = stageTreatment();
		t.path = "type";
		expectField(t, "path");
	});
	it("path type at 9:16", () => {
		const t = stageTreatment();
		t.request = 'make a kinetic typography video with "roots hold the rain" lit';
		t.path = "type";
		t.format = "9:16";
		expectField(t, "path");
	});
	it("too few beats for the genre", () => {
		const t = stageTreatment();
		t.beats = t.beats.slice(0, 3);
		t.beats[2].t1 = 16;
		t.visualDevices = [
			{ kind: "illustration", role: "subject", beats: [0, 1, 2] },
			{ kind: "diagram", role: "support", beats: [1, 2] },
		];
		expectField(t, "beats");
	});
	it("a beat shorter than 1.2 s", () => {
		const t = stageTreatment();
		t.beats[1].t1 = 4.8;
		t.beats[2].t0 = 4.8;
		expectField(t, "beats[1]");
	});
	it("a gap over 0.25 s between beats", () => {
		const t = stageTreatment();
		t.beats[2].t0 = 8.5;
		expectField(t, "beats[2]");
	});
	it("inventions missing subject.name", () => {
		const t = stageTreatment();
		t.inventions = ["all four copy lines"];
		expectField(t, "inventions");
	});
	it("a duration under the genre floor when the user asked for no length", () => {
		const t = stageTreatment();
		t.durationSec = 8;
		t.beats = [
			{ ...t.beats[0], t0: 0, t1: 2 },
			{ ...t.beats[1], t0: 2, t1: 4 },
			{ ...t.beats[2], t0: 4, t1: 6 },
			{ ...t.beats[3], t0: 6, t1: 8 },
		];
		expectField(t, "durationSec");
	});
	it("sound none without a request for silence", () => {
		const t = stageTreatment();
		t.sound = { mode: "none", plan: "silent", palette: "felt", key: "D minor", tempo: 92 };
		expectField(t, "sound.mode");
	});
	it("normalizes with NFC, lowercase and no whitespace or punctuation", () => {
		expect(normalizeText("  Hello,  World! ")).toBe("helloworld");
		expect(normalizeText("한글 테스트.")).toBe("한글테스트");
	});
});

describe("the render CLI validates the treatment before any render", () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-treat-")));
	temps.push(dir);
	it("a missing treatment exits 16", () => {
		const result = spawnSync(process.execPath, [RENDER, "film", "--out", join(dir, "a"), "--stills-only"], { encoding: "utf8" });
		expect(result.status).toBe(EXIT.BLOCKED_TREATMENT_INVALID);
		expect(result.stderr).toContain("BLOCKED_TREATMENT_INVALID");
		expect(result.stderr).toContain("treatment");
	});
	it("an invalid treatment exits 16 on the type path too, naming the field", () => {
		const t = stageTreatment();
		t.path = "type";
		writeFileSync(join(dir, "t.json"), JSON.stringify(t));
		const result = spawnSync(process.execPath, [RENDER, "film", "--treatment", join(dir, "t.json"), "--out", join(dir, "b"), "--stills-only"], { encoding: "utf8" });
		expect(result.status).toBe(16);
		expect(result.stderr).toMatch(/BLOCKED_TREATMENT_INVALID: path/u);
	});
	it("the placeholder example in references/treatment.md never validates as-is", () => {
		const text = readFileSync(join(skillRoot, "references", "treatment.md"), "utf8");
		expect(text).toContain("do not copy");
		for (const example of shippedExamples()) expect(() => validateTreatment(example)).toThrow(TreatmentError);
	});
});
