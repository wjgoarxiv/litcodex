// The installer's question cards, step card and closing summary for a person at a real terminal.
//
// Nothing here runs unless `cardsAvailable` says so: pipes, CI, `--yes`, dumb or tiny terminals keep the plain prompts
// and lines in index.ts. A card is redrawn in place, never wider or taller than the window, and folds to one line once
// it is answered or its work is done. Whether pills, buttons and the highlighted row end in round caps is the HUD's
// own rule, asked once; the caps stand in the cells a square form fills, so nothing moves between the two.

import { emitKeypressEvents } from "node:readline";
import { displayWidth } from "@litcodex/lit-loop/dist/hud.js";
import { roundGlyphs } from "@litcodex/lit-loop/dist/hud-glyphs.js";
import { lightBackground } from "@litcodex/lit-loop/dist/hud-scene.js";
import { type ColorMode, colorMode, supportsBlocks } from "@litcodex/lit-loop/dist/lit-mark.js";
import { CHROME_STOPS, SIZES, sampleStops, synthwaveRows } from "../synthwave.js";
import type { SpinnerMotion } from "./install-ui.js";
import type { SpinnerMotionLook } from "./spinner-motion.js";

const MIN_COLUMNS = 40;
const MIN_ROWS = 12;
const MAX_WIDTH = 100;
const LIST_ROWS = 12;
/** Every value starts in this column of the window; a card's text starts in column 3. */
const VALUE = 24;
const TEXT = 3;
/** Inside a narrower card a value goes under its label. */
const WIDE = 56;
const LEFT_CAP = "\ue0b6";
const RIGHT_CAP = "\ue0b4";
/** Keys typed before a card is on screen were not meant for it. */
const SETTLE_MS = 30;
/** `y` then Enter is a habit: the letter has already answered, so an Enter this soon belongs to it. */
const LETTER_ENTER_MS = 400;
const DIGIT_MS = 1000;
/** The cells of a button's label. */
const BUTTON = 15;
const ESC = "\x1b[";

type Listener = (...args: never[]) => void;

interface Emitter {
	on(event: string, listener: Listener): unknown;
	removeListener(event: string, listener: Listener): unknown;
}

export interface CardInput extends Emitter {
	readonly isTTY?: boolean | undefined;
	setRawMode?(mode: boolean): unknown;
	resume(): unknown;
	pause(): unknown;
}

export interface CardOutput extends Emitter {
	readonly isTTY?: boolean | undefined;
	readonly columns?: number | undefined;
	readonly rows?: number | undefined;
	getColorDepth?(env?: object): number;
	/** Node's own: asks the terminal for its size now, while a child process keeps the resize event waiting. */
	_refreshSize?(): void;
	write(text: string): unknown;
}

/** The signal and job-control half of `process`; a test passes its own. */
export interface CardProcess extends Emitter {
	readonly pid: number;
	readonly platform: string;
	kill(pid: number, signal: NodeJS.Signals): unknown;
}

export interface CardTerminal {
	readonly input: CardInput;
	readonly output: CardOutput;
	readonly env: NodeJS.ProcessEnv;
	readonly motion?: ((look: SpinnerMotionLook) => SpinnerMotion) | undefined;
	readonly proc?: CardProcess;
	readonly now?: () => number;
	readonly settleMs?: number;
}

interface Key {
	readonly name?: string;
	readonly ctrl?: boolean;
	readonly meta?: boolean;
}

export interface CardChoice {
	readonly label: string;
	readonly detail?: string;
	/** The short form shown once answered; `label` when absent. */
	readonly answer?: string;
}

export type RowMark = "done" | "warn" | "fail" | "note";

export interface PanelRow {
	readonly mark?: RowMark;
	readonly label?: string;
	readonly value: string;
}

export interface PanelSection {
	readonly head?: string;
	readonly rows: readonly PanelRow[];
}

/** Cards need a person at a terminal: two TTYs, raw mode, room to draw, no CI. */
export function cardsAvailable(terminal: Pick<CardTerminal, "input" | "output" | "env">): boolean {
	const { input, output, env } = terminal;
	return (
		input.isTTY === true &&
		output.isTTY === true &&
		typeof input.setRawMode === "function" &&
		env["CI"] === undefined &&
		!/^dumb$/iu.test(env["TERM"] ?? "") &&
		(output.columns || 80) >= MIN_COLUMNS &&
		(output.rows || 24) >= MIN_ROWS
	);
}

// ---- colour ------------------------------------------------------------------------------------

/** A true colour and its nearest of the 16 (as a foreground code). */
interface Tone {
	readonly hex: string;
	readonly ansi16: number;
}

const PINK: Tone = { hex: "#ff2d95", ansi16: 95 };
const VIOLET: Tone = { hex: "#b48cff", ansi16: 94 };
const ORANGE: Tone = { hex: "#ff8f3c", ansi16: 93 };
/** LitCodex's own mint, from the top of the mark's letters. */
const MINT: Tone = { hex: CHROME_STOPS[1] ?? "#7cf5b0", ansi16: 92 };
const INK: Tone = { hex: "#0b0e14", ansi16: 30 };
const IVORY: Tone = { hex: "#f2efdf", ansi16: 97 };
const SELECTED: Tone = { hex: "#34205c", ansi16: 35 };
const GREEN: Tone = { hex: "#50e68c", ansi16: 92 };
const AMBER: Tone = { hex: "#ffb02e", ansi16: 93 };
const RED: Tone = { hex: "#ff5577", ansi16: 91 };

type Depth = ColorMode | "16";

function cardDepth(output: CardOutput, env: NodeJS.ProcessEnv): Depth {
	const mode = colorMode({ isTty: output.isTTY === true, env });
	return mode === "256" && (output.getColorDepth?.(env) ?? 8) <= 4 ? "16" : mode;
}

function sgr(tone: Tone, layer: 38 | 48, depth: Depth): string {
	if (depth === "16") return String(tone.ansi16 + (layer === 48 ? 10 : 0));
	const rgb = sampleStops([tone.hex, tone.hex], 0);
	if (depth === "truecolor") return `${layer};2;${rgb.join(";")}`;
	const [r, g, b] = rgb.map((value) => Math.round((value / 255) * 5)) as [number, number, number];
	return `${layer};5;${16 + 36 * r + 6 * g + b}`;
}

function between(stops: readonly Tone[], t: number): Tone {
	const rgb = sampleStops(
		stops.map((stop) => stop.hex),
		t,
	);
	return {
		hex: `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`,
		ansi16: (stops[Math.round(t * (stops.length - 1))] ?? PINK).ansi16,
	};
}

// ---- text --------------------------------------------------------------------------------------

const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/gu, "");
const cells = (text: string): number => displayWidth(plain(text));
const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - cells(text)));

/** Word wrap in terminal cells. A word longer than a line, such as a path, is cut across lines, never shortened. */
export function wrapCells(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/u).filter((part) => part !== "")) {
		const joined = line === "" ? word : `${line} ${word}`;
		if (cells(joined) <= width) {
			line = joined;
			continue;
		}
		if (line !== "") lines.push(line);
		line = "";
		for (const char of word) {
			if (cells(line + char) > width) {
				lines.push(line);
				line = "";
			}
			line += char;
		}
	}
	return line !== "" || lines.length === 0 ? [...lines, line] : lines;
}

const UNICODE = {
	corners: ["╭", "╮", "╰", "╯"],
	line: "─",
	side: "│",
	heavy: ["╔", "╗", "╚", "╝", "═", "║"],
	light: ["╭", "╮", "╰", "╯", "─", "│"],
	pointer: "❯",
	up: "↑",
	down: "↓",
	updown: "↑ ↓",
	sides: "← →",
	frames: "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
	marks: { done: "✓", warn: "!", fail: "✗", note: "·" },
} as const;

const ASCII = {
	corners: ["+", "+", "+", "+"],
	line: "-",
	side: "|",
	heavy: ["#", "#", "#", "#", "=", "#"],
	light: ["+", "+", "+", "+", "-", "|"],
	pointer: ">",
	up: "^",
	down: "v",
	updown: "Up Down",
	sides: "Left Right",
	frames: "-\\|/",
	marks: { done: "ok", warn: "!", fail: "x", note: "-" },
} as const;

const ASCII_WORDS: Readonly<Record<string, string>> = { "·": "-", "—": "-", "…": "...", "→": "->", 한국어: "Korean" };

const MARK_TONES: Readonly<Record<RowMark, Tone>> = {
	done: GREEN,
	warn: AMBER,
	fail: RED,
	note: VIOLET,
};

// ---- the cards -----------------------------------------------------------------------------------

export class InstallCards {
	private readonly terminal: CardTerminal;
	private readonly input: CardInput;
	private readonly output: CardOutput;
	private readonly proc: CardProcess;
	private readonly now: () => number;
	private readonly depth: Depth;
	private readonly ascii: boolean;
	private drawn: readonly string[] = [];
	private holding = false;
	private letterAt = Number.NEGATIVE_INFINITY;
	private readonly round: boolean;
	private drawnColumns = 0;
	/** What stands above: one blank row goes between any two blocks, and folds stand together. */
	private last: "nothing" | "line" | "fold" | "card" = "nothing";
	private hungUp = false;
	private asked = 0;
	private total = 0;
	private hint = "";

	constructor(terminal: CardTerminal) {
		this.terminal = terminal;
		this.input = terminal.input;
		this.output = terminal.output;
		this.proc = terminal.proc ?? (process as unknown as CardProcess);
		this.now = terminal.now ?? Date.now;
		this.depth = cardDepth(terminal.output, terminal.env);
		this.ascii = !supportsBlocks(terminal.env);
		const { env } = terminal;
		this.round = this.depth === "truecolor" && !lightBackground(env) && roundGlyphs(env);
	}

	/** The mark, its version and its line, centred over the cards and sized so a card still fits under it. */
	banner(version: string, subtitle: string): void {
		const width = this.width();
		const rows = this.output.rows || 24;
		const least = rows >= 48 ? 0 : rows >= 34 ? 1 : 2;
		const size = SIZES.find(({ minCols }, index) => index >= least && minCols <= width) ?? { minCols: 24 };
		const indent = " ".repeat(1 + Math.floor((width - size.minCols) / 2));
		const mode = this.ascii ? "plain" : this.depth === "none" ? "mono" : this.depth === "16" ? "256" : this.depth;
		const mark = synthwaveRows({ columns: size.minCols, mode });
		const centred = (text: string): string => " ".repeat(1 + Math.max(0, Math.floor((width - cells(text)) / 2)));
		const art = this.ascii
			? mark.map((row) => centred(this.text(row)) + this.text(row))
			: mark.map((row) => indent + row);
		const name = `v${version}`;
		const line = this.wrapped(subtitle, width).map((row) => centred(row) + this.quiet(row));
		this.output.write(`\n${[...art, centred(name) + name, ...line].join("\n")}\n`);
		this.last = "line";
	}

	/**
	 * Prints the opening line and takes how many questions this run may ask, for the `LIT 2/6` step pills. The hint is
	 * a dim line in an empty row of the first card, or at its foot where it has none; a narrow card takes two rows.
	 */
	begin(total: number, line: string, hint = ""): void {
		this.total = total;
		this.hint = hint;
		const rows = this.wrapped(line, this.width()).map((row) => ` ${this.quiet(row)}`);
		this.output.write(`${this.gap()}${rows.join("\n")}\n`);
		this.last = "line";
	}

	/** One choice from a numbered list; resolves its index. Enter takes the highlighted row. */
	choose(question: {
		readonly title: string;
		readonly note: string;
		readonly choices: readonly CardChoice[];
		readonly initial: number;
		/** The word on the row Enter takes at first: what today's `[0]` says. */
		readonly initialTag?: string;
	}): Promise<number> {
		const { choices, initial } = question;
		const tag = this.nextTag();
		let at = initial;
		let typed = "";
		let typedAt = Number.NEGATIVE_INFINITY;
		const move = (to: number): undefined => {
			at = Math.max(0, Math.min(choices.length - 1, to));
			return undefined;
		};
		return this.ask({
			title: question.title,
			view: () => this.choiceRows(tag, question, at),
			fold: (index) => choices[index]?.answer ?? choices[index]?.label ?? "",
			onKey: (text, name) => {
				if (name === "return" || name === "enter") return { value: at };
				if (name === "up" || name === "k") return move(at === 0 ? choices.length - 1 : at - 1);
				if (name === "down" || name === "j") return move(at === choices.length - 1 ? 0 : at + 1);
				if (name === "pageup") return move(at - LIST_ROWS + 2);
				if (name === "pagedown") return move(at + LIST_ROWS - 2);
				if (name === "home") return move(0);
				if (name === "end") return move(choices.length - 1);
				if (text === undefined || !/^\d$/u.test(text)) return undefined;
				// Digits typed together make one number: `1` then `2` goes to 1, then to 12.
				const joined = this.now() - typedAt < DIGIT_MS ? typed + text : text;
				typed = Number(joined) < choices.length ? joined : text;
				typedAt = this.now();
				return Number(typed) < choices.length ? move(Number(typed)) : undefined;
			},
		});
	}

	/** Yes or no. The default starts highlighted and is named on its button. */
	confirm(question: {
		readonly title: string;
		readonly note: string;
		readonly initial: boolean;
		readonly yes?: string;
		readonly no?: string;
	}): Promise<boolean> {
		const tag = this.nextTag();
		let yes = question.initial;
		return this.ask({
			title: question.title,
			view: () => this.confirmRows(tag, question, yes),
			fold: (value) => (value ? (question.yes ?? "yes") : (question.no ?? "no")),
			onKey: (text, name) => {
				if (name === "return" || name === "enter") return { value: yes };
				if (text !== undefined && /^[yn]$/iu.test(text)) {
					this.letterAt = this.now();
					return { value: /y/iu.test(text) };
				}
				if (name === "left" || name === "right" || name === "tab") yes = !yes;
				return undefined;
			},
		});
	}

	/** What is about to be written, and the one Enter that starts it. */
	async proceed(question: {
		readonly title: string;
		readonly note: string;
		readonly rows: readonly PanelRow[];
		readonly button: string;
		readonly answer: string;
	}): Promise<void> {
		const tag = this.nextTag();
		await this.ask({
			title: question.title,
			view: () => {
				const inner = this.inner();
				const note = this.wrapped(question.note, inner);
				const rows = question.rows.flatMap((row) => this.panelRow(row, inner));
				const enter = `Enter = ${question.button}`;
				const hints = this.hints([enter, "Ctrl+C stop, nothing written yet"], inner);
				const label = `${this.glyph.pointer} ${question.button}`;
				const big = this.button(label, true, true);
				const small = this.button(label, true, false);
				// The smallest window keeps the sentence, the button and the way out, and as many facts as still fit.
				const facts = question.rows.flatMap(({ label: name = "", value }) =>
					this.wrapped(`${name} ${value}`, inner),
				);
				const least = [...small, ...this.hints([enter, "Ctrl+C stop"], inner)];
				const spare = this.height() - this.frame(tag, question.title, [...note, ...least]).length;
				return this.fitted(tag, question.title, [
					["", ...note, "", ...rows, "", ...big, "", ...hints],
					[...note, ...rows, ...big, ...hints],
					[...note, ...rows, ...small, ...hints],
					[...note, ...(spare > 0 ? facts.slice(-spare) : []), ...least],
				]);
			},
			fold: () => question.answer,
			onKey: (_text, name) => (name === "return" || name === "enter" ? { value: true } : undefined),
		});
	}

	/** The install's steps in one card: the rows wait, run and settle in place, and the whole card folds at the end. */
	steps(title: string, list: readonly InstallCardStep[]): StepCard {
		const marks: (RowMark | "wait" | "run")[] = list.map(() => "wait");
		const details: (string | undefined)[] = list.map(() => undefined);
		let active = -1;
		let halt: (() => void) | undefined;
		const pause = (): void => {
			halt?.();
			halt = undefined;
			this.output._refreshSize?.();
		};
		const draw = (): void => {
			pause();
			const view = this.stepRows(title, list, marks, details, active);
			if (this.drawn.length > 0 && this.drawnColumns !== this.columns()) this.redraw(view.rows);
			// Every row again: the spinner may have left its frame elsewhere if the window changed under it.
			else this.draw(view.rows, this.drawn.length, true);
			if (active < 0 || marks[active] !== "run") return;
			// `codex` runs synchronously, so another thread turns the one spinner cell and comes back below the card.
			halt = this.terminal
				.motion?.({
					before: `${ESC}${view.up}A\r${ESC}${TEXT}C${this.depth === "none" ? "" : `${ESC}1;${sgr(MINT, 38, this.depth)}m`}`,
					after: `${this.depth === "none" ? "" : `${ESC}0m`}${ESC}${view.up}B\r`,
					frames: [...this.glyph.frames],
				})
				.start("");
		};
		const settle = (mark: RowMark, detail?: string): void => {
			if (active < 0) return;
			marks[active] = mark;
			details[active] = detail;
			draw();
		};
		draw();
		return {
			start: (name) => {
				active = list.findIndex((step, index) => step.name === name && marks[index] === "wait");
				if (active >= 0) marks[active] = "run";
				draw();
			},
			end: (mark, detail) => settle(mark, detail),
			fold: (label, value, mark = "done") => {
				pause();
				this.replace(this.folded(mark, label, value));
			},
			stop: () => {
				if (marks[active] === "run") settle("fail");
				this.drawn = [];
				this.last = "card";
				return list[active]?.name;
			},
		};
	}

	private stepRows(
		title: string,
		list: readonly InstallCardStep[],
		marks: readonly (RowMark | "wait" | "run")[],
		details: readonly (string | undefined)[],
		active: number,
	): { readonly rows: string[]; readonly up: number } {
		const inner = this.inner();
		const gap = this.markWidth();
		const beside = VALUE - TEXT - gap;
		const longest = Math.max(...list.map(({ name }) => cells(name))) + 2;
		const name = list.every(({ text }) => gap + beside + cells(text) <= inner) ? beside : longest;
		const rowsOf = list.map((step, index): string[] => {
			const mark = marks[index] ?? "wait";
			const sign =
				mark === "wait"
					? this.quiet(this.glyph.marks.note)
					: mark === "run"
						? this.paint(this.glyph.frames[0] ?? "", { fg: MINT, bold: true })
						: this.paint(this.glyph.marks[mark], { fg: MARK_TONES[mark], bold: true });
			const detail = details[index];
			const bold = mark === "run" || mark === "fail" || mark === "warn";
			const label = pad(this.paint(step.name, { bold }), name);
			const fits = gap + name + cells(step.text) <= inner;
			if (detail === undefined) return [`${pad(sign, gap)}${label}${fits ? step.text : ""}`.trimEnd()];
			return this.wrapped(detail, inner - gap - name).map(
				(text, row) =>
					`${row === 0 ? pad(sign, gap) + label : " ".repeat(gap + name)}${this.paint(text, { bold: true })}`,
			);
		});
		const rows = this.fitted("LIT", title, [["", ...rowsOf.flat()], rowsOf.flat()]);
		if (rows.length <= this.height()) return { rows, up: 1 + rowsOf.slice(Math.max(0, active)).flat().length };
		const room = this.height() - (rows.length - rowsOf.flat().length);
		const from = Math.max(0, Math.min(active - Math.floor(room / 2), list.length - room));
		const shown = rowsOf.slice(from, from + room);
		return {
			rows: this.frame("LIT", title, shown.flat().slice(-room)),
			up: 1 + shown.slice(Math.max(0, active - from)).flat().length,
		};
	}

	/** A finished card: sections of marked rows. A value is wrapped, never cut short. */
	panel(card: { readonly title: string; readonly sections: readonly PanelSection[]; readonly bad?: boolean }): string {
		const inner = this.inner();
		const body = card.sections
			.filter((section) => section.rows.length > 0)
			.flatMap((section) => [
				"",
				...(section.head === undefined ? [] : [this.paint(section.head, { fg: PINK, bold: true })]),
				...section.rows.flatMap((row) => this.panelRow(row, inner)),
			]);
		const text = `${this.gap()}${this.frame("LIT", card.title, body, card.bad === true).join("\n")}\n`;
		this.last = "card";
		return text;
	}

	/** Free text under a card: a bold first line, the prose wrapped to the card's width, indented commands whole. */
	notice(text: string): string {
		const [head = "", ...rest] = text.trim().split("\n");
		const width = this.width();
		const body = rest.flatMap((line) => {
			if (line.startsWith(" ")) return [`   ${line}`];
			return this.wrapped(line, width - 3).map((row) => `   ${row}`);
		});
		return `\n ${this.paint(this.text(head), { bold: true })}\n${body.join("\n")}\n`;
	}

	// ---- drawing a card ----

	private get glyph(): typeof UNICODE | typeof ASCII {
		return this.ascii ? ASCII : UNICODE;
	}

	private columns(): number {
		return this.output.columns || 80;
	}

	/** The blank row a new block needs under what stands above it. */
	private gap(): string {
		return this.last === "nothing" ? "" : "\n";
	}

	private height(): number {
		return Math.max(2, (this.output.rows || 24) - 1);
	}

	private width(): number {
		return Math.max(20, Math.min(this.columns() - 2, MAX_WIDTH));
	}

	private inner(): number {
		return this.width() - 4;
	}

	private markWidth(): number {
		return this.glyph.marks.done.length + 1;
	}

	/** What the terminal can show: the home folder as `~`, and plain words where the locale is not UTF-8. */
	private text(text: string): string {
		const home = this.terminal.env["HOME"];
		const short = home === undefined || home === "" ? text : text.replaceAll(`${home}/`, "~/");
		return this.ascii ? short.replace(/[·—…→]|한국어/gu, (found) => ASCII_WORDS[found] ?? found) : short;
	}

	private wrapped(text: string, width: number): string[] {
		return wrapCells(this.text(text), width);
	}

	private paint(text: string, style: { fg?: Tone; bg?: Tone; bold?: boolean; dim?: boolean }): string {
		if (this.depth === "none" || text === "") return text;
		const codes = [
			style.bold === true ? "1" : "",
			style.dim === true ? "2" : "",
			style.fg === undefined ? "" : sgr(style.fg, 38, this.depth),
			style.bg === undefined ? "" : sgr(style.bg, 48, this.depth),
		].filter((code) => code !== "");
		return codes.length === 0 ? text : `${ESC}${codes.join(";")}m${text}${ESC}0m`;
	}

	private quiet(text: string): string {
		return this.paint(text, { dim: true });
	}

	/** `text` along a gradient. Cells `from`… of `span` let one border share one gradient across its parts. */
	private ramp(
		text: string,
		stops: readonly Tone[],
		style: (tone: Tone) => { fg?: Tone; bg?: Tone; bold?: boolean },
		from = 0,
		span = [...text].length,
	): string {
		if (this.depth === "none") return text;
		const runs: { step: number; text: string }[] = [];
		[...text].forEach((char, index) => {
			const step = Math.round(((from + index) / Math.max(1, span - 1)) * 24);
			const last = runs.at(-1);
			if (last?.step === step) last.text += char;
			else runs.push({ step, text: char });
		});
		return runs.map((run) => this.paint(run.text, style(between(stops, run.step / 24)))).join("");
	}

	private border(text: string, from: number, bad = false): string {
		return this.ramp(text, bad ? [RED, RED] : [PINK, VIOLET, MINT], (fg) => ({ fg }), from, this.width());
	}

	private sided(row: string, bad = false): string {
		const { side } = this.glyph;
		return ` ${this.border(side, 0, bad)} ${pad(row, this.inner())} ${this.border(side, this.width() - 1, bad)}`;
	}

	/** Text on a gradient, two cells wider than the text: padding, or the round caps in its place. */
	private chip(text: string, stops: readonly Tone[]): string {
		const ink = (bg: Tone): { fg: Tone; bg: Tone; bold: boolean } => ({ fg: INK, bg, bold: true });
		const span = [...text].length + 2;
		if (!this.round) return this.ramp(` ${text} `, stops, ink);
		const cap = (glyph: string, fg: Tone | undefined): string => this.paint(glyph, fg === undefined ? {} : { fg });
		return `${cap(LEFT_CAP, stops[0])}${this.ramp(text, stops, ink, 1, span)}${cap(RIGHT_CAP, stops.at(-1))}`;
	}

	/** The highlighted list row: a bar over the whole width of the card, its two gutters round where caps are drawn. */
	private bar(body: string): string {
		const open = `${ESC}${sgr(IVORY, 38, this.depth)};${sgr(SELECTED, 48, this.depth)}m`;
		const text = pad(body, this.inner() - 2).replaceAll(`${ESC}0m`, `${ESC}0m${open}`);
		if (!this.round) return `${open} ${text} ${ESC}0m`;
		return `${this.paint(LEFT_CAP, { fg: SELECTED })}${open}${text}${ESC}0m${this.paint(RIGHT_CAP, { fg: SELECTED })}`;
	}

	private frame(tag: string, title: string, body: readonly string[], bad = false): string[] {
		const width = this.width();
		const { corners, line } = this.glyph;
		const pill = this.depth === "none" ? `[${tag}]` : this.chip(tag, [ORANGE, PINK]);
		const name = this.text(title);
		const inEdge = cells(pill) + cells(name) + 9 <= width;
		const used = 4 + cells(pill) + (inEdge ? cells(name) + 3 : 0);
		const bold = (text: string): string => this.paint(text, { bold: true });
		const label = inEdge ? ` ${this.quiet(this.glyph.marks.note)} ${bold(name)} ` : " ";
		return [
			` ${this.border(corners[0] + line, 0, bad)} ${pill}${label}${this.border(line.repeat(Math.max(0, width - used - 1)) + corners[1], used, bad)}`,
			...[...(inEdge ? [] : wrapCells(name, this.inner()).map(bold)), ...body].map((row) => this.sided(row, bad)),
			` ${this.border(corners[2] + line.repeat(width - 2) + corners[3], 0, bad)}`,
		];
	}

	/** The roomiest of `variants` that fits the window; the blank row above a card is the first thing to go. */
	private fitted(tag: string, title: string, variants: readonly (readonly string[])[]): string[] {
		const pick = (bodies: typeof variants, most: number): string[] | undefined => {
			const cards = bodies.map((body) => this.frame(tag, title, body));
			const [first = []] = cards;
			const spaced = this.last === "nothing" ? [] : [["", ...first]];
			return [...spaced, ...cards].find((rows) => rows.length <= most);
		};
		const plain = pick(variants, this.height()) ?? this.frame(tag, title, variants.at(-1) ?? []);
		if (this.asked !== 1 || tag === "LIT" || this.hint === "") return plain;
		const hint = this.hintRows();
		const hinted = variants.map((body) => {
			const free = body.lastIndexOf("");
			return free < 0 ? [...body, ...hint] : [...body.slice(0, free), ...hint, ...body.slice(free + 1)];
		});
		// In the smallest window the hint takes rows of a list, and the card keeps its height.
		return pick(hinted, (this.output.rows || 24) > MIN_ROWS ? this.height() : plain.length) ?? plain;
	}

	/** The hint in at most two rows: cut between words, in the narrowest windows after the `/` of its package. */
	private hintRows(): string[] {
		const rows = this.wrapped(this.hint, this.inner());
		return (rows.length > 2 ? this.hint.split(/(?<=\/)/u) : rows).map((row) => this.quiet(row));
	}

	/** Key hints, as many to a line as fit; a hint is never split. */
	private hints(parts: readonly string[], width: number): string[] {
		const lines: string[] = [];
		for (const part of parts) {
			const joined = `${lines.at(-1) ?? ""}   ${part}`;
			if (lines.length > 0 && cells(joined) <= width) lines[lines.length - 1] = joined;
			else lines.push(part);
		}
		return lines.map((line) => this.quiet(line));
	}

	private choiceRows(
		tag: string,
		question: {
			readonly title: string;
			readonly note: string;
			readonly choices: readonly CardChoice[];
			readonly initial: number;
			readonly initialTag?: string;
		},
		at: number,
	): string[] {
		const { choices, initial } = question;
		const inner = this.inner();
		const note = this.wrapped(question.note, inner);
		const last = String(choices.length - 1);
		const label = Math.max(...choices.map((choice) => cells(this.text(choice.label))));
		const word = this.depth === "none" ? `(${question.initialTag ?? "default"})` : (question.initialTag ?? "default");
		const mark = last.length + label + cells(word) + 7 <= inner ? word : "*";
		const room = inner - 2 - 3 - last.length - label - 2 - (cells(mark) + 2);
		const detailed = choices.every((choice) => cells(this.text(choice.detail ?? "")) <= room);
		const row = (choice: CardChoice, index: number): string => {
			const on = index === at;
			const detail = detailed ? this.text(choice.detail ?? "") : "";
			const tagged =
				index === initial
					? `  ${on ? this.paint(mark, { bold: true }) : this.paint(mark, { fg: PINK, bold: true })}`
					: "";
			const body = `${on ? this.glyph.pointer : " "} ${String(index).padStart(last.length)} ${pad(this.text(choice.label), label)}${
				detail === "" ? "" : `  ${on ? detail : this.quiet(detail)}`
			}${tagged}`;
			return on && this.depth !== "none" ? this.bar(body) : ` ${body}`;
		};
		// A long list is a window that follows the highlight; the position and arrows say there is more.
		const body = (most: number, roomy: boolean): string[] => {
			const count = Math.max(1, Math.min(choices.length, most));
			const start = Math.max(0, Math.min(at - Math.floor(count / 2), choices.length - count));
			const all = count === choices.length;
			const arrows = [
				...(start > 0 ? [this.glyph.up] : []),
				...(start + count < choices.length ? [this.glyph.down] : []),
			];
			const hints = this.hints(
				[
					...(all ? [] : [`${at + 1}/${choices.length} ${arrows.join(" ")}`]),
					...(roomy || all ? [`${this.glyph.updown} move`, `0-${last} jump`] : []),
					"Enter choose",
					"Ctrl+C stop",
				],
				inner,
			);
			const list = choices.slice(start, start + count).map((choice, offset) => row(choice, start + offset));
			return roomy ? ["", ...note, "", ...list, "", ...hints] : [...note, ...list, ...hints];
		};
		const tight = Array.from({ length: LIST_ROWS }, (_, index) => body(LIST_ROWS - index, false));
		return this.fitted(tag, question.title, [body(LIST_ROWS, true), ...tight]);
	}

	/** A button: an outline around its label with room, the label alone without. The lit one holds a filled chip. */
	private button(label: string, on: boolean, big: boolean, width = BUTTON): string[] {
		const colour = this.depth !== "none";
		const word = pad(label, width);
		const lit = [PINK, VIOLET];
		if (!big) {
			if (on) return [colour ? this.chip(word, lit) : `[${word}]`];
			return [` ${this.quiet(word)} `];
		}
		const [tl, tr, bl, br, line, side] = on && !colour ? this.glyph.heavy : this.glyph.light;
		const top = tl + line.repeat(width + 4) + tr;
		const bottom = bl + line.repeat(width + 4) + br;
		if (!on || !colour) {
			return [this.quiet(top), `${this.quiet(side)}  ${word}  ${this.quiet(side)}`, this.quiet(bottom)];
		}
		const edge = (text: string): string => this.ramp(text, lit, (fg) => ({ fg }));
		const [left, right] = [this.paint(side, { fg: PINK }), this.paint(side, { fg: VIOLET })];
		return [edge(top), `${left} ${this.chip(word, lit)} ${right}`, edge(bottom)];
	}

	private confirmRows(
		tag: string,
		question: { readonly title: string; readonly note: string; readonly initial: boolean },
		yes: boolean,
	): string[] {
		const inner = this.inner();
		const note = this.wrapped(question.note, inner);
		const wide = inner >= 2 * (BUTTON + 6) + 2;
		const word = (value: boolean): string =>
			`${value === yes ? this.glyph.pointer : " "} ${value ? "Yes" : "No"}${
				value !== question.initial ? "" : wide ? " (default)" : " default"
			}`;
		const pair = (big: boolean): string[] => {
			const width = wide ? BUTTON : BUTTON - 2;
			const right = this.button(word(false), !yes, big, width);
			return this.button(word(true), yes, big, width).map((left, index) => `${left}  ${right[index] ?? ""}`);
		};
		const enter = `Enter = ${yes ? "Yes" : "No"}`;
		const hints = this.hints(["y / n answer", `${this.glyph.sides} switch`, enter, "Ctrl+C stop"], inner);
		const short = this.hints(["y / n", enter, "Ctrl+C stop"], inner);
		const buttons = pair(true);
		const roomy = buttons.every((row) => cells(row) <= inner) ? buttons : pair(false);
		return this.fitted(tag, `${question.title} ${question.initial ? "[Y/n]" : "[y/N]"}`, [
			["", ...note, "", ...roomy, "", ...hints],
			[...note, ...roomy, ...hints],
			[...note, ...pair(false), ...short],
		]);
	}

	private panelRow(row: PanelRow, inner: number): string[] {
		const kind = row.mark ?? "done";
		const gap = this.markWidth();
		const lead = pad(this.paint(this.glyph.marks[kind], { fg: MARK_TONES[kind], bold: true }), gap);
		const loud = kind === "warn" || kind === "fail";
		const value = (text: string): string => (loud ? this.paint(text, { bold: true }) : text);
		const label = this.text(row.label ?? "");
		if (label === "" || inner < WIDE) {
			const rows = this.wrapped(row.value, inner - gap).map(value);
			const name = label === "" ? (rows.shift() ?? "") : this.paint(label, { bold: true });
			return [lead + name, ...rows.map((text) => " ".repeat(gap) + text)];
		}
		const width = Math.max(VALUE - TEXT - gap, cells(label) + 1);
		return this.wrapped(row.value, inner - gap - width).map((text, index) =>
			index === 0
				? lead + pad(this.paint(label, { bold: true }), width) + value(text)
				: " ".repeat(gap + width) + value(text),
		);
	}

	private folded(mark: RowMark, title: string, value: string): string {
		const text = this.text(value);
		const sign = this.paint(this.glyph.marks[mark], { fg: MARK_TONES[mark], bold: true });
		const name = ` ${sign} ${this.text(title)}`;
		const aligned = `${pad(name, VALUE - 1)} `;
		const label = cells(aligned) + cells(text) < this.columns() ? aligned : `${name} `;
		return `${label}${this.paint(text, { bold: true })}`;
	}

	// ---- asking ----

	private nextTag(): string {
		this.asked += 1;
		return this.total < this.asked ? "LIT" : `LIT ${this.asked}/${this.total}`;
	}

	/** Draws over what is on screen in one write, so nothing flickers; a row that did not change is stepped over. */
	private draw(rows: readonly string[], above = this.drawn.length, whole = false): void {
		const shown = rows.slice(-this.height());
		const lift = above > 0 ? `${ESC}${above}A` : "";
		const old = !whole && above > 0 && this.drawn.length === shown.length ? this.drawn : [];
		const text = shown.map((row, index) => (old[index] === row ? "\r\n" : `\r${row}${ESC}K\r\n`)).join("");
		this.output.write(`${lift}${text}${ESC}J`);
		this.drawn = shown;
		this.drawnColumns = this.columns();
	}

	/** The rows the drawn card takes up now: after a resize some may have wrapped. */
	private taken(): number {
		const rows = this.drawn.reduce((sum, row) => sum + Math.max(1, Math.ceil(cells(row) / this.columns())), 0);
		return Math.min(rows, this.height());
	}

	private redraw(rows: readonly string[]): void {
		const above = this.taken();
		this.output.write(`${above > 0 ? `${ESC}${above}A` : ""}\r${ESC}J`);
		this.draw(rows, 0);
	}

	private replace(row: string): void {
		const above = this.taken();
		const gap = this.last === "fold" || this.last === "nothing" ? "" : "\r\n";
		this.output.write(`${above > 0 ? `${ESC}${above}A` : ""}\r${ESC}J${gap}${row}\r\n`);
		this.drawn = [];
		this.last = "fold";
	}

	private readonly restore = (): void => {
		if (!this.holding) return;
		this.holding = false;
		this.output.write(`${ESC}?25h`);
		if (!this.hungUp) this.input.setRawMode?.(false);
		this.input.pause();
	};

	private readonly onSignal = (signal: NodeJS.Signals): void => {
		// Changing the mode of a terminal that is going away stops the process (SIGTTOU) with no one to resume it.
		this.hungUp = signal === "SIGHUP";
		this.release();
		this.proc.kill(this.proc.pid, signal);
	};

	private hold(): void {
		this.holding = true;
		this.input.setRawMode?.(true);
		this.input.resume();
		this.output.write(`${ESC}?25l`);
		this.proc.on("exit", this.restore);
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) this.proc.on(signal, this.onSignal);
	}

	private release(): void {
		this.restore();
		this.proc.removeListener("exit", this.restore);
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) this.proc.removeListener(signal, this.onSignal);
	}

	/** Gives the terminal back for Ctrl+Z and draws again on return. */
	private suspend(view: () => readonly string[]): void {
		this.output.write(`${ESC}?25h`);
		this.input.setRawMode?.(false);
		const onContinue = (): void => {
			this.proc.removeListener("SIGCONT", onContinue);
			if (!this.holding) return;
			this.input.setRawMode?.(true);
			this.output.write(`${ESC}?25l`);
			this.draw(view(), 0);
		};
		this.proc.on("SIGCONT", onContinue);
		// The whole job, as the terminal would: a launcher left running would keep the shell waiting.
		this.proc.kill(0, "SIGTSTP");
	}

	private settle(): Promise<void> {
		return new Promise((resolve, reject) => {
			const onData = (chunk: Buffer | string): void => {
				if (String(chunk).includes("\x03")) done(new CardAbort("Ctrl+C"));
			};
			const done = (error?: Error): void => {
				clearTimeout(timer);
				this.input.removeListener("data", onData);
				if (error === undefined) resolve();
				else reject(error);
			};
			const timer = setTimeout(done, this.terminal.settleMs ?? SETTLE_MS);
			this.input.on("data", onData);
		});
	}

	/** Draws `view()`, feeds it keys until `onKey` returns a value, then folds the card to one line. */
	private async ask<Value>(card: {
		readonly title: string;
		readonly view: () => readonly string[];
		readonly fold: (value: Value) => string;
		readonly onKey: (text: string | undefined, name: string | undefined) => { readonly value: Value } | undefined;
	}): Promise<Value> {
		this.hold();
		const cleanup: (() => void)[] = [];
		const listen = (emitter: Emitter, event: string, listener: Listener): void => {
			emitter.on(event, listener);
			cleanup.push(() => emitter.removeListener(event, listener));
		};
		try {
			await this.settle();
			this.draw(card.view());
			const value = await new Promise<Value>((resolve, reject) => {
				let open = true;
				const finish = (settle: () => void): void => {
					open = false;
					settle();
				};
				emitKeypressEvents(this.input as unknown as NodeJS.ReadableStream);
				listen(this.input, "keypress", (text: string | undefined, key: Key | undefined) => {
					if (!open) return;
					const { name, ctrl, meta } = key ?? {};
					if (ctrl === true && (name === "c" || name === "d")) {
						return finish(() => reject(new CardAbort(name === "c" ? "Ctrl+C" : "Ctrl+D")));
					}
					if (ctrl === true && name === "z" && this.proc.platform !== "win32") return this.suspend(card.view);
					if (ctrl === true || meta === true || name === "escape") return;
					if ((name === "return" || name === "enter") && this.now() - this.letterAt < LETTER_ENTER_MS) return;
					const answer = card.onKey(text, name);
					if (answer === undefined) this.draw(card.view());
					else finish(() => resolve(answer.value));
				});
				listen(this.output, "resize", () => {
					if (open) this.redraw(card.view());
				});
				listen(this.input, "end", () => {
					this.hungUp = true;
					if (open) finish(() => reject(new CardAbort("the terminal closed")));
				});
			});
			this.replace(this.folded("done", card.title, card.fold(value)));
			return value;
		} catch (error) {
			this.replace(this.folded("fail", card.title, "stopped"));
			throw error;
		} finally {
			for (const undo of cleanup) undo();
			this.release();
		}
	}
}

/** The user stopped at a question; worded like the plain prompt's own abort. */
export class CardAbort extends Error {
	override readonly name = "CardAbort";
	readonly interrupted: boolean;

	constructor(how: string) {
		super(`Aborted with ${how}`);
		this.interrupted = how === "Ctrl+C";
	}
}

export interface InstallCardStep {
	readonly name: string;
	readonly text: string;
}

export interface StepCard {
	readonly start: (name: string) => void;
	readonly end: (mark: RowMark, detail?: string) => void;
	/** Every step reported: the card becomes one line. */
	readonly fold: (label: string, value: string, mark?: RowMark) => void;
	/** Leaves the card on screen; a step that never reported is marked failed, and its name returned. */
	readonly stop: () => string | undefined;
}
