// src/screen-card.ts — the LIT card the hooks print inside the Codex screen.
//
// A few `┃` rows in a hook `systemMessage`: the route (`🔥 LIT · <mode>` and a short note), the stage map,
// then at most three checklist rows around the open task. The same rows come out as plain text (emoji and
// `┃` only) unless colour is asked for; the caller asks only when `screen-status` is on and
// NO_COLOR is unset, because only the terminal UI is known to draw the escapes. Record-derived text is
// stripped of control characters and every row is cut to the width given.
import { LOOKS, lookOf } from "./card-looks.js";
import { clean, displayWidth, fit } from "./hud.js";
import { progressBar, readChecklist, readWorkflowSignals, workflowMapCells, } from "./workflow-map.js";
import { readStack, stackRow } from "./workflow-stack.js";
const ACCENT = "\u001b[38;2;255;155;94m";
const GREEN = "\u001b[38;2;107;196;109m";
const AMBER = "\u001b[38;2;255;175;60m";
const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";
/** Codex indents hook rows by four cells; the card stays inside a common terminal width. */
export const DEFAULT_CARD_WIDTH = 96;
const MIN_CARD_WIDTH = 20;
const MAX_CHECKLIST = 3;
const seg = (text, style = "") => ({ text, style });
/** One stage as the card, the `litcodex run` panel and the status line show it: the stage word always in capitals. */
export function stageText(item) {
    const word = item.word.toUpperCase();
    const bar = item.progress === null
        ? ""
        : ` ${progressBar(item.progress.done, item.progress.total)} ${item.progress.done}/${item.progress.total}`;
    switch (item.state) {
        case "pending":
            return `${item.icon} ${word}`;
        case "done":
            return item.label === null ? `✓ ${word}` : `✓ ${clean(item.label)}`;
        case "partial":
            return `${item.icon} ${word}${bar}`;
        case "current":
            return `${item.icon} ${clean(item.label ?? word)}${bar}`;
    }
}
function cellStyle(item) {
    if (item.state === "done")
        return GREEN;
    if (item.state === "current")
        return `${BOLD}${ACCENT}`;
    return DIM;
}
function mapRow(map) {
    const row = [];
    map.cells.forEach((item, index) => {
        if (index > 0)
            row.push(seg("  ›  ", DIM));
        row.push(seg(stageText(item), cellStyle(item)));
    });
    return row;
}
function checklistRow(item) {
    const label = clean(item.label);
    if (item.state === "done")
        return [seg("✓", GREEN), seg(` ${label}`, DIM)];
    if (item.state === "current")
        return [seg("▸", ACCENT), seg(` ${label}`)];
    return [seg(`· ${label}`, DIM)];
}
/** Cut a row of styled pieces to `width` cells; the cut piece ends in `…` and nothing follows it. */
function fitRow(row, width) {
    const out = [];
    let used = 0;
    for (const piece of row) {
        const size = displayWidth(piece.text);
        if (used + size <= width) {
            out.push(piece);
            used += size;
            continue;
        }
        out.push({ text: fit(piece.text, width - used), style: piece.style });
        break;
    }
    return out;
}
function paint(row, color) {
    return row.map(({ text, style }) => (color && style !== "" ? `${style}${text}${RESET}` : text)).join("");
}
/** The card rows joined by newlines, without the leading newline the caller adds for row one. */
export function renderScreenCard(input, options) {
    const width = Math.max(MIN_CARD_WIDTH, Math.floor(options.width ?? DEFAULT_CARD_WIDTH));
    const lookDef = input.look !== null ? (LOOKS[input.look] ?? null) : null;
    const tint = input.look === "turn" ? AMBER : input.look === "review" ? ACCENT : ACCENT;
    const bar = seg("┃ ", tint);
    const route = [seg(`🔥 LIT · ${clean(input.mode)}`, `${BOLD}${tint}`)];
    if (lookDef !== null)
        route.push(seg(`  ${lookDef.label}`, `${BOLD}${tint}`));
    else if (input.note !== null && clean(input.note) !== "")
        route.push(seg(`  ${clean(input.note)}`, DIM));
    const rows = [route];
    if (input.map !== null && input.map.cells.length > 0)
        rows.push(mapRow(input.map));
    if (input.stack)
        rows.push([seg(clean(input.stack), DIM)]);
    for (const item of input.checklist.slice(0, MAX_CHECKLIST))
        rows.push(checklistRow(item));
    return rows.map((row) => paint([bar, ...fitRow(row, width - displayWidth(bar.text))], options.color)).join("\n");
}
/**
 * The card for a session's saved state. With `quietWhenEmpty`, null when there is neither a map nor a
 * checklist, since the route row alone would repeat the activation banner above it.
 */
export function workflowCard(repoRoot, sessionId, mode, note, options) {
    const map = workflowMapCells(mode, readWorkflowSignals(repoRoot, sessionId));
    const checklist = readChecklist(repoRoot, sessionId);
    const stack = sessionId === null ? null : stackRow(readStack(repoRoot, sessionId));
    if (options.quietWhenEmpty === true && map === null && checklist.length === 0 && stack === null)
        return null;
    return renderScreenCard({ mode, note, look: lookOf(mode), map, checklist, stack }, options);
}
