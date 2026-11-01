import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { deflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { decodePng } from "./engine/image.mjs";
import { CLIP_LIMITS, scanClips, scanStage, stageRouter } from "./engine/stage.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// Declared keyed overlay clips on the stage path (references/stage.md, Clips): a frame folder named in
// stage/clips/clips.json is held to the clip caps and is not a flipbook; every other raster keeps its
// limits. Renders skip, with the reason printed, when Chrome or a pre-warmed fixture cache is absent.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix: string) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	temps.push(dir);
	return dir;
};

// The engine's own encoder writes RGB only; a keyed frame needs an alpha channel, so the test writes one.
const CRC = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
const crc32 = (buf: Buffer) => {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const out = Buffer.alloc(body.length + 8);
	out.writeUInt32BE(data.length, 0);
	body.copy(out, 4);
	out.writeUInt32BE(crc32(body), body.length + 4);
	return out;
};
function png(width: number, height: number, pixels: Uint8Array, { colorType = 6, depth = 8 } = {}) {
	const channels = colorType === 6 ? 4 : 3;
	const stride = width * channels;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
	const head = Buffer.alloc(13);
	head.writeUInt32BE(width, 0);
	head.writeUInt32BE(height, 4);
	head[8] = depth;
	head[9] = colorType;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/** An RGBA frame of one colour whose first pixel is transparent (a keyed frame); `opaque` makes it solid. */
function keyed(width: number, height: number, { opaque = false, rgb = [90, 90, 90] } = {}) {
	const px = new Uint8Array(width * height * 4);
	for (let i = 0; i < px.length; i += 4) px.set([rgb[0], rgb[1], rgb[2], 255], i);
	if (!opaque) px[3] = 0;
	return png(width, height, px);
}

const frameName = (i: number) => `frame_${String(i).padStart(4, "0")}.png`;
type Clip = { id: string; dir: string; count: number; fps: number; w?: number; h?: number; files?: number; frame?: Buffer };
/** A stage dir: index.html, clips/<dir>/frame_NNNN.png for each clip, and clips/clips.json. */
function stageWith(clips: Clip[], { declare = clips, extra = (_dir: string) => {} }: { declare?: Clip[]; extra?: (dir: string) => void } = {}) {
	const stage = join(temp("lit-clips-"), "stage");
	mkdirSync(join(stage, "clips"), { recursive: true });
	writeFileSync(join(stage, "index.html"), "<!doctype html><title>clips</title>");
	for (const clip of clips) {
		mkdirSync(join(stage, "clips", clip.dir), { recursive: true });
		const frame = clip.frame ?? keyed(clip.w ?? 8, clip.h ?? 6);
		for (let i = 1; i <= (clip.files ?? clip.count); i++) writeFileSync(join(stage, "clips", clip.dir, frameName(i)), frame);
	}
	writeFileSync(join(stage, "clips", "clips.json"), JSON.stringify({ clips: declare.map(({ id, dir, count, fps }) => ({ id, dir, count, fps })) }));
	extra(stage);
	return stage;
}
const failure = (fn: () => unknown) => {
	try {
		fn();
		return null;
	} catch (error) {
		return error as { code: number; message: string };
	}
};

const A: Clip = { id: "boom", dir: "01-boom", count: 12, fps: 30 };
const B: Clip = { id: "cat", dir: "10-cat", count: 30, fps: 30 };

describe("declared clips on the stage path", () => {
	it("a declared clip set is not a flipbook, is not a page raster, and is listed by the scan", () => {
		const scan = scanStage(stageWith([A, B]));
		expect(scan.rasters).toEqual([]);
		expect(scan.clips.map((c: { id: string; count: number; fps: number; width: number; height: number }) => [c.id, c.count, c.fps, c.width, c.height])).toEqual([["boom", 12, 30, 8, 6], ["cat", 30, 30, 8, 6]]);
		expect(scan.clips.every((c: { bytes: number }) => c.bytes > 0)).toBe(true);
	});
	it("a stage that declares no clips scans to an empty list", () => {
		const stage = stageWith([A]);
		rmSync(join(stage, "clips"), { recursive: true, force: true });
		expect(scanStage(stage).clips).toEqual([]);
	});
	it("an undeclared frame sequence is still a flipbook, also beside a declared clip", () => {
		const stage = stageWith([A], {
			extra: (dir) => {
				mkdirSync(join(dir, "flip"));
				for (let i = 1; i <= 12; i++) writeFileSync(join(dir, "flip", frameName(i)), keyed(8, 6));
			},
		});
		expect(failure(() => scanStage(stage))?.message).toMatch(/flipbook/u);
	});
	it("a clip folder missing from clips.json is a flipbook, and so is any clip folder without clips.json", () => {
		expect(failure(() => scanStage(stageWith([A], { declare: [] })))?.message).toMatch(/flipbook/u);
		const stage = stageWith([A]);
		rmSync(join(stage, "clips", "clips.json"));
		expect(failure(() => scanStage(stage))?.message).toMatch(/flipbook/u);
	});
	it("cover mode takes no clips", () => {
		expect(failure(() => scanStage(stageWith([A]), { clips: false }))?.message).toMatch(/flipbook/u);
	});

	const refused: [string, Clip, RegExp][] = [
		["more frames than a clip may have", { ...A, count: 361 }, /clip "boom".*361 frames/u],
		["a frame missing from the run", { ...A, files: 11 }, /frame_0012\.png/u],
		["a stray frame beyond the declared count", { ...A, files: 13 }, /frame_0013\.png/u],
		["opaque RGB frames (not keyed)", { ...A, frame: png(8, 6, new Uint8Array(8 * 6 * 3).fill(90), { colorType: 2 }) }, /RGBA/u],
		["RGBA frames with no transparent pixel", { ...A, frame: keyed(8, 6, { opaque: true }) }, /transparen/u],
		["a frame larger than the overlay cap", { ...A, w: 721, h: 20 }, /clip "boom".*721/u],
		["a frame rate above 30", { ...A, fps: 60 }, /fps/u],
		["an id that is not a plain token", { ...A, id: "a b" }, /id must be/u],
	];
	for (const [name, clip, message] of refused) {
		it(`refuses ${name} with exit 17`, () => {
			const error = failure(() => scanStage(stageWith([clip])));
			expect(error, "the scan must refuse it").not.toBeNull();
			expect(error?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
			expect(error?.message).toMatch(message);
		});
	}
	it("refuses frames of mixed sizes and a folder name that climbs out", () => {
		const mixed = stageWith([A], { extra: (dir) => writeFileSync(join(dir, "clips", A.dir, frameName(5)), keyed(9, 6)) });
		const mixedError = failure(() => scanStage(mixed));
		expect(mixedError?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(mixedError?.message).toMatch(/one size per clip/u);
		const climb = stageWith([A], { extra: (dir) => writeFileSync(join(dir, "clips", "clips.json"), JSON.stringify({ clips: [{ id: "boom", dir: "..", count: 12, fps: 30 }] })) });
		const climbError = failure(() => scanStage(climb));
		expect(climbError?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(climbError?.message).toMatch(/dir must be a folder/u);
	});
	it("refuses a duplicate id, a malformed clips.json and more than the clip cap", () => {
		const dup = failure(() => scanStage(stageWith([A, { ...B, dir: "other", id: "boom" }])));
		expect(dup?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(dup?.message).toMatch(/duplicate id boom/u);
		const bad = stageWith([A]);
		writeFileSync(join(bad, "clips", "clips.json"), "{ not json");
		const badError = failure(() => scanStage(bad));
		expect(badError?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(badError?.message).toMatch(/clips\.json/u);
		const many = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, dir: `d${i}`, count: 2, fps: 30 }));
		const manyError = failure(() => scanStage(stageWith(many)));
		expect(manyError?.code).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(manyError?.message).toMatch(/at most 12 clips/u);
	});
	it("holds per-clip and total bytes and frames to the caps, which are exported", () => {
		expect(Object.keys(CLIP_LIMITS).sort()).toEqual(["bytesPerClip", "bytesTotal", "clips", "fps", "framesPerClip", "framesTotal", "side"]);
		expect(CLIP_LIMITS).toMatchObject({ clips: 12, framesPerClip: 360, framesTotal: 1500, bytesPerClip: 40 * 1024 * 1024, bytesTotal: 128 * 1024 * 1024, side: 720, fps: 30 });
		const stage = stageWith([A, B]);
		const run = (limits: Partial<typeof CLIP_LIMITS>) => failure(() => scanClips(stage, { limits: { ...CLIP_LIMITS, ...limits } }))?.code ?? 0;
		expect(run({})).toBe(0);
		expect(run({ bytesPerClip: 100 }), "per-clip bytes").toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(run({ bytesTotal: 100 }), "total bytes").toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(run({ framesTotal: 41 }), "total frames").toBe(EXIT.STAGE_CONTRACT_ERROR);
	});
});

describe("the page reaches the declared clips at /lit/clips.js", () => {
	const answer = async (stage: string, path: string) => {
		const record = { blocked: [] as string[], rejected: [] as string[], missing: [] as string[] };
		let fulfilled: { status?: number; contentType?: string; body?: string | Buffer } | null = null;
		const route = {
			request: () => ({ url: () => `http://lit.stage${path}` }),
			fulfill: async (response: typeof fulfilled) => {
				fulfilled = response;
			},
			abort: async () => {},
		};
		const scan = scanStage(stage);
		const handler = stageRouter({ root: scan.root, fonts: { css: "", routes: new Map() }, record });
		await handler(route);
		return { fulfilled: fulfilled as unknown as { status: number; contentType: string; body: string | Buffer }, record };
	};
	it("serves the declaration as window.LitClips, and still serves the frames", async () => {
		const stage = stageWith([A]);
		const served = await answer(stage, "/lit/clips.js");
		expect(served.fulfilled.status).toBe(200);
		expect(served.fulfilled.contentType).toContain("javascript");
		const sandbox: { window: { LitClips?: unknown } } = { window: {} };
		vm.runInNewContext(String(served.fulfilled.body), sandbox);
		expect(JSON.parse(JSON.stringify(sandbox.window.LitClips))).toEqual({ boom: { src: "clips/01-boom", count: 12, fps: 30, width: 8, height: 6 } });
		const frame = await answer(stage, "/clips/01-boom/frame_0001.png");
		expect(frame.fulfilled.status).toBe(200);
		expect(frame.fulfilled.contentType).toBe("image/png");
	});
	it("answers 404 when the stage declares no clips", async () => {
		const stage = stageWith([A]);
		rmSync(join(stage, "clips"), { recursive: true, force: true });
		const served = await answer(stage, "/lit/clips.js");
		expect(served.fulfilled.status).toBe(404);
		expect(served.record.missing).toContain("/lit/clips.js");
	});
});

describe("LitStage.keyedClip picks the frame from film time alone", () => {
	const source = readFileSync(join(skillRoot, "engine", "stage-kit.js"), "utf8");
	type El = { tag: string; style: Record<string, string>; children: El[]; attrs: Record<string, string>; parent?: El; src?: string; setAttribute(k: string, v: string): void; append(c: El): void; replaceWith(n: El): void };
	/** The kit over a bare window with a tiny DOM: elements remember their children and style. */
	const setup = (clips: unknown) => {
		const el = (tag: string): El => ({
			tag,
			style: {},
			children: [],
			attrs: {},
			setAttribute(k, v) {
				this.attrs[k] = v;
			},
			append(c) {
				this.children.push(c);
				c.parent = this;
			},
			replaceWith(n) {
				const parent = this.parent as El;
				parent.children[parent.children.indexOf(this)] = n;
				n.parent = parent;
			},
		});
		const window: { LitClips: unknown; LitStage?: Record<string, (...args: unknown[]) => unknown> } = { LitClips: clips };
		vm.runInNewContext(source, { window, document: { createElement: el }, Intl, Math, Number, String, Array, Object, Error, JSON, parseFloat, parseInt });
		return { LitStage: window.LitStage as Record<string, (...args: unknown[]) => unknown>, parent: el("div") };
	};
	const data = { boom: { src: "clips/01-boom", count: 12, fps: 30, width: 520, height: 511 } };
	const box = { x: 10, y: 20, w: 300, h: 300 };
	const shown = (parent: El) => parent.children[0].children[0]?.src;
	type Show = (t: number, o?: { start?: number; from?: number; to?: number; loop?: boolean; hold?: boolean }) => unknown;
	const open = (clips: unknown = data) => {
		const { LitStage, parent } = setup(clips);
		return { LitStage, parent, show: LitStage.keyedClip({ parent, id: "boom", box }) as Show };
	};

	it("keeps the existing clip-path helpers", () => {
		const { LitStage } = setup(data);
		expect(typeof (LitStage.clip as unknown as Record<string, unknown>).wipe).toBe("function");
	});
	it("maps film time to a 1-based frame: floor((t - start) * fps) + 1", () => {
		const { parent, show } = open();
		expect(show(1.0, { start: 1.0 })).toBe(parent.children[0]);
		expect(shown(parent)).toMatch(/clips\/01-boom\/frame_0001\.png$/u);
		show(1.0 + 4 / 30, { start: 1.0 });
		expect(shown(parent)).toMatch(/frame_0005\.png$/u);
		show(1.0 + 11 / 30, { start: 1.0 });
		expect(shown(parent)).toMatch(/frame_0012\.png$/u);
	});
	it("is hidden before its cue and after its last frame unless it loops or holds", () => {
		const { parent, show } = open();
		expect(show(0.5, { start: 1.0 }), "before the cue").toBeNull();
		expect(parent.children[0].style.display).toBe("none");
		expect(show(1.0 + 12 / 30, { start: 1.0 }), "past the last frame").toBeNull();
		show(1.0 + 13 / 30, { start: 1.0, hold: true });
		expect(shown(parent), "hold keeps the last frame").toMatch(/frame_0012\.png$/u);
		show(1.0 + 13 / 30, { start: 1.0, loop: true });
		expect(shown(parent), "loop wraps by frame index").toMatch(/frame_0002\.png$/u);
	});
	it("plays a frame range and gives the same frame for the same t in any order", () => {
		const { parent, show } = open();
		const range = { start: 0, from: 4, to: 6 };
		show(2 / 30, range);
		expect(shown(parent)).toMatch(/frame_0006\.png$/u);
		expect(show(3 / 30, range), "past the range").toBeNull();
		show(0, range);
		expect(shown(parent)).toMatch(/frame_0004\.png$/u);
		show(2 / 30, range);
		expect(shown(parent), "same t, same frame").toMatch(/frame_0006\.png$/u);
	});
	it("keeps one wrapper at the box, so a page can scale it, and refuses a bad range, an unknown clip or a missing script", () => {
		const { LitStage, parent, show } = open();
		show(0, { start: 0 });
		show(0.1, { start: 0 });
		expect(parent.children.length, "one wrapper, never one per frame").toBe(1);
		const { left, top, width, height } = parent.children[0].style;
		expect([left, top, width, height]).toEqual(["10px", "20px", "300px", "300px"]);
		expect(() => show(0, { from: 3, to: 99 })).toThrow(/from\.\.to/u);
		expect(() => LitStage.keyedClip({ parent, id: "nope", box })).toThrow(/nope/u);
		expect(() => setup(undefined).LitStage.keyedClip({ parent, id: "boom", box })).toThrow(/clips\.js/u);
	});
});

describe("a declared clip on real Chrome", { timeout: 900000 }, () => {
	const ready = (context: { skip: (reason: string) => void }) => {
		if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), false;
		if (!CHROME) return context.skip("Chrome not installed on this host"), false;
		return true;
	};
	const render = (out: string, extra: string[] = []) => spawnSync(process.execPath, [RENDER, "stage", "--out", out, ...extra], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") }, timeout: 600000 });
	/** A run folder with the fixture page, the clip frames `frameAt(k)` makes, its clips.json and the treatment. */
	function run(fixture: string, clip: { id: string; count: number }, frameAt: (k: number) => Buffer) {
		const out = join(temp("lit-clip-render-"), "out");
		mkdirSync(join(out, "stage", "clips", clip.id), { recursive: true });
		cpSync(join(skillRoot, "fixtures", "stage", fixture, "index.html"), join(out, "stage", "index.html"));
		for (let k = 1; k <= clip.count; k++) writeFileSync(join(out, "stage", "clips", clip.id, frameName(k)), frameAt(k));
		writeFileSync(join(out, "stage", "clips", "clips.json"), JSON.stringify({ clips: [{ id: clip.id, dir: clip.id, count: clip.count, fps: 30 }] }));
		writeFileSync(join(out, "treatment.json"), JSON.stringify(stageTreatment(), null, 2));
		return out;
	}
	const centre = (file: string) => {
		const image = decodePng(readFileSync(file));
		const i = (450 * image.width + 800) * 4;
		return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
	};
	const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) <= 3);

	it("shows the frame film time picks: hidden before the cue, frame 5 at 2.0 s, hidden after the last frame", (context) => {
		if (!ready(context)) return;
		// Frame k is a solid (20k, 0, 0) with one transparent corner pixel; the beat stills are at 0.667 s, 2.0 s and 3.333 s.
		const out = run("clip-overlay", { id: "swatch", count: 8 }, (k) => keyed(8, 6, { rgb: [20 * k, 0, 0] }));
		const result = render(out, ["--stills-only"]);
		expect(result.status, result.stderr).toBe(0);
		expect(near(centre(join(out, "stills", "beat-01.png")), [0, 0, 0]), "before the cue").toBe(true);
		expect(near(centre(join(out, "stills", "beat-02.png")), [100, 0, 0]), "clip frame 5 at t = 2.0 s").toBe(true);
		expect(near(centre(join(out, "stills", "beat-03.png")), [0, 0, 0]), "past the last frame").toBe(true);
	});
	it("a clip does not slip past the flash audit: a full-frame white and black clip fails MO-C-03 and withholds the film", (context) => {
		if (!ready(context)) return;
		// Twelve frames in blocks of three, white then black: five light-dark swings a second at 30 fps over most of the frame.
		const out = run("clip-strobe", { id: "strobe", count: 12 }, (k) => keyed(8, 6, { rgb: Math.floor((k - 1) / 3) % 2 ? [0, 0, 0] : [255, 255, 255] }));
		const result = render(out, ["--round", "2"]);
		expect(result.status, result.stdout + result.stderr).toBe(EXIT.GATE_FAIL_QA);
		expect(readFileSync(join(out, "gate-report.txt"), "utf8")).toMatch(/MO-C-03[^\n]*FAIL/u);
		expect(existsSync(join(out, "film.mp4")), "a flash-audit FAIL withholds the film").toBe(false);
		expect(existsSync(join(out, "withheld"))).toBe(true);
	});
});

