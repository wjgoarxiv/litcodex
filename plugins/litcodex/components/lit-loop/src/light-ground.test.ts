// What a white window shows, and how `litcodex hud` learns that it is one.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CardStatus } from "./card-status.js";
import { renderHud } from "./hud.js";
import { hudCommand } from "./hud-cli.js";
import { recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { renderRunPanel } from "./run-panel.js";
import { renderScreenCard, type ScreenCardOptions } from "./screen-card.js";
import { statuslineText } from "./statusline.js";
import { recordWorkflowTurn, type WorkflowMap, workflowMapCells } from "./workflow-map.js";

const ESC = "\u001b";
const QUERY = `${ESC}]11;?${ESC}\\`;
const WHITE = `${ESC}]11;rgb:ffff/ffff/ffff${ESC}\\`;
const DARK = `${ESC}]11;rgb:0d0d/1111/1717${ESC}\\`;
const ENTER = `${ESC}[?1049h${ESC}[?25l`;
const LEAVE = `${ESC}[?25h${ESC}[?1049l`;
const FRAME_TOP = "╭─";
const ID = "019a0000-eeee-7000-8000-000000000005";
const NOW = 1_800_000_000_000;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const MAP = workflowMapCells("start-work", {
	work: { done: 2, total: 5, next: "Wire the command", status: "active" },
	goals: null,
	plan: "published",
	research: null,
}) as WorkflowMap;

function status(over: Partial<CardStatus> = {}): CardStatus {
	return {
		version: 1,
		thread: ID,
		state: "ignited",
		mode: "start-work",
		look: null,
		ignitedAt: NOW - 60_000,
		map: MAP,
		step: { tool: "Bash", startedAt: NOW - 12_000 },
		lastStepAt: null,
		lastTool: "Bash",
		turnStartedAt: NOW - 60_000,
		turnEndedAt: null,
		working: true,
		usage: null,
		branch: "main",
		workspace: "beta",
		cardOpenedAt: null,
		now: NOW,
		...over,
	} as CardStatus;
}
const ended = { step: null, working: false, turnEndedAt: NOW - 4_000 };
const STATES: readonly (readonly [string, CardStatus])[] = [
	["working", status()],
	["your turn", status({ ...ended, look: "turn" })],
	["done", status({ ...ended, look: "done", state: "complete" })],
	["rewind", status({ look: "rewind", mode: "lit-adhd" })],
];

// ── Contrast ─────────────────────────────────────────────────────────────────

const luminance = (color: number): number =>
	[16, 8, 0]
		.map((shift) => ((color >> shift) & 255) / 255)
		.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
		.reduce((sum, c, index) => sum + c * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
const ratio = (a: number, b: number): number => {
	const [hi, lo] = [Math.max(luminance(a), luminance(b)), Math.min(luminance(a), luminance(b))];
	return (hi + 0.05) / (lo + 0.05);
};
/** A palette entry past the 16 a theme owns. */
const palette = (n: number): number => {
	if (n >= 232) return ((8 + (n - 232) * 10) * 0x010101) as number;
	const level = (v: number): number => (v === 0 ? 0 : 55 + v * 40);
	const at = n - 16;
	return (level(Math.floor(at / 36)) << 16) | (level(Math.floor(at / 6) % 6) << 8) | level(at % 6);
};
/** The ink a white theme gives plain words. */
const THEME_INK = 0x1f2328;

/** Every letter and digit with the colour it is drawn in, and the ground under it; a dim one fails by itself. */
function words(text: string): { char: string; fg: number; bg: number; own: boolean; dim: boolean }[] {
	const out: ReturnType<typeof words> = [];
	let pen = { fg: THEME_INK, bg: 0xffffff, own: true, dim: false };
	for (const [, params, char] of text.matchAll(/\u001b\[([0-9;]*)m|([^\u001b])/gu)) {
		if (char !== undefined) {
			if (/[\p{L}\p{N}]/u.test(char)) out.push({ char, ...pen });
			continue;
		}
		const codes = (params ?? "").split(";").map(Number);
		for (let at = 0; at < codes.length; at++) {
			const code = codes[at] ?? 0;
			if (code === 0) pen = { fg: THEME_INK, bg: 0xffffff, own: true, dim: false };
			else if (code === 2) pen = { ...pen, dim: true };
			else if (code === 38 || code === 48) {
				const rgb = codes[at + 1] === 2;
				const [r = 0, g = 0, b = 0] = codes.slice(at + 2, at + 5);
				const color = rgb ? (r << 16) | (g << 8) | b : palette(codes[at + 2] ?? 16);
				pen = code === 38 ? { ...pen, fg: color, own: false } : { ...pen, bg: color };
				at += rgb ? 4 : 2;
			} else if (code !== 1) throw new Error(`unexpected code ${code}`);
		}
	}
	return out;
}

function readable(name: string, text: string): void {
	for (const word of words(text)) {
		expect(word.dim, `${name}: ${word.char} is dim`).toBe(false);
		expect(ratio(word.fg, word.bg), `${name}: ${word.char} ${word.fg.toString(16)}`).toBeGreaterThanOrEqual(4.5);
	}
}

describe("words on a white window", () => {
	const CARD = {
		mode: "start-work",
		map: MAP,
		checklist: [
			{ state: "done", label: "Read the grammar" },
			{ state: "current", label: "Write the parser tests for 한국어 입력" },
			{ state: "pending", label: "Wire the command" },
		],
		stack: "Now: lit-hijack · paused: lit-loop (work) · type `lit continue` to go back",
	} as const;
	const OPTIONS: readonly ScreenCardOptions[] = [
		{ color: true, light: true },
		{ color: true, light: true, depth: 256 },
	];

	it.each([
		["turn started", null],
		["your turn · answer the question above", "turn"],
		["turn done · 1 task done", null],
	])("the chat card says %s in the terminal's own ink", (note, look) => {
		for (const options of OPTIONS) {
			const card = renderScreenCard({ ...CARD, note, look }, options);
			readable(note, card);
			// Only the words on a pill's own ground carry a colour.
			for (const word of words(card)) if (word.bg === 0xffffff) expect(word.own, word.char).toBe(true);
			expect(card.replace(/\u001b\[[0-9;]*m/gu, "")).toContain("▆▇▇▆");
			expect(card).toMatch(/\u001b\[[0-9;]*48;/u);
		}
	});

	it.each(STATES)("the hud's plain frame while %s", (name, card) => {
		const view = {
			wanted: null,
			session: { id: ID, folder: "~/beta", lastSeen: NOW - 5_000 },
			status: card,
			unreadable: ["live step"],
		};
		for (const truecolor of [true, false]) {
			const frame = renderHud(view, { width: 80, color: true, truecolor, light: true, now: NOW });
			readable(name, frame);
			const tinted = frame
				.split("\n")
				.filter((line) => words(line).some((word) => !word.own && word.bg === 0xffffff));
			expect(tinted.length).toBe(name === "your turn" || name === "done" ? 1 : 0);
			if (!truecolor) expect(frame).not.toMatch(/[34]8;2/u);
		}
	});

	it.each(STATES)("the run panel's four rows while %s", (name, card) => {
		const checklist = { state: "current", label: "Write the parser tests" } as const;
		readable(
			name,
			renderRunPanel({ status: card, checklist }, { width: 100, color: true, light: true, now: NOW }).join("\n"),
		);
		readable(
			name,
			renderRunPanel({ status: null, checklist: null }, { width: 100, color: true, light: true, now: NOW }).join(
				"\n",
			),
		);
	});

	it.each(STATES)("the status line while %s", (name, card) => {
		readable(name, statuslineText(card, { width: 100, color: true, light: true }));
	});

	it("leaves a dark window's bytes as they were", () => {
		for (const [, card] of STATES) {
			expect(statuslineText(card, { width: 100, color: true, light: false })).toBe(
				statuslineText(card, { width: 100, color: true }),
			);
		}
		const input = { ...CARD, note: "turn started", look: null };
		expect(renderScreenCard(input, { color: true, light: false })).toBe(renderScreenCard(input, { color: true }));
	});

	it("draws the card in 256 colours when asked, with the same characters", () => {
		const input = { ...CARD, note: "turn started", look: null };
		const strip = (text: string): string => text.replace(/\u001b\[[0-9;]*m/gu, "");
		const full = renderScreenCard(input, { color: true });
		const fewer = renderScreenCard(input, { color: true, depth: 256 });
		expect(strip(fewer)).toBe(strip(full));
		expect(fewer).not.toMatch(/[34]8;2;/u);
		expect(fewer).toMatch(/38;5;\d+/u);
		expect(fewer).toMatch(/48;5;\d+/u);
	});
});

// ── litcodex hud ─────────────────────────────────────────────────────────────

class Keyboard extends EventEmitter {
	readonly isTTY: boolean = true;
	readonly raw: boolean[] = [];
	flowing = false;
	setRawMode(mode: boolean): void {
		this.raw.push(mode);
	}
	resume(): void {
		this.flowing = true;
	}
	pause(): void {
		this.flowing = false;
	}
	type(text: string): void {
		this.emit("data", Buffer.from(text));
	}
}

function open(env: NodeJS.ProcessEnv = { COLORTERM: "truecolor" }, args: string[] = [], tty = true, now = () => NOW) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-light-")));
	roots.push(home);
	const all = { HOME: home, CODEX_HOME: join(home, ".codex"), LITCODEX_HUD_GLYPHS: "basic", ...env };
	const cwd = join(home, "beta");
	mkdirSync(cwd, { recursive: true });
	writeThreadPointer(all, ID, cwd, NOW - 1_000);
	recordWorkflowTurn(cwd, ID, "turn-1", "start-work", NOW - 1_000);
	recordTurnStart(cwd, ID, NOW - 1_000);
	recordLiveStepStart(cwd, ID, { tool: "Bash", toolUseId: "call-1" }, NOW - 1_000);
	const out: string[] = [];
	const stdin = new Keyboard();
	const signals = new EventEmitter();
	const suspended: string[] = [];
	const done = hudCommand(args, {
		stdin,
		stdout: { write: (text: string) => out.push(text), isTTY: tty, columns: 100, rows: 30 },
		stderr: { write: () => true },
		env: all,
		signals,
		now,
		suspend: () => suspended.push(out.at(-1) ?? ""),
	});
	const since = (at: number): string => out.slice(at).join("");
	return { out, stdin, signals, done, since, suspended };
}
const turn = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("litcodex hud and the terminal's ground", () => {
	it("asks once, reads raw keys, and draws dark until it is told otherwise", async () => {
		const hud = open();
		await turn();
		expect(hud.out.join("").split(QUERY)).toHaveLength(2);
		expect(hud.stdin.raw).toEqual([true]);
		expect(hud.stdin.flowing).toBe(true);
		expect(hud.out.join("")).toContain(FRAME_TOP);
		hud.stdin.type(DARK);
		hud.stdin.type("\u0003");
		expect(await hud.done).toBe(0);
		expect(hud.out.at(-1)).toBe(LEAVE);
		expect(hud.stdin.raw).toEqual([true, false]);
		expect(hud.stdin.flowing).toBe(false);
		expect(hud.stdin.listenerCount("data")).toBe(0);
	});

	it.each([
		["late", 400, [WHITE]],
		["split", 0, [WHITE.slice(0, 1), WHITE.slice(1, 9), WHITE.slice(9, -1), WHITE.slice(-1)]],
		["among typed keys", 0, [`ab${WHITE.slice(0, 7)}`, `${WHITE.slice(7)}cd`]],
	])("turns light on a %s answer and shows none of its bytes", async (_name, wait, parts) => {
		const hud = open();
		await turn(wait);
		const at = hud.out.length;
		for (const part of parts) hud.stdin.type(part);
		const after = hud.since(at);
		expect(after).toContain("start-work");
		expect(after).not.toContain(FRAME_TOP);
		expect(hud.out.join("").replaceAll(QUERY, "")).not.toMatch(/\]11|rgb:|ffff|abcd/u);
		hud.stdin.type("\u0003");
		expect(await hud.done).toBe(0);
	});

	it("follows a theme that turns dark again", async () => {
		const hud = open();
		await turn();
		hud.stdin.type(WHITE);
		const at = hud.out.length;
		hud.stdin.type(DARK);
		expect(hud.since(at)).toContain(FRAME_TOP);
		hud.signals.emit("SIGTERM");
		expect(await hud.done).toBe(0);
	});

	it.each([
		["NO_COLOR", { NO_COLOR: "1" }, [] as string[], true],
		["a pipe", { COLORTERM: "truecolor" }, [], false],
		["--once", { COLORTERM: "truecolor" }, ["--once"], true],
		["TERM=dumb", { COLORTERM: "truecolor", TERM: "dumb" }, [], true],
	])("asks nothing and leaves the keyboard alone with %s", async (_name, env, args, tty) => {
		const hud = open(env, args, tty);
		await turn();
		expect(hud.out.join("")).not.toContain("]11");
		expect(hud.stdin.raw).toEqual([]);
		expect(hud.stdin.listenerCount("data")).toBe(0);
		hud.signals.emit("SIGINT");
		expect(await hud.done).toBe(0);
	});

	it("keeps the keyboard raw a moment longer when it is quit before the answer", async () => {
		const hud = open();
		await turn();
		hud.stdin.type("\u0003");
		expect(hud.out.at(-1)).toBe(LEAVE);
		expect(hud.stdin.raw).toEqual([true]);
		hud.stdin.type(WHITE);
		expect(await hud.done).toBe(0);
		expect(hud.stdin.raw).toEqual([true, false]);
		expect(hud.out.at(-1)).toBe(LEAVE);
	});

	it("is quit by Ctrl-C when no answer ever comes", async () => {
		const hud = open();
		await turn();
		hud.stdin.type("x\u0003");
		expect(await hud.done).toBe(0);
		expect(hud.stdin.raw).toEqual([true, false]);
	});

	it("is quit by Ctrl-C after an answer that never ends", async () => {
		const hud = open();
		await turn();
		hud.stdin.type(`${ESC}]11;rgb:ff`);
		hud.stdin.type("\u0003");
		expect(hud.out.at(-1)).toBe(LEAVE);
		expect(await hud.done).toBe(0);
		expect(hud.stdin.raw).toEqual([true, false]);
	});

	it.skipIf(process.platform === "win32")("steps aside for Ctrl-Z and comes back", async () => {
		const hud = open();
		await turn();
		hud.stdin.type(DARK);
		hud.stdin.type("\u001a");
		expect(hud.suspended).toEqual([LEAVE]);
		expect(hud.stdin.raw).toEqual([true, false]);
		const at = hud.out.length;
		hud.signals.emit("SIGCONT");
		expect(hud.stdin.raw).toEqual([true, false, true]);
		expect(hud.since(at).startsWith(ENTER)).toBe(true);
		expect(hud.since(at)).toContain(FRAME_TOP);
		hud.stdin.type("\u0003");
		expect(await hud.done).toBe(0);
	});

	it.skipIf(process.platform === "win32")("takes the screen back when nothing stops it for Ctrl-Z", async () => {
		const hud = open();
		await turn();
		hud.stdin.type(DARK);
		const at = hud.out.length;
		hud.stdin.type("\u001a");
		await turn(600);
		// A pane with no shell over it: the signal stops nothing and SIGCONT never comes.
		expect(hud.since(at).startsWith(`${LEAVE}${ENTER}`)).toBe(true);
		expect(hud.stdin.raw).toEqual([true, false, true]);
		hud.stdin.type("\u0003");
		expect(await hud.done).toBe(0);
	});

	it.skipIf(process.platform === "win32")("draws nothing on the shell's screen while it is aside", async () => {
		const began = Date.now();
		const hud = open(undefined, [], true, () => NOW + Date.now() - began);
		await turn();
		hud.stdin.type(DARK);
		const before = hud.out.length;
		await turn(200);
		expect(hud.out.length).toBeGreaterThan(before);
		const at = hud.out.length;
		hud.stdin.type("\u001a");
		await turn(180);
		expect(hud.since(at)).toBe(LEAVE);
		hud.signals.emit("SIGCONT");
		hud.stdin.type("\u0003");
		expect(await hud.done).toBe(0);
	});

	it("draws the sunset in Windows Terminal", async () => {
		const hud = open({ WT_SESSION: "8f1c" });
		await turn();
		expect(hud.out.join("")).toContain(FRAME_TOP);
		hud.stdin.type("\u0003");
		expect(await hud.done).toBe(0);
	});
});
