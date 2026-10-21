// Cover assets. Every raster a cover page can load (base art, logo, wordmark, texture) is listed in
// `<out>/assets.json` with its path, role, source (user or generated) and SHA-256, and the renderer
// checks the list before the first capture. A listed file that is missing stops the run as
// BLOCKED_ASSET_MISSING (exit 22): the art is supplied or generated, never replaced by a drawn
// stand-in, and the painted-light recipe cannot run without its base art. After the render, frame 0
// must show that art: the SSIM of its check box in decoded frame 0 against the source scaled into
// the art's box.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { COVER, EXIT, Exit } from "./constants.mjs";
import { readPngRgba } from "./cover-gate.mjs";
import { crop, lanczosResize, ssim } from "./cover-image.mjs";
import { which } from "./runtime.mjs";
import { rasterInfo } from "./stage.mjs";

export const ASSETS_FILE = "assets.json";
export const ASSET_ROLES = Object.freeze(["base-art", "logo", "wordmark", "texture"]);
const RASTERS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invalid = (field, message) => new Exit(EXIT.BLOCKED_TREATMENT_INVALID, `BLOCKED_TREATMENT_INVALID: assets.json ${field}: ${message}`);
const isBox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === "number" && v >= 0 && v <= 1) && b[2] > 0 && b[3] > 0 && b[0] + b[2] <= 1 + 1e-9 && b[1] + b[3] <= 1 + 1e-9;
const inside = (inner, outer) => inner[0] >= outer[0] - 1e-9 && inner[1] >= outer[1] - 1e-9 && inner[0] + inner[2] <= outer[0] + outer[2] + 1e-9 && inner[1] + inner[3] <= outer[1] + outer[3] + 1e-9;

function entry(raw, i, coverDir) {
	const at = `assets[${i}]`;
	if (!raw || typeof raw !== "object") throw invalid(at, "must be an object");
	if (typeof raw.path !== "string" || !raw.path.startsWith(`${coverDir}/`) || raw.path.split("/").includes("..")) throw invalid(`${at}.path`, `must be a path inside ${coverDir}/, relative to the output directory`);
	if (!ASSET_ROLES.includes(raw.role)) throw invalid(`${at}.role`, `must be one of ${ASSET_ROLES.join(", ")}`);
	if (!["user", "generated"].includes(raw.source)) throw invalid(`${at}.source`, "must be user (supplied) or generated (made for this cover)");
	if (!/^[0-9a-f]{64}$/u.test(raw.sha256 ?? "")) throw invalid(`${at}.sha256`, "must be the file's SHA-256 (64 hex digits)");
	if ("box" in raw && !isBox(raw.box)) throw invalid(`${at}.box`, "must be [x, y, w, h] as fractions of the cover, inside it");
	if (raw.role === "base-art" && !raw.box) throw invalid(`${at}.box`, "base art needs the box it fills on the cover");
	if ("checkBox" in raw) {
		if (!isBox(raw.checkBox)) throw invalid(`${at}.checkBox`, "must be [x, y, w, h] as fractions of the cover, inside it");
		if (!raw.box) throw invalid(`${at}.checkBox`, "needs the art's box");
		if (!inside(raw.checkBox, raw.box)) throw invalid(`${at}.checkBox`, "must lie inside the art's box");
		if (raw.checkBox[2] * raw.checkBox[3] < COVER.artMinShare * raw.box[2] * raw.box[3]) throw invalid(`${at}.checkBox`, `must cover at least ${COVER.artMinShare * 100} % of the art's box`);
	}
	return { path: raw.path, role: raw.role, source: raw.source, sha256: raw.sha256, box: raw.box ?? null, checkBox: raw.checkBox ?? null, title: raw.title === true };
}

/**
 * Check `<outDir>/assets.json` against the cover folder before any capture. `files` is the static
 * scan's file list (paths relative to the cover folder). Exit 22 for a missing listed file or a
 * painted recipe with no base art; exit 17 for a raster the list does not name or a file whose hash
 * changed; exit 16 for a malformed entry. Returns { assets } (empty when there is no list).
 */
export function checkAssets({ outDir, treatment, files, coverDir = "cover" }) {
	const file = join(outDir, ASSETS_FILE);
	let assets = [];
	if (existsSync(file)) {
		let doc;
		try {
			doc = JSON.parse(readFileSync(file, "utf8"));
		} catch (error) {
			throw invalid("", `not valid JSON (${error.message})`);
		}
		if (!doc || !Array.isArray(doc.assets)) throw invalid("assets", "must be an array of { path, role, source, sha256 }");
		assets = doc.assets.map((raw, i) => entry(raw, i, coverDir));
		for (const asset of assets) {
			const path = join(outDir, asset.path);
			if (!existsSync(path)) throw new Exit(EXIT.BLOCKED_ASSET_MISSING, `BLOCKED_ASSET_MISSING: ${asset.path} is listed in assets.json and missing; supply it or generate it, never draw a stand-in`);
			if (sha256(readFileSync(path)) !== asset.sha256) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${asset.path} no longer matches its sha256 in assets.json; list it again after changing it`);
		}
	}
	if (treatment.recipe === "painted-light" && !assets.some((a) => a.role === "base-art")) throw new Exit(EXIT.BLOCKED_ASSET_MISSING, "BLOCKED_ASSET_MISSING: the painted-light recipe needs its base art listed in assets.json ({ path, role: base-art, source, sha256, box }); supply or generate the painting, never draw a stand-in");
	const listed = new Set(assets.map((a) => a.path));
	for (const f of files.filter((f) => RASTERS.has(extname(f.rel).toLowerCase()))) {
		const rel = `${coverDir}/${f.rel.split(sep).join("/")}`;
		if (!listed.has(rel)) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${rel} is a raster the page can load but assets.json does not list; add it with its role, source and sha256`);
	}
	return { assets };
}

/** A raster's pixels: PNG decoded here, any other format (or a PNG this decoder cannot read) through ffmpeg. */
export function readRaster(file, env = process.env) {
	try {
		return readPngRgba(file);
	} catch {
		const info = rasterInfo(readFileSync(file), extname(file).toLowerCase());
		const ffmpeg = which("ffmpeg", env);
		if (!info || !ffmpeg) return null;
		const raw = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 2 ** 30, env });
		return raw.status === 0 ? { width: info.width, height: info.height, rgba: raw.stdout } : null;
	}
}

const toPx = (box, width, height) => box.map((v, k) => Math.round(v * (k % 2 ? height : width)));

/**
 * ART: crop the check box (default: the art's whole box) out of decoded frame 0 and compare it with
 * the same region of the source scaled into the art's box. Boxes are fractions of the cover.
 */
export function artCheck({ frame0, width, height, art, box, checkBox = null }) {
	const [bx, by, bw, bh] = toPx(box, width, height);
	const scaled = lanczosResize(art.rgba, art.width, art.height, bw, bh);
	const [cx, cy, cw, ch] = toPx(checkBox ?? box, width, height);
	const value = ssim(crop(frame0, width, [cx, cy, cw, ch]), crop(scaled, bw, [cx - bx, cy - by, cw, ch]), cw, ch);
	return { ssim: value, pass: value >= COVER.artSsim, box: [bx, by, bw, bh], checked: [cx, cy, cw, ch] };
}

/** The reply labels a generated asset needs; `completion` prints them for the finished cover. */
export function generatedLabels(outDir) {
	try {
		const doc = JSON.parse(readFileSync(join(outDir, ASSETS_FILE), "utf8"));
		return (doc.assets ?? []).filter((a) => a?.source === "generated" && typeof a.path === "string").map((a) => `the ${String(a.role ?? "asset").replace("-", " ")} ${a.path} is generated, not supplied: label it as generated in the reply`);
	} catch {
		return [];
	}
}
