// Test-only treatments (fixtures/ never ships). Each one validates; tests change a field to probe
// one rule at a time. Both film fixtures ask for a calm film, so they take the minimal register and
// the tidal style (the request's own words pick it), and the bed they ship is one of that style's.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A type-path treatment whose copy is the user's own quoted words. */
export function typeTreatment(lines, extra = {}) {
	const request = `make a calm kinetic typography video with ${lines.map((line) => `"${line}"`).join(", ")} lit`;
	const beat = 2;
	return {
		request,
		genre: "type-led",
		path: "type",
		pathReason: "the user supplied the words and asked for kinetic type",
		style: "tidal",
		register: "minimal",
		idea: "Each supplied line lands on its own beat and the last one holds still.",
		story: { expect: "Each line comes and goes like the one before it.", turn: "The last line stays and the pulse stops around it.", beat: Math.min(1, lines.length - 1), payoff: "The held line reads as the point of the whole film." },
		audience: "people following the account",
		channel: "a landscape web player with sound",
		format: "16:9",
		formatReason: "the player is landscape",
		durationSec: beat * lines.length,
		subject: { name: "the supplied lines", source: "user", specifics: ["the user's own words"] },
		beats: lines.map((_, i) => ({ t0: i * beat, t1: (i + 1) * beat, purpose: `breath ${i + 1}`, onScreen: `line ${i + 1} set large`, motion: "slam in, then hold", sound: i === lines.length - 1 ? "closing cadence" : "a hit on the cut" })),
		visualDevices: [],
		typePlan: { faces: ["Archivo", "Pretendard"], hierarchy: "the first line leads", maxWordsOnScreen: 6 },
		palette: [
			{ hex: "#0C0E13", role: "ground" },
			{ hex: "#E9EBE4", role: "type" },
			{ hex: "#3FB6A8", role: "signal" },
		],
		sound: { mode: "generated", plan: "a pulse that lands a hit on every cut", palette: "felt", key: "D major", tempo: 84 },
		copy: { source: "user", lines },
		inventions: [],
		ambition: "Each cut lands on the pulse and the type hierarchy stays unmistakable.",
		...extra,
	};
}

export function writeTreatment(dir, treatment, name = "treatment.json") {
	const path = join(dir, name);
	writeFileSync(path, JSON.stringify(treatment, null, 2));
	return path;
}

const STAGE_LAYOUTS = ["stage", "split", "hero", "split-alt"];

/** A stage-path treatment; `beats` are [t0, t1] pairs and default to three even beats. */
export function stageTreatment({ format = "16:9", durationSec = 4, fps = 30, beats = null, lines = ["Tide pool at noon"], extra = {} } = {}) {
	const spans = beats ?? [0, 1, 2].map((i) => [(i * durationSec) / 3, ((i + 1) * durationSec) / 3]);
	const vertical = format === "9:16" ? " vertical" : "";
	const thirty = fps === 30 ? " at 30 fps," : "";
	return {
		request: `make a calm${vertical} ${durationSec} seconds video${thirty} about a tide pool lit`,
		genre: "other",
		path: "stage",
		pathReason: "the film shows drawn water and stones, which need shapes",
		style: "tidal",
		register: "minimal",
		idea: "Small waves fill a rock basin and a crab crosses it before the water settles.",
		audience: "visitors of a coastal walk page",
		channel: format === "9:16" ? "a vertical feed with sound" : "a landscape web player with sound",
		format,
		formatReason: format === "9:16" ? "the feed is vertical" : "the player is landscape",
		durationSec,
		fps,
		subject: { name: "the north basin", source: "invented", specifics: ["a rock basin that fills at high tide", "home to one shore crab"] },
		story: { expect: "A quiet basin that fills and empties.", turn: "The crab walks out across the water line.", beat: 1, payoff: "The water settles around the crab's track." },
		protagonist: { name: "the shore crab", kind: "object", look: "a small coral shape with two claws, about a tenth of the frame wide", acts: spans.map((_, i) => ({ beat: i, action: ["waits on the stone", "crosses the basin", "stops where the water settles"][i % 3] })) },
		beats: spans.map(([t0, t1], i) => ({
			t0,
			t1,
			purpose: ["set up", "develop", "land"][i % 3],
			onScreen: `beat ${i + 1} picture`,
			motion: "eased drift",
			sound: i === spans.length - 1 ? "closing cadence" : "a hit on the cut",
			layout: STAGE_LAYOUTS[i % STAGE_LAYOUTS.length],
			hero: ["the water line rises", "the crab crosses", "the ripples fade"][i % 3],
			transition: i === spans.length - 1 ? "end" : ["dissolve", "match", "wipe"][i % 3],
		})),
		visualDevices: [
			{ kind: "illustration", role: "subject", beats: spans.map((_, i) => i) },
			{ kind: "shape", role: "support", beats: [0] },
		],
		typePlan: { faces: ["Archivo"], hierarchy: "one short label", maxWordsOnScreen: 4 },
		palette: [
			{ hex: "#0E1420", role: "deep water" },
			{ hex: "#E8ECEF", role: "foam" },
			{ hex: "#E07856", role: "crab" },
		],
		sound: {
			mode: "generated",
			plan: "a soft pulse that settles",
			palette: "felt",
			key: "D major",
			tempo: 84,
			events: [
				{ t: Math.round(durationSec * 0.2 * 100) / 100, on: "the first wave tops the rim", kind: "whoosh" },
				{ t: Math.round(durationSec * 0.55 * 100) / 100, on: "the crab taps the stone", kind: "tap" },
			],
		},
		copy: { source: "invented", lines },
		inventions: ["the north basin", ...lines],
		ambition: "Water motion reads as depth, and every cut lands on the pulse.",
		...extra,
	};
}

/** A cover treatment (mode: cover) for the cover-mode tests; fixtures/cover/good draws LOOPTEST. */
export function coverTreatment(extra = {}) {
	return {
		mode: "cover",
		request: "An animated cover for the top of the LOOPTEST readme.",
		idea: "Bars drift one period per loop while a dot laps a ring beside a still word.",
		recipe: "own",
		recipeReason: "A test pattern with all three speed layers and nothing else.",
		brandWord: "LOOPTEST",
		aspect: "2:1",
		loopSec: 6,
		fps: 16,
		layers: { slow: "Bars drift one period per loop.", mid: "A dot laps its ring twice per loop.", beat: "The dot pulses once per lap." },
		system: { rule: "One bar rule.", copies: "Fourteen bars.", offset: "Each bar's x position." },
		title: { box: [0.06, 0.37, 0.56, 0.27], kind: "live" },
		ambition: "Every frame moves and the seam disappears in the decoded file.",
		...extra,
	};
}
