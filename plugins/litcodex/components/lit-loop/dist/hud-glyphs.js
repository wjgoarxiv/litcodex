// src/hud-glyphs.ts — whether pills and gauges of the HUD end in round caps (U+E0B6, U+E0B4).
//
// `LITCODEX_HUD_GLYPHS` is `nerd` (always round), `basic` (never) or `auto`: round in a terminal known to draw
// the caps itself, or when an icon font is installed on this machine, told by font file names alone. Over SSH
// the fonts here are not the ones on screen, so only the terminal's own word counts.
import { readdirSync } from "node:fs";
import { join } from "node:path";
const MAX_ENTRIES = 4_000;
const MAX_DEPTH = 3;
const FONT_FILE = /\.(?:ttf|otf|ttc)$/iu;
const ICON_FONT = /[Nn]erd[ _-]?[Ff]ont|[a-z0-9 _-]NF[MP]?[ _.-]/u;
function setting(env) {
    const value = (env["LITCODEX_HUD_GLYPHS"] ?? "").toLowerCase();
    return value === "nerd" || value === "basic" ? value : "auto";
}
/** Terminals that draw the two caps without any font. */
export function drawsRoundCaps(env) {
    return (env["WT_SESSION"] ?? "") !== "" || env["TERM_PROGRAM"] === "vscode";
}
/** Whether the plain lines of a narrow window use the caps. */
export function narrowRoundCaps(env) {
    const chosen = setting(env);
    return chosen === "auto" ? drawsRoundCaps(env) : chosen === "nerd";
}
/** Whether the card uses the caps. */
export function roundGlyphs(env, iconFont = () => hasIconFont(env)) {
    const chosen = setting(env);
    if (chosen !== "auto")
        return chosen === "nerd";
    if (drawsRoundCaps(env) || /^(?:wezterm|ghostty)$/iu.test(env["TERM_PROGRAM"] ?? ""))
        return true;
    if (env["TERM"] === "xterm-kitty" || (env["KITTY_WINDOW_ID"] ?? "") !== "")
        return true;
    if ((env["SSH_CONNECTION"] ?? "") !== "")
        return false;
    return iconFont();
}
function fontFolders(env, platform) {
    const under = (base, ...parts) => (base ? [join(base, ...parts)] : []);
    const home = env["HOME"];
    if (platform === "darwin")
        return [...under(home, "Library", "Fonts"), "/Library/Fonts"];
    if (platform === "win32")
        return [...under(env["LOCALAPPDATA"], "Microsoft", "Windows", "Fonts"), ...under(env["WINDIR"], "Fonts")];
    return [
        ...(env["XDG_DATA_HOME"] ? under(env["XDG_DATA_HOME"], "fonts") : under(home, ".local", "share", "fonts")),
        ...under(home, ".fonts"),
        "/usr/local/share/fonts",
        "/usr/share/fonts",
    ];
}
/** Whether a font file named like a Nerd Font is installed; at most `limit` names, no links, false on any doubt. */
export function hasIconFont(env, platform = process.platform, folders = fontFolders(env, platform), limit = MAX_ENTRIES) {
    let left = limit;
    let level = [...folders];
    for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
        const next = [];
        for (const folder of level) {
            let entries;
            try {
                entries = list(folder);
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (left-- <= 0)
                    return false;
                if (entry.isDirectory())
                    next.push(join(folder, entry.name));
                else if (entry.isFile() && FONT_FILE.test(entry.name) && ICON_FONT.test(entry.name))
                    return true;
            }
        }
        level = next;
    }
    return false;
}
const list = (folder) => readdirSync(folder, { withFileTypes: true });
