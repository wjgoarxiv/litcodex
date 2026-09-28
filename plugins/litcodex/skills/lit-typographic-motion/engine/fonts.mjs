// Font catalogue: where every face the presets use comes from, its pinned sha256, and its licence.
// Bundled faces ship in this skill; reused faces are LitCodex's own lit-pptx Hangul pair, checked
// against LitCodex's recorded hashes (MO-A-55); fetched faces arrive only through
// `litcodex motion-runtime install` and are read from the product cache (MO-A-42, MO-FT-03a).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PPTX_FONTS = "../lit-pptx/pretendard-font";

const archivo = [75, 100, 125].flatMap((width) =>
	[400, 700, 900].map((weight) => ({
		key: `archivo-w${width}-${weight}`,
		family: "Archivo",
		width,
		weight,
		source: "bundled",
		path: `fonts/archivo/Archivo-w${width}-wt${weight}.ttf`,
		licence: ["fonts/archivo/OFL.txt"],
	})),
);
const ARCHIVO_SHA = {
	"archivo-w75-400": "4dc4b1a99bdeae009897c761bce7e1143efff543525bde91020d4493e33921ba",
	"archivo-w75-700": "55424d853a7b020ccf975fa40a6c9e05d817529c8721e7af6d009fd25c907fc7",
	"archivo-w75-900": "8726c4b11823235e452e53d2f1edcb7f6a8357497ca8a60c3c97ba837bd665ec",
	"archivo-w100-400": "bb6a38015aa4f22aaa7eb0b11aae2fd91a0fab1cb9affaed260ee984c3723e6f",
	"archivo-w100-700": "7e32f8857f5f4744781d501fd83afbc0587996bff3c2b78c0ed179a42fa51c94",
	"archivo-w100-900": "b83eae2d3a2ec48a4fe5d3e34f9bb6653d2182cb998b7a99af231dd07ee54fcd",
	"archivo-w125-400": "608ae8fd89513d91c22e88e45b418d2a29589f32dc9bc5373105e602369c5d09",
	"archivo-w125-700": "1858ad005ef543cccaba015e2c46cd8001771bc2132b1d1f23123dca2a0c1583",
	"archivo-w125-900": "f7f74623bee69fa2de1efe7d3fe25c2e8856fc3e0c62d7a86a2e36c7608462d0",
};

export const FONTS = Object.freeze([
	...archivo.map((entry) => ({ ...entry, sha256: ARCHIVO_SHA[entry.key] })),
	{
		key: "pretendard-400",
		family: "PretendardGOV",
		weight: 400,
		source: "reuse",
		path: `${PPTX_FONTS}/public/static/PretendardGOV-Regular.otf`,
		sha256: "90cba0940a9f9719be561238dca3773ab9810a2ce1842f781cfad624e137ded0",
		licence: [`${PPTX_FONTS}/LICENSE.txt`],
	},
	{
		key: "pretendard-700",
		family: "PretendardGOV",
		weight: 700,
		source: "reuse",
		path: `${PPTX_FONTS}/public/static/PretendardGOV-Bold.otf`,
		sha256: "9ff5e6551c0e11bb4e433f9d7a6a74c563b977a6caa523eb19249c0a4072ca86",
		licence: [`${PPTX_FONTS}/LICENSE.txt`],
	},
	{
		key: "vt323",
		family: "VT323",
		weight: 400,
		source: "bundled",
		path: "fonts/vt323/VT323-Regular.ttf",
		sha256: "cf4de751ada78ceac033dbe16a687742939995b77bc2a052ae17a4957958594d",
		licence: ["fonts/vt323/OFL.txt"],
	},
	{
		key: "galmuri9",
		family: "Galmuri9",
		weight: 400,
		source: "cache",
		path: "fonts/Galmuri9.ttf",
		sha256: "5cb68052ee0a15571747e91c20f145e24b51bb459c6cd58226fafee78d9c0b16",
		licence: ["fonts/licenses/Galmuri-ofl.md"],
	},
	{
		key: "meslo",
		family: "MesloLGS NF",
		weight: 400,
		source: "cache",
		path: "fonts/MesloLGS NF Regular.ttf",
		sha256: "d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d",
		licence: ["fonts/licenses/MesloLGS-NF-License.txt", "fonts/licenses/Apache-2.0.txt", "fonts/licenses/DejaVu-LICENSE.txt"],
	},
]);

export const STROKE_FONTS = Object.freeze([
	{ key: "ems-allure", file: "fonts/stroke/EMSAllure.svg", connected: true, sha256: "55ed2de9c602229f32dd2784aae704023a5594eb8d208131f2552fae330a2a67" },
	{ key: "ems-felix", file: "fonts/stroke/EMSFelix.svg", connected: false, sha256: "e7b2463c6cb2a2cbef59db9b1f9f5a20a0ecd9158eeb8f01f2015c9e5be7dca4" },
	{ key: "ems-osmotron", file: "fonts/stroke/EMSOsmotron.svg", connected: false, sha256: "158b0f247a005ca5b6b8556f85684ad10cbb04c41ebbd394b9090c8ea2f16c52" },
	{ key: "ems-readability", file: "fonts/stroke/EMSReadability.svg", connected: false, sha256: "eebece4f2a47b9d3a8f40cab2b0f689ca60902997abd5c81064ef0d2a3a05522" },
	{ key: "ems-tech", file: "fonts/stroke/EMSTech.svg", connected: false, sha256: "7b5a420d4e16285213e7e2b1d187d086835c2dd7a7f64c5b8057434f082fc46f" },
]);

// Pre-warm fetch list (MO-A-48): pinned URL, byte count and sha256 for each cached face and each
// licence text that travels with it. The render never fetches; it only verifies these bytes.
export const FETCHED = Object.freeze([
	{
		path: "fonts/Galmuri9.ttf",
		url: "https://raw.githubusercontent.com/quiple/galmuri/v2.40.4/dist/Galmuri9.ttf",
		bytes: 4649144,
		sha256: "5cb68052ee0a15571747e91c20f145e24b51bb459c6cd58226fafee78d9c0b16",
	},
	{
		path: "fonts/licenses/Galmuri-ofl.md",
		url: "https://raw.githubusercontent.com/quiple/galmuri/v2.40.4/ofl.md",
		sha256: "9a9e5a342c430c3fcf01a408b680f4405d5bf4ac659c931be35f8a1b27ea69c9",
	},
	{
		path: "fonts/MesloLGS NF Regular.ttf",
		url: "https://raw.githubusercontent.com/romkatv/powerlevel10k-media/145eb9fbc2f42ee408dacd9b22d8e6e0e553f83d/MesloLGS%20NF%20Regular.ttf",
		bytes: 2594368,
		sha256: "d97946186e97f8d7c0139e8983abf40a1d2d086924f2c5dbf1c29bd8f2c6e57d",
	},
	{
		path: "fonts/licenses/MesloLGS-NF-License.txt",
		url: "https://raw.githubusercontent.com/romkatv/powerlevel10k-media/145eb9fbc2f42ee408dacd9b22d8e6e0e553f83d/MesloLGS%20NF%20License.txt",
		sha256: "0eb25f1a4e86320ceae5f650cb75e628117c3f575bc2e332bb13cd08c3be438e",
	},
	{
		path: "fonts/licenses/Apache-2.0.txt",
		url: "https://www.apache.org/licenses/LICENSE-2.0.txt",
		sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
	},
	{
		path: "fonts/licenses/DejaVu-LICENSE.txt",
		url: "https://raw.githubusercontent.com/dejavu-fonts/dejavu-fonts/version_2_37/LICENSE",
		sha256: "7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93",
	},
]);

/** Absolute path of a catalogue entry, given the product cache directory. */
export function fontPath(entry, cacheDir) {
	return entry.source === "cache" ? join(cacheDir, entry.path) : join(SKILL_ROOT, entry.path);
}
export const fontEntry = (key) => FONTS.find((entry) => entry.key === key);

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Verify every face a preset needs (MO-A-48/55). Returns missing and mismatched items; a render
 * turns any fault into exit 15 and never re-fetches.
 */
export function verifyFonts(keys, cacheDir) {
	const faults = [];
	for (const key of keys) {
		const entry = fontEntry(key);
		if (!entry) {
			faults.push({ key, fault: "unknown font key" });
			continue;
		}
		const path = fontPath(entry, cacheDir);
		if (!existsSync(path)) faults.push({ key, path, fault: "missing" });
		else if (digest(readFileSync(path)) !== entry.sha256) faults.push({ key, path, fault: "sha256 mismatch" });
		for (const licence of entry.licence) {
			const licencePath = entry.source === "cache" ? join(cacheDir, licence) : join(SKILL_ROOT, licence);
			if (!existsSync(licencePath)) faults.push({ key, path: licencePath, fault: "licence file missing" });
		}
	}
	return faults;
}

export function verifyStrokeFonts() {
	const faults = [];
	for (const entry of STROKE_FONTS) {
		const path = join(SKILL_ROOT, entry.file);
		if (!existsSync(path)) faults.push({ key: entry.key, path, fault: "missing" });
		else if (digest(readFileSync(path)) !== entry.sha256) faults.push({ key: entry.key, path, fault: "sha256 mismatch" });
	}
	return faults;
}
