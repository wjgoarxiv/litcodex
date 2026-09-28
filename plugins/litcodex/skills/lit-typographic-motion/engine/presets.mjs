// The three style presets (MO-B-01..03) as data, and the brief-keyword auto-pick (MO-B-00).
// Palette hexes, voices, motion tokens and pass order follow the spec's style bibles; the prose
// behind each lives in references/style-bibles.md.

const GRID = Object.freeze({ columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, moduleSnap: true, showGuides: false, hairlineWidthPx: 1 });

export const PRESETS = Object.freeze({
	"swiss-signal": Object.freeze({
		id: "swiss-signal",
		palette: Object.freeze({ ink: "#0C0E13", bone: "#E9EBE4", signal: "#0F7A82", accent: "#D9A441", graphite: "#4B5058", quiet: "#A3A8AE", dim: "#6B7078" }),
		roles: Object.freeze({ background: "ink", type: "bone", secondary: "quiet", pending: "dim", signal: "signal", accent: "accent", rule: "graphite", index: "signal", figure: "signal" }),
		voices: Object.freeze({
			display: Object.freeze({ latin: "archivo-w125-900", hangul: "pretendard-700" }),
			body: Object.freeze({ latin: "archivo-w100-400", hangul: "pretendard-400" }),
			machine: Object.freeze({ latin: "meslo", hangul: "pretendard-400" }),
		}),
		widthSteps: Object.freeze(["archivo-w125-900", "archivo-w100-900", "archivo-w75-900"]),
		motion: Object.freeze({ slamSec: 0.18, holdMinSec: 0.6, holdMaxSec: 0.9, cutSec: 0, entranceScale: 1.04 }),
		passes: Object.freeze([
			Object.freeze({ pass: "swiss-grid", params: GRID }),
			Object.freeze({ pass: "dither", params: Object.freeze({ mode: 1, paletteSize: 0, pixelScale: 1, strength: 0.3 }) }),
		]),
		post: Object.freeze({ exposure: 1, bloom: 0.1, bloomThreshold: 0.85, bloomKnee: 0.3, bloomRadius: 0.5, halation: 0.08, ca: 0.8, grain: 0.045, vignette: 0.22, fade: 1, flash: 0, shake: Object.freeze([0, 0]), zoom: 1, invert: false }),
	}),
	terminalcore: Object.freeze({
		id: "terminalcore",
		palette: Object.freeze({ navy: "#05070A", panel: "#0C1116", green: "#39FF6A", blue: "#2FB6FF", grey: "#7C8B93" }),
		roles: Object.freeze({ background: "navy", type: "green", secondary: "green", pending: "grey", signal: "green", accent: null, rule: "grey", panel: "panel", index: "grey", figure: "green" }),
		voices: Object.freeze({
			display: Object.freeze({ latin: "vt323", hangul: "galmuri9" }),
			body: Object.freeze({ latin: "vt323", hangul: "pretendard-400" }),
			machine: Object.freeze({ latin: "meslo", hangul: "galmuri9" }),
		}),
		widthSteps: Object.freeze([]),
		motion: Object.freeze({ typeInCharsPerSec: 22, bootFlickerSec: 0.25, cutSec: 0 }),
		passes: Object.freeze([
			Object.freeze({ pass: "terminal-ui", params: Object.freeze({ charGridPx: Object.freeze([14, 24]), windowChromeWidthPx: 1.5, meterCount: 2, logLineRateCharsPerSec: 22, caretBlinkHz: 1.2, wordTimingSource: "reading-time", layers: 1 }) }),
			Object.freeze({ pass: "crt", params: Object.freeze({ scanlineFreqPerFrame: 540, scanlineDepth: 0.25, phosphorPersistence: 0.15, bloomAmount: 0.2, curvature: 0.08, vignette: 0.35, triadMaskAmount: 0.15, flickerAmp: 0.03, flickerFreqHz: 8 }) }),
			Object.freeze({ pass: "dither", params: Object.freeze({ mode: 1, paletteSize: 0, pixelScale: 2, strength: 0.35 }) }),
			Object.freeze({ pass: "glitch", params: Object.freeze({ intensity: 0.35, sliceCount: 6, maxOffsetPx: 24, blockCorruptSize: Object.freeze([32, 18]), rgbSplitPx: 3, holdFrames: 2, hitRatePerSec: 1.0, areaCapPct: 12 }) }),
		]),
		post: Object.freeze({ exposure: 1, bloom: 0.22, bloomThreshold: 0.8, bloomKnee: 0.3, bloomRadius: 0.4, halation: 0.04, ca: 1.0, grain: 0.04, vignette: 0.28, fade: 1, flash: 0, shake: Object.freeze([0, 0]), zoom: 1, invert: false }),
	}),
	tidal: Object.freeze({
		id: "tidal",
		palette: Object.freeze({ indigo: "#0E1420", offwhite: "#E8ECEF", teal: "#124559", violet: "#4C3B6E", coral: "#E07856", quiet: "#AEB6BF" }),
		roles: Object.freeze({ background: "indigo", type: "offwhite", secondary: "quiet", pending: "quiet", signal: "teal", accent: "coral", rule: "quiet", index: "quiet", figure: "offwhite" }),
		voices: Object.freeze({
			display: Object.freeze({ latin: "archivo-w100-700", hangul: "pretendard-700" }),
			body: Object.freeze({ latin: "archivo-w100-400", hangul: "pretendard-400" }),
			machine: Object.freeze({ latin: "meslo", hangul: "pretendard-400" }),
		}),
		widthSteps: Object.freeze([]),
		motion: Object.freeze({ driftMinSec: 2, driftMaxSec: 4, surgePunchSec: 0.3 }),
		passes: Object.freeze([
			Object.freeze({ pass: "tidal-gradient", params: Object.freeze({ flowSpeed: 0.06, warpAmount: 0.35, curlStrength: 0.4, octaves: 4, surgeOnHit: 0.5, surgeAttackSec: 0.15, surgeDecaySec: 0.25, surgeCapPerSec: 2, surgeRatePerSec: 0.5, bandingSteps: 0, ditherAmount: 0.02 }) }),
			Object.freeze({ pass: "swiss-grid", params: GRID }),
			Object.freeze({ pass: "glitch", params: Object.freeze({ intensity: 0.25, sliceCount: 4, maxOffsetPx: 16, blockCorruptSize: Object.freeze([24, 16]), rgbSplitPx: 2, holdFrames: 2, hitRatePerSec: 0.4, areaCapPct: 8 }) }),
		]),
		post: Object.freeze({ exposure: 1, bloom: 0.12, bloomThreshold: 0.85, bloomKnee: 0.3, bloomRadius: 0.5, halation: 0.06, ca: 0.6, grain: 0.035, vignette: 0.2, fade: 1, flash: 0, shake: Object.freeze([0, 0]), zoom: 1, invert: false }),
	}),
});

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

/** Colour of a named role in a preset (null when the preset has no such role). */
export function roleColor(preset, role) {
	const name = preset.roles[role];
	return name ? preset.palette[name] : null;
}

/** Every font key a preset can draw with (for pre-flight verification, MO-A-55). */
export function presetFontKeys(preset) {
	const keys = new Set(preset.widthSteps);
	for (const voice of Object.values(preset.voices)) for (const key of Object.values(voice)) keys.add(key);
	if (preset.id !== "terminalcore") keys.add("archivo-w100-400");
	return [...keys].sort();
}

// MO-B-00: first row that matches wins. Latin keywords at word boundaries; Korean keywords only at
// the start of a whitespace token, so they never match inside a longer compound they merely end.
const AUTO_PICK = Object.freeze([
	{ preset: "terminalcore", korean: ["터미널", "해커"], latin: ["terminal", "hacker", "crt"], reason: "terminal/CRT cue" },
	{ preset: "tidal", korean: ["물결", "파도", "잔잔한", "흐름"], latin: ["gradient", "wave", "tide", "calm"], reason: "flowing/calm cue" },
]);

export function matchesKeyword(text, row) {
	const value = String(text);
	for (const word of row.latin) if (new RegExp(`\\b${word}\\b`, "iu").test(value)) return word;
	for (const token of value.split(/[\s.,;:!?()[\]{}"'“”‘’·/]+/u)) {
		for (const word of row.korean) if (token.startsWith(word)) return word;
	}
	return null;
}

/** Explicit style wins; otherwise the first matching keyword row; otherwise swiss-signal. */
export function pickPreset(brief) {
	if (brief.preset !== undefined && brief.preset !== null && brief.preset !== "") {
		if (!PRESETS[brief.preset]) throw new Error(`unknown preset: ${brief.preset} (choose ${PRESET_IDS.join(", ")})`);
		return { id: brief.preset, reason: brief.presetSource === "user" ? "user-specified" : "agent default" };
	}
	const text = [brief.title, brief.mood, brief.description, ...(brief.lines ?? []).map((line) => (typeof line === "string" ? line : line?.text))]
		.filter(Boolean)
		.join(" ");
	for (const row of AUTO_PICK) {
		const hit = matchesKeyword(text, row);
		if (hit) return { id: row.preset, reason: `brief mentions "${hit}" (${row.reason})` };
	}
	return { id: "swiss-signal", reason: "no terminal or flow keyword in the brief; default editorial preset" };
}
