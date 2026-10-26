// The treatment is the film's plan, written before any render on both paths. This validator runs
// before every render (stills-only too). Any fault throws TreatmentError with the field name; the
// CLI turns it into exit 16 BLOCKED_TREATMENT_INVALID. It checks structure and the anti-restatement
// rules, never taste: taste is the look rounds' job.
//
// The forks that used to be the model's to flip on every run are rules here: the house style (named,
// then the project's house file, then a keyword, then the genre), the register (rich unless the request
// asks for calm), the format (9:16 only for a vertical request), the length (the genre's band unless the
// user names one) and the genre (a genre word in the request fixes it). Concept fields stay free.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EVENT_SOUNDS, SCORE_GENRES, SOUND_PALETTES } from "./constants.mjs";
import { FONTS, SKILL_ROOT } from "./fonts.mjs";
import { readHouse } from "./house.mjs";
import { readBoundedText } from "./safe-read.mjs";
import { LAYOUT_IDS, pickStyle, readStyle, STYLE_IDS, sameBed, styleBeds, styleColors, styleFamilies } from "./styles.mjs";

export class TreatmentError extends Error {
	constructor(field, message) {
		super(`${field}: ${message}`);
		this.field = field;
	}
}

export const GENRES = Object.freeze(["announcement", "brand-mood", "event", "explainer", "motion-graphics", "type-led", "other"]);
// Minimum beat count per genre: the stage count of its arc (references/treatment.md).
export const ARC_STAGES = Object.freeze({ announcement: 5, "brand-mood": 4, event: 4, explainer: 4, "motion-graphics": 5, other: 3 });
/** Length bands in seconds when the user names no length; `type-led` scales with its lines. */
export const GENRE_BANDS = Object.freeze({ announcement: [12, 18], "brand-mood": [10, 15], event: [10, 15], explainer: [16, 24], "motion-graphics": [12, 18], other: [10, 15] });
export const typeLedBand = (lines) => [Math.max(4, 2 * lines), Math.max(8, 6 * lines)];
export const DEVICE_KINDS = Object.freeze(["illustration", "diagram", "chart", "icon", "shape", "path", "mask", "depth3d", "screen", "particles", "grid", "gradient", "photo-texture"]);
const TEXTURE_KINDS = new Set(["grid", "gradient", "particles", "photo-texture"]);
export const FACES = Object.freeze([...new Set(FONTS.map((font) => font.family))]);
export const PROTAGONIST_KINDS = Object.freeze(["character", "object"]);
/** What a product asset is; `screen` devices need one of the last three. */
export const ASSET_ROLES = Object.freeze(["logo", "wordmark", "icon", "photo", "screenshot", "ui", "readme-image"]);
const SCREEN_ROLES = new Set(["screenshot", "ui", "readme-image"]);
/** An event counts as off the cut when it is at least this far from every cut. */
export const EVENT_OFF_CUT_SEC = 0.1;
/** How dense a film is. Rich is the default; minimal only when the request asks for calm or minimal. */
export const REGISTERS = Object.freeze(["rich", "minimal"]);
/** What a rich stage film's world plans at least: depth layers, labelled parts, a share of moving shots. */
export const RICH_WORLD = Object.freeze({ layers: 3, labels: 6, labelWords: 4, cameraShare: 0.5 });
const LOCKED_CAMERA = /^\s*(?:none|locked|static|still|hold|fixed|no move)\s*\.?\s*$/iu;
const MIN_BEAT_SEC = 1.2;
const MAX_GAP_SEC = 0.25;

const SILENCE_ASKED = /무음|소리\s*없|음악\s*없|\bsilent\b|\bsilence\b|\bno\s+(?:sound|audio|music)\b|\bwithout\s+(?:sound|audio|music)\b|\bmuted?\b/iu;
const MUTED_CHANNEL = /무음|소리\s*없|\bmuted?\b|\bsilent\b|\bsound\s*off\b/iu;
const LENGTH_VALUE = /(\d+(?:\.\d+)?)\s*(초|분|s\b|secs?\b|seconds?\b|min(?:ute)?s?\b)/iu;
const VERTICAL = /세로|숏폼|쇼츠|릴스|틱톡|인스타(?:그램)?\s?스토리|\bvertical\b|\bportrait\s+(?:format|mode|video|orientation)\b|9\s?:\s?16|\bshorts\b|\breels?\b|\btiktok\b|\binsta(?:gram)?\s+stor(?:y|ies)\b/iu;
const MINIMAL_ASKED = /미니멀|잔잔|차분|조용|심플|절제|단순하게|고요|\bminimal(?:ist|ism)?\b|\bcalm\b|\bquiet\b|\bsimple\b|\bunderstated\b|\brestrained\b|\bsparse\b|\bserene\b/iu;
const PREVIEW_ASKED = /미리\s?보기|스토리보드|콘티|\bpreview\b|\bstoryboard\b/iu;
const FPS30_ASKED = /30\s?(?:fps|프레임|frames?\s+(?:a|per)\s+second)|\b30\s?p\b/iu;
// High-quality, cinematic or photoreal 3D: the words that send a 3D film to the Blender rung when
// Blender is installed (references/depth.md).
const PATH_TRACED_ASKED = /고퀄|고품질|하이엔드|시네마틱|실사|포토리얼|레이\s?트레이싱|블렌더|\b(?:high[- ]?(?:quality|end)|cinematic|photo-?real(?:istic)?|path[- ]?trac\w*|ray[- ]?trac\w*|blender|cycles)\b/iu;
// A link in the request names a real product, repository or site: the film uses its real assets.
const URL_IN_REQUEST = /\bhttps?:\/\/[^\s"'<>)\]]+/giu;
// A genre word in the request fixes the genre; checked in order, first hit wins.
const GENRE_CUES = Object.freeze([
	["explainer", /설명|원리|\bexplain(?:er|s|ing)?\b/iu],
	["announcement", /출시|런칭|론칭|티저|신제품|\blaunch(?:es|ing)?\b|\bteaser\b|\bannounce(?:ment|s)?\b|\bintroducing\b/iu],
	["event", /행사|공연|축제|모집|세미나|콘서트|음악회|전시회|\bevent\b|\bfestival\b|\bconcert\b|\bmeetup\b|\bconference\b|\bexhibition\b/iu],
	["explainer", /어떻게|과정|\bhow\s+(?:it|they|a|an|the|to|\w+\s+works?)\b/iu],
]);
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

/** The length the request asks for, in seconds, or null. */
export function askedSeconds(request) {
	const m = LENGTH_VALUE.exec(String(request ?? ""));
	if (!m) return null;
	const value = Number(m[1]);
	return /^(?:분|min(?:ute)?s?)$/iu.test(m[2]) ? value * 60 : value;
}

/** The genre a request's own words fix, or null when it names none. */
export function cuedGenre(request) {
	const text = String(request ?? "");
	const compound = TYPE_CUE.exec(text);
	if (compound) return { genre: "type-led", word: compound[0] };
	for (const [genre, re] of GENRE_CUES) {
		const m = re.exec(text);
		if (m) return { genre, word: m[0] };
	}
	return null;
}
export const asksVertical = (request) => VERTICAL.test(String(request ?? ""));
/** The request asks for a calm, quiet or minimal film: the one case the minimal register is for. */
export const asksMinimal = (request) => MINIMAL_ASKED.test(String(request ?? ""));
export const asksPreview = (request) => PREVIEW_ASKED.test(String(request ?? ""));
/** The request asks for path-traced quality in its 3D. */
export const asksPathTraced = (request) => PATH_TRACED_ASKED.test(String(request ?? ""));
export const asks30fps = (request) => FPS30_ASKED.test(String(request ?? ""));
/** A link as the treatment compares it: no trailing punctuation, slash or .git, lower case. */
export const normUrl = (u) => String(u ?? "").trim().replace(/[.,;:!?]+$/u, "").replace(/\/+$/u, "").replace(/\.git$/u, "").toLowerCase();
/** Every link in the request, normalized. */
export const requestUrls = (request) => [...String(request ?? "").matchAll(URL_IN_REQUEST)].map((m) => normUrl(m[0]));

/** True when `candidate` shares a normalized substring of `limit` characters with `against`. */
export function sharesRun(candidate, against, limit) {
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
export function findPlaceholder(value, path) {
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
	for (const beat of Array.isArray(t?.beats) ? t.beats : []) for (const key of ["purpose", "onScreen", "motion", "sound", "hero"]) put(`beats[].${key}`, beat?.[key]);
	for (const key of ["expect", "turn", "payoff"]) put(`story.${key}`, t?.story?.[key]);
	put("protagonist.look", t?.protagonist?.look);
	for (const act of Array.isArray(t?.protagonist?.acts) ? t.protagonist.acts : []) put("protagonist.acts[].action", act?.action);
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

function checkStyle(t, house) {
	if (!("style" in t)) throw new TreatmentError("style", `missing: one of ${STYLE_IDS.join(", ")} (references/studio.md)`);
	if (!STYLE_IDS.includes(t.style)) throw new TreatmentError("style", `must be one of ${STYLE_IDS.join(", ")}`);
	const pick = pickStyle({ request: t.request, copy: Array.isArray(t.copy?.lines) ? t.copy.lines : [], path: t.path, house, genre: t.genre });
	if (t.style !== pick.id) throw new TreatmentError("style", `${pick.reason}; this film takes the ${pick.id} style`);
}

// Rich is the default: a film is rich unless the request asks for calm or minimal, and then it is
// minimal. The register is the request's, like the format, never a choice the model makes alone.
function checkRegister(t) {
	const register = t.register ?? "rich";
	if (!REGISTERS.includes(register)) throw new TreatmentError("register", "rich (the default) or minimal");
	const calm = asksMinimal(t.request);
	if (register === "minimal" && !calm) throw new TreatmentError("register", "minimal only when the request asks for a calm, quiet or minimal film; the default is rich (references/studio.md, Register)");
	if (register === "rich" && calm) throw new TreatmentError("register", "the request asks for a calm or minimal film: register minimal");
	return register;
}

function checkLength(t, request) {
	const asked = askedSeconds(request);
	if (asked !== null) {
		if (Math.abs(t.durationSec - asked) > Math.max(1, asked * 0.1)) throw new TreatmentError("durationSec", `the request asks for ${asked} s; keep the film within 10 % of it`);
		return;
	}
	const lines = Array.isArray(t.copy?.lines) ? t.copy.lines.length : 1;
	const [lo, hi] = t.genre === "type-led" ? typeLedBand(lines) : GENRE_BANDS[t.genre];
	if (t.durationSec < lo - 1e-9 || t.durationSec > hi + 1e-9) throw new TreatmentError("durationSec", `a ${t.genre} film runs ${lo}-${hi} s unless the user names a length (${t.durationSec} s)`);
}

// Composition changes with the story: two adjacent shots never share a layout, and a film of four or
// more shots uses at least three, so the eye is not parked on one split for the whole film.
function checkVariety(t) {
	for (let i = 1; i < t.beats.length; i++) {
		if (t.beats[i].layout === t.beats[i - 1].layout) throw new TreatmentError(`beats[${i}].layout`, `shots ${i} and ${i + 1} both use ${t.beats[i].layout}; adjacent shots change layout (references/studio.md, Shots and layouts)`);
	}
	const used = new Set(t.beats.map((b) => b.layout));
	if (t.beats.length >= 4 && used.size < 3) throw new TreatmentError("beats", `${t.beats.length} shots use only ${[...used].join(" and ")}; a film of four or more shots uses at least three layouts`);
}

// A stage shot: which layout its type and subject take, the one move the eye follows, and how it hands
// off to the next shot (a word from the style's transitions; the last shot ends).
function checkShot(t, beat, i, field) {
	const style = readStyle(t.style);
	if (!LAYOUT_IDS.includes(beat.layout)) throw new TreatmentError(`${field}.layout`, `must be one of ${LAYOUT_IDS.join(", ")}`);
	if (!isText(beat.hero) || PLACEHOLDER.test(beat.hero)) throw new TreatmentError(`${field}.hero`, "name the one move the eye follows in this shot");
	const last = i === t.beats.length - 1;
	if (last && beat.transition !== "end") throw new TreatmentError(`${field}.transition`, "the last shot's transition is end");
	if (!last && !style.transitions.includes(beat.transition)) throw new TreatmentError(`${field}.transition`, `the ${style.id} style hands off with ${style.transitions.join(", ")}`);
	if ("lines" in beat) {
		const n = Array.isArray(t.copy?.lines) ? t.copy.lines.length : 0;
		if (!Array.isArray(beat.lines) || beat.lines.some((k) => !Number.isInteger(k) || k < 0 || k >= n)) throw new TreatmentError(`${field}.lines`, "the indices of the copy lines this shot shows");
		if (beat.layout === "full" && beat.lines.length) throw new TreatmentError(`${field}.lines`, "a full shot has no type zone, so it shows no copy");
	}
}

// The story: what the viewer expects, the turn they do not, the shot where it lands, and the payoff.
// A genre arc alone is an information order, not a story.
function checkStory(t) {
	if (!("story" in t)) throw new TreatmentError("story", "missing: { expect, turn, beat, payoff }: what the viewer expects, what happens instead, the shot where it lands, what the ending gives (references/treatment.md, Story)");
	const s = t.story;
	if (!s || typeof s !== "object") throw new TreatmentError("story", "must be an object { expect, turn, beat, payoff }");
	for (const key of ["expect", "turn", "payoff"]) {
		if (!isText(s[key])) throw new TreatmentError(`story.${key}`, "must be a non-empty string");
		if (PLACEHOLDER.test(s[key])) throw new TreatmentError(`story.${key}`, `placeholder value ${JSON.stringify(s[key])}`);
		if (sentences(s[key]) > 2) throw new TreatmentError(`story.${key}`, "at most 2 sentences");
	}
	if (normalizeText(s.turn) === normalizeText(s.expect)) throw new TreatmentError("story.turn", "the turn is what the viewer does not expect; it cannot equal story.expect");
	const first = t.beats.length > 1 ? 1 : 0;
	if (!Number.isInteger(s.beat) || s.beat < first || s.beat >= Math.max(t.beats.length, 1)) throw new TreatmentError("story.beat", `the index of the shot where the turn lands: after the opening, before the end (${first}-${t.beats.length - 1})`);
}

// The protagonist: one drawn character or hero object that acts across the film (stage path).
function checkProtagonist(t) {
	if (t.path !== "stage") return;
	if (!("protagonist" in t)) throw new TreatmentError("protagonist", "missing: { name, kind, look, acts[] }: the character or hero object that acts across the film (references/treatment.md, Protagonist)");
	const p = t.protagonist;
	if (!p || typeof p !== "object") throw new TreatmentError("protagonist", "must be an object { name, kind, look, acts }");
	if (!isText(p.name) || PLACEHOLDER.test(p.name)) throw new TreatmentError("protagonist.name", "must name it");
	if (!PROTAGONIST_KINDS.includes(p.kind)) throw new TreatmentError("protagonist.kind", `must be ${PROTAGONIST_KINDS.join(" or ")}`);
	if (!isText(p.look) || PLACEHOLDER.test(p.look)) throw new TreatmentError("protagonist.look", "say what it looks like on screen: shape, material, colour role, scale in the frame");
	if (!Array.isArray(p.acts) || p.acts.length === 0) throw new TreatmentError("protagonist.acts", "list what it does, shot by shot: [{ beat, action }]");
	const seen = new Set();
	p.acts.forEach((act, i) => {
		if (!Number.isInteger(act?.beat) || act.beat < 0 || act.beat >= t.beats.length) throw new TreatmentError(`protagonist.acts[${i}].beat`, "must be a beat index");
		if (seen.has(act.beat)) throw new TreatmentError(`protagonist.acts[${i}].beat`, "one act per shot");
		seen.add(act.beat);
		if (!isText(act.action) || PLACEHOLDER.test(act.action)) throw new TreatmentError(`protagonist.acts[${i}].action`, "say what it does in this shot, as a viewer would see it");
	});
	const covered = beatCoverage(t.beats, [...seen]);
	if (covered < 0.5 * t.durationSec - 1e-9) throw new TreatmentError("protagonist.acts", `it acts for ${covered.toFixed(1)} s, under half the film; it carries the film, not one shot`);
	if (!seen.has(t.story.beat)) throw new TreatmentError("protagonist.acts", `the turn lands at shot ${t.story.beat + 1}, and the protagonist has no act there`);
}

// A named product, repository or site: its real logo, images, UI and words, never invented ones. The
// request's link makes it required; `render.mjs assets` fetches what it can reach.
function checkProduct(t) {
	const urls = requestUrls(t.request);
	if (!("product" in t)) {
		if (urls.length) throw new TreatmentError("product", `missing: the request links ${urls[0]}; fetch its real assets with render.mjs assets --out <dir> --url <link> and list them (references/treatment.md, Named products)`);
		return;
	}
	const p = t.product;
	if (!p || typeof p !== "object") throw new TreatmentError("product", "must be an object { name, url, assets }");
	if (!isText(p.name) || PLACEHOLDER.test(p.name)) throw new TreatmentError("product.name", "must name the product");
	if (urls.length && !urls.includes(normUrl(p.url))) throw new TreatmentError("product.url", `must be the link the request gives (${urls.join(", ")})`);
	if ("unreachable" in p) {
		if (!isText(p.unreachable)) throw new TreatmentError("product.unreachable", "say what could not be reached and why");
		return;
	}
	if (!Array.isArray(p.assets) || p.assets.length === 0) throw new TreatmentError("product.assets", "list the real assets the film uses: [{ path, role, source, sha256 }]; when none can be reached set unreachable and ask the user");
	p.assets.forEach((a, i) => {
		const field = `product.assets[${i}]`;
		if (typeof a?.path !== "string" || !/^(?:stage|cover)\/assets\//u.test(a.path) || a.path.split("/").includes("..")) throw new TreatmentError(`${field}.path`, "must be a file under stage/assets/, relative to the output directory");
		if (!ASSET_ROLES.includes(a.role)) throw new TreatmentError(`${field}.role`, `must be one of ${ASSET_ROLES.join(", ")}`);
		if (!["fetched", "user"].includes(a.source)) throw new TreatmentError(`${field}.source`, "must be fetched (by render.mjs assets) or user (supplied)");
		if (!/^[0-9a-f]{64}$/u.test(a.sha256 ?? "")) throw new TreatmentError(`${field}.sha256`, "must be the file's SHA-256");
	});
	if (t.subject?.source === "invented") throw new TreatmentError("subject.source", "the product is real: the subject is the product (source user), its specifics from its own words");
}

// The 3D route: a depth3d subject is drawn with the pinned three.js on the GPU rung (references/depth.md).
function checkDepth(t) {
	if ("depth" in t && !["2d", "3d"].includes(t.depth)) throw new TreatmentError("depth", "2d (the default) or 3d");
	const solid = t.visualDevices.some((d) => d.kind === "depth3d" && d.role === "subject");
	if (t.path !== "stage") {
		if (t.depth === "3d") throw new TreatmentError("depth", "3d is a stage-path route");
		return;
	}
	if (solid && t.depth !== "3d") throw new TreatmentError("depth", "the subject is a depth3d device: set depth to 3d, so the film takes the 3D route (references/depth.md)");
	if (t.depth === "3d" && !solid) throw new TreatmentError("depth", "3d needs the subject drawn as a depth3d device (role subject)");
	if ("render3d" in t && !["three", "blender"].includes(t.render3d)) throw new TreatmentError("render3d", "three (the GPU rung, the default) or blender (the offline Cycles rung)");
	if (t.render3d === "blender" && t.depth !== "3d") throw new TreatmentError("render3d", "the Blender rung renders a 3D world: set depth to 3d with a depth3d subject");
}

// A rich stage film plans its density before any page exists: the depth layers of its world, the
// labelled parts the viewer reads in it and the shots where the camera moves (references/studio.md).
function checkWorld(t, register) {
	if (t.path !== "stage" || register !== "rich") return;
	const w = t.world;
	if (!w || typeof w !== "object") throw new TreatmentError("world", "missing: { layers, labels, camera }: a rich film plans its layered world, its labelled parts and its camera moves (references/studio.md, Register)");
	if (!Array.isArray(w.layers) || w.layers.filter(isText).length < RICH_WORLD.layers) throw new TreatmentError("world.layers", `at least ${RICH_WORLD.layers} depth layers, back to front, each saying what lives there`);
	if (!Array.isArray(w.labels) || w.labels.length < RICH_WORLD.labels) throw new TreatmentError("world.labels", `at least ${RICH_WORLD.labels} labelled parts the viewer reads on screen (real names from the product when there is one)`);
	w.labels.forEach((label, i) => {
		if (!isText(label) || PLACEHOLDER.test(label)) throw new TreatmentError(`world.labels[${i}]`, "the label as it appears on screen");
		if (label.trim().split(/\s+/u).length > RICH_WORLD.labelWords) throw new TreatmentError(`world.labels[${i}]`, `a label is at most ${RICH_WORLD.labelWords} words; longer text is copy`);
	});
	if (!Array.isArray(w.camera)) throw new TreatmentError("world.camera", "list the camera moves: [{ beat, move }]");
	const moving = new Set();
	w.camera.forEach((c, i) => {
		if (!Number.isInteger(c?.beat) || c.beat < 0 || c.beat >= t.beats.length) throw new TreatmentError(`world.camera[${i}].beat`, "must be a beat index");
		if (!isText(c.move) || PLACEHOLDER.test(c.move) || LOCKED_CAMERA.test(c.move)) throw new TreatmentError(`world.camera[${i}].move`, "name the move (push-in, truck, crane, orbit, rack focus); a locked shot is not listed");
		moving.add(c.beat);
	});
	if (moving.size < RICH_WORLD.cameraShare * t.beats.length - 1e-9) throw new TreatmentError("world.camera", `the camera moves in ${moving.size} of ${t.beats.length} shots; a rich film moves it in at least half (keep the flash audit with slow light changes, not a locked camera)`);
}

function checkEvents(t, events) {
	if (!Array.isArray(events) || events.length < 2) throw new TreatmentError("sound.events", "at least 2 on-screen events that make a sound: [{ t, on, kind }]");
	const cuts = t.beats.slice(1).map((b) => b.t0);
	let offCut = 0;
	events.forEach((e, i) => {
		const field = `sound.events[${i}]`;
		if (typeof e?.t !== "number" || !(e.t > 0 && e.t < t.durationSec)) throw new TreatmentError(`${field}.t`, `the second the event happens on screen, inside the film (0-${t.durationSec})`);
		if (!isText(e.on) || PLACEHOLDER.test(e.on)) throw new TreatmentError(`${field}.on`, "what happens on screen at that moment, as a viewer would see it");
		if (!EVENT_SOUNDS.includes(e.kind)) throw new TreatmentError(`${field}.kind`, `must be one of ${EVENT_SOUNDS.join(", ")}`);
		if (cuts.every((c) => Math.abs(c - e.t) >= EVENT_OFF_CUT_SEC - 1e-9)) offCut += 1;
	});
	if (offCut * 2 < events.length) throw new TreatmentError("sound.events", `${events.length - offCut} of ${events.length} events sit on a cut; at least half sync to something moving inside a shot`);
}

/**
 * Validate a parsed treatment. Returns it unchanged when valid; throws TreatmentError otherwise.
 * Field order follows references/treatment.md so the first reported field is the first to fix.
 */
export function validateTreatment(t, { examples = shippedExamples(), house = null } = {}) {
	if (!t || typeof t !== "object" || Array.isArray(t)) throw new TreatmentError("treatment", "must be a JSON object");
	if (t.mode === "cover") throw new TreatmentError("mode", "this is a cover treatment: render it with `render.mjs cover --out <dir>` (references/cover.md)");
	const placeholder = findPlaceholder(t, "");
	if (placeholder) throw new TreatmentError(placeholder, "still holds an example placeholder (<...>); write the real value");
	if (examples.length && copiedFrom(t, examples)) throw new TreatmentError("copiedExample", "half or more of the free-text fields equal a shipped example; write this film's own treatment");

	const request = requireText(t, "request");
	const unquoted = normalizeText(stripQuoted(request));
	const limit = Math.min(10, Math.floor(Array.from(unquoted).length / 2));
	if (!GENRES.includes(t.genre)) throw new TreatmentError("genre", t.genre === undefined ? "missing" : `must be one of ${GENRES.join(", ")}`);
	const cue = cuedGenre(request);
	if (cue && cue.genre !== t.genre) throw new TreatmentError("genre", `the request says "${cue.word}", which makes this a ${cue.genre} film`);
	if (!["type", "stage"].includes(t.path)) throw new TreatmentError("path", t.path === undefined ? "missing" : "must be type or stage");
	requireText(t, "pathReason");
	const idea = requireText(t, "idea");
	if (sentences(idea) > 1) throw new TreatmentError("idea", "must be one sentence");
	if (sharesRun(idea, stripQuoted(request), limit)) throw new TreatmentError("idea", `restates the request (shares ${limit}+ normalized characters with it); say what the film shows instead`);
	requireText(t, "audience");
	requireText(t, "channel");
	checkStyle(t, house);
	const register = checkRegister(t);
	if (!["16:9", "9:16"].includes(t.format)) throw new TreatmentError("format", t.format === undefined ? "missing" : "must be 16:9 or 9:16");
	requireText(t, "formatReason");
	if (asksVertical(request) && t.format !== "9:16") throw new TreatmentError("format", "the request asks for a vertical film: 9:16");
	if (!asksVertical(request) && t.format === "9:16") throw new TreatmentError("format", "9:16 only when the request asks for a vertical film (vertical, 세로, shorts, reels); otherwise 16:9");

	if (t.durationSec === undefined) throw new TreatmentError("durationSec", "missing");
	if (typeof t.durationSec !== "number" || !Number.isFinite(t.durationSec) || t.durationSec < 4 || t.durationSec > 90) throw new TreatmentError("durationSec", "must be a number of seconds from 4 to 90");
	checkLength(t, request);

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
		if (t.path === "stage") checkShot(t, beat, i, field);
	});
	if (t.path === "stage") checkVariety(t);
	if (t.durationSec - t.beats[t.beats.length - 1].t1 > MAX_GAP_SEC + 1e-9) throw new TreatmentError(`beats[${t.beats.length - 1}]`, `ends before durationSec; beats cover 0 to ${t.durationSec} s`);
	const needed = t.genre === "type-led" ? t.copy.lines.length : ARC_STAGES[t.genre];
	if (t.beats.length < needed) throw new TreatmentError("beats", `a ${t.genre} film needs at least ${needed} beats (${t.genre === "type-led" ? "one per supplied line" : "one per arc stage"}); it has ${t.beats.length}`);

	checkStory(t);
	checkProtagonist(t);
	checkProduct(t);

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
		if (device.kind === "screen") {
			const assets = Array.isArray(t.product?.assets) ? t.product.assets : [];
			const real = assets.find((a) => a.path === device.asset);
			if (!real || !SCREEN_ROLES.has(real.role)) throw new TreatmentError(`${field}.asset`, "a product screen shows the product's real screenshot, UI or README image: name one listed in product.assets; never draw an invented one");
		}
	});
	checkDepth(t);
	checkWorld(t, register);
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
	if (t.path === "stage") {
		const families = styleFamilies(readStyle(t.style));
		const off = t.typePlan.faces.find((f) => ![...families].some((x) => x.toLowerCase() === String(f).toLowerCase()));
		if (off) throw new TreatmentError("typePlan.faces", `${off} is not a face of the ${t.style} style (${[...families].join(", ")})`);
	}
	requireText(t, "typePlan.hierarchy", t.typePlan.hierarchy);
	if (!Number.isInteger(t.typePlan.maxWordsOnScreen) || t.typePlan.maxWordsOnScreen < 1) throw new TreatmentError("typePlan.maxWordsOnScreen", "must be a positive integer");

	if (t.palette === undefined) throw new TreatmentError("palette", "missing");
	const maxColours = t.path === "stage" && register === "rich" ? 10 : 6;
	if (!Array.isArray(t.palette) || t.palette.length < 3 || t.palette.length > maxColours) throw new TreatmentError("palette", `must list 3 to ${maxColours} colours`);
	const allowedColours = t.path === "stage" ? new Set(styleColors(readStyle(t.style), { rich: register === "rich" })) : null;
	t.palette.forEach((entry, i) => {
		if (!/^#[0-9a-f]{6}$/iu.test(entry?.hex ?? "")) throw new TreatmentError(`palette[${i}].hex`, "must be #RRGGBB");
		if (allowedColours && !allowedColours.has(entry.hex.toLowerCase())) throw new TreatmentError(`palette[${i}].hex`, `${entry.hex} is not a colour of the ${t.style} style${register === "rich" ? " or one of its role accents" : " (a minimal film keeps to the core palette)"}; the stage palette comes from the style`);
		requireText(t, `palette[${i}].role`, entry.role);
	});

	if (t.sound === undefined) throw new TreatmentError("sound", "missing");
	if (!t.sound || !["score", "generated", "supplied", "authored", "none"].includes(t.sound.mode)) throw new TreatmentError("sound.mode", "must be score, generated, supplied, authored or none");
	if (t.sound.mode === "none" && !SILENCE_ASKED.test(request) && !MUTED_CHANNEL.test(t.channel)) throw new TreatmentError("sound.mode", "none only when the user asked for silence or the channel plays muted by design; the default is a score");
	if (t.sound.mode === "generated" && register === "rich") throw new TreatmentError("sound.mode", "a rich film scores its own music (mode score); the style's preset beds are for minimal films (references/sound.md)");
	if ("genre" in t.sound && !SCORE_GENRES.includes(t.sound.genre)) throw new TreatmentError("sound.genre", `must be one of ${SCORE_GENRES.join(", ")}`);
	if (t.sound.mode !== "none") requireText(t, "sound.plan", t.sound.plan);
	if (t.sound.mode === "generated") {
		if (!SOUND_PALETTES.includes(t.sound.palette)) throw new TreatmentError("sound.palette", `must be one of ${SOUND_PALETTES.join(", ")}`);
		if (!/^[A-G](?:#|b)? (?:major|minor)$/u.test(t.sound.key ?? "")) throw new TreatmentError("sound.key", 'must look like "D minor" or "F# major"');
		if (!Number.isInteger(t.sound.tempo) || t.sound.tempo < 60 || t.sound.tempo > 160) throw new TreatmentError("sound.tempo", "must be an integer BPM from 60 to 160");
		const beds = styleBeds(readStyle(t.style));
		if (!beds.some((bed) => sameBed(bed, t.sound))) throw new TreatmentError("sound.palette", `pick one of the ${t.style} style's beds: ${beds.map((b) => `${b.palette} ${b.key} ${b.tempo} BPM`).join("; ")}`);
	}
	if ((t.sound.mode === "generated" || t.sound.mode === "score") && t.path === "stage" && !("events" in t.sound)) throw new TreatmentError("sound.events", "list the on-screen events that make a sound: [{ t, on, kind }], at least 2, half of them away from the cuts (references/sound.md, Events)");
	if ("events" in t.sound) checkEvents(t, t.sound.events);
	if (t.sound.mode === "supplied" || t.sound.mode === "authored") requireText(t, "sound.file", t.sound.file);

	const invented = t.copy.source === "invented" || t.subject.source === "invented";
	if (invented) {
		if (t.inventions === undefined) throw new TreatmentError("inventions", "missing");
		if (!Array.isArray(t.inventions) || t.inventions.length === 0 || t.inventions.some((s) => !isText(s))) throw new TreatmentError("inventions", "must list every invented name, fact and line");
		if (t.subject.source === "invented" && !t.inventions.some((s) => normalizeText(s).includes(normalizeText(t.subject.name)))) throw new TreatmentError("inventions", "must contain subject.name");
	} else if (t.inventions !== undefined && !Array.isArray(t.inventions)) throw new TreatmentError("inventions", "must be an array");
	if (t.inventions === undefined) throw new TreatmentError("inventions", "missing (use [] when nothing is invented)");

	if (t.fps !== undefined && t.fps !== 30 && t.fps !== 60) throw new TreatmentError("fps", "optional; 60 by default, or 30");
	if (t.fps === 30 && !asks30fps(request)) throw new TreatmentError("fps", "60; 30 only when the request asks for 30 fps");
	if ("preview" in t && typeof t.preview !== "boolean") throw new TreatmentError("preview", "true or false");
	if (t.preview === true && !asksPreview(request)) throw new TreatmentError("preview", "true only when the request asks for a preview or storyboard first");
	if (t.seed !== undefined && (!Number.isInteger(t.seed) || t.seed < 0 || t.seed > 0xffffffff)) throw new TreatmentError("seed", "optional; an unsigned 32-bit integer");
	const ambition = requireText(t, "ambition");
	if (sentences(ambition) > 2) throw new TreatmentError("ambition", "must be 1 or 2 sentences");
	return t.register === register ? t : { ...t, register };
}

/** Read and validate `<file>`; a missing or unparsable file is a treatment fault too. */
export function loadTreatment(file) {
	if (!existsSync(file)) throw new TreatmentError("treatment", `no treatment.json at ${file}; write it before any render (references/treatment.md)`);
	let parsed;
	try {
		parsed = JSON.parse(readBoundedText(file));
	} catch (error) {
		throw new TreatmentError("treatment", `not valid JSON (${error.message})`);
	}
	return validateTreatment(parsed, { house: readHouse(dirname(file)) });
}
