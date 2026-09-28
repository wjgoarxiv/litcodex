import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { officeRuntimeNotice, officeRuntimeStatus, prepareOfficeRuntime } from "./office-runtime.js";

const roots: string[] = [];
const root = resolve(import.meta.dirname, "../../../../");
const runner = join(root, "plugins/litcodex/skills/lit-pptx/scripts/office-run.mjs");

afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Office runtime boundary", () => {
	it("runtime use is read-only and returns a distinct missing-cache code", () => {
		const cache = mkdtempSync(join(tmpdir(), "lit-office-missing-"));
		roots.push(cache);
		const result = spawnSync(process.execPath, [runner, "pptx", "compile"], {
			encoding: "utf8",
			env: { ...process.env, XDG_CACHE_HOME: cache, PATH: "/usr/bin:/bin" },
		});
		expect(result.status).toBe(78);
		expect(result.stderr).toContain(
			"office runtime not installed; run `npm exec --package @litfamily/litcodex -- litcodex office-runtime install` outside the sandbox or approve network for this one step",
		);
		expect(readdirSync(cache)).toEqual([]);
	});

	it("installer pre-warm and doctor use the same runtime path", () => {
		const home = mkdtempSync(join(tmpdir(), "lit-office-install-"));
		roots.push(home);
		const installedRunner = join(
			home,
			"marketplaces/litcodex/plugins/litcodex/skills/lit-pptx/scripts/office-run.mjs",
		);
		mkdirSync(join(installedRunner, ".."), { recursive: true });
		writeFileSync(installedRunner, "");
		const calls: string[][] = [];
		const spawn = (_command: string, args: readonly string[]) => {
			calls.push([...args]);
			return { status: 0, stdout: '{"pptx":{"ready":true},"docx":{"ready":true}}' };
		};
		expect(prepareOfficeRuntime(home, spawn).ready).toBe(true);
		expect(officeRuntimeStatus(home, spawn).ready).toBe(true);
		expect(calls[0]).toContain("install");
		expect(calls[1]).toContain("doctor");
		const offline = prepareOfficeRuntime(home, () => ({ status: 1, stdout: "" }));
		expect(offline.ready).toBe(false);
		expect(officeRuntimeNotice(offline.ready)).toContain("office-runtime install");
	});

	it("a runtime install launched under global npm config runs its npm ci without the global mode", () => {
		const dir = mkdtempSync(join(tmpdir(), "lit-office-global-"));
		roots.push(dir);
		const base = {
			...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/iu.test(key))),
			XDG_CACHE_HOME: join(dir, "xdg"),
		};
		const doctor = spawnSync(process.execPath, [runner, "doctor"], { encoding: "utf8", env: base });
		const pptxCache = (JSON.parse(doctor.stdout) as { pptx: { cache: string } }).pptx.cache;
		mkdirSync(pptxCache, { recursive: true });
		writeFileSync(join(pptxCache, "python.ready"), "ready\n");
		const dump = join(dir, "npm-env.json");
		const fakeNpm = join(dir, "fake-npm.mjs");
		writeFileSync(
			fakeNpm,
			`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(dump)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\nprocess.exit(1);\n`,
		);
		const npmGlobal = {
			npm_config_global: "true",
			npm_config_location: "global",
			NPM_CONFIG_PREFIX: join(dir, "prefix"),
			npm_config_dry_run: "true",
		};
		const result = spawnSync(process.execPath, [runner, "install"], {
			encoding: "utf8",
			env: { ...base, ...npmGlobal, npm_execpath: fakeNpm, npm_config_registry: "http://127.0.0.1:9/" },
		});
		expect(result.status).toBe(1);
		const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string> };
		expect(seen.argv[0]).toBe("ci");
		expect(
			Object.keys(seen.env).filter((key) => /^npm_config_(global|location|prefix|dry_run)$/iu.test(key)),
		).toEqual([]);
		expect(seen.env["npm_config_registry"]).toBe("http://127.0.0.1:9/");
		expect(seen.env["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"]).toBe("1");
	});

	it("skill guidance forbids substitute OOXML builders and handles renderer aborts", () => {
		for (const skill of ["lit-pptx", "lit-docx"]) {
			const body = readFileSync(join(root, `plugins/litcodex/skills/${skill}/SKILL.md`), "utf8");
			expect(body).toContain("office-runtime install");
			expect(body).toContain("Do not hand-build OOXML or switch to pandoc as a substitute");
			expect(body).toContain("visual thumbnails skipped");
		}
	});
});
