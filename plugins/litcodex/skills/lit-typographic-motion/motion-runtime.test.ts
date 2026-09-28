import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { prepareMotionRuntime } from "../../../../packages/litcodex-ai/src/install/motion-runtime.js";
import { audioState, cacheDir } from "./engine/runtime.mjs";
import { typeTreatment, writeTreatment } from "./fixtures/treatments.mjs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const RUNTIME = join(skillRoot, "scripts", "runtime.mjs");
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
const node = (args: string[], env: NodeJS.ProcessEnv) => spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600000 });

const LINES = ["Harbor lights", "작은 배가 돌아온다", "Good night"];
function brief(dir: string, extra: Record<string, unknown> = {}) {
	const path = join(dir, "brief.json");
	writeFileSync(path, JSON.stringify({ lines: LINES, ...extra }));
	return path;
}
/** The validated treatment every render now needs, next to the staging brief. */
const treat = (dir: string) => writeTreatment(dir, typeTreatment(LINES));

/** A cache whose dependency receipt is valid but whose fonts were never fetched. */
function fakeDepsCache(): string {
	const xdg = temp("motion-xdg-");
	const dir = cacheDir({ XDG_CACHE_HOME: xdg } as NodeJS.ProcessEnv);
	const lockText = readFileSync(join(skillRoot, "runtime", "package-lock.json"));
	const lock = JSON.parse(lockText.toString());
	for (const name of ["opentype.js", "playwright-core", "ws"]) {
		mkdirSync(join(dir, "node_modules", name), { recursive: true });
		writeFileSync(join(dir, "node_modules", name, "package.json"), JSON.stringify({ name, version: lock.packages[`node_modules/${name}`].version }));
	}
	writeFileSync(join(dir, "ready.json"), JSON.stringify({ lockSha256: createHash("sha256").update(lockText).digest("hex") }));
	return xdg;
}

describe("runtime states without a browser (Test 10)", () => {
	it("status on an empty cache names every missing item and the fix", () => {
		const result = node([RUNTIME, "status", "--json", "--no-browser"], { XDG_CACHE_HOME: temp("motion-empty-") });
		expect(result.status).toBe(14);
		const report = JSON.parse(result.stdout);
		expect(report.ready).toBe(false);
		expect(report.missing.join("\n")).toMatch(/opentype\.js[\s\S]*playwright-core[\s\S]*ws[\s\S]*receipt[\s\S]*galmuri9[\s\S]*meslo/u);
		expect(report.prewarm).toContain("litcodex motion-runtime install");
	});
	it("a render with an unwarmed cache exits 14 and names the install command", () => {
		const dir = temp("motion-r14-");
		const result = node([RENDER, "film", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out")], { XDG_CACHE_HOME: temp("motion-cold-") });
		expect(result.status).toBe(14);
		expect(result.stderr).toContain("BLOCKED_DEPS_NOT_PREWARMED");
		expect(result.stderr).toContain("litcodex motion-runtime install");
	});
	it("a missing or hash-mismatched font exits 15, never re-fetched", () => {
		const xdg = fakeDepsCache();
		const dir = temp("motion-r15-");
		const missing = node([RENDER, "film", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "a")], { XDG_CACHE_HOME: xdg });
		expect(missing.status).toBe(15);
		expect(missing.stderr).toMatch(/BLOCKED_FONT_FETCH: meslo missing/u);
		const cache = cacheDir({ XDG_CACHE_HOME: xdg } as NodeJS.ProcessEnv);
		mkdirSync(join(cache, "fonts", "licenses"), { recursive: true });
		writeFileSync(join(cache, "fonts", "MesloLGS NF Regular.ttf"), "tampered");
		const bad = node([RENDER, "film", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "b")], { XDG_CACHE_HOME: xdg });
		expect(bad.status).toBe(15);
		expect(bad.stderr).toContain("meslo sha256 mismatch");
	});
	it("--word-timing with the models absent exits 14 and names the word-timing install", () => {
		const dir = temp("motion-wt-");
		const result = node([RENDER, "film", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out"), "--word-timing"], { XDG_CACHE_HOME: fakeDepsCache() });
		expect(result.status).toBe(14);
		expect(result.stderr).toContain("litcodex motion-runtime install --word-timing");
	});
	it("install --word-timing states the download size and the pins before anything downloads, then fails closed", () => {
		const xdg = temp("motion-wti-");
		const result = node([RUNTIME, "install", "--word-timing"], { XDG_CACHE_HOME: xdg });
		expect(result.status).toBe(14);
		expect(result.stdout.split("\n")[0]).toMatch(/word timing: download size 0 B; pinned models: none/u);
		expect(existsSync(join(xdg, "litcodex"))).toBe(false);
	});
	it("an offline pre-warm fails the runtime step but prints one receipt line naming the command", () => {
		const xdg = temp("motion-offline-");
		// Only this test's npm settings reach the child: an inherited npm_config_dry_run (as under `npm publish --dry-run`) would otherwise make `npm ci` succeed.
		const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/iu.test(key)));
		const npm = temp("motion-npm-");
		const npmConfig = { npm_config_registry: "http://127.0.0.1:9/", npm_config_cache: join(npm, "cache"), npm_config_userconfig: join(npm, "npmrc"), npm_config_globalconfig: join(npm, "global-npmrc"), npm_config_fetch_retries: "0", npm_config_offline: "true" };
		const result = spawnSync(process.execPath, [RUNTIME, "install"], { encoding: "utf8", env: { ...inherited, XDG_CACHE_HOME: xdg, ...npmConfig }, timeout: 600000 });
		expect(result.status).toBe(3);
		expect(result.stdout).toMatch(/^\[litcodex\] Motion runtime pre-warm unavailable \(.+\); run `litcodex motion-runtime install` outside the sandbox\.$/mu);
		const bridge = prepareMotionRuntime(temp("motion-codexhome-"));
		expect(bridge.exitCode).toBe(3);
		expect(bridge.receipt).toContain("run `litcodex motion-runtime install` outside the sandbox");
	});
	it("a pre-warm launched from a global npm install runs its npm ci without the inherited global mode", () => {
		const dir = temp("motion-global-");
		const dump = join(dir, "npm-env.json");
		const fakeNpm = join(dir, "fake-npm.mjs");
		writeFileSync(fakeNpm, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(dump)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\nprocess.exit(1);\n`);
		const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/iu.test(key)));
		const npmGlobal = { npm_config_global: "true", npm_config_location: "global", NPM_CONFIG_PREFIX: join(dir, "prefix"), npm_config_dry_run: "true" };
		const result = spawnSync(process.execPath, [RUNTIME, "install"], { encoding: "utf8", env: { ...inherited, ...npmGlobal, XDG_CACHE_HOME: join(dir, "xdg"), npm_execpath: fakeNpm, npm_config_registry: "http://127.0.0.1:9/" }, timeout: 60000 });
		expect(result.status).toBe(3);
		const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string> };
		expect(seen.argv[0]).toBe("ci");
		expect(Object.keys(seen.env).filter((key) => /^npm_config_(global|location|prefix|dry_run)$/iu.test(key))).toEqual([]);
		expect(seen.env["npm_config_registry"]).toBe("http://127.0.0.1:9/");
		expect(seen.env["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"]).toBe("1");
	});
	it("an absent audio venv and a venv whose pins changed both degrade to Tier 1 with the warning", () => {
		const cache = temp("motion-audio-");
		expect(audioState(cache)).toMatchObject({ state: "absent", ready: false });
		expect(audioState(cache).detail).toBe("audio analysis not prewarmed: run litcodex motion-runtime install --audio");
		mkdirSync(join(cache, "audio-venv", "bin"), { recursive: true });
		writeFileSync(join(cache, "audio-venv", "bin", "python"), "");
		writeFileSync(join(cache, "audio-venv", "litcodex-audio.json"), JSON.stringify({ requirementsSha256: "0".repeat(64) }));
		expect(audioState(cache)).toMatchObject({ state: "stale", ready: false });
	});
});

describe("pre-warm from a local fixture mirror (no real network)", { timeout: 300000 }, () => {
	it("installs the pinned dependencies and verified fonts offline", (context) => {
		if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no local npm cache or font mirror");
		const xdg = temp("motion-mirror-");
		const result = node([RUNTIME, "install"], { XDG_CACHE_HOME: xdg, LITCODEX_MOTION_NPM_CACHE: join(FIXTURES, "npm-cache"), LITCODEX_MOTION_FONT_MIRROR: join(FIXTURES, "font-mirror") });
		expect(result.status, result.stdout + result.stderr).toBe(0);
		expect(result.stdout).toContain("[litcodex] Motion runtime ready:");
		const cache = cacheDir({ XDG_CACHE_HOME: xdg } as NodeJS.ProcessEnv);
		expect(readdirSync(join(cache, "fonts")).sort()).toEqual(expect.arrayContaining(["Galmuri9.ttf", "MesloLGS NF Regular.ttf", "licenses"]));
	});
});

describe("blocked states that need Chrome and a pre-warmed cache", { timeout: 600000 }, () => {
	const ready = (context: { skip: (reason: string) => void }) => {
		if (!FIXTURES) {
			context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache");
			return false;
		}
		if (!CHROME) {
			context.skip("Chrome not installed on this host");
			return false;
		}
		return true;
	};
	const xdg = () => join(FIXTURES ?? "", "xdg");
	it("no Chrome exits 10 with the real cause", (context) => {
		if (!ready(context)) return;
		const dir = temp("motion-r10-");
		const result = node([RENDER, "stills", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out")], { XDG_CACHE_HOME: xdg(), CHROME_PATH: "/nonexistent/chrome" });
		expect(result.status).toBe(10);
		expect(result.stderr).toContain("BLOCKED_NO_CHROME");
	});
	it("Chrome running without WebGL2 exits 11 with the launch message", (context) => {
		if (!ready(context)) return;
		const dir = temp("motion-r11-");
		const result = node([RENDER, "stills", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out")], { XDG_CACHE_HOME: xdg(), LITCODEX_MOTION_FAULT: "no-webgl2" });
		if (result.status === 10) return context.skip(`Chrome cannot launch in this test sandbox: ${result.stderr.trim()}`);
		expect(result.status).toBe(11);
		expect(result.stderr).toMatch(/BLOCKED_NO_WEBGL2|no WebGL2 context on any rung/u);
	});
	it("a refused listen takes the CDP-pull fallback and still renders", (context) => {
		if (!ready(context)) return;
		const dir = temp("motion-eperm-");
		const result = node([RENDER, "stills", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out"), "--t", "0.5"], { XDG_CACHE_HOME: xdg(), LITCODEX_MOTION_FAULT: "listen-eperm" });
		if (result.status === 10) return context.skip(`Chrome cannot launch in this test sandbox: ${result.stderr.trim()}`);
		expect(result.status, result.stderr).toBe(0);
		expect(readdirSync(join(dir, "out", "stills")).filter((n) => n.endsWith(".png"))).toHaveLength(1);
	});
	it("video without ffmpeg exits 12 while stills and the sheet exit 0", (context) => {
		if (!ready(context)) return;
		const dir = temp("motion-r12-");
		const env = { XDG_CACHE_HOME: xdg(), PATH: dirname(process.execPath) };
		const stills = node([RENDER, "film", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out"), "--stills-only"], env);
		if (stills.status === 10) return context.skip(`Chrome cannot launch in this test sandbox: ${stills.stderr.trim()}`);
		expect(stills.status, stills.stderr).toBe(0);
		const video = node([RENDER, "video", "--brief", brief(dir), "--treatment", treat(dir), "--out", join(dir, "out")], env);
		expect(video.status).toBe(12);
		expect(video.stderr).toContain("BLOCKED_NO_FFMPEG_FOR_VIDEO");
	});
});
