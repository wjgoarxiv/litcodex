// Every number the LitCodex motion engine and its gate use, in one place.
// Rows marked PROVISIONAL are the spec's [NEW] defaults (Section C open question 1, D2). They are
// implemented exactly as written and stay fixed for this release; no user sign-off is recorded yet.

export const PROVISIONAL = Object.freeze([
	"MO-C-05",
	"MO-C-06",
	"MO-C-07",
	"MO-C-08",
	"MO-C-13",
	"MO-C-14",
	"MO-C-25",
	"MO-C-29",
	"MO-D-02",
	"MO-D-03",
	"MO-D-04",
]);

export const ENGINE_COMMIT = "ca251e3dddda422b364385eb484b5a3593a0990d";
export const ENGINE_CREDIT = `mexicat/pdoom-video ${ENGINE_COMMIT} (MIT)`;
export const CREDIT_LINE =
	"Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.";

// Logical canvas; `--scale N` multiplies physical pixels only (MO-A-01, scale.ts).
export const FRAME = Object.freeze({ width: 1920, height: 1080, fps: 60, maxScale: 4 });

// MO-A-26/27/28 and MO-SH-09.
export const SAMPLING = Object.freeze({ masterSamples: 4, masterShutter: 0.5, stillSamples: 1 });

// Tier 1 generator (MO-A-09/10/14/15/16).
export const TIMING = Object.freeze({
	defaultBpm: 100,
	paceFactor: 1.25,
	snapToleranceFrames: 1,
	minSceneBeats: 2,
	minBpm: 40,
	maxBpm: 220,
	defaultSeed: 20260926,
});

// One reading-floor function (MO-C-07/08, MO-A-11/12, MO-FT-06). PROVISIONAL.
export const READING = Object.freeze({
	lineFloorLatin: 0.9,
	lineFloorHangul: 1.0,
	wordFloor: 0.5,
	revealFloor: 0.35,
	secondsPerHangulSyllable: 0.2,
	wordsPerSecond: 3.3,
	maxLatinCps: 17,
});

// MO-C-04 title-safe [PLAN]; MO-C-05 action-safe PROVISIONAL.
export const SAFE = Object.freeze({
	title: Object.freeze({ x: 96, y: 54 }),
	action: Object.freeze({ x: 48, y: 27 }),
});

// MO-C-06 floors [REUSE]; the video "large" translation is PROVISIONAL.
export const CONTRAST = Object.freeze({
	body: 4.5,
	large: 3.0,
	largeFontPx: 32,
	largeBoldFontPx: 25,
	boldWeight: 700,
	erodePx: 1,
	dilatePx: 2,
	bboxExpandCap: 0.25,
});

// MO-C-03 excursion flash audit (WCAG 2.3.1).
export const FLASH = Object.freeze({
	gridW: 320,
	gridH: 180,
	windowW: 107,
	windowH: 60,
	windowAreaFraction: 0.25,
	deltaL: 0.1,
	maxL: 0.8,
	cellSpanFrames: 3,
	redRatio: 0.8,
	redScale: 320,
	redDelta: 20,
	maxGeneral: 3,
	maxRed: 3,
});

// MO-SH-04a full-frame luminance step in one frame pair.
export const FULL_FRAME_STEP = Object.freeze({ deltaL: 0.1, areaFraction: 0.25 });

// MO-SH-03 per-shot event ceiling and MO-A-58 flash-rise threshold.
export const EVENTS = Object.freeze({ maxPerWindow: 2, windowSec: 1, flashRise: 0.1 });

// MO-SH-05..11 pass caps.
export const PASS_CAPS = Object.freeze({
	glitchHitRate: 2.0,
	glitchAreaPct: 20,
	surgeRate: 2,
	surgeMinAttackSec: 0.1,
	surgeMinDecaySec: 0.1,
	crtFlickerAmp: 0.06,
	terminalLayers: 2,
	caretBlinkHz: 2,
});

// MO-SH-09: one canonical software-rasterizer list, case-insensitive substrings.
export const SOFTWARE_GL = Object.freeze([
	"swiftshader",
	"llvmpipe",
	"softpipe",
	"lavapipe",
	"apple software renderer",
	"microsoft basic render driver",
]);
export const UNKNOWN_RENDERER = "unknown (debug-info extension unavailable)";

// MO-C-10..13 output floors and caps (MO-C-12 floor and MO-C-13 caps PROVISIONAL).
export const OUTPUT = Object.freeze({
	minWidth: 1920,
	minHeight: 1080,
	minFps: 30,
	minDurationSec: 3,
	warnDurationSec: 90,
	previewMaxBytes: 3_000_000,
	posterMaxBytes: 1_000_000,
	mp4WarnBytesPer10s: 100_000_000,
	pixFmt: "yuv420p",
	colorSpace: "bt709",
	colorRange: "tv",
});

// MO-A-38 preview ladders.
export const PREVIEW = Object.freeze({
	widths: Object.freeze([960, 720, 540]),
	fps: Object.freeze([30, 24, 20]),
	minWidth: 540,
	minGlyphPx: 10,
	webpQuality: 72,
});

// MO-C-14 PROVISIONAL.
export const REDUCED_MOTION = Object.freeze({ minInkRatio: 0.9 });

// MO-C-25..29 craft-floor transfers.
export const TRACKING = Object.freeze({ displayMinEm: -0.04, machineMinEm: 0 }); // PROVISIONAL
export const LINE_HEIGHT = Object.freeze({ latin: 1.5, cjk: 1.6, manyLines: 1.4, manyLinesFrom: 3 });
export const MEASURE = Object.freeze({ latinMin: 60, latinMax: 75, cjkMin: 30, cjkMax: 45 });
export const ACCENT = Object.freeze({
	hueToleranceDeg: 15,
	saturationFloor: 0.5,
	minFillPx: 24,
	maxAccentEntries: 1,
	maxAccentFrameFraction: 0.1,
	maxSaturatedClusters: 2,
}); // PROVISIONAL

// MO-D-02..04 PROVISIONAL.
export const PERF = Object.freeze({ p95HardwareMs: 40, p95SoftwareMs: 250, minFrames: 120 });
export const NEAR_BLACK = Object.freeze({ luminance: 0.05, percentile: 0.995, runFactor: 2, edgeAllowanceSec: 1 });

// MO-A-58 post override vocabulary: [min, max, neutral]; null max means no fixed ceiling.
export const POST_FIELDS = Object.freeze({
	exposure: Object.freeze({ min: 0, exclusiveMin: true, max: null, neutral: 1 }),
	bloom: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	bloomThreshold: Object.freeze({ min: 0, max: 1, neutral: 0.85 }),
	bloomKnee: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	bloomRadius: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	halation: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	ca: Object.freeze({ min: 0, max: null, neutral: 0 }),
	grain: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	vignette: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	fade: Object.freeze({ min: 0, max: 1, neutral: 1 }),
	flash: Object.freeze({ min: 0, max: 1, neutral: 0 }),
	zoom: Object.freeze({ min: 0, exclusiveMin: true, max: null, neutral: 1 }),
});
export const POST_NEUTRAL = Object.freeze({
	exposure: 1,
	bloom: 0,
	bloomThreshold: 0.85,
	bloomKnee: 0,
	bloomRadius: 0,
	halation: 0,
	ca: 0,
	grain: 0,
	vignette: 0,
	fade: 1,
	flash: 0,
	shake: Object.freeze([0, 0]),
	zoom: 1,
	invert: false,
});

// MO-A-51 launch ladder. A rung counts only when getContext('webgl2') succeeds in the page.
export const CHROME_COMMON_FLAGS = Object.freeze([
	"--disable-background-timer-throttling",
	"--disable-renderer-backgrounding",
	"--disable-backgrounding-occluded-windows",
]);
export const CHROME_GPU_FLAGS = Object.freeze({
	darwin: Object.freeze(["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]),
	linux: Object.freeze(["--use-angle=gl", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"]),
	win32: Object.freeze(["--use-angle=d3d11", "--enable-gpu-rasterization"]),
});
export const CHROME_SOFTWARE_FLAGS = Object.freeze(["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);
// Every launch uses a throwaway profile, often under an isolated HOME: never touch the OS keychain
// (on macOS a real-keychain lookup pops a dialog on the user's screen).
export const CHROME_KEYCHAIN_FLAGS = Object.freeze(["--use-mock-keychain", "--password-store=basic"]);

// Stage path launch (director brief 6d): the software rung only, plus flags that make compositing
// synchronous and deterministic and keep the browser off the network. The host-resolver backstop
// maps every host to NOTFOUND except the synthetic stage origin.
export const STAGE_ORIGIN = "http://lit.stage";
export const CHROME_STAGE_FLAGS = Object.freeze([
	"--run-all-compositor-stages-before-draw",
	"--disable-checker-imaging",
	"--disable-new-content-rendering-timeout",
	"--disable-threaded-animation",
	"--disable-threaded-scrolling",
	"--disable-image-animation-resync",
	"--disable-lcd-text",
	"--force-color-profile=srgb",
	"--hide-scrollbars",
	"--mute-audio",
	"--force-device-scale-factor=1",
	"--disable-background-networking",
	"--disable-component-update",
	"--disable-sync",
	"--no-pings",
	"--metrics-recording-only",
	"--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE lit.stage",
]);

// MO-A-45 named exit codes.
export const EXIT = Object.freeze({
	OK: 0,
	BLOCKED_NO_CHROME: 10,
	BLOCKED_NO_WEBGL2: 11,
	BLOCKED_NO_FFMPEG_FOR_VIDEO: 12,
	GATE_FAIL_QA: 13,
	BLOCKED_DEPS_NOT_PREWARMED: 14,
	BLOCKED_FONT_FETCH: 15,
	BLOCKED_TREATMENT_INVALID: 16,
	STAGE_CONTRACT_ERROR: 17,
	STAGE_NONDETERMINISTIC: 18,
	STAGE_NETWORK_REQUEST: 19,
	SOUND_INVALID: 20,
	USAGE: 2,
});

/** A named CLI exit: the render modules throw it and the CLI prints the message and returns the code. */
export class Exit extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

export const INSTALL_COMMAND = "litcodex motion-runtime install";

// Stage path frame formats (MO-C-10 as amended): exactly one of these, matching the treatment.
export const STAGE_FORMATS = Object.freeze({ "16:9": Object.freeze({ width: 1920, height: 1080 }), "9:16": Object.freeze({ width: 1080, height: 1920 }) });

// Generated sound bed: the documented timbre palettes a treatment's sound.palette selects.
export const SOUND_PALETTES = Object.freeze(["air", "felt", "glass", "pulse"]);
export const MAX_ROUNDS = 3;
