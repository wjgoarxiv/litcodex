// The MO-C-17 render report, verbatim in structure, followed by one line each for MO-C-25, 26, 27,
// 29, MO-D-02, 03, 04 and then every other enforced Section A/B rule in Rule-index order.
import { MAX_ROUNDS } from "./constants.mjs";

const pad = (label, width = 30) => `  ${label}`.padEnd(width + 2);
const ORDER_AFTER_C14 = ["MO-C-25", "MO-C-26", "MO-C-27", "MO-C-29", "MO-D-02", "MO-D-03", "MO-D-04"];
const INDEX_ORDER = ["MO-A-04", "MO-A-13", "MO-A-15", "MO-A-16", "MO-A-25", "MO-A-33", "MO-A-35", "MO-A-37..41", "MO-A-41a", "MO-A-51", "MO-A-58", "MO-SH-00", "MO-SH-00a", "MO-SH-01", "MO-SH-03", "MO-SH-04a", "MO-SH-05", "MO-SH-06", "MO-SH-07", "MO-SH-08", "MO-SH-09", "MO-SH-10", "MO-SH-11", "MO-FT-04", "MO-FT-05", "MO-FT-08"];

const tag = (r) => (r?.provisional ? " [provisional]" : "");
const status = (r) => r?.status ?? "NOT RUN";

export function renderReport({ manifest, rules, outputs, presetReason, round, framesViewed = 0, withheld = false, notes = [], stage = "full" }) {
	const by = new Map(rules.map((r) => [r.id, r]));
	const lines = ["lit-typographic-motion — render report"];
	lines.push(`outputs: ${outputs.mp4} · ${outputs.preview} (encoder: ${manifest.previewEncoder ?? "none"}) · ${outputs.poster} · ${outputs.still}`);
	lines.push(`preset: ${manifest.presetId}  (chosen because: ${presetReason})`);
	lines.push(`duration / fps / resolution: ${manifest.durationSec} s @ ${manifest.fps} fps, ${manifest.resolution[0] * manifest.scale}x${manifest.resolution[1] * manifest.scale}`);
	lines.push(`GLSL passes (manifest): ${(manifest.passRanges ?? []).map((e) => `${e.pass}@${e.sceneId}#${e.shotIndex}:${e.frameStart}-${e.frameEnd}`).join(", ") || "none"}`);
	lines.push(`WebGL2: ${manifest.softwareRenderer ? "software" : "hardware"} — ${manifest.renderer ?? "not launched"}  (flags: ${(manifest.chromeFlags ?? []).join(" ")})${manifest.softwareRenderer ? "  software-rendered, --samples lowered" : ""}`);
	lines.push("");
	const failed = rules.some((r) => r.status === "FAIL");
	lines.push(`QA gate: ${failed ? "FAIL" : "PASS"}${stage === "preflight" ? "  (pre-flight; nothing rendered)" : ""}${withheld ? "  (render withheld: exports moved to withheld/ as diagnostics, not deliverables)" : ""}`);
	const c03 = by.get("MO-C-03");
	const c04 = by.get("MO-C-04");
	const c06 = by.get("MO-C-06");
	const c07 = by.get("MO-C-07");
	const c08 = by.get("MO-C-08");
	lines.push(`${pad("MO-C-01 GLSL presence:")}${status(by.get("MO-C-01"))}`);
	lines.push(`${pad("MO-C-02 WebGL2 tier:")}${status(by.get("MO-C-02"))}`);
	lines.push(`${pad("MO-C-03 flash audit:")}${c03 ? c03.detail.replace(/^/, "") : "NOT RUN"}${c03 ? `  ${c03.status}` : ""}`);
	lines.push(`${pad("MO-C-04 title-safe:")}${status(c04)}${c04?.status === "FAIL" ? `  (violations: ${c04.detail})` : ""}`);
	lines.push(`${pad("MO-C-05 action-safe:")}${status(by.get("MO-C-05"))}${tag(by.get("MO-C-05"))}${by.get("MO-C-05")?.status === "FAIL" ? `  (${by.get("MO-C-05").detail})` : ""}`);
	lines.push(`${pad("MO-C-06 type contrast:")}${c06 ? (c06.minContrast ? `min ratio ${c06.minContrast.ratio.toFixed(1)}:1 at frame ${c06.minContrast.frame}  (floor ${c06.minContrast.floor.toFixed(1)}:1)` : c06.detail) : "NOT RUN"}  ${status(c06)}${tag(c06)}`);
	lines.push(`${pad("MO-C-07/08 reading time:")}${c07?.tightest ? `tightest unit ${c07.tightest}` : c07?.detail ?? "NOT RUN"}  ${c07 && c08 ? (c07.status === "FAIL" || c08.status === "FAIL" ? "FAIL" : "PASS") : ""}${tag(c07)}${c08?.status === "FAIL" ? `  (${c08.detail})` : ""}`);
	lines.push(`${pad("MO-C-09 determinism:", 29)} ${by.get("MO-C-09")?.detail ?? "NOT RUN"}  ${status(by.get("MO-C-09"))}`);
	lines.push(`${pad("MO-C-10/11/12 duration/fps/res:", 31)}${status(by.get("MO-C-10/11/12"))}  (${by.get("MO-C-10/11/12")?.detail ?? "not probed"})`);
	lines.push(`${pad("MO-C-13 file sizes:")}${by.get("MO-C-13")?.detail ?? "NOT RUN"}  ${status(by.get("MO-C-13"))}${tag(by.get("MO-C-13"))}`);
	lines.push(`${pad("MO-C-14 reduced-motion still:")}${by.get("MO-C-14")?.detail ?? "NOT RUN"}${tag(by.get("MO-C-14"))}`);
	for (const id of ORDER_AFTER_C14) {
		const r = by.get(id);
		lines.push(`${pad(`${id} ${r?.name ?? ""}:`)}${status(r)}  ${r?.detail ?? ""}${tag(r)}`);
	}
	for (const id of INDEX_ORDER) {
		const r = by.get(id);
		if (r) lines.push(`${pad(`${id} ${r.name}:`)}${r.status}  ${r.detail}${tag(r)}`);
	}
	for (const r of rules.filter((x) => x.id.startsWith("SOUND-"))) lines.push(`${pad(`${r.id} ${r.name}:`)}${r.status}  ${r.detail}`);
	lines.push("");
	lines.push(`craft rounds run: ${round} / ${MAX_ROUNDS} max`);
	lines.push(`frames actually viewed this run: ${framesViewed} (confirmed looked, not just rendered)`);
	lines.push("");
	lines.push("notes:");
	lines.push("  [provisional] marks the spec's [NEW] numbers, implemented as written and unchanged in this release.");
	for (const note of notes) lines.push(`  ${note}`);
	return `${lines.join("\n")}\n`;
}
