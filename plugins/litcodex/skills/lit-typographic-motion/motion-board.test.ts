import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { demoPage, demoTreatment } from "./engine/gallery.mjs";
import { decodePng } from "./engine/image.mjs";

// The board round on a real page: scaffold, stills-only, board.png and the board check, in real Chrome.
// Skipped, with the reason printed, without Chrome or a pre-warmed runtime cache.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const ready = (context: { skip: (reason: string) => void }) => {
	if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache"), false;
	if (!CHROME) return context.skip("Chrome not installed on this host"), false;
	return true;
};

function film(style: string, format: string, patchPage: (html: string) => string = (html) => html) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-board-")));
	temps.push(dir);
	const out = join(dir, "film");
	mkdirSync(join(out, "stage"), { recursive: true });
	const treatment = demoTreatment(style, format);
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	writeFileSync(join(out, "stage", "index.html"), patchPage(demoPage(treatment)));
	const result = spawnSync(process.execPath, [RENDER, "stage", "--out", out, "--round", "1", "--stills-only"], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") }, timeout: 600000 });
	return { out, result };
}

describe("the board round on a real page", { timeout: 700000 }, () => {
	it("writes the storyboard beside the stills, lists it in the manifest and passes the board check", (context) => {
		if (!ready(context)) return;
		const { out, result } = film("paper", "16:9");
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(EXIT.OK);
		const png = decodePng(readFileSync(join(out, "stills", "board.png")));
		expect([png.width, png.height]).toEqual([1920, 1080]);
		const manifest = JSON.parse(readFileSync(join(out, "stills", "manifest.json"), "utf8"));
		const board = manifest.files.find((f: { file: string }) => f.file === "board.png");
		expect(board).toMatchObject({ kind: "board" });
		expect(board.sha256).toMatch(/^[0-9a-f]{64}$/u);
		expect(result.stdout).toContain("board:");
		expect(existsSync(join(out, "film.mp4"))).toBe(false);
	});
	it("draws a vertical film's board on the same 16:9 page", (context) => {
		if (!ready(context)) return;
		const { out, result } = film("terminalcore", "9:16");
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(EXIT.OK);
		const png = decodePng(readFileSync(join(out, "stills", "board.png")));
		expect([png.width, png.height]).toEqual([1920, 1080]);
	});
	it("exits 13 naming the rule when copy is off the style, and still writes the board", (context) => {
		if (!ready(context)) return;
		const { out, result } = film("swiss-signal", "16:9", (html) => html.replace("</style>", "  .lit-ink { color: #ff00ff !important; }\n</style>"));
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(EXIT.GATE_FAIL_QA);
		expect(result.stderr).toContain("GATE_FAIL_QA (board)");
		expect(result.stderr).toContain("TEXT-ON-STYLE");
		expect(existsSync(join(out, "stills", "board.png"))).toBe(true);
		expect(existsSync(join(out, "film.mp4"))).toBe(false);
	});
	it("exits 13 on text over text", (context) => {
		if (!ready(context)) return;
		const { result } = film("tidal", "16:9", (html) => html.replace('data-copy="0"></p>', 'data-copy="0"></p><p class="lit-headline lit-ink" data-copy="1"></p>').replace("</style>", "  .type p { position: absolute !important; left: 0; top: 0; }\n</style>"));
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(EXIT.GATE_FAIL_QA);
		expect(result.stderr).toContain("TEXT-OVERLAP");
	});
});
