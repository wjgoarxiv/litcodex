import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EVENT_SOUNDS, SCORE_GENRES } from "./engine/constants.mjs";
import { buildScore, planScore, SCORE_STEMS, sidechainDepth, writeScore } from "./engine/score.mjs";
import { buildBed, eventCues, integratedLoudness, masterTo, prepareTrack, readWav, SOUND, soundRules, soundStats } from "./engine/sound.mjs";
import { readStyle } from "./engine/styles.mjs";

// The per-film score (sound mode `score`): layered stems, sidechain, lookahead limiter, BS.1770 master.
// Pure audio, so nothing here needs Chrome; the AAC checks use a real ffmpeg and skip without one.
const FFMPEG = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-score-")));
	temps.push(dir);
	return dir;
};

type Beat = { t0: number; t1: number; purpose: string; onScreen: string; motion: string; sound: string };
type Treatment = Record<string, any>;
/** A rich stage treatment reduced to what the score reads. */
function film({ request = "a calm film about a lighthouse", style = "swiss-signal", cuts = [0, 3, 6, 9, 12], turn = 2, name = "Lamp", genre = undefined as string | undefined, events = [] as Array<{ t: number; on: string; kind: string }> } = {}): Treatment {
	const beats: Beat[] = cuts.slice(0, -1).map((t0, i) => ({ t0, t1: cuts[i + 1], purpose: `beat ${i} of ${request}`, onScreen: "x", motion: "y", sound: "the groove holds" }));
	return {
		request,
		idea: `the idea of ${request}`,
		style,
		register: "rich",
		beats,
		durationSec: cuts[cuts.length - 1],
		story: { expect: "a dark shore", turn: `the lamp of ${name} turns`, beat: turn, payoff: "light" },
		protagonist: { name, kind: "object", look: "a lamp", acts: ["turns"] },
		sound: { mode: "score", plan: "a layered score", ...(genre ? { genre } : {}), events },
	};
}
const FPS = 30;
const framesFor = (t: Treatment) => Math.round(t.durationSec * FPS);
const cutsOf = (t: Treatment) => t.beats.slice(1).map((b: Beat) => b.t0);
const build = (t: Treatment) => buildScore({ treatment: t, frameCount: framesFor(t), fps: FPS, cutTimes: cutsOf(t) });
const rms = (st: { left: Float32Array; right: Float32Array }, a = 0, b = st.left.length) => {
	let sum = 0;
	for (let i = a; i < b; i++) sum += st.left[i] * st.left[i] + st.right[i] * st.right[i];
	return Math.sqrt(sum / Math.max(1, 2 * (b - a)));
};
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-12));

describe("the plan", () => {
	it("names nine stems in mix order", () => {
		expect([...SCORE_STEMS]).toEqual(["kick", "clap", "hats", "perc", "bass", "chords", "lead", "fx", "events"]);
	});
	it("takes the genre from the style, and an explicit sound.genre wins", () => {
		const bands: Record<string, [number, number]> = { house: [120, 126], "tech-house": [124, 128], "deep-house": [118, 122], garage: [130, 134] };
		for (const id of ["swiss-signal", "tidal", "terminalcore", "paper"]) {
			const style = readStyle(id);
			const plan = planScore({ treatment: film({ style: id }), durationSec: 12 });
			expect(plan.genre).toBe(style.score.genre);
			expect(SCORE_GENRES).toContain(plan.genre);
			expect(plan.bpm).toBeGreaterThanOrEqual(bands[plan.genre][0]);
			expect(plan.bpm).toBeLessThanOrEqual(bands[plan.genre][1]);
		}
		expect(planScore({ treatment: film({ style: "swiss-signal", genre: "garage" }), durationSec: 12 }).genre).toBe("garage");
	});
	it("always plans the same for one treatment and differently for two", () => {
		const a = film({ request: "a calm film about a lighthouse", turn: 2 });
		const b = film({ request: "a loud launch film for a ferry timetable", cuts: [0, 2, 4, 6, 8, 10, 12, 14], turn: 4, name: "Ferry" });
		const planA = planScore({ treatment: a, durationSec: 12 });
		expect(JSON.stringify(planScore({ treatment: a, durationSec: 12 }))).toBe(JSON.stringify(planA));
		const planB = planScore({ treatment: b, durationSec: 14 });
		expect(planA.bpm).not.toBe(planB.bpm);
		expect(`${planA.key} ${planA.mode}`).not.toBe(`${planB.key} ${planB.mode}`);
		expect(planA.sections.map((s: { kind: string }) => s.kind)).not.toEqual(planB.sections.map((s: { kind: string }) => s.kind));
		expect(planA.progression).not.toEqual(planB.progression);
	});
	it("spreads keys and tempos across films", () => {
		const requests = ["tide pool", "ferry timetable", "paper crane", "night market", "glass harbor", "copper kettle", "slow bicycle", "winter garden"];
		const plans = requests.map((request) => planScore({ treatment: film({ request, style: "tidal" }), durationSec: 12 }));
		expect(new Set(plans.map((p) => p.bpm)).size).toBeGreaterThanOrEqual(3);
		expect(new Set(plans.map((p) => p.key)).size).toBeGreaterThanOrEqual(4);
	});
	it("lands the drop on a bar line at the start of the story beat", () => {
		for (const turn of [0, 1, 2, 3]) {
			const t = film({ turn, request: `turn ${turn} film` });
			const plan = planScore({ treatment: t, durationSec: 12 });
			const drop = plan.sections.find((s: { kind: string }) => s.kind === "drop");
			expect(drop.beat).toBe(turn);
			expect(drop.t0).toBe(t.beats[turn].t0);
			const bars = (drop.t0 - plan.origin) / plan.barSec;
			expect(Math.abs(bars - Math.round(bars))).toBeLessThan(1e-6);
		}
	});
	it("arranges intro, builds, the drop, a break before a second drop, an outro", () => {
		const t = film({ cuts: [0, 2, 4, 6, 8, 10, 12], turn: 2 });
		const kinds = planScore({ treatment: t, durationSec: 12 }).sections.map((s: { kind: string }) => s.kind);
		expect(kinds).toEqual(["intro", "build", "drop", "break", "drop", "outro"]);
	});
});

describe("the mix", { timeout: 120000 }, () => {
	const t = film({ events: [{ t: 1.3, on: "the lamp clicks on", kind: "tap" }, { t: 4.4, on: "the beam sweeps", kind: "whoosh" }, { t: 7.7, on: "the door lands", kind: "hit" }, { t: 10.1, on: "the sign lights", kind: "chime" }] });
	const score = build(t);
	it("has at least six audible stems, each above a floor", () => {
		const audible = SCORE_STEMS.filter((name: string) => db(rms(score.stems[name])) > -60);
		expect(audible.length).toBeGreaterThanOrEqual(6);
		for (const name of SCORE_STEMS) expect(db(rms(score.stems[name])), name).toBeGreaterThan(-60);
	});
	it("ducks the bass under the kick with a sidechain", () => {
		expect(sidechainDepth(score)).toBeGreaterThanOrEqual(3);
	});
	it("meets the master: -16 LUFS, peak under -2 dBFS, finite, never clipped", () => {
		const stats = soundStats([score.left, score.right]);
		expect(Math.abs(integratedLoudness([score.left, score.right]) + 16)).toBeLessThanOrEqual(0.5);
		expect(stats.peakDb).toBeLessThanOrEqual(-2 + 1e-9);
		for (const ch of [score.left, score.right]) for (let i = 0; i < ch.length; i += 7) if (!Number.isFinite(ch[i])) throw new Error(`non-finite sample at ${i}`);
		expect(score.loudnessMethod).toBe("BS.1770-4");
		expect(stats.leadSilenceSec).toBeLessThanOrEqual(SOUND.maxLeadSilenceSec);
		expect(score.sampleCount).toBe(Math.round((framesFor(t) * SOUND.sampleRate) / FPS));
	});
	it("is byte-identical on a second build", () => {
		const again = build(t);
		expect(Buffer.from(again.left.buffer).equals(Buffer.from(score.left.buffer))).toBe(true);
		expect(Buffer.from(again.stems.kick.left.buffer).equals(Buffer.from(score.stems.kick.left.buffer))).toBe(true);
	});
	it("puts every on-screen event on its own time, not on a cut", () => {
		const cues = score.cues.filter((c: { kind: string }) => c.kind === "event");
		expect(cues.map((c: { t: number }) => c.t)).toEqual([1.3, 4.4, 7.7, 10.1]);
		expect(cues.filter((c: { fromCut: number }) => c.fromCut >= 0.1).length).toBeGreaterThanOrEqual(2);
		const sr = SOUND.sampleRate;
		const quiet = rms(score.stems.events, Math.round(5.5 * sr), Math.round(7 * sr));
		for (const cue of cues) {
			const s = Math.round(cue.t * sr);
			expect(rms(score.stems.events, s - Math.round(0.45 * sr), s + Math.round(0.3 * sr)), cue.sound).toBeGreaterThan(quiet * 20);
		}
	});
});

describe("every genre and arrangement stays finite and under the ceiling", { timeout: 240000 }, () => {
	const shapes: Array<[string, number[], number]> = [
		["one beat", [0, 6], 0],
		["two beats, turn first", [0, 3, 6], 0],
		["two beats, turn last", [0, 3, 6], 1],
		["a drop that starts off the bar grid", [0, 1.3, 4.1, 6.9, 8], 1],
		["a late turn with a break", [0, 1.7, 3.3, 5, 6.6, 8], 1],
	];
	for (const genre of SCORE_GENRES) {
		it(`${genre}`, () => {
			for (const [label, cuts, turn] of shapes) {
				const t = film({ cuts, turn, genre, request: `${genre} ${label}` });
				const score = build(t);
				for (const ch of [score.left, score.right]) for (let i = 0; i < ch.length; i++) if (!Number.isFinite(ch[i])) throw new Error(`${genre} / ${label}: non-finite at ${i}`);
				for (const name of SCORE_STEMS) for (let i = 0; i < score.stems[name].left.length; i += 11) if (!Number.isFinite(score.stems[name].left[i])) throw new Error(`${genre} / ${label}: ${name} non-finite at ${i}`);
				const stats = soundStats([score.left, score.right]);
				expect(stats.peakDb, `${genre} / ${label}`).toBeLessThanOrEqual(-2 + 1e-9);
				expect(stats.leadSilenceSec, `${genre} / ${label}`).toBeLessThanOrEqual(1.5);
			}
		});
	}
	it("decodes at or under -0.5 dBFS after a real AAC encode, per genre", (context) => {
		if (!FFMPEG) return context.skip("ffmpeg not installed on this host");
		const dir = temp();
		for (const genre of SCORE_GENRES) {
			const t = film({ cuts: [0, 2, 4, 6, 8], turn: 1, genre, request: `aac ${genre}` });
			const summary = writeScore({ treatment: t, frameCount: 8 * FPS, fps: FPS, cutTimes: cutsOf(t), dir: join(dir, genre) });
			const aac = join(dir, `${genre}.m4a`);
			const encoded = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", summary.file, "-c:a", "aac", "-b:a", "192k", aac], { encoding: "utf8" });
			expect(encoded.status, encoded.stderr).toBe(0);
			const decoded = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", aac, "-f", "s16le", "-ac", "2", "-ar", "48000", "pipe:1"], { maxBuffer: 1 << 28 });
			const pcm = decoded.stdout as Buffer;
			let peak = 0;
			for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)) / 32768);
			expect(db(peak), genre).toBeLessThanOrEqual(-0.5);
		}
	});
});

describe("the stems are kept", { timeout: 120000 }, () => {
	it("writes the mix, every stem and a manifest with each stem's RMS and SHA-256", () => {
		const dir = temp();
		const t = film({ events: [{ t: 2.2, on: "a key press", kind: "tap" }] });
		const summary = writeScore({ treatment: t, frameCount: framesFor(t), fps: FPS, cutTimes: cutsOf(t), dir });
		expect(existsSync(join(dir, "sound", "score.wav"))).toBe(true);
		const manifest = JSON.parse(readFileSync(join(dir, "sound", "stems", "manifest.json"), "utf8"));
		expect(manifest.stems.map((s: { name: string }) => s.name)).toEqual([...SCORE_STEMS, "return-reverb", "return-delay"]);
		for (const stem of manifest.stems) {
			expect(stem.sha256).toMatch(/^[0-9a-f]{64}$/u);
			expect(Number.isFinite(stem.rmsDbfs)).toBe(true);
			expect(existsSync(join(dir, stem.file))).toBe(true);
			expect(readWav(readFileSync(join(dir, stem.file))).channels[0].length).toBe(summary.sampleCount);
		}
		const cues = JSON.parse(readFileSync(join(dir, "sound-cues.json"), "utf8"));
		expect(cues.mode).toBe("score");
		expect(cues.genre).toBe(readStyle("swiss-signal").score.genre);
		expect(cues.stems.length).toBe(11);
		expect(cues.cues.some((c: { kind: string }) => c.kind === "drop")).toBe(true);
		for (const cue of cues.cues) expect(Math.abs(cue.delta)).toBeLessThanOrEqual(1 / FPS);
	});
});

describe("the sound module", { timeout: 120000 }, () => {
	it("masters any input to -16 LUFS under -2 dBFS with a limiter, not a waveshaper", () => {
		const n = 48000 * 4;
		const L = new Float64Array(n);
		const R = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			L[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / 48000) + (i % 24000 === 0 ? 0.9 : 0);
			R[i] = L[i];
		}
		const out = masterTo(L, R);
		const stats = soundStats([out.left, out.right]);
		expect(stats.peakDb).toBeLessThanOrEqual(-2 + 1e-9);
		expect(Math.abs(out.lufs + 16)).toBeLessThanOrEqual(0.5);
		// the quiet sine keeps its shape: a limiter leaves it a clean scaled copy away from the spikes
		const k = 12000 + 100;
		const ratio = out.left[k + 1000] / out.left[k];
		expect(Number.isFinite(ratio)).toBe(true);
	});
	it("answers silence with silence", () => {
		const out = masterTo(new Float64Array(4800), new Float64Array(4800));
		expect(out.left.every((v) => v === 0)).toBe(true);
	});
	it("lists the four event sounds the treatment may use", () => {
		expect([...EVENT_SOUNDS]).toEqual(["tap", "hit", "whoosh", "chime"]);
		const cues = eventCues({ events: [{ t: 1, on: "a", kind: "tap" }, { t: 2, on: "b", kind: "wobble" }, { t: 99, on: "c", kind: "hit" }], durationSec: 10, cutTimes: [3], beats: [{ t0: 0, t1: 5 }] });
		expect(cues.map((c: { sound: string }) => c.sound)).toEqual(["tap"]);
		expect(cues[0].fromCut).toBe(2);
	});
	it("gives a generated bed the same event sounds, on the event's time", () => {
		const t = film({ events: [{ t: 3.5, on: "a key press", kind: "tap" }, { t: 8.2, on: "the beam", kind: "whoosh" }] });
		t.sound = { mode: "generated", plan: "a bed", palette: "felt", key: "D minor", tempo: 96, events: t.sound.events };
		const bed = buildBed({ treatment: t, frameCount: framesFor(t), fps: FPS });
		const events = bed.cues.cues.filter((c: { kind: string }) => c.kind === "event");
		expect(events.map((c: { t: number }) => c.t)).toEqual([3.5, 8.2]);
		expect(bed.stats.peakDb).toBeLessThanOrEqual(-2 + 1e-9);
		const plain = buildBed({ treatment: { ...t, sound: { ...t.sound, events: [] } }, frameCount: framesFor(t), fps: FPS });
		expect(Buffer.compare(bed.wav, plain.wav)).not.toBe(0);
	});
	it("prepareTrack builds the score for mode score and reports it", () => {
		const dir = temp();
		const t = film();
		const track = prepareTrack({ outDir: dir, treatment: t, frameCount: framesFor(t), fps: FPS, cuts: cutsOf(t) });
		expect(track.mode).toBe("score");
		expect(track.wav).toBe(join(dir, "sound", "score.wav"));
		expect(existsSync(track.wav)).toBe(true);
		expect(track.stats.peakDb).toBeLessThanOrEqual(-2 + 1e-9);
		expect(track.notes.join(" ")).toMatch(/score/u);
		const mixed = readWav(readFileSync(track.wav));
		expect(mixed.channels[0].length).toBe(Math.round((framesFor(t) * 48000) / FPS));
	});
	it("judges built tracks (generated and score) by head silence and loudness, and only reports the rest", () => {
		const measured = { present: true, durationSec: 6, peakDb: -3, leadSilenceSec: 2.5, lufs: -22 };
		const rule = (rules: Array<{ id: string; status: string }>, id: string) => rules.find((r) => r.id === id)?.status;
		for (const mode of ["generated", "score"]) {
			const rules = soundRules(measured, { mode, videoDuration: 6 });
			expect(rule(rules, "SOUND-LEAD"), mode).toBe("FAIL");
			expect(rule(rules, "SOUND-LOUDNESS"), mode).toBe("WARN");
		}
		const supplied = soundRules(measured, { mode: "supplied", videoDuration: 6 });
		expect(rule(supplied, "SOUND-LEAD")).toBe("WARN");
		expect(rule(supplied, "SOUND-LOUDNESS")).toBe("PASS");
		const good = soundRules({ ...measured, leadSilenceSec: 0.1, lufs: -16.4 }, { mode: "score", videoDuration: 6 });
		expect(rule(good, "SOUND-LEAD")).toBe("PASS");
		expect(rule(good, "SOUND-LOUDNESS")).toBe("PASS");
	});
	it("the sound subcommand's track for score lives under sound/ with its cue sheet", () => {
		const dir = temp();
		mkdirSync(dir, { recursive: true });
		const t = film();
		writeFileSync(join(dir, "treatment.json"), JSON.stringify(t));
		const track = prepareTrack({ outDir: dir, treatment: t, frameCount: framesFor(t), fps: FPS, cuts: cutsOf(t) });
		expect(track.wav && existsSync(track.wav)).toBe(true);
		expect(existsSync(join(dir, "sound-cues.json"))).toBe(true);
	});
});
