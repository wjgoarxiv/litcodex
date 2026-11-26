// src/hud-card.ts — the framed LIT card of `litcodex hud` on a dark truecolor terminal.
//
//   ╭─ (🔥 LIT) · lit-loop || > start-work ──────────────────────── WORK ● ─╮
//   │ interview ✓ ━━ plan ✓ ━━ ( work 2/5 ) ━━ review · ── done · ●● 2 lanes │
//   │ └ task 2/5 ▰▰▱▱▱ · next ▸ Write the parser tests         - Bash · 0:14 │
//   │ thread rows, notices                                                   │
//   │ skills (start-work)                           sun, stars, sea         │
//   ╰─ ctx 24% ▰▱▱▱▱ · 5h 22% · 1w 54% · git main ────────────── 14s ago ─╯
//
// `composeCard` lays one view out once: which rows there are, what each says and where the sunset stands.
// `paint` then draws a moment of it from that alone, so a frame reads no record. Every row is exactly as wide
// as the card whatever its words are; a row that does not fit drops its parts from the right. Nothing here is
// guessed: a part whose record is missing is left out. Only colours and ASCII glyphs move, and only while
// LIT works or for the moment a plan completes. Record text is data: controls, format characters and private
// glyphs never reach the terminal.
import { LANE_COLORS, laneColor, REVIEW_LANE_IDS } from "./card-looks.js";
import { clock } from "./card-status.js";
import { cells, displayWidth } from "./hud.js";
import { ACCENT, along, BLANK, bar, brandPill, cut, FAINT, MUTED, mix, PINK, pill, SUNSET, VIOLET, WHITE, words, } from "./hud-paint.js";
import { AMBER, DUSK, layoutSunset, SUN_ROWS, SUN_WIDTH, sunFits, sunLeft, WHEEL } from "./hud-sunset.js";
import { STATE_COLOURS } from "./state-colours.js";
/** Past this many cells the card stops growing, so a wide window does not stretch it thin. */
export const CARD_MAX = 120;
/** Below this the sun has no sky around it. */
const SUN_MIN = 59;
/** Blank rows the card may add under its words for the sun. */
const GROW_MAX = 3;
const TEXT = 0xe6edf3;
/** Dim words keep 4.5:1 on the dark ground. */
const DIM = 0x8b949e;
const RAIL = 0x46505c;
const GREEN = 0x6bdb8f;
const AMBER_INK = 0xffaf3c;
const YELLOW = 0xe3b341;
const RED = 0xff6b6b;
const FLAME = 0xff7a4a;
const ROSE = 0xff6fae;
const MUTED_INK = 0xb6bec8;
const WARM = [FLAME, ROSE, ACCENT];
const NEON = [PINK, VIOLET, ACCENT];
const LIT_GREEN = STATE_COLOURS.done.pill;
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}]/gu;
/** Record text as it may reach the terminal. */
function safe(text) {
    return text.replace(UNSAFE, "");
}
/** `left` and `right` at the two ends of `width` cells; `right` goes first when they do not both fit. */
function ends(left, right, width) {
    const kept = right.length > 0 && left.length + 2 + right.length <= width ? right : [];
    const head = cut(left, width - (kept.length > 0 ? kept.length + 2 : 0));
    const gap = Array(Math.max(0, width - head.length - kept.length)).fill(BLANK);
    return [...head, ...gap, ...kept];
}
/** Parts joined by a faint ` · `, dropping the highest `drop` until they fit. */
function joined(parts, width) {
    let kept = [...parts];
    const size = () => kept.reduce((sum, part) => sum + part.cells.length, 0) + 3 * Math.max(0, kept.length - 1);
    while (kept.length > 1 && size() > width) {
        const worst = kept.reduce((a, b) => (b.drop >= a.drop ? b : a));
        kept = kept.filter((part) => part !== worst);
    }
    const row = kept.flatMap((part, index) => [...(index > 0 ? words(" · ", DIM) : []), ...part.cells]);
    return cut(row, width);
}
const wheelAt = (share) => along(WHEEL, ((share % 1) + 1) % 1);
function lookOf(status) {
    if (status === null || status.state === "ready")
        return "quiet";
    if (status.look === "done")
        return "done";
    if (status.look === "turn" || status.look === "rewind")
        return status.look;
    if (status.state === "complete")
        return "lit";
    return status.working ? "work" : "quiet";
}
/** The stage's word, and what its label adds to it (`wave` + `2 expand`). */
function stageName(cell) {
    const label = safe(cell.label ?? "").toLowerCase();
    if (label === "" || label === cell.word)
        return cell.word;
    if (cell.state === "done")
        return `${cell.word} ${label}`;
    return label;
}
function countOf(cell) {
    return cell.progress === null ? "" : ` ${cell.progress.done}/${cell.progress.total}`;
}
/**
 * The stages as the card shows them, so the title and the stage row agree: under DONE the done stage is ticked, no
 * stage is current and a skipped one stays pending; a review the stack records is the current stage.
 */
function stagesOf(status, look) {
    const stages = status.map?.cells ?? [];
    const left = (cell) => {
        const full = cell.progress !== null && cell.progress.done >= cell.progress.total;
        return { ...cell, state: full ? "done" : "partial", label: null };
    };
    if (look === "done" || look === "lit") {
        return stages.map((cell) => cell.key === "done" ? { ...cell, state: "done" } : cell.state === "current" ? left(cell) : cell);
    }
    const review = stages.findIndex((cell) => cell.key === "review");
    if (status.look !== "review" || status.reviewLanes == null || review < 0)
        return stages;
    return stages.map((cell, index) => index === review ? { ...cell, state: "current" } : cell.state === "current" ? left(cell) : cell);
}
const TRACKS = [{ rail: 2 }, { rail: 1 }, { rail: 0 }, { rail: 0, near: true }];
/** The stage map in words: done stages warm and ticked, the current one in a pill, later ones dim, skipped ones marked `-`. */
function track(stages, look, form, caps) {
    const ended = look === "done" || look === "lit";
    // The current stage, else the furthest one reached.
    let focus = stages.findIndex((cell) => cell.state === "current");
    if (focus < 0)
        focus = Math.max(0, ...stages.map((cell, index) => (cell.state === "pending" ? 0 : index)));
    const last = Math.max(1, stages.length - 1);
    const row = [];
    const resting = look === "quiet";
    const warm = (share) => look === "rewind"
        ? mix(wheelAt(share), WHITE, 0.25)
        : resting
            ? mix(along(WARM, share), DIM, 0.5)
            : along(WARM, share);
    const shown = stages.flatMap((cell, index) => form.near === true && index !== focus && index !== focus + 1 ? [] : [{ cell, index }]);
    shown.forEach(({ cell, index }, order) => {
        const before = stages[index - 1];
        if (order > 0) {
            if (form.near === true)
                row.push(...words(" › ", DIM));
            else if (form.rail === 0)
                row.push(BLANK);
            else {
                const reached = cell.state !== "pending" && before?.state !== "pending";
                const leaving = before?.state === "current";
                row.push(BLANK);
                for (let step = 0; step < form.rail; step++) {
                    const share = (index - 1 + (step + 0.5) / form.rail) / last;
                    const lit = leaving && before?.progress != null ? before.progress.done / before.progress.total : 0;
                    const color = reached || step < lit * form.rail ? warm(share) : RAIL;
                    row.push({ text: reached || leaving ? "━" : "─", fg: color });
                }
                row.push(BLANK);
            }
        }
        const name = stageName(cell);
        if (cell.state === "current") {
            const paused = cell.label === "PAUSED";
            const muted = paused && look !== "rewind" && look !== "turn";
            const stops = look === "rewind"
                ? [mix(wheelAt(0.45), WHITE, 0.3), mix(wheelAt(0.7), WHITE, 0.3)]
                : look === "turn"
                    ? AMBER.stage
                    : muted
                        ? [MUTED, MUTED]
                        : DUSK.stage.map((color) => (resting ? mix(color, MUTED, 0.25) : color));
            row.push(...pill(`${paused ? "|| " : ""}${name}${countOf(cell)}`, stops, caps, muted ? MUTED_INK : undefined));
        }
        else if (cell.state === "pending") {
            row.push(...words(form.near === true ? name : `${name} ${ended ? "-" : "·"}`, DIM));
        }
        else {
            const mark = cell.state === "partial" ? " …" : " ✓";
            row.push(...words(`${name}${cell.state === "partial" ? countOf(cell) : ""}${mark}`, warm(index / last)));
        }
    });
    return row;
}
const STATE_LOOK = {
    running: ["●", GREEN],
    paused: ["|", DIM],
    blocked: ["!", AMBER_INK],
    idle: ["-", DIM],
    done: ["✓", mix(GREEN, DIM, 0.4)],
};
/** Breathing dots for the live lanes, and how many there are. */
function laneDots(status, moving, seconds) {
    const threads = status.threads;
    if (!threads || threads.laneCount === 0)
        return [];
    const dots = threads.lanes.map((lane, index) => {
        const color = STATE_LOOK[lane.state][1];
        const breath = moving && lane.state === "running" ? 0.35 + 0.35 * Math.sin(seconds * 2.6 - index * 1.1) : 0;
        return { text: "●", fg: mix(color, WHITE, breath) };
    });
    return [
        ...dots,
        ...words(` ${threads.laneCount}`, TEXT, { bold: true }),
        ...words(threads.laneCount === 1 ? " lane" : " lanes", DIM),
    ];
}
const SPINNER = "-\\|/";
/** A tool's name keeps this many cells. */
const TOOL_MIN = 4;
/** The tool running now, else the turn's own clock or length; only the tool's name gives way to `room`. */
function liveStep(status, moving, seconds, room) {
    const named = (text, color, style, around) => cut(words(safe(text), color, style), Math.max(TOOL_MIN, room - around));
    const spin = SPINNER[moving ? Math.floor(seconds * 4) % SPINNER.length : 0] ?? "-";
    const lead = words(`${spin} `, ACCENT, { bold: true });
    if (status.state === "ready")
        return [];
    if (status.step !== null) {
        const tail = words(` · ${clock(status.now - status.step.startedAt)}`, DIM);
        return [...lead, ...named(status.step.tool, TEXT, { bold: true }, lead.length + tail.length), ...tail];
    }
    if (status.working && status.turnStartedAt !== null)
        return [...lead, ...words("turn ", DIM), ...words(clock(status.now - status.turnStartedAt), TEXT)];
    if (status.turnStartedAt !== null && status.turnEndedAt !== null) {
        const tail = [...words("turn ", DIM), ...words(clock(status.turnEndedAt - status.turnStartedAt), TEXT)];
        if (status.lastTool === null)
            return tail;
        const [before, after] = [words("last ", DIM), words(" · ", DIM)];
        const around = before.length + after.length + tail.length;
        return [...before, ...named(status.lastTool, DIM, {}, around), ...after, ...tail];
    }
    return [];
}
const MARKS = { pass: "✓", running: "●", fail: "✗", dim: "·" };
/** The five review lanes with their marks; the names shorten, then go, when the row is narrow. */
function reviewMarks(status, room) {
    const lanes = status.reviewLanes ?? [];
    const form = (letters) => lanes.flatMap((state, index) => {
        const base = Number.parseInt((LANE_COLORS[index] ?? "#8b949e").slice(1), 16);
        const color = state === "fail" ? RED : state === "dim" ? DIM : base;
        const name = (REVIEW_LANE_IDS[index] ?? "").slice(0, letters);
        return [
            ...(index > 0 ? words(" ", DIM) : []),
            ...words(name === "" ? "" : `${name} `, state === "dim" ? DIM : TEXT),
            ...words(MARKS[state], color, { bold: true }),
        ];
    });
    return [form(20), form(4), form(0)].find((cells_) => cells_.length <= room) ?? form(0);
}
/** `└ task 2/5 ▰▰▱▱▱ · next ▸ …`, or the paused work and the way back. */
function detail(status, look, caps, room) {
    const lead = words("└ ", DIM);
    const progress = [...(status.map?.cells ?? [])].reverse().find((cell) => cell.progress !== null)?.progress ?? null;
    const parts = [];
    if (status.stack) {
        parts.push({
            cells: [...words("> ", ACCENT), ...words(safe(status.stack.running.name), TEXT, { bold: true })],
            drop: 1,
        });
        parts.push({ cells: [...words("back: ", DIM), ...words("lit continue", TEXT)], drop: 2 });
    }
    if (progress !== null && progress.total > 0) {
        const filled = Math.max(0, Math.min(5, Math.round((progress.done / progress.total) * 5)));
        const stops = look === "rewind" ? [wheelAt(0.1), wheelAt(0.5)] : SUNSET;
        parts.push({
            cells: [
                ...words("task ", DIM),
                ...words(String(progress.done), WHITE, { bold: true }),
                ...words(`/${progress.total} `, DIM),
                ...bar(5, filled, stops, caps),
            ],
            drop: 3,
        });
    }
    if (status.reviewLanes)
        parts.push({ cells: reviewMarks(status, room - lead.length), drop: 0 });
    const left = joined(parts, room - lead.length);
    if (status.map?.next == null)
        return parts.length === 0 ? [] : [...lead, ...left];
    const label = [...words(left.length > 0 ? " · next " : "next ", DIM), ...words("▸ ", ACCENT)];
    const avail = room - lead.length - left.length - label.length;
    if (avail < 6)
        return [...lead, ...left];
    return [...lead, ...left, ...label, ...cut(words(safe(status.map.next), TEXT), avail)];
}
/** The thread rows as a tree: frames parent first, lanes under the top frame, other sessions last. */
function treeRows(status) {
    const threads = status.threads;
    if (threads) {
        const out = threads.chain.map((row, index) => ({
            lead: index === 0 ? "" : `${"   ".repeat(index - 1)}└─ `,
            row,
        }));
        const under = "   ".repeat(Math.max(0, threads.chain.length - 1));
        const several = threads.laneCount >= 2;
        if (several)
            out.push({ lead: `${under}┬ `, fork: `${threads.laneCount} lanes in parallel` });
        threads.lanes.forEach((row, index) => {
            const branch = several && index < threads.lanes.length - 1 ? "├─ " : "└─ ";
            out.push({ lead: several || threads.chain.length > 0 ? `${under}${branch}` : "", row });
        });
        return [...out, ...threads.others.map((row) => ({ lead: "", row }))];
    }
    if (!status.stack)
        return [];
    const frames = [...status.stack.paused, status.stack.running];
    return frames.map((frame, index) => ({
        lead: index === 0 ? "" : `${"   ".repeat(index - 1)}└─ `,
        row: {
            key: `frame-${index}`,
            kind: "frame",
            name: frame.name,
            stage: frame.stage,
            gauge: frame.gauge,
            note: frame.note,
            state: index < frames.length - 1 ? "paused" : "running",
            active: index === frames.length - 1,
        },
    }));
}
const SLIVER = 5;
const pad = (text, width) => text + " ".repeat(Math.max(0, width - displayWidth(text)));
/** The first `limit` threads of the tree, the last of them its last branch. */
function shortTree(tree, limit) {
    const kept = tree.filter((line) => line.row !== undefined).slice(0, limit);
    return kept.map((line, index) => (index === limit - 1 ? { ...line, lead: line.lead.replace("├", "└") } : line));
}
/** With a `limit`, the rows of that many threads, the last one saying how many more there are. */
function threadRows(status, look, inner, caps, limit = Infinity) {
    const whole = treeRows(status);
    const all = whole.filter((line) => line.row !== undefined).length;
    const tree = limit < all ? shortTree(whole, limit) : whole;
    const rows = tree.flatMap((line) => (line.row === undefined ? [] : [line.row]));
    if (rows.length === 0)
        return [];
    const parsed = new Map(rows.map((row) => {
        const found = /^\[([▉░]+)\] (\d+\/\d+)$/u.exec(row.gauge ?? "");
        return [row, found === null ? null : { bar: found[1] ?? "", count: found[2] ?? "" }];
    }));
    const name = (row) => safe(row.name);
    const widest = (sizes) => Math.max(0, ...sizes);
    const nameWidth = Math.min(inner >= 90 ? 28 : 18, widest(rows.map((row) => displayWidth(name(row)))));
    const leadWidth = widest(tree.map((line) => (line.row === undefined ? 0 : displayWidth(line.lead))));
    const stageWidth = Math.min(10, widest(rows.map((row) => displayWidth(safe(row.stage ?? "")))));
    const barWidth = widest(rows.map((row) => parsed.get(row)?.bar.length ?? (row.state === "running" ? SLIVER : 0)));
    const said = (row) => parsed.get(row)?.count ?? safe(row.note);
    const saidWidth = Math.min(14, widest(rows.map((row) => displayWidth(said(row)))));
    // Columns that do not fit go from the right: the state word first (its glyph stays), then the stage.
    const stateWidth = widest(rows.map((row) => row.state.length));
    const column = (size) => (size > 0 ? size + 1 : 0);
    const needed = leadWidth + 2 + nameWidth + column(barWidth) + column(saidWidth);
    const showStage = stageWidth > 0 && needed + column(stageWidth) <= inner;
    const showState = needed + column(stageWidth) + column(stateWidth) <= inner;
    const more = (status.threads?.more ?? 0) + Math.max(0, all - limit);
    return tree.map((line, index) => {
        const draw = (seconds) => {
            const tail = index === tree.length - 1 && more > 0 ? words(`+${more} more`, DIM) : [];
            if (line.row === undefined)
                return ends([...words(line.lead, DIM), ...words(line.fork ?? "", DIM)], tail, inner);
            const { row } = line;
            const [glyph, color] = STATE_LOOK[row.state];
            const gauge = parsed.get(row) ?? null;
            const tint = look === "rewind" ? [wheelAt(index * 0.1), wheelAt(index * 0.1 + 0.4)] : [color, mix(color, WHITE, 0.35)];
            const lit = gauge === null ? 0 : gauge.bar.replace(/░/gu, "").length;
            const head = look === "work" && row.state === "running" ? Math.floor(((seconds * 0.8 + index * 0.17) % 1) * SLIVER) : -1;
            const meter = gauge !== null
                ? bar(gauge.bar.length, lit, tint, caps)
                : row.state === "running"
                    ? Array.from({ length: SLIVER }, (_, x) => ({ text: "━", fg: x === head ? mix(RAIL, WHITE, 0.75) : RAIL }))
                    : [];
            const gap = (size) => Array(Math.max(0, size)).fill(BLANK);
            const shownName = cut(words(name(row), row.active ? WHITE : TEXT, { bold: row.active || row.kind !== "session" }), nameWidth);
            const body = [
                ...words(line.lead, DIM),
                ...words(`${glyph} `, color),
                ...shownName,
                ...gap(nameWidth + leadWidth - displayWidth(line.lead) - shownName.length),
                ...(showStage ? [BLANK, ...cut(words(pad(safe(row.stage ?? ""), stageWidth), DIM), stageWidth)] : []),
                ...(barWidth > 0 ? [BLANK, ...meter, ...gap(barWidth - meter.length)] : []),
                ...(saidWidth > 0
                    ? [BLANK, ...cut(words(pad(said(row), saidWidth), gauge === null ? DIM : WHITE), saidWidth)]
                    : []),
                ...(showState ? [BLANK, ...words(row.state, color)] : []),
                ...(row.session === undefined ? [] : words(" · in another session", DIM)),
            ];
            return ends(tail.length > 0 ? cut(body, inner - tail.length - 2) : body, tail, inner);
        };
        return { kind: line.row === undefined ? "fork" : "thread", draw };
    });
}
/** This request's skill on the accent, work paused under it on a muted pill; null when no skill is recorded. */
function skillsRow(status, look, inner, caps) {
    if (status.state === "ready" || status.mode === null)
        return null;
    const current = status.stack?.running.name ?? status.mode;
    const paused = (status.stack?.paused ?? []).map((frame) => frame.name).filter((name) => name !== current);
    const stops = look === "rewind"
        ? [mix(wheelAt(0.5), WHITE, 0.3), mix(wheelAt(0.85), WHITE, 0.3)]
        : look === "turn"
            ? AMBER.stage
            : DUSK.stage.map((color) => (look === "quiet" ? mix(color, MUTED, 0.25) : color));
    let row = [...words("skills ", DIM), ...pill(safe(current), stops, caps)];
    for (const name of new Set(paused.reverse())) {
        const chip = pill(safe(name), [MUTED, MUTED], caps, MUTED_INK, false);
        if (row.length + 1 + chip.length > inner)
            break;
        row = [...row, BLANK, ...chip];
    }
    const drawn = ends(row, [], inner);
    return { kind: "skills", draw: () => drawn };
}
const level = (percent) => (percent >= 90 ? RED : percent >= 70 ? YELLOW : GREEN);
/** A path cut from the left, so its last folder stays. */
function pathTail(path, width) {
    const pieces = cells(path);
    let size = displayWidth(path);
    if (size <= width)
        return path;
    while (pieces.length > 0 && size > width - 1)
        size -= pieces.shift()?.width ?? 0;
    return `…${pieces.map((piece) => piece.text).join("")}`;
}
function ageOf(lastSeen, now) {
    const seconds = Math.max(0, Math.floor((now - lastSeen) / 1000));
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}
/** The figures of the bottom rule, left to right, each only when it is known. */
function figures(view, look, now, caps) {
    const { status, session } = view;
    const parts = [];
    const usage = status?.usage ?? null;
    const tint = look === "turn" ? AMBER_INK : ACCENT;
    if (usage !== null && usage.ctx !== null) {
        const hot = usage.ctx >= 90;
        const filled = Math.max(0, Math.min(5, Math.round(usage.ctx / 20)));
        const color = usage.ctx >= 70 ? level(usage.ctx) : tint;
        parts.push({
            cells: [
                ...words("ctx ", hot ? RED : DIM, hot ? { bold: true } : {}),
                ...words(`${usage.ctx}% `, color, { bold: true }),
                ...bar(5, filled, usage.ctx >= 70 ? [color, color] : [VIOLET, tint], caps),
            ],
        });
    }
    for (const [label, percent] of [
        ["5h", usage?.fiveHour ?? null],
        [usage?.weekLabel ?? "1w", usage?.week ?? null],
    ]) {
        if (percent !== null)
            parts.push({ cells: [...words(`${label} `, DIM), ...words(`${percent}%`, level(percent))] });
    }
    if (status?.branch)
        parts.push({ cells: [...words("git ", DIM), ...cut(words(safe(status.branch), tint), 24)], yields: true });
    if (session !== null) {
        const folder = safe(session.folder);
        parts.push({
            cells: words(pathTail(folder, 32), TEXT),
            shrunk: (room) => (room >= FOLDER_MIN ? words(pathTail(folder, room), TEXT) : null),
        });
        parts.push({ cells: words(`${ageOf(session.lastSeen, now)} ago`, DIM), tail: true });
        parts.push({ cells: words(safe(session.id).slice(0, 8), DIM), tail: true });
    }
    return parts.filter((part) => part.cells.length > 0);
}
const FOLDER_MIN = 12;
/**
 * The figures left and right of the rule's open stretch, the last ones dropped until the rest fit. `gap` is the
 * stretch under the sun, kept clear of words; without one the two groups only may not touch.
 */
function bottomGroups(parts, width, gap) {
    const line = (group) => group.flatMap((part, index) => [...(index > 0 ? words(" · ", DIM) : []), ...part.cells]);
    // Edge, rule and a blank before the left group, a blank after it; the same at the right end.
    const leftRoom = (gap === null ? width - 3 : gap[0]) - 4;
    const left = [];
    let next = 0;
    for (let part = parts[next]; part !== undefined && part.tail !== true; part = parts[++next]) {
        const taken = left.length === 0 ? 0 : line(left).length + 3;
        if (taken + part.cells.length <= leftRoom) {
            left.push(part);
            continue;
        }
        const short = gap === null && left.length === 0 ? cut(part.cells, leftRoom) : part.shrunk?.(leftRoom - taken);
        if (short == null)
            break;
        left.push({ cells: short });
    }
    const shown = line(left);
    const start = gap === null ? shown.length + 6 : gap[1];
    const rest = next < parts.length && (gap !== null || parts[next]?.tail === true) ? parts.slice(next) : [];
    const room = width - 4 - start;
    while (rest.length > 0 && line(rest).length > room) {
        // A folder or branch with no room of its own goes before the age beside it does.
        const named = rest.filter((part) => part.tail !== true);
        const gone = named.length > 0 && line(named).length > room ? named.length - 1 : rest.length - 1;
        rest.splice(gone, 1);
    }
    if (parts.slice(next).some((part) => part.yields === true && !rest.includes(part))) {
        const firm = parts.filter((part) => part.yields !== true);
        const without = bottomGroups(firm, width, gap);
        if (without[0].length > shown.length)
            return without;
    }
    return [shown, line(rest)];
}
function titleOf(view) {
    const { status } = view;
    if ((view.matches ?? 0) > 1)
        return "which session?";
    if (status === null || view.session === null)
        return "waiting for a LIT session";
    if (status.state === "ready")
        return "ready";
    const name = status.stack?.breadcrumb ?? status.mode ?? "lit";
    return safe(name).replace(/‖/gu, "||");
}
/** The state word at the right end of the title. */
function stateWord(view, look) {
    const { status } = view;
    const word = (text, color) => words(text, color, { bold: true });
    if (status === null || view.session === null)
        return word("WAITING", DIM);
    if (status.state === "ready")
        return word("READY", DIM);
    if (look === "done" || look === "lit")
        return word("DONE ✓", GREEN);
    if (look === "turn")
        return word("YOUR TURN", AMBER_INK);
    if (look === "rewind")
        return [..."REWIND <<"].flatMap((letter, index) => word(letter, mix(wheelAt(index / 9), WHITE, 0.35)));
    const current = stagesOf(status, look).find((cell) => cell.state === "current");
    if (status.look === "review" && (current === undefined || current.key === "review")) {
        const told = (status.reviewLanes ?? []).filter((lane) => lane === "pass" || lane === "fail").length;
        return word(status.reviewLanes ? `REVIEW ${told}/${status.reviewLanes.length}` : "REVIEW", ACCENT);
    }
    if (current?.label === "PAUSED")
        return word("PAUSED ||", DIM);
    const stage = (current?.word ?? "live").toUpperCase();
    return look === "work" ? word(`${stage} ●`, ACCENT) : word("IDLE", DIM);
}
function lineRow(parts, inner) {
    const drawn = ends(parts, [], inner);
    return { kind: "line", draw: () => drawn };
}
/** What to type, for a card with nothing running. */
function invitation(view, inner, docked) {
    const key = (text) => words(text, ACCENT, { bold: true });
    const say = (text) => words(text, DIM);
    const choose = (forms) => lineRow(forms.find((form) => form.length <= inner) ?? forms.at(-1) ?? [], inner);
    if ((view.matches ?? 0) > 1) {
        const wanted = safe(view.wanted ?? "");
        return [
            lineRow([
                ...key("--session "),
                ...words(wanted, TEXT),
                ...say(` matches ${view.matches} sessions; give more of the id`),
            ], inner),
        ];
    }
    if (docked && view.status === null)
        return [choose([[...say("type "), ...key("lit <task>"), ...say(" in Codex to start")]])];
    if (view.session === null || view.status === null) {
        if (view.wanted !== null)
            return [lineRow([...say("waiting for session "), ...words(safe(view.wanted), TEXT, { bold: true })], inner)];
        return [
            choose([
                [...say("start "), ...key("codex"), ...say(" in a project and type "), ...key("lit <task>")],
                [...say("start "), ...key("codex"), ...say(", type "), ...key("lit <task>")],
            ]),
        ];
    }
    return [
        choose([
            [
                ...say("no LIT skill in this thread yet · type "),
                ...key("lit <task>"),
                ...say(" to start one, or "),
                ...key("lit adhd"),
                ...say(" after a break"),
            ],
            [...say("no LIT skill yet · type "), ...key("lit <task>"), ...say(" to start one")],
            [...say("type "), ...key("lit <task>"), ...say(" to start")],
        ]),
    ];
}
/** Rows kept when the window is lower than the card: the newest words first. */
const KEEP = {
    detail: 0,
    line: 0,
    notice: 1,
    map: 2,
    thread: 3,
    skills: 4,
    fork: 5,
    blank: 6,
};
function keepRows(rows, room) {
    const kept = new Set(rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => KEEP[a.row.kind] - KEEP[b.row.kind] || a.index - b.index)
        .slice(0, Math.max(0, room))
        .map(({ row }) => row));
    return rows.filter((row) => kept.has(row));
}
/** The card and its scene, laid out once for this view and window. */
export function composeCard(view, options) {
    const width = Math.max(20, Math.min(CARD_MAX, Math.floor(options.width)));
    const inner = width - 4;
    const { caps, now } = options;
    const status = view.status;
    const look = lookOf(view.session === null ? null : status);
    const moving = look === "work";
    const alert = view.unreadable.length > 0;
    const reviewing = look !== "done" && look !== "lit" && look !== "turn" ? (status?.reviewLanes ?? null) : null;
    const rows = [];
    if (status !== null && view.session !== null && status.state !== "ready") {
        const stages = stagesOf(status, look);
        if (status.map !== null) {
            const form = TRACKS.map((shape) => track(stages, look, shape, caps));
            const fits = form.find((cells_) => cells_.length <= inner) ?? form.at(-1) ?? [];
            rows.push({ kind: "map", draw: (seconds) => ends(fits, laneDots(status, moving, seconds), inner) });
        }
        else if (status.threads && status.threads.laneCount > 0) {
            rows.push({ kind: "map", draw: (seconds) => ends(laneDots(status, moving, seconds), [], inner) });
        }
        // Half the row is the most a long tool's name takes from the task beside it.
        const half = Math.floor(inner / 2);
        const right = liveStep(status, moving, 0, half);
        const shown = right.length + 14 <= inner;
        const left = detail(status, look, caps, inner - (shown && right.length > 0 ? right.length + 2 : 0));
        if (left.length > 0 || right.length > 0) {
            rows.push({
                kind: "detail",
                draw: (seconds) => ends(left, shown ? liveStep(status, moving, seconds, half) : [], inner),
            });
        }
        rows.push(...threadRows(status, look, inner, caps));
    }
    else {
        rows.push(...invitation(view, inner, options.docked === true));
    }
    const notice = (mark, subject, text, color) => {
        const drawn = ends([...words(`▎${mark} `, color, { bold: true }), ...words(subject, color, { bold: true }), ...words(text, TEXT)], [], inner);
        return { kind: "notice", draw: () => drawn };
    };
    if (alert)
        rows.push(notice("✗", "cannot read ", safe(view.unreadable.join(", ")), RED));
    if (status?.restart)
        rows.push(notice("!", safe(status.restart), " · restart Codex to load it", AMBER_INK));
    const skills = status === null || view.session === null ? null : skillsRow(status, look, inner, caps);
    if (skills !== null)
        rows.push(skills);
    const room = options.rows - 2;
    let body = rows.length > room ? keepRows(rows, options.rows === 2 ? 1 : room) : rows;
    const threads = (of) => of.filter((row) => row.kind === "thread").length;
    const shownThreads = threads(body);
    if (status !== null && shownThreads > 0 && shownThreads < threads(rows)) {
        const short = threadRows(status, look, inner, caps, shownThreads);
        body = body.map((row) => (row.kind === "thread" ? (short.shift() ?? row) : row));
    }
    const blank = { kind: "blank", draw: () => Array(inner).fill(BLANK) };
    const wide = width >= SUN_MIN;
    if (wide && body.length === rows.length) {
        // The map and the detail line change length with every tool; the sun never depends on them, so the card
        // keeps its height while LIT works.
        for (let grow = 0; grow <= GROW_MAX && body.length + grow <= room; grow++) {
            const grown = [...body, ...Array(grow).fill(blank)];
            const top = grown.length - SUN_ROWS;
            const steady = grown.slice(Math.max(0, top)).every((row) => row.kind !== "map" && row.kind !== "detail");
            if (steady &&
                sunFits(grown.map((row) => row.draw(0)), top, inner)) {
                body = grown;
                break;
            }
        }
    }
    if (options.docked === true && body.length < room) {
        body = [...body, ...Array(room - body.length).fill(blank)];
    }
    const layout = body.map((row) => row.draw(0));
    const top = body.length - SUN_ROWS;
    const palette = look === "turn" ? AMBER : DUSK;
    const wheel = look === "rewind" ? (x) => wheelAt(x / inner) : null;
    const sunset = wide ? layoutSunset(layout, top, inner, { palette, moving, dim: look === "quiet", wheel }) : null;
    const laneAt = (x) => {
        const lanes = reviewing ?? [];
        const index = Math.min(lanes.length - 1, Math.floor((x * lanes.length) / width));
        return Number.parseInt(laneColor(index, lanes[index] ?? "dim").slice(1), 16);
    };
    const frame = (x) => {
        // The last four cells share one colour, as the first four do, so a corner and its rule are one line.
        const share = (Math.floor(Math.min(x, width - 4) / 4) * 4) / width;
        if (alert)
            return RED;
        if (look === "rewind")
            return wheelAt(share);
        if (look === "turn")
            return along(AMBER.rule, share);
        if (look === "done")
            return along(LIT_GREEN, share);
        if (reviewing !== null)
            return laneAt(x);
        const color = along(NEON, share);
        return look === "quiet" ? mix(color, FAINT, 0.45) : color;
    };
    const swept = (x, burst) => {
        if (burst === null)
            return frame(x);
        const near = Math.max(0, 1 - Math.abs(x / width - burst * 1.3) * 6);
        return mix(frame(x), along(WHEEL, (x / width + burst) % 1), near);
    };
    const edge = (text, x, burst) => ({ text, fg: swept(x, burst) });
    const idleDock = options.docked === true && status === null;
    const word = idleDock ? words("READY", DIM, { bold: true }) : stateWord(view, look);
    const brand = look === "turn"
        ? brandPill(caps, STATE_COLOURS.turn.pill)
        : look === "done" || look === "lit"
            ? brandPill(caps, STATE_COLOURS.done.pill)
            : look === "rewind"
                ? brandPill(caps, WHEEL.map((color) => mix(color, WHITE, 0.3)))
                : brandPill(caps);
    const nameColor = look === "quiet" ? TEXT : look === "turn" ? AMBER_INK : look === "rewind" ? TEXT : ACCENT;
    const title = words(idleDock ? "ready" : titleOf(view), nameColor, { bold: true });
    const fixed = 3 + brand.length + 3 + 1 + 1;
    const wordRoom = word.length + 4;
    const withWord = fixed + Math.min(title.length, 8) + wordRoom <= width;
    const shownTitle = cut(title, Math.max(0, width - fixed - (withWord ? wordRoom : 2)));
    const sunX = sunset === null ? 0 : sunset.middle + 2;
    const gap = sunset?.sun === true ? [sunLeft(inner) + 2, sunLeft(inner) + 2 + SUN_WIDTH] : null;
    const [bottom, heard] = bottomGroups(figures(view, look, now, caps), width, gap);
    const topRow = (seconds, burst) => {
        const row = ["╭", "─", " "].map((text, x) => edge(text, x, burst));
        row.push(...brand);
        if (shownTitle.length > 0)
            row.push(...words(" · ", DIM), ...shownTitle);
        row.push(BLANK);
        const tail = withWord ? word.length + 4 : 2;
        // While LIT works a soft light travels along the top rule.
        const head = moving ? ((seconds % 6) / 6) * (width + 24) - 8 : Number.NEGATIVE_INFINITY;
        while (row.length < width - tail) {
            const x = row.length;
            const behind = head - x;
            const glow = behind >= 0 && behind <= 12 ? 1 - behind / 12 : 0;
            row.push({
                text: "─",
                fg: glow > 0 ? mix(swept(x, burst), glow > 0.8 ? WHITE : 0xffb0d8, glow) : swept(x, burst),
            });
        }
        if (withWord)
            row.push(BLANK, ...word, BLANK);
        row.push(edge("─", width - 2, burst), edge("╮", width - 1, burst));
        return row;
    };
    const bottomRow = (seconds, burst) => {
        const row = ["╰", "─"].map((text, x) => edge(text, x, burst));
        if (bottom.length > 0)
            row.push(BLANK, ...bottom, BLANK);
        const tail = heard.length > 0 ? heard.length + 4 : 2;
        while (row.length < width - tail) {
            const x = row.length;
            let color = swept(x, burst);
            // Under the sun the rule is water: rings of its light run outward along it.
            const at = Math.floor(x / 2) * 2;
            const near = sunset?.sun === true ? Math.max(0, 1 - Math.abs(at - sunX) / 26) : 0;
            if (near > 0 && look !== "rewind" && !alert && reviewing === null && look !== "done") {
                const ring = 0.5 + 0.5 * Math.sin(Math.abs(at - sunX) * 0.55 - seconds * 2.6);
                const light = near > 0.6 ? 0xffd24a : 0xff8f3c;
                const lit = mix(color, light, Math.min(1, near * (0.45 + 0.85 * ring)));
                color = look === "quiet" ? mix(lit, FAINT, 0.45) : lit;
            }
            row.push({ text: "─", fg: color });
        }
        if (heard.length > 0)
            row.push(BLANK, ...heard, BLANK);
        row.push(edge("─", width - 2, burst), edge("╯", width - 1, burst));
        return row;
    };
    const paint = (seconds, burst = null) => {
        const grid = body.map((row) => [...row.draw(seconds)]);
        sunset?.paint(grid, seconds, burst);
        const middle = grid.map((row) => [edge("│", 0, burst), BLANK, ...row, BLANK, edge("│", width - 1, burst)]);
        if (options.rows <= 1)
            return [topRow(seconds, burst)];
        if (options.rows === 2)
            return [topRow(seconds, burst), ...middle.slice(0, 1)];
        return [topRow(seconds, burst), ...middle, bottomRow(seconds, burst)];
    };
    return { moving, paint };
}
