// src/hud-scene.ts — when `litcodex hud` draws its card, and the plain lines it keeps in a window too narrow
// for one.
//
// The card (hud-card.ts) needs a dark truecolor terminal of at least CARD_MIN columns. A narrower one keeps
// the card's text lines with their pills, drawn here; every other terminal keeps the frame hud.ts prints.
import { clean } from "./control-chars.js";
import { BOLD, BRAND, cells, displayWidth, fit, lineText, PILL_TEXT, RAINBOW, } from "./hud.js";
import { along, bar, brandPill, gradePill, MUTED, mix, push, rowText, SUNSET, TRACK } from "./hud-paint.js";
import { AMBER, DUSK } from "./hud-sunset.js";
/** Narrower windows keep the plain lines. */
export const CARD_MIN = 40;
const CAP_LEFT = "\ue0b6";
const CAP_RIGHT = "\ue0b4";
/** What the stage pill shows of this view; a notice or a finished plan shows it at rest. */
export function sceneMood(view) {
    const status = view.status;
    if (view.unreadable.length > 0 || (view.matches ?? 0) > 1)
        return null;
    if (view.session === null || status === null)
        return "wait";
    if (status.look === "done")
        return null;
    if (status.look === "turn" || status.look === "rewind")
        return status.look;
    return status.state === "ignited" && status.working ? "work" : "wait";
}
/** A terminal that says its background is light (`COLORFGBG=0;15`). */
export function lightBackground(env) {
    return /;(?:7|15)$/u.test(env["COLORFGBG"] ?? "");
}
/** Each gauge (`▰▰▱▱▱`, `[▉▉░░░]`, or what a cut left of one) as one bar over exactly the cells it already has. */
function drawGauges(row, caps) {
    const plain = row.map((cell) => cell.text).map((text) => (text.length === 1 ? text : " "));
    for (const found of plain.join("").matchAll(/[▰▱]+|\[[▉░]+\]?/gu)) {
        const [start, size] = [found.index, found[0].length];
        const inner = found[0].replace(/[[\]]/gu, "");
        const lit = [...inner].filter((glyph) => glyph === "▰" || glyph === "▉").length;
        // A bracket counts as the cell beside it, so a begun gauge lights its first cell and a full one its last.
        const open = found[0].startsWith("[") && lit > 0 ? 1 : 0;
        const close = found[0].endsWith("]") && lit === inner.length ? 1 : 0;
        const filled = lit + open + close;
        if (!caps) {
            row.splice(start, size, ...bar(size, filled, SUNSET, false));
            continue;
        }
        for (let x = 0; x < size; x++) {
            const color = x < filled ? along(SUNSET, x / size) : TRACK;
            const cap = size < 2 ? null : x === 0 ? CAP_LEFT : x === size - 1 ? CAP_RIGHT : null;
            row[start + x] = cap === null ? { text: " ", bg: color } : { text: cap, fg: color };
        }
    }
}
/** One line of the card as cells, cut to `width`, with its pills and gauges. */
function textRow(line, index, mood, options) {
    const row = [];
    let text = clean(line.text);
    const room = options.width - displayWidth(PILL_TEXT);
    if (index === 0 && room >= 2) {
        row.push(...brandPill(options.caps, line.pill));
        text = fit(text.startsWith(BRAND) ? text.slice(BRAND.length).trimStart() : text, room);
    }
    else {
        text = fit(lineText(line, options.width), options.width);
    }
    let tint = 0;
    let offset = 0;
    const [stageStart, stageEnd] = text.startsWith(line.text.slice(0, line.stage?.[1])) ? (line.stage ?? []) : [];
    let pill = null;
    for (const piece of cells(text)) {
        if (offset === stageStart)
            pill = [row.length, row.length];
        const rainbow = `${BOLD}\u001b[38;5;${RAINBOW[tint % RAINBOW.length]}m`;
        const sgr = line.rainbow !== true ? line.style : piece.text === " " ? BOLD : rainbow;
        if (line.rainbow === true && piece.text !== " ")
            tint++;
        push(row, piece.text, piece.width, { sgr });
        offset += piece.text.length;
        if (offset === stageEnd && pill !== null)
            pill[1] = row.length;
    }
    drawGauges(row, options.caps);
    if (pill !== null && pill[1] > pill[0] && mood !== "rewind") {
        const stage = (mood === "turn" ? AMBER : DUSK).stage;
        const stops = mood === "work" || mood === "turn" ? stage : stage.map((color) => mix(color, MUTED, 0.25));
        if (pill[0] > 0)
            pill[0]--;
        if (row[pill[1]]?.text === " ")
            pill[1]++;
        // A pill the edge of the window cuts has no cell for its cap; in the round form it stays words.
        const whole = row[pill[0]]?.text === " " && row[pill[1] - 1]?.text === " ";
        if (whole || !options.caps)
            gradePill(row, pill[0], pill[1], stops, options.caps);
    }
    return row;
}
/** The card's lines for a narrow window, each cut to `width`, with their pills and gauges. */
export function narrowLines(lines, mood, options) {
    const width = Math.max(10, Math.floor(options.width));
    return lines.map((line, index) => rowText(textRow(line, index, mood, { ...options, width })));
}
