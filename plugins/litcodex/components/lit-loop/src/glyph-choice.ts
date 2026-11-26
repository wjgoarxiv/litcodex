// src/glyph-choice.ts — the pill ends the person chose, for every surface that draws them.
//
// `litcodex install --glyphs auto|round|square` saves the choice in `$CODEX_HOME/litcodex/glyphs.json` (else
// `~/.codex`). It is a file because the footer server and the hooks get almost none of the terminal's environment.
// `LITCODEX_HUD_GLYPHS` wins over it where a surface does see the environment, and `auto` decides by the terminal and
// the fonts (hud-glyphs.ts). `from` says who chose: the person, or the installer inside a terminal known to draw the
// caps. The file is written in one step and never through a link.

import { lstatSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { writeSmallFile } from "./auto-handoff-settings.js";
import { codexHomeFrom, readSmallJson } from "./live-step.js";

export const GLYPHS_ENV = "LITCODEX_HUD_GLYPHS";
export const GLYPH_CHOICES = ["auto", "round", "square"] as const;
export type GlyphChoice = (typeof GLYPH_CHOICES)[number];

export interface SavedGlyphs {
	readonly glyphs: GlyphChoice;
	readonly from: "user" | "terminal";
}

const MAX_BYTES = 4_096;
const WORDS: Readonly<Record<string, GlyphChoice>> = {
	auto: "auto",
	round: "round",
	nerd: "round",
	square: "square",
	basic: "square",
};

/** The choice a word of the environment names; null when it names none. */
export function glyphsWord(value: string | undefined): GlyphChoice | null {
	const word = (value ?? "").trim().toLowerCase();
	return Object.hasOwn(WORDS, word) ? (WORDS[word] ?? null) : null;
}

/** Windows gives a server no HOME, and Codex's own home is then under the user profile. */
function glyphsHome(env: NodeJS.ProcessEnv): string | null {
	const home = codexHomeFrom(env);
	if (home !== null) return home;
	const profile = env["USERPROFILE"]?.trim() ?? "";
	return profile !== "" && isAbsolute(profile) ? join(profile, ".codex") : null;
}

export function glyphsPath(env: NodeJS.ProcessEnv): string | null {
	const home = glyphsHome(env);
	return home === null ? null : join(home, "litcodex", "glyphs.json");
}

/** The saved choice; a missing, corrupt or linked file is none, and so is one in a linked folder. */
export function savedGlyphs(env: NodeJS.ProcessEnv): SavedGlyphs | null {
	const path = glyphsPath(env);
	const stored = path === null || stateFileProblem(path) !== null ? null : readSmallJson(path, MAX_BYTES);
	if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
	const { glyphs, from } = stored as Record<string, unknown>;
	const choice = GLYPH_CHOICES.find((known) => known === glyphs);
	return choice === undefined ? null : { glyphs: choice, from: from === "terminal" ? "terminal" : "user" };
}

/** Why the choice cannot be saved, checked before an install writes anything; null when it can. */
export function glyphsProblem(env: NodeJS.ProcessEnv): string | null {
	const path = glyphsPath(env);
	return path === null ? "there is no Codex home to save it in" : stateFileProblem(path);
}

/** Why a state file is not to be written: it or its folder is a link, or something else stands in its place. */
export function stateFileProblem(path: string): string | null {
	for (const [at, isWanted] of [
		[dirname(path), "isDirectory"],
		[path, "isFile"],
	] as const) {
		try {
			const stat = lstatSync(at, { throwIfNoEntry: false });
			if (stat !== undefined && !stat[isWanted]())
				return stat.isSymbolicLink()
					? `${at} is a link`
					: `${at} is not a ${isWanted === "isFile" ? "file" : "folder"}`;
		} catch {
			return `${at} cannot be read`;
		}
	}
	return null;
}

export function saveGlyphs(env: NodeJS.ProcessEnv, glyphs: GlyphChoice, from: SavedGlyphs["from"]): boolean {
	const path = glyphsPath(env);
	if (path === null || glyphsProblem(env) !== null) return false;
	return writeSmallFile(path, `${JSON.stringify({ version: 1, glyphs, from })}\n`, dirname(dirname(path)));
}

/** Forgets the choice; a link or anything that is no regular file stays. */
export function removeGlyphs(env: NodeJS.ProcessEnv): void {
	const path = glyphsPath(env);
	if (path === null || glyphsProblem(env) !== null) return;
	try {
		unlinkSync(path);
	} catch {
		// nothing was saved
	}
}

/** The environment's word, else the saved choice, else auto. */
export function chosenGlyphs(env: NodeJS.ProcessEnv): GlyphChoice {
	return glyphsWord(env[GLYPHS_ENV]) ?? savedGlyphs(env)?.glyphs ?? "auto";
}

/** Whether the chat card's pills end round: only where the saved choice says so, since a hook cannot see the window. */
export function cardCaps(env: NodeJS.ProcessEnv): boolean {
	return savedGlyphs(env)?.glyphs === "round" && (glyphsWord(env[GLYPHS_ENV]) ?? "round") === "round";
}
