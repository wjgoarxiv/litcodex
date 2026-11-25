// src/run-panel.ts — the LIT panel `litcodex run` draws in the rows below Codex.
//
// On a dark truecolor terminal of at least 60×24 it is the sunset card of `litcodex hud` (hud-card.ts), seven rows or
// nine in a high window; its sun and sea move while LIT works. Anywhere else it is four plain rows (screen-card.ts):
// the route with the turn's clock, the stage path, the running step, and the open checklist row. The session is the
// newest one whose thread pointer names the folder `litcodex run` started in and whose LIT activity is newer than the
// run, read the way `litcodex hud` reads it (hud.ts) with `rollout: false`, so no Codex rollout is opened. Until then
// the panel says what to type. Record text is stripped of control characters and every row is cut to the width given.
// The escape strings that place the panel save and restore the cursor around it and leave Codex's own rows alone.
// Nothing here writes a file.
import { realpathSync } from "node:fs";
import { clock, readCardStatus } from "./card-status.js";
import { clean, cleanStatus, fit, listSessions, tilde } from "./hud.js";
import { composeCard } from "./hud-card.js";
import { roundGlyphs } from "./hud-glyphs.js";
import { changedRuns, rowText } from "./hud-paint.js";
import { renderScreenCard } from "./screen-card.js";
import { readChecklist } from "./workflow-map.js";
/** Rows of the plain panel below Codex. */
export const PANEL_ROWS = 4;
/** Rows of the sunset card, and of the taller one a high window has room for. */
export const SCENE_ROWS = 7;
export const TALL_SCENE_ROWS = 9;
/** The panel needs room for its own rows and a usable Codex above them. */
export const MIN_RUN_ROWS = 12;
export const MIN_RUN_COLUMNS = 40;
/** The sunset card asks for more: its sun needs 60 columns, and Codex keeps at least 17 rows. */
const MIN_SCENE_ROWS = 24;
const MIN_TALL_ROWS = 34;
const MIN_SCENE_COLUMNS = 60;
const ACCENT = "\u001b[38;2;255;155;94m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";
const MIN_WIDTH = 20;
/** How many rows the panel takes in a window of this size; `scene` when the terminal can draw the sunset. */
export function panelRows(size, scene) {
    if (!scene || size.rows < MIN_SCENE_ROWS || size.columns < MIN_SCENE_COLUMNS)
        return PANEL_ROWS;
    return size.rows < MIN_TALL_ROWS ? SCENE_ROWS : TALL_SCENE_ROWS;
}
const WAITING = { status: null, checklist: null };
function realOrSame(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return path;
    }
}
/** What the panel shows now for a run started in `cwd` at `since`. Never throws and never writes. */
export function readRunPanel(env, cwd, since, now) {
    try {
        const real = realOrSame(cwd);
        const session = listSessions(env).find((candidate) => (candidate.cwd === cwd || candidate.cwd === real) && candidate.activeAt >= since);
        if (session === undefined)
            return WAITING;
        const status = readCardStatus(session.id, env, now, { rollout: false });
        if (status.state === "ready")
            return WAITING;
        const rows = readChecklist(session.cwd, session.id);
        const checklist = rows.find((row) => row.state === "current") ??
            rows.find((row) => row.state === "pending") ??
            rows.at(-1) ??
            null;
        const lastSeen = Math.min(now, session.activeAt);
        return {
            status: cleanStatus(status),
            checklist,
            session: { id: session.id, folder: tilde(session.cwd, env["HOME"]), lastSeen },
        };
    }
    catch {
        return WAITING;
    }
}
function stepText(status, now) {
    if (status.step !== null)
        return { text: `Running: ${clean(status.step.tool)}, ${clock(now - status.step.startedAt)}`, live: true };
    if (status.working)
        return { text: "Thinking", live: true };
    if (status.look === "turn")
        return { text: "Your turn: answer Codex above", live: false };
    if (status.state === "complete")
        return { text: "Turn done", live: false };
    return { text: "Waiting for your next message", live: false };
}
/** Exactly `PANEL_ROWS` rows, each at most `width` cells. Pure. */
export function renderRunPanel(view, options) {
    const width = Math.max(MIN_WIDTH, Math.floor(options.width));
    const status = view.status;
    if (status === null) {
        const rows = ["🔥 LIT · ready", "Type `lit <task>` in Codex to start.", "", ""];
        return rows.map((row) => {
            const line = fit(row, width);
            return options.color && line !== "" ? `${DIM}${line}${RESET}` : line;
        });
    }
    const started = status.turnStartedAt ?? status.ignitedAt ?? options.now;
    const elapsed = clock((status.turnEndedAt ?? options.now) - started);
    const hasMap = status.map !== null && status.map.cells.length > 0;
    const card = renderScreenCard({
        mode: status.mode ?? "lit",
        note: status.state === "complete" ? `done ✓ ${elapsed}` : elapsed,
        look: status.look ?? null,
        map: status.map,
        checklist: view.checklist === null ? [] : [view.checklist],
    }, { color: options.color, width, horizon: false }).split("\n");
    const step = stepText(status, options.now);
    const line = fit(step.text, width);
    const stepRow = options.color ? `${step.live ? ACCENT : DIM}${line}${RESET}` : line;
    return [card[0] ?? "", hasMap ? (card[1] ?? "") : "", stepRow, view.checklist === null ? "" : (card.at(-1) ?? "")];
}
export function createRunScene(env, cwd, since, now) {
    // Looked up once: fonts and the terminal do not change under a running panel.
    const caps = roundGlyphs(env);
    let card = null;
    let drawn = [];
    let seconds = 0;
    let lastAt = now();
    /** The scene's clock runs only while LIT works, so it resumes from where it stopped. */
    const advance = () => {
        const at = now();
        if (card?.moving === true)
            seconds += Math.max(0, Math.min(200, at - lastAt)) / 1_000;
        lastAt = at;
    };
    return {
        read({ rows, width }) {
            advance();
            const { status, session } = readRunPanel(env, cwd, since, now());
            const view = { wanted: null, session: session ?? null, status, unreadable: [] };
            card = composeCard(view, { width, rows, caps, now: now(), docked: true });
        },
        rows() {
            advance();
            drawn = card?.paint(seconds) ?? [];
            // The frame's right edge is placed by column, so odd-width text never moves it.
            return drawn.map((row) => `${rowText(row.slice(0, -1), true)}\u001b[${row.length}G${rowText(row.slice(-1), true)}`);
        },
        changes(top) {
            advance();
            const before = drawn;
            drawn = card?.paint(seconds) ?? [];
            return drawn.map((row, y) => changedRuns(before[y] ?? [], row, top + y)).join("");
        },
        get moving() {
            return card?.moving === true;
        },
    };
}
/** The escapes that draw `rows` below a child of `childRows` rows and put the cursor back where it was. */
export function panelFrame(rows, options) {
    let out = "\u001b7\u001b[?25l";
    rows.forEach((row, index) => {
        out += `\u001b[${options.childRows + 1 + index};1H\u001b[0m${row}\u001b[K`;
    });
    return `${out}\u001b8${options.cursorVisible ? "\u001b[?25h" : ""}`;
}
/** The escapes that give the whole screen back: no scroll region, empty panel rows, cursor below the child. */
export function panelClear(childRows, height = PANEL_ROWS) {
    let out = "\u001b[r\u001b[0m";
    for (let index = 0; index < height; index++)
        out += `\u001b[${childRows + 1 + index};1H\u001b[2K`;
    return `${out}\u001b[${childRows + 1};1H\u001b[?25h`;
}
