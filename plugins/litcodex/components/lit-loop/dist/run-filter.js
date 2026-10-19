// src/run-filter.ts — the byte filter between Codex and the real terminal under `litcodex run`.
//
// `litcodex run` gives Codex a pseudo-terminal a few rows shorter than the real one and draws the LIT
// panel in the rows below. Two things decide whether that works. First, a scroll region Codex sets must
// end at its own last row: a reset (`ESC[r`, `ESC[;r`) or a bottom margin past that row would let Codex
// scroll the panel, so every DECSTBM is rewritten to stop there. Second, the panel can only be drawn
// between two whole sequences: a read may end inside an escape sequence (CSI, an OSC or DCS string, a
// lone ESC) or a UTF-8 character, and drawing there prints garbage such as `385;Breadfruit`. Such an
// unfinished tail is held back until the rest arrives. The caller flushes a tail that stays unfinished
// (after 50 ms; without that the screen once froze), and the filter then reports no boundary until a
// later read ends cleanly. A forced flush may also have let a scroll region through unclamped, and a full
// or soft reset (`ESC c`, `ESC[!p`) drops the region, so the filter then reports the region lost until the
// caller sets it again. While the child holds a saved cursor (`ESC7` or `ESC[s` not yet restored or reset), drawing
// the panel would overwrite that saved position, so the filter reports that too. Pure: no I/O, no timers.
const ESC = 0x1b;
const BEL = 0x07;
/** `ESC ]` OSC, `ESC P` DCS, `ESC X` SOS, `ESC ^` PM, `ESC _` APC: strings that end in BEL or `ESC \`. */
const STRING_STARTS = new Set([0x5d, 0x50, 0x58, 0x5e, 0x5f]);
const SCROLL_REGION = /\u001b\[(\d*)(?:;(\d*))?r/gu;
const CURSOR = /\u001b\[\?25([hl])/gu;
/** Cursor save (`ESC7`, `ESC[s`), restore (`ESC8`, `ESC[u`) and the resets that discard a saved cursor. */
const CURSOR_SAVE = /\u001b([78c])|\u001b\[([su]|!p)/gu;
/** True when the sequence starting at `data[at]` (an ESC) is complete within `data`. */
function escapeComplete(data, at) {
    const kind = data[at + 1];
    if (kind === undefined)
        return false;
    if (kind === 0x5b) {
        for (let index = at + 2; index < data.length; index++) {
            const byte = data[index];
            // Parameters and intermediates continue; a final byte ends it; anything else is malformed and passes.
            if (byte < 0x20 || byte > 0x3f)
                return true;
        }
        return false;
    }
    if (STRING_STARTS.has(kind))
        return data.indexOf(BEL, at + 2) >= 0;
    if (kind >= 0x20 && kind <= 0x2f) {
        for (let index = at + 2; index < data.length; index++) {
            const byte = data[index];
            if (byte < 0x20 || byte > 0x2f)
                return true;
        }
        return false;
    }
    return true;
}
/** Where an unfinished trailing UTF-8 character starts; `data.length` when the tail is whole. */
function utf8TailStart(data) {
    for (let back = 1; back <= Math.min(4, data.length); back++) {
        const byte = data[data.length - back];
        if ((byte & 0xc0) === 0x80)
            continue;
        const need = (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 1;
        return need > back ? data.length - back : data.length;
    }
    return data.length;
}
/** Where the unfinished tail of `data` starts; `data.length` when everything is whole. */
export function unfinishedFrom(data) {
    let cut = data.length;
    const last = data.lastIndexOf(ESC);
    if (last >= 0 && !escapeComplete(data, last)) {
        cut = last;
        // A lone ESC may be the first half of the `ESC \` that ends an open string; hold the whole string.
        const previous = last > 0 ? data.lastIndexOf(ESC, last - 1) : -1;
        const kind = previous >= 0 ? data[previous + 1] : undefined;
        if (kind !== undefined && STRING_STARTS.has(kind) && data.subarray(previous + 2, last).indexOf(BEL) < 0) {
            cut = previous;
        }
    }
    return Math.min(cut, utf8TailStart(data));
}
export function createScreenFilter(initialRows) {
    let rows = initialRows;
    let held = Buffer.alloc(0);
    let boundary = true;
    let cursorVisible = true;
    let regionLost = false;
    let cursorSaved = false;
    const rewrite = (data) => {
        if (data.indexOf(ESC) < 0)
            return data;
        const text = data.toString("latin1");
        for (const match of text.matchAll(CURSOR))
            cursorVisible = match[1] === "h";
        for (const match of text.matchAll(CURSOR_SAVE)) {
            cursorSaved = match[1] === "7" || match[2] === "s";
            if (match[1] === "c" || match[2] === "!p")
                regionLost = true;
        }
        if (!text.includes("r"))
            return data;
        const out = text.replace(SCROLL_REGION, (_all, top, bottom) => {
            const first = top === "" ? 1 : Number(top);
            const end = bottom === undefined || bottom === "" ? rows : Math.min(Number(bottom), rows);
            return `\u001b[${first};${end}r`;
        });
        return out === text ? data : Buffer.from(out, "latin1");
    };
    return {
        push(chunk) {
            const data = held.length === 0 ? Buffer.from(chunk) : Buffer.concat([held, chunk]);
            const cut = unfinishedFrom(data);
            held = Buffer.from(data.subarray(cut));
            if (held.length === 0)
                boundary = true;
            return rewrite(data.subarray(0, cut));
        },
        flush() {
            if (held.length === 0)
                return held;
            const out = rewrite(held);
            held = Buffer.alloc(0);
            boundary = false;
            regionLost = true;
            return out;
        },
        get holding() {
            return held.length > 0;
        },
        get atBoundary() {
            return boundary && held.length === 0;
        },
        get cursorVisible() {
            return cursorVisible;
        },
        get regionLost() {
            return regionLost;
        },
        regionAsserted() {
            regionLost = false;
        },
        get cursorSaved() {
            return cursorSaved;
        },
        setRows(next) {
            rows = next;
        },
    };
}
