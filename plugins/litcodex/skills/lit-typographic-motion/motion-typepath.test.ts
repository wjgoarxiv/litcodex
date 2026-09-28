import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Composer } from "./engine/compose.mjs";
import { FRAME } from "./engine/constants.mjs";
import { fontEntry, fontPath } from "./engine/fonts.mjs";
import { evaluate } from "./engine/gate.mjs";
import { planPasses } from "./engine/passes.mjs";
import { PRESETS, presetFontKeys } from "./engine/presets.mjs";
import { resolveRuntime } from "./engine/runtime.mjs";
import { accentShot, buildTimeline, normalizeBrief } from "./engine/timeline.mjs";
import { FontBook } from "./engine/type.mjs";
import { passingRun } from "./fixtures/gate-fixture.mjs";
import { framesViewed } from "./scripts/render.mjs";

// Type-path fixes from the director wave: nothing internal prints on screen, the preset label is
// honest, the viewed count survives a gate re-run, and the treatment's length is honoured.
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

async function screenTexts(raw: Record<string, unknown>): Promise<string[]> {
	const runtime = resolveRuntime({ ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") });
	const mod = await import(pathToFileURL(runtime.opentype).href);
	const opentype = mod.parse ? mod : mod.default;
	const brief = normalizeBrief(raw);
	const preset = PRESETS.terminalcore;
	const keys = presetFontKeys(preset);
	const book = new FontBook(opentype, Object.fromEntries(keys.map((key) => [key, { bytes: readFileSync(fontPath(fontEntry(key), runtime.dir)) }])));
	const plan = buildTimeline(brief);
	const { plans } = planPasses({ preset, shots: plan.shots, runSeed: brief.seed, softwareGL: true, fps: FRAME.fps, stateful: false });
	const composer = new Composer({ book, preset, plan, passPlans: plans, runSeed: brief.seed, fps: FRAME.fps, footer: brief.filmName ?? "", showIndex: brief.showIndex, accentShotId: accentShot(plan.shots), accentWindow: [0, 0], stateful: false });
	const texts = new Set<string>();
	for (const shot of plan.shots) {
		const n = Math.round(((shot.start + shot.end) / 2) * FRAME.fps);
		for (const box of composer.frame(n, { samples: 1, shutter: 0.5 }).line.textBoxes ?? []) texts.add(box.text);
	}
	return [...texts];
}

describe("RC8b: the working title and a shot index never print unless the film asks", () => {
	const lines = ["Harbor lights", "작은 배가 돌아온다", "Good night"];
	it("prints only the copy by default", async (context) => {
		if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed fonts");
		const texts = await screenTexts({ lines, title: "Harbor night working title" });
		expect(texts.some((t) => /\d\d\s*\/\s*\d\d/u.test(t))).toBe(false);
		expect(texts.some((t) => t.includes("working title"))).toBe(false);
	});
	it("prints the film's own name and the index only when the treatment sets them", async (context) => {
		if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed fonts");
		const texts = await screenTexts({ lines, filmName: "Harbor Night", showIndex: true });
		expect(texts.some((t) => /\d\d\s*\/\s*\d\d/u.test(t))).toBe(true);
		expect(texts).toContain("Harbor Night");
	});
});

describe("RC8c: a gate re-run keeps the recorded viewed count", () => {
	it("a render records its count and a later gate without --viewed reads it back", () => {
		const out = realpathSync(mkdtempSync(join(tmpdir(), "motion-viewed-")));
		temps.push(out);
		expect(framesViewed(out, { viewed: "7" }, { render: true })).toBe(7);
		expect(framesViewed(out, {})).toBe(7);
		expect(framesViewed(out, { viewed: "9" })).toBe(9);
		expect(framesViewed(out, {})).toBe(9);
		expect(existsSync(join(out, ".run", "viewed.json"))).toBe(true);
	});
});

describe("MO-C-12 as amended on the type path", () => {
	it("scales holds up to meet the treatment's target without cutting a reading floor", () => {
		const short = buildTimeline(normalizeBrief({ lines: ["Harbor lights", "Good night"] }));
		const target = buildTimeline(normalizeBrief({ lines: ["Harbor lights", "Good night"], durationSec: 12 }));
		expect(target.durationSec).toBeGreaterThanOrEqual(12);
		expect(target.durationSec).toBeLessThan(12 + 1.2 + 1e-6);
		for (let i = 0; i < short.shots.length; i++) expect(target.shots[i].holdSec).toBeGreaterThanOrEqual(short.shots[i].holdSec);
	});
	it("WARNs, and says so, when the reading floors force a film longer than the target", () => {
		const run = passingRun();
		(run.manifest as Record<string, unknown>).targetDurationSec = run.probe.duration / 1.5;
		const rule = evaluate(run).find((r: { id: string }) => r.id === "MO-C-10/11/12");
		expect(rule?.status).toBe("WARN");
		expect(rule?.detail).toContain("over the treatment's");
	});
});
