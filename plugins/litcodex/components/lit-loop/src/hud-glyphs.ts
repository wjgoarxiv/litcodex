// src/hud-glyphs.ts — whether pills and gauges of the HUD and the installer end in round caps (U+E0B6, U+E0B4).
//
// The choice (glyph-choice.ts) is `round` (always), `square` (never) or `auto`: round in a terminal known to draw
// the caps itself, or when an icon font is installed on this machine, told by font file names alone. Over SSH
// the fonts here are not the ones on screen, so only the terminal's own word counts; a chosen `round` holds there too.

import { readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { chosenGlyphs } from "./glyph-choice.js";

const MAX_ENTRIES = 4_000;
const MAX_DEPTH = 3;
const FONT_FILE = /\.(?:ttf|otf|ttc)$/iu;
const ICON_FONT = /[Nn]erd[ _-]?[Ff]ont|[a-z0-9 _-]NF[MP]?[ _.-]/u;

/** Terminals that draw the two caps without any font. */
export function drawsRoundCaps(env: NodeJS.ProcessEnv): boolean {
	return (env["WT_SESSION"] ?? "") !== "" || env["TERM_PROGRAM"] === "vscode";
}

/** Whether every pill, gauge and button uses the caps: the one answer for the HUD and the installer. */
export function roundGlyphs(env: NodeJS.ProcessEnv, iconFont: () => boolean = () => hasIconFont(env)): boolean {
	const chosen = chosenGlyphs(env);
	if (chosen !== "auto") return chosen === "round";
	if (terminalDrawsCaps(env)) return true;
	if ((env["SSH_CONNECTION"] ?? "") !== "") return false;
	return iconFont();
}

/** Whether this terminal is known to draw the caps, with or without a font. */
export function terminalDrawsCaps(env: NodeJS.ProcessEnv): boolean {
	if (drawsRoundCaps(env) || /^(?:wezterm|ghostty)$/iu.test(env["TERM_PROGRAM"] ?? "")) return true;
	return env["TERM"] === "xterm-kitty" || (env["KITTY_WINDOW_ID"] ?? "") !== "";
}

/** `XDG_DATA_HOME` when it is usable: its specification says to ignore a relative one. */
export function xdgDataHome(env: NodeJS.ProcessEnv): string | null {
	const dir = env["XDG_DATA_HOME"] ?? "";
	return isAbsolute(dir) ? dir : null;
}

function fontFolders(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
	const under = (base: string | undefined, ...parts: string[]): string[] => (base ? [join(base, ...parts)] : []);
	const home = env["HOME"];
	if (platform === "darwin") return [...under(home, "Library", "Fonts"), "/Library/Fonts"];
	if (platform === "win32")
		return [...under(env["LOCALAPPDATA"], "Microsoft", "Windows", "Fonts"), ...under(env["WINDIR"], "Fonts")];
	const data = xdgDataHome(env);
	return [
		...(data === null ? under(home, ".local", "share", "fonts") : under(data, "fonts")),
		...under(home, ".fonts"),
		"/usr/local/share/fonts",
		"/usr/share/fonts",
	];
}

/** Whether a font file named like a Nerd Font is installed; at most `limit` names, no links, false on any doubt. */
export function hasIconFont(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
	folders: readonly string[] = fontFolders(env, platform),
	limit: number = MAX_ENTRIES,
): boolean {
	let left = limit;
	let level = [...folders];
	for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
		const next: string[] = [];
		for (const folder of level) {
			let entries: ReturnType<typeof list>;
			try {
				entries = list(folder);
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (left-- <= 0) return false;
				if (entry.isDirectory()) next.push(join(folder, entry.name));
				else if (entry.isFile() && FONT_FILE.test(entry.name) && ICON_FONT.test(entry.name)) return true;
			}
		}
		level = next;
	}
	return false;
}

const list = (folder: string) => readdirSync(folder, { withFileTypes: true });
