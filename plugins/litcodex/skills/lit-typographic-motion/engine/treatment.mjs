// The treatment is the film's plan, written before any render on both paths. This validator runs
// before every render (stills-only too). Any fault throws TreatmentError with the field name; the
// CLI turns it into exit 16 BLOCKED_TREATMENT_INVALID. It checks structure and the anti-restatement
// rules, never taste: taste is the look rounds' job.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SOUND_PALETTES } from "./constants.mjs";
import { FONTS, SKILL_ROOT } from "./fonts.mjs";

export class TreatmentError extends Error {
	constructor(field, message) {
		super(`${field}: ${message}`);
		this.field = field;
	}
}

export const GENRES = Object.freeze(["announcement", "brand-mood", "event", "explainer", "motion-graphics", "type-led", "other"]);
// Minimum beat count per genre: the stage count of its arc (references/treatment.md).
export const ARC_STAGES = Object.freeze({ announcement: 5, "brand-mood": 4, event: 4, explainer: 4, "motion-graphics": 5, other: 3 });
const LONG_GENRES = new Set(["announcement", "event", "explainer", "motion-graphics"]);
export const DEVICE_KINDS = Object.freeze(["illustration", "diagram", "chart", "icon", "shape", "path", "mask", "depth3d", "particles", "grid", "gradient", "photo-texture"]);
const TEXTURE_KINDS = new Set(["grid", "gradient", "particles", "photo-texture"]);
export const FACES = Object.freeze([...new Set(FONTS.map((font) => font.family))]);
const MIN_BEAT_SEC = 1.2;
const MAX_GAP_SEC = 0.25;

const LENGTH_ASKED = /\d+(?:\.\d+)?\s*(?:초|분|s\b|secs?\b|seconds?\b|min(?:ute)?s?\b)/iu;
const SILENCE_ASKED = /무음|소리\s*없|음악\s*없|\bsilent\b|\bsilence\b|\bno\s+(?:sound|audio|music)\b|\bwithout\s+(?:sound|audio|music)\b|\bmuted?\b/iu;
const MUTED_CHANNEL = /무음|소리\s*없|\bmuted?\b|\bsilent\b|\bsound\s*off\b/iu;
const PLACEHOLDER = /<[^<>\n]{1,80}>/u;
const QUOTED = /"[^"\n]*"|“[^”\n]*”|'[^'\n]*'|「[^」\n]*」/gu;
const TYPE_CUE = /\bkinetic[\s-]+type(?:graphy)?\b|\btypographic[\s-]+motion\b|\blyrics?\b|\blyric[\s-]+videos?\b|\btitle[\s-]+sequences?\b|\bopening[\s-]+titles?\b|키네틱\s*타이포|타이포|가사|오프닝\s*타이틀|타이틀\s*시퀀스/iu;

/** NFC, lowercase, then no whitespace and no punctuation or symbols. */
export function normalizeText(text) {
	return String(text).normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export const stripQuoted = (text) => String(text).replace(QUOTED, " ");

/** A type-led cue in the request: a type compound or word, or a quoted span of two or more words. */
export function typeLedCue(request) {
	const text = String(request);
	const word = TYPE_CUE.exec(text)?.[0];
	if (word) return word;
	for (const match of text.matchAll(QUOTED)) if (match[0].slice(1, -1).trim().split(/\s+/u).filter(Boolean).length >= 2) return "quoted span";
	return null;
}

/** True when `candidate` shares a normalized substring of `limit` characters with `against`. */
function sharesRun(candidate, against, limit) {
	if (limit < 1) return false;
	const a = Array.from(normalizeText(candidate));
	const b = normalizeText(against);
	for (let i = 0; i + limit <= a.length; i++) if (b.includes(a.slice(i, i + limit).join(""))) return true;
	return false;
}

const isText = (value) => typeof value === "string" && value.trim().length > 0;
const sentences = (text) => String(text).trim().split(/(?<=[.!?。])\s+(?=\S)/u).filter(Boolean).length;

function requireText(t, field, value = t[field]) {
	if (value === undefined || value === null) throw new TreatmentError(field, "missing");
	if (!isText(value)) throw new TreatmentError(field, "must be a non-empty string");
	return value;
}

/** Every string leaf that still holds an example placeholder such as "<one sentence>". */
function findPlaceholder(value, path) {
	if (typeof value === "string") return PLACEHOLDER.test(value) ? path : null;
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const hit = findPlaceholder(value[i], `${path}[${i}]`);
			if (hit) return hit;
		}
		return null;
	}
	if (value && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			const hit = findPlaceholder(child, path ? `${path}.${key}` : key);
			if (hit) return hit;
		}
	}
	return null;
}

/** Free-text leaves compared for copiedExample, as [field kind, normalized value] pairs. */
export function freeTextLeaves(t) {
	const leaves = [];
	const put = (kind, value) => {
		if (typeof value === "string" && normalizeText(value)) leaves.push([kind, normalizeText(value)]);
	};
	put("idea", t?.idea);
	put("audience", t?.audience);
	put("channel", t?.channel);
	put("ambition", t?.ambition);
	for (const beat of Array.isArray(t?.beats) ? t.beats : []) for (const key of ["purpose", "onScreen", "motion", "sound"]) put(`beats[].${key}`, beat?.[key]);
	for (const line of Array.isArray(t?.copy?.lines) ? t.copy.lines : []) put("copy.lines[]", line);
	for (const entry of Array.isArray(t?.palette) ? t.palette : []) put("palette[].role", entry?.role);
	return leaves;
}

/** The JSON examples shipped in this skill's references (any fenced json block with a genre). */
export function shippedExamples(root = SKILL_ROOT) {
	const dir = join(root, "references");
	if (!existsSync(dir)) return [];
	const examples = [];
	for (const name of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
		for (const block of readFileSync(join(dir, name), "utf8").matchAll(/```json\n([\s\S]*?)```/gu)) {
			try {
				const value = JSON.parse(block[1]);
				if (value && typeof value === "object" && "genre" in value) examples.push(value);
			} catch {
				// A non-JSON snippet is documentation, not an example treatment.
			}
		}
	}
	return examples;
}

function copiedFrom(t, examples) {
	const mine = freeTextLeaves(t);
	if (mine.length === 0) return false;
	for (const example of examples) {
		const theirs = new Set(freeTextLeaves(example).map(([kind, value]) => `${kind}\u0000${value}`));
		const equal = mine.filter(([kind, value]) => theirs.has(`${kind}\u0000${value}`)).length;
		if (equal * 2 >= mine.length) return true;
	}
	return false;
}

/** Seconds of the film covered by the union of the listed beats. */
function beatCoverage(beats, indices) {
	const spans = [...new Set(indices)].filter((i) => Number.isInteger(i) && beats[i]).map((i) => [beats[i].t0, beats[i].t1]).sort((a, b) => a[0] - b[0]);
	let total = 0;
	let end = Number.NEGATIVE_INFINITY;
	for (const [a, b] of spans) {
		if (b <= end) continue;
		total += b - Math.max(a, end);
		end = b;
	}
	return total;
}

/**
 * Validate a parsed treatment. Returns it unchanged when valid; throws TreatmentError otherwise.
 * Field order follows references/treatment.md so the first reported field is the first to fix.
 */
export function validateTreatment(t, { examples = shippedExamples() } = {}) {
	if (!t || typeof t !== "object" || Array.isArray(t)) throw new TreatmentError("treatment", "must be a JSON object");
	const placeholder = findPlaceholder(t, "");
	if (placeholder) throw new TreatmentError(placeholder, "still holds an example placeholder (<...>); write the real value");
	if (examples.length && copiedFrom(t, examples)) throw new TreatmentError("copiedExample", "half or more of the free-text fields equal a shipped example; write this film's own treatment");

	const request = requireText(t, "request");
	const unquoted = normalizeText(stripQuoted(request));
	const limit = Math.min(10, Math.floor(Array.from(unquoted).length / 2));
	if (!GENRES.includes(t.genre)) throw new TreatmentError("genre", t.genre === undefined ? "missing" : `must be one of ${GENRES.join(", ")}`);
	if (!["type", "stage"].includes(t.path)) throw new TreatmentError("path", t.path === undefined ? "missing" : "must be type or stage");
	requireText(t, "pathReason");
	const idea = requireText(t, "idea");
	if (sentences(idea) > 1) throw new TreatmentError("idea", "must be one sentence");
	if (sharesRun(idea, stripQuoted(request), limit)) throw new TreatmentError("idea", `restates the request (shares ${limit}+ normalized characters with it); say what the film shows instead`);
	requireText(t, "audience");
	requireText(t, "channel");
	if (!["16:9", "9:16"].includes(t.format)) throw new TreatmentError("format", t.format === undefined ? "missing" : "must be 16:9 or 9:16");
	requireText(t, "formatReason");

	if (t.durationSec === undefined) throw new TreatmentError("durationSec", "missing");
	if (typeof t.durationSec !== "number" || !Number.isFinite(t.durationSec) || t.durationSec < 4 || t.durationSec > 90) throw new TreatmentError("durationSec", "must be a number of seconds from 4 to 90");
	if (LONG_GENRES.has(t.genre) && t.durationSec < 10 && !LENGTH_ASKED.test(request)) throw new TreatmentError("durationSec", `a ${t.genre} film runs at least 10 s unless the user asked for a length; the arc needs the room`);

	if (t.subject === undefined) throw new TreatmentError("subject", "missing");
	if (!t.subject || typeof t.subject !== "object") throw new TreatmentError("subject", "must be {name, source, specifics[]}");
	requireText(t, "subject.name", t.subject.name);
	if (!["user", "invented"].includes(t.subject.source)) throw new TreatmentError("subject.source", "must be user or invented");
	if (!Array.isArray(t.subject.specifics) || t.subject.specifics.some((s) => !isText(s))) throw new TreatmentError("subject.specifics", "must be an array of concrete specifics");
	if (t.subject.source === "invented" && t.subject.specifics.length < 2) throw new TreatmentError("subject.specifics", "an invented subject needs at least 2 concrete specifics (what it is or does, for whom, one distinctive detail)");

	if (t.copy === undefined) throw new TreatmentError("copy", "missing");
	if (!t.copy || !["user", "invented"].includes(t.copy.source)) throw new TreatmentError("copy.source", "must be user or invented");
	if (!Array.isArray(t.copy.lines) || t.copy.lines.length === 0) throw new TreatmentError("copy.lines", "must list at least one line");
	const wholeRequest = normalizeText(request);
	t.copy.lines.forEach((line, i) => {
		const field = `copy.lines[${i}]`;
		if (!isText(line)) throw new TreatmentError(field, "must be a non-empty string");
		if (t.copy.source === "user" && !wholeRequest.includes(normalizeText(line))) throw new TreatmentError(field, "copy.source is user, but this line is not in the request");
		if (t.copy.source === "invented" && sharesRun(line, stripQuoted(request), limit)) throw new TreatmentError(field, "invented copy restates the request; write it from subject.specifics");
	});

	if (t.beats === undefined) throw new TreatmentError("beats", "missing");
	if (!Array.isArray(t.beats) || t.beats.length === 0) throw new TreatmentError("beats", "must be a non-empty array");
	t.beats.forEach((beat, i) => {
		const field = `beats[${i}]`;
		if (!beat || typeof beat !== "object") throw new TreatmentError(field, "must be {t0, t1, purpose, onScreen, motion, sound}");
		for (const key of ["t0", "t1"]) if (typeof beat[key] !== "number" || !Number.isFinite(beat[key])) throw new TreatmentError(`${field}.${key}`, "must be a number of seconds");
		for (const key of ["purpose", "onScreen", "motion", "sound"]) requireText(t, `${field}.${key}`, beat[key]);
		if (beat.t1 - beat.t0 < MIN_BEAT_SEC - 1e-9) throw new TreatmentError(field, `lasts ${(beat.t1 - beat.t0).toFixed(2)} s; every beat is at least ${MIN_BEAT_SEC} s`);
		const previousEnd = i === 0 ? 0 : t.beats[i - 1].t1;
		if (beat.t0 - previousEnd > MAX_GAP_SEC + 1e-9) throw new TreatmentError(field, `starts ${(beat.t0 - previousEnd).toFixed(2)} s after the previous beat ends; gaps are at most ${MAX_GAP_SEC} s`);
		if (i > 0 && beat.t0 < t.beats[i - 1].t0) throw new TreatmentError(field, "beats must be in time order");
	});
	if (t.durationSec - t.beats[t.beats.length - 1].t1 > MAX_GAP_SEC + 1e-9) throw new TreatmentError(`beats[${t.beats.length - 1}]`, `ends before durationSec; beats cover 0 to ${t.durationSec} s`);
	const needed = t.genre === "type-led" ? t.copy.lines.length : ARC_STAGES[t.genre];
	if (t.beats.length < needed) throw new TreatmentError("beats", `a ${t.genre} film needs at least ${needed} beats (${t.genre === "type-led" ? "one per supplied line" : "one per arc stage"}); it has ${t.beats.length}`);

	if (t.path === "type") {
		if (t.format !== "16:9") throw new TreatmentError("path", "the type path renders 16:9 only; a 9:16 film takes the stage path");
		if (t.copy.source !== "user" && !typeLedCue(request)) throw new TreatmentError("path", "the type path needs the user's own words or a type-led cue in the request");
	}

	if (t.visualDevices === undefined) throw new TreatmentError("visualDevices", "missing");
	if (!Array.isArray(t.visualDevices)) throw new TreatmentError("visualDevices", "must be an array");
	t.visualDevices.forEach((device, i) => {
		const field = `visualDevices[${i}]`;
		if (!DEVICE_KINDS.includes(device?.kind)) throw new TreatmentError(`${field}.kind`, `must be one of ${DEVICE_KINDS.join(", ")}`);
		if (!["subject", "support", "texture"].includes(device.role)) throw new TreatmentError(`${field}.role`, "must be subject, support or texture");
		if (TEXTURE_KINDS.has(device.kind) && device.role !== "texture") throw new TreatmentError(`${field}.role`, `${device.kind} is always texture`);
		if (!Array.isArray(device.beats) || device.beats.some((b) => !Number.isInteger(b) || b < 0 || b >= t.beats.length)) throw new TreatmentError(`${field}.beats`, "must list beat indices");
	});
	if (t.path === "stage") {
		const subject = t.visualDevices.filter((d) => d.role === "subject");
		if (subject.length === 0) throw new TreatmentError("visualDevices", "the stage path needs a role: subject device, a drawn depiction of what the film is about");
		const covered = beatCoverage(t.beats, subject.flatMap((d) => d.beats));
		if (covered < 0.5 * t.durationSec - 1e-9) throw new TreatmentError("visualDevices", `subject devices cover ${covered.toFixed(1)} s of ${t.durationSec} s; they must cover at least half the film`);
		const counting = new Set(t.visualDevices.filter((d) => !TEXTURE_KINDS.has(d.kind)).map((d) => d.kind));
		if (counting.size < 2) throw new TreatmentError("visualDevices", "the stage path needs at least 2 distinct non-texture kinds (grid, gradient, particles and photo-texture do not count)");
	}

	if (t.typePlan === undefined) throw new TreatmentError("typePlan", "missing");
	if (!t.typePlan || typeof t.typePlan !== "object") throw new TreatmentError("typePlan", "must be {faces, hierarchy, maxWordsOnScreen}");
	if (!Array.isArray(t.typePlan.faces) || t.typePlan.faces.length === 0) throw new TreatmentError("typePlan.faces", `must list faces from ${FACES.join(", ")}`);
	for (const face of t.typePlan.faces) if (!FACES.some((f) => f.toLowerCase() === String(face).toLowerCase())) throw new TreatmentError("typePlan.faces", `${face} is not one of this product's verified faces (${FACES.join(", ")})`);
	requireText(t, "typePlan.hierarchy", t.typePlan.hierarchy);
	if (!Number.isInteger(t.typePlan.maxWordsOnScreen) || t.typePlan.maxWordsOnScreen < 1) throw new TreatmentError("typePlan.maxWordsOnScreen", "must be a positive integer");

	if (t.palette === undefined) throw new TreatmentError("palette", "missing");
	if (!Array.isArray(t.palette) || t.palette.length < 3 || t.palette.length > 6) throw new TreatmentError("palette", "must list 3 to 6 colours");
	t.palette.forEach((entry, i) => {
		if (!/^#[0-9a-f]{6}$/iu.test(entry?.hex ?? "")) throw new TreatmentError(`palette[${i}].hex`, "must be #RRGGBB");
		requireText(t, `palette[${i}].role`, entry.role);
	});

	if (t.sound === undefined) throw new TreatmentError("sound", "missing");
	if (!t.sound || !["generated", "supplied", "authored", "none"].includes(t.sound.mode)) throw new TreatmentError("sound.mode", "must be generated, supplied, authored or none");
	if (t.sound.mode === "none" && !SILENCE_ASKED.test(request) && !MUTED_CHANNEL.test(t.channel)) throw new TreatmentError("sound.mode", "none only when the user asked for silence or the channel plays muted by design; the default is generated");
	if (t.sound.mode !== "none") requireText(t, "sound.plan", t.sound.plan);
	if (t.sound.mode === "generated") {
		if (!SOUND_PALETTES.includes(t.sound.palette)) throw new TreatmentError("sound.palette", `must be one of ${SOUND_PALETTES.join(", ")}`);
		if (!/^[A-G](?:#|b)? (?:major|minor)$/u.test(t.sound.key ?? "")) throw new TreatmentError("sound.key", 'must look like "D minor" or "F# major"');
		if (!Number.isInteger(t.sound.tempo) || t.sound.tempo < 60 || t.sound.tempo > 160) throw new TreatmentError("sound.tempo", "must be an integer BPM from 60 to 160");
	}
	if (t.sound.mode === "supplied" || t.sound.mode === "authored") requireText(t, "sound.file", t.sound.file);

	const invented = t.copy.source === "invented" || t.subject.source === "invented";
	if (invented) {
		if (t.inventions === undefined) throw new TreatmentError("inventions", "missing");
		if (!Array.isArray(t.inventions) || t.inventions.length === 0 || t.inventions.some((s) => !isText(s))) throw new TreatmentError("inventions", "must list every invented name, fact and line");
		if (t.subject.source === "invented" && !t.inventions.some((s) => normalizeText(s).includes(normalizeText(t.subject.name)))) throw new TreatmentError("inventions", "must contain subject.name");
	} else if (t.inventions !== undefined && !Array.isArray(t.inventions)) throw new TreatmentError("inventions", "must be an array");
	if (t.inventions === undefined) throw new TreatmentError("inventions", "missing (use [] when nothing is invented)");

	if (t.fps !== undefined && t.fps !== 30 && t.fps !== 60) throw new TreatmentError("fps", "optional; 60 by default, or 30");
	if (t.seed !== undefined && (!Number.isInteger(t.seed) || t.seed < 0 || t.seed > 0xffffffff)) throw new TreatmentError("seed", "optional; an unsigned 32-bit integer");
	const ambition = requireText(t, "ambition");
	if (sentences(ambition) > 2) throw new TreatmentError("ambition", "must be 1 or 2 sentences");
	return t;
}

/** Read and validate `<file>`; a missing or unparsable file is a treatment fault too. */
export function loadTreatment(file) {
	if (!existsSync(file)) throw new TreatmentError("treatment", `no treatment.json at ${file}; write it before any render (references/treatment.md)`);
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new TreatmentError("treatment", `not valid JSON (${error.message})`);
	}
	return validateTreatment(parsed);
}
