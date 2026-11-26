// The saved choice of pill ends: where it lives, what it refuses, and the surfaces that read it.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cardCaps,
	chosenGlyphs,
	glyphsPath,
	glyphsProblem,
	glyphsWord,
	removeGlyphs,
	savedGlyphs,
	saveGlyphs,
} from "./glyph-choice.js";
import { roundGlyphs } from "./hud-glyphs.js";
import { renderScreenCard } from "./screen-card.js";
import { screenLook } from "./screen-status.js";
import { readFooter, roundFooter, type UiNode } from "./sunset-footer.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function home(): string {
	const made = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-glyph-choice-")));
	roots.push(made);
	return made;
}

const none = (): boolean => false;
const some = (): boolean => true;
const CAP = /[]/u;

function text(node: UiNode): string {
	return typeof node === "string" ? node : node.children.map(text).join("");
}

describe("the saved choice", () => {
	it.each(["auto", "round", "square"] as const)("keeps %s", (choice) => {
		const CODEX_HOME = home();
		expect(saveGlyphs({ CODEX_HOME }, choice, "user")).toBe(true);
		expect(savedGlyphs({ CODEX_HOME })).toEqual({ glyphs: choice, from: "user" });
		expect(JSON.parse(readFileSync(join(CODEX_HOME, "litcodex", "glyphs.json"), "utf8"))).toEqual({
			version: 1,
			glyphs: choice,
			from: "user",
		});
	});

	it("falls back to the home folder, on Windows to USERPROFILE, and to nothing without either", () => {
		const HOME = home();
		expect(glyphsPath({ HOME })).toBe(join(HOME, ".codex", "litcodex", "glyphs.json"));
		expect(glyphsPath({ USERPROFILE: HOME })).toBe(join(HOME, ".codex", "litcodex", "glyphs.json"));
		expect(glyphsPath({})).toBeNull();
		expect(saveGlyphs({}, "round", "user")).toBe(false);
		expect(savedGlyphs({})).toBeNull();
	});

	it.each(['{"glyphs":"oval"}', "[]", "not json", '{"version":1}'])("reads %s as no choice", (stored) => {
		const CODEX_HOME = home();
		mkdirSync(join(CODEX_HOME, "litcodex"));
		writeFileSync(join(CODEX_HOME, "litcodex", "glyphs.json"), stored);
		expect(savedGlyphs({ CODEX_HOME })).toBeNull();
	});

	it("refuses a linked file, a linked folder and a folder in the file's place", () => {
		const elsewhere = home();
		writeFileSync(join(elsewhere, "target.json"), '{"version":1,"glyphs":"round","from":"user"}');
		const linked = home();
		mkdirSync(join(linked, "litcodex"));
		symlinkSync(join(elsewhere, "target.json"), join(linked, "litcodex", "glyphs.json"));
		const under = home();
		symlinkSync(elsewhere, join(under, "litcodex"));
		writeFileSync(join(elsewhere, "glyphs.json"), '{"version":1,"glyphs":"round","from":"user"}');
		const odd = home();
		mkdirSync(join(odd, "litcodex", "glyphs.json"), { recursive: true });
		for (const CODEX_HOME of [linked, under, odd]) {
			expect(glyphsProblem({ CODEX_HOME }), CODEX_HOME).not.toBeNull();
			expect(saveGlyphs({ CODEX_HOME }, "square", "user")).toBe(false);
			expect(() => removeGlyphs({ CODEX_HOME })).not.toThrow();
			expect(savedGlyphs({ CODEX_HOME }), CODEX_HOME).toBeNull();
			expect(chosenGlyphs({ CODEX_HOME }), CODEX_HOME).toBe("auto");
		}
		for (const name of ["target.json", "glyphs.json"])
			expect(readFileSync(join(elsewhere, name), "utf8")).toContain("round");
		expect(glyphsProblem({ CODEX_HOME: home() })).toBeNull();
	});

	it("goes away with removeGlyphs", () => {
		const env = { CODEX_HOME: home() };
		saveGlyphs(env, "round", "user");
		removeGlyphs(env);
		expect(savedGlyphs(env)).toBeNull();
		removeGlyphs(env);
	});
});

describe("environment, then saved, then auto", () => {
	it.each([
		["auto", "auto"],
		["round", "round"],
		["nerd", "round"],
		["square", "square"],
		["basic", "square"],
		["ROUND ", "round"],
	])("reads %s", (word, expected) => {
		expect(glyphsWord(word)).toBe(expected);
	});

	it("ignores an unknown word and lets the saved choice answer", () => {
		const CODEX_HOME = home();
		saveGlyphs({ CODEX_HOME }, "round", "user");
		expect(glyphsWord("yes")).toBeNull();
		expect(chosenGlyphs({ CODEX_HOME, LITCODEX_HUD_GLYPHS: "yes" })).toBe("round");
		expect(chosenGlyphs({ CODEX_HOME, LITCODEX_HUD_GLYPHS: "basic" })).toBe("square");
		expect(chosenGlyphs({ CODEX_HOME, LITCODEX_HUD_GLYPHS: "auto" })).toBe("auto");
		expect(chosenGlyphs({ CODEX_HOME: home() })).toBe("auto");
	});

	it("holds over SSH, and auto keeps today's rule there", () => {
		const CODEX_HOME = home();
		const env = { CODEX_HOME, SSH_CONNECTION: "a" };
		expect(roundGlyphs(env, some)).toBe(false);
		saveGlyphs(env, "round", "user");
		expect(roundGlyphs(env, none)).toBe(true);
		saveGlyphs(env, "square", "user");
		expect(roundGlyphs({ CODEX_HOME, WT_SESSION: "1" }, some)).toBe(false);
		saveGlyphs(env, "auto", "user");
		expect(roundGlyphs(env, some)).toBe(false);
		expect(roundGlyphs({ CODEX_HOME, LITCODEX_HUD_GLYPHS: "round" }, none)).toBe(true);
		expect(roundGlyphs({ CODEX_HOME, LITCODEX_HUD_GLYPHS: "square" }, some)).toBe(false);
	});
});

describe("the footer", () => {
	it("obeys a saved choice whatever TERM says", () => {
		const CODEX_HOME = home();
		saveGlyphs({ CODEX_HOME }, "round", "user");
		expect(roundFooter({ CODEX_HOME, TERM: "xterm-256color" })).toBe(true);
		expect(roundFooter({ CODEX_HOME, TERM: "xterm" })).toBe(true);
		saveGlyphs({ CODEX_HOME }, "square", "user");
		expect(roundFooter({ CODEX_HOME, TERM: "xterm-kitty" })).toBe(false);
	});

	it("shows a change at the next read, with no restart of the server", () => {
		const CODEX_HOME = home();
		const env = { HOME: CODEX_HOME, CODEX_HOME, XDG_DATA_HOME: CODEX_HOME, TERM: "xterm-256color" };
		const read = (now: number): string => text(readFooter({}, env, now));
		saveGlyphs(env, "round", "user");
		expect(read(1_000)).toMatch(CAP);
		saveGlyphs(env, "square", "user");
		expect(read(2_000)).not.toMatch(CAP);
		saveGlyphs(env, "round", "user");
		expect(read(3_000)).toMatch(CAP);
	});
});

describe("the chat card", () => {
	const card = (env: NodeJS.ProcessEnv): string =>
		renderScreenCard(
			{
				mode: "lit-loop",
				note: null,
				look: null,
				map: {
					family: "main",
					cells: [
						{ key: "plan", icon: "", word: "plan", state: "done", label: null, progress: null },
						{
							key: "work",
							icon: "",
							word: "work",
							state: "current",
							label: null,
							progress: { done: 3, total: 7 },
						},
					],
					next: null,
				},
				checklist: [],
			},
			{ ...screenLook(env) },
		);

	it("ends round only where the saved choice says so", () => {
		const CODEX_HOME = home();
		const env = { CODEX_HOME, LITCODEX_SCREEN_STATUS: "1" };
		const before = card(env);
		expect(before).not.toMatch(CAP);
		for (const word of ["nerd", "round"]) expect(card({ ...env, LITCODEX_HUD_GLYPHS: word })).toBe(before);
		saveGlyphs(env, "auto", "user");
		expect(card({ ...env, WT_SESSION: "1" })).toBe(before);
		saveGlyphs(env, "round", "user");
		expect(card(env).match(/[]/gu)).toHaveLength(4);
		expect(card({ ...env, LITCODEX_HUD_GLYPHS: "basic" })).toBe(before);
		expect(card({ ...env, LITCODEX_SCREEN_STATUS: "0" })).not.toMatch(CAP);
		expect(card({ ...env, NO_COLOR: "1" })).not.toMatch(CAP);
		expect(cardCaps(env)).toBe(true);
	});

	it("keeps every cell in its column", () => {
		const CODEX_HOME = home();
		const env = { CODEX_HOME, LITCODEX_SCREEN_STATUS: "1" };
		const plain = (value: string): string => value.replace(/\x1b\[[0-9;]*m/gu, "").replace(/[\xa0]/gu, " ");
		const before = plain(card(env));
		saveGlyphs(env, "round", "user");
		expect(plain(card(env))).toBe(before);
	});
});
