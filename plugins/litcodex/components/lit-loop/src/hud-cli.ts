// src/hud-cli.ts — `litcodex hud`: the LIT card, kept live in a second terminal window.
//
// One 1 s timer reads the small, size-capped LIT records (hud.ts), builds the frame and writes it only
// when its text changed; a running step changes it once a second through its clock. On a terminal the
// frame is drawn in place on the alternate screen with the cursor hidden, and both come back on every
// way out: a signal, an unexpected error or process exit. The command resolves its exit code and never
// calls `process.exit`; it writes no file, starts no process and opens no Codex rollout.

import { readHud, renderHud } from "./hud.js";

const TICK_MS = 1_000;
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
	on?(event: "error", listener: (error: unknown) => void): unknown;
}

export interface HudLoopOptions {
	readonly env: NodeJS.ProcessEnv;
	readonly wanted: string | null;
	readonly out: HudOutput;
	readonly color: boolean;
	readonly now: () => number;
}

/**
 * A frame writer: each `tick` reads and renders once, and writes only when the frame text changed or the
 * terminal was resized. On a terminal the frame stays one column short of the edge, where a full line
 * followed by erase-to-end would lose its last glyph or wrap.
 */
export function createHudLoop(options: HudLoopOptions): { tick(): boolean } {
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
				now,
			});
			if (frame === last) return false;
			last = frame;
			options.out.write(
				tty ? `${HOME}${frame.split("\n").join(`${CLEAR_LINE}\n`)}${CLEAR_LINE}${CLEAR_BELOW}` : `${frame}\n`,
			);
			return true;
		},
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
	const loop = createHudLoop({
		env: io.env,
		wanted: parsed.session,
		out: io.stdout,
		color: tty && colorAllowed(io.env),
		now,
	});
	const signals: HudSignals = io.signals ?? process;
	// A write to a terminal that has gone away (SIGHUP) fails with EIO; it must not become a stack trace.
	io.stdout.on?.("error", () => undefined);
	return new Promise<number>((resolve) => {
		let restored = false;
		let timer: NodeJS.Timeout | undefined;
		const restore = (): void => {
			if (restored) return;
			restored = true;
			clearInterval(timer);
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
		const tick = (): void => {
			try {
				loop.tick();
			} catch (error) {
				crash(error);
			}
		};
		timer = setInterval(tick, TICK_MS);
		tick();
	});
}

/** The stream as a plain, non-terminal writer: one frame, no cursor moves. */
function plain(out: HudOutput): HudOutput {
	return { write: (text: string) => out.write(text), columns: out.isTTY === true ? out.columns : DEFAULT_WIDTH };
}
