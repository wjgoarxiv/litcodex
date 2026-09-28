import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_CREDIT } from "./engine/constants.mjs";
import { FETCHED, FONTS, SKILL_ROOT, STROKE_FONTS } from "./engine/fonts.mjs";
import { PRESETS, presetFontKeys } from "./engine/presets.mjs";
import { USAGE } from "./scripts/render.mjs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const COMMIT = "ca251e3dddda422b364385eb484b5a3593a0990d";
const CREDIT = "Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`.";

describe("MO-A-36 / MO-A-48 credit and licences", () => {
	it("ships NOTICE byte-identical to the spec's verbatim MIT text", () => {
		expect(readFileSync(join(skillRoot, "engine", "NOTICE"))).toEqual(readFileSync(join(skillRoot, "fixtures", "notice-mo-a-36.txt")));
		expect(readFileSync(join(skillRoot, "engine", "NOTICE"), "utf8")).toContain(COMMIT);
		expect(ENGINE_CREDIT).toContain(COMMIT);
	});

	it("packs NOTICE, THIRD_PARTY_NOTICES and the EMS licence files", () => {
		const manifest = readFileSync(join(repoRoot, "tools", "pack-payload-manifest.json"), "utf8");
		for (const path of ["engine/NOTICE", "engine/THIRD_PARTY_NOTICES", "fonts/stroke/OFL.txt", "fonts/stroke/CREDITS", "fonts/archivo/OFL.txt", "fonts/vt323/OFL.txt"]) {
			expect(manifest).toContain(`marketplace/plugins/litcodex/skills/lit-typographic-motion/${path}`);
		}
	});

	it("states the one-line credit on the help surfaces", () => {
		expect(USAGE).toContain(CREDIT);
		expect(readFileSync(join(repoRoot, "packages/litcodex-ai/src/cli.ts"), "utf8")).toContain(CREDIT);
	});

	it("lists every font the presets use, with a licence path that exists or is fetched with it", () => {
		const notices = readFileSync(join(skillRoot, "engine", "THIRD_PARTY_NOTICES"), "utf8");
		const used = new Set(Object.values(PRESETS).flatMap((preset) => presetFontKeys(preset)));
		const fetched = new Set(FETCHED.map((item: { path: string }) => item.path));
		for (const key of used) {
			const entry = FONTS.find((f: { key: string }) => f.key === key);
			expect(entry, key).toBeDefined();
			expect(notices, key).toContain(entry.family);
			for (const licence of entry.licence) {
				expect(notices, `${key} licence ${licence}`).toContain(licence.replace(/^.*\/(fonts\/|pretendard-font\/)/u, "$1"));
				if (entry.source === "cache") expect(fetched.has(licence), licence).toBe(true);
				else expect(existsSync(join(SKILL_ROOT, licence)), licence).toBe(true);
			}
		}
		for (const stroke of STROKE_FONTS) expect(existsSync(join(SKILL_ROOT, stroke.file)), stroke.file).toBe(true);
		expect(notices).toContain("fonts/stroke/CREDITS");
	});

	it("fetches MesloLGS NF with all three licence texts and pins every fetched byte", () => {
		const paths = FETCHED.map((item: { path: string }) => item.path);
		expect(paths).toEqual(expect.arrayContaining(["fonts/licenses/MesloLGS-NF-License.txt", "fonts/licenses/Apache-2.0.txt", "fonts/licenses/DejaVu-LICENSE.txt", "fonts/licenses/Galmuri-ofl.md"]));
		for (const item of FETCHED) {
			expect(item.url).toMatch(/^https:\/\//u);
			expect(item.url).not.toMatch(/\/(main|master)\//u);
			expect(item.sha256).toMatch(/^[0-9a-f]{64}$/u);
		}
	});

	it("keeps bundled fonts under 1 MB each and 4 MB together, and never bundles a Galmuri bitmap or Hershey face", () => {
		let total = 0;
		for (const entry of FONTS.filter((f: { source: string }) => f.source === "bundled")) {
			const bytes = readFileSync(join(SKILL_ROOT, entry.path)).length;
			expect(bytes, entry.path).toBeLessThanOrEqual(1_000_000);
			total += bytes;
		}
		for (const stroke of STROKE_FONTS) total += readFileSync(join(SKILL_ROOT, stroke.file)).length;
		expect(total).toBeLessThanOrEqual(4_000_000);
		expect(JSON.stringify([FONTS, STROKE_FONTS, FETCHED])).not.toMatch(/Bitmap|Hershey|DotGothic/u);
	});

	it("never pins a licence-forbidden analyser in the audio tier (MO-A-50)", () => {
		const requirements = readFileSync(join(skillRoot, "runtime", "requirements-audio.txt"), "utf8")
			.split("\n")
			.filter((line) => /^[a-z]/iu.test(line));
		expect(requirements.join("\n")).not.toMatch(/aubio|essentia|madmom/iu);
		expect(requirements.some((line) => line.startsWith("librosa=="))).toBe(true);
		const pins = JSON.parse(readFileSync(join(skillRoot, "runtime", "word-timing-models.json"), "utf8"));
		expect(pins.models).toEqual([]);
	});
});
