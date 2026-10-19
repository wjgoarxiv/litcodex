// src/screen-status.ts — the user-level switch for the LIT card's colour.
//
// Off by default. `litcodex screen-status on` colours the LIT card the hooks print, `off` keeps it plain and
// `status` reports the state. The choice lives in `$CODEX_HOME/litcodex/screen-status.json` (else
// `~/.codex`), written atomically and never through a symlink; `LITCODEX_SCREEN_STATUS=1|0` overrides it.
// Codex 0.162.0 and later draw ANSI colour inside hook text in the terminal UI, but the desktop app and IDE
// show the escape codes as raw text, and the hook input does not say which client is attached, hence the
// switch. NO_COLOR keeps the card plain either way; without colour the card has the same rows.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { writeSmallFile } from "./auto-handoff-settings.js";
import { codexHomeFrom, readSmallJson } from "./live-step.js";
export const SCREEN_STATUS_ENV = "LITCODEX_SCREEN_STATUS";
const SETTINGS_DIR = "litcodex";
const SETTINGS_FILE = "screen-status.json";
const MAX_SETTINGS_BYTES = 4_096;
const USAGE_EXIT_CODE = 64;
export const SCREEN_STATUS_HELP_TEXT = `litcodex screen-status on|off|status

Colour the LIT card the hooks print inside Codex. Off by default.
Only the terminal \`codex\` draws the colour:
the Codex desktop app and IDE extensions show the colour codes as raw text,
so turn it on only if you use the terminal \`codex\`. Without colour the card has the same rows.
The setting is stored in $CODEX_HOME/litcodex/screen-status.json; ${SCREEN_STATUS_ENV}=1 or 0 overrides it.
NO_COLOR keeps the card plain.
`;
function settingsPath(env) {
    const home = codexHomeFrom(env);
    return home === null ? null : { home, path: join(home, SETTINGS_DIR, SETTINGS_FILE) };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** True when something sits at `path`, readable or not. */
function present(path) {
    try {
        return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
    }
    catch {
        return true;
    }
}
/** The stored choice and the environment override; a missing, corrupt or linked file reads as off. */
export function readScreenStatus(env) {
    const warnings = [];
    const flag = env[SCREEN_STATUS_ENV]?.trim() ?? "";
    if (flag === "1" || flag === "0")
        return { enabled: flag === "1", source: "environment", warnings };
    if (flag !== "")
        warnings.push(`${SCREEN_STATUS_ENV} is not 1 or 0 and was ignored.`);
    const settings = settingsPath(env);
    if (settings === null)
        return { enabled: false, source: "default", warnings };
    const stored = readSmallJson(settings.path, MAX_SETTINGS_BYTES);
    if (!isRecord(stored)) {
        if (present(settings.path))
            warnings.push(`${SETTINGS_DIR}/${SETTINGS_FILE} could not be read, so the card stays plain.`);
        return { enabled: false, source: "default", warnings };
    }
    const enabled = stored["enabled"] === true;
    return { enabled, source: enabled ? "command" : "default", warnings };
}
/** True when the hooks may colour the card: the switch is on and NO_COLOR is unset or empty. */
export function screenColor(env) {
    const noColor = env["NO_COLOR"];
    return readScreenStatus(env).enabled && (noColor === undefined || noColor === "");
}
export function writeScreenStatus(env, enabled) {
    const settings = settingsPath(env);
    if (settings === null)
        return false;
    return writeSmallFile(settings.path, `${JSON.stringify({ version: 1, enabled })}\n`, settings.home);
}
function describe(state, noColor) {
    const origin = state.source === "environment" ? ` (set by ${SCREEN_STATUS_ENV})` : "";
    const value = state.enabled ? (noColor ? "ON, but NO_COLOR keeps it plain" : "ON") : "OFF";
    const lines = [`LIT card colour is ${value}${origin}.`];
    for (const warning of state.warnings)
        lines.push(`Warning: ${warning}`);
    return `${lines.join("\n")}\n`;
}
/** `litcodex screen-status on|off|status`; resolves an exit code and never throws. */
export function screenStatusCommand(args, io) {
    const [verb, ...extra] = args;
    if (verb === "--help" || verb === "-h") {
        io.stdout.write(SCREEN_STATUS_HELP_TEXT);
        return 0;
    }
    if ((verb !== "on" && verb !== "off" && verb !== "status") || extra.length > 0) {
        io.stderr.write("Usage: litcodex screen-status on|off|status\n");
        return USAGE_EXIT_CODE;
    }
    if (verb === "status") {
        const noColor = io.env["NO_COLOR"] !== undefined && io.env["NO_COLOR"] !== "";
        io.stdout.write(describe(readScreenStatus(io.env), noColor));
        return 0;
    }
    if (!writeScreenStatus(io.env, verb === "on")) {
        io.stderr.write("litcodex screen-status: the setting could not be saved, so nothing changed.\n");
        return 1;
    }
    const overridden = readScreenStatus(io.env).source === "environment"
        ? ` ${SCREEN_STATUS_ENV} is set in the environment and takes priority over this setting.`
        : "";
    const note = verb === "on"
        ? " The Codex desktop app and IDE show colour codes as raw text; use it with the terminal `codex`."
        : "";
    io.stdout.write(`LIT card colour is ${verb === "on" ? "ON" : "OFF"}.${note}${overridden}\n`);
    return 0;
}
