// Look rounds and Done (director brief section 9). `look` is the only writer of look.json: each
// round is stamped with the SHA-256 of the stills manifest it looked at and of every frame it
// lists, and it refuses frames that are not in the latest stills set and bare yes/no answers. The
// done-check then needs gate PASS, a valid treatment, at least two rounds (the round-1 stills round
// with a change, then a last round on the final render's stills) and full viewing coverage. A cover
// (treatment mode: cover) has its own eight questions, up to three timed defects per round, and its own
// done: the decoded cover at every TARGET gate and a last round that viewed the sheet, poster and seam.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COVER, EXIT, Exit, MAX_ROUNDS } from "./constants.mjs";
import { generatedLabels } from "./cover-assets.mjs";
import { validateCoverTreatment } from "./cover-treatment.mjs";
import { readBounded, readBoundedText } from "./safe-read.mjs";
import { loadTreatment, TreatmentError } from "./treatment.mjs";

export const QUESTIONS = Object.freeze([
	"A stranger would say this film is for: <…>. Does that match the treatment's audience and idea?",
	"Does every beat show its onScreen plan?",
	"Is it rich enough? Put the contact sheet beside the user's reference frames (none given: a studio launch film of a product). Does each shot carry as much labelled detail, layered depth, camera movement and accent colour as they do, with one hero move leading it and the style's hand-offs between shots? A minimal film answers for its restraint instead.",
	"Is any request text, meta label, placeholder, file name or internal term on screen?",
	"Does the ending land?",
	"Does the sound follow the cuts and the events (from sound-cues.json): does each event cue's frame show what its `on` says?",
	"Name one thing a skilled motion designer, given only the request, would have shown that this film does not. Can you name one?",
	"Is any element on screen without a job in its beat?",
	"Could every copy line be pasted unchanged into a film about a different subject?",
	"Does the turn land? Answer it on the turn shot's own still (story.beat): is story.turn visibly happening there, to the protagonist, as the film's largest change? A turn that only a caption announces is a no.",
]);
// Questions 1-9 are asked of every film; the tenth only of a film whose treatment carries a story.
const FILM_BASE = 9;
// The answer that asks for another round, per question: "no" on 1, 2, 3, 5, 6, 10; "yes" on 4, 7, 8, 9.
const REVISE_ON = Object.freeze({ 1: "no", 2: "no", 3: "no", 4: "yes", 5: "no", 6: "no", 7: "yes", 8: "yes", 9: "yes", 10: "no" });
const COVERAGE_KINDS = new Set(["poster", "sheet", "beat", "strip"]);
// Cover mode asks about motion, the seam and damage instead of purpose and beats (references/cover.md).
export const COVER_QUESTIONS = Object.freeze([
	"Is something moving in every half-second window (the sheet's plot never lies flat on the red still line)?",
	"Does the seam disappear in the decoded file (seam.png, the right end of the plot)?",
	"Does it still move after encoding, with no region that freezes and then pops?",
	"Is the brand word present, legible and in place in every frame, never faded or swapped?",
	"Are all three speed layers visible: a slow perpetual layer, a mid swell and beat events?",
	"Does anything read as a slide, a card swap, a title fade or an end card?",
	"Is any glyph, glint or glow damaged: a colour block, a dark disc, a visible box?",
	"Name one thing a skilled motion designer would add or remove. Can you name one?",
]);
const COVER_REVISE_ON = Object.freeze({ 1: "no", 2: "no", 3: "no", 4: "no", 5: "no", 6: "yes", 7: "yes", 8: "yes" });
const COVER_VIEWS = new Set(["sheet", "poster", "seam"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (message) => {
	throw new Exit(EXIT.USAGE, `look refused: ${message}`);
};

/** The latest stills set: its manifest, the manifest's SHA-256 and the files by name. */
export function latestStills(outDir) {
	const path = join(outDir, "stills", "manifest.json");
	if (!existsSync(path)) return null;
	const text = readBoundedText(path);
	const manifest = JSON.parse(text);
	return { manifest, sha: sha256(text), files: new Map(manifest.files.map((f) => [f.file, f])) };
}

export function readLook(outDir) {
	const path = join(outDir, "look.json");
	return existsSync(path) ? JSON.parse(readBoundedText(path)) : { schema: 1, rounds: [] };
}

const bare = /^\s*(?:yes|no|y|n|ok|okay|fine|good|none|n\/a|네|아니오|예)\s*[.!]?\s*$/iu;
const sentence = (text) => typeof text === "string" && !bare.test(text) && text.trim().length >= 20 && text.trim().split(/\s+/u).length >= 5;

const readTreatmentRaw = (outDir) => {
	try {
		return JSON.parse(readBoundedText(join(outDir, "treatment.json")));
	} catch {
		return null;
	}
};

/** The still of the story's turn beat (`beat-NN.png` for `story.beat`), or null when the treatment has no story. */
function turnStill(outDir) {
	const beat = readTreatmentRaw(outDir)?.story?.beat;
	return Number.isInteger(beat) && beat >= 0 ? `beat-${String(beat + 1).padStart(2, "0")}.png` : null;
}

/** Validate an answers file against the latest stills set and append the round to look.json. */
export function recordLook(outDir, round, answersPath) {
	if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) refuse(`--round must be 1..${MAX_ROUNDS}`);
	let body;
	try {
		body = JSON.parse(readFileSync(answersPath, "utf8"));
	} catch (error) {
		refuse(`answers file unreadable (${error.message})`);
	}
	const stills = latestStills(outDir);
	if (!stills) refuse("no stills set yet; render stills first");
	const look = readLook(outDir);
	const previous = look.rounds.at(-1);
	if (previous && round <= previous.round) refuse(`round ${round} is already recorded; the next round is ${previous.round + 1}`);
	if (body.blocked) {
		if (body.blocked !== "no-vision-tool") refuse('blocked must be "no-vision-tool"');
		const entry = { round, at: new Date().toISOString(), blocked: body.blocked, manifestSha256: stills.sha };
		look.rounds.push(entry);
		writeFileSync(join(outDir, "look.json"), `${JSON.stringify(look, null, 2)}\n`);
		return entry;
	}
	if (stills.manifest.round !== round) refuse(`the latest stills set is from round ${stills.manifest.round}; look at the stills of round ${round} (render it first)`);
	if (stills.manifest.mode === "cover") return recordCoverLook({ outDir, round, body, stills, look });
	if (round === 1 && stills.manifest.kind !== "stills-only") refuse("round 1 is a stills round: run the render with --stills-only --round 1 first");
	const name = (file) => String(file ?? "").replace(/^stills\//u, "");
	const viewed = Array.isArray(body.viewed) ? body.viewed.map(name) : [];
	const listed = [...viewed];
	if (!Array.isArray(body.answers)) refuse("answers must be an array of { q, verdict, frame, observed }");
	const turn = turnStill(outDir);
	const byQ = new Map();
	for (const answer of body.answers) {
		const q = Number(answer?.q);
		if (!Number.isInteger(q) || q < 1 || q > QUESTIONS.length || (q > FILM_BASE && turn === null)) refuse(`unknown question ${answer?.q}${q > FILM_BASE ? " (question 10 belongs to a treatment with a story)" : ""}`);
		if (byQ.has(q)) refuse(`question ${q} answered twice`);
		if (answer.verdict !== "yes" && answer.verdict !== "no") refuse(`question ${q}: verdict must be "yes" or "no"`);
		if (!sentence(answer.observed)) refuse(`question ${q}: observed must be a sentence naming a concrete visible detail, not a bare yes/no`);
		if (q === 1 && !/for:\s*\S/iu.test(answer.observed)) refuse('question 1: observed must read "A stranger would say this film is for: <…>"');
		const frame = name(answer.frame);
		if (q === 10 && frame !== turn) refuse(`question 10: answer it on the turn shot's still ${turn} (story.beat in treatment.json), not ${frame || "no frame"}`);
		if (frame === "sound-cues.json") {
			if (q !== 6 || !existsSync(join(outDir, "sound-cues.json"))) refuse(`question ${q}: sound-cues.json is only for question 6 and must exist`);
		} else listed.push(frame);
		byQ.set(q, { q, verdict: answer.verdict, frame, observed: answer.observed.trim(), ...(q === 1 ? { by: answer.by === "blind" ? "blind" : "self" } : {}) });
	}
	const defects = recordDefects(body.defects, stills, false, readTreatmentRaw(outDir)?.durationSec ?? null);
	listed.push(...defects.map((d) => d.frame));
	for (let q = 1; q <= (turn === null ? FILM_BASE : QUESTIONS.length); q++) if (!byQ.has(q)) refuse(`question ${q} is not answered (${QUESTIONS[q - 1]})`);
	const unknown = [...new Set(listed)].filter((file) => !stills.files.has(file));
	if (unknown.length) refuse(`not in the latest stills set: ${unknown.join(", ")}`);
	const frames = {};
	for (const file of new Set(listed)) {
		const bytes = readFileSync(join(outDir, "stills", file));
		if (sha256(bytes) !== stills.files.get(file).sha256) refuse(`${file} changed after the stills manifest was written; render again`);
		frames[file] = sha256(bytes);
	}
	if (round === 1) {
		if (!Number.isInteger(body.weakestBeat) || body.weakestBeat < 1) refuse("round 1 must name the weakest beat (weakestBeat, 1-based)");
		if (typeof body.change !== "string" || body.change.trim().split(/\s+/u).length < 3) refuse("round 1 must state the change you made (change)");
	}
	const answers = [...byQ.values()].sort((a, b) => a.q - b.q);
	const openItems = answers.filter((a) => a.verdict === REVISE_ON[a.q]).map((a) => `Q${a.q}: ${a.observed}`);
	const entry = { round, at: new Date().toISOString(), kind: stills.manifest.kind, manifestSha256: stills.sha, frames, viewed: [...new Set(viewed)], answers, ...(defects.length ? { defects } : {}), ...(round === 1 ? { weakestBeat: body.weakestBeat, change: body.change.trim() } : {}), needsAnotherRound: openItems.length > 0, openItems };
	look.rounds.push(entry);
	writeFileSync(join(outDir, "look.json"), `${JSON.stringify(look, null, 2)}\n`);
	return entry;
}

/** Check every stills file a round names and stamp it with its SHA-256; refuses files outside the set. */
function stampFrames(outDir, stills, files) {
	const unknown = [...new Set(files)].filter((file) => !stills.files.has(file));
	if (unknown.length) refuse(`not in the latest stills set: ${unknown.join(", ")}`);
	const frames = {};
	for (const file of new Set(files)) {
		const bytes = readFileSync(join(outDir, "stills", file));
		if (sha256(bytes) !== stills.files.get(file).sha256) refuse(`${file} changed after the stills manifest was written; render again`);
		frames[file] = sha256(bytes);
	}
	return frames;
}

/**
 * Defects: at most COVER.maxDefects per round, worst first, each { t, region, frame, observed, cause,
 * fix }: the time in seconds where it shows (the loop time for a cover), the [x, y, w, h] it covers in
 * frame pixels, and a file of the current stills set that shows it. A cover checks the fix with
 * `render.mjs cover --window`; a film fixes those seconds and renders again. Optional on a film round.
 */
function recordDefects(list, stills, cover, treatmentDuration = null) {
	if (list === undefined) return [];
	if (!Array.isArray(list)) refuse("defects must be an array");
	if (list.length > COVER.maxDefects) refuse(`at most ${COVER.maxDefects} defects per round; fix the worst first`);
	const { width, height, fps, frameCount } = stills.manifest;
	const durationSec = stills.manifest.durationSec ?? (frameCount && fps ? frameCount / fps : treatmentDuration);
	const what = cover ? "cover" : "frame";
	const name = (file) => String(file ?? "").replace(/^stills\//u, "");
	return list.map((d, i) => {
		const at = `defect ${i + 1}`;
		if (!d || typeof d !== "object") refuse(`${at} must be an object`);
		if (typeof d.t !== "number" || !(d.t >= 0) || (durationSec && d.t >= durationSec)) refuse(`${at}: t must be the ${cover ? "loop " : ""}time in seconds${durationSec ? ` (0 to ${durationSec})` : ""} where the defect shows`);
		const r = d.region;
		if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger) || r[0] < 0 || r[1] < 0 || r[2] <= 0 || r[3] <= 0 || r[0] + r[2] > width || r[1] + r[3] > height) refuse(`${at}: region must be [x, y, w, h] in whole pixels inside the ${width}x${height} ${what}`);
		if (!stills.files.has(name(d.frame))) refuse(`${at}: frame ${JSON.stringify(d.frame)} is not in the latest stills set`);
		if (!sentence(d.observed)) refuse(`${at}: observed must be a sentence naming what is visible there`);
		if (![d.cause, d.fix].every((x) => typeof x === "string" && x.trim().split(/\s+/u).length >= 3)) refuse(`${at}: cause and fix must each say something concrete`);
		return { t: d.t, region: r, frame: name(d.frame), observed: d.observed.trim(), cause: d.cause.trim(), fix: d.fix.trim() };
	});
}

/** One cover look round: the eight cover questions, the defects, and round 1's change (no stills-only round). */
function recordCoverLook({ outDir, round, body, stills, look }) {
	const name = (file) => String(file ?? "").replace(/^stills\//u, "");
	const viewed = Array.isArray(body.viewed) ? body.viewed.map(name) : [];
	if (!viewed.length) refuse("viewed must list every stills file you opened with view_image this round");
	if (!Array.isArray(body.answers)) refuse("answers must be an array of { q, verdict, frame, observed }");
	const byQ = new Map();
	for (const answer of body.answers) {
		const q = Number(answer?.q);
		if (!Number.isInteger(q) || q < 1 || q > COVER_QUESTIONS.length) refuse(`unknown question ${answer?.q} (a cover round answers ${COVER_QUESTIONS.length})`);
		if (byQ.has(q)) refuse(`question ${q} answered twice`);
		if (answer.verdict !== "yes" && answer.verdict !== "no") refuse(`question ${q}: verdict must be "yes" or "no"`);
		if (!sentence(answer.observed)) refuse(`question ${q}: observed must be a sentence naming a concrete visible detail, not a bare yes/no`);
		byQ.set(q, { q, verdict: answer.verdict, frame: name(answer.frame), observed: answer.observed.trim() });
	}
	for (let q = 1; q <= COVER_QUESTIONS.length; q++) if (!byQ.has(q)) refuse(`question ${q} is not answered (${COVER_QUESTIONS[q - 1]})`);
	const answers = [...byQ.values()].sort((a, b) => a.q - b.q);
	const defects = recordDefects(body.defects, stills, true);
	const frames = stampFrames(outDir, stills, [...viewed, ...answers.map((a) => a.frame), ...defects.map((d) => d.frame)]);
	if (round === 1 && (typeof body.change !== "string" || body.change.trim().split(/\s+/u).length < 3)) refuse("round 1 must state the change you made (change)");
	const openItems = answers.filter((a) => a.verdict === COVER_REVISE_ON[a.q]).map((a) => `Q${a.q}: ${a.observed}`);
	const entry = { round, at: new Date().toISOString(), kind: "cover", mode: "cover", manifestSha256: stills.sha, frames, viewed: [...new Set(viewed)], answers, defects, ...(typeof body.change === "string" ? { change: body.change.trim() } : {}), needsAnotherRound: openItems.length > 0, openItems };
	look.rounds.push(entry);
	writeFileSync(join(outDir, "look.json"), `${JSON.stringify(look, null, 2)}\n`);
	return entry;
}

/** Frames viewed for the render whose stills manifest hash is `manifestSha`, from look.json only. */
export function viewedFor(outDir, manifestSha) {
	if (!manifestSha) return null;
	const rounds = readLook(outDir).rounds.filter((r) => r.manifestSha256 === manifestSha && !r.blocked);
	if (!rounds.length) return null;
	return new Set(rounds.flatMap((r) => [...(r.viewed ?? []), ...Object.keys(r.frames ?? {})])).size;
}

const subjectBeats = (t) => new Set((t.visualDevices ?? []).filter((d) => d.role === "subject").flatMap((d) => d.beats)).size;
const SILENCE_ASKED = /무음|소리\s*없|음악\s*없|\bsilent\b|\bsilence\b|\bno\s+(?:sound|audio|music)\b|\bwithout\s+(?:sound|audio|music)\b|\bmuted?\b/iu;

/** What the final treatment gave up against the first valid one (the brief's four downgrades). */
export function downgrades(first, final) {
	if (!first || !final) return [];
	const out = [];
	if (final.durationSec < first.durationSec * 0.8 - 1e-9) out.push(`durationSec dropped ${Math.round((1 - final.durationSec / first.durationSec) * 100)}% (${first.durationSec} s to ${final.durationSec} s)`);
	if (subjectBeats(final) < subjectBeats(first)) out.push(`fewer subject beats (${subjectBeats(first)} to ${subjectBeats(final)})`);
	if (first.sound?.mode !== "none" && final.sound?.mode === "none" && !SILENCE_ASKED.test(final.request)) out.push("sound changed to none without a user request");
	if (first.path === "stage" && final.path === "type") out.push("path changed from stage to type");
	return out;
}

const EXPORTS = ["film.mp4", "poster.png", "reduced-motion.png"];
const PREVIEWS = ["preview.webp", "preview.gif"];

/**
 * The done-check. Returns { status: "complete" | "not complete" | "DONE_UNVIEWED", reason,
 * downgraded[], openItems[] }.
 */
export function evaluateDone(outDir) {
	try {
		return judgeDone(outDir);
	} catch (error) {
		// A render folder the check cannot read (a pipe, a device link, an oversize or garbled file) is a verdict, not a crash.
		return { status: "not complete", reason: `the render state in ${outDir} could not be read (${String(error?.message ?? error).split("\n")[0]})`, downgraded: [], openItems: [] };
	}
}

function judgeDone(outDir) {
	const notDone = (reason) => ({ status: "not complete", reason, downgraded: [], openItems: [] });
	try {
		const raw = JSON.parse(readBoundedText(join(outDir, "treatment.json")));
		if (raw?.mode === "cover") return evaluateCoverDone(outDir, raw);
	} catch {
		// A missing or unreadable treatment is reported by the film checks below.
	}
	const manifestPath = join(outDir, "manifest.json");
	const reportPath = join(outDir, "gate-report.txt");
	if (!existsSync(manifestPath) || !existsSync(reportPath)) return notDone("no manifest and gate report: nothing verified was rendered (a started, stills-only or BLOCKED run)");
	let treatment;
	try {
		treatment = loadTreatment(join(outDir, "treatment.json"));
	} catch (error) {
		if (error instanceof TreatmentError) return notDone(`the treatment is not valid (${error.message})`);
		throw error;
	}
	const manifest = JSON.parse(readBoundedText(manifestPath));
	const report = readBoundedText(reportPath);
	const rendered = statSync(manifestPath).mtimeMs;
	if (statSync(join(outDir, "treatment.json")).mtimeMs > rendered) return notDone("the treatment changed after the last render; render again");
	const page = join(outDir, "stage", "index.html");
	if (manifest.path === "stage" && existsSync(page) && statSync(page).mtimeMs > rendered) return notDone("the stage page changed after the last render; render again");
	if (report.includes("(pre-flight; nothing rendered)")) return notDone("pre-flight gate stopped the render; nothing was rendered");
	const passed = /^QA gate: PASS/mu.test(report);
	const round = Number(manifest.round ?? 1);
	const withheld = /render withheld/u.test(report);
	const delivered = (dir) => EXPORTS.every((n) => existsSync(join(dir, n))) && PREVIEWS.some((n) => existsSync(join(dir, n)));
	if (!passed && round < MAX_ROUNDS) return notDone(`gate FAIL at round ${round} of ${MAX_ROUNDS}: fix the named cause and render round ${round + 1}`);
	if (withheld && (!delivered(join(outDir, "withheld")) || [...EXPORTS, ...PREVIEWS].some((n) => existsSync(join(outDir, n))))) return notDone("flash FAIL but the exports are not confined to withheld/");
	if (!withheld && !delivered(outDir)) return notDone("an export is missing at its deliverable name");
	const first = existsSync(join(outDir, ".run", "treatment-first.json")) ? JSON.parse(readBoundedText(join(outDir, ".run", "treatment-first.json"))) : null;
	const downgraded = downgrades(first, treatment);
	const rounds = readLook(outDir).rounds;
	const last = rounds.at(-1);
	const gateNote = passed ? "gate PASS" : withheld ? "round 3 ended with a flash FAIL; the film is withheld" : "round 3 ended with failed rules named in the report";
	if (last?.blocked) return { status: "DONE_UNVIEWED", reason: `${gateNote}, but no image tool was reachable: nobody viewed the frames. Say so plainly in the reply.`, downgraded, openItems: [] };
	if (rounds.length < 2) return { ...notDone("needs at least 2 look rounds: the round-1 stills round with a change, then a last round on the final render's stills"), downgraded };
	const opening = rounds[0];
	if (opening.round !== 1 || opening.kind !== "stills-only" || !opening.change) return { ...notDone("the first look round must be the round-1 stills round, naming the weakest beat and the change made"), downgraded };
	if (last.manifestSha256 !== manifest.stillsManifestSha256) return { ...notDone("the last look round viewed an older stills set than the final render; view the final render's stills and record another round"), downgraded };
	const stills = latestStills(outDir);
	const required = stills ? [...stills.files.values()].filter((f) => COVERAGE_KINDS.has(f.kind)).map((f) => f.file) : [];
	const seen = new Set([...(last.viewed ?? []), ...Object.keys(last.frames ?? {})]);
	const unseen = required.filter((file) => !seen.has(file));
	if (unseen.length) return { ...notDone(`the last look round did not view ${unseen.join(", ")} (the poster, the contact sheet, every beat midpoint and every transition strip)`), downgraded };
	if (last.needsAnotherRound && last.round < MAX_ROUNDS) return { ...notDone(`look round ${last.round} found items that need another round: ${last.openItems.map((item) => item.split(":")[0]).join(", ")}`), downgraded };
	return { status: "complete", reason: `${gateNote}; ${rounds.length} look rounds, the last on the final render with every still viewed${last.openItems.length ? "; deliver with the open items stated" : ""}`, downgraded, openItems: last.openItems ?? [] };
}

/**
 * The cover done-check (references/cover.md, Rounds and done): a valid cover treatment unchanged since
 * the last cover render, that render's report at PASS+TARGET, at least two look rounds (the first naming
 * its change), and the last round stamped with that render's stills and viewing the sheet, the poster
 * and the seam pair. Generated assets come back as labels the reply has to carry.
 */
export function evaluateCoverDone(outDir, raw) {
	const labels = generatedLabels(outDir);
	const notDone = (reason) => ({ status: "not complete", reason, downgraded: [], openItems: [], labels, mode: "cover" });
	try {
		validateCoverTreatment(raw);
	} catch (error) {
		if (error instanceof TreatmentError) return notDone(`the cover treatment is not valid (${error.message})`);
		throw error;
	}
	const manifestPath = join(outDir, "manifest.json");
	const reportPath = join(outDir, "gate-report.txt");
	if (!existsSync(manifestPath) || !existsSync(reportPath)) return notDone("no finished cover render: manifest.json or gate-report.txt is missing");
	const manifest = JSON.parse(readBoundedText(manifestPath));
	if (manifest.mode !== "cover") return notDone("the last render was not a cover render; run `render.mjs cover`");
	if (manifest.treatmentSha256 !== sha256(readBounded(join(outDir, "treatment.json")))) return notDone("treatment.json changed after the last cover render; render again");
	if (!/^COVER gate --strict: PASS\+TARGET$/mu.test(readBoundedText(reportPath))) return notDone("the decoded cover did not reach every TARGET gate on the last render (gate-report.txt)");
	const rounds = readLook(outDir).rounds;
	const last = rounds.at(-1);
	if (last?.blocked) return { status: "DONE_UNVIEWED", reason: "every TARGET gate passed, but no image tool was reachable: nobody viewed the sheet. Say so plainly in the reply.", downgraded: [], openItems: [], labels, mode: "cover" };
	if (rounds.length < 2) return notDone("needs at least 2 look rounds: view the sheet, poster and seam pair with view_image, record the round, make its change, render, look again");
	if (!rounds[0].change) return notDone("the first look round must name the change made after it");
	if (last.manifestSha256 !== manifest.stillsManifestSha256) return notDone("the last look round viewed an older stills set than the final cover render; view the final stills and record another round");
	const stills = latestStills(outDir);
	const required = stills ? [...stills.files.values()].filter((f) => COVER_VIEWS.has(f.kind)).map((f) => f.file) : [];
	const seen = new Set([...(last.viewed ?? []), ...Object.keys(last.frames ?? {})]);
	const unseen = required.filter((file) => !seen.has(file));
	if (unseen.length) return notDone(`the last look round did not view ${unseen.join(", ")} (the sheet, the poster and the seam pair)`);
	if (last.needsAnotherRound && last.round < MAX_ROUNDS) return notDone(`look round ${last.round} found items that need another round: ${last.openItems.map((item) => item.split(":")[0]).join(", ")}`);
	return { status: "complete", reason: `every TARGET gate passed on the decoded cover; ${rounds.length} look rounds, the last on the final render with the sheet, poster and seam pair viewed${last.openItems.length ? "; deliver with the open items stated" : ""}`, downgraded: [], openItems: last.openItems ?? [], labels, mode: "cover" };
}
