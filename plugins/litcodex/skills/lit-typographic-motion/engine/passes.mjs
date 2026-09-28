// Look-library planning: per-shot seeds (MO-SH-01), precomputed event schedules that respect the
// per-shot ceiling of 2 events in any 1 s window (MO-SH-03), the software-GL downgrade (MO-SH-09),
// and the per-sample uniform values each GLSL pass receives. The GLSL itself is browser-app.js.
import { EVENTS, PASS_CAPS } from "./constants.mjs";
import { envelope, fnv1a32, mulberry32, passSeed } from "./util.mjs";

export const PASS_IDS = Object.freeze(["glitch", "tidal-gradient", "crt", "dither", "swiss-grid", "terminal-ui"]);

/** True when adding an event at t keeps every 1 s window of this shot at or under the ceiling. */
export function fitsCeiling(times, t) {
	const all = [...times, t].sort((a, b) => a - b);
	for (let i = 0; i < all.length; i++) {
		let n = 0;
		for (let j = i; j < all.length && all[j] < all[i] + EVENTS.windowSec - 1e-9; j++) n++;
		if (n > EVENTS.maxPerWindow) return false;
	}
	return true;
}

/** Candidate event times: reveal starts (word boundaries) plus beats and half beats, in time order. */
function candidates(shot) {
	const times = new Set();
	for (const reveal of shot.reveals) if (reveal.start > shot.start + 0.2) times.add(round(reveal.start));
	for (let t = shot.start + shot.beat; t < shot.end - 0.25; t += shot.beat / 2) times.add(round(t));
	return [...times].filter((t) => t > shot.start + 0.2 && t < shot.end - 0.25).sort((a, b) => a - b);
}
const round = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Plan every pass for every shot. Returns passRanges-ready entries plus per-shot runtime plans and
 * the scheduled events (glitch hits, surges, boot flicker) for the render log.
 */
export function planPasses({ preset, shots, runSeed, softwareGL, fps, stateful }) {
	const plans = new Map();
	const events = [];
	shots.forEach((shot, shotOrder) => {
		const taken = [];
		const shotEvents = [];
		const addEvent = (t, source, detail = {}) => {
			taken.push(t);
			const event = { t, frame: Math.round(t * fps), source, shotId: shot.id, ...detail };
			shotEvents.push(event);
			events.push(event);
			return event;
		};
		const passes = [];
		for (const { pass, params: defaults } of preset.passes) {
			const seed = pass === "swiss-grid" ? null : passSeed(runSeed, shot.sceneId, shot.shotIndex, pass);
			const params = { ...defaults };
			let downgraded = false;
			const plan = { pass, seed, params, downgraded, schedule: [] };
			if (pass === "terminal-ui") {
				params.compositedThrough = preset.passes.map((p) => p.pass).filter((p) => p === "crt" || p === "dither");
				if (shotOrder === 0 && preset.motion.bootFlickerSec) plan.boot = addEvent(shot.start + 0.05, "boot-flicker", { durationSec: preset.motion.bootFlickerSec });
			}
			if (pass === "tidal-gradient") {
				params.octavesRequested = defaults.octaves;
				if (softwareGL) {
					params.octaves = Math.max(3, Math.floor(defaults.octaves / 2));
					downgraded = true;
				}
				params.paletteStopsHex = [preset.palette.teal, preset.palette.violet];
				const random = mulberry32(seed);
				const rate = Math.min(defaults.surgeRatePerSec, PASS_CAPS.surgeRate);
				for (const t of candidates(shot)) {
					const budget = Math.floor(rate * shot.holdSec + 1e-9);
					if (plan.schedule.length >= budget) break;
					if (random() < 0.55 && fitsCeiling(taken, t)) plan.schedule.push(addEvent(t, "surge", { attackSec: defaults.surgeAttackSec, decaySec: defaults.surgeDecaySec }));
				}
				params.surgeCountRealized = plan.schedule.length;
				params.origin = [random() * 64, random() * 64];
			}
			if (pass === "glitch") {
				const random = mulberry32(seed);
				const rate = Math.min(defaults.hitRatePerSec, PASS_CAPS.glitchHitRate);
				for (const t of candidates(shot)) {
					const budget = Math.floor(rate * shot.holdSec + 1e-9);
					if (plan.schedule.length >= budget) break;
					if (random() < 0.5 && fitsCeiling(taken, t)) {
						plan.schedule.push(addEvent(t, "glitch-hit", { hitSeed: fnv1a32(`${seed}:hit:${plan.schedule.length}`), holdFrames: defaults.holdFrames }));
					}
				}
				params.hitRatePerSecRealized = round(plan.schedule.length / shot.holdSec);
			}
			if (pass === "crt") {
				if (softwareGL) downgraded = true;
				params.persistenceEnabled = !softwareGL && defaults.phosphorPersistence > 0;
				params.sceneStateful = stateful;
				params.flickerAmpRealized = shotOrder === 0 && preset.motion.bootFlickerSec ? PASS_CAPS.crtFlickerAmp : defaults.flickerAmp;
			}
			plan.downgraded = downgraded;
			passes.push(plan);
		}
		plans.set(shot.id, { shot, passes, events: shotEvents });
	});
	return { plans, events };
}

/** passRanges[] for the manifest: one entry per pass per shot (a continuous range). */
export function passRanges(plans) {
	const entries = [];
	for (const { shot, passes } of plans.values()) {
		for (const plan of passes) {
			const params = { ...plan.params };
			entries.push({ pass: plan.pass, frameStart: shot.frameStart, frameEnd: shot.frameEnd, sceneId: shot.sceneId, shotIndex: shot.shotIndex, seed: plan.seed, params, downgraded: plan.downgraded });
		}
	}
	return entries;
}

/**
 * Uniform values for one pass at sample time t. `still` zeroes the random-noise sources for the
 * poster and reduced-motion still (MO-A-39/40); the Bayer pattern stays.
 */
export function passUniforms(plan, t, fps, { still = false, firstFrameOfShot = false, bootOffset = 0 } = {}) {
	const p = plan.params;
	switch (plan.pass) {
		case "glitch": {
			const hit = plan.schedule.find((event) => t >= event.t && t < event.t + event.holdFrames / fps);
			return {
				u_hit: hit ? 1 : 0,
				u_hitSeed: hit ? hit.hitSeed : 0,
				u_intensity: p.intensity,
				u_sliceCount: p.sliceCount,
				u_maxOffsetPx: p.maxOffsetPx,
				u_blockCorruptSize: p.blockCorruptSize,
				u_rgbSplitPx: p.rgbSplitPx,
				u_areaCapPct: p.areaCapPct,
				u_seed: plan.seed,
			};
		}
		case "tidal-gradient": {
			let surge = 0;
			for (const event of plan.schedule) surge = Math.max(surge, envelope(t, event.t, event.attackSec, 0.05, event.decaySec));
			return {
				u_time: t,
				u_seed: plan.seed,
				u_flowSpeed: p.flowSpeed,
				u_warpAmount: p.warpAmount,
				u_curlStrength: p.curlStrength,
				u_octaves: p.octaves,
				u_surge: surge * p.surgeOnHit,
				u_bandingSteps: p.bandingSteps,
				u_ditherAmount: still ? 0 : p.ditherAmount,
				u_origin: p.origin,
			};
		}
		case "crt": {
			const half = PASS_CAPS.crtFlickerAmp / 2;
			const flicker = Math.max(-half, Math.min(half, (p.flickerAmp / 2) * Math.sin(2 * Math.PI * p.flickerFreqHz * t) + bootOffset));
			return {
				u_time: t,
				u_seed: plan.seed,
				u_scanlineFreqPerFrame: p.scanlineFreqPerFrame,
				u_scanlineDepth: p.scanlineDepth,
				u_phosphorPersistence: p.persistenceEnabled && !firstFrameOfShot ? p.phosphorPersistence : 0,
				u_bloomAmount: p.bloomAmount,
				u_curvature: p.curvature,
				u_vignette: p.vignette,
				u_triadMaskAmount: p.triadMaskAmount,
				u_flicker: still ? 0 : flicker,
			};
		}
		case "dither":
			return { u_ditherMode: p.mode, u_paletteSize: p.paletteSize, u_pixelScale: p.pixelScale, u_ditherStrength: p.strength, u_seed: plan.seed };
		case "swiss-grid":
			return { u_columns: p.columns, u_gutterPx: p.gutterPx, u_marginPx: p.marginPx, u_baselinePx: p.baselinePx, u_showGuides: p.showGuides ? 1 : 0, u_hairlineWidthPx: p.hairlineWidthPx };
		case "terminal-ui":
			return { u_charGridPx: p.charGridPx, u_windowChromeWidthPx: p.windowChromeWidthPx, u_meterCount: p.meterCount, u_caretBlinkHz: p.caretBlinkHz, u_seed: plan.seed };
		default:
			throw new Error(`unknown pass: ${plan.pass}`);
	}
}

/** Boot-flicker brightness offset at t (bounded by the CRT flicker cap, MO-B-02). */
export function bootFlicker(plan, t, cap = PASS_CAPS.crtFlickerAmp) {
	if (!plan?.boot) return 0;
	const local = t - plan.boot.t;
	if (local < 0 || local > plan.boot.durationSec) return 0;
	return (cap / 2) * Math.sin((local / plan.boot.durationSec) * Math.PI) * Math.sin(2 * Math.PI * 9 * local);
}
