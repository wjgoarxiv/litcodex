import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("readme-studio outlined typography helper", () => {
	it("uses shaped advances and offsets to emit editable SVG paths, and fails on missing glyphs", async () => {
		const helperUrl = new URL("./templates/typography/shape-text-to-svg.mjs", import.meta.url);
		const helperExists = existsSync(helperUrl);
		expect(helperExists, "the local shaping helper must be packaged with the skill").toBe(true);
		if (!helperExists) return;

		const { shapeTextToSvg } = await import("./templates/typography/shape-text-to-svg.mjs");
		const fontPath = "/task-fonts/Pretendard-Regular.otf";
		const fakeFontkit = {
			openSync(path: string) {
				expect(path).toBe(fontPath);
				return {
					familyName: "Pretendard Regular",
					unitsPerEm: 1000,
					ascent: 800,
					descent: -200,
					hasGlyphForCodePoint: () => true,
					layout(text: string) {
						expect(text).toBe("A한");
						return {
							glyphs: [
								{ id: 4, bbox: { minX: -80, maxX: 540, minY: -240, maxY: 870 }, path: { toSVG: () => "M0 0L500 700Z" } },
								{ id: 88, bbox: { minX: 0, maxX: 300, minY: 0, maxY: 600 }, path: { toSVG: () => "M0 0H300V600Z" } },
							],
							positions: [
								{ xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 10 },
								{ xAdvance: 400, yAdvance: 0, xOffset: 20, yOffset: 0 },
							],
						};
					},
				};
			},
		};

		const svg = shapeTextToSvg({
			text: "A한",
			fontPath,
			fontkit: fakeFontkit,
			fontSize: 100,
			tracking: 5,
			title: "Cover title",
		});
		expect(svg).toContain('viewBox="0 0 129 127"');
		expect(svg).toContain('<title id="title">Cover title</title>');
		expect(svg).toContain('<desc id="description">Editable source text: A한; font: Pretendard Regular (Pretendard-Regular.otf)</desc>');
		expect(svg).toContain('d="M0 0L500 700Z" transform="translate(16 95) scale(0.1 -0.1)"');
		expect(svg).toContain('d="M0 0H300V600Z" transform="translate(83 96) scale(0.1 -0.1)"');
		expect(svg.match(/<path\b/gu)).toHaveLength(2);
		expect(svg).not.toContain("<text");

		const missingGlyphFontkit = {
			openSync() {
				return {
					unitsPerEm: 1000,
					ascent: 800,
					descent: -200,
					hasGlyphForCodePoint: (codePoint: number) => codePoint !== 0x4e2d,
					layout: () => ({ glyphs: [], positions: [] }),
				};
			},
		};
		expect(() => shapeTextToSvg({ text: "中", fontPath, fontkit: missingGlyphFontkit })).toThrow(/missing glyph.*U\+4E2D/i);
	});

	it("rejects non-finite or inverted glyph bounds instead of emitting clipped geometry", async () => {
		const helperUrl = new URL("./templates/typography/shape-text-to-svg.mjs", import.meta.url);
		expect(existsSync(helperUrl)).toBe(true);
		if (!existsSync(helperUrl)) return;
		const { shapeTextToSvg } = await import("./templates/typography/shape-text-to-svg.mjs");
		for (const bbox of [
			{ minX: 0, maxX: Number.NaN, minY: 0, maxY: 100 },
			{ minX: 10, maxX: 0, minY: 0, maxY: 100 },
			{ minX: 0, maxX: 10, minY: 100, maxY: 0 },
		]) {
			const invalidFontkit = {
				openSync() {
					return {
						unitsPerEm: 1000,
						ascent: 800,
						descent: -200,
						layout: () => ({ glyphs: [{ id: 1, bbox, path: { toSVG: () => "M0 0H10V10Z" } }], positions: [{ xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0 }] }),
					};
				},
			};
			expect(() => shapeTextToSvg({ text: "A", fontPath: "/task-fonts/fake.otf", fontkit: invalidFontkit })).toThrow(/glyph bounding box.*finite.*ordered/i);
		}
	});

	it("keeps whitespace advances when an empty outline has fontkit's infinite bounds", async () => {
		const { shapeTextToSvg } = await import("./templates/typography/shape-text-to-svg.mjs");
		const fontkitWithPretendardSpaceShape = {
			openSync() {
				return {
					familyName: "Pretendard Bold",
					unitsPerEm: 1000,
					ascent: 800,
					descent: -200,
					hasGlyphForCodePoint: () => true,
					layout: () => ({
						glyphs: [
							{ id: 82, bbox: { minX: 0, maxX: 500, minY: 0, maxY: 700 }, path: { toSVG: () => "M0 0H500V700Z" } },
							{ id: 3, bbox: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }, path: { toSVG: () => "" } },
						],
						positions: [
							{ xAdvance: 500, yAdvance: 0, xOffset: 0, yOffset: 0 },
							{ xAdvance: 300, yAdvance: 0, xOffset: 0, yOffset: 0 },
						],
					}),
				};
			},
		};

		const svg = shapeTextToSvg({ text: "R ", fontPath: "/task-fonts/Pretendard-Bold.otf", fontkit: fontkitWithPretendardSpaceShape, fontSize: 100 });
		expect(svg).toContain('viewBox="0 0 96 116"');
		expect(svg.match(/<path\b/gu)).toHaveLength(1);
		expect(svg).not.toMatch(/Infinity|NaN/);
	});

	it("refuses to overwrite an existing artwork file", async () => {
		const helperUrl = new URL("./templates/typography/shape-text-to-svg.mjs", import.meta.url);
		const helperExists = existsSync(helperUrl);
		expect(helperExists, "the portable template must include its no-clobber helper").toBe(true);
		if (!helperExists) return;

		const tempRoot = mkdtempSync(join(tmpdir(), "readme-studio-no-clobber-"));
		try {
			const helper = await import("./templates/typography/shape-text-to-svg.mjs");
			expect(helper.writeOutputNoClobber, "output creation must be bound to a checked root").toBeTypeOf("function");
			if (!helper.writeOutputNoClobber) return;
			const output = join(tempRoot, "cover.svg");
			writeFileSync(output, "user artwork\n", { flag: "wx" });
			expect(() => helper.writeOutputNoClobber(tempRoot, "cover.svg", "<svg/>\n")).toThrow(/refusing to overwrite existing output/i);
			expect(readFileSync(output, "utf8")).toBe("user artwork\n");
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("writes only inside an explicit output root and rejects symlink escapes", async () => {
		const helperUrl = new URL("./templates/typography/shape-text-to-svg.mjs", import.meta.url);
		const helper = await import("./templates/typography/shape-text-to-svg.mjs");
		expect(helper.writeOutputNoClobber, "the SVG writer must validate the canonical output chain").toBeTypeOf("function");
		if (!helper.writeOutputNoClobber || !existsSync(helperUrl)) return;
		const tempRoot = mkdtempSync(join(tmpdir(), "readme-studio-output-root-"));
		try {
			const outputRoot = join(tempRoot, "workspace");
			const outside = join(tempRoot, "outside");
			mkdirSync(outputRoot);
			mkdirSync(outside);
			mkdirSync(join(outputRoot, "assets"));
			helper.writeOutputNoClobber(outputRoot, "assets/safe.svg", "<svg/>\n");
			expect(readFileSync(join(outputRoot, "assets/safe.svg"), "utf8")).toBe("<svg/>\n");
			expect(() => helper.writeOutputNoClobber(outputRoot, "../outside/escape.svg", "<svg/>\n")).toThrow(/inside the explicit output root/i);
			symlinkSync(outside, join(outputRoot, "linked"), "dir");
			expect(() => helper.writeOutputNoClobber(outputRoot, "linked/escape.svg", "<svg/>\n")).toThrow(/symlink/i);
			expect(existsSync(join(outside, "escape.svg"))).toBe(false);
			symlinkSync(outputRoot, join(tempRoot, "workspace-link"), "dir");
			expect(() => helper.writeOutputNoClobber(join(tempRoot, "workspace-link"), "rejected.svg", "<svg/>\n")).toThrow(/output root.*symlink/i);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("accepts only bounded regular font files and rejects FIFO input", async () => {
		const helper = await import("./templates/typography/shape-text-to-svg.mjs");
		expect(helper.validateFontFile, "the CLI must validate font files before parsing").toBeTypeOf("function");
		expect(helper.MAX_FONT_BYTES, "the accepted font size must be bounded").toBeGreaterThan(0);
		if (!helper.validateFontFile || !helper.MAX_FONT_BYTES) return;
		const tempRoot = mkdtempSync(join(tmpdir(), "readme-studio-font-input-"));
		try {
			const validFont = join(tempRoot, "regular.otf");
			writeFileSync(validFont, "font-bytes");
			expect(helper.validateFontFile(validFont).size).toBe(10);
			const emptyFont = join(tempRoot, "empty.otf");
			writeFileSync(emptyFont, "");
			expect(() => helper.validateFontFile(emptyFont)).toThrow(/non-empty/i);
			expect(() => helper.validateFontFile(tempRoot)).toThrow(/regular non-symlink file/i);
			const linkedFont = join(tempRoot, "linked.otf");
			symlinkSync(validFont, linkedFont);
			expect(() => helper.validateFontFile(linkedFont)).toThrow(/regular non-symlink file/i);
			const oversizedFont = join(tempRoot, "oversized.otf");
			writeFileSync(oversizedFont, "");
			truncateSync(oversizedFont, helper.MAX_FONT_BYTES + 1);
			expect(() => helper.validateFontFile(oversizedFont)).toThrow(/font exceeds the .* MiB limit/i);
			if (process.platform !== "win32") {
				const fifo = join(tempRoot, "font.fifo");
				const fifoResult = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
				expect(fifoResult.status, fifoResult.stderr).toBe(0);
				expect(() => helper.validateFontFile(fifo)).toThrow(/regular non-symlink file/i);
			}
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("runs its CLI when the installed skill path contains spaces", () => {
		const helperUrl = new URL("./templates/typography/shape-text-to-svg.mjs", import.meta.url);
		const helperExists = existsSync(helperUrl);
		expect(helperExists, "the portable template must include its CLI").toBe(true);
		if (!helperExists) return;

		const tempRoot = mkdtempSync(join(tmpdir(), "readme studio cli-"));
		try {
			const spacedHelper = join(tempRoot, "shape text to svg.mjs");
			copyFileSync(helperUrl, spacedHelper);
			const run = spawnSync(process.execPath, [spacedHelper, "--not-a-flag"], { encoding: "utf8" });
			expect(run.status, JSON.stringify({ stdout: run.stdout, stderr: run.stderr, error: run.error?.message })).toBe(1);
			expect(run.stderr).toMatch(/unknown option --not-a-flag/);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("runs the facts validator CLI when its installed path contains spaces", () => {
		const helperUrl = new URL("./scripts/validate-readme-facts.mjs", import.meta.url);
		const helperExists = existsSync(helperUrl);
		expect(helperExists, "the facts validator must ship with the skill").toBe(true);
		if (!helperExists) return;

		const tempRoot = mkdtempSync(join(tmpdir(), "readme facts cli-"));
		try {
			const spacedHelper = join(tempRoot, "validate facts.mjs");
			copyFileSync(helperUrl, spacedHelper);
			const run = spawnSync(process.execPath, [spacedHelper, "--not-a-flag"], { encoding: "utf8" });
			expect(run.status, JSON.stringify({ stdout: run.stdout, stderr: run.stderr })).toBe(1);
			expect(run.stderr).toMatch(/unknown option --not-a-flag/);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("pins the standalone shaping tool dependency instead of changing the product package", () => {
		const packageUrl = new URL("./templates/typography/package.json", import.meta.url);
		const packageExists = existsSync(packageUrl);
		expect(packageExists, "the helper template must declare its isolated dependency").toBe(true);
		if (!packageExists) return;

		const toolPackage = JSON.parse(readFileSync(packageUrl, "utf8")) as {
			private?: boolean;
			dependencies?: Record<string, string>;
		};
		expect(toolPackage.private).toBe(true);
		expect(toolPackage.dependencies).toEqual({ fontkit: "2.0.4" });
		const lockUrl = new URL("./templates/typography/package-lock.json", import.meta.url);
		const lockExists = existsSync(lockUrl);
		expect(lockExists, "the task-local helper must carry a reproducible dependency lock").toBe(true);
		if (!lockExists) return;
		const lock = JSON.parse(readFileSync(lockUrl, "utf8")) as {
			packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
		};
		expect(lock.packages[""].dependencies?.fontkit).toBe("2.0.4");
		expect(lock.packages["node_modules/fontkit"].version).toBe("2.0.4");
	});

	it("reports structural validity without attesting fact or badge truth", async () => {
		const helperUrl = new URL("./scripts/validate-readme-facts.mjs", import.meta.url);
		const helperExists = existsSync(helperUrl);
		expect(helperExists, "fact claims must pass a local provenance checker").toBe(true);
		if (!helperExists) return;

		const { validateReadmeFacts } = await import("./scripts/validate-readme-facts.mjs");
		const projectRoot = mkdtempSync(join(tmpdir(), "readme-studio-facts-"));
		try {
			writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ name: "@example/lab-notes", version: "1.2.3" }));
			const facts = {
				schema_id: "litcodex.readme-facts/v1",
				facts: [
					{ claim: "package.name", value: "@example/lab-notes", source: "package.json" },
					{ claim: "package.version", value: "1.2.3", source: "package.json" },
				],
				badges: [],
			};
			expect(validateReadmeFacts(facts, projectRoot)).toEqual({
				valid: true,
				validation_scope: "structure-only",
				factual_accuracy: "not-checked",
				source_contents_compared: false,
				badge_truth_checked: false,
				issues: [],
			});
			const withSafeBadge = structuredClone(facts);
			withSafeBadge.badges = [{ label: "Build", url: "https://ci.example.test/status.svg", source: "package.json" }];
			expect(validateReadmeFacts(withSafeBadge, projectRoot).valid).toBe(true);
			const escaping = structuredClone(facts);
			escaping.facts.push({ claim: "status", value: "clean", source: "../outside.txt" });
			const unsafeResult = validateReadmeFacts(escaping, projectRoot);
			expect(unsafeResult.valid).toBe(false);
			expect(unsafeResult.issues.join("\n")).toMatch(/status.*safe relative evidence path/i);
			const unsupported = structuredClone(facts);
			unsupported.facts.push({ claim: "feature", value: "supports collaboration", source: "missing.md" });
			const missingResult = validateReadmeFacts(unsupported, projectRoot);
			expect(missingResult.valid).toBe(false);
			expect(missingResult.issues.join("\n")).toMatch(/feature.*regular non-symlink file/i);
			for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "https://user:secret@example.test/badge.svg"]) {
				const unsafeUrl = structuredClone(facts);
				unsafeUrl.badges = [{ label: "Build", url, source: "package.json" }];
				const unsafeUrlResult = validateReadmeFacts(unsafeUrl, projectRoot);
				expect(unsafeUrlResult.valid, url).toBe(false);
				expect(unsafeUrlResult.issues.join("\n"), url).toMatch(/badge Build.*http\(s\)/i);
			}
			const emptyValue = structuredClone(facts);
			emptyValue.facts.push({ claim: "summary", value: " ", source: "package.json" });
			expect(validateReadmeFacts(emptyValue, projectRoot).issues).toContain("summary needs a non-empty value");
		} finally {
			rmSync(projectRoot, { recursive: true, force: true });
		}
	});
});

describe("readme-studio Remotion cover template", () => {
	it("reserves a contrasting wide text field, selects theme-specific outlines, and reduces the Korean subtitle", async () => {
		const layoutUrl = new URL("./templates/remotion-cover/src/layout.ts", import.meta.url);
		expect(existsSync(layoutUrl), "the Remotion template must provide a testable layout contract").toBe(true);
		if (!existsSync(layoutUrl)) return;
		const { getReadmeCoverLayout } = await import("./templates/remotion-cover/src/layout");
		const lightWide = getReadmeCoverLayout("light", false);
		const darkWide = getReadmeCoverLayout("dark", false);
		const lightMobile = getReadmeCoverLayout("light", true);

		expect(lightWide.titleAsset).toBe("title-outline-light.svg");
		expect(lightWide.subtitleAsset).toBe("subtitle-outline-light.svg");
		expect(darkWide.titleAsset).toBe("title-outline-dark.svg");
		expect(darkWide.subtitleAsset).toBe("subtitle-outline-dark.svg");
		expect(lightWide.titleWidthPercent).toBe(50);
		expect(lightWide.textFieldWidthPercent).toBeGreaterThanOrEqual(60);
		expect(lightWide.artworkStartPercent).toBe(62);
		expect(lightWide.titleLeftPercent + lightWide.titleWidthPercent).toBeLessThanOrEqual(lightWide.artworkStartPercent);
		expect(lightWide.textFieldColor).toBe("#FBF8F0");
		expect(lightWide.textFieldOpacity).toBe(0.98);
		expect(lightMobile.subtitleMaxHeightPercent).toBeLessThan(lightWide.subtitleMaxHeightPercent);
		expect(lightMobile.subtitleMaxHeightPercent).toBe(5.5);
		expect(lightMobile.textFieldHeightPercent).toBe(55);
		expect(lightMobile.mobileArtworkHeightPercent).toBe(45);
		expect(lightMobile.mobileArtworkObjectFit).toBe("cover");
		expect(lightMobile.mobileArtworkObjectPosition).toBe("84% center");
		expect(lightMobile.titleTopPercent + lightMobile.titleHeightPercent).toBeLessThan(100 - lightMobile.subtitleBottomPercent - lightMobile.subtitleMaxHeightPercent);
		expect(100 - lightMobile.subtitleBottomPercent).toBe(lightMobile.textFieldHeightPercent);
	});

	it("eases the background breath in and out with matching held loop endpoints", async () => {
		const motionUrl = new URL("./templates/remotion-cover/src/motion.ts", import.meta.url);
		expect(existsSync(motionUrl), "the motion helper must encode an inspectable loop curve").toBe(true);
		if (!existsSync(motionUrl)) return;
		const { coverLoopProgress, titleMotionAt } = await import("./templates/remotion-cover/src/motion");
		expect(titleMotionAt, "the cover needs a seam-safe typographic micro-entry").toBeTypeOf("function");
		if (!titleMotionAt) return;

		expect(coverLoopProgress(0)).toBe(0);
		expect(coverLoopProgress(35)).toBe(0);
		expect(coverLoopProgress(61)).toBeLessThan(0.1);
		expect(coverLoopProgress(112)).toBeGreaterThan(0.9);
		expect(coverLoopProgress(150)).toBe(1);
		expect(coverLoopProgress(264)).toBe(0);
		expect(coverLoopProgress(299)).toBe(0);
		expect(coverLoopProgress(0)).toBe(coverLoopProgress(299));
		expect(titleMotionAt(0)).toEqual({ titleOffsetY: 0, subtitleOffsetY: 0 });
		expect(titleMotionAt(18)).toEqual({ titleOffsetY: 8, subtitleOffsetY: -4 });
		expect(titleMotionAt(48)).toEqual(titleMotionAt(0));
		expect(titleMotionAt(72)).toEqual(titleMotionAt(0));
		expect(titleMotionAt(299)).toEqual(titleMotionAt(0));
	});

	it("wires the tested theme layout and eased loop motion into the rendered composition", () => {
		const componentUrl = new URL("./templates/remotion-cover/src/ReadmeCover.tsx", import.meta.url);
		const source = readFileSync(componentUrl, "utf8");
		expect(source).toContain("getReadmeCoverLayout(theme, mobile)");
		expect(source).toContain("coverLoopProgress(frame)");
		expect(source).toContain("titleMotionAt(frame)");
		expect(source).toContain("layout.titleAsset");
		expect(source).toContain("layout.subtitleAsset");
		expect(source).toContain("layout.mobileArtworkObjectFit");
		expect(source).toContain("layout.mobileArtworkObjectPosition");
		expect(source).toContain("scale: backgroundScale");
		expect(source).toContain("translate: `0px ${titleMotion.titleOffsetY}px`");
	});

	it("stages a blurred depth plane, a masked sharp focal plane, and a second static-capable rim-light layer", () => {
		const source = readFileSync(new URL("./templates/remotion-cover/src/ReadmeCover.tsx", import.meta.url), "utf8");
		expect(source).toContain('id="depth-background"');
		expect(source).toContain('filter: "blur(18px)"');
		expect(source).toContain('id="focal-plane"');
		expect(source).toContain("maskImage:");
		expect(source).toContain("WebkitMaskImage:");
		expect(source).toContain('id="rim-light"');
		expect(source).toContain("rimOpacity");
		expect(source).toContain("linear-gradient(90deg");
		expect(source).toContain("linear-gradient(180deg");
		expect(source).toContain("linear-gradient(180deg, transparent 58%, ${rimColor} 62%, transparent 72%)");
		expect(source).toContain('filter: "blur(82px)"');
		expect(source).toContain("linear-gradient(115deg");
		expect(source).toContain("feTurbulence");
		expect(source).not.toContain("animation:");
	});
});

describe("readme-studio HyperFrames alternative", () => {
	it("pins the published engine and uses its project/composition render contract", () => {
		const root = "./templates/hyperframes-cover/";
		const packageData = JSON.parse(readFileSync(new URL(`${root}package.json`, import.meta.url), "utf8")) as {
			devDependencies?: Record<string, string>;
			engines?: { node?: string };
		};
		expect(packageData.devDependencies).toEqual({ hyperframes: "0.8.51" });
		expect(packageData.engines?.node).toBe(">=22");
		const lockUrl = new URL(`${root}package-lock.json`, import.meta.url);
		expect(existsSync(lockUrl), "the portable fallback must have a reproducible package lock").toBe(true);
		if (!existsSync(lockUrl)) return;
		const lock = JSON.parse(readFileSync(lockUrl, "utf8")) as {
			packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
		};
		expect(lock.packages[""].devDependencies?.hyperframes).toBe("0.8.51");
		expect(lock.packages["node_modules/hyperframes"].version).toBe("0.8.51");
		const html = readFileSync(new URL(`${root}index.html`, import.meta.url), "utf8");
		for (const attribute of ['data-composition-id="readme-cover"', 'data-start="0"', 'data-duration="5"', 'data-width="1600"', 'data-height="800"']) {
			expect(html).toContain(attribute);
		}
		const recipe = readFileSync(new URL("./references/motion-and-delivery.md", import.meta.url), "utf8");
		expect(recipe).toContain("hyperframes render . -c index.html --fps 60 --workers 1 --output fresh.mp4");
		expect(recipe).toContain("test ! -e fresh.mp4 && ./node_modules/.bin/hyperframes render . -c index.html --fps 60 --workers 1 --output fresh.mp4");
		expect(recipe).toContain("test ! -e fresh.mp4 && ./node_modules/.bin/hyperframes render . -c index.html --fps 60 --workers 1 --output fresh.mp4");
		expect(recipe).toContain("streaming-encode");
		expect(recipe).toContain("screenshot capture");
		expect(recipe).toContain("test ! -e public/readme-cover-v01.mp4 && npm run render -- src/index.tsx ReadmeCoverWideLight public/readme-cover-v01.mp4 --fps 60");
	});

	it("declares CSS-driven motion for native seeking and audits a containing motion scope", () => {
		const root = "./templates/hyperframes-cover/";
		const html = readFileSync(new URL(`${root}index.html`, import.meta.url), "utf8");
		expect(html).toMatch(/<main\b(?=[^>]*\bdata-composition-id="readme-cover")(?=[^>]*\bdata-no-timeline\b)[^>]*>/);
		expect(html).not.toContain("prefers-reduced-motion");
		expect(html).toMatch(/#background\s*\{[^}]*animation:\s*background-breath\s+5s\b/s);
		expect(html).toMatch(/#title(?:,\s*#title-light)?\s*\{[^}]*animation:\s*title-entry-reset\s+800ms\b/s);

		const motionUrl = new URL(`${root}index.motion.json`, import.meta.url);
		expect(existsSync(motionUrl), "the renderer's seeked timeline must have motion assertions").toBe(true);
		if (!existsSync(motionUrl)) return;
		const motion = JSON.parse(readFileSync(motionUrl, "utf8")) as {
			duration?: number;
			assertions?: Array<{ kind?: string; withinSelector?: string; maxStaticSec?: number }>;
		};
		expect(motion.duration).toBe(5);
		expect(motion.assertions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "keepsMoving", withinSelector: "#cover", maxStaticSec: 1.2 }),
			]),
		);
	});

	it("stages depth and rim-light layers across theme and mobile layouts", () => {
		const html = readFileSync(new URL("./templates/hyperframes-cover/index.html", import.meta.url), "utf8");
		expect(html).toMatch(/#background\s*\{[^}]*filter:\s*blur\(18px\)/s);
		expect(html).toMatch(/#focal-plane\s*\{[^}]*mask-image:\s*linear-gradient/s);
		expect(html).toMatch(/#glow\s*\{[^}]*filter:\s*blur\(82px\)/s);
		expect(html).toContain('id="glow" data-layout-allow-overflow');
		expect(html).toMatch(/#rim-light\s*\{[^}]*background:\s*linear-gradient/s);
		expect(html).toContain('#cover[data-layout="mobile"] #text-field { inset: 0 0 auto; width: 100%; height: 62%; background: linear-gradient(180deg, var(--field-color) 0%, var(--field-color) 89%, transparent 100%); }');
		expect(html).toContain("linear-gradient(180deg, transparent 58%, var(--rim-color) 62%, transparent 72%)");
		expect(html).toContain("@keyframes glow-breath");
		expect(html).toContain("@keyframes rim-light-cycle");
		expect(html).toContain('#cover[data-theme="light"]');
		expect(html).toContain('#cover[data-layout="mobile"]');
		expect(html).toContain('data-theme="dark"');
		expect(html).toContain('data-layout="wide"');
		expect(html).toContain("micro-label-outline-light.svg");
		expect(html).toContain("title-outline-light.svg");
		expect(html).toContain("subtitle-outline-light.svg");
		expect(html).toContain("#0c151a");
		expect(html).toContain("#fbf8f0");
		expect(html).toContain("animation: background-breath 5s");
		expect(html).not.toContain("prefers-reduced-motion");
	});
});

describe("readme-studio README asset assembly", () => {
	it("provides a responsive inline preview with reduced-motion fallback and only conditional local links", () => {
		const template = readFileSync(new URL("./templates/readme-cover-section.md", import.meta.url), "utf8");
		expect(template).toContain("<picture>");
		expect(template).toContain("media=\"(prefers-reduced-motion: reduce)");
		expect(template).toContain("media=\"(prefers-color-scheme: dark)");
		expect(template).toContain("media=\"(max-width: 600px)");
		for (const variant of [
			"readme-cover-poster-mobile-dark.png",
			"readme-cover-poster-mobile-light.png",
			"readme-cover-poster-wide-dark.png",
			"readme-cover-poster-wide-light.png",
			"readme-cover-preview-mobile-dark.gif",
			"readme-cover-preview-mobile-light.gif",
			"readme-cover-preview-wide-dark.gif",
			"readme-cover-preview-wide-light.gif",
		]) {
			expect(template).toContain(variant);
		}
		expect(template).toContain('alt="{{verified cover description}}"');
		expect(template).toContain("Only keep a source whose generated file exists");
		expect(template).toContain("2.5 MiB");
		expect(template).toContain("INLINE_PREVIEW_SIZE_BLOCKED");
		expect(template).toContain("explicit partial-delivery decision");
		expect(template).toContain("GitHub README rendering and npm package README display");
		expect(template).toContain("readme-facts.json");
		expect(template).toContain("regular, non-symlink file");
		expect(template).not.toContain("[Usage](docs/usage.md)");
		expect(template).not.toContain("[Contributing](CONTRIBUTING.md)");
		expect(template).not.toContain("[License](LICENSE)");
		expect(template).not.toContain("<video");
	});
});

describe("readme-studio selected-skill helper-root examples", () => {
	let fixtureRoot = "";
	let selectedSkillRoot = "";
	let selectedSkillFile = "";
	let projectRoot = "";
	let taskHome = "";

	beforeAll(() => {
		fixtureRoot = mkdtempSync(join(tmpdir(), "litcodex readme helper root with spaces-"));
		selectedSkillRoot = join(fixtureRoot, "selected skill path with spaces", "readme-studio");
		selectedSkillFile = join(selectedSkillRoot, "SKILL.md");
		projectRoot = join(fixtureRoot, "authorized project path with spaces");
		taskHome = join(fixtureRoot, "isolated host home with spaces");
		mkdirSync(join(selectedSkillRoot, "scripts"), { recursive: true });
		copyFileSync(
			fileURLToPath(new URL("./scripts/validate-readme-facts.mjs", import.meta.url)),
			join(selectedSkillRoot, "scripts", "validate-readme-facts.mjs"),
		);
		writeFileSync(selectedSkillFile, "selected readme-studio fixture\n");
		mkdirSync(join(projectRoot, ".readme-studio"), { recursive: true });
		mkdirSync(taskHome, { recursive: true });
		writeFileSync(join(projectRoot, "fact-source.md"), "The source supports this fixture fact.\n");
		writeFileSync(
			join(projectRoot, ".readme-studio", "readme-facts.json"),
			JSON.stringify({
				schema_id: "litcodex.readme-facts/v1",
				facts: [{ claim: "fixture.claim", value: "Verified fixture value", source: "fact-source.md" }],
				badges: [],
			}, null, 2),
		);
	});

	afterAll(() => {
		if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
	});

	function documentedExample(markdownPath: string): string | undefined {
		const markdown = readFileSync(markdownPath, "utf8");
		const blocks = [...markdown.matchAll(/(?:^|\n)[\t ]{0,3}```(?:bash|sh)\n([\s\S]*?)\n[\t ]{0,3}```(?=\n|$)/g)].map((match) => match[1] ?? "");
		return blocks.find((block) => block.includes("validate-readme-facts.mjs"));
	}

	function runExample(markdownPath: string) {
		const example = documentedExample(markdownPath);
		if (example === undefined) return undefined;
		const command = example.replaceAll("<absolute path of the SKILL.md selected for this turn>", selectedSkillFile);
		return spawnSync("bash", ["--noprofile", "--norc", "-c", "set -euo pipefail\n" + command], {
			cwd: projectRoot,
			encoding: "utf8",
			env: {
				CODEX_HOME: taskHome,
				HOME: taskHome,
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				XDG_CONFIG_HOME: join(taskHome, ".config"),
			},
			timeout: 15_000,
		});
	}

	it.each([
		["SKILL.md", fileURLToPath(new URL("./SKILL.md", import.meta.url))],
		["facts-and-assembly.md", fileURLToPath(new URL("./references/facts-and-assembly.md", import.meta.url))],
	])("runs the %s validator example from a project path with spaces", (_label, markdownPath) => {
		const example = documentedExample(markdownPath);
		expect(example, "the runtime instructions must include a runnable selected-skill command").toBeDefined();
		const result = runExample(markdownPath);
		expect(result?.error).toBeUndefined();
		expect(result?.status, `${result?.stdout}\n${result?.stderr}`).toBe(0);
		expect(JSON.parse(result?.stdout.trim() ?? "{}")).toMatchObject({
			valid: true,
			validation_scope: "structure-only",
			factual_accuracy: "not-checked",
		});
	});
});

describe("readme-studio facts-safe README decoration", () => {
	it("documents inspected decoration patterns, source pages, and npm presentation limits", () => {
		const patterns = readFileSync(new URL("./references/decoration-patterns.md", import.meta.url), "utf8");
		const normalizedPatterns = patterns.toLowerCase();
		for (const pattern of [
			"emoji-led section headings",
			"centered hero block",
			"badge and logo row",
			"section iconography",
		"collapsible `<details>` sections",
			"contributors, star-history, and showcase",
			"table-based feature grids",
			"footer navigation",
			"npm",
			"repository-backed",
			"verified endpoint",
		]) {
			expect(normalizedPatterns).toContain(pattern.toLowerCase());
		}
		for (const source of [
			"https://github.com/oven-sh/bun/blob/main/README.md",
			"https://github.com/vitejs/vite/blob/main/README.md",
			"https://github.com/shadcn-ui/ui/blob/main/README.md",
			"https://github.com/ant-design/ant-design/blob/master/README.md",
			"https://github.com/huggingface/transformers/blob/main/README.md",
			"https://github.com/assimp/assimp/blob/master/Readme.md",
			"https://docs.npmjs.com/about-package-readme-files/",
			"2026-09-20",
		]) {
			expect(patterns).toContain(source);
		}
	});

	it("wires Step 7 to a decorated, optional, facts-safe full README scaffold", () => {
		const skill = readFileSync(new URL("./SKILL.md", import.meta.url), "utf8");
		const step7Start = skill.indexOf("7. **Assemble and inspect.**");
		const step7End = skill.indexOf("\n\n## #contract.outputs", step7Start);
		const step7 = skill.slice(step7Start, step7End);
		const template = readFileSync(new URL("./templates/readme-cover-section.md", import.meta.url), "utf8");

		expect(step7).toContain("references/decoration-patterns.md");
		expect(step7).toContain("optional");
		expect(step7).toContain("npm");
		for (const feature of [
			'<div align="center">',
			"## 🚀 Quick start",
			"## ✨ Capabilities",
			"| Capability | Evidence-backed description |",
			"<details>",
			"contributors",
			"star-history",
			"showcase",
			"footer navigation",
			"plain-text fallback",
			"verified endpoint",
		]) {
			expect(template).toContain(feature);
		}
		expect(template).toContain("repository-backed");
		expect(template).toContain("readme-facts.json");
		expect(template).not.toMatch(/https?:\/\/(?:img\.shields\.io|api\.star-history\.com)/);
	});
});
