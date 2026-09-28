// Test-only builder: a small synthetic render (manifest, frame log, pass log, exports, probe, perf,
// determinism, one kept contrast frame) that passes every gate rule. Each gate fixture mutates one
// thing and expects exactly the owning rule to FAIL. Never packed (fixtures/ is excluded).
import { passSeed } from "../engine/util.mjs";

export const FPS = 60;

export function passingRun() {
	const shots = [
		{ id: "s1-title-slam", sceneId: "title-slam", shotIndex: 0, start: 0, end: 3, holdSec: 3, kind: "line", text: "Quiet Harbor", script: "latin", beatSec: 0 },
		{ id: "s2-word-line", sceneId: "word-line", shotIndex: 0, start: 3, end: 6, holdSec: 3, kind: "line", text: "작은 배가 돌아온다", script: "hangul", beatSec: 3 },
	];
	const reveals = [
		{ id: "s2-word-line/r0", sceneId: "word-line", shotIndex: 0, start: 3, end: 3.7, holdSec: 0.7, kind: "reveal", text: "작은", script: "hangul", beatSec: 3 },
		{ id: "s2-word-line/r1", sceneId: "word-line", shotIndex: 0, start: 3.7, end: 4.4, holdSec: 0.7, kind: "reveal", text: "배가", script: "hangul", beatSec: 3.6 },
		{ id: "s2-word-line/r2", sceneId: "word-line", shotIndex: 0, start: 4.4, end: 6, holdSec: 1.6, kind: "reveal", text: "돌아온다", script: "hangul", beatSec: 4.2 },
	];
	const seed = 20260926;
	const passRanges = [];
	for (const shot of shots) {
		const frameStart = Math.round(shot.start * FPS);
		const frameEnd = Math.round(shot.end * FPS) - 1;
		passRanges.push({ pass: "swiss-grid", frameStart, frameEnd, sceneId: shot.sceneId, shotIndex: shot.shotIndex, seed: null, params: { columns: 12, gutterPx: 24, marginPx: 96, baselinePx: 8, showGuides: false }, downgraded: false });
		passRanges.push({ pass: "dither", frameStart, frameEnd, sceneId: shot.sceneId, shotIndex: shot.shotIndex, seed: passSeed(seed, shot.sceneId, shot.shotIndex, "dither"), params: { mode: 1, paletteSize: 0, pixelScale: 1, strength: 0.3 }, downgraded: false });
	}
	const manifest = {
		schemaVersion: 1,
		engineCredit: "mexicat/pdoom-video ca251e3dddda422b364385eb484b5a3593a0990d (MIT)",
		presetId: "swiss-signal",
		seed,
		fps: FPS,
		resolution: [1920, 1080],
		scale: 1,
		samples: 4,
		shutter: 0.5,
		renderer: "ANGLE (Test GPU)",
		softwareRenderer: false,
		chromeFlags: ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--use-mock-keychain", "--password-store=basic"],
		previewEncoder: "img2webp",
		audioTier: "text-reading-time",
		bpm: 100,
		durationSec: 6,
		generatedAt: "2026-09-27T00:00:00.000Z",
		passRanges,
		timeline: [shots[0], shots[1], ...reveals],
		warnings: [],
		round: 1,
	};
	const total = 6 * FPS;
	const frames = [];
	const passLog = new Map();
	for (let f = 0; f < total; f++) {
		const shot = f < 180 ? shots[0] : shots[1];
		frames.push({
			frame: f,
			shotId: shot.id,
			pass: null,
			rgbaSha256: `hash-${f}`,
			glyphInkPixels: 1000,
			p995: null,
			flash: { f, g: [0, 0], r: [0, 0], step: 0 },
			textBoxes: [
				{ elementId: `${shot.id}/text`, text: shot.text, voice: "display", fontFile: shot.script === "hangul" ? "../lit-pptx/pretendard-font/public/static/PretendardGOV-Bold.otf" : "fonts/archivo/Archivo-w75-wt900.ttf", fontSizePx: 120, capHeightPx: 90, weight: 700, fill: "#E9EBE4", bbox: [128, 400, 900, 520], script: shot.script, trackingEm: shot.script === "hangul" ? 0 : -0.02, widthPct: shot.script === "hangul" ? null : 75, scaleX: 1, outline: false, halo: false, alpha: 1, block: null },
			],
			elements: [{ elementId: `${shot.id}/rule`, kind: "rule", bbox: [128, 560, 900, 562] }],
			fills: [{ source: "background", color: "#0C0E13", w: 1920, h: 1080 }, { source: "type", color: "#E9EBE4", w: 120, h: 120, glyph: true }],
			blocks: [],
			events: [],
			post: { flash: 0, invert: false, zoom: 1, shake: [0, 0], fade: 1, grain: 0.045 },
		});
		const range = passRanges.find((r) => r.pass === "dither" && f >= r.frameStart && f <= r.frameEnd);
		passLog.set(f, [
			{ frame: f, pass: "swiss-grid", draws: 4, uniforms: { u_segments: 1 } },
			{ frame: f, pass: "dither", draws: 4, uniforms: { u_seed: range.seed, u_ditherMode: 1 } },
		]);
	}
	return {
		manifest,
		frames,
		passLog,
		preview: { records: Array.from({ length: 180 }, (_, f) => ({ f, g: [0, 0], r: [0, 0] })), fps: 30 },
		exports: {
			mp4: { present: true, bytes: 20_000_000 },
			preview: { present: true, bytes: 900_000 },
			poster: { present: true, bytes: 300_000 },
			still: { present: true, bytes: 200_000 },
		},
		probe: { width: 1920, height: 1080, fps: 60, duration: 6, pixFmt: "yuv420p", colorSpace: "bt709", colorRange: "tv", colorTransfer: "bt709", colorPrimaries: "bt709" },
		perf: { frames: 120, p50: 10, p95: 14, max: 20 },
		determinism: { frames: [{ frame: 179, video: "hash-179", rerender: "hash-179" }, { frame: 180, video: "hash-180", rerender: "hash-180" }] },
		coverage: [],
		stillInk: 1000,
		contrast: [contrastFrame(330, "#E9EBE4", "#0C0E13")],
		presetReason: "fixture",
	};
}

/** A 480x270 kept frame (scale 0.25) with one text box drawn as a filled block over a flat background. */
export function contrastFrame(frame, fg, bg) {
	const width = 480;
	const height = 270;
	const rgba = new Uint8Array(width * height * 4);
	const mask = new Uint8Array(width * height);
	const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
	const [fr, fg2, fb] = hex(fg);
	const [br, bg2, bb] = hex(bg);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const inText = x >= 40 && x < 220 && y >= 100 && y < 130 && (x % 6 < 4);
			const i = (y * width + x) * 4;
			rgba.set(inText ? [fr, fg2, fb, 255] : [br, bg2, bb, 255], i);
			mask[y * width + x] = inText ? 255 : 0;
		}
	return {
		frame,
		width,
		height,
		rgba,
		mask,
		line: { textBoxes: [{ elementId: "fixture/text", text: "fixture", voice: "display", fontSizePx: 120, capHeightPx: 90, weight: 700, fill: fg, bbox: [160, 400, 880, 520], alpha: 1 }] },
	};
}
