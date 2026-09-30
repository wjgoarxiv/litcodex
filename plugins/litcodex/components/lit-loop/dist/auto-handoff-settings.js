// src/auto-handoff-settings.ts — the user-controlled switch for automatic handoff.
//
// Off by default. The user turns it on with the exact prompt `lit-handoff auto on <percent>` (or sets
// `LITCODEX_AUTO_HANDOFF=1` plus `LITCODEX_AUTO_HANDOFF_PERCENT`), turns it off with
// `lit-handoff auto off`, and reads the state with `lit-handoff auto status`. The percent is never
// hard-coded: `on` without a number reuses the last value the user stored and asks for one when there
// is none. A percent that is not a whole number from 1 to 99 keeps the feature off and is reported.
//
// Command-set values live in `.litcodex/auto-handoff/settings.json` under the project folder. When the
// feature is turned on by command, the same percent is written to the PROJECT `.codex/config.toml` as
// `model_post_turn_compact_threshold_percent`, so Codex itself compacts once the turn that saved the
// handoff is over. The key is written inside a marked block and removed again by `off`; a key the user
// wrote by hand is never touched. Codex reads a project's `.codex/config.toml` only when the project is
// trusted in `$CODEX_HOME/config.toml`, so every claim that Codex compacts also checks that trust.
import { randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
export const AUTO_HANDOFF_FLAG_ENV = "LITCODEX_AUTO_HANDOFF";
export const AUTO_HANDOFF_PERCENT_ENV = "LITCODEX_AUTO_HANDOFF_PERCENT";
export const AUTO_HANDOFF_DIR = ".litcodex/auto-handoff";
export const AUTO_HANDOFF_SETTINGS_FILE = "settings.json";
export const HOST_COMPACT_KEY = "model_post_turn_compact_threshold_percent";
export const HOST_COMPACT_BEGIN = "# litcodex automatic handoff (managed by `lit-handoff auto`; `lit-handoff auto off` removes it)";
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_STORED = Object.freeze({ enabled: false, percent: null });
/** A whole number from 1 to 99 written as plain digits, else null. */
export function parsePercent(raw) {
    const text = raw?.trim() ?? "";
    if (!/^\d{1,2}$/u.test(text))
        return null;
    const value = Number(text);
    return value >= 1 && value <= 99 ? value : null;
}
export function settingsPath(repoRoot) {
    return join(repoRoot, AUTO_HANDOFF_DIR, AUTO_HANDOFF_SETTINGS_FILE);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read a small regular file; null when missing, a symlink, too large, or unreadable. */
export function readSmallFile(path) {
    let fd;
    try {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (stat === undefined || !stat.isFile() || stat.size > MAX_FILE_BYTES)
            return null;
        fd = openSync(path, constants.O_RDONLY | NO_FOLLOW);
    }
    catch {
        return null;
    }
    try {
        return readFileSync(fd, "utf8");
    }
    catch {
        return null;
    }
    finally {
        closeSync(fd);
    }
}
/** The stored choice; a missing, malformed or hand-edited file reads as "off, no percent". */
export function readStoredAutoHandoff(repoRoot) {
    if (!isAbsolute(repoRoot))
        return { stored: DEFAULT_STORED, warning: null };
    const raw = readSmallFile(settingsPath(repoRoot));
    if (raw === null)
        return { stored: DEFAULT_STORED, warning: null };
    try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed))
            throw new Error("not an object");
        const percent = parsed["percent"] === null ? null : parsePercent(String(parsed["percent"]));
        const warning = parsed["percent"] !== null && percent === null
            ? "The stored percent is not a whole number from 1 to 99 and was ignored."
            : null;
        return { stored: { enabled: parsed["enabled"] === true, percent }, warning };
    }
    catch {
        return {
            stored: DEFAULT_STORED,
            warning: `${AUTO_HANDOFF_DIR}/${AUTO_HANDOFF_SETTINGS_FILE} could not be read, so automatic handoff stays off.`,
        };
    }
}
function shown(raw) {
    const clean = raw.replace(/[^\x20-\x7e]/gu, "?");
    return clean.length > 24 ? `${clean.slice(0, 24)}...` : clean;
}
/**
 * Combine the environment with the stored choice. The environment wins when it is set: `=1` turns the
 * feature on and `=0` turns it off. The percent comes from its variable first, then from the stored
 * value. Nothing is active without a valid percent.
 */
export function resolveAutoHandoff(env, stored, storedWarning = null) {
    const warnings = [];
    if (storedWarning !== null)
        warnings.push(storedWarning);
    const flag = env[AUTO_HANDOFF_FLAG_ENV]?.trim() ?? "";
    if (flag !== "" && flag !== "1" && flag !== "0") {
        warnings.push(`${AUTO_HANDOFF_FLAG_ENV}=${shown(flag)} is not 1 or 0 and was ignored.`);
    }
    const envDecision = flag === "1" ? true : flag === "0" ? false : null;
    const enabled = envDecision ?? stored.enabled;
    const rawPercent = env[AUTO_HANDOFF_PERCENT_ENV]?.trim() ?? "";
    const envPercent = rawPercent === "" ? null : parsePercent(rawPercent);
    const envPercentInvalid = rawPercent !== "" && envPercent === null;
    if (envPercentInvalid) {
        warnings.push(`${AUTO_HANDOFF_PERCENT_ENV}=${shown(rawPercent)} is not a whole number from 1 to 99, so automatic handoff stays off.`);
    }
    const percent = envPercentInvalid ? null : (envPercent ?? stored.percent);
    const source = envDecision !== null || envPercent !== null ? "environment" : enabled ? "command" : "default";
    if (enabled && !envPercentInvalid && percent === null) {
        warnings.push(`Automatic handoff is on but has no percent. Run "lit-handoff auto on <percent>" or set ${AUTO_HANDOFF_PERCENT_ENV}.`);
    }
    return { active: enabled && percent !== null, percent, source, warnings };
}
export function loadAutoHandoffState(repoRoot, env) {
    const { stored, warning } = readStoredAutoHandoff(repoRoot);
    return resolveAutoHandoff(env, stored, warning);
}
// ── Safe small-file writes ───────────────────────────────────────────────────
function ensureDir(dir) {
    try {
        const stat = lstatSync(dir, { throwIfNoEntry: false });
        if (stat === undefined) {
            mkdirSync(dir, { recursive: true });
            return true;
        }
        return stat.isDirectory();
    }
    catch {
        return false;
    }
}
/** Atomic write that refuses to go through a symlink or replace anything but a regular file. */
export function writeSmallFile(path, text) {
    if (!ensureDir(dirname(path)))
        return false;
    const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
        const existing = lstatSync(path, { throwIfNoEntry: false });
        if (existing !== undefined && !existing.isFile())
            return false;
        const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o644);
        try {
            writeSync(fd, text);
        }
        finally {
            closeSync(fd);
        }
        renameSync(tmp, path);
        return true;
    }
    catch {
        try {
            unlinkSync(tmp);
        }
        catch {
            // nothing was created
        }
        return false;
    }
}
export function writeStoredAutoHandoff(repoRoot, stored) {
    return writeSmallFile(settingsPath(repoRoot), `${JSON.stringify({ version: 1, ...stored })}\n`);
}
// ── Project config: Codex compacts after the handoff turn ────────────────────
const KEY_LINE = new RegExp(`^\\s*${HOST_COMPACT_KEY}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`, "u");
export function projectConfigPath(repoRoot) {
    return join(repoRoot, ".codex", "config.toml");
}
/** What the project's `.codex/config.toml` says about compacting after a turn. */
export function readProjectCompaction(repoRoot) {
    const raw = readSmallFile(projectConfigPath(repoRoot));
    if (raw === null)
        return { kind: "absent" };
    const lines = raw.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
        const match = KEY_LINE.exec(lines[index] ?? "");
        if (match?.[1] === undefined)
            continue;
        const percent = Number(match[1]);
        return lines[index - 1] === HOST_COMPACT_BEGIN ? { kind: "managed", percent } : { kind: "user-set", percent };
    }
    return { kind: "absent" };
}
function codexHomeDir(env) {
    const fromEnv = env["CODEX_HOME"]?.trim() ?? "";
    return fromEnv === "" ? join(homedir(), ".codex") : fromEnv;
}
/** The project path a `[projects."<path>"]` table header names, else null. */
function projectOfHeader(header) {
    const match = /^\s*projects\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*$/u.exec(header);
    if (match === null)
        return null;
    return match[1] !== undefined ? match[1].replace(/\\(["\\])/gu, "$1") : (match[2] ?? null);
}
/**
 * True when `$CODEX_HOME/config.toml` marks this project trusted. Codex ignores a project's own
 * `.codex/config.toml` until then, so an untrusted project never gets the compaction setting applied.
 */
export function projectTrusted(repoRoot, env) {
    const raw = readSmallFile(join(codexHomeDir(env), "config.toml"));
    if (raw === null)
        return false;
    const wanted = new Set([repoRoot]);
    try {
        wanted.add(realpathSync(repoRoot));
    }
    catch {
        // the plain path is enough
    }
    let current = null;
    for (const line of raw.split(/\r?\n/u)) {
        const header = /^\s*\[(.*)\]\s*(?:#.*)?$/u.exec(line);
        if (header?.[1] !== undefined) {
            current = projectOfHeader(header[1]);
            continue;
        }
        if (current !== null && wanted.has(current) && /^\s*trust_level\s*=\s*["']trusted["']\s*(?:#.*)?$/u.test(line)) {
            return true;
        }
    }
    return false;
}
/** True when Codex itself will compact once a turn ends with usage at or above `percent`. */
export function hostCompactsAt(repoRoot, percent, env) {
    const current = readProjectCompaction(repoRoot);
    return current.kind !== "absent" && current.percent <= percent && projectTrusted(repoRoot, env);
}
/** Write (or update) the marked block. A key the user wrote by hand stays as it is. */
export function writeProjectCompaction(repoRoot, percent) {
    const path = projectConfigPath(repoRoot);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isFile())
        return "failed";
    const raw = stat === undefined ? "" : readSmallFile(path);
    if (raw === null)
        return "failed";
    const current = readProjectCompaction(repoRoot);
    if (current.kind === "user-set")
        return "unchanged-user-key";
    const block = `${HOST_COMPACT_BEGIN}\n${HOST_COMPACT_KEY} = ${percent}\n`;
    if (current.kind === "managed") {
        const lines = raw.split("\n");
        const at = lines.findIndex((line) => KEY_LINE.test(line.replace(/\r$/u, "")));
        lines[at] = `${HOST_COMPACT_KEY} = ${percent}`;
        return writeSmallFile(path, lines.join("\n")) ? "written" : "failed";
    }
    return writeSmallFile(path, raw === "" ? block : `${block}\n${raw}`) ? "written" : "failed";
}
/** Remove only the marked block; delete the file (and an empty `.codex`) when nothing else is left. */
export function removeProjectCompaction(repoRoot) {
    const path = projectConfigPath(repoRoot);
    if (readProjectCompaction(repoRoot).kind !== "managed")
        return "nothing-to-remove";
    const raw = readSmallFile(path);
    if (raw === null)
        return "failed";
    const lines = raw.split("\n");
    const at = lines.findIndex((line) => line.replace(/\r$/u, "") === HOST_COMPACT_BEGIN);
    if (at < 0)
        return "nothing-to-remove";
    lines.splice(at, 2);
    if (lines[at] === "" && (at === 0 || lines[at - 1] === ""))
        lines.splice(at, 1);
    const rest = lines.join("\n");
    if (rest.trim() === "") {
        try {
            unlinkSync(path);
            try {
                rmdirSync(dirname(path));
            }
            catch {
                // other files live there
            }
            return "removed";
        }
        catch {
            return "failed";
        }
    }
    return writeSmallFile(path, rest) ? "removed" : "failed";
}
/** Only the complete prompt `lit-handoff auto ...` (case-insensitive, edge whitespace allowed) is a route. */
export function parseAutoHandoffRoute(prompt) {
    const match = /^\s*lit-handoff\s+auto(?:\s+(.*?))?\s*$/isu.exec(prompt);
    if (match === null)
        return null;
    const words = (match[1] ?? "").split(/\s+/u).filter(Boolean);
    const verb = words[0]?.toLowerCase();
    if (verb === "on" && words.length <= 2)
        return { action: "on", argument: words[1] ?? null };
    if (verb === "off" && words.length === 1)
        return { action: "off" };
    if (verb === "status" && words.length === 1)
        return { action: "status" };
    return { action: "usage" };
}
const USAGE = "Usage: lit-handoff auto on <percent from 1 to 99> | lit-handoff auto off | lit-handoff auto status";
/** Sentence describing how the conversation gets compacted once the handoff is saved. */
function compactionSentence(repoRoot, percent, env) {
    return hostCompactsAt(repoRoot, percent, env)
        ? "Codex compacts the conversation as soon as the turn that saved the handoff ends."
        : "After the handoff is saved you will be asked to run /compact yourself.";
}
export function describeAutoHandoff(repoRoot, state, env) {
    const lines = [];
    if (state.active && state.percent !== null) {
        const origin = state.source === "environment" ? "set by environment variables" : "set by command";
        lines.push(`Automatic handoff is ON at ${state.percent}% (${origin}).`);
        lines.push(compactionSentence(repoRoot, state.percent, env));
    }
    else {
        lines.push("Automatic handoff is OFF.");
        if (state.percent !== null)
            lines.push(`Your last percent is ${state.percent}%; "lit-handoff auto on" turns it back on with that value.`);
    }
    for (const warning of state.warnings)
        lines.push(`Warning: ${warning}`);
    return lines.join(" ");
}
/** Apply a parsed route and return the one message the user sees. Never throws. */
export function applyAutoHandoffRoute(repoRoot, env, route) {
    try {
        if (route.action === "usage")
            return USAGE;
        const { stored } = readStoredAutoHandoff(repoRoot);
        if (route.action === "status")
            return describeAutoHandoff(repoRoot, loadAutoHandoffState(repoRoot, env), env);
        const envNote = (env[AUTO_HANDOFF_FLAG_ENV]?.trim() ?? "") === ""
            ? ""
            : ` ${AUTO_HANDOFF_FLAG_ENV} is set in the environment and takes priority over this command.`;
        if (route.action === "off") {
            if (!writeStoredAutoHandoff(repoRoot, { enabled: false, percent: stored.percent })) {
                return "Automatic handoff could not save its setting (the project folder is not writable), so nothing changed.";
            }
            removeProjectCompaction(repoRoot);
            const kept = stored.percent === null ? "" : ` Your last percent (${stored.percent}%) is kept for next time.`;
            return `Automatic handoff is OFF.${kept}${envNote}`;
        }
        const percent = route.argument === null ? stored.percent : parsePercent(route.argument);
        if (route.argument === null && percent === null) {
            return "Which percent should trigger the handoff? Run: lit-handoff auto on <percent from 1 to 99> (for example 60).";
        }
        if (percent === null)
            return `"${shown(route.argument ?? "")}" is not a whole number from 1 to 99. Nothing changed.`;
        if (!writeStoredAutoHandoff(repoRoot, { enabled: true, percent })) {
            return "Automatic handoff could not save its setting (the project folder is not writable), so nothing changed.";
        }
        const config = writeProjectCompaction(repoRoot, percent);
        const untrusted = config === "written" && !projectTrusted(repoRoot, env)
            ? "Codex reads the project .codex/config.toml only after you trust this project, so until then you will be asked to run /compact yourself."
            : "";
        const asked = config === "unchanged-user-key"
            ? ` Your project .codex/config.toml already sets ${HOST_COMPACT_KEY}, so it was left as it is.`
            : config === "failed"
                ? " The project .codex/config.toml could not be updated, so you will be asked to run /compact yourself."
                : "";
        return `Automatic handoff is ON at ${percent}%. When a conversation reaches ${percent}% of the context window, Codex is asked to save a handoff. ${untrusted === "" ? compactionSentence(repoRoot, percent, env) : untrusted}${asked}${envNote}`;
    }
    catch {
        return "Automatic handoff hit an unexpected error and changed nothing.";
    }
}
