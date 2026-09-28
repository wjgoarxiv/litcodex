import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { motionRouteContext } from "../../components/lit-loop/src/motion-route.js";
import { chromeLadder } from "./engine/runtime.mjs";
import { readFileSync, readdirSync } from "node:fs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const skillsRoot = fileURLToPath(new URL("../", import.meta.url));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const temp = (prefix: string) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	temps.push(dir);
	return dir;
};

describe("main-module guards survive symlinked launches (Build 13)", () => {
	const linked = join(temp("motion-link-"), "linked-skill");
	symlinkSync(skillRoot, linked, "dir");
	it("render.mjs prints its own usage banner through a symlinked directory", () => {
		const result = spawnSync(process.execPath, [join(linked, "scripts", "render.mjs"), "--help"], { encoding: "utf8" });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("lit-typographic-motion render CLI (LitCodex)");
	});
	it("runtime.mjs prints its own usage banner through a symlinked directory", () => {
		const result = spawnSync(process.execPath, [join(linked, "scripts", "runtime.mjs"), "--help"], { encoding: "utf8" });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("lit-typographic-motion runtime (LitCodex)");
	});
	it("render.mjs exits with a usage error, not silently, when given nothing", () => {
		const result = spawnSync(process.execPath, [join(linked, "scripts", "render.mjs")], { encoding: "utf8" });
		expect(result.status).toBe(2);
		expect(result.stdout).toContain("Usage:");
	});
	it("beat-grid.py prints its usage without librosa installed", () => {
		const result = spawnSync("python3", [join(linked, "scripts", "beat-grid.py"), "--help"], { encoding: "utf8" });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("lit-typographic-motion beat grid");
	});
});

describe("route context resolves to the installed render and gate commands (Test 4)", () => {
	it("computes an absolute command under the installed skill and the command answers --help", () => {
		const installed = join(temp("motion-install-"), "codex", "marketplaces", "litcodex", "plugins", "litcodex", "skills");
		mkdirSync(installed, { recursive: true });
		cpSync(join(skillsRoot, "lit-loop"), join(installed, "lit-loop"), { recursive: true });
		cpSync(skillRoot, join(installed, "lit-typographic-motion"), { recursive: true, filter: (src) => !src.includes("/fixtures") && !src.endsWith(".test.ts") });
		const note = motionRouteContext(join(installed, "lit-loop", "SKILL.md"), "make a short video about tide pools lit");
		const commands = [...note.matchAll(/node "([^"]+)" <subcommand>/gu)].map((m) => [m[1] ?? ""] as const);
		expect(commands).toHaveLength(1);
		for (const [script] of commands) {
			expect(realpathSync(script).startsWith(realpathSync(join(installed, "lit-typographic-motion")))).toBe(true);
			const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
			expect(help.status).toBe(0);
			expect(help.stdout).toContain("lit-typographic-motion render CLI (LitCodex)");
		}
		expect(motionRouteContext(join(temp("motion-empty-"), "lit-loop", "SKILL.md"), "make a short video about tide pools lit")).toBe("");
	});
});

describe("Chrome never touches the OS keychain", () => {
	it("puts --use-mock-keychain and --password-store=basic on every launch rung, on every platform", () => {
		for (const platform of ["darwin", "linux", "win32"]) {
			for (const rung of chromeLadder(platform)) expect(rung).toEqual(expect.arrayContaining(["--use-mock-keychain", "--password-store=basic"]));
		}
	});
	it("launches Chrome only through the ladder, in the engine and in every test", () => {
		const driver = readFileSync(join(skillRoot, "engine", "driver.mjs"), "utf8");
		expect(driver).toMatch(/for \(const \[index, rung\] of chromeLadder\(\)\.entries\(\)\)/u);
		expect(driver).toMatch(/const args = fault === "no-webgl2" \? \[\.\.\.rung, /u);
		const runtime = readFileSync(join(skillRoot, "engine", "runtime.mjs"), "utf8");
		expect(runtime).toMatch(/for \(const flags of chromeLadder\(\)\)/u);
		const sources = [...readdirSync(join(skillRoot, "engine")).map((n) => join(skillRoot, "engine", n)), ...readdirSync(join(skillRoot, "scripts")).map((n) => join(skillRoot, "scripts", n)), ...readdirSync(skillRoot).filter((n) => n.endsWith(".test.ts")).map((n) => join(skillRoot, n))];
		for (const file of sources) {
			if (!/\.(mjs|js|ts)$/u.test(file)) continue;
			const text = readFileSync(file, "utf8");
			const launches = (text.match(/launchPersistentContext\(|chromium\.launch\(|--headless/gu) ?? []).length;
			if (file.endsWith("driver.mjs") || file.endsWith("runtime.mjs") || file.endsWith("motion-launch.test.ts")) continue;
			expect(launches, `${file} launches Chrome outside the ladder`).toBe(0);
		}
	});
});
