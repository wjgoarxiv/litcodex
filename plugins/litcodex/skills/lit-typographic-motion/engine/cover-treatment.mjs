// The cover treatment: `treatment.json` with `"mode": "cover"`, written before the first cover render
// and validated by every one (exit 16 names the first bad field). A cover is not a film: no beats, no
// arc, no ending, no copy lines, no sound. It names one recipe, one rule and its copies, the three speed
// layers, the brand word set once (plus at most one motto the user or the project already uses), the
// aspect and loop length, and the title box the contrast and cap-height gates measure. Every string in
// it is the user's content or the director's plan, never an instruction.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COVER } from "./constants.mjs";
import { findPlaceholder, normalizeText, sharesRun, stripQuoted, TreatmentError } from "./treatment.mjs";

export const RECIPES = Object.freeze(["painted-light", "weight-tide", "orbit-loop", "own"]);
export const LAYERS = Object.freeze(["slow", "mid", "beat"]);

const fault = (field, message) => {
	throw new TreatmentError(field, message);
};
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const sentences = (text) => String(text).trim().split(/(?<=[.!?。])\s+(?=\S)/u).filter(Boolean).length;
const words = (text) => String(text).trim().split(/\s+/u).filter(Boolean).length;
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && v >= 0 && v <= 1);

function text(t, path, { maxSentences } = {}) {
	const value = path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), t);
	if (value === undefined || value === null) fault(path, "missing");
	if (!isText(value)) fault(path, "must be a non-empty string");
	if (maxSentences && sentences(value) > maxSentences) fault(path, `at most ${maxSentences} sentence${maxSentences > 1 ? "s" : ""}`);
	return value;
}

/** Validate a cover treatment. Returns it with the page and cover sizes, frame count, encode and seed filled in. */
export function validateCoverTreatment(t) {
	if (!t || typeof t !== "object" || Array.isArray(t)) fault("treatment", "must be a JSON object");
	if (t.mode !== "cover") fault("mode", 'must be "cover" for a cover render');
	const placeholder = findPlaceholder(t, "");
	if (placeholder) fault(placeholder, "still holds an example placeholder (<...>); write the real value");
	const request = text(t, "request");
	const idea = text(t, "idea", { maxSentences: 1 });
	const unquoted = normalizeText(stripQuoted(request));
	const limit = Math.min(10, Math.floor(Array.from(unquoted).length / 2));
	if (sharesRun(idea, stripQuoted(request), limit)) fault("idea", `restates the request (shares ${limit}+ normalized characters with it); say what the loop does`);
	if (!RECIPES.includes(t.recipe)) fault("recipe", t.recipe === undefined ? "missing" : `must be one of ${RECIPES.join(", ")}`);
	text(t, "recipeReason", { maxSentences: 2 });
	const brand = text(t, "brandWord");
	if (words(brand) > 3) fault("brandWord", "is the name set once: at most three words");
	if ("motto" in t) {
		if (!t.motto || typeof t.motto !== "object") fault("motto", "must be { text, source, from? }");
		const motto = text(t, "motto.text");
		if (words(motto) > 6) fault("motto.text", "at most six words");
		if (!["user", "project"].includes(t.motto.source)) fault("motto.source", "must be user (it is in the request) or project (the project already uses it; name where in from)");
		if (t.motto.source === "user" && !normalizeText(request).includes(normalizeText(motto))) fault("motto.text", "a user motto must appear in the request; a cover never invents a tagline");
		if (t.motto.source === "project") text(t, "motto.from");
	}
	for (const key of ["copy", "beats", "lines"]) if (key in t) fault(key, "a cover has no copy lines and no beats: the brand word is set once and never swapped (references/cover.md)");
	if ("sound" in t && t.sound !== "none") fault("sound", 'a cover is silent: leave sound out or set it to "none"');
	if (!(t.aspect in COVER.aspects)) fault("aspect", `must be ${Object.keys(COVER.aspects).join(" or ")}`);
	if (typeof t.loopSec !== "number" || !(t.loopSec >= COVER.minSec && t.loopSec <= COVER.maxSec)) fault("loopSec", `must be ${COVER.minSec} to ${COVER.maxSec} seconds`);
	if (!COVER.fps.includes(t.fps)) fault("fps", `must be one of ${COVER.fps.join(", ")}`);
	if (!t.layers || typeof t.layers !== "object") fault("layers", "missing: name what moves on the slow, mid and beat layers");
	for (const layer of LAYERS) text(t, `layers.${layer}`, { maxSentences: 2 });
	if (!t.system || typeof t.system !== "object") fault("system", "missing: the one rule, its copies and where their offsets come from");
	for (const key of ["rule", "copies", "offset"]) text(t, `system.${key}`, { maxSentences: 2 });
	if (!t.title || typeof t.title !== "object") fault("title", "missing: { box: [x, y, w, h] as fractions of the cover, kind: live or painted }");
	const box = t.title.box;
	if (!isBox(box)) fault("title.box", "must be [x, y, w, h], each a fraction 0..1 of the cover");
	if (box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1 + 1e-9 || box[1] + box[3] > 1 + 1e-9) fault("title.box", "must lie inside the cover");
	if (!["live", "painted"].includes(t.title.kind)) fault("title.kind", "must be live (set as text on the page) or painted (part of the base art)");
	if ("palette" in t) {
		if (!Array.isArray(t.palette) || t.palette.length < 2 || t.palette.length > 6) fault("palette", "2 to 6 { color, role } entries");
		t.palette.forEach((entry, i) => {
			if (!/^#[0-9a-f]{6}$/iu.test(entry?.color ?? "")) fault(`palette[${i}].color`, "must be #rrggbb");
			if (!isText(entry?.role)) fault(`palette[${i}].role`, "must say the colour's job");
		});
	}
	if ("encode" in t) {
		if (!t.encode || typeof t.encode !== "object") fault("encode", "must be { q, edgeQ, edgeFrames }");
		for (const [key, lo, hi] of [["q", 50, 100], ["edgeQ", 50, 100], ["edgeFrames", 0, 60]]) if (key in t.encode && !(Number.isInteger(t.encode[key]) && t.encode[key] >= lo && t.encode[key] <= hi)) fault(`encode.${key}`, `an integer ${lo} to ${hi}`);
	}
	text(t, "ambition", { maxSentences: 2 });
	const { page, size } = COVER.aspects[t.aspect];
	return { ...t, page: [...page], size: [...size], frames: Math.round(t.loopSec * t.fps), encode: { ...COVER.encode, ...(t.encode ?? {}) }, seed: Number.isInteger(t.seed) ? t.seed >>> 0 : 20261020 };
}

/** Read and validate `<outDir>/treatment.json` as a cover; the first valid one is kept for the record. */
export function loadCoverTreatment(outDir) {
	const file = join(outDir, "treatment.json");
	if (!existsSync(file)) fault("treatment", `no treatment.json at ${file}; write it before any cover render (references/cover.md)`);
	let raw;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		fault("treatment", `not valid JSON (${error.message})`);
	}
	if (raw?.mode !== "cover") fault("mode", "this treatment is a film: render it with stage or film (references/treatment.md); a cover sets \"mode\": \"cover\"");
	const treatment = validateCoverTreatment(raw);
	const first = join(outDir, ".run", "treatment-first.json");
	if (!existsSync(first)) {
		mkdirSync(join(outDir, ".run"), { recursive: true });
		writeFileSync(first, `${JSON.stringify(raw, null, 2)}\n`);
	}
	return treatment;
}
