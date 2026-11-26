// The dark look, frozen: every cell (character, colours, weight) of the chat card, the footer, `litcodex hud` and
// `litcodex run` on a dark terminal, as a terminal holds them after the bytes were written. A row of the fixture may
// change only together with a decision to change that row; `LITCODEX_GOLDEN=write` rewrites the file.
//
// Decided so far:
// - chat card: the banner's label has its own row under the mark and the horizon is 32 cells, because a 36-column pane
//   broke both. The rows below the label stand one lower; their cells are the same.
// - brand pill: amber on every surface while it is your turn and green once the work is done, because one state wore up
//   to three colours. No other cell of those frames changed.
// - footer path at 80 columns: it starts at the stage at work, because the whole path was cut and at 64 the cut took the
//   stage or half its count. The sky beside the shorter path is the one that was always under it.
// - footer before a LIT run, no terminal size: the items stand on the second line and the folder on the third, because a
//   low window shows two lines and lost the items.
// - footer, no terminal size: a line ends at its last lit cell, because blank cells behind it made Codex end the line
//   in "…". Only blanks went.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CardStatus } from "./card-status.js";
import type { HudView } from "./hud.js";
import { createHudLoop } from "./hud-cli.js";
import { activationMessage } from "./lit-mark.js";
import { createRunScene, panelFrame, panelRows, renderRunPanel } from "./run-panel.js";
import { renderScreenCard } from "./screen-card.js";
import { FOOTER_STATE_KEY, footerTree, type TerminalSize, type UiNode } from "./sunset-footer.js";
import type { ThreadRow, ThreadView } from "./threads.js";
import { type ChecklistRow, type WorkflowSignals, workflowMapCells } from "./workflow-map.js";

const shown = vi.hoisted(() => ({ view: null as unknown, usage: null as unknown }));
vi.mock("./hud.js", async (original) => ({
	...(await original<typeof import("./hud.js")>()),
	readHud: () => shown.view,
	listSessions: () => {
		const { session } = shown.view as HudView;
		return session === null ? [] : [{ id: session.id, cwd: "/work/beta", updatedAt: 0, activeAt: session.lastSeen }];
	},
}));
vi.mock("./card-status.js", async (original) => ({
	...(await original<typeof import("./card-status.js")>()),
	readCardStatus: () => ({ ...(shown.view as HudView).status, usage: shown.usage }),
	createUsageReader: () => () => shown.usage,
}));

const FIXTURE = fileURLToPath(new URL("./fixtures/dark-golden.txt", import.meta.url));
const NOW = 1_800_000_000_000;
const ID = "019a0000-aaaa-7000-8000-000000000009";
const USAGE = { ctx: 24, fiveHour: 22, week: 54 };
const PLAN: WorkflowSignals = {
	work: { done: 2, total: 5, next: "Write the parser tests for 한국어 입력", status: "active" },
	goals: null,
	plan: "published",
	research: null,
};
const CHECKLIST: readonly ChecklistRow[] = [
	{ state: "done", label: "Read the grammar" },
	{ state: "current", label: "Write the parser tests for 한국어 입력" },
	{ state: "pending", label: "Wire the command" },
];

function status(over: Partial<CardStatus> = {}): CardStatus {
	return {
		version: 1,
		thread: ID,
		state: "ignited",
		mode: "start-work",
		look: null,
		ignitedAt: NOW - 60_000,
		map: workflowMapCells("start-work", PLAN),
		step: { tool: "Bash", startedAt: NOW - 12_000 },
		lastStepAt: null,
		lastTool: "Bash",
		turnStartedAt: NOW - 60_000,
		turnEndedAt: null,
		working: true,
		usage: USAGE,
		branch: "main",
		workspace: "beta",
		cardOpenedAt: null,
		now: NOW,
		...over,
	};
}
const ended = { step: null, working: false, turnEndedAt: NOW - 4_000 };
const thread = (over: Partial<ThreadRow>): ThreadRow => ({
	key: "lane-1",
	kind: "lane",
	name: "Aquinas",
	stage: null,
	gauge: "[▉▉░░░] 2/5",
	note: "",
	state: "running",
	active: false,
	...over,
});
const THREADS: ThreadView = {
	chain: [thread({ key: "frame-0", kind: "frame", name: "lit-loop", stage: "work", active: true })],
	lanes: [thread({}), thread({ key: "lane-2", name: "Hume", gauge: null, note: "4 steps", state: "idle" })],
	others: [],
	laneCount: 2,
	more: 0,
	back: false,
};
const STATES = {
	working: status(),
	turn: status({ ...ended, look: "turn" }),
	done: status({ ...ended, look: "done", state: "complete" }),
	idle: status(ended),
	paused: status({
		...ended,
		map: workflowMapCells("start-work", {
			...PLAN,
			work: { ...PLAN.work, status: "paused" } as WorkflowSignals["work"],
		}),
	}),
	review: status({
		look: "review",
		mode: "review-work",
		map: workflowMapCells("review-work", PLAN),
	}),
	rewind: status({ look: "rewind", mode: "lit-adhd" }),
	lanes: status({ mode: "lit-loop", threads: THREADS }),
	ready: status({ state: "ready", mode: null, map: null, step: null, working: false }),
} as const;
type State = keyof typeof STATES | "waiting";

function viewOf(state: State): HudView {
	if (state === "waiting") return { wanted: null, session: null, status: null, unreadable: [] };
	return {
		wanted: null,
		session: { id: ID, folder: "~/beta", lastSeen: NOW - 5_000 },
		status: STATES[state],
		unreadable: [],
	};
}

// ── A small terminal ─────────────────────────────────────────────────────────

interface Pen {
	fg: string;
	bg: string;
	bold: boolean;
	dim: boolean;
}
interface Square {
	readonly text: string;
	readonly look: string;
}
const PLAIN: Pen = { fg: "", bg: "", bold: false, dim: false };
const EMPTY: Square = { text: " ", look: "" };
const WIDE = /^(?:\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-꓏가-힣＀-｠])$/u;
const lookOf = (pen: Pen): string =>
	`${pen.fg}${pen.bg === "" ? "" : `/${pen.bg}`}${pen.bold ? "!" : ""}${pen.dim ? "~" : ""}`;

function apply(pen: Pen, params: string): Pen {
	const codes = params === "" ? [0] : params.split(";").map(Number);
	let next = pen;
	for (let at = 0; at < codes.length; at++) {
		const code = codes[at] ?? 0;
		if (code === 0) next = PLAIN;
		else if (code === 1) next = { ...next, bold: true };
		else if (code === 2) next = { ...next, dim: true };
		else if (code === 38 || code === 48) {
			const rgb = codes[at + 1] === 2;
			const color = rgb
				? codes
						.slice(at + 2, at + 5)
						.map((part) => part.toString(16).padStart(2, "0"))
						.join("")
				: `c${codes[at + 2]}`;
			next = code === 38 ? { ...next, fg: color } : { ...next, bg: color };
			at += rgb ? 4 : 2;
		} else throw new Error(`unexpected colour code ${params}`);
	}
	return next;
}

function screen(columns: number, rows: number) {
	const grid = Array.from({ length: rows }, () => Array<Square>(columns).fill(EMPTY));
	let [x, y] = [0, 0];
	let pen = PLAIN;
	let saved = { x, y, pen };
	const write = (bytes: string): void => {
		// A no-break space is drawn as a space; the chat card ends its rows' pills in one, because Codex drops a plain one.
		const drawnBytes = bytes.replaceAll("\xa0", " ");
		for (const part of drawnBytes.matchAll(/\u001b\[([0-9;?]*)([A-Za-z])|\u001b([78])|([^\u001b])/gu)) {
			const [, params = "", verb, save, char = ""] = part;
			const row = grid[y] as Square[];
			if (save === "7") saved = { x, y, pen };
			else if (save === "8") ({ x, y, pen } = saved);
			else if (verb === "m") pen = apply(pen, params);
			else if (verb === "H")
				[y, x] = params === "" ? [0, 0] : (params.split(";").map((n) => Number(n) - 1) as [number, number]);
			else if (verb === "G") x = Number(params) - 1;
			else if (verb === "K") row.fill(EMPTY, x);
			else if (verb === "J")
				for (const [at, line] of grid.entries()) line.fill(EMPTY, at < y ? columns : at === y ? x : 0);
			else if (verb !== undefined) continue;
			else if (char === "\n") [x, y] = [0, y + 1];
			else if (/^\p{M}$/u.test(char))
				row[x - 1] = { ...(row[x - 1] ?? EMPTY), text: (row[x - 1]?.text ?? "") + char };
			else {
				const look = lookOf(pen);
				row[x] = { text: char, look };
				if (WIDE.test(char)) row[++x] = { text: "", look };
				x++;
			}
		}
	};
	return { write, rows: () => grid.map((line) => [...line]) };
}

/** Each drawn row as its text and, under it, its looks: `<cells>x<look>`, an empty look being the terminal's own. */
function rowsText(rows: readonly (readonly Square[])[]): string[] {
	const out: string[] = [];
	rows.forEach((row, y) => {
		let end = row.length;
		while (end > 0 && row[end - 1]?.text === " " && !row[end - 1]?.look.includes("/")) end--;
		if (end === 0) return;
		const runs: [number, string][] = [];
		for (const { text, look } of row.slice(0, end)) {
			const last = runs.at(-1);
			// A blank without a background shows no foreground.
			const seen = text === " " && !look.includes("/") ? "" : look;
			if (last !== undefined && last[1] === seen) last[0]++;
			else runs.push([1, seen]);
		}
		out.push(
			`${String(y).padStart(2, "0")} ${row
				.slice(0, end)
				.map((square) => square.text)
				.join("")}`,
			`   ${runs.map(([size, look]) => `${size}x${look}`).join(" ")}`,
		);
	});
	return out;
}

// ── The four surfaces ────────────────────────────────────────────────────────

function card(input: Parameters<typeof renderScreenCard>[0]): string[] {
	const at = screen(120, 30);
	at.write(`${activationMessage(input.mode, {})}\n${renderScreenCard(input, { color: true })}`);
	return rowsText(at.rows());
}

function hud(state: State, columns: number, caps: boolean, scene: boolean, truecolor = true): string[] {
	shown.view = viewOf(state);
	shown.usage = state === "waiting" ? null : USAGE;
	const at = screen(columns, 38);
	const clock = { now: NOW };
	const loop = createHudLoop({
		env: { LITCODEX_HUD_GLYPHS: caps ? "nerd" : "basic" },
		wanted: null,
		out: { write: at.write, isTTY: true, columns, rows: 38 },
		color: true,
		truecolor,
		scene,
		now: () => clock.now,
	});
	loop.tick();
	// Twelve frames on, so cells that were rewritten alone count too.
	for (let frame = 0; frame < 12; frame++) {
		clock.now += 100;
		loop.frame();
	}
	return rowsText(at.rows());
}

function run(state: State, columns: number, caps: boolean, scene: boolean): string[] {
	shown.view = viewOf(state);
	shown.usage = null;
	const size = { columns, rows: 38 };
	const height = panelRows(size, scene);
	const at = screen(columns, 38);
	const clock = { now: NOW };
	const place = { childRows: 38 - height, cursorVisible: true };
	if (height === 4) {
		const panel = { status: (shown.view as HudView).status, checklist: CHECKLIST[1] ?? null };
		at.write(panelFrame(renderRunPanel(panel, { width: columns - 1, color: true, now: NOW }), place));
		return rowsText(at.rows());
	}
	const env = { HOME: "/work", LITCODEX_HUD_GLYPHS: caps ? "nerd" : "basic" };
	const moving = createRunScene(env, "/work/beta", NOW - 60_000, () => clock.now);
	moving.read({ rows: height, width: columns - 1 });
	at.write(panelFrame(moving.rows(), place));
	for (let frame = 0; frame < 12; frame++) {
		clock.now += 100;
		at.write(moving.changes(place.childRows));
	}
	return rowsText(at.rows());
}

/** The footer's tree as Codex lays it out, each line of it a row. */
function treeRows(node: UiNode): string[] {
	const lines: Square[][] = [];
	const walk = (part: UiNode, pen: Pen): void => {
		if (typeof part === "string") {
			// A word joiner has no cell; Codex drops it.
			for (const char of part.replaceAll("\u2060", "")) {
				lines.at(-1)?.push({ text: char, look: lookOf(pen) });
				if (WIDE.test(char)) lines.at(-1)?.push({ text: "", look: lookOf(pen) });
			}
			return;
		}
		if (part.type === "row" && part.props.wrap === "wrap") {
			for (const child of part.children) {
				lines.push([]);
				walk(child, pen);
			}
			return;
		}
		const next =
			part.type === "row"
				? { ...pen, bg: part.props.background ?? pen.bg }
				: { ...pen, fg: part.props?.color ?? pen.fg, bold: pen.bold || part.props?.weight === "bold" };
		for (const child of part.children) walk(child, next);
	};
	if (typeof node === "string" || node.type !== "row" || node.props.wrap !== "wrap") lines.push([]);
	walk(node, PLAIN);
	return rowsText(lines);
}

function footer(state: State, size: TerminalSize | null, caps: boolean): string[] {
	const agent = state === "working" || state === "lanes" ? "working" : "ready";
	const snapshot = {
		account: { rate_limits: [{ primary_limit: { used_percent: 22, window_minutes: 300 } }] },
		app: { cli_version: "0.172.0" },
		config: { statusline_items: ["model-with-reasoning", "context-remaining", "five-hour-limit", "project-name"] },
		thread: {
			id: ID,
			agent: { state: agent },
			model: { display_name: "local-lab", reasoning_level: "high" },
			workspace: { cwd: "/work/beta" },
			usage: { context: { used_percentage: 24 } },
		},
	};
	expect(FOOTER_STATE_KEY).toBe("com.openai/codex-statusline-state");
	const said = state === "waiting" ? null : STATES[state];
	return treeRows(footerTree(snapshot, { now: 12_300, size, caps, status: said }));
}

const WIDTHS = [54, 80, 110] as const;
const ALL: readonly State[] = ["idle", "paused", "review", "rewind", "lanes", "ready", "waiting"];
const MAIN: readonly State[] = ["working", "turn", "done"];

function frames(): string {
	const out: string[] = [];
	const add = (name: string, rows: readonly string[]): void => void out.push(`== ${name}`, ...rows);
	const map = workflowMapCells("start-work", PLAN);
	const base = { mode: "start-work", look: null, map, checklist: CHECKLIST, stack: null };
	add("card started", card({ ...base, note: "turn started" }));
	add("card turn", card({ ...base, look: "turn", note: "your turn · answer the question above" }));
	add("card done", card({ ...base, note: "turn done · 1 task done · next: Wire the command" }));
	add(
		"card stack",
		card({
			...base,
			mode: "lit-hijack",
			note: "turn started",
			stack: "paused: lit-loop (work) · type `lit continue`",
		}),
	);
	add(
		"card research",
		card({
			...base,
			mode: "litresearch",
			note: "turn started",
			map: workflowMapCells("litresearch", { ...PLAN, research: { wave: 2, verifying: false } }),
			checklist: [],
		}),
	);
	for (const width of WIDTHS) {
		for (const state of [...MAIN, "ready"] as const)
			add(`footer ${state} ${width}`, footer(state, { columns: width, rows: 38 }, false));
	}
	for (const state of [...MAIN, "ready", "waiting"] as const)
		add(`footer ${state} no tty`, footer(state, null, false));
	add("footer working 110 round", footer("working", { columns: 110, rows: 38 }, true));
	for (const draw of [
		["hud", hud],
		["run", run],
	] as const) {
		for (const width of WIDTHS) {
			for (const state of MAIN) add(`${draw[0]} ${state} ${width}`, draw[1](state, width, false, true));
		}
		for (const state of ALL) add(`${draw[0]} ${state} 110`, draw[1](state, 110, false, true));
		add(`${draw[0]} working 110 round`, draw[1]("working", 110, true, true));
	}
	for (const state of MAIN) {
		add(`hud ${state} 36`, hud(state, 36, false, true));
		add(`hud plain ${state} 80`, hud(state, 80, false, false));
		add(`hud plain ${state} 80 without truecolor`, hud(state, 80, false, false, false));
		add(`run plain ${state} 80`, run(state, 80, false, false));
	}
	return `${out.join("\n")}\n`;
}

/** The frames of the file by name. */
function byName(text: string): Map<string, string> {
	return new Map(
		text
			.split(/^== /mu)
			.slice(1)
			.map((part) => [part.slice(0, part.indexOf("\n")), part.slice(part.indexOf("\n") + 1)]),
	);
}

const drawn = frames();
if (process.env["LITCODEX_GOLDEN"] === "write") writeFileSync(FIXTURE, drawn);
const golden = byName(readFileSync(FIXTURE, "utf8"));

describe("the dark look", () => {
	it("draws the same frames every time and names the same ones", () => {
		expect(frames()).toBe(drawn);
		expect([...byName(drawn).keys()]).toEqual([...golden.keys()]);
	});

	it.each([...byName(drawn)])("%s keeps every cell", (name, rows) => {
		expect(rows).toBe(golden.get(name));
	});
});
