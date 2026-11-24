// src/hud-cli.ts — `litcodex hud`: the LIT card, kept live in a second terminal window.
//
// One 1 s timer reads the small, size-capped LIT records (hud.ts), builds the frame and writes it only
// when its text changed; a running step changes it once a second through its clock. On a dark truecolor
// terminal the sunset (hud-scene.ts) stands under the card; only while LIT works does a second timer redraw
// it, from the frame already composed and only the rows that changed, so it reads nothing. On a terminal the
// frame is drawn in place on the alternate screen with the cursor hidden, and both come back on every
// way out: a signal, an unexpected error or process exit. The command resolves its exit code and never
// calls `process.exit`; it writes no file, starts no process and opens no Codex rollout.

import { type HudView, hudLines, readHud, renderHud } from "./hud.js";
import { composeScene, drawsRoundCaps, type HudScene, lightBackground, sceneMood } from "./hud-scene.js";

const TICK_MS = 1_000;
const FRAME_MS = 100;
const DEFAULT_WIDTH = 80;
const ENTER_SCREEN = "\u001b[?1049h\u001b[?25l";
const LEAVE_SCREEN = "\u001b[?25h\u001b[?1049l";
const HOME = "\u001b[H";
const CLEAR_LINE = "\u001b[K";
const CLEAR_BELOW = "\u001b[J";
const USAGE_EXIT_CODE = 64;
const STOP_EVENTS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export const HUD_HELP_TEXT = `litcodex hud [--session <id>] [--once]

Watch the LIT card of your newest Codex session from a second terminal window or tab.
It reads only LIT's own records, never writes a file and never touches Codex. Ctrl-C quits.

Options:
  --session <id>   Follow this session (an exact id or a unique prefix) instead of the newest.
  --once           Print one plain frame and exit.
  --help           Show this help.
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

/** The same writer with the sunset in it; after the first frame it rewrites only the rows that changed. */
function createSceneLoop(options: HudLoopOptions): HudLoop {
	const { out } = options;
	const caps = drawsRoundCaps(options.env);
	let view: HudView | null = null;
	let scene: HudScene | null = null;
	let drawn: readonly string[] | null = null;
	let size = "";
	let seconds = 0;
	let lastAt = options.now();
	const compose = (now: number): void => {
		const columns = out.columns ?? DEFAULT_WIDTH;
		const rows = out.rows ?? 0;
		if (size !== `${columns}x${rows}`) drawn = null;
		size = `${columns}x${rows}`;
		if (view !== null) scene = composeScene(hudLines(view, now), sceneMood(view), { width: columns - 1, rows, caps });
	};
	const draw = (): boolean => {
		const rows = scene?.paint(seconds) ?? [];
		const before = drawn;
		// A card taller than the window scrolls, so its rows have no fixed place to be rewritten in.
		const whole = before === null || before.length !== rows.length || rows.length > (out.rows ?? 0);
		const changed = rows.flatMap((row, index) => (before?.[index] === row ? [] : [index]));
		if (changed.length === 0 && before?.length === rows.length) return false;
		drawn = rows;
		out.write(
			whole
				? `${HOME}${rows.join(`${CLEAR_LINE}\n`)}${CLEAR_LINE}${CLEAR_BELOW}`
				: changed.map((index) => `\u001b[${index + 1};1H${rows[index]}${CLEAR_LINE}`).join(""),
		);
		return true;
	};
	const advance = (now: number): void => {
		// The scene's own clock runs only while it moves, so it resumes from where it stopped.
		if (scene?.moving === true) seconds += Math.max(0, Math.min(FRAME_MS * 2, now - lastAt)) / 1_000;
		lastAt = now;
	};
	return {
		tick(): boolean {
			const now = options.now();
			advance(now);
			view = readHud(options.env, options.wanted, now);
			compose(now);
			return draw();
		},
		frame(): boolean {
			if (scene?.moving !== true) return false;
			const now = options.now();
			advance(now);
			if (size !== `${out.columns ?? DEFAULT_WIDTH}x${out.rows ?? 0}`) compose(now);
			return draw();
		},
		moving: () => scene?.moving === true,
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
