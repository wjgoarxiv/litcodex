// src/hud-cli.ts — `litcodex hud`: the LIT card, kept live in a second terminal window.
//
// One 1 s timer reads the small, size-capped LIT records (hud.ts), builds the frame and writes it only
// when its text changed; a running step changes it once a second through its clock. On a dark truecolor
// terminal it draws the framed card (hud-card.ts) with its sunset; only while LIT works, or for the moment a
// plan completes, does a second timer redraw it, from the card already composed and only the cells that
// changed, so it reads nothing. For the card's usage figures it looks at the end of the thread's own Codex
// rollout, at most once in five seconds and only after the file changed. On a terminal the frame is drawn in place
// on the alternate screen with the cursor hidden, and both come back on every way out: a signal, an unexpected
// error or process exit. The command resolves its exit code and never calls `process.exit`; it writes no file and
// starts no process.

import { createUsageReader } from "./card-status.js";
import { type HudView, hudLines, readHud, renderHud } from "./hud.js";
import { composeCard, type HudCard } from "./hud-card.js";
import { roundGlyphs } from "./hud-glyphs.js";
import { type Cell, changedRuns, rowText } from "./hud-paint.js";
import { CARD_MIN, lightBackground, narrowLines, sceneMood } from "./hud-scene.js";

const TICK_MS = 1_000;
const FRAME_MS = 100;
/** How long a completion is celebrated. */
const BURST_MS = 2_000;
const DEFAULT_WIDTH = 80;
const DEFAULT_ROWS = 24;
const ENTER_SCREEN = "\u001b[?1049h\u001b[?25l";
const LEAVE_SCREEN = "\u001b[?25h\u001b[?1049l";
const HOME = "\u001b[H";
const CLEAR_LINE = "\u001b[K";
const CLEAR_BELOW = "\u001b[J";
const USAGE_EXIT_CODE = 64;
const STOP_EVENTS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export const HUD_HELP_TEXT = `litcodex hud [--session <id>] [--once]

Watch the LIT card of your newest Codex session from a second terminal window or tab.
It reads LIT's own records and, for the context and limit figures, the end of that session's Codex log.
It never writes a file and never touches Codex. Ctrl-C quits.

Options:
  --session <id>   Follow this session (an exact id or a unique prefix) instead of the newest.
  --once           Print one plain frame and exit.
  --help           Show this help.

LITCODEX_HUD_GLYPHS=auto|nerd|basic sets round ends on pills and gauges (auto looks for an icon font).
`;

export interface HudOutput {
	write(text: string): unknown;
	readonly isTTY?: boolean;
	readonly columns?: number | undefined;
	readonly rows?: number | undefined;
	on?(event: "error", listener: (error: unknown) => void): unknown;
}

export interface HudLoopOptions {
	readonly env: NodeJS.ProcessEnv;
	readonly wanted: string | null;
	readonly out: HudOutput;
	readonly color: boolean;
	readonly truecolor?: boolean;
	/** Draw the sunset: a dark truecolor terminal. */
	readonly scene?: boolean;
	readonly now: () => number;
}

export interface HudLoop {
	/** Reads the records and draws; true when something was written. */
	tick(): boolean;
	/** Redraws the composed frame a moment later, reading nothing; true when something was written. */
	frame(): boolean;
	/** Whether the next `frame` would draw anything new. */
	moving(): boolean;
}

/**
 * A frame writer: each `tick` reads and renders once, and writes only when the frame text changed or the
 * terminal was resized. On a terminal the frame stays one column short of the edge, where a full line
 * followed by erase-to-end would lose its last glyph or wrap.
 */
export function createHudLoop(options: HudLoopOptions): HudLoop {
	if (options.scene === true && options.out.isTTY === true) return createSceneLoop(options);
	let last: string | null = null;
	let lastColumns: number | undefined;
	return {
		tick(): boolean {
			const now = options.now();
			const tty = options.out.isTTY === true;
			const columns = options.out.columns;
			if (columns !== lastColumns) last = null;
			lastColumns = columns;
			const width = columns ?? DEFAULT_WIDTH;
			const frame = renderHud(readHud(options.env, options.wanted, now), {
				width: tty ? width - 1 : width,
				color: options.color,
				truecolor: options.truecolor === true,
				now,
			});
			if (frame === last) return false;
			last = frame;
			options.out.write(
				tty ? `${HOME}${frame.split("\n").join(`${CLEAR_LINE}\n`)}${CLEAR_LINE}${CLEAR_BELOW}` : `${frame}\n`,
			);
			return true;
		},
		frame: () => false,
		moving: () => false,
	};
}

/** What a scene loop last put on the screen: card rows as cells, or plain lines. */
type Drawn = { readonly cells: readonly (readonly Cell[])[] } | { readonly lines: readonly string[] };

/** A card row whole; the frame's right edge is placed by column, so odd-width text never moves it. */
function cardRow(row: readonly Cell[]): string {
	return `${rowText(row.slice(0, -1), true)}\u001b[${row.length}G${rowText(row.slice(-1), true)}`;
}

/** The same writer with the card and its sunset; after the first frame it rewrites only what changed. */
function createSceneLoop(options: HudLoopOptions): HudLoop {
	const { out } = options;
	// Looked up once: fonts and the terminal do not change under a running HUD.
	const caps = roundGlyphs(options.env);
	const usageOf = createUsageReader(options.env);
	let view: HudView | null = null;
	let card: HudCard | null = null;
	let lines: readonly string[] = [];
	let drawn: Drawn | null = null;
	let size = "";
	let seconds = 0;
	let lastAt = options.now();
	let burstAt: number | null = null;
	const sizeNow = (): string => `${out.columns ?? DEFAULT_WIDTH}x${out.rows ?? DEFAULT_ROWS}`;
	const compose = (now: number): void => {
		const columns = out.columns ?? DEFAULT_WIDTH;
		if (size !== sizeNow()) drawn = null;
		size = sizeNow();
		if (view === null) return;
		card = null;
		if (columns < CARD_MIN) lines = narrowLines(hudLines(view, now), sceneMood(view), { width: columns - 1, caps });
		else card = composeCard(view, { width: columns - 1, rows: out.rows ?? DEFAULT_ROWS, caps, now });
	};
	const bursting = (now: number): boolean => card !== null && burstAt !== null && now - burstAt < BURST_MS;
	const draw = (now: number): boolean => {
		const before = drawn;
		if (card !== null) {
			const cells = card.paint(seconds, bursting(now) && burstAt !== null ? (now - burstAt) / BURST_MS : null);
			drawn = { cells };
			const old = before !== null && "cells" in before ? before.cells : null;
			const text =
				old !== null && old.length === cells.length && old.every((row, y) => row.length === cells[y]?.length)
					? cells.map((row, y) => changedRuns(old[y] ?? [], row, y)).join("")
					: `${HOME}${cells.map(cardRow).join(`${CLEAR_LINE}\n`)}${CLEAR_LINE}${CLEAR_BELOW}`;
			if (text !== "") out.write(text);
			return text !== "";
		}
		const old = before !== null && "lines" in before ? before.lines : null;
		// Lines taller than the window scroll, so they have no fixed place to be rewritten in.
		const whole = old === null || old.length !== lines.length || lines.length > (out.rows ?? 0);
		const changed = lines.flatMap((row, index) => (old?.[index] === row ? [] : [index]));
		if (changed.length === 0 && old?.length === lines.length) return false;
		drawn = { lines };
		out.write(
			whole
				? `${HOME}${lines.join(`${CLEAR_LINE}\n`)}${CLEAR_LINE}${CLEAR_BELOW}`
				: changed.map((index) => `\u001b[${index + 1};1H${lines[index]}${CLEAR_LINE}`).join(""),
		);
		return true;
	};
	const advance = (now: number): void => {
		// The scene's own clock runs only while it moves, so it resumes from where it stopped.
		if (card?.moving === true) seconds += Math.max(0, Math.min(FRAME_MS * 2, now - lastAt)) / 1_000;
		lastAt = now;
	};
	return {
		tick(): boolean {
			const now = options.now();
			advance(now);
			const last = view;
			const next = readHud(options.env, options.wanted, now);
			const usage =
				next.session !== null && (out.columns ?? DEFAULT_WIDTH) >= CARD_MIN ? usageOf(next.session.id, now) : null;
			view = next.status === null ? next : { ...next, status: { ...next.status, usage } };
			if (last !== null && last.session?.id === view.session?.id && view.status?.look === "done") {
				if (last.status !== null && last.status.look !== "done") burstAt = now;
			}
			compose(now);
			return draw(now);
		},
		frame(): boolean {
			const now = options.now();
			if (card?.moving !== true && burstAt === null) return false;
			if (!bursting(now)) burstAt = null;
			advance(now);
			if (size !== sizeNow()) compose(now);
			return draw(now);
		},
		moving: () => card?.moving === true || burstAt !== null,
	};
}

/** The process events the command listens to; a test passes its own emitter. */
interface HudSignals {
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface HudIo {
	readonly stdout: HudOutput;
	readonly stderr: { write(text: string): unknown };
	readonly env: NodeJS.ProcessEnv;
	readonly signals?: HudSignals;
	readonly now?: () => number;
}

type HudArgs = { readonly help: boolean; readonly once: boolean; readonly session: string | null } | string;

function parseArgs(args: readonly string[]): HudArgs {
	let help = false;
	let once = false;
	let session: string | null = null;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] as string;
		if (arg === "--help" || arg === "-h") help = true;
		else if (arg === "--once") once = true;
		else if (arg === "--session") {
			const value = args[index + 1];
			if (value === undefined || value.startsWith("-") || value.trim() === "") return "--session needs a session id";
			session = value.trim();
			index++;
		} else return `unknown option "${arg}"`;
	}
	return { help, once, session };
}

function colorAllowed(env: NodeJS.ProcessEnv): boolean {
	const noColor = env["NO_COLOR"];
	return noColor === undefined || noColor === "";
}

export async function hudCommand(args: readonly string[], io: HudIo): Promise<number> {
	const parsed = parseArgs(args);
	if (typeof parsed === "string") {
		io.stderr.write(`litcodex hud: ${parsed}.\n\n${HUD_HELP_TEXT}`);
		return USAGE_EXIT_CODE;
	}
	if (parsed.help) {
		io.stdout.write(HUD_HELP_TEXT);
		return 0;
	}
	const now = io.now ?? Date.now;
	if (parsed.once) {
		createHudLoop({ env: io.env, wanted: parsed.session, out: plain(io.stdout), color: false, now }).tick();
		return 0;
	}
	const tty = io.stdout.isTTY === true;
	const color = tty && colorAllowed(io.env);
	const truecolor = color && /truecolor|24bit/i.test(io.env["COLORTERM"] ?? "");
	const loop = createHudLoop({
		env: io.env,
		wanted: parsed.session,
		out: io.stdout,
		color,
		truecolor,
		scene: truecolor && !lightBackground(io.env),
		now,
	});
	const signals: HudSignals = io.signals ?? process;
	// A write to a terminal that has gone away (SIGHUP) fails with EIO; it must not become a stack trace.
	io.stdout.on?.("error", () => undefined);
	return new Promise<number>((resolve) => {
		let restored = false;
		let timer: NodeJS.Timeout | undefined;
		let motion: NodeJS.Timeout | undefined;
		const restore = (): void => {
			if (restored) return;
			restored = true;
			clearInterval(timer);
			clearInterval(motion);
			for (const event of STOP_EVENTS) signals.off(event, stop);
			signals.off("uncaughtException", crash);
			signals.off("exit", restore);
			if (tty) io.stdout.write(LEAVE_SCREEN);
		};
		const stop = (): void => {
			restore();
			resolve(0);
		};
		const crash = (error: unknown): void => {
			restore();
			io.stderr.write(`litcodex hud: stopped: ${error instanceof Error ? error.message : String(error)}\n`);
			resolve(1);
		};
		for (const event of STOP_EVENTS) signals.on(event, stop);
		signals.on("uncaughtException", crash);
		signals.on("exit", restore);
		if (tty) io.stdout.write(ENTER_SCREEN);
		const guarded = (step: () => void): void => {
			try {
				step();
			} catch (error) {
				crash(error);
			}
		};
		const tick = (): void =>
			guarded(() => {
				loop.tick();
				if (!loop.moving()) {
					clearInterval(motion);
					motion = undefined;
				} else motion ??= setInterval(() => guarded(() => loop.frame()), FRAME_MS);
			});
		timer = setInterval(tick, TICK_MS);
		tick();
	});
}

/** The stream as a plain, non-terminal writer: one frame, no cursor moves. */
function plain(out: HudOutput): HudOutput {
	return { write: (text: string) => out.write(text), columns: out.isTTY === true ? out.columns : DEFAULT_WIDTH };
}
