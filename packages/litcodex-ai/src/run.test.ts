import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordTurnStart, writeThreadPointer } from "@litcodex/lit-loop/dist/live-step.js";
import { recordWorkflowTurn } from "@litcodex/lit-loop/dist/workflow-map.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePtyHelperExecutable } from "./pty-helper.js";
import { findCodex, type PtyModule, type PtyProcess, type RunIo, runCommand } from "./run.js";

const ESC = "\u001b";
const binPath = fileURLToPath(new URL("../bin/litcodex.js", import.meta.url));
const roots: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(): string {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-run-")));
	roots.push(home);
	return home;
}

/** A folder holding an executable `codex` that prints its arguments and exits 7. */
function fakeCodexDir(home: string): string {
	const bin = join(home, "bin");
	mkdirSync(bin, { recursive: true });
	const codex = join(bin, "codex");
	writeFileSync(
		codex,
		'#!/bin/sh\nprintf "fake codex"\nfor a in "$@"; do printf " [%s]" "$a"; done\nprintf "\\n"\nexit 7\n',
	);
	chmodSync(codex, 0o755);
	return bin;
}

class FakeChild implements PtyProcess {
	resizeThrows = false;
	readonly written: (string | Buffer)[] = [];
	readonly resized: [number, number][] = [];
	readonly killed: (string | undefined)[] = [];
	private readonly events = new EventEmitter();
	onData(listener: (data: Buffer | string) => void): void {
		this.events.on("data", listener);
	}
	onExit(listener: (event: { exitCode: number; signal?: number }) => void): void {
		this.events.on("exit", listener);
	}
	write(data: string | Buffer): void {
		this.written.push(data);
	}
	resize(columns: number, rows: number): void {
		if (this.resizeThrows) throw new Error("Cannot resize a pty that has already exited");
		this.resized.push([columns, rows]);
	}
	kill(signal?: string): void {
		this.killed.push(signal);
	}
	emitData(text: string): void {
		this.events.emit("data", Buffer.from(text));
	}
	exit(exitCode: number, signal?: number): void {
		this.events.emit("exit", signal === undefined ? { exitCode } : { exitCode, signal });
	}
}

interface Harness {
	io: RunIo;
	out: string[];
	err: string[];
	raw: boolean[];
	stdin: EventEmitter;
	stdout: EventEmitter & { rows: number; columns: number };
	signals: EventEmitter;
	plain: { file: string; args: readonly string[] }[];
	spawned: { file: string; args: readonly string[]; options: Record<string, unknown> }[];
	child: FakeChild;
}

function harness(
	options: { tty?: boolean; rows?: number; columns?: number; pty?: "ok" | "missing" | "throws" | "helper" } = {},
): Harness {
	const home = tempHome();
	const out: string[] = [];
	const err: string[] = [];
	const raw: boolean[] = [];
	const plain: Harness["plain"] = [];
	const spawned: Harness["spawned"] = [];
	const child = new FakeChild();
	const tty = options.tty ?? true;
	const stdin = Object.assign(new EventEmitter(), {
		isTTY: tty,
		setRawMode: (mode: boolean) => {
			raw.push(mode);
		},
		resume: () => undefined,
		pause: () => undefined,
	});
	const stdout = Object.assign(new EventEmitter(), {
		isTTY: tty,
		rows: options.rows ?? 30,
		columns: options.columns ?? 100,
		write: (text: string | Uint8Array) => {
			out.push(typeof text === "string" ? text : Buffer.from(text).toString("utf8"));
			return true;
		},
	});
	const pty: PtyModule = {
		spawn: (file, args, spawnOptions) => {
			if (options.pty === "throws") throw new Error("posix_spawnp failed.");
			spawned.push({ file, args, options: spawnOptions as unknown as Record<string, unknown> });
			return child;
		},
	};
	const signals = new EventEmitter();
	const io: RunIo = {
		stdin,
		stdout,
		stderr: { isTTY: false, write: (text: string) => err.push(text) },
		env: { HOME: home, CODEX_HOME: join(home, ".codex"), PATH: fakeCodexDir(home) },
		cwd: home,
		signals,
		now: () => 1_000,
		loadPty: async () =>
			options.pty === "missing"
				? null
				: options.pty === "helper"
					? "the node-pty helper /x/spawn-helper is not executable (run chmod +x on it)"
					: pty,
		runPlain: async (file, args) => {
			plain.push({ file, args });
			return 5;
		},
	};
	return { io, out, err, raw, stdin, stdout, signals, plain, spawned, child };
}

const RESET = `${ESC}[?1049l${ESC}[?2004l${ESC}[?1004l${ESC}[?1007l${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l${ESC}[<u`;
const PANEL_CLEAR_26 = `${ESC}[r${ESC}[0m${ESC}[27;1H${ESC}[2K${ESC}[28;1H${ESC}[2K${ESC}[29;1H${ESC}[2K${ESC}[30;1H${ESC}[2K${ESC}[27;1H${ESC}[?25h`;

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("findCodex", () => {
	it("finds an executable codex on PATH and nothing when it is missing", () => {
		const home = tempHome();
		const bin = fakeCodexDir(home);
		expect(findCodex({ PATH: `${join(home, "nothing")}:${bin}` })).toBe(join(bin, "codex"));
		expect(findCodex({ PATH: join(home, "nothing") })).toBeNull();
	});
});

describe("runCommand fallback", () => {
	it.each([
		["node-pty is missing", { pty: "missing" as const }, /node-pty/u],
		["stdout is not a terminal", { tty: false }, /not a terminal/u],
		["the terminal has fewer than 12 rows", { rows: 11 }, /smaller than 40×12/u],
		["the terminal has fewer than 40 columns", { columns: 39 }, /smaller than 40×12/u],
		["the pseudo-terminal does not start", { pty: "throws" as const }, /posix_spawnp failed/u],
		["the node-pty helper is not executable", { pty: "helper" as const }, /spawn-helper is not executable/u],
	])("runs codex plainly with one note when %s", async (_name, options, note) => {
		const h = harness(options);
		const code = await runCommand(["--model", "x"], h.io);
		expect(code).toBe(5);
		expect(h.plain).toEqual([{ file: join(h.io.env["PATH"] as string, "codex"), args: ["--model", "x"] }]);
		expect(h.err).toHaveLength(1);
		expect(h.err[0]).toMatch(note);
		expect(h.err[0]?.endsWith("\n")).toBe(true);
		expect(h.raw).toEqual([]);
		expect(h.out.join("")).toBe("");
	});

	it("exits 127 with a message when codex is not on PATH", async () => {
		const h = harness();
		const code = await runCommand([], { ...h.io, env: { ...h.io.env, PATH: join(h.io.cwd, "nothing") } });
		expect(code).toBe(127);
		expect(h.err.join("")).toMatch(/codex is not on PATH/u);
		expect(h.plain).toEqual([]);
	});
});

describe("runCommand with a pseudo-terminal", () => {
	it("starts codex four rows shorter in the same folder with the arguments untouched", async () => {
		const h = harness({ rows: 30, columns: 100 });
		const done = runCommand(["resume", "--last", "two words"], h.io);
		await settle();
		expect(h.spawned).toHaveLength(1);
		expect(h.spawned[0]?.args).toEqual(["resume", "--last", "two words"]);
		expect(h.spawned[0]?.options).toMatchObject({ cols: 100, rows: 26, cwd: h.io.cwd, encoding: null });
		expect(h.raw).toEqual([true]);
		const start = h.out.join("");
		expect(start).toContain(`${ESC}[1;26r`);
		expect(start).toContain(`${ESC}[27;1H`);
		expect(start).toContain("waiting for a LIT turn");
		h.child.exit(3);
		expect(await done).toBe(3);
	});

	it("passes the exit code through, gives the terminal back and clears the panel", async () => {
		const h = harness({ rows: 30 });
		const done = runCommand([], h.io);
		await settle();
		h.child.emitData("hello");
		h.child.exit(3);
		expect(await done).toBe(3);
		expect(h.raw).toEqual([true, false]);
		const all = h.out.join("");
		expect(all).toContain("hello");
		expect(all.endsWith(`${ESC}[27;1H${ESC}[?25h`)).toBe(true);
		expect(all).toContain(`${ESC}[r`);
	});

	it("reports a child killed by a signal as 128 + the signal number", async () => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.child.exit(0, 15);
		expect(await done).toBe(143);
		expect(h.raw).toEqual([true, false]);
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
		["SIGHUP", 129],
	])("on %s to the wrapper, passes it to codex, keeps its last output, then exits %i", async (signal, expected) => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.signals.emit(signal);
		expect(h.child.killed).toEqual([signal]);
		expect(h.raw).toEqual([true]);
		h.child.emitData(`${ESC}[?1049lbye`);
		h.child.exit(0, 15);
		expect(await done).toBe(expected);
		expect(h.raw).toEqual([true, false]);
		expect(h.signals.listenerCount(signal)).toBe(0);
		const all = h.out.join("");
		const data = all.indexOf("bye");
		const reset = all.lastIndexOf(RESET);
		expect(data).toBeGreaterThan(0);
		expect(reset).toBeGreaterThan(data);
		expect(all.slice(reset + RESET.length)).toBe(PANEL_CLEAR_26);
	});

	it("gives codex 1.5 s to exit after a signal, then restores the terminal anyway", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.signals.emit("SIGTERM");
		vi.advanceTimersByTime(1_400);
		expect(h.raw).toEqual([true]);
		vi.advanceTimersByTime(100);
		expect(await done).toBe(143);
		expect(h.raw).toEqual([true, false]);
		expect(h.out.join("")).toContain(RESET);
	});

	it("on an uncaught error, stops codex, waits for it and restores the terminal with the reset", async () => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.signals.emit("uncaughtException", new Error("boom"));
		expect(h.child.killed).toHaveLength(1);
		h.child.emitData("last");
		h.child.exit(0, 1);
		expect(await done).toBe(1);
		expect(h.raw).toEqual([true, false]);
		expect(h.err.join("")).toContain("boom");
		const all = h.out.join("");
		expect(all.lastIndexOf(RESET)).toBeGreaterThan(all.indexOf("last"));
	});

	it("leaves out the reset when codex exits by itself", async () => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.child.exit(0);
		await done;
		expect(h.out.join("")).not.toContain(RESET);
	});

	it("keeps Codex's exit code when a resize lands after the pty has exited", async () => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.child.resizeThrows = true;
		h.stdout.rows = 20;
		h.stdout.emit("resize");
		h.child.exit(4);
		expect(await done).toBe(4);
	});

	it("passes Ctrl-Z to codex as a key and does nothing else", async () => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		h.stdin.emit("data", Buffer.from("\u001a"));
		expect(Buffer.from(h.child.written[0] ?? "").toString()).toBe("\u001a");
		expect(h.raw).toEqual([true]);
		expect(h.out.join("")).toBe("");
		h.child.exit(0);
		expect(await done).toBe(0);
	});

	it("sets the scroll region again after a forced flush, at the next boundary", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
		const h = harness({ rows: 30 });
		const done = runCommand([], h.io);
		await settle();
		h.child.emitData(`${ESC}[1;`);
		vi.advanceTimersByTime(50);
		h.out.length = 0;
		h.child.emitData("40rtext");
		expect(h.out.join("").startsWith(`40rtext${ESC}7${ESC}[1;26r${ESC}8`)).toBe(true);
		expect(h.out.join("")).toContain(`${ESC}[27;1H`);
		h.child.exit(0);
		await done;
	});

	it("sets the scroll region again after codex resets the terminal", async () => {
		const h = harness({ rows: 30 });
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		h.child.emitData(`${ESC}c`);
		expect(h.out.join("")).toContain(`${ESC}c${ESC}7${ESC}[1;26r${ESC}8`);
		h.child.exit(0);
		await done;
	});

	it("draws no panel while codex holds a saved cursor", async () => {
		const h = harness({ rows: 30 });
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		h.child.emitData(`${ESC}7abc`);
		expect(h.out.join("")).toBe(`${ESC}7abc`);
		h.child.emitData(`${ESC}8`);
		expect(h.out.join("")).toContain(`${ESC}[27;1H`);
		h.child.exit(0);
		await done;
	});

	it("holds a resize until codex's output is between whole sequences", async () => {
		const h = harness({ rows: 30, columns: 100 });
		const done = runCommand([], h.io);
		await settle();
		h.child.emitData(`x${ESC}[3`);
		h.out.length = 0;
		h.stdout.rows = 20;
		h.stdout.emit("resize");
		expect(h.out.join("")).toBe("");
		expect(h.child.resized).toEqual([]);
		h.child.emitData("1m");
		const after = h.out.join("");
		expect(after.startsWith(`${ESC}[31m${ESC}[1;16r${ESC}[2J`)).toBe(true);
		expect(h.child.resized).toEqual([[100, 16]]);
		h.child.exit(0);
		await done;
	});

	it("after a forced flush, applies a held resize behind a CAN that ends the open sequence", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
		const h = harness({ rows: 30, columns: 100 });
		const done = runCommand([], h.io);
		await settle();
		h.child.emitData(`x${ESC}[3`);
		h.stdout.rows = 20;
		h.stdout.emit("resize");
		h.out.length = 0;
		vi.advanceTimersByTime(50);
		expect(h.out.join("").startsWith(`${ESC}[3\u0018${ESC}[1;16r${ESC}[2J`)).toBe(true);
		expect(h.child.resized).toEqual([[100, 16]]);
		h.child.exit(0);
		await done;
	});

	it("forwards keyboard bytes unchanged, Korean included", async () => {
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		const typed = Buffer.from("한글\r", "utf8");
		h.stdin.emit("data", typed);
		expect(Buffer.concat(h.child.written.map((item) => Buffer.from(item))).equals(typed)).toBe(true);
		h.child.exit(0);
		await done;
	});

	it("keeps a scroll region reset inside codex's rows", async () => {
		const h = harness({ rows: 30 });
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		h.child.emitData(`${ESC}[r${ESC}[1;30r`);
		expect(h.out.join("")).toContain(`${ESC}[1;26r${ESC}[1;26r`);
		h.child.exit(0);
		await done;
	});

	it("holds an unfinished escape sequence and flushes it after 50 ms, drawing no panel inside it", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		h.child.emitData(`x${ESC}[3`);
		expect(h.out.join("")).toBe("x");
		vi.advanceTimersByTime(49);
		expect(h.out.join("")).toBe("x");
		vi.advanceTimersByTime(1);
		expect(h.out.join("")).toBe(`x${ESC}[3`);
		h.child.emitData("1mred");
		expect(h.out.join("")).toContain(`x${ESC}[31mred${ESC}7`);
		h.child.exit(0);
		await done;
	});

	it("redraws the panel once a second only when its text changes", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
		const h = harness();
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		vi.advanceTimersByTime(3_000);
		expect(h.out.join("")).toBe("");
		h.child.exit(0);
		await done;
	});

	it("follows a LIT turn started in the run folder and redraws when its clock ticks", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
		const h = harness();
		let clock = 1_000;
		const io: RunIo = { ...h.io, now: () => clock };
		const session = "019a0000-bbbb-7000-8000-000000000002";
		writeThreadPointer(io.env, session, io.cwd, 1_000);
		recordWorkflowTurn(io.cwd, session, "turn-1", "lit-loop", 1_000);
		recordTurnStart(io.cwd, session, 1_000);
		const done = runCommand([], io);
		await settle();
		expect(h.out.join("")).toContain("🔥 LIT · lit-loop");
		h.out.length = 0;
		clock = 2_000;
		vi.advanceTimersByTime(1_000);
		expect(h.out.join("")).toContain("0:01");
		h.child.exit(0);
		await done;
	});

	it("on a resize, sets the new scroll region, clears, redraws and resizes codex", async () => {
		const h = harness({ rows: 30, columns: 100 });
		const done = runCommand([], h.io);
		await settle();
		h.out.length = 0;
		h.stdout.rows = 20;
		h.stdout.columns = 80;
		h.stdout.emit("resize");
		const after = h.out.join("");
		expect(after.startsWith(`${ESC}[1;16r${ESC}[2J`)).toBe(true);
		expect(after).toContain(`${ESC}[17;1H`);
		expect(h.child.resized).toEqual([[80, 16]]);
		h.child.emitData(`${ESC}[r`);
		expect(h.out.join("")).toContain(`${ESC}[1;16r`);
		h.child.exit(0);
		await done;
		expect(h.out.join("").endsWith(`${ESC}[17;1H${ESC}[?25h`)).toBe(true);
	});
});

describe("ensurePtyHelperExecutable", () => {
	it("sets the execute bit on a macOS prebuild helper that lacks it, and leaves other layouts alone", () => {
		const root = join(tempHome(), "node-pty");
		const dir = join(root, "prebuilds", `darwin-${process.arch}`);
		mkdirSync(dir, { recursive: true });
		const helper = join(dir, "spawn-helper");
		writeFileSync(helper, "");
		chmodSync(helper, 0o644);
		expect(ensurePtyHelperExecutable(root, "linux")).toBeNull();
		expect(() => accessSync(helper, constants.X_OK)).toThrow();
		expect(ensurePtyHelperExecutable(root, "darwin")).toBeNull();
		expect(() => accessSync(helper, constants.X_OK)).not.toThrow();
		expect(ensurePtyHelperExecutable(join(root, "missing"), "darwin")).toBeNull();
	});

	it("leaves a node-pty outside the given package's node_modules alone", () => {
		const home = tempHome();
		const root = join(home, "global", "node_modules", "node-pty");
		const dir = join(root, "prebuilds", `darwin-${process.arch}`);
		mkdirSync(dir, { recursive: true });
		const helper = join(dir, "spawn-helper");
		writeFileSync(helper, "");
		chmodSync(helper, 0o644);
		expect(ensurePtyHelperExecutable(root, "darwin", join(home, "pkg"))).toBeNull();
		expect(() => accessSync(helper, constants.X_OK)).toThrow();
		expect(ensurePtyHelperExecutable(root, "darwin", join(home, "global"))).toBeNull();
		expect(() => accessSync(helper, constants.X_OK)).not.toThrow();
	});
});

describe("litcodex run as a process", () => {
	it("runs codex plainly and passes its exit code when node-pty cannot load", () => {
		const home = tempHome();
		const bin = fakeCodexDir(home);
		const hooks = join(home, "block-pty-hooks.mjs");
		writeFileSync(
			hooks,
			'export async function resolve(specifier, context, next) {\n\tif (specifier === "node-pty") throw Object.assign(new Error("blocked"), { code: "ERR_MODULE_NOT_FOUND" });\n\treturn next(specifier, context);\n}\n',
		);
		const register = join(home, "block-pty.mjs");
		writeFileSync(
			register,
			`import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});\n`,
		);
		const run = spawnSync(process.execPath, ["--import", register, binPath, "run", "--", "--flag", "two words"], {
			encoding: "utf8",
			cwd: home,
			env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, CODEX_HOME: join(home, ".codex") },
		});
		expect(run.status).toBe(7);
		expect(run.stdout).toBe("fake codex [--flag] [two words]\n");
		const notes = run.stderr.split("\n").filter((line) => line !== "");
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatch(/node-pty/u);
	});

	it("runs codex plainly with one note when it is not attached to a terminal", () => {
		const home = tempHome();
		const bin = fakeCodexDir(home);
		const run = spawnSync(process.execPath, [binPath, "run", "--", "--version"], {
			encoding: "utf8",
			cwd: home,
			env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, CODEX_HOME: join(home, ".codex") },
		});
		expect(run.status).toBe(7);
		expect(run.stdout).toBe("fake codex [--version]\n");
		expect(run.stderr.split("\n").filter((line) => line !== "")).toHaveLength(1);
	});
});
