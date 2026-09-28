import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evaluateCompletion } from "./engine/completion.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// The Wave 1 "not done" states stay not done. A finished render is no longer done on the gate
// alone: the look receipt is required (motion-look.test.ts covers the done cases).
const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const EXPORTS = ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"];

function run({ report = "PASS", round = 1, flash = false, exportsAt = "out", treatmentNewer = false, preflight = false, manifest = true } = {}) {
	const out = mkdtempSync(join(tmpdir(), "motion-done-"));
	dirs.push(out);
	mkdirSync(join(out, ".run"));
	writeFileSync(join(out, "treatment.json"), JSON.stringify(stageTreatment()));
	if (manifest) {
		writeFileSync(join(out, "manifest.json"), JSON.stringify({ round, path: "stage", stillsManifestSha256: "0" }));
		writeFileSync(join(out, "gate-report.txt"), `lit-typographic-motion — render report\n\nQA gate: ${report}${preflight ? "  (pre-flight; nothing rendered)" : ""}${flash ? "  (render withheld: exports moved to withheld/ as diagnostics, not deliverables)" : ""}\n  MO-C-03 flash audit:          worst window ${flash ? 5 : 0} general / 0 red (limit 3 / 3)  ${flash ? "FAIL" : "PASS"}\n`);
	}
	if (exportsAt !== "none") {
		const dir = exportsAt === "withheld" ? join(out, "withheld") : out;
		mkdirSync(dir, { recursive: true });
		for (const name of EXPORTS) writeFileSync(join(dir, name), "x");
	}
	const old = new Date(Date.now() - 60_000);
	const future = new Date(Date.now() + 60_000);
	utimesSync(join(out, "treatment.json"), treatmentNewer ? future : old, treatmentNewer ? future : old);
	return out;
}

describe("a film turn is not done without a verified render and a look receipt", () => {
	it.each([
		["a started command (no manifest yet)", { manifest: false, exportsAt: "none" }],
		["a --stills-only run", { manifest: false, exportsAt: "none" }],
		["a BLOCKED exit 10 or 14 (nothing rendered)", { manifest: false, exportsAt: "none" }],
		["a manifest older than the last treatment edit", { treatmentNewer: true }],
		["a pre-flight stop", { report: "FAIL", preflight: true, exportsAt: "none" }],
		["exit 13 before round 3", { report: "FAIL", round: 2 }],
		["a flash FAIL with exports at the deliverable names", { report: "FAIL", round: 3, flash: true, exportsAt: "out" }],
		["gate PASS with the manifest and four exports but no look rounds", {}],
		["round 3 with exports delivered but no look rounds", { report: "FAIL", round: 3 }],
	])("is not done: %s", (_label, options) => {
		expect(evaluateCompletion(run(options as never)).complete).toBe(false);
	});
	it("is not done when the gate report is missing", () => {
		const out = run();
		rmSync(join(out, "gate-report.txt"));
		expect(evaluateCompletion(out).complete).toBe(false);
	});
});
