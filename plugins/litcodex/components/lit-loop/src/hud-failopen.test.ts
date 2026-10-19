// The HUD fails open: a record it cannot read becomes one short line, never a crash or a false "ready";
// a signal ends it with exit 0 and the terminal put back.
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readHud, renderHud } from "./hud.js";
import { hudCommand } from "./hud-cli.js";
import {
	liveStepPath,
	recordLiveStepStart,
	recordTurnStart,
	threadPointerPath,
	writeThreadPointer,
} from "./live-step.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const roots: string[] = [];
const ID = "019a0000-dddd-7000-8000-000000000004";
const NOW = 1_800_000_000_000;
const PUBLIC_BIN = fileURLToPath(new URL("../../../../../packages/litcodex-ai/bin/litcodex.js", import.meta.url));
const ENTER = "\u001b[?1049h\u001b[?25l";
const LEAVE = "\u001b[?25h\u001b[?1049l";

afterEach(() => {
	for (const root of roots.splice(0)) {
		chmodAll(root);
		rmSync(root, { recursive: true, force: true });
	}
});

function chmodAll(root: string): void {
	try {
		chmodSync(join(root, "work", "beta", ".litcodex", "live-step", `${ID}.json`), 0o644);
	} catch {
		// Only the unreadable-file case changes a mode.
	}
}

function session(): { env: NodeJS.ProcessEnv; cwd: string } {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-failopen-")));
	roots.push(home);
	const env = { HOME: home, CODEX_HOME: join(home, ".codex") };
	const cwd = join(home, "work", "beta");
	mkdirSync(cwd, { recursive: true });
	writeThreadPointer(env, ID, cwd, NOW - 1_000);
	recordWorkflowTurn(cwd, ID, "turn-1", "start-work", NOW - 1_000);
	recordTurnStart(cwd, ID, NOW - 1_000);
	recordLiveStepStart(cwd, ID, { tool: "Bash", toolUseId: "call-1" }, NOW - 1_000);
	return { env, cwd };
}

function frame(env: NodeJS.ProcessEnv): string {
	return renderHud(readHud(env, null, NOW), { width: 100, color: false, now: NOW });
}

describe("hud fail-open reads", () => {
	it("draws a healthy session with no cannot-read line", () => {
		const { env } = session();
		const text = frame(env);
		expect(text).toContain("🔥 LIT IGNITED · start-work");
		expect(text).toContain("⠹ Bash");
		expect(text).not.toContain("cannot read");
	});

	it("shows ready, not an error, when the session has no records yet", () => {
		const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-failopen-")));
		roots.push(home);
		const env = { HOME: home, CODEX_HOME: join(home, ".codex") };
		mkdirSync(join(home, "work", "beta"), { recursive: true });
		writeThreadPointer(env, ID, join(home, "work", "beta"), NOW);
		const text = frame(env);
		expect(text).toContain("LIT · ready");
		expect(text).not.toContain("cannot read");
	});

	it("says it cannot read a corrupt live step", () => {
		const { env, cwd } = session();
		writeFileSync(liveStepPath(cwd, ID) as string, "{not json");
		expect(frame(env)).toContain("cannot read live step");
	});

	it("says it cannot read an oversized live step", () => {
		const { env, cwd } = session();
		writeFileSync(liveStepPath(cwd, ID) as string, `{"version":1,"pad":"${"x".repeat(8_000)}"}`);
		expect(frame(env)).toContain("cannot read live step");
	});

	it("says it cannot read a symlinked live step", () => {
		const { env, cwd } = session();
		const path = liveStepPath(cwd, ID) as string;
		const target = join(cwd, "elsewhere.json");
		writeFileSync(target, '{"version":1,"tool":"Evil","startedAt":1}');
		rmSync(path);
		symlinkSync(target, path);
		const text = frame(env);
		expect(text).toContain("cannot read live step");
		expect(text).not.toContain("Evil");
	});

	it.skipIf(process.getuid?.() === 0)("says it cannot read a live step it has no permission for", () => {
		const { env, cwd } = session();
		chmodSync(liveStepPath(cwd, ID) as string, 0o000);
		expect(frame(env)).toContain("cannot read live step");
	});

	it("says it cannot read a corrupt workflow record", () => {
		const { env, cwd } = session();
		writeFileSync(join(cwd, ".litcodex", "workflow-map", `${ID}.json`), "[[[");
		expect(frame(env)).toContain("cannot read workflow record");
	});

	it("says it cannot read an oversized workflow record", () => {
		const { env, cwd } = session();
		writeFileSync(join(cwd, ".litcodex", "workflow-map", `${ID}.json`), `{"pad":"${"x".repeat(1_100_000)}"}`);
		expect(frame(env)).toContain("cannot read workflow record");
	});

	it("says it cannot read a corrupt start-work state", () => {
		const { env, cwd } = session();
		mkdirSync(join(cwd, ".litcodex", "start-work"), { recursive: true });
		writeFileSync(join(cwd, ".litcodex", "start-work", "state.json"), '{"works":');
		expect(frame(env)).toContain("cannot read start-work state");
	});

	it("says it cannot read corrupt goals, scoped or shared", () => {
		const { env, cwd } = session();
		mkdirSync(join(cwd, ".litcodex", "lit-loop", ID), { recursive: true });
		writeFileSync(join(cwd, ".litcodex", "lit-loop", ID, "goals.json"), "{");
		expect(frame(env)).toContain("cannot read session goals");
		writeFileSync(join(cwd, ".litcodex", "lit-loop", "goals.json"), "{");
		expect(frame(env)).toContain("cannot read session goals, shared goals");
	});

	it("says it cannot read a corrupt lit-plan record", () => {
		const { env, cwd } = session();
		mkdirSync(join(cwd, ".litcodex", "lit-plan"), { recursive: true });
		writeFileSync(join(cwd, ".litcodex", "lit-plan", `${ID}.json`), "nope");
		expect(frame(env)).toContain("cannot read lit-plan record");
	});

	it("says it cannot read a symlinked project record folder", () => {
		const { env, cwd } = session();
		const real = join(cwd, "real-litcodex");
		mkdirSync(real);
		rmSync(join(cwd, ".litcodex"), { recursive: true });
		symlinkSync(real, join(cwd, ".litcodex"));
		expect(frame(env)).toContain("cannot read project records");
	});

	it("says it cannot read a corrupt session pointer while it waits", () => {
		const { env } = session();
		writeFileSync(threadPointerPath(env, ID) as string, "{broken");
		const text = frame(env);
		expect(text).toContain("waiting for a LIT session");
		expect(text).toContain("cannot read session pointer");
	});
});

describe("hud exit", () => {
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		it(`restores the screen and cursor and exits 0 on ${signal}`, async () => {
			const { env } = session();
			const out: string[] = [];
			const signals = new EventEmitter();
			const done = hudCommand([], {
				stdout: { write: (text: string) => out.push(text), isTTY: true, columns: 80 },
				stderr: { write: () => true },
				env,
				signals,
				now: () => NOW,
			});
			await new Promise((resolve) => setImmediate(resolve));
			expect(out[0]).toBe(ENTER);
			signals.emit(signal);
			expect(await done).toBe(0);
			expect(out.at(-1)).toBe(LEAVE);
			expect(signals.listenerCount(signal)).toBe(0);
		});
	}

	it("keeps a stdout error from turning into a crash while it runs", async () => {
		const { env } = session();
		const stdout = Object.assign(new EventEmitter(), { write: () => true, isTTY: true, columns: 80 });
		const signals = new EventEmitter();
		const done = hudCommand([], { stdout, stderr: { write: () => true }, env, signals, now: () => NOW });
		await new Promise((resolve) => setImmediate(resolve));
		expect(() => stdout.emit("error", new Error("EIO"))).not.toThrow();
		signals.emit("SIGHUP");
		expect(await done).toBe(0);
		expect(() => stdout.emit("error", new Error("EIO"))).not.toThrow();
	});

	it("restores the terminal and reports a crash it did not expect", async () => {
		const { env } = session();
		const out: string[] = [];
		const signals = new EventEmitter();
		const done = hudCommand([], {
			stdout: { write: (text: string) => out.push(text), isTTY: true, columns: 80 },
			stderr: { write: () => true },
			env,
			signals,
			now: () => NOW,
		});
		await new Promise((resolve) => setImmediate(resolve));
		signals.emit("uncaughtException", new Error("boom"));
		expect(await done).toBe(1);
		expect(out.at(-1)).toBe(LEAVE);
	});

	it("exits 0 when the built command gets SIGTERM", async () => {
		const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-proc-")));
		roots.push(home);
		const child = spawn(process.execPath, [PUBLIC_BIN, "hud"], {
			env: { PATH: process.env["PATH"] ?? "", HOME: home, CODEX_HOME: join(home, ".codex") },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		await new Promise<void>((resolve, reject) => {
			child.on("error", reject);
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");
				resolve();
			});
		});
		child.kill("SIGTERM");
		const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
			child.on("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal])),
		);
		expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: "" });
		expect(stdout).toContain("waiting for a LIT session");
		expect(stdout).not.toContain("\u001b[?1049h");
	}, 20_000);
});
