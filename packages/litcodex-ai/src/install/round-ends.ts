// The `ROUND_ENDS:` line at the end of install, update and doctor: whether the person sees round pill ends, and the one
// thing that changes it. `shown` is said only after the person confirmed them with `--glyphs round`; nothing here can
// see the screen.
//
// The surfaces that stay on screen are the sunset footer and, with a saved `round`, the coloured chat card. Both are
// drawn by processes that see almost nothing of the terminal's environment: the LITCODEX_HUD_GLYPHS of the shell that
// installs says nothing about them, and the footer server knows a terminal by TERM alone.

import {
	GLYPHS_ENV,
	glyphsWord,
	type SavedGlyphs,
	savedGlyphs,
	saveGlyphs,
} from "@litcodex/lit-loop/dist/glyph-choice.js";
import { drawsTruecolor } from "@litcodex/lit-loop/dist/ground.js";
import { drawsRoundCaps, hasIconFont, terminalDrawsCaps } from "@litcodex/lit-loop/dist/hud-glyphs.js";
import { readScreenStatus } from "@litcodex/lit-loop/dist/screen-status.js";
import { fillsPills } from "@litcodex/lit-loop/dist/sunset-footer.js";
import { sunsetSurface } from "../sunset.js";
import { RUN } from "./agent-guide.js";

export interface RoundFacts {
	readonly env: NodeJS.ProcessEnv;
	readonly platform: NodeJS.Platform;
	/** stdout is a terminal, so what it says about colour is about the person's own window. */
	readonly tty: boolean;
	readonly footer: "on" | "off" | "other";
	/** The chat card is coloured. */
	readonly card: boolean;
	readonly saved: SavedGlyphs | null;
	readonly iconFont: boolean;
	/** Why `--round` added no font in this run. */
	readonly fontWhy?: string | undefined;
}

const again = (flags: string): string => `run your install line again with ${flags}`;
const square = (reason: string, fix: string): string => `square (${reason}; ${fix})`;
const check = (why: string, fix: string): string => `check (${why}; ${fix})`;

const CONFIRM = `if both ends of  LIT  are round, ${again("--glyphs round")}`;

/** The words after `ROUND_ENDS: `. */
export function roundEnds(facts: RoundFacts): string {
	const { env, saved, tty } = facts;
	const ready = tty ? "ready" : "ready in a dark full-colour terminal";
	if (facts.footer !== "on" && !(facts.card && saved?.glyphs === "round"))
		return facts.footer === "other"
			? square(
					"no surface enabled, config.toml sets another status line",
					"pick LIT sunset with /statusline in Codex",
				)
			: square("no surface enabled, the LIT sunset footer is off", `turn it on with ${RUN} sunset on`);
	if (saved?.glyphs === "square") return square("choice is square", again("--glyphs auto"));
	if (tty && (env["NO_COLOR"] ?? "") !== "") return square("NO_COLOR is set", "unset it and start Codex again");
	if (tty && /^dumb$/iu.test(env["TERM"] ?? "")) return square("TERM=dumb", "use a full terminal");
	const draws = terminalDrawsCaps(env);
	const fewColours = square(`TERM=${env["TERM"] ?? ""} has too few colours`, "use a terminal with 256 colours");
	if (saved?.glyphs === "round") {
		// A saved round is drawn whatever TERM says, so here a terminal may name its colours elsewhere too.
		if (tty && !fillsPills(env) && !drawsTruecolor(env)) return fewColours;
		if (saved.from === "user") return "shown";
		return draws ? ready : check("saved for another terminal", CONFIRM);
	}
	if (facts.platform === "win32" && !draws)
		return square("Windows console", "run your install line again in Windows Terminal or VS Code");
	if (tty && !fillsPills(env)) return fewColours;
	const footerRound = facts.iconFont || env["TERM"] === "xterm-kitty";
	if (draws) return footerRound ? ready : check("the footer cannot see this terminal", CONFIRM);
	const ssh = (env["SSH_CONNECTION"] ?? "") !== "";
	if (facts.iconFont)
		return check(ssh ? "over SSH the font on your own screen counts" : "icon font here, terminal not known", CONFIRM);
	if (facts.fontWhy !== undefined) return square(`font not installed (${facts.fontWhy})`, again("--round"));
	if (ssh) return square("SSH", CONFIRM);
	return square("no icon font", again("--round"));
}

/**
 * On Windows no font is added: a run with `--round` inside Windows Terminal or VS Code, which draw the ends themselves,
 * saves `round` for the surfaces that cannot see the terminal. A choice already saved stays.
 */
export function saveTerminalRound(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): boolean {
	if (platform !== "win32" || !drawsRoundCaps(env) || glyphsWord(env[GLYPHS_ENV]) === "square") return false;
	if (savedGlyphs(env) !== null) return false;
	return saveGlyphs(env, "round", "terminal");
}

/** The whole line for this machine and this Codex home. */
export function roundEndsLine(input: {
	readonly env: NodeJS.ProcessEnv;
	readonly tty: boolean;
	readonly platform?: NodeJS.Platform;
	readonly fontWhy?: string | undefined;
}): string {
	const { env, tty, fontWhy } = input;
	const platform = input.platform ?? process.platform;
	const words = roundEnds({
		env,
		platform,
		tty,
		footer: sunsetSurface(env),
		card: readScreenStatus(env).enabled,
		saved: savedGlyphs(env),
		iconFont: hasIconFont(env, platform),
		fontWhy,
	});
	return `ROUND_ENDS: ${words}`;
}
