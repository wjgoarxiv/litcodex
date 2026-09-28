import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT } from "./engine/constants.mjs";
import { encodePng } from "./engine/image.mjs";
import { stageTreatment } from "./fixtures/treatments.mjs";

// Look rounds and Done (director brief section 9). The receipts are built on disk the way the
// renderer writes them; one test renders for real to prove the viewed count survives a gate re-run.
const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const RENDER = join(skillRoot, "scripts", "render.mjs");
const FIXTURES = process.env.LITCODEX_MOTION_TEST_FIXTURES;
const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => existsSync(p));
const temps: string[] = [];
afterAll(() => {
	for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const cli = (args: string[]) => spawnSync(process.execPath, [RENDER, ...args], { encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: join(FIXTURES ?? "/nonexistent", "xdg") }, timeout: 600000 });

const FILES = ["beat-01.png", "beat-02.png", "beat-03.png", "cut-01-02.png", "cut-02-03.png", "contact-sheet.png", "poster.png"];
/** Write a stills set the way the renderer does; returns the manifest's sha256. */
function writeStills(out: string, kind: string, round: number, salt: string) {
	const dir = join(out, "stills");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const files = FILES.map((file, i) => {
		const png = Buffer.from(encodePng(2, 2, new Uint8Array(16).fill(i + salt.length), 4, 1));
		writeFileSync(join(dir, file), png);
		return { file, sha256: sha(png), kind: file.startsWith("beat") ? "beat" : file.startsWith("cut") ? "strip" : file === "poster.png" ? "poster" : "sheet", frames: [i] };
	});
	const text = `${JSON.stringify({ schema: 1, kind, round, salt, files }, null, 2)}\n`;
	writeFileSync(join(dir, "manifest.json"), text);
	writeFileSync(join(out, "sound-cues.json"), JSON.stringify({ cues: [] }));
	return sha(text);
}
/** A finished full render at `round`: gate PASS, exports present, stills from this render. */
function fullRender(out: string, round: number, salt = `render-${round}`) {
	const stillsSha = writeStills(out, "render", round, salt);
	for (const name of ["film.mp4", "preview.webp", "poster.png", "reduced-motion.png"]) writeFileSync(join(out, name), "x");
	writeFileSync(join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, path: "stage", round, stillsManifestSha256: stillsSha }));
	writeFileSync(join(out, "gate-report.txt"), "lit-typographic-motion — stage render report\n\nQA gate: PASS\n");
	writeFileSync(join(out, "sound-cues.json"), JSON.stringify({ cues: [] }));
	return stillsSha;
}
function run(treatment = stageTreatment({ durationSec: 12, beats: [[0, 4], [4, 8], [8, 12]] })) {
	const out = join(realpathSync(mkdtempSync(join(tmpdir(), "motion-look-"))), "out");
	temps.push(join(out, ".."));
	mkdirSync(join(out, ".run"), { recursive: true });
	writeFileSync(join(out, "treatment.json"), JSON.stringify(treatment, null, 2));
	writeFileSync(join(out, ".run", "treatment-first.json"), JSON.stringify(treatment, null, 2));
	const past = new Date(Date.now() - 60000);
	utimesSync(join(out, "treatment.json"), past, past);
	return out;
}
const observed = (file: string, detail: string) => `In ${file} the ${detail} is clearly visible against the dark ground.`;
function answers(extra: Record<string, unknown> = {}, verdicts: Record<number, string> = {}) {
	const good: Record<number, string> = { 1: "yes", 2: "yes", 3: "yes", 4: "no", 5: "yes", 6: "yes", 7: "no", 8: "no", 9: "no" };
	return {
		viewed: FILES,
		answers: Array.from({ length: 9 }, (_, i) => {
			const q = i + 1;
			const frame = q === 6 ? "sound-cues.json" : q === 1 ? "contact-sheet.png" : FILES[i % FILES.length];
			return { q, verdict: verdicts[q] ?? good[q], frame, observed: q === 1 ? "A stranger would say this film is for: people walking the coast who want to see the basin fill." : observed(frame, `drawn basin in answer ${q}`) };
		}),
		...extra,
	};
}
function look(out: string, round: number, body: Record<string, unknown>) {
	const file = join(out, `answers-${round}.json`);
	writeFileSync(file, JSON.stringify(body));
	return cli(["look", "--out", out, "--round", String(round), "--answers", file]);
}
const done = (out: string) => cli(["completion", "--out", out]);

describe("look rounds", () => {
	it("refuses a frame that is not in the latest stills set", () => {
		const out = run();
		writeStills(out, "stills-only", 1, "a");
		const result = look(out, 1, answers({ viewed: [...FILES, "beat-09.png"], weakestBeat: 2, change: "moved the basin lower" }));
		expect(result.status).toBe(EXIT.USAGE);
		expect(result.stderr).toContain("beat-09.png");
	});
	it("refuses a bare yes/no observation and a round 1 without the weakest beat and its change", () => {
		const out = run();
		writeStills(out, "stills-only", 1, "a");
		const bare = answers({ weakestBeat: 2, change: "moved the basin lower" });
		bare.answers[2].observed = "yes";
		expect(look(out, 1, bare).status).toBe(EXIT.USAGE);
		expect(look(out, 1, answers()).stderr).toMatch(/weakest beat|change/u);
	});
	it("stamps each round with the manifest and frame hashes", () => {
		const out = run();
		const manifestSha = writeStills(out, "stills-only", 1, "a");
		expect(look(out, 1, answers({ weakestBeat: 2, change: "moved the basin lower" })).status).toBe(0);
		const record = JSON.parse(readFileSync(join(out, "look.json"), "utf8"));
		expect(record.rounds[0].manifestSha256).toBe(manifestSha);
		expect(Object.keys(record.rounds[0].frames)).toEqual(expect.arrayContaining(FILES));
	});
});

describe("done", () => {
	it("a gate PASS with no look is not done", () => {
		const out = run();
		fullRender(out, 1);
		expect(done(out).stdout).toMatch(/not complete/u);
	});
	it("a single round is not done", () => {
		const out = run();
		writeStills(out, "stills-only", 1, "a");
		look(out, 1, answers({ weakestBeat: 2, change: "moved the basin lower" }));
		fullRender(out, 2);
		const result = done(out);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/2 look rounds/u);
	});
	it("a last round against an older render is not done", () => {
		const out = run();
		writeStills(out, "stills-only", 1, "a");
		look(out, 1, answers({ weakestBeat: 2, change: "moved the basin lower" }));
		fullRender(out, 2);
		look(out, 2, answers());
		fullRender(out, 3, "changed-after-the-look");
		expect(done(out).stdout).toMatch(/not complete .*final render/u);
	});
	it("a full receipt is done", () => {
		const out = run();
		writeStills(out, "stills-only", 1, "a");
		expect(look(out, 1, answers({ weakestBeat: 2, change: "moved the basin lower" })).status).toBe(0);
		fullRender(out, 2);
		expect(look(out, 2, answers()).status).toBe(0);
		const result = done(out);
		expect(result.stdout, result.stderr).toMatch(/completion: complete/u);
		expect(result.status).toBe(0);
	});
	it("a no on a craft question needs another round until round 3, then delivers with the open item", () => {
		const out = run();
		writeStills(out, "stills-only", 1, "a");
		look(out, 1, answers({ weakestBeat: 2, change: "moved the basin lower" }));
		fullRender(out, 2);
		look(out, 2, answers({}, { 3: "no" }));
		expect(done(out).stdout).toMatch(/not complete .*another round/u);
		fullRender(out, 3);
		look(out, 3, answers({}, { 3: "no" }));
		const result = done(out);
		expect(result.stdout).toMatch(/completion: complete/u);
		expect(result.stdout).toMatch(/open look items: .*3/u);
	});
	it("records a downgrade against the first valid treatment", () => {
		const out = run();
		const shorter = stageTreatment({ durationSec: 8, beats: [[0, 2.6], [2.6, 5.3], [5.3, 8]] });
		writeFileSync(join(out, "treatment.json"), JSON.stringify({ ...shorter, channel: "a muted autoplay feed", sound: { mode: "none" } }));
		const past = new Date(Date.now() - 60000);
		utimesSync(join(out, "treatment.json"), past, past);
		writeStills(out, "stills-only", 1, "a");
		look(out, 1, answers({ weakestBeat: 2, change: "moved the basin lower" }));
		fullRender(out, 2);
		look(out, 2, answers());
		const result = done(out);
		expect(result.stdout).toMatch(/downgraded: .*durationSec/u);
		expect(result.stdout).toMatch(/downgraded: .*sound/u);
	});
	it("reports DONE_UNVIEWED when no image tool was reachable", () => {
		const out = run();
		fullRender(out, 1);
		expect(look(out, 1, { blocked: "no-vision-tool" }).status).toBe(0);
		const result = done(out);
		expect(result.stdout).toMatch(/DONE_UNVIEWED/u);
		expect(result.stdout).toMatch(/nobody viewed the frames/u);
	});
});

describe("viewed counts survive a gate re-run", { timeout: 900000 }, () => {
	it("the report's viewed count comes from look.json and a gate re-run keeps it", (context) => {
		if (!FIXTURES) return context.skip("LITCODEX_MOTION_TEST_FIXTURES not set: no pre-warmed cache");
		if (!CHROME) return context.skip("Chrome not installed on this host");
		const out = run(stageTreatment());
		mkdirSync(join(out, "stage"), { recursive: true });
		cpSync(join(skillRoot, "fixtures", "stage", "qa-good"), join(out, "stage"), { recursive: true });
		const namesOf = () => JSON.parse(readFileSync(join(out, "stills", "manifest.json"), "utf8")).files.map((f: { file: string }) => f.file);
		const bodyFor = (names: string[], extra: Record<string, unknown> = {}) => {
			const body = answers({ viewed: names, ...extra });
			for (const a of body.answers) if (a.frame !== "sound-cues.json") a.frame = names[0];
			return body;
		};
		expect(cli(["stage", "--out", out, "--stills-only", "--round", "1"]).status).toBe(0);
		expect(look(out, 1, bodyFor(namesOf(), { weakestBeat: 2, change: "raised the label" })).status).toBe(0);
		expect(cli(["stage", "--out", out, "--round", "2"]).status).toBe(0);
		const names = namesOf();
		expect(look(out, 2, bodyFor(names)).status).toBe(0);
		expect(cli(["gate", "--out", out]).status).toBe(0);
		expect(readFileSync(join(out, "gate-report.txt"), "utf8")).toContain(`frames actually viewed this run: ${names.length}`);
		expect(cli(["gate", "--out", out]).status).toBe(0);
		expect(readFileSync(join(out, "gate-report.txt"), "utf8")).toContain(`frames actually viewed this run: ${names.length}`);
	});
});
