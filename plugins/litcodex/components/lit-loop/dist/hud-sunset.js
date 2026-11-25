// src/hud-sunset.ts — the sunset inside the `litcodex hud` card.
//
// A half-sunk sun, stars, now and then a shooting star, and a sea that flows outward from the sun on its last
// row, drawn only in cells no text uses. What moves is the colour of a cell or an ASCII glyph; block glyphs
// keep their shape, which every terminal repaints cleanly.
import { ACCENT, along, FAINT, mix, PINK, VIOLET, WHITE } from "./hud-paint.js";
export const SUN_WIDTH = 18;
export const SUN_ROWS = 3;
/** Blank cells kept between the scene and any word. */
const CLEAR = 3;
/** Blank cells kept on each side of the sun. */
export const SUN_CLEAR = 2;
const SLIT = 0x1a1030;
export const DUSK = {
    sun: [
        [0xffd24a, 0xfff0a0],
        [0xff8f3c, 0xffc15a],
        [0xff2d8a, 0xff6b8f],
    ],
    sea: [0xffdc73, 0xff9a4a, 0xff4f8b, 0xb457d6, 0x5a46a8],
    rule: [PINK, VIOLET, ACCENT],
    stage: [VIOLET, ACCENT],
};
export const AMBER = {
    sun: [
        [0xffc95a, 0xfff0b8],
        [0xffaf3c, 0xffd98a],
        [0xe08a1e, 0xffb95a],
    ],
    sea: [0xffd98a, 0xffaf3c, 0xe08a1e, 0x9a6420, 0x5a4020],
    rule: [0x9a6420, 0xffaf3c, 0xffd98a],
    stage: [0xffaf3c, 0xffd98a],
};
/** The rewind line's eight colours in truecolor, for a sun that matches it. */
export const WHEEL = [0xff5f5f, 0xff875f, 0xffd75f, 0x87d787, 0x5fd7d7, 0x5fafff, 0xaf87ff, 0xff5faf];
/** Star places: rows above (-1) and beside (0, 1) the sun, cells from its left edge. */
const STARS = [
    [-1, -44],
    [-1, -27],
    [-1, -6],
    [-1, 15],
    [-1, 31],
    [0, -36],
    [0, -30],
    [0, -18],
    [0, -9],
    [0, 22],
    [0, 29],
    [0, 35],
    [1, -40],
    [1, -24],
    [1, -13],
    [1, -5],
    [1, 25],
    [1, 32],
];
const DASH = "*--.";
const DASH_EVERY = 9;
const DASH_SECONDS = 1.1;
/** The dome in eighth blocks, with a thin dark slit over the second row and a thicker one over the third. */
const SUN = [0, 1, 2].map((row) => Array.from({ length: SUN_WIDTH }, (_, x) => {
    const reach = (x - (SUN_WIDTH - 1) / 2) / (SUN_WIDTH / 2);
    const height = Math.round(Math.sqrt(1 - reach * reach) * 8 * SUN_ROWS);
    const fill = Math.max(0, Math.min(8, height - (SUN_ROWS - 1 - row) * 8));
    if (fill === 0)
        return null;
    if (fill < 8)
        return { text: "▁▂▃▄▅▆▇"[fill - 1] ?? "▇" };
    return row === 0 ? { text: "█" } : { text: row === 1 ? "▇" : "▆", bg: SLIT };
}));
/** The sea `dx` cells from under the sun: waves that travel outward, brightest on the sun's path. */
function seaCell(dx, seconds, palette) {
    const far = Math.abs(dx);
    const wave = Math.sin(far * 0.62 - seconds * 2.3) +
        0.8 * Math.sin(dx * 0.31 + seconds * 1.1) +
        0.6 * Math.sin(dx * 1.37 - seconds * 0.7);
    const level = wave * 0.62 + 1.05 - far / 34;
    if (level < 0.22)
        return null;
    const glyph = level > 1 ? "~" : level > 0.55 ? "-" : ".";
    const fg = mix(FAINT, along(palette.sea, far / 52), Math.min(1, 0.18 + level * 0.55));
    return { text: glyph, fg, ...(level > 1.5 ? { bold: true } : {}) };
}
/** Right of centre, and never so far left that the three usage figures lose their place beside it. */
export const sunLeft = (width) => Math.max(35, Math.round(width * 0.62));
/** Whether the sun fits on rows `top` to `top + 2`, with its margin, without touching text. */
export function sunFits(rows, top, width) {
    const from = sunLeft(width) - SUN_CLEAR;
    const to = from + SUN_WIDTH + 2 * SUN_CLEAR;
    if (top < 0 || from < 0 || to > width)
        return false;
    return Array.from({ length: SUN_ROWS }, (_, row) => rows[top + row]).every((row) => row?.slice(from, to).every((cell) => cell.blank === true) === true);
}
/** The scene laid out on `rows`, its sun's first row at `top`; the rows are read once, here. */
export function layoutSunset(rows, top, width, options) {
    const { palette, moving, dim, wheel } = options;
    const left = sunLeft(width);
    const middle = left + SUN_WIDTH / 2 - 0.5;
    const sun = sunFits(rows, top, width);
    const open = [-1, 0, 1, 2].map((row) => {
        const cut = rows[top + row];
        return Array.from({ length: width }, (_, x) => {
            if (cut === undefined)
                return false;
            for (let near = Math.max(0, x - CLEAR); near <= Math.min(width - 1, x + CLEAR); near++)
                if (cut[near]?.blank !== true)
                    return false;
            return true;
        });
    });
    const free = (row, x) => open[row + 1]?.[x] === true;
    const shade = (color) => (dim ? mix(color, FAINT, 0.6) : color);
    const paint = (grid, seconds, burst) => {
        const put = (row, x, cell) => {
            const cut = grid[top + row];
            if (cut !== undefined)
                cut[x] = cell;
        };
        if (sun) {
            for (const [row, dx] of STARS) {
                const x = left + dx;
                if (!free(row, x))
                    continue;
                const twinkle = 0.5 + 0.5 * Math.sin(seconds * 1.7 + dx * 2.1);
                const glyph = twinkle > 0.85 ? "*" : twinkle > 0.45 ? "+" : ".";
                const color = wheel === null ? (dx % 2 === 0 ? 0xff9ad5 : 0xa99bff) : wheel(x);
                put(row, x, { text: glyph, fg: mix(FAINT, shade(color), 0.35 + 0.65 * twinkle) });
            }
            const dash = seconds % DASH_EVERY;
            if (moving && seconds >= DASH_EVERY && dash < DASH_SECONDS) {
                const head = Math.round(left + SUN_WIDTH + 22 - (dash / DASH_SECONDS) * 34);
                [...DASH].forEach((glyph, index) => {
                    if (!free(0, head + index))
                        return;
                    put(0, head + index, {
                        text: glyph,
                        fg: mix(0xfff4e0, 0xb457d6, index / 3),
                        ...(index === 0 ? { bold: true } : {}),
                    });
                });
            }
        }
        if (sun || moving) {
            for (let x = 0; x < width; x++) {
                const cell = free(2, x) ? seaCell(x - middle, seconds, palette) : null;
                if (cell === null)
                    continue;
                const color = wheel === null ? shade(cell.fg ?? FAINT) : mix(FAINT, wheel(x), 0.75);
                put(2, x, { ...cell, fg: color });
            }
        }
        if (burst !== null) {
            // Completion: a short shower of sparks in every free cell of the sky.
            for (let row = -1; row < SUN_ROWS; row++) {
                for (let x = 0; x < width; x++) {
                    if ((x * 7 + row * 29 + 58) % 13 !== 0 || !free(row, x))
                        continue;
                    const life = burst * 1.6 - ((x * 37) % 60) / 100;
                    if (life <= 0 || life >= 1)
                        continue;
                    const glow = Math.sin(life * Math.PI);
                    put(row, x, {
                        text: glow > 0.75 ? "*" : glow > 0.35 ? "+" : ".",
                        fg: mix(FAINT, along(WHEEL, x / width), glow),
                        ...(glow > 0.75 ? { bold: true } : {}),
                    });
                }
            }
        }
        if (!sun)
            return;
        SUN.forEach((line, row) => {
            line.forEach((cell, x) => {
                if (cell === null)
                    return;
                // Heat: light runs up the sun and ripples across it.
                const heat = 0.5 + 0.5 * Math.sin(seconds * 2.1 + row * 1.5 + 0.55 * Math.sin(x * 0.8 + seconds * 1.6));
                const [rest, lit] = palette.sun[row] ?? [WHITE, WHITE];
                const fg = wheel === null
                    ? shade(mix(rest, lit, moving ? heat : 0.25))
                    : mix(along(WHEEL, x / SUN_WIDTH / 1.2 + row * 0.08), WHITE, 0.3);
                put(row, left + x, { ...cell, fg });
            });
        });
    };
    return { sun, middle, paint };
}
