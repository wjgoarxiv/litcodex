// Test-only treatments (fixtures/ never ships). Each one validates; tests change a field to probe
// one rule at a time.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A type-path treatment whose copy is the user's own quoted words. */
export function typeTreatment(lines, extra = {}) {
	const request = `make a kinetic typography video with ${lines.map((line) => `"${line}"`).join(", ")} lit`;
	const beat = 2;
	return {
		request,
		genre: "type-led",
		path: "type",
		pathReason: "the user supplied the words and asked for kinetic type",
		idea: "Each supplied line lands on its own beat and the last one holds still.",
		audience: "people following the account",
		channel: "a landscape web player with sound",
		format: "16:9",
		formatReason: "the player is landscape",
		durationSec: beat * lines.length,
		subject: { name: "the supplied lines", source: "user", specifics: ["the user's own words"] },
		beats: lines.map((_, i) => ({ t0: i * beat, t1: (i + 1) * beat, purpose: `breath ${i + 1}`, onScreen: `line ${i + 1} set large`, motion: "slam in, then hold", sound: i === lines.length - 1 ? "closing cadence" : "a hit on the cut" })),
		visualDevices: [],
		typePlan: { faces: ["Archivo", "PretendardGOV"], hierarchy: "the first line leads", maxWordsOnScreen: 6 },
		palette: [
			{ hex: "#0C0E13", role: "ground" },
			{ hex: "#E9EBE4", role: "type" },
			{ hex: "#3FB6A8", role: "signal" },
		],
		sound: { mode: "generated", plan: "a pulse that lands a hit on every cut", palette: "felt", key: "A minor", tempo: 100 },
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

/** A stage-path treatment; `beats` are [t0, t1] pairs and default to three even beats. */
export function stageTreatment({ format = "16:9", durationSec = 4, fps = 30, beats = null, lines = ["Tide pool at noon"], extra = {} } = {}) {
	const spans = beats ?? [0, 1, 2].map((i) => [(i * durationSec) / 3, ((i + 1) * durationSec) / 3]);
	return {
		request: "make a short calm video about a tide pool lit",
		genre: "other",
		path: "stage",
		pathReason: "the film shows drawn water and stones, which need shapes",
		idea: "Small waves fill a rock basin and a crab crosses it before the water settles.",
		audience: "visitors of a coastal walk page",
		channel: format === "9:16" ? "a vertical feed with sound" : "a landscape web player with sound",
		format,
		formatReason: format === "9:16" ? "the feed is vertical" : "the player is landscape",
		durationSec,
		fps,
		subject: { name: "the north basin", source: "invented", specifics: ["a rock basin that fills at high tide", "home to one shore crab"] },
		beats: spans.map(([t0, t1], i) => ({ t0, t1, purpose: ["set up", "develop", "land"][i % 3], onScreen: `beat ${i + 1} picture`, motion: "eased drift", sound: i === spans.length - 1 ? "closing cadence" : "a hit on the cut" })),
		visualDevices: [
			{ kind: "illustration", role: "subject", beats: spans.map((_, i) => i) },
			{ kind: "shape", role: "support", beats: [0] },
		],
		typePlan: { faces: ["Archivo"], hierarchy: "one short label", maxWordsOnScreen: 4 },
		palette: [
			{ hex: "#0E1A24", role: "deep water" },
			{ hex: "#F3EDE2", role: "foam" },
			{ hex: "#E07A5F", role: "crab" },
		],
		sound: { mode: "generated", plan: "a soft pulse that settles", palette: "air", key: "E minor", tempo: 90 },
		copy: { source: "invented", lines },
		inventions: ["the north basin", ...lines],
		ambition: "Water motion reads as depth, and every cut lands on the pulse.",
		...extra,
	};
}
