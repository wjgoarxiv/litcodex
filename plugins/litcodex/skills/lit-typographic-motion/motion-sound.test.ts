import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { SOUND_PALETTES } from "./engine/constants.mjs";
import { buildBed, integratedLoudness, readWav, SOUND, writeWav } from "./engine/sound.mjs";
import { stageTreatment, typeTreatment } from "./fixtures/treatments.mjs";

// Sound on both paths (director brief section 7). The bed is pure code; renders need Chrome and a
// pre-warmed fixture cache and skip with the reason printed otherwise.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const FFMPEG = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-sound-")));
	temps.push(dir);
	return dir;
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const env = () => ({ ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") });
const run = (args: string[]) => spawnSync(process.execPath, [RENDER, ...args], { encoding: "utf8", env: env(), timeout: 600000 });
const ready = (context: { skip: (reason: string) => void }) => {
	if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), false;
	if (!CHROME) return context.skip("Chrome not installed on this host"), false;
	if (!FFMPEG) return context.skip("ffmpeg not installed on this host"), false;
	return true;
};
/** ffprobe durations of the video and audio streams (audio null when there is none). */
function streams(file: string) {
	const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", file], { encoding: "utf8" });
	const list = JSON.parse(out.stdout).streams as Array<{ codec_type: string; duration: string }>;
	const of = (kind: string) => list.find((s) => s.codec_type === kind);
	return { video: Number(of("video")?.duration ?? Number.NaN), audio: of("audio") ? Number(of("audio")?.duration) : null };
}
const tone = (seconds: number, { lead = 0, amp = 0.2 } = {}) => {
	const n = Math.round(seconds * 48000);
	const ch = [new Float32Array(n), new Float32Array(n)];
	for (let i = Math.round(lead * 48000); i < n; i++) ch[0][i] = ch[1][i] = amp * Math.sin((2 * Math.PI * 220 * i) / 48000);
	return writeWav(ch, 48000);
};
const stagePage = readFileSync(join(skillRoot, "fixtures", "stage", "clock", "index.html"), "utf8");

describe("the generated bed", () => {
	const treatment = stageTreatment({ durationSec: 12, fps: 60, beats: [[0, 3], [3, 6], [6, 9], [9, 12]] });
	treatment.beats[0].sound = "the pad opens";
	treatment.beats[1].sound = "a hit on the cut";
	treatment.beats[2].sound = "a rise into the next change";
	treatment.beats[3].sound = "a closing cadence";
	const frames = 720;
	it("is deterministic, exact in length, 48 kHz 16-bit stereo, peak at or under -2 dBFS and -16 LUFS +/- 2", () => {
		const a = buildBed({ treatment, frameCount: frames, fps: 60 });
		const b = buildBed({ treatment, frameCount: frames, fps: 60 });
		expect(sha(a.wav)).toBe(sha(b.wav));
		const decoded = readWav(a.wav);
		expect(decoded.sampleRate).toBe(48000);
		expect(decoded.bits).toBe(16);
		expect(decoded.channels.length).toBe(2);
		expect(decoded.channels[0].length).toBe(Math.round((frames * 48000) / 60));
		expect(a.stats.peakDb).toBeLessThanOrEqual(-2 + 1e-9);
		expect(Math.abs(a.stats.lufs + 16)).toBeLessThanOrEqual(2);
		expect(a.stats.leadSilenceSec).toBeLessThanOrEqual(1.5);
	});
	it("puts accents only where a beat's sound asks, each on its cut", () => {
		const { cues } = buildBed({ treatment, frameCount: frames, fps: 60 });
		const kinds = cues.cues.filter((c: { kind: string }) => c.kind !== "chord").map((c: { kind: string; beat: number }) => `${c.kind}@${c.beat}`);
		expect(kinds).toEqual(["hit@1", "rise@2", "cadence@3"]);
		for (const cue of cues.cues) expect(Math.abs(cue.delta)).toBeLessThanOrEqual(1 / 60);
		const quiet = stageTreatment({ durationSec: 12, fps: 60, beats: [[0, 4], [4, 8], [8, 12]] });
		for (const beat of quiet.beats) beat.sound = "the pad holds";
		expect(buildBed({ treatment: quiet, frameCount: frames, fps: 60 }).cues.cues.every((c: { kind: string }) => c.kind === "chord")).toBe(true);
	});
	it("differs between palettes, keys and tempos", () => {
		const hashes = new Set<string>();
		for (const palette of SOUND_PALETTES) hashes.add(sha(buildBed({ treatment: { ...treatment, sound: { ...treatment.sound, palette } }, frameCount: 240, fps: 60 }).wav));
		hashes.add(sha(buildBed({ treatment: { ...treatment, sound: { ...treatment.sound, key: "A major" } }, frameCount: 240, fps: 60 }).wav));
		hashes.add(sha(buildBed({ treatment: { ...treatment, sound: { ...treatment.sound, tempo: 128 } }, frameCount: 240, fps: 60 }).wav));
		expect(SOUND_PALETTES.length).toBeGreaterThanOrEqual(3);
		expect(hashes.size).toBe(SOUND_PALETTES.length + 2);
	});
});

describe("ITU-R BS.1770-4 integrated loudness", () => {
	it("reads a stereo 997 Hz sine at -20 dBFS peak as -20 LUFS", () => {
		const n = 48000 * 5;
		const ch = [new Float64Array(n), new Float64Array(n)];
		for (let i = 0; i < n; i++) ch[0][i] = ch[1][i] = 0.1 * Math.sin((2 * Math.PI * 997 * i) / 48000);
		expect(Math.abs(integratedLoudness(ch) + 20)).toBeLessThanOrEqual(0.2);
	});
	it("gates silence and agrees with ffmpeg ebur128 within 0.5 LU on a generated bed", (context) => {
		expect(integratedLoudness([new Float64Array(48000), new Float64Array(48000)])).toBe(Number.NEGATIVE_INFINITY);
		if (!FFMPEG) return context.skip("ffmpeg not installed on this host");
		const dir = temp();
		const bed = buildBed({ treatment: stageTreatment({ durationSec: 10, fps: 60, beats: [[0, 5], [5, 10]] }), frameCount: 600, fps: 60 });
		writeFileSync(join(dir, "bed.wav"), bed.wav);
		const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", join(dir, "bed.wav"), "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
		const reference = Number(/I:\s+(-?[\d.]+) LUFS/u.exec(result.stderr.split("Summary:").pop() ?? "")?.[1]);
		expect(Math.abs(bed.stats.lufs - reference)).toBeLessThanOrEqual(0.5);
	});
	it("uses the brief's K-weighting coefficients", () => {
		expect(SOUND.shelf.b).toEqual([1.53512485958697, -2.69169618940638, 1.19839281085285]);
		expect(SOUND.shelf.a).toEqual([1, -1.69065929318241, 0.73248077421585]);
		expect(SOUND.highpass.b).toEqual([1, -2, 1]);
		expect(SOUND.highpass.a).toEqual([1, -1.99004745483398, 0.99007225036621]);
	});
});

describe("the sound subcommand", () => {
	it("writes the bed and its cue sheet from the treatment", () => {
		const out = join(temp(), "out");
		mkdirSync(out, { recursive: true });
		writeFileSync(join(out, "treatment.json"), JSON.stringify(stageTreatment()));
		const result = run(["sound", "--out", out]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toMatch(/LUFS/u);
		expect(existsSync(join(out, "sound", "bed.wav"))).toBe(true);
		expect(JSON.parse(readFileSync(join(out, "sound-cues.json"), "utf8")).cues.length).toBeGreaterThan(0);
	});
});

describe("tracks are muxed on both paths, padded to the picture", { timeout: 900000 }, () => {
	it("type path: a supplied WAV is muxed with the librosa tier absent", (context) => {
		if (!ready(context)) return;
		const dir = temp();
		const out = join(dir, "out");
		mkdirSync(out, { recursive: true });
		writeFileSync(join(dir, "song.wav"), tone(3));
		writeFileSync(join(out, "treatment.json"), JSON.stringify(typeTreatment(["Harbor lights", "Good night"], { sound: { mode: "supplied", plan: "the user's song under the words", file: join(dir, "song.wav") } })));
		const result = run(["film", "--out", out, "--audio", join(dir, "song.wav")]);
		expect([0, 13], result.stderr).toContain(result.status);
		const s = streams(join(out, existsSync(join(out, "film.mp4")) ? "film.mp4" : "withheld/film.mp4"));
		expect(s.audio).not.toBeNull();
		expect(Math.abs((s.audio ?? 0) - s.video)).toBeLessThanOrEqual(0.1);
	});
	it("stage path: an authored track shorter than the film is padded, never truncating the video", (context) => {
		if (!ready(context)) return;
		const out = join(temp(), "out");
		mkdirSync(join(out, "stage"), { recursive: true });
		writeFileSync(join(out, "stage", "index.html"), stagePage);
		writeFileSync(join(out, "stage", "bed.wav"), tone(1));
		writeFileSync(join(out, "treatment.json"), JSON.stringify(stageTreatment({ extra: { sound: { mode: "authored", plan: "a short sting then room tone", file: "stage/bed.wav" } } })));
		const result = run(["stage", "--out", out]);
		expect(result.status, result.stderr).toBe(0);
		const s = streams(join(out, "film.mp4"));
		expect(Math.abs(s.video - 4)).toBeLessThanOrEqual(0.05);
		expect(Math.abs((s.audio ?? 0) - 4)).toBeLessThanOrEqual(0.1);
		expect(readFileSync(join(out, "gate-report.txt"), "utf8")).toMatch(/SOUND-LEAD .*WARN/u);
	});
	it("stage path: the generated bed is the default; a missing or silent-start stream on a generated plan exits 20", (context) => {
		if (!ready(context)) return;
		const out = join(temp(), "out");
		mkdirSync(join(out, "stage"), { recursive: true });
		writeFileSync(join(out, "stage", "index.html"), stagePage);
		writeFileSync(join(out, "treatment.json"), JSON.stringify(stageTreatment()));
		const result = run(["stage", "--out", out]);
		expect(result.status, result.stderr).toBe(0);
		expect(streams(join(out, "film.mp4")).audio).not.toBeNull();
		expect(JSON.parse(readFileSync(join(out, "sound-cues.json"), "utf8")).palette).toBe("air");
		expect(readFileSync(join(out, "gate-report.txt"), "utf8")).toMatch(/SOUND-STREAM .*PASS/u);
		const film = join(out, "film.mp4");
		spawnSync("ffmpeg", ["-y", "-v", "error", "-i", film, "-an", "-c:v", "copy", join(out, "silent.mp4")]);
		renameSync(join(out, "silent.mp4"), film);
		const missing = run(["gate", "--out", out]);
		expect(missing.status, missing.stderr).toBe(EXIT.SOUND_INVALID);
		expect(missing.stderr).toContain("SOUND_INVALID");
		writeFileSync(join(out, "late.wav"), tone(4, { lead: 2 }));
		spawnSync("ffmpeg", ["-y", "-v", "error", "-i", film, "-i", join(out, "late.wav"), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", join(out, "late.mp4")]);
		renameSync(join(out, "late.mp4"), film);
		expect(run(["gate", "--out", out]).status).toBe(EXIT.SOUND_INVALID);
		cpSync(join(out, "treatment.json"), join(out, "treatment.generated.json"));
		const authored = { ...stageTreatment(), sound: { mode: "authored", plan: "a late entrance", file: "stage/late.wav" } };
		writeFileSync(join(out, ".run", "treatment.json"), JSON.stringify({ file: join(out, "treatment.json"), treatment: authored }));
		expect(run(["gate", "--out", out]).status).toBe(0);
	});
});
