// The installer's question cards, step card and closing summary for a person at a real terminal.
//
// Nothing here runs unless `cardsAvailable` says so: pipes, CI, `--yes`, dumb or tiny terminals keep the plain prompts
// and lines in index.ts. A question is redrawn in place, never wider or taller than the window, and folds to one line
// once answered. The step card only appends rows, because `codex` runs synchronously and the main thread cannot redraw.

import { emitKeypressEvents } from "node:readline";
import { displayWidth } from "@litcodex/lit-loop/dist/hud.js";
import { type ColorMode, colorMode, supportsBlocks } from "@litcodex/lit-loop/dist/lit-mark.js";
import { CHROME_STOPS, sampleStops } from "../synthwave.js";
import { CLEAR_LINE } from "../ui-style.js";
import type { SpinnerMotion } from "./install-ui.js";
import type { SpinnerMotionLook } from "./spinner-motion.js";

const MIN_COLUMNS = 40;
const MIN_ROWS = 12;
const MAX_WIDTH = 100;
const LIST_ROWS = 12;
/** A value with less room than this goes under its label. */
const MIN_VALUE = 22;
/** Keys typed before a card is on screen were not meant for it. */
const SETTLE_MS = 30;
/** `y` then Enter is a habit: the letter has already answered, so an Enter this soon belongs to it. */
const LETTER_ENTER_MS = 400;
const DIGIT_MS = 1000;
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

export type RowMark = "done" | "skip" | "warn" | "fail" | "note";

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
const INK: Tone = { hex: "#0b0f14", ansi16: 30 };
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
	marks: { done: "✓", skip: "○", warn: "!", fail: "✗", note: "·" },
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
	marks: { done: "ok", skip: "--", warn: "!!", fail: "xx", note: "-" },
} as const;

const ASCII_WORDS: Readonly<Record<string, string>> = { "·": "-", "—": "-", "…": "...", "→": "->", 한국어: "Korean" };

const MARK_TONES: Readonly<Record<RowMark, Tone>> = {
	done: GREEN,
	skip: VIOLET,
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
	/** The row above is a folded answer, so the next card needs a blank row first. */
	private afterFold = false;
	private hungUp = false;
	private asked = 0;
	private total = 0;

	constructor(terminal: CardTerminal) {
		this.terminal = terminal;
		this.input = terminal.input;
		this.output = terminal.output;
		this.proc = terminal.proc ?? (process as unknown as CardProcess);
		this.now = terminal.now ?? Date.now;
		this.depth = cardDepth(terminal.output, terminal.env);
		this.ascii = !supportsBlocks(terminal.env);
	}

	/** Prints the opening line and takes how many questions this run may ask, for the `LIT 2/6` step pills. */
	begin(total: number, line: string): void {
		this.total = total;
		const rows = this.wrapped(line, this.width()).map((row) => ` ${this.quiet(row)}`);
		this.output.write(`\n${rows.join("\n")}\n\n`);
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
				const rows = question.rows.flatMap((row) => this.panelRow(row, inner, labelWidth(question.rows)));
				const hints = this.hints([`Enter = ${question.button}`, "Ctrl+C stop, nothing written yet"], inner);
				const big = this.button(question.button, true, true);
				const small = this.button(question.button, true, false);
				return this.fitted(tag, question.title, [
					["", ...note, "", ...rows, "", ...big, "", ...hints],
					[...note, ...rows, ...small, ...hints],
					[...rows, ...hints],
				]);
			},
			fold: () => question.answer,
			onKey: (_text, name) => (name === "return" || name === "enter" ? { value: true } : undefined),
		});
	}

	/** The install's steps, one appended row each; nothing above is redrawn. */
	steps(title: string, note: string): StepCard {
		const inner = this.inner();
		const motion = this.terminal.motion?.({
			before: ` ${this.border(this.glyph.side, 0)} ${this.depth === "none" ? "" : `${ESC}${sgr(MINT, 38, this.depth)}m`}`,
			after: `${this.depth === "none" ? "" : `${ESC}39m`} `,
			frames: [...this.glyph.frames],
		});
		const [top, ...head] = this.frame("LIT", title, [
			"",
			...this.wrapped(note, inner).map((row) => this.quiet(row)),
			"",
		]);
		const foot = head.pop();
		this.output.write(`${this.afterFold ? "\n" : ""}${[top, ...head].join("\n")}\n`);
		this.afterFold = false;
		let open = false;
		let stop: (() => void) | undefined;
		const put = (rows: readonly string[]): void => {
			stop?.();
			stop = undefined;
			open = false;
			this.output.write(`${CLEAR_LINE}${rows.map((row) => this.sided(row)).join("\n")}\n`);
		};
		return {
			start: (label) => {
				open = true;
				stop = motion?.start([...this.text(label)].slice(0, inner - 3).join(""));
			},
			end: (row, receipts = []) =>
				put([
					...this.panelRow(row, inner, STEP_LABEL),
					...receipts.flatMap((line) =>
						this.wrapped(line, inner - this.markWidth() - 2).map(
							(text) => `${" ".repeat(this.markWidth() + 2)}${this.quiet(text)}`,
						),
					),
				]),
			close: () => {
				this.output.write(`${foot ?? ""}\n\n`);
			},
			stop: (value) => {
				if (open) put(this.panelRow({ mark: "fail", value }, inner, STEP_LABEL));
				this.output.write(`${foot ?? ""}\n\n`);
			},
		};
	}

	/** A finished card: sections of marked rows. A value is wrapped, never cut short. */
	panel(card: { readonly title: string; readonly sections: readonly PanelSection[]; readonly bad?: boolean }): string {
		const inner = this.inner();
		const width = labelWidth(card.sections.flatMap((section) => section.rows));
		const body = card.sections
			.filter((section) => section.rows.length > 0)
			.flatMap((section) => [
				"",
				...(section.head === undefined ? [] : [this.paint(section.head, { fg: PINK, bold: true })]),
				...section.rows.flatMap((row) => this.panelRow(row, inner, width)),
			]);
		return `${this.afterFold ? "\n" : ""}${this.frame("LIT", card.title, body, card.bad === true).join("\n")}\n`;
	}

	/** Free text under a card: a bold first line, the rest indented and wrapped to the card's width. */
	notice(text: string): string {
		const [head = "", ...rest] = text.trim().split("\n");
		const width = this.width();
		const body = rest.flatMap((line) => {
			const indent = " ".repeat(3 + (/^ */u.exec(line)?.[0].length ?? 0));
			return this.wrapped(line, width - indent.length).map((row) => indent + row);
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

	private frame(tag: string, title: string, body: readonly string[], bad = false): string[] {
		const width = this.width();
		const { corners, line } = this.glyph;
		const pill =
			this.depth === "none"
				? `[${tag}]`
				: this.ramp(` ${tag} `, [ORANGE, PINK], (bg) => ({ fg: INK, bg, bold: true }));
		const name = this.text(title);
		const inEdge = cells(pill) + cells(name) + 8 <= width;
		const used = 2 + cells(pill) + (inEdge ? cells(name) + 2 : 0);
		const bold = (text: string): string => this.paint(text, { bold: true });
		return [
			` ${this.border(corners[0] + line, 0, bad)}${pill}${inEdge ? ` ${bold(name)} ` : ""}${this.border(line.repeat(Math.max(0, width - used - 1)) + corners[1], used, bad)}`,
			...[...(inEdge ? [] : wrapCells(name, this.inner()).map(bold)), ...body].map((row) => this.sided(row, bad)),
			` ${this.border(corners[2] + line.repeat(width - 2) + corners[3], 0, bad)}`,
		];
	}

	/** The roomiest of `variants` that fits the window; the last is cut from the top if even it does not. */
	private fitted(tag: string, title: string, variants: readonly (readonly string[])[]): string[] {
		const cards = variants.map((body, index) => {
			const rows = this.frame(tag, title, body);
			return index === 0 && this.afterFold ? ["", ...rows] : rows;
		});
		return cards.find((rows) => rows.length <= this.height()) ?? cards.at(-1) ?? [];
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
		const mark = last.length + label + cells(word) + 5 <= inner ? word : "*";
		const room = inner - 3 - last.length - label - 2 - (cells(mark) + 2);
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
			if (!on || this.depth === "none") return body;
			const bar = `${ESC}${sgr(IVORY, 38, this.depth)};${sgr(SELECTED, 48, this.depth)}m`;
			return `${bar}${pad(body, inner).replaceAll(`${ESC}0m`, `${ESC}0m${bar}`)}${ESC}0m`;
		};
		// A long list is a window that follows the highlight; the position and arrows say there is more.
		const body = (most: number, roomy: boolean): string[] => {
			const count = Math.max(1, Math.min(choices.length, most));
			const start = Math.max(0, Math.min(at - Math.floor(count / 2), choices.length - count));
			const more = `${at + 1} of ${choices.length}${start > 0 ? ` ${this.glyph.up}` : ""}${start + count < choices.length ? ` ${this.glyph.down}` : ""}`;
			const all = count === choices.length;
			const hints = this.hints(
				[
					...(all ? [] : [more]),
					...(roomy || all ? [`${this.glyph.updown} move`, `0-${last} jump`] : []),
					"Enter choose",
					"Ctrl+C stop",
				],
				inner,
			);
			const list = choices.slice(start, start + count).map((choice, offset) => row(choice, start + offset));
			return roomy ? ["", ...note, "", ...list, "", ...hints] : [...note, ...list, ...hints];
		};
		const spare = this.height() - this.frame(tag, question.title, body(1, false)).length + 1;
		return this.fitted(tag, question.title, [body(LIST_ROWS, true), body(Math.min(LIST_ROWS, spare), false)]);
	}

	/** A button: three rows with room, one row without. The highlighted one is filled, or double-lined without colour. */
	private button(word: string, on: boolean, big: boolean, width = cells(word) + 2): string[] {
		const label = pad(`${on ? this.glyph.pointer : " "} ${word}`, width);
		const colour = this.depth !== "none";
		const fill = (text: string): string => this.ramp(text, [PINK, VIOLET], (bg) => ({ fg: INK, bg, bold: true }));
		if (!big) {
			if (on) return [colour ? fill(` ${label} `) : `[${label}]`];
			return [` ${this.quiet(label)} `];
		}
		if (on && colour) {
			const edge = (char: string): string => this.ramp(char.repeat(width + 4), [PINK, VIOLET], (fg) => ({ fg }));
			return [edge("▄"), fill(`  ${label}  `), edge("▀")];
		}
		const [tl, tr, bl, br, line, side] = on ? this.glyph.heavy : this.glyph.light;
		const edge = line.repeat(width + 2);
		return [
			this.quiet(tl + edge + tr),
			`${this.quiet(side)} ${label} ${this.quiet(side)}`,
			this.quiet(bl + edge + br),
		];
	}

	private confirmRows(
		tag: string,
		question: { readonly title: string; readonly note: string; readonly initial: boolean },
		yes: boolean,
	): string[] {
		const inner = this.inner();
		const note = this.wrapped(question.note, inner);
		const word = (value: boolean): string =>
			`${value ? "Yes" : "No"}${value === question.initial ? (inner >= 36 ? " (default)" : " default") : ""}`;
		const width = Math.max(cells(word(true)), cells(word(false))) + 2;
		const pair = (big: boolean): string[] => {
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

	private panelRow(row: PanelRow, inner: number, width: number): string[] {
		const kind = row.mark ?? "done";
		const gap = this.markWidth();
		const lead = pad(this.paint(this.glyph.marks[kind], { fg: MARK_TONES[kind], bold: true }), gap);
		const loud = kind === "warn" || kind === "fail";
		const value = (text: string): string => (loud ? this.paint(text, { bold: true }) : text);
		const label = this.text(row.label ?? "");
		if (label === "" || inner - gap - width < MIN_VALUE) {
			const rows = this.wrapped(row.value, inner - gap).map(value);
			const name = label === "" ? (rows.shift() ?? "") : this.paint(label, { bold: true });
			return [lead + name, ...rows.map((text) => " ".repeat(gap) + text)];
		}
		return this.wrapped(row.value, inner - gap - width).map((text, index) =>
			index === 0
				? lead + pad(this.paint(label, { bold: true }), width) + value(text)
				: " ".repeat(gap + width) + value(text),
		);
	}

	private folded(mark: "done" | "fail", title: string, value: string): string {
		const name = this.text(title);
		const text = this.text(value);
		const aligned = pad(name, Math.max(24, cells(name) + 2));
		const label = cells(aligned) + cells(text) + 4 < this.columns() ? aligned : `${name} `;
		const sign = this.paint(this.glyph.marks[mark], { fg: MARK_TONES[mark], bold: true });
		return ` ${sign} ${label}${this.paint(text, { bold: true })}`;
	}

	// ---- asking ----

	private nextTag(): string {
		this.asked += 1;
		return this.total < this.asked ? "LIT" : `LIT ${this.asked}/${this.total}`;
	}

	/** Draws over what is on screen in one write, so nothing flickers. */
	private draw(rows: readonly string[], above = this.drawn.length): void {
		const shown = rows.slice(-this.height());
		const lift = above > 0 ? `${ESC}${above}A` : "";
		this.output.write(`${lift}${shown.map((row) => `\r${row}${ESC}K\r\n`).join("")}${ESC}J`);
		this.drawn = shown;
	}

	/** After a resize the old rows may have wrapped: step over what they take up now. */
	private redraw(rows: readonly string[]): void {
		const taken = this.drawn.reduce((sum, row) => sum + Math.max(1, Math.ceil(cells(row) / this.columns())), 0);
		const above = Math.min(taken, this.height());
		this.output.write(`${above > 0 ? `${ESC}${above}A` : ""}\r${ESC}J`);
		this.draw(rows, 0);
	}

	private replace(row: string): void {
		this.output.write(`${this.drawn.length > 0 ? `${ESC}${this.drawn.length}A` : ""}\r${ESC}J${row}\r\n`);
		this.drawn = [];
		this.afterFold = true;
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

export interface StepCard {
	readonly start: (label: string) => void;
	readonly end: (row: PanelRow, receipts?: readonly string[]) => void;
	readonly close: () => void;
	/** Ends the card after a failure; a step that never reported gets `value` as its row. */
	readonly stop: (value: string) => void;
}

const STEP_LABEL = 15;

function labelWidth(rows: readonly PanelRow[]): number {
	return Math.max(0, ...rows.map((row) => cells(row.label ?? ""))) + 2;
}
