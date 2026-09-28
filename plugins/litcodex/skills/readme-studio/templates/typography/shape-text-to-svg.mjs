#!/usr/bin/env node
import { createRequire } from "node:module";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const MAX_FONT_BYTES = 64 * 1024 * 1024;

function escapeXml(value) {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function number(value) {
	const rounded = Number(value.toFixed(4));
	return Object.is(rounded, -0) ? "0" : String(rounded);
}

function missingCodePoint(font, text) {
	if (typeof font.hasGlyphForCodePoint !== "function") return null;
	for (const character of text) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && !font.hasGlyphForCodePoint(codePoint)) {
			return `missing glyph U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} in selected font`;
		}
	}
	return null;
}

export function validateFontFile(fontPath) {
	if (typeof fontPath !== "string" || fontPath.trim().length === 0) throw new Error("an explicit font path is required");
	let stat;
	try {
		stat = lstatSync(fontPath);
	} catch {
		throw new Error("font file must be an accessible regular non-symlink file");
	}
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("font path must be a regular non-symlink file");
	if (stat.size <= 0) throw new Error("font file must be non-empty");
	if (stat.size > MAX_FONT_BYTES) throw new Error(`font exceeds the ${MAX_FONT_BYTES / (1024 * 1024)} MiB limit`);
	return { path: realpathSync(fontPath), size: stat.size };
}

export function writeOutputNoClobber(outputRoot, output, contents) {
	if (typeof outputRoot !== "string" || outputRoot.trim().length === 0) throw new Error("an explicit output root is required");
	if (typeof output !== "string" || output.trim().length === 0) throw new Error("a non-empty output path is required");
	const rootCandidate = resolve(outputRoot);
	let rootStat;
	try {
		rootStat = lstatSync(rootCandidate);
	} catch {
		throw new Error("output root must be an existing directory");
	}
	if (rootStat.isSymbolicLink()) throw new Error("output root must not be a symlink");
	if (!rootStat.isDirectory()) throw new Error("output root must be an existing directory");
	const canonicalRoot = realpathSync(rootCandidate);
	const targetCandidate = isAbsolute(output) ? resolve(output) : resolve(canonicalRoot, output);
	const targetRelative = relative(canonicalRoot, targetCandidate);
	if (targetRelative === "" || targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
		throw new Error("output path must resolve inside the explicit output root");
	}
	const segments = targetRelative.split(sep);
	let parent = canonicalRoot;
	for (const segment of segments.slice(0, -1)) {
		parent = join(parent, segment);
		let stat;
		try {
			stat = lstatSync(parent);
		} catch {
			throw new Error(`output parent does not exist or cannot be inspected: ${parent}`);
		}
		if (stat.isSymbolicLink()) throw new Error(`output parent chain contains a symlink: ${parent}`);
		if (!stat.isDirectory()) throw new Error(`output parent is not a directory: ${parent}`);
		if (realpathSync(parent) !== parent) throw new Error(`output parent chain is not canonical or contains a symlink: ${parent}`);
	}
	const target = join(parent, segments[segments.length - 1]);
	let existing;
	try {
		existing = lstatSync(target);
	} catch (error) {
		if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
	}
	if (existing) throw new Error(`refusing to overwrite existing output: ${target}`);
	try {
		writeFileSync(target, contents, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if (error && typeof error === "object" && error.code === "EEXIST") throw new Error(`refusing to overwrite existing output: ${target}`);
		throw error;
	}
	return target;
}

export function shapeTextToSvg({ text, fontPath, fontkit, fontSize = 100, tracking = 0, title = text, fill = "#151a20" } = {}) {
	if (typeof text !== "string" || text.length === 0 || text.trim().length === 0) throw new Error("text must be non-empty");
	if (Array.from(text).length > 500) throw new Error("text exceeds the 500-character cover limit");
	if (typeof fontPath !== "string" || fontPath.trim().length === 0) throw new Error("an explicit font path is required");
	if (!Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(tracking)) throw new Error("font size must be positive and tracking must be finite");
	if (!/^#[\da-f]{3}(?:[\da-f]{3})?$/iu.test(fill)) throw new Error("fill must be a 3- or 6-digit hex color");
	if (!fontkit || typeof fontkit.openSync !== "function") throw new Error("fontkit@2.0.4 is required from the task-local typography tool");

	const font = fontkit.openSync(fontPath);
	const missing = missingCodePoint(font, text);
	if (missing) throw new Error(missing);
	const unitsPerEm = font.unitsPerEm;
	if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0) throw new Error("font has invalid unitsPerEm metadata");
	const ascent = font.ascent ?? unitsPerEm * 0.8;
	const descent = font.descent ?? -unitsPerEm * 0.2;
	if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent <= descent) throw new Error("font has invalid finite vertical metrics");
	const run = font.layout(text);
	if (!run || !Array.isArray(run.glyphs) || !Array.isArray(run.positions) || run.glyphs.length === 0) {
		throw new Error("fontkit returned no shaped glyph run");
	}
	if (run.glyphs.length !== run.positions.length) throw new Error("fontkit glyph and position counts do not match");
	const scale = fontSize / unitsPerEm;
	const padding = fontSize * 0.08;
	if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(padding) || padding <= 0) throw new Error("font produced invalid SVG geometry");
	const glyphs = [];
	let penX = 0;
	let penY = 0;
	let minX = 0;
	let maxX = 0;
	let minYUp = Math.min(0, descent);
	let maxYUp = Math.max(0, ascent);

	for (let index = 0; index < run.glyphs.length; index += 1) {
		const glyph = run.glyphs[index];
		const position = run.positions[index];
		if (glyph.id === 0) throw new Error("fontkit shaped a missing glyph (.notdef); verify glyph coverage or choose another font");
		for (const key of ["xAdvance", "yAdvance", "xOffset", "yOffset"]) {
			if (!Number.isFinite(position[key])) throw new Error(`fontkit returned an invalid ${key}`);
		}
		const pathData = glyph.path?.toSVG?.();
		if (typeof pathData !== "string") throw new Error(`glyph ${glyph.id} has no SVG outline`);
		const originX = penX + position.xOffset * scale;
		const originYUp = penY + position.yOffset;
		if (pathData.length > 0) {
			const bbox = glyph.bbox ?? glyph.path?.bbox;
			if (
				!bbox ||
				![bbox.minX, bbox.maxX, bbox.minY, bbox.maxY].every(Number.isFinite) ||
				bbox.minX > bbox.maxX ||
				bbox.minY > bbox.maxY
			) {
				throw new Error(`glyph bounding box for glyph ${glyph.id} must contain finite, ordered min/max coordinates`);
			}
			const glyphMinX = originX + bbox.minX * scale;
			const glyphMaxX = originX + bbox.maxX * scale;
			const glyphMinYUp = originYUp + bbox.minY;
			const glyphMaxYUp = originYUp + bbox.maxY;
			if (![originX, originYUp, glyphMinX, glyphMaxX, glyphMinYUp, glyphMaxYUp].every(Number.isFinite)) {
				throw new Error(`glyph ${glyph.id} produced non-finite SVG geometry`);
			}
			minX = Math.min(minX, glyphMinX);
			maxX = Math.max(maxX, glyphMaxX);
			minYUp = Math.min(minYUp, glyphMinYUp);
			maxYUp = Math.max(maxYUp, glyphMaxYUp);
			glyphs.push({ pathData, originX, originYUp });
		}
		penX += position.xAdvance * scale + (index < run.glyphs.length - 1 ? tracking : 0);
		penY += position.yAdvance;
		if (!Number.isFinite(penX) || !Number.isFinite(penY)) throw new Error("shaped run produced non-finite advance geometry");
		minX = Math.min(minX, penX);
		maxX = Math.max(maxX, penX);
	}

	const width = maxX - minX + padding * 2;
	const height = (maxYUp - minYUp) * scale + padding * 2;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("font produced non-positive or non-finite SVG geometry");
	const baseline = padding + maxYUp * scale;
	const glyphNodes = glyphs.map(({ pathData, originX, originYUp }) => {
		const x = padding + originX - minX;
		const y = baseline - originYUp * scale;
		return `<path d="${escapeXml(pathData)}" transform="translate(${number(x)} ${number(y)}) scale(${number(scale)} ${number(-scale)})"/>`;
	});
	const familyName = typeof font.familyName === "string" && font.familyName.length > 0 ? font.familyName : "selected font";
	const fontFile = basename(fontPath);
	const safeTitle = escapeXml(title);
	const description = escapeXml(`Editable source text: ${text}; font: ${familyName} (${fontFile})`);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(width)} ${number(height)}" role="img" aria-labelledby="title description" data-font-family="${escapeXml(familyName)}" data-font-file="${escapeXml(fontFile)}">`,
		`<title id="title">${safeTitle}</title>`,
		`<desc id="description">${description}</desc>`,
		`<g fill="${fill}">${glyphNodes.join("")}</g>`,
		"</svg>",
		"",
	].join("\n");
}

function parseArgs(argv) {
	const options = {};
	const values = new Map([
		["--font", "fontPath"],
		["--text", "text"],
		["--output-root", "outputRoot"],
		["--output", "output"],
		["--font-size", "fontSize"],
		["--tracking", "tracking"],
		["--title", "title"],
		["--fill", "fill"],
	]);
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		const property = values.get(key);
		if (!property) throw new Error(`unknown option ${key}`);
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`${key} requires a value`);
		options[property] = value;
		index += 1;
	}
	if (!options.fontPath || !options.text || !options.outputRoot || !options.output) throw new Error("usage: shape-text-to-svg.mjs --font <font-file> --text <source-text> --output-root <existing-task-workspace> --output <relative-new-svg-path> [--font-size 100] [--tracking 0] [--fill #151a20]");
	for (const key of ["fontSize", "tracking"]) {
		if (options[key] !== undefined) {
			options[key] = Number(options[key]);
			if (!Number.isFinite(options[key])) throw new Error(`--${key === "fontSize" ? "font-size" : key} must be numeric`);
		}
	}
	return options;
}

function main(argv) {
	const options = parseArgs(argv);
	const fontFile = validateFontFile(resolve(options.fontPath));
	const fontkit = require("fontkit");
	const svg = shapeTextToSvg({ ...options, fontPath: fontFile.path, fontkit });
	writeOutputNoClobber(options.outputRoot, options.output, svg);
}


const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`readme-studio: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
