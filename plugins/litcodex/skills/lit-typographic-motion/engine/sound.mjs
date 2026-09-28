// Sound for both render paths. The generated bed is pure code: a tempo grid, a pulse on every beat
// and a pad that plays a chord progression changing on the film's cuts, in one of four documented
// timbre palettes, plus accents only where a treatment beat's `sound` asks for one. It is measured
// with ITU-R BS.1770-4 integrated loudness in product code and normalized to -16 LUFS with a peak
// at or under -2 dBFS. Supplied and authored tracks are fitted to the picture with ffmpeg (padded
// or trimmed, 50 ms fade) and always muxed. Nothing here touches the network or model weights.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { EXIT, Exit, SOUND_PALETTES } from "./constants.mjs";
import { ffmpegProbe, firstLine } from "./runtime.mjs";
import { fnv1a32, mulberry32 } from "./util.mjs";

export const SOUND = Object.freeze({
	sampleRate: 48000,
	targetLufs: -16,
	lufsTolerance: 2,
	bedPeakDb: -2,
	muxPeakDb: -0.5,
	silenceDb: -50,
	silenceWindowSec: 0.05,
	leadWindowSec: 3,
	maxLeadSilenceSec: 1.5,
	durationToleranceSec: 0.1,
	fadeSec: 0.05,
	shelf: Object.freeze({ b: Object.freeze([1.53512485958697, -2.69169618940638, 1.19839281085285]), a: Object.freeze([1, -1.69065929318241, 0.73248077421585]) }),
	highpass: Object.freeze({ b: Object.freeze([1, -2, 1]), a: Object.freeze([1, -1.99004745483398, 0.99007225036621]) }),
});

// ------------------------------------------------------------------------------ measurement

function biquad(input, { b, a }) {
	const out = new Float64Array(input.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < input.length; i++) {
		const x = input[i];
		const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
		out[i] = y;
	}
	return out;
}

/**
 * Integrated loudness (LUFS) per ITU-R BS.1770-4 at 48 kHz: K-weighting (shelf then high-pass),
 * 400 ms blocks with 75 % overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below.
 * Channels weigh 1.0 each (left and right). Returns -Infinity for silence.
 */
export function integratedLoudness(channels, sampleRate = SOUND.sampleRate) {
	const block = Math.round(0.4 * sampleRate);
	const hop = Math.round(0.1 * sampleRate);
	const weighted = channels.map((ch) => biquad(biquad(ch, SOUND.shelf), SOUND.highpass));
	const n = weighted[0].length;
	const blocks = [];
	for (let start = 0; start + block <= n; start += hop) {
		let sum = 0;
		for (const ch of weighted) {
			let z = 0;
			for (let i = start; i < start + block; i++) z += ch[i] * ch[i];
			sum += z / block;
		}
		blocks.push(sum);
	}
	const loudness = (z) => -0.691 + 10 * Math.log10(z);
	const absolute = blocks.filter((z) => loudness(z) > -70);
	if (!absolute.length) return Number.NEGATIVE_INFINITY;
	const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
	const relative = loudness(mean(absolute)) - 10;
	const gated = absolute.filter((z) => loudness(z) > relative);
	return gated.length ? loudness(mean(gated)) : Number.NEGATIVE_INFINITY;
}

const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : Number.NEGATIVE_INFINITY);

/** Sample peak (dBFS) and the longest run under -50 dBFS RMS (50 ms windows) in the first 3 s. */
export function soundStats(channels, sampleRate = SOUND.sampleRate) {
	let peak = 0;
	for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
	const window = Math.round(SOUND.silenceWindowSec * sampleRate);
	const lead = Math.min(channels[0].length, Math.round(SOUND.leadWindowSec * sampleRate));
	let longest = 0;
	let run = 0;
	for (let start = 0; start < lead; start += window) {
		let sum = 0;
		let count = 0;
		for (const ch of channels)
			for (let i = start; i < Math.min(start + window, ch.length); i++) {
				sum += ch[i] * ch[i];
				count++;
			}
		const quiet = toDb(Math.sqrt(sum / Math.max(1, count))) < SOUND.silenceDb;
		run = quiet ? run + window : 0;
		longest = Math.max(longest, run);
	}
	return { peakDb: toDb(peak), leadSilenceSec: longest / sampleRate, durationSec: channels[0].length / sampleRate };
}

// ------------------------------------------------------------------------------ WAV

/** 16-bit PCM WAV from float channels in [-1, 1]. */
export function writeWav(channels, sampleRate = SOUND.sampleRate) {
	const n = channels[0].length;
	const c = channels.length;
	const data = Buffer.alloc(n * c * 2);
	for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[k][i] * 32767))), (i * c + k) * 2);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(c, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * c * 2, 28);
	header.writeUInt16LE(c * 2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

/** Read a PCM (16/24/32-bit integer) or 32-bit float WAV into float channels. */
export function readWav(buffer) {
	let format = 0;
	let channels = 0;
	let sampleRate = 0;
	let bits = 0;
	let data = null;
	for (let o = 12; o + 8 <= buffer.length; ) {
		const id = buffer.toString("ascii", o, o + 4);
		const size = buffer.readUInt32LE(o + 4);
		if (id === "fmt ") {
			format = buffer.readUInt16LE(o + 8);
			channels = buffer.readUInt16LE(o + 10);
			sampleRate = buffer.readUInt32LE(o + 12);
			bits = buffer.readUInt16LE(o + 22);
			if (format === 0xfffe) format = buffer.readUInt16LE(o + 32);
		} else if (id === "data") data = buffer.subarray(o + 8, o + 8 + size);
		o += 8 + size + (size % 2);
	}
	if (!data || !channels) throw new Error("not a WAV file with fmt and data chunks");
	const bytes = bits / 8;
	const n = Math.floor(data.length / (bytes * channels));
	const out = Array.from({ length: channels }, () => new Float64Array(n));
	for (let i = 0; i < n; i++)
		for (let k = 0; k < channels; k++) {
			const o = (i * channels + k) * bytes;
			out[k][i] = format === 3 ? data.readFloatLE(o) : bits === 16 ? data.readInt16LE(o) / 32768 : bits === 24 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
		}
	return { sampleRate, bits, channels: out };
}

// ------------------------------------------------------------------------------ the generated bed

const NOTES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** MIDI note of the key's root in octave 3 ("D minor" -> D3 = 50). */
function keyRoot(key) {
	const [, letter, accidental, mode] = /^([A-G])(#|b)?\s+(major|minor)$/u.exec(key ?? "") ?? [null, "D", "", "minor"];
	return { root: 48 + NOTES[letter] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0), minor: mode !== "major" };
}
// Diatonic progressions, as semitone offsets from the root: minor i-VI-III-VII, major I-V-vi-IV.
const PROGRESSION = { minor: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], major: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]] };
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// The four timbre palettes. Each is a recipe of plain oscillators, so a bed never needs a sample.
export const PALETTES = Object.freeze({
	air: Object.freeze({ padHarmonics: [1, 0.25], padNoise: 0.35, padGain: 0.5, pulse: "breath", brightness: 0.35, description: "breathy noise-and-sine pad, brushed pulse" }),
	felt: Object.freeze({ padHarmonics: [1, 0.3, 0.1], padNoise: 0, padGain: 0.55, pulse: "thump", brightness: 0.25, description: "soft sine pad, muted low thump and pluck" }),
	glass: Object.freeze({ padHarmonics: [1, 0, 0.2, 0, 0.1], padNoise: 0, padGain: 0.42, pulse: "tick", brightness: 0.8, description: "bell-like FM tones, glassy ticks" }),
	pulse: Object.freeze({ padHarmonics: [1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.14], padNoise: 0, padGain: 0.38, pulse: "kick", brightness: 0.55, description: "saw pad under a kick and offbeat hats" }),
});

const ACCENTS = [
	["hit", /\bhit|impact|thump|punch|boom|slam|stab|타격|쿵|임팩트/iu],
	["rise", /\brise|riser|build|swell|lift|sweep|고조|상승|빌드/iu],
	["cadence", /\bcadence|resolve|resolution|close|closing|ending|final|land|마무리|종지|끝/iu],
	["chime", /\bchime|bell|sparkle|ping|shimmer|반짝|종소리|차임/iu],
	["drop", /\bdrop|hush|silence|pause|duck|breath out|쉼|정적|멈춤/iu],
];
/** Accent kinds a beat's `sound` field asks for. */
export const accentsFor = (text) => ACCENTS.filter(([, pattern]) => pattern.test(String(text ?? ""))).map(([kind]) => kind);

const envelope = (t, attack, decay) => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay));

/**
 * The bed for a film of `frameCount` frames at `fps`: exactly round(frameCount * 48000 / fps)
 * stereo samples. `cuts` are the times the picture cuts (default: every beat's t0 after the
 * first); chords change on them and accents land on them. Returns { wav, cues, stats }.
 */
export function buildBed({ treatment, frameCount, fps, cuts = null }) {
	const sr = SOUND.sampleRate;
	const n = Math.round((frameCount * sr) / fps);
	const duration = n / sr;
	const plan = treatment.sound ?? {};
	const palette = PALETTES[SOUND_PALETTES.includes(plan.palette) ? plan.palette : "felt"];
	const tempo = Number.isInteger(plan.tempo) ? plan.tempo : 96;
	const beatSec = 60 / tempo;
	const { root, minor } = keyRoot(plan.key);
	const progression = PROGRESSION[minor ? "minor" : "major"];
	const beats = treatment.beats ?? [{ t0: 0, t1: duration, sound: "" }];
	const cutTimes = cuts ?? beats.slice(1).map((b) => b.t0);
	const sections = [0, ...cutTimes].map((t0, i) => ({ t0, t1: i < cutTimes.length ? cutTimes[i] : duration, beat: Math.min(i, beats.length - 1) }));
	const last = sections.length - 1;
	const seed = fnv1a32(`${treatment.request ?? ""}\u0000${plan.palette}\u0000${plan.key}\u0000${tempo}`);
	const random = mulberry32(seed);
	const L = new Float64Array(n);
	const R = new Float64Array(n);
	const cues = [];

	// Pad: the section's chord, crossfaded over 0.25 s at each cut; the last section resolves home.
	const chordAt = (s) => (s === last && last > 0 ? progression[0] : progression[s % progression.length]);
	let noiseState = 0;
	for (let s = 0; s < sections.length; s++) {
		const { t0, t1 } = sections[s];
		const chord = chordAt(s);
		const drop = accentsFor(beats[sections[s].beat]?.sound).includes("drop");
		const a = Math.max(0, Math.round((t0 - 0.125) * sr));
		const b = Math.min(n, Math.round((t1 + 0.125) * sr));
		if (s > 0) cues.push({ kind: "chord", t: t0, beat: sections[s].beat, cutT: t0, delta: 0 });
		for (let i = a; i < b; i++) {
			const t = i / sr;
			const fadeIn = s === 0 ? Math.min(1, t / 0.12) : Math.min(1, Math.max(0, (t - (t0 - 0.125)) / 0.25));
			const fadeOut = s === last ? 1 : Math.min(1, Math.max(0, (t1 + 0.125 - t) / 0.25));
			const gain = palette.padGain * fadeIn * fadeOut * (drop ? 0.35 : 1);
			let left = 0;
			let right = 0;
			chord.forEach((offset, v) => {
				const f = hz(root + 12 + offset);
				const vib = 1 + 0.002 * Math.sin(2 * Math.PI * (0.3 + v * 0.07) * t);
				palette.padHarmonics.forEach((amp, h) => {
					if (!amp) return;
					const phase = 2 * Math.PI * f * (h + 1) * vib * t;
					left += amp * Math.sin(phase + v);
					right += amp * Math.sin(phase * 1.0015 + v * 1.7);
				});
			});
			if (palette.padNoise) {
				noiseState = 0.985 * noiseState + 0.015 * (random() * 2 - 1);
				left += palette.padNoise * 6 * noiseState;
				right += palette.padNoise * 6 * noiseState;
			}
			const bass = 0.6 * Math.sin(2 * Math.PI * hz(root + chord[0] - 12) * t);
			L[i] += gain * (left / (chord.length * 1.6) + bass * 0.5);
			R[i] += gain * (right / (chord.length * 1.6) + bass * 0.5);
		}
	}

	// Pulse: one event on every beat of the tempo grid, a softer offbeat for the busier palettes.
	for (let k = 0; k * beatSec < duration; k++) {
		const start = k * beatSec;
		const section = sections.findLast((s) => s.t0 <= start + 1e-9) ?? sections[0];
		const drop = accentsFor(beats[section.beat]?.sound).includes("drop");
		const level = (k % 4 === 0 ? 1 : 0.7) * (drop ? 0.3 : 1);
		const a = Math.round(start * sr);
		const len = Math.min(n - a, Math.round(0.45 * sr));
		for (let i = 0; i < len; i++) {
			const t = i / sr;
			let v = 0;
			if (palette.pulse === "kick") v = 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t / 0.03)) * t) * envelope(t, 0.002, 0.12);
			else if (palette.pulse === "thump") v = 0.6 * Math.sin(2 * Math.PI * 62 * t) * envelope(t, 0.004, 0.09) + 0.18 * Math.sin(2 * Math.PI * hz(root + 24) * t) * envelope(t, 0.003, 0.08);
			else if (palette.pulse === "tick") v = 0.22 * Math.sin(2 * Math.PI * 2093 * t + 2 * Math.sin(2 * Math.PI * 4186 * t) * envelope(t, 0, 0.02)) * envelope(t, 0.001, 0.05) + 0.3 * Math.sin(2 * Math.PI * 70 * t) * envelope(t, 0.003, 0.07);
			else v = 0.35 * (random() * 2 - 1) * envelope(t, 0.01, 0.06) + 0.35 * Math.sin(2 * Math.PI * 55 * t) * envelope(t, 0.01, 0.1);
			L[a + i] += level * v * palette.brightness * 1.6;
			R[a + i] += level * v * palette.brightness * 1.6;
		}
		if (palette.pulse === "kick" || palette.pulse === "tick") {
			const off = Math.round((start + beatSec / 2) * sr);
			for (let i = 0; i < Math.min(n - off, Math.round(0.05 * sr)); i++) {
				const v = 0.08 * (random() * 2 - 1) * envelope(i / sr, 0.001, 0.015) * (drop ? 0.3 : 1);
				L[off + i] += v * 0.8;
				R[off + i] += v;
			}
		}
	}

	// Accents, only where a beat's sound field asks. Each is placed on its cut (or its beat's end).
	sections.forEach((section, s) => {
		const kinds = accentsFor(beats[section.beat]?.sound);
		const add = (kind, t, cutT, render) => {
			cues.push({ kind, t, beat: section.beat, cutT, delta: Math.round((t - cutT) * 1e6) / 1e6 });
			const a = Math.max(0, Math.round(t * sr));
			render(a);
		};
		if (kinds.includes("hit"))
			add("hit", section.t0, section.t0, (a) => {
				for (let i = 0; i < Math.min(n - a, Math.round(0.6 * sr)); i++) {
					const t = i / sr;
					const v = 0.9 * Math.sin(2 * Math.PI * (40 + 60 * Math.exp(-t / 0.05)) * t) * envelope(t, 0.002, 0.2) + 0.25 * (random() * 2 - 1) * envelope(t, 0.001, 0.02);
					L[a + i] += v;
					R[a + i] += v;
				}
			});
		if (kinds.includes("rise")) {
			const end = section.t1;
			const start = Math.max(section.t0, end - 1.6);
			cues.push({ kind: "rise", t: end, beat: section.beat, cutT: end, delta: 0 });
			let state = 0;
			for (let i = Math.round(start * sr); i < Math.min(n, Math.round(end * sr)); i++) {
				const p = (i / sr - start) / Math.max(1e-6, end - start);
				state = (1 - (0.02 + 0.3 * p)) * state + (0.02 + 0.3 * p) * (random() * 2 - 1);
				const v = (0.25 * state * 3 + 0.12 * Math.sin(2 * Math.PI * (200 + 600 * p * p) * (i / sr))) * p * p;
				L[i] += v;
				R[i] += v * 0.9;
			}
		}
		if (kinds.includes("chime"))
			add("chime", (section.t0 + section.t1) / 2, (section.t0 + section.t1) / 2, (a) => {
				chordAt(s).forEach((offset, v) => {
					const at = a + Math.round(v * 0.09 * sr);
					for (let i = 0; i < Math.min(n - at, Math.round(1.2 * sr)); i++) {
						const t = i / sr;
						const f = hz(root + 24 + offset);
						const tone = 0.16 * Math.sin(2 * Math.PI * f * t + 1.5 * Math.sin(2 * Math.PI * f * 3.5 * t) * envelope(t, 0, 0.1)) * envelope(t, 0.002, 0.35);
						L[at + i] += tone * (v % 2 ? 0.6 : 1);
						R[at + i] += tone * (v % 2 ? 1 : 0.6);
					}
				});
			});
		if (kinds.includes("cadence"))
			add("cadence", section.t0, section.t0, (a) => {
				for (let i = 0; i < n - a; i++) {
					const t = i / sr;
					let v = 0;
					for (const offset of progression[0]) v += Math.sin(2 * Math.PI * hz(root + 24 + offset) * t) * 0.09;
					v += 0.3 * Math.sin(2 * Math.PI * hz(root) * t);
					const e = envelope(t, 0.01, 1.4);
					L[a + i] += v * e;
					R[a + i] += v * e;
				}
			});
	});

	// Ends: a short fade in at 0 and a 50 ms fade out at the last sample, so no click lands on a cut.
	const fade = Math.round(SOUND.fadeSec * sr);
	for (let i = 0; i < Math.min(fade, n); i++) {
		const g = i / fade;
		L[n - 1 - i] *= g;
		R[n - 1 - i] *= g;
	}

	const channels = normalize([L, R]);
	const quantized = readWav(writeWav(channels, sr)).channels;
	const stats = { ...soundStats(quantized, sr), lufs: Math.round(integratedLoudness(quantized, sr) * 100) / 100, samples: n, palette: plan.palette, key: plan.key, tempo };
	cues.sort((x, y) => x.t - y.t || x.beat - y.beat || x.kind.localeCompare(y.kind));
	return { wav: writeWav(channels, sr), cues: { palette: plan.palette, key: plan.key, tempo, beatSec, cues }, stats };
}

/** Gain to -16 LUFS, then a soft knee that keeps the sample peak at or under -2 dBFS. */
function normalize(channels) {
	const ceiling = 10 ** (SOUND.bedPeakDb / 20) * 0.995;
	const knee = ceiling * 0.6;
	let out = channels;
	for (let pass = 0; pass < 4; pass++) {
		const lufs = integratedLoudness(out);
		if (!Number.isFinite(lufs)) return out;
		const gain = 10 ** ((SOUND.targetLufs - lufs) / 20);
		out = out.map((ch) =>
			ch.map((x) => {
				const y = x * gain;
				const m = Math.abs(y);
				if (m <= knee) return y;
				return Math.sign(y) * (knee + (m - knee) / (1 + (m - knee) / (ceiling - knee)));
			}),
		);
		if (Math.abs(integratedLoudness(out) - SOUND.targetLufs) < 0.1) break;
	}
	return out;
}

// ------------------------------------------------------------------------------ tracks for a render

/** Where a supplied or authored track lives: absolute, or relative to the output dir. */
export const trackPath = (outDir, file) => (isAbsolute(file) ? file : resolve(outDir, file));

/**
 * The WAV to mux for a render, exactly the picture's length: the generated bed (default), or the
 * supplied/authored track padded or trimmed with a 50 ms fade. Writes <out>/sound/ and
 * <out>/sound-cues.json. Returns { wav, mode, notes } with wav null when the mode is none.
 */
export function prepareTrack({ outDir, treatment, frameCount, fps, cuts = null, supplied = null }) {
	const mode = supplied ? "supplied" : (treatment.sound?.mode ?? "generated");
	const dir = join(outDir, "sound");
	mkdirSync(dir, { recursive: true });
	const duration = frameCount / fps;
	if (mode === "none") return { wav: null, mode, notes: ["sound: none (the user asked for silence or the channel plays muted)"] };
	if (mode === "generated") {
		const bed = buildBed({ treatment, frameCount, fps, cuts });
		const wav = join(dir, "bed.wav");
		writeFileSync(wav, bed.wav);
		writeFileSync(join(outDir, "sound-cues.json"), `${JSON.stringify({ mode, ...bed.cues, stats: bed.stats }, null, 2)}\n`);
		return { wav, mode, stats: bed.stats, notes: [`sound: generated bed, palette ${bed.stats.palette}, ${bed.stats.key}, ${bed.stats.tempo} BPM, ${bed.stats.lufs} LUFS, peak ${bed.stats.peakDb.toFixed(2)} dBFS`] };
	}
	const source = supplied ?? trackPath(outDir, treatment.sound.file);
	if (!existsSync(source)) throw new Exit(EXIT.SOUND_INVALID, `SOUND_INVALID: the ${mode} track ${source} does not exist`);
	const ffmpeg = ffmpegProbe();
	if (!ffmpeg.ok) throw new Exit(EXIT.BLOCKED_NO_FFMPEG_FOR_VIDEO, "BLOCKED_NO_FFMPEG_FOR_VIDEO: ffmpeg is needed to fit the track to the picture");
	const fitted = join(dir, "track.wav");
	const fade = Math.max(0, duration - SOUND.fadeSec).toFixed(6);
	const result = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vn", "-ac", "2", "-ar", String(SOUND.sampleRate), "-af", `apad,atrim=0:${duration.toFixed(6)},afade=t=out:st=${fade}:d=${SOUND.fadeSec}`, "-c:a", "pcm_s16le", fitted], { encoding: "utf8" });
	if (result.status !== 0) throw new Exit(EXIT.SOUND_INVALID, `SOUND_INVALID: could not read the ${mode} track (${firstLine(result.stderr || "ffmpeg failed")})`);
	const decoded = readWav(readFileSync(fitted));
	const notes = [`sound: ${mode} track ${source}, fitted to ${duration.toFixed(2)} s (padded or trimmed, 50 ms fade)`];
	const stats = soundStats(decoded.channels);
	if (stats.peakDb > -1) {
		const gain = 10 ** ((-1 - stats.peakDb) / 20);
		writeFileSync(fitted, writeWav(decoded.channels.map((ch) => ch.map((x) => x * gain))));
		notes.push(`sound: peak lowered by ${(stats.peakDb + 1).toFixed(2)} dB to leave headroom`);
	}
	const final = readWav(readFileSync(fitted)).channels;
	const cutList = cuts ?? (treatment.beats ?? []).slice(1).map((b) => b.t0);
	writeFileSync(join(outDir, "sound-cues.json"), `${JSON.stringify({ mode, source, cues: cutList.map((t, i) => ({ kind: "cut", t, beat: i + 1, cutT: t, delta: 0 })), stats: { ...soundStats(final), lufs: Math.round(integratedLoudness(final) * 100) / 100 } }, null, 2)}\n`);
	return { wav: fitted, mode, notes };
}

// ------------------------------------------------------------------------------ the sound gate

/** Decode the muxed audio of a film (48 kHz stereo) and measure it; null when there is no stream. */
export function measureMuxed(mp4) {
	const ffmpeg = ffmpegProbe();
	if (!ffmpeg.ok || !existsSync(mp4)) return null;
	const probe = spawnSync(ffmpeg.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", mp4], { encoding: "utf8" });
	if (!probe.stdout.trim()) return { present: false };
	const decoded = spawnSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-i", mp4, "-map", "0:a:0", "-ac", "2", "-ar", String(SOUND.sampleRate), "-f", "s16le", "pipe:1"], { maxBuffer: 1 << 30 });
	if (decoded.status !== 0) return { present: true, error: firstLine(String(decoded.stderr ?? "decode failed")) };
	const pcm = decoded.stdout;
	const n = Math.floor(pcm.length / 4);
	const channels = [new Float64Array(n), new Float64Array(n)];
	for (let i = 0; i < n; i++) {
		channels[0][i] = pcm.readInt16LE(i * 4) / 32768;
		channels[1][i] = pcm.readInt16LE(i * 4 + 2) / 32768;
	}
	return { present: true, ...soundStats(channels), lufs: Math.round(integratedLoudness(channels) * 100) / 100 };
}

/**
 * Sound rules over the decoded muxed stream when the treatment plans sound: a stream is present,
 * its length matches the video within 0.1 s, its sample peak is at or under -0.5 dBFS, and (for a
 * generated bed only) the first 3 s never sit under -50 dBFS for more than 1.5 s. A failed sound
 * rule makes the render exit 20; the lead check is only a WARN for supplied or authored tracks.
 */
export function soundRules(measured, { mode, videoDuration }) {
	if (!mode || mode === "none") return [{ id: "SOUND-STREAM", name: "sound stream", status: "PASS", detail: "sound mode none (asked for silence or a muted channel)" }];
	const rules = [];
	if (!measured?.present) return [{ id: "SOUND-STREAM", name: "sound stream", status: "FAIL", detail: `the treatment plans ${mode} sound but the film has no audio stream`, sound: true }];
	if (measured.error) return [{ id: "SOUND-STREAM", name: "sound stream", status: "FAIL", detail: `the audio stream does not decode: ${measured.error}`, sound: true }];
	rules.push({ id: "SOUND-STREAM", name: "sound stream", status: "PASS", detail: `${mode} track muxed, ${measured.lufs} LUFS integrated` });
	const off = Math.abs(measured.durationSec - videoDuration);
	rules.push({ id: "SOUND-LENGTH", name: "sound length", status: off <= SOUND.durationToleranceSec + 1e-6 ? "PASS" : "FAIL", detail: `${measured.durationSec.toFixed(3)} s against the video's ${videoDuration.toFixed(3)} s (tolerance 0.1 s)`, sound: true });
	rules.push({ id: "SOUND-PEAK", name: "sound sample peak", status: measured.peakDb <= SOUND.muxPeakDb + 1e-9 ? "PASS" : "FAIL", detail: `${measured.peakDb.toFixed(2)} dBFS (limit -0.5)`, sound: true });
	const quiet = measured.leadSilenceSec > SOUND.maxLeadSilenceSec + 1e-9;
	rules.push({ id: "SOUND-LEAD", name: "no silent opening", status: quiet ? (mode === "generated" ? "FAIL" : "WARN") : "PASS", detail: `longest stretch under -50 dBFS in the first 3 s: ${measured.leadSilenceSec.toFixed(2)} s (limit 1.5 s)`, sound: mode === "generated" });
	return rules;
}

export const soundFailed = (rules) => rules.some((r) => r.sound && r.status === "FAIL");

