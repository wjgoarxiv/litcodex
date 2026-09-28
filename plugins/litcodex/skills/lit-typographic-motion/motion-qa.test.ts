import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { isProductFamily } from "./engine/stage-qa.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// DOM text QA on the stage path (director brief 6g), in its own replay Chrome. Renders need Chrome
// and a pre-warmed fixture cache and skip with the reason printed otherwise.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const PAGES = join(skillRoot, "fixtures", "stage");
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
function renderPage(page: string, treatment: ReturnType<typeof stageTreatment>, html: string | null = null) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "motion-qa-")));
	temps.push(dir);
	const out = join(dir, "out");
	mkdirSync(join(out, "stage"), { recursive: true });
	if (html) writeFileSync(join(out, "stage", "index.html"), html);
	else cpSync(join(PAGES, page), join(out, "stage"), { recursive: true });
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	const result = spawnSync(process.execPath, [RENDER, "stage", "--out", out], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "", "xdg") }, timeout: 600000 });
	const report = existsSync(join(out, "gate-report.txt")) ? readFileSync(join(out, "gate-report.txt"), "utf8") : "";
	return { out, result, report };
}
const line = (report: string, id: string) => report.split("\n").find((l) => l.trimStart().startsWith(`${id} `)) ?? "";

describe("product faces by their platform family names", () => {
	it("accepts every internal family name the bundled and cached faces report", () => {
		for (const name of ["Archivo", "Archivo Black", "Archivo Condensed", "Archivo Condensed Black", "Archivo Expanded", "Archivo Expanded Black", "Pretendard GOV", "PretendardGOV", "VT323", "Galmuri9 Regular", "MesloLGS NF"]) expect(isProductFamily(name), name).toBe(true);
	});
	it("rejects system fallbacks", () => {
		for (const name of ["Helvetica", "Times", "Apple SD Gothic Neo", "Menlo", "Arial"]) expect(isProductFamily(name), name).toBe(false);
	});
});

describe("DOM text QA on real Chrome", { timeout: 900000 }, () => {
	it("fails low-contrast, off-safe and too-short copy, a decor run that carries copy, and warns on labels, canvas text and moved state", (context) => {
		if (!ready(context)) return;
		const lines = ["Quiet harbor", "Edge of frame", "Blink line"];
		const { result, report } = renderPage("qa-bad", stageTreatment({ lines }));
		expect(result.status, result.stderr).toBe(EXIT.GATE_FAIL_QA);
		expect(line(report, "QA-CONTRAST")).toMatch(/FAIL .*Quiet harbor/u);
		expect(line(report, "QA-TITLE-SAFE")).toMatch(/FAIL .*Edge of frame/u);
		expect(line(report, "QA-READING")).toMatch(/FAIL .*Blink line/u);
		expect(line(report, "QA-DECOR")).toMatch(/FAIL .*Quiet harbor/u);
		expect(line(report, "QA-META")).toMatch(/WARN .*treatment beat 2/u);
		expect(line(report, "QA-CANVAS")).toMatch(/WARN .*canvas text not measured/u);
		expect(line(report, "QA-STATE")).toMatch(/WARN/u);
		expect(line(report, "QA-FONTS")).toMatch(/PASS/u);
	});
	it("holds decor text only to the decor rules and passes a clean page", (context) => {
		if (!ready(context)) return;
		const { result, report } = renderPage("qa-good", stageTreatment());
		expect(result.status, result.stderr).toBe(0);
		expect(line(report, "QA-CONTRAST")).toMatch(/WARN .*NORTH BASIN 3/u);
		for (const id of ["QA-TITLE-SAFE", "QA-READING", "QA-COPY", "QA-DECOR", "QA-PRESENCE"]) expect(line(report, id), id).toMatch(/PASS/u);
		expect(line(report, "QA-TITLE-SAFE")).toContain("[96,54]-[1824,1026]");
	});
	it("exits 17 quoting a copy line that never appears on screen", (context) => {
		if (!ready(context)) return;
		const { result } = renderPage("qa-good", stageTreatment({ lines: ["Tide pool at noon", "Low water by three"] }));
		expect(result.status, result.stderr).toBe(EXIT.STAGE_CONTRACT_ERROR);
		expect(result.stderr).toContain('"Low water by three"');
	});
	it("uses a portrait title-safe box on a 9:16 film", (context) => {
		if (!ready(context)) return;
		const { result, report } = renderPage("portrait", stageTreatment({ format: "9:16", lines: ["Leaf to lantern"] }));
		expect(result.status, result.stderr).toBe(0);
		expect(line(report, "QA-TITLE-SAFE")).toContain("[54,96]-[1026,1824]");
	});
});
