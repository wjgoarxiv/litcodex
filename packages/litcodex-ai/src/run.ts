// `litcodex run`: Codex with a live LIT panel in the bottom rows of the same terminal.
//
// Codex runs in a pseudo-terminal (the optional `node-pty` package) four rows shorter than the real
// one, with the same folder, environment and arguments. Its output passes through the screen filter
// (lit-loop run-filter.ts), which keeps every scroll region above the panel and holds an unfinished
// escape sequence or UTF-8 character until the rest arrives, flushed after 50 ms at the latest. The
// panel (run-panel.ts) is drawn after each read that ends between whole sequences, while Codex holds no
// saved cursor, and once a second when its text changed; after a forced flush or a terminal reset the
// scroll region is set again first. Keys go to Codex unchanged. A resize waits for a boundary (or ends
// a flushed, still-open sequence with CAN), then sets the new scroll region, clears the screen, redraws
// the panel and resizes Codex.
//
// Every way out gives the terminal back: cooked mode, no scroll region, empty panel rows and the cursor
// below Codex. When Codex exits by itself the exit code is Codex's. SIGINT/SIGTERM/SIGHUP to the wrapper
// are passed to Codex, and an uncaught error stops it; its last output still reaches the terminal, and the
// wrapper waits up to 1.5 s for it to exit. Then, because Codex may not have undone its own modes, a
// defensive reset leaves the alternate screen and turns off bracketed paste, focus and mouse reporting
// and the keyboard flags before the panel is cleared. The exit code is then 128 + n, or 1 after an error.
//
// Ctrl-Z reaches Codex as a key and nothing more. Codex 0.163.0 stops its own process group on Ctrl-Z,
// but inside the pseudo-terminal that group has no job-control shell, so the stop is discarded and Codex
// keeps running (seen on macOS). Quit with Ctrl-C, or run plain `codex` for job control.
//
// When node-pty cannot load, its macOS helper is not executable and cannot be made so, stdin or stdout
// is not a terminal, the terminal is smaller than 40×12, or the pseudo-terminal does not start, one
// note goes to stderr and Codex runs as usual with this terminal. The command reads only LIT's own
// records and opens no Codex rollout; the one file it may change is the helper of the node-pty under its own
// node_modules (pty-helper.ts).

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { constants as osConstants } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createScreenFilter } from "@litcodex/lit-loop/dist/run-filter.js";
import {
	MIN_RUN_COLUMNS,
	MIN_RUN_ROWS,
	PANEL_ROWS,
	panelClear,
	panelFrame,
	readRunPanel,
	renderRunPanel,
} from "@litcodex/lit-loop/dist/run-panel.js";
import { ensurePtyHelperExecutable } from "./pty-helper.js";

export const RUN_HELP_TEXT = `litcodex run [-- <codex args>...]

Start Codex with a live LIT panel in the bottom ${PANEL_ROWS} rows of this terminal. Codex runs in a
pseudo-terminal ${PANEL_ROWS} rows shorter, in this folder; the panel follows the newest LIT turn started
here: the route and its clock, the stage map, the running step and the open checklist row.
Everything after \`--\` goes to Codex unchanged, and Codex's exit code is the command's.

Without the optional node-pty package, outside a terminal, or in a terminal smaller than
${MIN_RUN_COLUMNS}×${MIN_RUN_ROWS}, Codex runs as usual after a one-line note. The command writes no file.

Options:
  --help   Show this help.
`;

const HOLD_MS = 50;
const TICK_MS = 1_000;
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
/** How long Codex gets to exit after a signal or an error before the terminal is taken back anyway. */
const GRACE_MS = 1_500;
/** Leaves the alternate screen and turns off what Codex may have turned on; used when it did not exit by itself. */
const MODE_RESET =
	"\u001b[?1049l\u001b[?2004l\u001b[?1004l\u001b[?1007l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[<u";
/** Cancels an escape sequence the terminal has started to read. */
const CAN = "\u0018";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

/** The part of a node-pty child this command uses. */
export interface PtyProcess {
	onData(listener: (data: Buffer | string) => void): unknown;
	onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
	write(data: string | Buffer): void;
	resize(columns: number, rows: number): void;
	kill(signal?: string): void;
}

export interface PtyModule {
	spawn(
		file: string,
		args: string[],
		options: {
			name: string;
			cols: number;
			rows: number;
			cwd: string;
			env: NodeJS.ProcessEnv;
			encoding: null;
		},
	): PtyProcess;
}

interface Events {
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface RunIo {
	readonly stdin: Events & {
		readonly isTTY?: boolean;
		setRawMode?(mode: boolean): unknown;
		resume(): unknown;
		pause(): unknown;
	};
	readonly stdout: Events & {
		readonly isTTY?: boolean;
		readonly rows?: number;
		readonly columns?: number;
		write(data: string | Uint8Array): unknown;
	};
	readonly stderr: { readonly isTTY?: boolean; write(text: string): unknown };
	readonly env: NodeJS.ProcessEnv;
	readonly cwd: string;
	/** Process signals and uncaught errors; a test passes its own emitter. */
	readonly signals?: Events;
	readonly now?: () => number;
	/** node-pty; null when it is not installed or cannot load; a string saying why it cannot be used. */
	readonly loadPty?: () => Promise<PtyModule | string | null>;
	/** Runs Codex with this terminal and resolves its exit code. */
	readonly runPlain?: (file: string, args: readonly string[], io: RunIo) => Promise<number>;
}

/** The `codex` executable on PATH, or null. */
export function findCodex(env: NodeJS.ProcessEnv): string | null {
	const names =
		process.platform === "win32"
			? ["codex", ...(env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").map((ext) => `codex${ext.toLowerCase()}`)]
			: ["codex"];
	for (const dir of (env["PATH"] ?? "").split(delimiter)) {
		if (dir === "") continue;
		for (const name of names) {
			const candidate = join(dir, name);
			try {
				if (!statSync(candidate).isFile()) continue;
				accessSync(candidate, fsConstants.X_OK);
				return candidate;
			} catch {
				// Not here; try the next folder.
			}
		}
	}
	return null;
}

async function loadNodePty(): Promise<PtyModule | string | null> {
	try {
		// A variable specifier keeps the optional package out of type checking and bundling.
		const name = "node-pty";
		const root = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
		const helper = ensurePtyHelperExecutable(root, process.platform, fileURLToPath(new URL("..", import.meta.url)));
		if (helper !== null) return `the node-pty helper ${helper} is not executable (run chmod +x on it)`;
		const loaded = (await import(name)) as { default?: PtyModule } & Partial<PtyModule>;
		const api = typeof loaded.spawn === "function" ? (loaded as PtyModule) : loaded.default;
		return api !== undefined && typeof api.spawn === "function" ? api : null;
	} catch {
		return null;
	}
}

function signalCode(signal: NodeJS.Signals | number | null | undefined): number {
	const number = typeof signal === "number" ? signal : signal ? (osConstants.signals[signal] ?? 0) : 0;
	return 128 + number;
}

/** Codex with this terminal's own stdio; Ctrl-C reaches Codex directly, so the wrapper only waits. */
function runPlainCodex(file: string, args: readonly string[], io: RunIo): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(file, [...args], { stdio: "inherit", cwd: io.cwd, env: io.env });
		const ignore = (): void => undefined;
		const forward = (signal: NodeJS.Signals) => (): void => {
			child.kill(signal);
		};
		const forwards = STOP_SIGNALS.map((signal) => [signal, signal === "SIGINT" ? ignore : forward(signal)] as const);
		for (const [signal, listener] of forwards) process.on(signal, listener);
		const done = (code: number): void => {
			for (const [signal, listener] of forwards) process.removeListener(signal, listener);
			resolve(code);
		};
		child.once("error", (error) => {
			io.stderr.write(`litcodex run: could not start codex: ${error.message}\n`);
			done(127);
		});
		child.once("exit", (code, signal) => done(code ?? signalCode(signal)));
	});
}

function note(io: RunIo, text: string): void {
	const noColor = io.env["NO_COLOR"];
	const dim = io.stderr.isTTY === true && (noColor === undefined || noColor === "");
	io.stderr.write(dim ? `${DIM}${text}${RESET}\n` : `${text}\n`);
}

function fallbackReason(pty: PtyModule | string | null, io: RunIo): string | null {
	if (pty === null) return "node-pty is not installed or cannot load";
	if (typeof pty === "string") return pty;
	if (io.stdin.isTTY !== true || io.stdout.isTTY !== true || typeof io.stdin.setRawMode !== "function")
		return "stdin or stdout is not a terminal";
	const rows = io.stdout.rows ?? 0;
	const columns = io.stdout.columns ?? 0;
	if (rows < MIN_RUN_ROWS || columns < MIN_RUN_COLUMNS)
		return `the terminal is smaller than ${MIN_RUN_COLUMNS}×${MIN_RUN_ROWS}`;
	return null;
}

export async function runCommand(args: readonly string[], io: RunIo): Promise<number> {
	const codex = findCodex(io.env);
	if (codex === null) {
		io.stderr.write("litcodex run: codex is not on PATH. Install Codex first, then run this again.\n");
		return 127;
	}
	const runPlain = io.runPlain ?? runPlainCodex;
	const pty = await (io.loadPty ?? loadNodePty)();
	const reason = fallbackReason(pty, io);
	if (reason !== null || pty === null || typeof pty === "string") {
		note(io, `litcodex run: ${reason}, so Codex runs without the LIT panel.`);
		return runPlain(codex, args, io);
	}
	const rows = io.stdout.rows ?? MIN_RUN_ROWS;
	const columns = io.stdout.columns ?? MIN_RUN_COLUMNS;
	let child: PtyProcess;
	try {
		child = pty.spawn(codex, [...args], {
			name: io.env["TERM"] ?? "xterm-256color",
			cols: columns,
			rows: rows - PANEL_ROWS,
			cwd: io.cwd,
			env: io.env,
			encoding: null,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		note(io, `litcodex run: the pseudo-terminal did not start (${message}), so Codex runs without the LIT panel.`);
		return runPlain(codex, args, io);
	}
	return drive(child, io, { rows, columns });
}

/** Pumps bytes both ways, draws the panel and resolves the exit code once the terminal is given back. */
function drive(child: PtyProcess, io: RunIo, size: { rows: number; columns: number }): Promise<number> {
	const now = io.now ?? Date.now;
	const signals: Events = io.signals ?? process;
	const startedAt = now();
	const noColor = io.env["NO_COLOR"];
	const color = noColor === undefined || noColor === "";
	let { rows, columns } = size;
	let panelOn = true;
	let childRows = rows - PANEL_ROWS;
	const filter = createScreenFilter(childRows);
	const write = (data: string | Uint8Array): void => {
		try {
			io.stdout.write(data);
		} catch {
			// A terminal that has gone away (SIGHUP) cannot be written to; the way out continues.
		}
	};
	const render = (): string[] =>
		renderRunPanel(readRunPanel(io.env, io.cwd, startedAt, now()), { width: columns - 1, color, now: now() });
	let lines = render();
	let shown = lines.join("\n");
	const draw = (): void => {
		if (!panelOn || !filter.atBoundary || filter.cursorSaved) return;
		if (filter.regionLost) {
			write(`\u001b7\u001b[1;${childRows}r\u001b8`);
			filter.regionAsserted();
		}
		write(panelFrame(lines, { childRows, cursorVisible: filter.cursorVisible }));
		shown = lines.join("\n");
	};

	// Make room so a cursor sitting in the bottom rows ends up above the panel, then fence Codex in.
	write(`${"\n".repeat(PANEL_ROWS)}\u001b[${PANEL_ROWS}A\u001b7\u001b[1;${childRows}r\u001b8`);
	io.stdin.setRawMode?.(true);
	io.stdin.resume();
	draw();

	return new Promise<number>((resolve) => {
		let finished = false;
		let clean = true;
		let ending: number | null = null;
		let crashMessage: string | null = null;
		let hold: NodeJS.Timeout | undefined;
		let grace: NodeJS.Timeout | undefined;
		let resizePending = false;

		/** Applies a held resize once nothing is held; a flushed, still-open sequence is ended with CAN first. */
		const applyResize = (): void => {
			if (!resizePending || finished || filter.holding) return;
			resizePending = false;
			panelOn = rows >= MIN_RUN_ROWS && columns >= MIN_RUN_COLUMNS;
			childRows = panelOn ? rows - PANEL_ROWS : rows;
			filter.setRows(childRows);
			write(`${filter.atBoundary ? "" : CAN}${panelOn ? `\u001b[1;${childRows}r` : "\u001b[r"}\u001b[2J`);
			filter.regionAsserted();
			lines = render();
			if (panelOn && !filter.cursorSaved) {
				write(panelFrame(lines, { childRows, cursorVisible: filter.cursorVisible }));
				shown = lines.join("\n");
			}
			try {
				child.resize(columns, childRows);
			} catch {
				// The pty has just exited; its exit ends the run.
			}
		};
		const onResize = (): void => {
			rows = io.stdout.rows ?? rows;
			columns = io.stdout.columns ?? columns;
			resizePending = true;
			applyResize();
		};
		const onInput = (...data: unknown[]): void => {
			child.write(data[0] as Buffer | string);
		};
		const tick = setInterval(() => {
			lines = render();
			if (lines.join("\n") !== shown) draw();
		}, TICK_MS);
		/** Stops Codex and waits for it, up to the grace period, before the terminal is taken back. */
		const endAfterChild = (code: number, signal?: string): void => {
			if (finished || ending !== null) return;
			ending = code;
			clean = false;
			try {
				child.kill(signal);
			} catch {
				// Already gone.
			}
			grace = setTimeout(() => finish(code), GRACE_MS);
		};
		const stops = STOP_SIGNALS.map(
			(signal) => [signal, (): void => endAfterChild(signalCode(signal), signal)] as const,
		);
		const crash = (error: unknown): void => {
			crashMessage ??= error instanceof Error ? error.message : String(error);
			endAfterChild(1);
		};
		const setRaw = (mode: boolean): void => {
			try {
				io.stdin.setRawMode?.(mode);
			} catch {
				// stdin already closed.
			}
		};
		const restore = (): void => {
			if (finished) return;
			finished = true;
			clearInterval(tick);
			clearTimeout(hold);
			clearTimeout(grace);
			io.stdin.removeListener("data", onInput);
			io.stdout.removeListener("resize", onResize);
			for (const [signal, listener] of stops) signals.removeListener(signal, listener);
			signals.removeListener("uncaughtException", crash);
			signals.removeListener("exit", onProcessExit);
			const rest = filter.flush();
			if (rest.length > 0) write(rest);
			write(`${clean ? "" : MODE_RESET}${panelOn ? panelClear(childRows) : "\u001b[r\u001b[?25h"}`);
			setRaw(false);
			io.stdin.pause();
		};
		const onProcessExit = (): void => {
			clean = false;
			restore();
		};
		const finish = (code: number): void => {
			if (finished) return;
			restore();
			if (crashMessage !== null) io.stderr.write(`litcodex run: stopped: ${crashMessage}\n`);
			resolve(code);
		};

		child.onData((chunk) => {
			if (finished) return;
			const out = filter.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
			if (out.length > 0) write(out);
			if (filter.holding) {
				hold ??= setTimeout(() => {
					hold = undefined;
					const rest = filter.flush();
					if (rest.length > 0) write(rest);
					applyResize();
				}, HOLD_MS);
				return;
			}
			clearTimeout(hold);
			hold = undefined;
			applyResize();
			draw();
		});
		child.onExit(({ exitCode, signal }) => {
			if (ending !== null) return finish(ending);
			if (signal) clean = false;
			finish(signal ? signalCode(signal) : exitCode);
		});
		io.stdin.on("data", onInput);
		io.stdout.on("resize", onResize);
		for (const [signal, listener] of stops) signals.on(signal, listener);
		signals.on("uncaughtException", crash);
		signals.on("exit", onProcessExit);
	});
}
