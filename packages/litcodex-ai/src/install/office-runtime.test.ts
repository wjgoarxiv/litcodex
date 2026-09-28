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

	it("skill guidance forbids substitute OOXML builders and handles renderer aborts", () => {
		for (const skill of ["lit-pptx", "lit-docx"]) {
			const body = readFileSync(join(root, `plugins/litcodex/skills/${skill}/SKILL.md`), "utf8");
			expect(body).toContain("office-runtime install");
			expect(body).toContain("Do not hand-build OOXML or switch to pandoc as a substitute");
			expect(body).toContain("visual thumbnails skipped");
		}
	});
});
