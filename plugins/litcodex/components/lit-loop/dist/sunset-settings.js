// src/sunset-settings.ts — what LitCodex remembers about the sunset footer, and the one hint about it.
//
// `$CODEX_HOME/litcodex/sunset.json` says what the person chose (`on`, `off`, or null while only the hint was
// shown) and what `litcodex sunset on` found in config.toml, so `off` can put it back. The hint is one line
// under a LIT activation; once the file exists it never comes again.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { writeSmallFile } from "./auto-handoff-settings.js";
import { codexHomeFrom, readSmallJson } from "./live-step.js";
const MAX_BYTES = 4_096;
export const SUNSET_HINT = "☀ New: a live LIT sunset under Codex. Run `npx @litfamily/litcodex sunset on`, then start Codex again.";
export const NO_RECORD = { choice: null, featureBefore: null, added: [] };
function sunsetPath(home) {
    return join(home, "litcodex", "sunset.json");
}
export function readSunsetRecord(home) {
    const stored = readSmallJson(sunsetPath(home), MAX_BYTES);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored))
        return null;
    const { choice, featureBefore, added } = stored;
    return {
        choice: choice === "on" || choice === "off" ? choice : null,
        featureBefore: featureBefore === "true" || featureBefore === "false" ? featureBefore : null,
        added: Array.isArray(added) ? added.filter((item) => item === "[features]" || item === "[tui]") : [],
    };
}
export function writeSunsetRecord(home, record) {
    return writeSmallFile(sunsetPath(home), `${JSON.stringify({ version: 1, ...record })}\n`, home);
}
function exists(path) {
    try {
        return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
    }
    catch {
        return true;
    }
}
/** The hint, the first time only; null when it was shown, answered, or cannot be remembered. */
export function takeSunsetHint(env) {
    const home = codexHomeFrom(env);
    if (home === null || !exists(join(home, "config.toml")) || exists(sunsetPath(home)))
        return null;
    return writeSunsetRecord(home, NO_RECORD) ? SUNSET_HINT : null;
}
