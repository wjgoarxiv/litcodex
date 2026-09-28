// Brief -> timeline. Tier 1 paces every unit at 1.25x the one reading floor and snaps each cut
// forward onto the beat grid (default 100 BPM); Tier 2 snaps the same holds onto a librosa beat
// grid produced for this run's own audio. The anchor-and-snap method is re-implemented generically
// against the brief's own text (MO-A-06); nothing here encodes another film's edit list.
import { FRAME, READING, TIMING } from "./constants.mjs";
import { countUnits, eojeols, readingFloor, scriptOf, smart } from "./type.mjs";

export const SCENE_IDS = Object.freeze(["title-slam", "word-line", "kinetic-list", "number-counter", "stroke-signature", "end-card"]);
const LIST_SPLIT = /\s+[·•|/]\s+|[,;]\s+/u;

function lineText(item) {
	return typeof item === "string" ? item : String(item?.text ?? "");
}

/** Validate and normalise a user brief into lines with scene assignments. */
export function normalizeBrief(raw) {
	if (!raw || typeof raw !== "object") throw new Error("brief must be a JSON object");
	const lines = (Array.isArray(raw.lines) ? raw.lines : []).map((item) => ({
		text: smart(lineText(item)).trim(),
		scene: typeof item === "object" && item ? item.scene : undefined,
		accent: typeof item === "object" && item ? item.accent === true : false,
		font: typeof item === "object" && item ? item.font : undefined,
	}));
	if (lines.length === 0 && raw.title) lines.push({ text: smart(String(raw.title)).trim() });
	if (lines.length === 0) throw new Error('brief needs "lines" (one to eight strings) or a "title"');
	if (lines.length > 8) throw new Error("brief has more than eight lines; split the film");
	for (const line of lines) {
		if (!line.text) throw new Error("brief contains an empty line");
		if (Array.from(line.text).length > 160) throw new Error(`line longer than 160 characters: ${line.text.slice(0, 40)}…`);
		if (line.scene !== undefined && !SCENE_IDS.includes(line.scene)) throw new Error(`unknown scene "${line.scene}" (choose ${SCENE_IDS.join(", ")})`);
	}
	const bpm = raw.bpm === undefined ? TIMING.defaultBpm : Number(raw.bpm);
	if (!Number.isFinite(bpm) || bpm < TIMING.minBpm || bpm > TIMING.maxBpm) throw new Error(`bpm must be ${TIMING.minBpm}..${TIMING.maxBpm}`);
	const seed = raw.seed === undefined ? TIMING.defaultSeed : Number(raw.seed);
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("seed must be an unsigned 32-bit integer");
	const durationSec = raw.durationSec === undefined ? 0 : Number(raw.durationSec);
	if (!Number.isFinite(durationSec) || durationSec < 0 || durationSec > 180) throw new Error("durationSec must be 0..180");
	assignScenes(lines);
	const filmName = raw.filmName === undefined || raw.filmName === null || raw.filmName === "" ? null : smart(String(raw.filmName)).trim();
	return { title: raw.title ? smart(String(raw.title)) : lines[0].text, filmName, showIndex: raw.showIndex === true, mood: raw.mood ?? "", preset: raw.preset, presetSource: raw.presetSource === "user" ? "user" : "agent", lines, bpm, seed, durationSec };
}

function assignScenes(lines) {
	const n = lines.length;
	lines.forEach((line, i) => {
		if (line.scene) return;
		if (i === 0) line.scene = "title-slam";
		else if (i === n - 1 && n >= 3) line.scene = "end-card";
		else if (line.text.split(LIST_SPLIT).filter(Boolean).length >= 3) line.scene = "kinetic-list";
		else if (/^\D{0,24}\d[\d,]*(?:\.\d+)?\D{0,40}$/u.test(line.text) && eojeols(line.text).length <= 5) line.scene = "number-counter";
		else line.scene = "word-line";
	});
	for (const line of lines) {
		if (line.scene === "stroke-signature" && scriptOf(line.text) !== "latin") line.scene = "word-line";
	}
}

/** The reveal units inside a shot: whole 어절/words for a karaoke line, whole items for a list. */
export function revealUnits(line) {
	if (line.scene === "word-line") return eojeols(line.text);
	if (line.scene === "kinetic-list") return line.text.split(LIST_SPLIT).map((item) => item.trim()).filter(Boolean);
	return [];
}

/** Seconds a shot needs before snapping: 1.25x its floor, and room for its reveal steps. */
function shotNeed(line) {
	const floor = readingFloor(line.text, "line");
	const units = revealUnits(line);
	const revealRoom = units.length ? (units.length * TIMING.paceFactor * READING.revealFloor) / 0.7 : 0;
	const { C } = countUnits(line.text);
	const cpsRoom = (C / READING.maxLatinCps) * TIMING.paceFactor;
	const signature = line.scene === "stroke-signature" ? 2.4 : 0;
	return Math.max(TIMING.paceFactor * floor, revealRoom, cpsRoom, signature);
}

/**
 * Build the canonical timeline (spec §A10). `beatGrid` (Tier 2) is an ascending array of beat
 * seconds; without it the grid is regular at `bpm`.
 */
export function buildTimeline(brief, { beatGrid = null, fps = FRAME.fps } = {}) {
	const beat = 60 / brief.bpm;
	const beatAt = (k) => {
		if (!beatGrid) return k * beat;
		if (k < beatGrid.length) return beatGrid[k];
		const tail = beatGrid.length > 1 ? beatGrid[beatGrid.length - 1] - beatGrid[beatGrid.length - 2] : beat;
		return beatGrid[beatGrid.length - 1] + (k - beatGrid.length + 1) * tail;
	};
	const needs = brief.lines.map(shotNeed);
	const beats = [];
	let index = 0;
	for (const need of needs) {
		let end = index + TIMING.minSceneBeats;
		while (beatAt(end) - beatAt(index) < need - 1e-9) end++;
		beats.push([index, end]);
		index = end;
	}
	const target = brief.durationSec;
	let extra = 0;
	while (target > 0 && beatAt(beats[beats.length - 1][1]) < target - 1e-9) {
		const shot = extra % beats.length;
		beats[shot][1] += 1;
		for (let j = shot + 1; j < beats.length; j++) {
			beats[j][0] += 1;
			beats[j][1] += 1;
		}
		extra++;
	}
	const shotCounts = new Map();
	const timeline = [];
	const shots = [];
	brief.lines.forEach((line, i) => {
		const [b0, b1] = beats[i];
		const start = i === 0 ? 0 : round(beatAt(b0));
		const end = round(beatAt(b1));
		const shotIndex = shotCounts.get(line.scene) ?? 0;
		shotCounts.set(line.scene, shotIndex + 1);
		const id = `s${i + 1}-${line.scene}`;
		const entry = { id, sceneId: line.scene, shotIndex, start, end, holdSec: round(end - start), kind: "line", text: line.text, script: scriptOf(line.text), beatSec: round(beatAt(b0)) };
		timeline.push(entry);
		const units = revealUnits(line);
		const reveals = [];
		if (units.length) {
			const span = (end - start) * 0.7;
			const step = Math.max(READING.revealFloor * TIMING.paceFactor, span / units.length);
			units.forEach((text, k) => {
				const rs = round(start + k * step);
				const re = k === units.length - 1 ? end : round(start + (k + 1) * step);
				const unit = { id: `${id}/r${k}`, sceneId: line.scene, shotIndex, start: rs, end: re, holdSec: round(re - rs), kind: "reveal", text, script: scriptOf(text), beatSec: round(beatAt(nearestBeatIndex(beatAt, rs))) };
				timeline.push(unit);
				reveals.push(unit);
			});
		}
		shots.push({ ...entry, line, reveals, beat: round(beatAt(b0 + 1) - beatAt(b0)), frameStart: Math.round(start * fps), frameEnd: Math.round(end * fps) - 1 });
	});
	const durationSec = round(beatAt(beats[beats.length - 1][1]));
	return { timeline, shots, durationSec, bpm: beatGrid ? null : brief.bpm, beatGrid: beatGrid ? [...beatGrid] : null, fps, totalFrames: Math.round(durationSec * fps) };
}

function nearestBeatIndex(beatAt, t) {
	let k = 0;
	while (beatAt(k + 1) <= t + 1e-9) k++;
	return k;
}

const round = (value) => Math.round(value * 1e6) / 1e6;

/** The accent moment: the one timeline entry allowed to show the preset's accent (MO-C-29). */
export function accentShot(shots) {
	const flagged = shots.find((shot) => shot.line.accent);
	if (flagged) return flagged.id;
	const end = shots.find((shot) => shot.sceneId === "end-card");
	return (end ?? shots[shots.length - 1]).id;
}
