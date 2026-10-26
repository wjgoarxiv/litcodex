// frontend-ui-ux house styles, kit and design lock. The kit is only useful if a run cannot drift
// out of it unnoticed, so these tests pin both halves: what design-lock.mjs writes, and what the
// interface probe reports when a page leaves the lock.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, type TestContext } from "vitest";

import { probeBrowserDriver } from "../browser-drive/scripts/capability-probe.mjs";
import {
	COLOR_ROLES, DEFAULT_STYLE_BY_FAMILY, FAMILIES, LOCK_FILE, MOMENT_KINDS, MOMENT_SCALE_BY_FAMILY,
	densityForBrief, initLock, kitStyles, lockRecord, setMoment, styleForBrief, tokensCss, validateStyle,
} from "./scripts/design-lock.mjs";
import { pixelSvg } from "./scripts/pixel-art.mjs";
import { findLock, formatProbeConsole, probe, staticFallback } from "./scripts/probe.mjs";
import { ALL_PROBE_RULES, CHECKED_RULES, LOCK_RULES, LOOK_RUBRIC } from "./scripts/rule-data.mjs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const kit = join(skillRoot, "kit");
const lockScript = join(skillRoot, "scripts/design-lock.mjs");
const temporaryRoots: string[] = [];
afterAll(() => { for (const path of temporaryRoots) rmSync(path, { recursive: true, force: true }); });
const scratch = () => {
	const path = mkdtempSync(join(tmpdir(), "lcx-lock-"));
	temporaryRoots.push(path);
	return path;
};
const read = (...parts: string[]) => readFileSync(join(skillRoot, ...parts), "utf8");
const lockOf = (dir: string) => JSON.parse(readFileSync(join(dir, LOCK_FILE), "utf8"));
const style = (id: string): any => kitStyles().find((entry: any) => entry.id === id);

const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};

describe("frontend-ui-ux kit: house styles", () => {
	it("ships exactly the five documented styles, each valid, with field-notes keeping the authored profile", () => {
		const styles = kitStyles() as any[];
		expect(styles.map((entry) => entry.id)).toEqual(["computational-brutalism", "field-notes", "graphite", "meadow", "neo-brutalism"]);
		for (const entry of styles) expect(validateStyle(entry), entry.id).toEqual([]);
		const profile = JSON.parse(read("references/default-editorial-pixel.json"));
		const fieldNotes = style("field-notes");
		expect(fieldNotes.color.light.canvas.toLowerCase()).toBe(profile.color_roles.paper.toLowerCase());
		expect(fieldNotes.color.light.ink.toLowerCase()).toBe(profile.color_roles.ink.toLowerCase());
		expect(fieldNotes.color.light.accent.toLowerCase()).toBe(profile.color_roles.signal.toLowerCase());
		expect(fieldNotes.color.light["accent-2"].toLowerCase()).toBe(profile.color_roles.signal_2.toLowerCase());
		expect(fieldNotes.color.light.support.toLowerCase()).toBe(profile.color_roles.quiet_signal.toLowerCase());
		expect(profile.density.default).toBe("rich");
		expect(fieldNotes.accent_art).toBe("pixel");
		expect(fieldNotes.type.display_px.max).toBeLessThanOrEqual(profile.typography.display_px.desktop[1]);
		expect(fieldNotes.type.display_px.min).toBeGreaterThanOrEqual(profile.typography.display_px.mobile[0]);
	});

	it("keeps every text and control pair above its WCAG floor in both themes", () => {
		const pairs: [string, string, number][] = [
			["ink", "canvas", 4.5], ["ink-2", "canvas", 4.5], ["ink-3", "canvas", 4.5], ["ink-3", "surface", 4.5], ["ink-3", "sunken", 4.5], ["ink-2", "sunken", 4.5],
			["on-accent", "accent", 4.5], ["on-accent", "accent-hover", 4.5], ["accent-ink", "canvas", 4.5], ["accent-ink", "surface", 4.5], ["accent-ink", "accent-wash", 4.5],
			["support-ink", "support", 4.5], ["positive", "positive-wash", 4.5], ["warning", "warning-wash", 4.5], ["negative", "negative-wash", 4.5], ["info", "info-wash", 4.5],
			["positive", "surface", 4.5], ["warning", "surface", 4.5], ["negative", "surface", 4.5], ["info", "surface", 4.5], ["control", "surface", 3], ["control", "canvas", 3], ["focus", "canvas", 3],
		];
		for (const entry of kitStyles() as any[]) {
			for (const theme of ["light", "dark"]) {
				for (const [fg, bg, floor] of pairs) {
					const ratio = contrast(entry.color[theme][fg], entry.color[theme][bg]);
					expect(ratio, `${entry.id} ${theme} ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under ${floor}:1`).toBeGreaterThanOrEqual(floor);
				}
				if (entry.shape.panel_head === "inverse") expect(contrast(entry.color[theme].canvas, entry.color[theme].ink), `${entry.id} ${theme} inverse panel head`).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("gives each brutalist register its own signature: flat, square and mono versus outlined, offset and loud", () => {
		const comp = style("computational-brutalism");
		const neo = style("neo-brutalism");
		expect(Object.values(comp.radius_px)).toEqual([0, 0, 0, 0, 0]);
		expect(comp.shape.elevation).toBe("flat");
		expect(comp.shadow.raised).toBe("none");
		expect(comp.fonts.text).toBe("JetBrains Mono");
		expect(comp.shape.meta_case).toBe("uppercase");
		expect(neo.shape.elevation).toBe("offset");
		expect(neo.shape.surface_line).toBe("ink");
		expect(Math.min(neo.shape.border_px.surface, neo.shape.border_px.control)).toBeGreaterThanOrEqual(2);
		expect(neo.shadow.raised).toMatch(/^\d+px \d+px 0 0 var\(--c-ink\)$/u);
		const neoTokens = tokensCss(neo, []);
		expect(neoTokens).toMatch(/--shadow-control: 3px 3px 0 0 var\(--c-ink\);/u);
		expect(neoTokens).toMatch(/--press: translate\(3px, 3px\);/u);
		expect(neoTokens).toMatch(/--control-edge: var\(--c-ink\);/u);
		const compTokens = tokensCss(comp, []);
		expect(compTokens).toMatch(/--font-meta: var\(--font-mono\);/u);
		expect(compTokens).toMatch(/--canvas-pattern: linear-gradient/u);
		expect(compTokens).toMatch(/--shadow-control: none;/u);
		expect(lockRecord(neo, "landing").elevation).toBe("offset");
		expect(lockRecord(comp, "workspace").elevation).toBe("flat");
		// Computational brutalism shows its structure (plotting grid, inverse panel heads, coordinate marks,
		// mono headings at real size); neo-brutalism is more than a recolour (accent panel heads, heavy display).
		expect(comp.shape.canvas_pattern).toBe("plot");
		expect(comp.shape.heading_font).toBe("mono");
		expect(comp.shape.panel_head).toBe("inverse");
		expect(comp.shape.section_marks).toBe("coord");
		expect(comp.shape.border_px.rule).toBeGreaterThanOrEqual(3);
		expect(comp.shape.border_px.surface).toBeGreaterThanOrEqual(2);
		expect(compTokens).toMatch(/--font-heading: var\(--font-mono\);/u);
		expect(compTokens).toMatch(/--panel-head-bg: var\(--c-ink\);/u);
		expect(compTokens).toMatch(/--section-marks: block;/u);
		expect(compTokens).toMatch(/--canvas-pattern-size: 32px 32px, 32px 32px, 160px 160px, 160px 160px;/u);
		expect(neo.shape.panel_head).toBe("accent");
		expect(neo.type.weights.display).toBeGreaterThanOrEqual(900);
		expect(neoTokens).toMatch(/--panel-head-bg: var\(--c-accent\);/u);
		expect({ ...comp.shape, border_px: null }).not.toEqual({ ...neo.shape, border_px: null });
		for (const entry of [comp, neo]) {
			expect(entry.use_when[0]).toMatch(/^opt-in only/u);
			expect(entry.forbid.length).toBeGreaterThanOrEqual(4);
			expect(entry.signature.length).toBeGreaterThanOrEqual(4);
		}
	});

	it("keeps the soft styles in a calm lock rendering flat: thin line outlines, no control shadow, scale press", () => {
		for (const id of ["field-notes", "graphite", "meadow"]) {
			const tokens = tokensCss(style(id), [], "calm");
			for (const line of ["--bw-surface: 1px;", "--bw-control: 1px;", "--bw-rule: 1px;", "--c-frame: var(--c-line);", "--control-edge: initial;", "--shadow-control: none;", "--press: scale(0.96);", "--meta-case: none;", "--canvas-pattern: none;", "--font-heading: var(--font-display);", "--panel-head-bg: transparent;", "--section-marks: none;"]) {
				expect(tokens.includes(line), `${id}: ${line}`).toBe(true);
			}
		}
	});

	it("rejects an elevation grammar that contradicts itself", () => {
		const broken = structuredClone(style("neo-brutalism"));
		broken.shape.offset_px.surface = 0;
		expect(validateStyle(broken).some((issue: string) => issue.includes("offset elevation needs offset_px"))).toBe(true);
		const flat = structuredClone(style("computational-brutalism"));
		flat.shape.press = "shift";
		flat.shape.border_px.rule = 9;
		const issues = validateStyle(flat);
		expect(issues.some((issue: string) => issue.includes("press shift"))).toBe(true);
		expect(issues.some((issue: string) => issue.includes("shape.border_px.rule"))).toBe(true);
	});

	it("rejects a style that leaves a role, scale step or radius undecided", () => {
		const broken = structuredClone((kitStyles() as any[])[0]);
		delete broken.color.dark.accent;
		broken.space_px.push(10);
		delete broken.radius_px.md;
		const issues = validateStyle(broken);
		expect(issues.some((issue: string) => issue.includes("color.dark.accent"))).toBe(true);
		expect(issues.some((issue: string) => issue.includes("space_px"))).toBe(true);
		expect(issues.some((issue: string) => issue.includes("radius_px.md"))).toBe(true);
	});
});

describe("frontend-ui-ux kit: components and starters", () => {
	const css = readFileSync(join(kit, "components.css"), "utf8");
	const tokens = tokensCss((kitStyles() as any[])[0], [{ family: "Pretendard", file: "a.woff2", weight: "45 920" }]);

	it("never names a literal colour, so a style switch reaches every component", () => {
		const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, "");
		expect(withoutComments).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
		expect(withoutComments).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch)\(/iu);
	});

	it("reads only custom properties that tokens.css or the sheet itself defines", () => {
		const defined = new Set([...`${tokens}\n${css}`.matchAll(/(--[a-z0-9-]+)\s*:/gu)].map((match) => match[1]));
		const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gu)].map((match) => match[1]));
		const optional = new Set(["--container", "--stack-gap", "--cluster-gap", "--grid-gap", "--cols", "--panel-pad", "--cell-y", "--status-ink", "--meter", "--swatch", "--scroll-max"]);
		for (const name of used) expect(defined.has(name as string) || optional.has(name as string), `${name} is read but never defined`).toBe(true);
		for (const role of COLOR_ROLES) expect(tokens).toMatch(new RegExp(`--c-${role}:`, "u"));
	});

	it("gives every family a starter whose ui-* classes all exist in the sheet", () => {
		const defined = new Set([...css.matchAll(/\.(ui-[a-z0-9_-]+)/gu)].map((match) => match[1]));
		expect(readdirSync(join(kit, "layouts")).sort()).toEqual(Object.keys(FAMILIES).map((family) => `${family}.html`).sort());
		for (const family of Object.keys(FAMILIES)) {
			const html = readFileSync(join(kit, "layouts", `${family}.html`), "utf8");
			for (const [, list] of html.matchAll(/class="([^"]+)"/gu)) {
				for (const name of (list as string).split(/\s+/u).filter((value) => value.startsWith("ui-"))) expect(defined.has(name), `${family}.html uses .${name}, which components.css never defines`).toBe(true);
			}
			expect(html, `${family}.html links tokens before components`).toMatch(/href="ui\/tokens\.css"[\s\S]*href="ui\/components\.css"/u);
			expect(html, `${family}.html marks its slots so DS-006 can find leftovers`).toMatch(new RegExp(LOCK_RULES["DS-006"].threshold.pattern, "u"));
		}
	});

	it("documents every kit class family in house-styles.md", () => {
		const doc = read("references/house-styles.md");
		for (const name of ["ui-display", "ui-btn", "ui-field", "ui-table-wrap", "ui-stat-row", "ui-plans", "ui-app", "ui-settings", "ui-savebar", "UI.bars", "ui-pixel", "ui-coord", "ui-ruler", "ui-frame", "ui-scan", "ui-readout", "ui-sticker", "ui-panel--accent", "ui-setpiece", "ui-bignum", "ui-hero--stage"]) expect(doc.includes(name), name).toBe(true);
		for (const id of ["DS-001", "DS-002", "DS-003", "DS-004", "DS-005", "DS-006", "DS-007", "DS-008"]) expect(doc.includes(id), id).toBe(true);
		for (const name of ["ui-coord", "ui-ruler", "ui-frame", "ui-scan", "ui-readout", "ui-sticker", "ui-panel--accent", "ui-panel--support"]) expect(css.includes(`.${name}`), `components.css defines .${name}`).toBe(true);
		for (const entry of kitStyles() as any[]) expect(doc.includes(`\`${entry.id}\``), entry.id).toBe(true);
	});

	it("ships the two font files with their OFL texts, each matching its recorded hash", () => {
		const fonts = JSON.parse(readFileSync(join(kit, "fonts.json"), "utf8"));
		expect(fonts.schema_id).toBe("litcodex.frontend-kit-fonts/v1");
		expect(fonts.fonts.map((entry: any) => entry.family)).toEqual(["Pretendard", "JetBrains Mono"]);
		const sha = (path: string) => createHash("sha256").update(readFileSync(join(kit, path))).digest("hex");
		for (const entry of fonts.fonts) {
			expect(sha(entry.source), `${entry.family} font`).toBe(entry.sha256);
			expect(sha(entry.licence.source), `${entry.family} OFL text`).toBe(entry.licence.sha256);
		}
	});
});

describe("frontend-ui-ux kit: design-lock.mjs", () => {
	it("writes the lock, tokens, sheet, script, fonts and the starter into the project", () => {
		const dir = scratch();
		const result = initLock({ styleId: "graphite", family: "workspace", dir, scaffold: true });
		expect(result.scaffolded).toBe("index.html");
		const lock = lockOf(dir);
		expect(lock.schema_id).toBe("litcodex.design-lock/v1");
		expect(lock.style).toBe("graphite");
		expect(lock.family).toBe("workspace");
		expect(lock.fonts).toEqual(["Pretendard", "JetBrains Mono"]);
		expect(lock.radius_px).toContain(0);
		for (const file of ["ui/tokens.css", "ui/components.css", "ui/ui.js", "ui/fonts/PretendardVariable.woff2", "ui/fonts/JetBrainsMono-wght-latin.woff2", "ui/fonts/Pretendard-OFL.txt", "ui/fonts/JetBrainsMono-OFL.txt", "index.html"]) {
			expect(existsSync(join(dir, file)), file).toBe(true);
		}
		const tokens = readFileSync(join(dir, "ui/tokens.css"), "utf8");
		expect(tokens).toMatch(/--ui-lock: "graphite";/u);
		expect(tokens).toMatch(/@media \(prefers-color-scheme: dark\)/u);
		expect(tokens).toMatch(/:root\[data-theme="dark"\]/u);
		expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(readFileSync(join(kit, "layouts/workspace.html"), "utf8"));
	});

	it("applies the family defaults when no style is named, and never defaults to meadow", () => {
		expect(DEFAULT_STYLE_BY_FAMILY).toEqual({ landing: "field-notes", workspace: "graphite", settings: "graphite" });
		for (const [family, id] of Object.entries(DEFAULT_STYLE_BY_FAMILY)) {
			const dir = scratch();
			initLock({ family, dir });
			expect(lockOf(dir).style, family).toBe(id);
		}
		expect(read("references/house-styles.md")).toMatch(/`meadow` is never a default/u);
		expect(style("meadow").use_when[0]).toMatch(/^opt-in only/u);
	});

	it("picks a brutalist register only when the request names it, and an explicit --style still wins", () => {
		const pick = (text: string) => styleForBrief(text)?.id ?? null;
		expect(pick("Build a brutalist landing page for a compiler")).toBe("computational-brutalism");
		expect(pick("레트로퓨처 느낌의 관제 대시보드")).toBe("computational-brutalism");
		expect(pick("브루탈리즘 스타일 설정 화면")).toBe("computational-brutalism");
		expect(pick("a retro-futurist CRT console")).toBe("computational-brutalism");
		expect(pick("neo-brutalism pricing page")).toBe("neo-brutalism");
		expect(pick("Make it neo brutalist, bold outlines")).toBe("neo-brutalism");
		expect(pick("네오브루탈리즘 랜딩 페이지")).toBe("neo-brutalism");
		for (const text of ["Build a settings page for a team workspace", "a dashboard for cold-chain trucks", "explain the SCRT process", "brutally honest copy"]) expect(pick(text), text).toBeNull();
		expect(initLock({ family: "workspace", dir: scratch(), brief: "브루탈리즘 대시보드" }).style.id).toBe("computational-brutalism");
		expect(initLock({ family: "landing", dir: scratch(), brief: "neo-brutalist launch page" }).style.id).toBe("neo-brutalism");
		expect(initLock({ family: "landing", dir: scratch(), brief: "a launch page" }).style.id).toBe("field-notes");
		expect(initLock({ family: "landing", dir: scratch(), styleId: "graphite", brief: "brutalist launch page" }).style.id).toBe("graphite");
		const match = spawnSync(process.execPath, [lockScript, "match", "neo-brutalism 온보딩"], { encoding: "utf8" });
		expect(match.status, match.stderr).toBe(0);
		expect(match.stdout).toMatch(/^neo-brutalism \(keyword/u);
	});

	it("keeps an existing page and refuses a silent style switch", () => {
		const dir = scratch();
		writeFileSync(join(dir, "index.html"), "<p>mine</p>");
		expect(initLock({ styleId: "field-notes", family: "landing", dir, scaffold: true }).scaffolded).toBe("kept existing index.html");
		expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("<p>mine</p>");
		expect(() => initLock({ styleId: "meadow", family: "landing", dir })).toThrow(/already locks "field-notes"/u);
		expect(initLock({ styleId: "meadow", family: "landing", dir, force: true }).style.id).toBe("meadow");
	});

	it("locks a brand style from a file but never under a kit id", () => {
		const dir = scratch();
		const brand = structuredClone((kitStyles() as any[])[1]);
		writeFileSync(join(dir, "kit-id.json"), JSON.stringify(brand));
		expect(() => initLock({ from: join(dir, "kit-id.json"), family: "landing", dir })).toThrow(/reuses a kit style id/u);
		brand.id = "acme";
		brand.color.light.accent = "#0a7d32";
		writeFileSync(join(dir, "acme.json"), JSON.stringify(brand));
		initLock({ from: join(dir, "acme.json"), family: "landing", dir: join(dir, "site") });
		expect(lockOf(join(dir, "site")).colors.light.accent).toBe("#0a7d32");
	});

	it("answers list and refuses an unknown family on the command line", () => {
		const list = spawnSync(process.execPath, [lockScript, "list"], { encoding: "utf8" });
		expect(list.status, list.stderr).toBe(0);
		for (const id of ["field-notes", "graphite", "meadow", "computational-brutalism", "neo-brutalism", "landing", "workspace", "settings"]) expect(list.stdout).toMatch(new RegExp(id, "u"));
		const bad = spawnSync(process.execPath, [lockScript, "init", "--style", "graphite", "--family", "poster", "--dir", scratch()], { encoding: "utf8" });
		expect(bad.status).toBe(1);
		expect(bad.stderr).toMatch(/--family must be one of landing, workspace, settings/u);
	});
});

describe("frontend-ui-ux kit: density", () => {
	it("locks the rich register by default and the calm one only when the request asks for it", () => {
		for (const family of Object.keys(FAMILIES)) {
			const dir = scratch();
			initLock({ family, dir, brief: "a page for a harbour fee planner" });
			expect(lockOf(dir).density, family).toBe("rich");
		}
		for (const text of ["a minimal landing page", "keep it calm and quiet", "a restrained settings page", "미니멀한 랜딩 페이지", "차분한 대시보드", "절제된 톤의 소개 페이지"]) expect(densityForBrief(text), text).toBe("calm");
		for (const text of ["a launch page", "a dashboard for cold-chain trucks", "minimise the load time", "minimum order form"]) expect(densityForBrief(text), text).toBe("rich");
		const calm = scratch();
		initLock({ family: "landing", dir: calm, brief: "a minimal launch page" });
		expect(lockOf(calm).density).toBe("calm");
		const flag = scratch();
		initLock({ family: "landing", dir: flag, density: "calm" });
		expect(lockOf(flag).density).toBe("calm");
		expect(() => initLock({ family: "landing", dir: scratch(), density: "sparse" })).toThrow(/--density must be rich or calm/u);
		const match = spawnSync(process.execPath, [lockScript, "match", "미니멀한 소개 페이지"], { encoding: "utf8" });
		expect(match.stdout).toMatch(/density: calm/u);
	});

	it("gives the rich register a tighter section rhythm, texture and a glow; the calm one keeps the broad flat page", () => {
		const fieldNotes = style("field-notes");
		const rich = tokensCss(fieldNotes, []);
		const calm = tokensCss(fieldNotes, [], "calm");
		expect(rich).toMatch(/--density: "rich";/u);
		expect(calm).toMatch(/--density: "calm";/u);
		const pad = (value: string) => [...value.matchAll(/--section-pad: (\d+)px/gu)].map((m) => Number(m[1]));
		expect(pad(calm)).toEqual([64, 96, 128]);
		pad(rich).forEach((value, i) => expect(value, `rich rhythm ${pad(rich)} must be tighter than ${pad(calm)}`).toBeLessThan(pad(calm)[i] as number));
		expect(rich).toMatch(/--canvas-pattern: radial-gradient/u);
		expect(calm).toMatch(/--canvas-pattern: none;/u);
		expect(rich).toMatch(/--glow: 0 0 \d+px/u);
		expect(calm).toMatch(/--glow: none;/u);
		for (const id of ["computational-brutalism", "neo-brutalism"]) expect(tokensCss(style(id), []), `${id} keeps its elevation grammar (DS-007)`).toMatch(/--glow: none;/u);
	});

	it("ships a second accent family in every style, above the WCAG floors in both themes", () => {
		for (const role of ["accent-2", "accent-2-ink", "accent-2-wash", "on-accent-2"]) expect(COLOR_ROLES, role).toContain(role);
		for (const entry of kitStyles() as any[]) {
			for (const theme of ["light", "dark"]) {
				const c = entry.color[theme];
				for (const [fg, bg] of [["on-accent-2", "accent-2"], ["accent-2-ink", "canvas"], ["accent-2-ink", "surface"], ["accent-2-ink", "accent-2-wash"]] as [string, string][]) {
					expect(contrast(c[fg], c[bg]), `${entry.id} ${theme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
				}
				expect(contrast(c["accent-2"], c.canvas), `${entry.id} ${theme} accent-2 reads as a surface on the canvas`).toBeGreaterThanOrEqual(3);
				expect(c["accent-2"], `${entry.id} ${theme}: a second family, not a copy`).not.toBe(c.accent);
			}
		}
		const sheet = readFileSync(join(kit, "components.css"), "utf8");
		for (const part of [".ui-band", ".ui-band--accent-2", ".ui-wash", ".ui-glow", ".ui-panel--accent-2", ".ui-tag--accent-2"]) expect(sheet.includes(part), part).toBe(true);
	});
});

describe("frontend-ui-ux kit: signature moment", () => {
	it("names a closed set of moments: bold ones for read-once pages, small ones for work surfaces", () => {
		expect(MOMENT_SCALE_BY_FAMILY).toEqual({ landing: "bold", workspace: "small", settings: "small" });
		expect(MOMENT_KINDS.bold).toEqual(["hero-composition", "type-set-piece", "data-moment", "diagram", "motion-detail", "interactive-object"]);
		expect(MOMENT_KINDS.small).toEqual(["chart", "empty-state", "header-detail"]);
		expect(Object.keys(LOCK_RULES["DS-008"].threshold.needs).sort(), "the probe knows what every kind must contain").toEqual([...MOMENT_KINDS.bold, ...MOMENT_KINDS.small].sort());
	});

	it("records what the moment is and where it sits, and refuses a loud moment on a work surface", () => {
		const dir = scratch();
		initLock({ family: "landing", dir, moment: "hero-composition", momentNote: "pixel invoice stack beside the title", momentPlace: "hero art column" });
		expect(lockOf(dir).moment).toEqual({ scale: "bold", kind: "hero-composition", note: "pixel invoice stack beside the title", place: "hero art column", selector: "[data-ui-moment]", above_fold: true });
		const work = scratch();
		initLock({ family: "workspace", dir: work });
		expect(lockOf(work).moment).toEqual({ scale: "small", kind: null, note: null, place: null, selector: "[data-ui-moment]", above_fold: false });
		expect(() => initLock({ family: "workspace", dir: scratch(), moment: "hero-composition", momentNote: "x" })).toThrow(/work surface takes a small moment: chart, empty-state, header-detail/u);
		expect(() => initLock({ family: "landing", dir: scratch(), moment: "confetti", momentNote: "x" })).toThrow(/unknown moment "confetti"/u);
		expect(() => initLock({ family: "landing", dir: scratch(), moment: "diagram" })).toThrow(/--moment-note/u);
		setMoment({ dir: work, kind: "chart", note: "deliveries per hour with the late-afternoon dip marked" });
		expect(lockOf(work).moment.kind).toBe("chart");
		const cli = spawnSync(process.execPath, [lockScript, "moment", "--dir", work, "--kind", "empty-state", "--note", "no excursions today", "--place", "excursions panel"], { encoding: "utf8" });
		expect(cli.status, cli.stderr).toBe(0);
		expect(lockOf(work).moment.place).toBe("excursions panel");
		const list = spawnSync(process.execPath, [lockScript, "list"], { encoding: "utf8" });
		expect(list.stdout).toMatch(/moments \(landing\): hero-composition, type-set-piece/u);
	});

	it("gives the moment its own type ceiling above the display range", () => {
		for (const entry of kitStyles() as any[]) {
			expect(entry.type.moment_px.max, entry.id).toBeGreaterThan(entry.type.display_px.max);
			expect(lockRecord(entry, "landing").type.moment_px).toEqual(entry.type.moment_px);
			expect(tokensCss(entry, [])).toMatch(new RegExp(`--fs-moment: clamp\\(${entry.type.display_px.min}px, .*, ${entry.type.moment_px.max}px\\);`, "u"));
		}
		const broken = structuredClone((kitStyles() as any[])[0]);
		broken.type.moment_px.max = broken.type.display_px.max;
		expect(validateStyle(broken).some((issue: string) => issue.includes("type.moment_px"))).toBe(true);
	});

	it("marks the moment slot in every starter and documents the rule", () => {
		for (const family of Object.keys(FAMILIES)) expect(read("kit/layouts", `${family}.html`), family).toMatch(/data-ui-moment="\{\{/u);
		const doc = read("references/house-styles.md");
		expect(doc).toMatch(/## \d\. Signature moment/u);
		for (const kind of [...MOMENT_KINDS.bold, ...MOMENT_KINDS.small]) expect(doc.includes(`\`${kind}\``), kind).toBe(true);
	});
});

describe("frontend-ui-ux kit: pixel-art.mjs", () => {
	it("turns a grid into crisp role-filled runs and refuses what would not read as pixel art", () => {
		const svg = pixelSvg("iia.\n.mm.", { label: "two rows", cell: 8 });
		expect(svg).toMatch(/viewBox="0 0 4 2"/u);
		expect(svg).toMatch(/<rect x="0" y="0" width="2" height="1" style="fill: var\(--c-ink\)"\/>/u);
		expect(svg).toMatch(/fill: var\(--c-accent\)/u);
		expect(svg).toMatch(/role="img" aria-label="two rows"/u);
		expect(svg, "a motif inherits the lock instead of naming colours").not.toMatch(/#[0-9a-f]{6}/iu);
		expect(() => pixelSvg("iq", { label: "x" })).toThrow(/unknown grid character "q"/u);
		expect(() => pixelSvg("ii", {})).toThrow(/--label is required/u);
		expect(() => pixelSvg("ii", { label: "x", cell: 4 })).toThrow(/under 6 px/u);
	});
});

describe("frontend-ui-ux probe: design-lock rules", () => {
	const ids = ["DS-001", "DS-002", "DS-003", "DS-004", "DS-005", "DS-006", "DS-007", "DS-008"];

	it("registers DS-001 to DS-008 with the documented severities and measures them", () => {
		expect(Object.keys(LOCK_RULES)).toEqual(ids);
		expect(ids.map((id) => (LOCK_RULES as any)[id].severity)).toEqual(["HIGH", "HIGH", "HIGH", "MEDIUM", "LOW", "HIGH", "MEDIUM", "HIGH"]);
		expect(LOCK_RULES["DS-003"].threshold.lowSeverity).toBe("MEDIUM");
		for (const id of ids) {
			expect(ALL_PROBE_RULES, id).toContain(id);
			expect(CHECKED_RULES, id).toContain(id);
		}
	});

	it("finds the lock beside the page and reports a broken one instead of skipping it", () => {
		const dir = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir, scaffold: true });
		expect(findLock(join(dir, "index.html"), undefined).lock.style).toBe("field-notes");
		const broken = scratch();
		writeFileSync(join(broken, LOCK_FILE), "{ not json");
		writeFileSync(join(broken, "index.html"), "<p>x</p>");
		expect(findLock(join(broken, "index.html"), undefined).error).toMatch(/unreadable/u);
		const bare = scratch();
		writeFileSync(join(bare, "index.html"), "<p>x</p>");
		expect(findLock(join(bare, "index.html"), undefined).lock).toBeNull();
		expect(findLock(join(bare, "index.html"), join(bare, "missing.json")).error).toMatch(/lock not found/u);
	});

	it("flags a leftover starter slot statically in HTML but not a spaced template expression", () => {
		const hits = staticFallback("<h1>{{Product}}</h1>\n<p>{{ count }}</p>", "index.html").findings.filter((finding: any) => finding.rule === "DS-006");
		expect(hits).toHaveLength(1);
		expect(hits[0].selector).toMatch(/index\.html:1/u);
		expect(hits[0].severity).toBe("HIGH");
	});

	it("prints the LOOK questions with the screenshots a rendered run saved, and nothing for a blocked run", () => {
		const shots = [{ viewport: "1440", path: "/tmp/s/1440.png" }, { viewport: "768", path: "/tmp/s/768.png" }];
		const printed = formatProbeConsole({ manifest: { exit_code: 0, screenshots: shots }, findings: [] } as any).stderr;
		expect(printed).toMatch(/- 1440: \/tmp\/s\/1440\.png/u);
		expect(printed).not.toMatch(/768\.png/u);
		for (const [id] of LOOK_RUBRIC) expect(printed).toMatch(new RegExp(`^${id} `, "mu"));
		expect(formatProbeConsole({ manifest: { exit_code: 2, blocked_reason: "browser unavailable", screenshots: [] }, findings: [] } as any).stderr).not.toMatch(/LOOK-1/u);
	});

	it("flags gradient text statically only when a stop is violet or the treatment repeats", () => {
		const sheet = (stops: string, selector = "h1") => `<style>\n${selector} { background: linear-gradient(90deg, ${stops}); background-clip: text; color: transparent; }\n</style>`;
		const rules = (source: string) => staticFallback(source, "a.html").findings.map((finding: any) => finding.rule);
		expect(rules(sheet("#7c3aed, #3b82f6"))).toContain("SLOP-009");
		expect(rules(sheet("#18272b, #1d6b68"))).not.toContain("SLOP-009");
		expect(rules(`${sheet("#18272b, #1d6b68", ".a")}${sheet("#18272b, #1d6b68", ".b")}`)).toContain("SLOP-009");
	});
});

const driver = probeBrowserDriver();
const browserReady = Boolean(driver.available);

describe.skipIf(!browserReady)("frontend-ui-ux probe: rendered lock conformance", () => {
	process.env.AGENT_BROWSER_ARGS ??= "--use-mock-keychain,--password-store=basic";
	const page = (body: string, extraCss = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lock fixture</title>
<link rel="stylesheet" href="ui/tokens.css"><link rel="stylesheet" href="ui/components.css"><style>${extraCss}</style></head><body><main class="ui-container ui-stack" id="main">${body}</main></body></html>`;
	// One viewport keeps each case to a single browser load; the full matrix is exercised by the real-surface run.
	// The isolated test runner can leave agent-browser unable to close its session; that is a blocked
	// browser, not a lock failure, so the case skips the way the fixture test in probe.test.ts does.
	const run = async (dir: string, context: TestContext, viewports = ["1440"]) => {
		const result: any = await probe(join(dir, "index.html"), join(dir, "evidence"), { viewports });
		if (result.manifest.exit_code === 2) context.skip(`browser blocked: ${result.manifest.blocked_reason}`);
		return result;
	};
	const dsRules = (result: any) => result.findings.filter((finding: any) => finding.rule.startsWith("DS-"));

	it("passes a page built from the kit without any DS finding", async (context) => {
		const dir = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir, moment: "header-detail", momentNote: "loan count beside the title" });
		writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1">Branch loans</h1><p class="ui-lead">Loans per branch today.</p><div class="ui-panel" data-ui-moment="header-detail"><div class="ui-stat"><p class="ui-stat__label">Items lent</p><div class="ui-stat__value">1,284</div></div><button class="ui-btn ui-btn--primary" type="button">Export</button></div>`));
		const result = await run(dir, context);
		expect(result.manifest.design_lock.style).toBe("graphite");
		expect(dsRules(result)).toEqual([]);
	}, 120_000);

	it("reports a page that drifts off its lock in font, colour, size and slots", async (context) => {
		const dir = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir });
		writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1">{{Screen title}}</h1><p class="drift">Off-lock copy</p><div class="chip a">One</div><div class="chip b">Two</div><div class="chip c">Three</div><div class="chip d">Four</div>`,
			".drift { font-family: Georgia, serif; font-size: 15px; color: #7a1fa2; } .chip { padding: 8px; border-radius: 5px; } .a { background: #ff00aa; } .b { background: #00c2ff; } .c { background: #ffcc00; } .d { background: #22aa22; }"));
		const result = await run(dir, context);
		const rules = new Set(result.findings.map((finding: any) => finding.rule));
		for (const rule of ["DS-002", "DS-003", "DS-004", "DS-005", "DS-006"]) expect(rules.has(rule), `${rule} must fire`).toBe(true);
		expect(result.findings.find((finding: any) => finding.rule === "DS-003").severity, "four or more off-palette colours are HIGH").toBe("HIGH");
		expect(result.manifest.exit_code).toBe(1);
	}, 120_000);

	it("accepts the neo-brutalist offset register a lock records and still catches blur inside it", async (context) => {
		const dir = scratch();
		initLock({ styleId: "neo-brutalism", family: "landing", dir, moment: "hero-composition", momentNote: "sticker on the line-up block" });
		const body = `<h1 class="ui-h1">Club nights</h1><div class="ui-panel" data-ui-moment="hero-composition" style="min-height: 240px"><svg width="240" height="120" role="img" aria-label="Two rooms"><rect width="120" height="120" style="fill: var(--c-support)"/></svg><p>Two rooms, one list.</p></div><div class="ui-panel ui-panel--accent"><p>Doors at nine.</p></div><span class="ui-sticker">Free before ten</span><button class="ui-btn ui-btn--primary" type="button">Get the list</button>`;
		writeFileSync(join(dir, "index.html"), page(body));
		expect(dsRules(await run(dir, context))).toEqual([]);
		writeFileSync(join(dir, "index.html"), page(body, ".ui-sticker { box-shadow: 0 8px 24px var(--c-ink); }"));
		expect(dsRules(await run(dir, context)).some((finding: any) => finding.rule === "DS-007"), "blur inside an offset lock is DS-007").toBe(true);
	}, 180_000);

	it("holds a flat computational-brutalism lock to rings and reports a lifted card as DS-007", async (context) => {
		const dir = scratch();
		initLock({ styleId: "computational-brutalism", family: "workspace", dir, moment: "header-detail", momentNote: "core readout framed under the title" });
		writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1">Reactor bay</h1><div class="ui-frame" data-ui-moment="header-detail"><span class="ui-coord">X 024 / Y 118</span><div class="ui-readout ui-scan">CORE 312.4 K</div></div><div class="ui-panel lifted"><p>Loop B nominal.</p></div>`, ".lifted { box-shadow: 0 4px 12px var(--c-line-strong); }"));
		expect(dsRules(await run(dir, context)).map((finding: any) => finding.rule)).toEqual(["DS-007"]);
	}, 120_000);

	it("fails a read-once page with no signature moment, a buried one or a generic gradient hero (DS-008, RED fixtures)", async (context) => {
		const motif = pixelSvg("iiiiii\niaaaai\niiiiii", { label: "An invoice stack", cell: 48 });
		const hero = (inner: string, css = "") => page(`<section class="ui-hero"><div class="ui-split"><div class="ui-hero__copy"><h1 class="ui-display">Bill every hour</h1><p class="ui-lead">Hours in, invoices out.</p></div>${inner}</div></section>`, css);
		const ds008 = async (dir: string) => (await run(dir, context)).findings.filter((finding: any) => finding.rule === "DS-008");
		const values = (list: any[]) => list.map((finding) => finding.value).join("\n");

		const undeclared = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir: undeclared });
		writeFileSync(join(undeclared, "index.html"), hero(`<div class="ui-hero__art">${motif}</div>`));
		expect(values(await ds008(undeclared))).toMatch(/declares no signature moment/u);

		const legacy = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir: legacy });
		const old = lockOf(legacy);
		delete old.moment;
		writeFileSync(join(legacy, LOCK_FILE), JSON.stringify(old, null, 2));
		writeFileSync(join(legacy, "index.html"), hero(`<div class="ui-hero__art">${motif}</div>`));
		const stale = await ds008(legacy);
		expect(stale[0]?.severity, "a lock written before signature moments does not pass a page without one").toBe("HIGH");
		expect(stale[0].value).toMatch(/predates signature moments/u);

		const missing = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir: missing, moment: "hero-composition", momentNote: "invoice stack" });
		writeFileSync(join(missing, "index.html"), hero(`<div class="ui-hero__art">${motif}</div>`));
		const absent = await ds008(missing);
		expect(absent[0]?.severity).toBe("HIGH");
		expect(absent[0].value).toMatch(/no \[data-ui-moment\]/u);

		writeFileSync(join(missing, "index.html"), hero(`<div class="ui-hero__art" data-ui-moment="hero-composition">${motif}</div>`));
		expect(await ds008(missing), "a declared, present, above-the-fold composition passes").toEqual([]);

		writeFileSync(join(missing, "index.html"), hero(`<div class="ui-hero__art"><div style="height: 1400px"></div><div data-ui-moment="hero-composition">${motif}</div></div>`));
		expect(values(await ds008(missing))).toMatch(/below the fold/u);

		const generic = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir: generic, moment: "type-set-piece", momentNote: "headline" });
		writeFileSync(join(generic, "index.html"), page(`<section class="ui-hero" data-ui-moment="type-set-piece" style="text-align: center; background-image: linear-gradient(135deg, var(--c-accent), var(--c-support)); min-height: 520px"><h1 class="ui-display">Bill every hour</h1><p class="ui-lead">Hours in, invoices out.</p></section>`));
		expect(values(await ds008(generic))).toMatch(/generic gradient-and-centred-text hero/u);

		const hollow = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir: hollow, moment: "data-moment", momentNote: "fee burn" });
		writeFileSync(join(hollow, "index.html"), hero(`<div class="ui-hero__art" data-ui-moment="data-moment" style="min-height: 320px"><p>Fee burn</p></div>`));
		expect(values(await ds008(hollow))).toMatch(/data-moment.*holds no/u);
	}, 300_000);

	it("lets the moment use its own type ceiling and nothing else on the page", async (context) => {
		const dir = scratch();
		initLock({ styleId: "field-notes", family: "landing", dir, moment: "type-set-piece", momentNote: "the fee figure set huge" });
		writeFileSync(join(dir, "index.html"), page(`<div data-ui-moment="type-set-piece" style="min-height: 240px"><p class="ui-setpiece">92 %</p></div><p class="ui-setpiece">Outside</p>`));
		const result = await run(dir, context);
		const ds004 = result.findings.filter((finding: any) => finding.rule === "DS-004");
		expect(ds004, JSON.stringify(result.findings)).toHaveLength(1);
		expect(ds004[0].selector).toMatch(/^p\.ui-setpiece$/u);
		expect(result.findings.filter((finding: any) => finding.rule === "DS-008")).toEqual([]);
	}, 120_000);

	it("reports DS-001 when the page never loads the generated tokens", async (context) => {
		const dir = scratch();
		initLock({ styleId: "meadow", family: "landing", dir });
		writeFileSync(join(dir, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>No tokens</title></head><body><main><h1>Plain page</h1></main></body></html>');
		const result = await run(dir, context);
		expect(result.findings.some((finding: any) => finding.rule === "DS-001" && finding.severity === "HIGH")).toBe(true);
	}, 120_000);
});

describe.skipIf(!browserReady)("frontend-ui-ux probe: rich density (maximal-ui)", () => {
	process.env.AGENT_BROWSER_ARGS ??= "--use-mock-keychain,--password-store=basic";
	const page = (body: string, extraCss = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rich fixture</title>
<link rel="stylesheet" href="ui/tokens.css"><link rel="stylesheet" href="ui/components.css"><style>${extraCss}</style></head><body><main class="ui-container ui-stack" id="main">${body}</main></body></html>`;
	const run = async (dir: string, context: TestContext) => {
		const result: any = await probe(join(dir, "index.html"), join(dir, "evidence"), { viewports: ["1440"] });
		if (result.manifest.exit_code === 2) context.skip(`browser blocked: ${result.manifest.blocked_reason}`);
		return result;
	};
	// CF-205 counts filled emphasis surfaces (here marked data-accent) of at least 24px per side, one per hue family.
	const bands = `<div class="b1" data-accent>One</div><div class="b2" data-accent>Two</div><div class="b3" data-accent>Three</div><div class="b4" data-accent>Four</div>`;
	const fifth = `<div class="b5" data-accent>Five</div>`;
	const bandCss = ".b1,.b2,.b3,.b4,.b5 { width: 160px; height: 56px; color: #fff; display: grid; place-items: center; } .b1 { background: #c64d2e; } .b2 { background: #1d6b68; } .b3 { background: #2b5f86; } .b4 { background: #8a2d6b; } .b5 { background: #6b7a12; }";

	it("passes a rich page that owns four hue families, and fails the same page under a calm lock (CF-205)", async (context) => {
		const rich = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir: rich, moment: "header-detail", momentNote: "four role bands under the title" });
		writeFileSync(join(rich, "index.html"), page(`<h1 class="ui-h1">Role bands</h1><div data-ui-moment="header-detail" class="ui-cluster">${bands}</div>`, bandCss));
		const richResult = await run(rich, context);
		expect(richResult.findings.filter((finding: any) => finding.rule === "CF-205"), "four hue families are inside the rich allowance").toEqual([]);

		const calm = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir: calm, density: "calm", moment: "header-detail", momentNote: "four role bands under the title" });
		writeFileSync(join(calm, "index.html"), page(`<h1 class="ui-h1">Role bands</h1><div data-ui-moment="header-detail" class="ui-cluster">${bands}</div>`, bandCss));
		const calmResult = await run(calm, context);
		expect(calmResult.findings.some((finding: any) => finding.rule === "CF-205"), "a calm lock allows one hue family").toBe(true);

		const crowded = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir: crowded, moment: "header-detail", momentNote: "five role bands under the title" });
		writeFileSync(join(crowded, "index.html"), page(`<h1 class="ui-h1">Role bands</h1><div data-ui-moment="header-detail" class="ui-cluster">${bands}${fifth}</div>`, bandCss));
		expect((await run(crowded, context)).findings.some((finding: any) => finding.rule === "CF-205"), "a fifth hue family is over the rich allowance").toBe(true);
	}, 180_000);

	it("fails the generic page that stacks violet gradient text with repeated glows (SLOP-009, SLOP-010)", async (context) => {
		const dir = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir, moment: "header-detail", momentNote: "headline" });
		const glow = "box-shadow: 0 0 48px 8px rgba(124, 58, 237, 0.55);";
		writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1 grad" data-ui-moment="header-detail">Ship faster</h1><button class="g">One</button><button class="g">Two</button><button class="g">Three</button>`,
			`.grad { background: linear-gradient(90deg, #7c3aed, #3b82f6); -webkit-background-clip: text; background-clip: text; color: transparent; } .g { ${glow} padding: 12px 20px; }`));
		const rules = (await run(dir, context)).findings.map((finding: any) => finding.rule);
		expect(rules).toContain("SLOP-009");
		expect(rules).toContain("SLOP-010");
	}, 120_000);

	it("lets one legible on-palette gradient word and two glows through", async (context) => {
		const dir = scratch();
		initLock({ styleId: "graphite", family: "workspace", dir, moment: "header-detail", momentNote: "headline" });
		writeFileSync(join(dir, "index.html"), page(`<h1 class="ui-h1" data-ui-moment="header-detail">Ship <span class="grad">faster</span></h1><button class="g">One</button><button class="g">Two</button>`,
			`.grad { background: linear-gradient(90deg, #18272b, #1d6b68); -webkit-background-clip: text; background-clip: text; color: transparent; } .g { box-shadow: 0 0 40px 6px rgba(29, 107, 104, 0.4); padding: 12px 20px; }`));
		const rules = (await run(dir, context)).findings.map((finding: any) => finding.rule);
		expect(rules).not.toContain("SLOP-009");
		expect(rules).not.toContain("SLOP-010");
	}, 120_000);
});
