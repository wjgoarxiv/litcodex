// The ROUND_ENDS line: what it says for each surface, choice, terminal and font.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedGlyphs, saveGlyphs } from "@litcodex/lit-loop/dist/glyph-choice.js";
import { afterEach, describe, expect, it } from "vitest";
import { type RoundFacts, roundEnds, saveTerminalRound } from "./round-ends.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const facts = (over: Partial<RoundFacts> = {}): RoundFacts => ({
	env: { TERM: "xterm-256color" },
	platform: "darwin",
	tty: true,
	footer: "on",
	card: false,
	saved: null,
	iconFont: false,
	...over,
});
const line = (over: Partial<RoundFacts> = {}): string => roundEnds(facts(over));
const user = (glyphs: "auto" | "round" | "square") => ({ glyphs, from: "user" }) as const;

describe("roundEnds", () => {
	it("is shown only for a round the user confirmed, on a surface that is on", () => {
		expect(line({ saved: user("round") })).toBe("shown");
		expect(line({ saved: user("round"), footer: "off", card: true })).toBe("shown");
		expect(line({ saved: user("round"), env: { TERM: "xterm-256color", SSH_CONNECTION: "a" } })).toBe("shown");
		expect(line({ saved: user("round"), footer: "off" })).toMatch(/^square \(no surface enabled/u);
	});

	it("says the same whatever word this shell has, since the footer never sees it", () => {
		const cases: readonly Partial<RoundFacts>[] = [
			{},
			{ iconFont: true },
			{ env: { TERM: "xterm-256color", WT_SESSION: "1" } },
			{ env: { TERM: "xterm-kitty" } },
			{ saved: user("round") },
			{ saved: user("round"), footer: "off", card: true },
			{ saved: user("square") },
			{ saved: user("auto"), iconFont: true },
			{ saved: { glyphs: "round", from: "terminal" } },
		];
		for (const over of cases)
			for (const tty of [true, false])
				for (const word of ["auto", "round", "nerd", "square", "basic"]) {
					const env = { TERM: "xterm-256color", ...over.env };
					expect(line({ ...over, tty, env: { ...env, LITCODEX_HUD_GLYPHS: word } }), word).toBe(
						line({ ...over, tty, env }),
					);
				}
	});

	it("is ready in a terminal that draws the ends when the footer draws them", () => {
		expect(line({ env: { TERM: "xterm-kitty" } })).toBe("ready");
		expect(line({ env: { TERM: "xterm-256color", TERM_PROGRAM: "vscode" }, iconFont: true })).toBe("ready");
		expect(
			line({ env: { TERM: "xterm-256color", WT_SESSION: "1" }, saved: { glyphs: "round", from: "terminal" } }),
		).toBe("ready");
		expect(line({ env: { TERM: "xterm-kitty" }, tty: false })).toBe("ready in a dark full-colour terminal");
	});

	it("is check where the footer alone would stay square, or the terminal is not known", () => {
		expect(line({ env: { TERM: "xterm-256color", TERM_PROGRAM: "vscode" } })).toMatch(/^check \(.*--glyphs round/u);
		expect(line({ iconFont: true })).toMatch(/^check \(icon font here, terminal not known; .*--glyphs round/u);
		expect(line({ saved: { glyphs: "round", from: "terminal" } })).toMatch(/^check \(/u);
		expect(line({ iconFont: true, env: { TERM: "xterm-256color", SSH_CONNECTION: "a" } })).toMatch(/^check \(.*SSH/u);
	});

	it.each([
		["no surface enabled", { footer: "off" }],
		["no surface enabled", { footer: "other" }],
		["choice is square", { saved: user("square") }],
		["SSH", { env: { TERM: "xterm-256color", SSH_CONNECTION: "a" } }],
		["Windows console", { platform: "win32" }],
		["no icon font", {}],
		["font not installed \\(the download answered HTTP 404\\)", { fontWhy: "the download answered HTTP 404" }],
	] as const)("is square with a reason and one fix: %s", (reason, over) => {
		expect(line(over as Partial<RoundFacts>)).toMatch(new RegExp(`^square \\(${reason}[^;]*; [^;]+\\)$`, "u"));
	});

	it("counts NO_COLOR, TERM=dumb and few colours only at a terminal", () => {
		for (const env of [{ NO_COLOR: "1", TERM: "xterm-256color" }, { TERM: "dumb" }]) {
			expect(line({ env, saved: user("round") })).toMatch(/^square \(/u);
			expect(line({ env, saved: user("round"), tty: false })).toBe("shown");
		}
		expect(line({ env: { TERM: "xterm" }, iconFont: true })).toMatch(/^square \(.*colours/u);
		expect(line({ env: { TERM: "xterm" }, iconFont: true, tty: false })).toMatch(/^check/u);
		for (const saved of [user("round"), { glyphs: "round", from: "terminal" } as const])
			expect(line({ env: { TERM: "xterm" }, saved })).toBe(
				"square (TERM=xterm has too few colours; use a terminal with 256 colours)",
			);
		expect(line({ env: { TERM: "xterm" }, saved: user("round"), tty: false })).toBe("shown");
		// A saved round does not go by TERM, and these terminals name their colours elsewhere.
		for (const more of [{ COLORTERM: "truecolor" }, { WT_SESSION: "1" }])
			expect(line({ env: { TERM: "xterm", ...more }, saved: user("round") })).toBe("shown");
	});

	it("is saved on Windows where the terminal draws the ends and nothing was chosen", () => {
		const env = (more: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
			const root = mkdtempSync(join(tmpdir(), "litcodex-terminal-round-"));
			roots.push(root);
			return { CODEX_HOME: root, ...more };
		};
		for (const more of [{ WT_SESSION: "1" }, { TERM_PROGRAM: "vscode" }]) {
			const here = env(more);
			expect(saveTerminalRound(here, "win32")).toBe(true);
			expect(savedGlyphs(here)).toEqual({ glyphs: "round", from: "terminal" });
			expect(saveTerminalRound(env(more), "darwin")).toBe(false);
			const chosen = env(more);
			saveGlyphs(chosen, "auto", "user");
			expect(saveTerminalRound(chosen, "win32")).toBe(false);
		}
		expect(saveTerminalRound(env({}), "win32")).toBe(false);
		expect(saveTerminalRound(env({ LITCODEX_HUD_GLYPHS: "round" }), "win32")).toBe(false);
	});

	it("never says a symbols font is found by itself, and stays one line", () => {
		for (const over of [{}, { iconFont: true }, { footer: "off" }, { platform: "win32" }] as Partial<RoundFacts>[]) {
			expect(line(over)).not.toContain("\n");
			expect(line(over)).not.toMatch(/automatically|by itself/iu);
		}
	});
});
