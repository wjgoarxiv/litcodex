// The HUD is read-only: over several ticks it never writes, creates, renames or deletes a file.
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createHudLoop } from "./hud-cli.js";
import { recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const spy = vi.hoisted(() => ({
	watching: false,
	calls: [] as string[],
	opened: [] as string[],
	spawns: [] as string[],
}));

vi.mock("node:child_process", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:child_process")>();
	const names = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const;
	const mocked: Record<string, unknown> = { ...real };
	for (const name of names) {
		const fn = real[name] as (...args: unknown[]) => unknown;
		mocked[name] = (...args: unknown[]) => {
			spy.spawns.push(name);
			return fn(...args);
		};
	}
	return { ...mocked, default: mocked };
});

vi.mock("node:fs", async (importOriginal) => {
	const real = await importOriginal<typeof import("node:fs")>();
	const writeFlags =
		real.constants.O_WRONLY | real.constants.O_RDWR | real.constants.O_CREAT | real.constants.O_APPEND;
	const watch =
		<A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
		(...args: A): R => {
			if (spy.watching) spy.calls.push(name);
			return fn(...args);
		};
	const mocked = {
		...real,
		writeFileSync: watch("writeFileSync", real.writeFileSync),
		appendFileSync: watch("appendFileSync", real.appendFileSync),
		writeSync: watch("writeSync", real.writeSync),
		mkdirSync: watch("mkdirSync", real.mkdirSync),
		mkdtempSync: watch("mkdtempSync", real.mkdtempSync),
		renameSync: watch("renameSync", real.renameSync),
		rmSync: watch("rmSync", real.rmSync),
		unlinkSync: watch("unlinkSync", real.unlinkSync),
		copyFileSync: watch("copyFileSync", real.copyFileSync),
		symlinkSync: watch("symlinkSync", real.symlinkSync),
		chmodSync: watch("chmodSync", real.chmodSync),
		utimesSync: watch("utimesSync", real.utimesSync),
		openSync: (path: fs.PathLike, flags?: fs.OpenMode, mode?: fs.Mode) => {
			const writes = typeof flags === "number" ? (flags & writeFlags) !== 0 : flags !== undefined && flags !== "r";
			if (spy.watching && writes) spy.calls.push("openSync");
			if (spy.watching) spy.opened.push(String(path));
			return real.openSync(path, flags ?? "r", mode);
		},
	};
	return { ...mocked, default: mocked };
});

const ID = "019a0000-ffff-7000-8000-000000000006";
const START = 1_800_000_000_000;

describe("hud read-only", () => {
	it("makes no file-system write over several ticks", () => {
		const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "litcodex-hud-readonly-")));
		try {
			const env = { HOME: home, CODEX_HOME: join(home, ".codex") };
			const cwd = join(home, "work", "beta");
			fs.mkdirSync(cwd, { recursive: true });
			writeThreadPointer(env, ID, cwd, START);
			recordWorkflowTurn(cwd, ID, "turn-1", "start-work", START);
			recordTurnStart(cwd, ID, START);
			recordLiveStepStart(cwd, ID, { tool: "Bash", toolUseId: "call-1" }, START);
			const frames: string[] = [];
			let now = START;
			const loop = createHudLoop({
				env,
				wanted: null,
				out: { write: (text: string) => frames.push(text), isTTY: true, columns: 100 },
				color: true,
				now: () => now,
			});
			spy.watching = true;
			for (let tick = 0; tick < 5; tick++) {
				loop.tick();
				now += 1_000;
			}
			spy.watching = false;
			expect(frames.length).toBeGreaterThan(1);
			expect(spy.calls).toEqual([]);
			expect(spy.spawns).toEqual([]);
		} finally {
			spy.watching = false;
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("sees the writes a hook makes, so the zero above is a real zero", () => {
		const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "litcodex-hud-readonly-")));
		try {
			spy.calls.length = 0;
			spy.watching = true;
			recordTurnStart(join(home, "work"), ID, START);
			spy.watching = false;
			expect(spy.calls).toEqual(expect.arrayContaining(["mkdirSync", "writeFileSync", "renameSync"]));
		} finally {
			spy.watching = false;
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("re-reads a thread pointer only after it changed", () => {
		const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "litcodex-hud-readonly-")));
		try {
			const env = { HOME: home, CODEX_HOME: join(home, ".codex") };
			for (let index = 0; index < 5; index++) {
				const cwd = join(home, "work", `p${index}`);
				fs.mkdirSync(cwd, { recursive: true });
				writeThreadPointer(env, `019a0000-ffff-7000-8000-00000000010${index}`, cwd, START + index);
			}
			const loop = createHudLoop({
				env,
				wanted: null,
				out: { write: () => true, columns: 100 },
				color: false,
				now: () => START + 10_000,
			});
			loop.tick();
			spy.opened.length = 0;
			spy.watching = true;
			loop.tick();
			loop.tick();
			spy.watching = false;
			// The card of the followed session (…0104, the newest) reads its own pointer; the scan opens none.
			const pointers = spy.opened.filter((path) => path.includes(join("lit-loop", "threads")));
			expect(pointers.filter((path) => !path.endsWith("00000000104.json"))).toEqual([]);
		} finally {
			spy.watching = false;
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("imports no process spawner", () => {
		for (const file of ["hud.ts", "hud-cli.ts"]) {
			const source = fs.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
			expect(source).not.toMatch(/child_process/u);
		}
	});
});
