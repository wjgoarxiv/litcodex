// When the HUD's card may draw round caps: the setting first, then the terminal, then an installed icon font.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasIconFont, roundGlyphs } from "./hud-glyphs.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const made = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-glyphs-")));
	roots.push(made);
	return made;
}

function font(dir: string, name: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), "");
}

describe("roundGlyphs", () => {
	const none = (): boolean => false;
	const some = (): boolean => true;

	it.each([
		[{ WT_SESSION: "1" }],
		[{ TERM_PROGRAM: "vscode" }],
		[{ TERM_PROGRAM: "WezTerm" }],
		[{ TERM_PROGRAM: "ghostty" }],
		[{ TERM: "xterm-kitty" }],
		[{ KITTY_WINDOW_ID: "1" }],
	])("is round in a terminal that draws caps itself: %o", (env) => {
		expect(roundGlyphs(env, none)).toBe(true);
		expect(roundGlyphs({ ...env, SSH_CONNECTION: "a" }, none)).toBe(true);
	});

	it("is round with an icon font on this machine, never over SSH", () => {
		expect(roundGlyphs({ TERM_PROGRAM: "herdr" }, some)).toBe(true);
		expect(roundGlyphs({ TERM_PROGRAM: "herdr" }, none)).toBe(false);
		let looked = 0;
		const count = (): boolean => {
			looked++;
			return true;
		};
		expect(roundGlyphs({ SSH_CONNECTION: "10.0.0.1 1 10.0.0.2 22" }, count)).toBe(false);
		expect(looked).toBe(0);
	});

	it("obeys LITCODEX_HUD_GLYPHS, and reads an unknown value as auto", () => {
		expect(roundGlyphs({ LITCODEX_HUD_GLYPHS: "nerd", SSH_CONNECTION: "a" }, none)).toBe(true);
		expect(roundGlyphs({ LITCODEX_HUD_GLYPHS: "basic", WT_SESSION: "1" }, some)).toBe(false);
		expect(roundGlyphs({ LITCODEX_HUD_GLYPHS: "auto" }, some)).toBe(true);
		expect(roundGlyphs({ LITCODEX_HUD_GLYPHS: "yes" }, none)).toBe(false);
	});
});

describe("hasIconFont", () => {
	it.each([
		["JetBrainsMonoNerdFont-Regular.ttf", true],
		["JetBrains Mono Nerd Font Complete.otf", true],
		["MesloLGS NF Regular.ttf", true],
		["CaskaydiaCoveNFM-Bold.ttf", true],
		["SymbolsNerdFontMono-Regular.ttf", true],
		["Menlo.ttc", false],
		["CONFUSION.ttf", false],
		["NerdFont-readme.txt", false],
	])("tells by the file name: %s", (name, expected) => {
		const dir = root();
		font(join(dir, "pack"), name);
		expect(hasIconFont({}, "linux", [dir])).toBe(expected);
	});

	it("looks in the user's font folders of each platform", () => {
		const home = root();
		font(join(home, "Library", "Fonts"), "XNerdFont-Regular.ttf");
		expect(hasIconFont({ HOME: home }, "darwin")).toBe(true);
		const data = root();
		font(join(data, "fonts", "nf"), "XNerdFont-Regular.ttf");
		expect(hasIconFont({ HOME: root(), XDG_DATA_HOME: data }, "linux")).toBe(true);
		const usual = root();
		font(join(usual, ".local", "share", "fonts"), "XNerdFont-Regular.ttf");
		expect(hasIconFont({ HOME: usual, XDG_DATA_HOME: "relative" }, "linux")).toBe(true);
		const local = root();
		font(join(local, "Microsoft", "Windows", "Fonts"), "XNerdFont-Regular.ttf");
		expect(hasIconFont({ LOCALAPPDATA: local }, "win32")).toBe(true);
	});

	it("gives up at its limits, skips links and survives a missing folder", () => {
		const deep = root();
		font(join(deep, "a", "b", "c", "d", "e"), "XNerdFont-Regular.ttf");
		expect(hasIconFont({}, "linux", [deep])).toBe(false);
		const many = root();
		for (let index = 0; index < 60; index++) font(many, `a${index}.ttf`);
		font(join(many, "z"), "XNerdFont-Regular.ttf");
		expect(hasIconFont({}, "linux", [many], 20)).toBe(false);
		expect(hasIconFont({}, "linux", [many])).toBe(true);
		const linked = root();
		symlinkSync(join(many, "z"), join(linked, "z"));
		expect(hasIconFont({}, "linux", [linked, join(linked, "missing")])).toBe(false);
	});
});
