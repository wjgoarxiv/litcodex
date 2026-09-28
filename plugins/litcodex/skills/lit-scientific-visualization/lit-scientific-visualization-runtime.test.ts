import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { runUserPromptSubmitHook } from "../../components/lit-loop/src/codex-hook.js";

const SKILL_ROOT = fileURLToPath(new URL("./", import.meta.url));
const VENDOR_ROOT = fileURLToPath(new URL("../../vendor/scientific-visualization/", import.meta.url));
const EXPECTED_MANIFEST = "b1b8f1bf8791daecdbb00dc70631cd955e72976664d302af0bc81e218b9cec3b";

describe("lit-scientific-visualization runtime integration", () => {
	it("keeps non-exact scientific visualization prompts outside UserPromptSubmit activation", () => {
		for (const prompt of [
			"scientific-visualization",
			"$litcodex:lit-scientific-visualization",
			"please use scientific visualization",
			"please lit-scientific-visualization",
			"`lit-scientific-visualization`",
		]) {
			expect(runUserPromptSubmitHook({ hook_event_name: "UserPromptSubmit", prompt }).kind, prompt).toBe("noop");
		}
	});

	it("preflights exact payload and package-local helper imports without environment mutation", () => {
		const script = `${SKILL_ROOT}scripts/dependency-preflight.py`;
		const source = readFileSync(script, "utf8");
		for (const mutation of ["pip install", "conda install", "subprocess", "os.system"])
			expect(source.toLowerCase()).not.toContain(mutation);

		const result = spawnSync("python3", [script, "--json"], { encoding: "utf8" });
		expect([0, 3]).toContain(result.status);
		const report = JSON.parse(result.stdout) as {
			readonly status: "ready" | "degraded";
			readonly core: { readonly matplotlib: boolean };
			readonly sourceRoot: string;
			readonly scriptsRoot: string;
			readonly assetsRoot: string;
			readonly helperImportPolicy: string;
			readonly helperImports: Readonly<Record<string, boolean>>;
			readonly helperImportSkipped: readonly string[];
			readonly helperImportErrors: Readonly<Record<string, string>>;
			readonly sourceManifest: string;
			readonly sourcePayloadComplete: boolean;
			readonly missingSource: readonly string[];
			readonly unexpectedSource: readonly string[];
			readonly hashMismatches: readonly string[];
			readonly missingOptional: readonly string[];
		};
		expect(report.status).toBe(report.core.matplotlib ? "ready" : "degraded");
		expect(report.sourceRoot).toContain("vendor/scientific-visualization");
		expect(report.scriptsRoot).toBe(`${report.sourceRoot}/scripts`);
		expect(report.assetsRoot).toBe(`${report.sourceRoot}/assets`);
		expect(report.helperImports["color_palettes"]).toBe(true);
		expect(report.helperImports["style_presets"]).toBe(report.core.matplotlib);
		expect(report.helperImports["figure_export"]).toBe(report.core.matplotlib);
		expect(report.helperImportSkipped).toEqual(report.core.matplotlib ? [] : ["style_presets", "figure_export"]);
		expect(report.helperImportErrors).toEqual({});
		expect(report.helperImportPolicy).toContain("bytecode disabled");
		expect(report.sourceManifest).toBe(EXPECTED_MANIFEST);
		expect(report.sourcePayloadComplete).toBe(true);
		expect(report.missingSource).toEqual([]);
		expect(report.unexpectedSource).toEqual([]);
		expect(report.hashMismatches).toEqual([]);
		expect(Array.isArray(report.missingOptional)).toBe(true);
	});

	it("fails closed before helper imports on an unexpected pyc or source drift", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-science-preflight-"));
		try {
			const copiedPluginRoot = join(root, "plugins/litcodex");
			const copiedSkill = join(copiedPluginRoot, "skills/lit-scientific-visualization");
			const copiedVendor = join(copiedPluginRoot, "vendor/scientific-visualization");
			cpSync(SKILL_ROOT, copiedSkill, { recursive: true });
			cpSync(VENDOR_ROOT, copiedVendor, { recursive: true });
			const copiedScript = join(copiedSkill, "scripts/dependency-preflight.py");
			const pycPath = join(
				copiedVendor,
				"__pycache__/rogue.pyc",
			);
			mkdirSync(join(pycPath, ".."), { recursive: true });
			writeFileSync(pycPath, "rogue", { flag: "wx" });
			const unexpected = spawnSync("python3", [copiedScript, "--json"], { encoding: "utf8" });
			expect(unexpected.status).toBe(3);
			const unexpectedReport = JSON.parse(unexpected.stdout) as {
				readonly sourcePayloadComplete: boolean;
				readonly unexpectedSource: readonly string[];
				readonly helperImports: Readonly<Record<string, boolean>>;
				readonly helperImportSkipped: readonly string[];
			};
			expect(unexpectedReport.sourcePayloadComplete).toBe(false);
			expect(unexpectedReport.unexpectedSource).toEqual(["__pycache__/rogue.pyc"]);
			expect(Object.values(unexpectedReport.helperImports)).toEqual([false, false, false]);
			expect(unexpectedReport.helperImportSkipped).toEqual([
				"color_palettes",
				"style_presets",
				"figure_export",
			]);

			rmSync(join(copiedVendor, "__pycache__"), {
				recursive: true,
				force: true,
			});
			writeFileSync(
				join(copiedVendor, "SKILL.md"),
				"tampered",
			);
			const tampered = spawnSync("python3", [copiedScript, "--json"], { encoding: "utf8" });
			expect(tampered.status).toBe(3);
			const tamperedReport = JSON.parse(tampered.stdout) as {
				readonly sourceManifest: string;
				readonly sourcePayloadComplete: boolean;
				readonly hashMismatches: readonly string[];
				readonly helperImports: Readonly<Record<string, boolean>>;
			};
			expect(tamperedReport.sourcePayloadComplete).toBe(false);
			expect(tamperedReport.hashMismatches).toEqual(["SKILL.md"]);
			expect(tamperedReport.sourceManifest).not.toBe(EXPECTED_MANIFEST);
			expect(Object.values(tamperedReport.helperImports)).toEqual([false, false, false]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
