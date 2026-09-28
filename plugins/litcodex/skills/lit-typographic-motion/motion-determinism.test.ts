import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { typeTreatment, writeTreatment } from "./fixtures/treatments.mjs";

// MO-C-09 / MO-A-24 / MO-A-25 on real Chrome. Skips with a printed reason when Chrome, ffmpeg or a
// pre-warmed fixture cache is absent; never silently.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function setup(context: { skip: (reason: string) => void }) {
	if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), null;
	if (!CHROME) return context.skip("Chrome not installed on this host"), null;
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-det-")));
	temps.push(dir);
	const brief = join(dir, "brief.json");
	const lines = ["SIGNAL CHECK", "PORT 3 · LAMP ON · TIDE OK"];
	writeFileSync(brief, JSON.stringify({ lines, preset: "terminalcore" }));
	mkdirSync(join(dir, "out"), { recursive: true });
	writeTreatment(join(dir, "out"), typeTreatment(lines, { typePlan: { faces: ["VT323", "MesloLGS NF"], hierarchy: "the check line leads", maxWordsOnScreen: 8, preset: "terminalcore" } }));
	mkdirSync(join(dir, "out", ".run"), { recursive: true });
	writeFileSync(join(dir, "out", ".run", "brief.json"), JSON.stringify({ brief: JSON.parse(readFileSync(brief, "utf8")), preset: "terminalcore" }));
	return { dir, brief, env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES, "xdg") } };
}

function child(ctx: { dir: string; env: NodeJS.ProcessEnv }, frames: number[], rung: number, samples: number, tag: string) {
	const record = join(ctx.dir, `${tag}.jsonl`);
	const result = spawnSync(process.execPath, [RENDER, "determinism", "--brief", join(ctx.dir, "out", ".run", "brief.json"), "--out", join(ctx.dir, "out"), "--frames", frames.join(","), "--rung", String(rung), "--samples", String(samples), "--shutter", "0.5", "--scale", "1", "--record", record], { encoding: "utf8", env: ctx.env, timeout: 600000 });
	return { result, lines: existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [] };
}

describe("determinism on real Chrome", { timeout: 900000 }, () => {
	it("two independent processes on the SwiftShader rung give equal rgbaSha256 (MO-C-09, MO-A-24)", (context) => {
		const ctx = setup(context);
		if (!ctx) return;
		const a = child(ctx, [0, 45, 200], 1, 1, "a");
		if (a.result.status === 10) return context.skip(`Chrome cannot launch in this test sandbox: ${a.result.stderr.trim()}`);
		const b = child(ctx, [0, 45, 200], 1, 1, "b");
		expect(a.result.status, a.result.stderr).toBe(0);
		expect(b.result.status, b.result.stderr).toBe(0);
		expect(a.lines[0].renderer).toMatch(/SwiftShader/iu);
		expect(a.lines.map((l) => l.rgbaSha256)).toEqual(b.lines.map((l) => l.rgbaSha256));
	});
	it("a seeked still equals the sequential film frame at the same samples, including a stateful shot (MO-A-25)", (context) => {
		const ctx = setup(context);
		if (!ctx) return;
		const video = spawnSync(process.execPath, [RENDER, "video", "--brief", ctx.brief, "--out", join(ctx.dir, "out"), "--samples", "2"], { encoding: "utf8", env: ctx.env, timeout: 900000 });
		if (video.status === 10) return context.skip(`Chrome cannot launch in this test sandbox: ${video.stderr.trim()}`);
		if (video.status === 12) return context.skip("ffmpeg not available for the sequential film");
		expect(video.status, video.stderr).toBe(0);
		const manifest = JSON.parse(readFileSync(join(ctx.dir, "out", "manifest.json"), "utf8"));
		const sequential = new Map(
			readFileSync(join(ctx.dir, "out", "render.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
				.filter((l) => l.pass === null && l.frame !== undefined && l.rgbaSha256)
				.map((l) => [l.frame, l.rgbaSha256]),
		);
		const second = manifest.timeline.find((e: { kind: string; start: number }) => e.kind === "line" && e.start > 0);
		const inside = Math.round(second.start * 60) + 40;
		const rung = manifest.chromeFlags.includes("--use-angle=swiftshader") ? 1 : 0;
		const seeked = child(ctx, [inside, 30], rung, 2, "seeked");
		expect(seeked.result.status, seeked.result.stderr).toBe(0);
		for (const line of seeked.lines) expect(line.rgbaSha256, `frame ${line.frame}`).toBe(sequential.get(line.frame));
	});
});
