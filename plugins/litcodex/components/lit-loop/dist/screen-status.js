// src/screen-status.ts — the user-level switch for the LIT card's colour.
//
// Off by default. `litcodex screen-status on` colours the LIT card the hooks print, `off` keeps it plain and
// `status` reports the state. The choice lives in `$CODEX_HOME/litcodex/screen-status.json` (else
// `~/.codex`), written atomically and never through a symlink; `LITCODEX_SCREEN_STATUS=1|0` overrides it.
// Codex 0.162.0 and later draw ANSI colour inside hook text in the terminal UI, but the desktop app and IDE
// show the escape codes as raw text, and the hook input does not say which client is attached, hence the
// switch. NO_COLOR keeps the card plain either way; without colour the card has the same rows.
// `light`, `dark`, `truecolor` and `256` fit the colours to the window. They are saved choices because a hook has
// no terminal to ask and runs with the environment of whichever window started Codex's server.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { writeSmallFile } from "./auto-handoff-settings.js";
import { cardCaps } from "./glyph-choice.js";
import { codexHomeFrom, readSmallJson } from "./live-step.js";
export const SCREEN_STATUS_ENV = "LITCODEX_SCREEN_STATUS";
const SETTINGS_DIR = "litcodex";
const SETTINGS_FILE = "screen-status.json";
const MAX_SETTINGS_BYTES = 4_096;
const USAGE_EXIT_CODE = 64;
const VERBS = ["on", "off", "status", "light", "dark", "truecolor", "256"];
const USAGE = "Usage: litcodex screen-status on|off|status or light|dark|truecolor|256\n";
export const SCREEN_STATUS_HELP_TEXT = `litcodex screen-status on|off|status
litcodex screen-status light|dark|truecolor|256

Colour the LIT card the hooks print inside Codex. Off by default.
Only the terminal \`codex\` draws the colour:
the Codex desktop app and IDE extensions show the colour codes as raw text,
so turn it on only if you use the terminal \`codex\`. Without colour the card has the same rows.
A hook cannot see the window, so a white one is a choice: \`light\` keeps every word in the window's own ink, and
\`dark\` (the default) goes back. \`256\` is for a terminal without 24-bit colour, and \`truecolor\` goes back.
The setting is stored in $CODEX_HOME/litcodex/screen-status.json; ${SCREEN_STATUS_ENV}=1 or 0 overrides on and off.
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
    const settings = settingsPath(env);
    const stored = settings === null ? null : readSmallJson(settings.path, MAX_SETTINGS_BYTES);
    const look = isRecord(stored)
        ? {
            ...(stored["light"] === true ? { light: true } : {}),
            ...(stored["depth"] === 256 ? { depth: 256 } : {}),
        }
        : {};
    const flag = env[SCREEN_STATUS_ENV]?.trim() ?? "";
    if (flag === "1" || flag === "0")
        return { enabled: flag === "1", source: "environment", warnings, ...look };
    if (flag !== "")
        warnings.push(`${SCREEN_STATUS_ENV} is not 1 or 0 and was ignored.`);
    if (!isRecord(stored)) {
        if (settings !== null && present(settings.path))
            warnings.push(`${SETTINGS_DIR}/${SETTINGS_FILE} could not be read, so the card stays plain.`);
        return { enabled: false, source: "default", warnings };
    }
    const enabled = stored["enabled"] === true;
    return { enabled, source: enabled ? "command" : "default", warnings, ...look };
}
/** True when the hooks may colour the card: the switch is on and NO_COLOR is unset or empty. */
export function screenColor(env) {
    const noColor = env["NO_COLOR"];
    return readScreenStatus(env).enabled && (noColor === undefined || noColor === "");
}
/** How the hooks draw the card: whether in colour, for which window, and with which pill ends. */
export function screenLook(env) {
    const { light, depth } = readScreenStatus(env);
    return {
        color: screenColor(env),
        ...(cardCaps(env) ? { caps: true } : {}),
        ...(light === undefined ? {} : { light }),
        ...(depth === undefined ? {} : { depth }),
    };
}
/** Saves the choices given beside the ones already stored. */
function writeScreenStatus(env, change) {
    const settings = settingsPath(env);
    if (settings === null)
        return false;
    // The switch itself, whatever the environment says over it.
    const before = readScreenStatus({ ...env, [SCREEN_STATUS_ENV]: undefined });
    const light = change.light ?? before.light === true;
    const depth = change.depth === undefined ? (before.depth ?? null) : change.depth;
    const next = {
        version: 1,
        enabled: change.enabled ?? before.enabled,
        ...(light ? { light } : {}),
        ...(depth === null ? {} : { depth }),
    };
    return writeSmallFile(settings.path, `${JSON.stringify(next)}\n`, settings.home);
}
function describe(state, noColor) {
    const origin = state.source === "environment" ? ` (set by ${SCREEN_STATUS_ENV})` : "";
    const value = state.enabled ? (noColor ? "ON, but NO_COLOR keeps it plain" : "ON") : "OFF";
    const window = `${state.light === true ? ", for a white window" : ""}${state.depth === 256 ? ", in 256 colours" : ""}`;
    const lines = [`LIT card colour is ${value}${window}${origin}.`];
    for (const warning of state.warnings)
        lines.push(`Warning: ${warning}`);
    return `${lines.join("\n")}\n`;
}
const CHANGES = {
    on: { enabled: true },
    off: { enabled: false },
    light: { light: true },
    dark: { light: false },
    truecolor: { depth: null },
    256: { depth: 256 },
};
/** `litcodex screen-status <verb>`; resolves an exit code and never throws. */
export function screenStatusCommand(args, io) {
    const [first, ...extra] = args;
    if (first === "--help" || first === "-h") {
        io.stdout.write(SCREEN_STATUS_HELP_TEXT);
        return 0;
    }
    const verb = VERBS.find((known) => known === first);
    if (verb === undefined || extra.length > 0) {
        io.stderr.write(USAGE);
        return USAGE_EXIT_CODE;
    }
    if (verb === "status") {
        const noColor = io.env["NO_COLOR"] !== undefined && io.env["NO_COLOR"] !== "";
        io.stdout.write(describe(readScreenStatus(io.env), noColor));
        return 0;
    }
    if (!writeScreenStatus(io.env, CHANGES[verb])) {
        io.stderr.write("litcodex screen-status: the setting could not be saved, so nothing changed.\n");
        return 1;
    }
    const state = readScreenStatus(io.env);
    if (verb !== "on" && verb !== "off") {
        const said = {
            light: "The LIT card's colours are for a white window now. Go back: litcodex screen-status dark",
            dark: "The LIT card's colours are for a dark window.",
            truecolor: "The LIT card draws 24-bit colour.",
            256: "The LIT card draws 256 colours now. Go back: litcodex screen-status truecolor",
        }[verb];
        const off = state.enabled ? "" : " The colour itself is off; litcodex screen-status on turns it on.";
        io.stdout.write(`${said}${off}\n`);
        return 0;
    }
    const overridden = state.source === "environment"
        ? ` ${SCREEN_STATUS_ENV} is set in the environment and takes priority over this setting.`
        : "";
    const note = verb === "on"
        ? " The Codex desktop app and IDE show colour codes as raw text; use it with the terminal `codex`."
        : "";
    io.stdout.write(`LIT card colour is ${verb === "on" ? "ON" : "OFF"}.${note}${overridden}\n`);
    return 0;
}
