// The HUD loop redraws only when the frame text changes; the running-step clock is the one change a second.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { displayWidth } from "./hud.js";
import { createHudLoop } from "./hud-cli.js";
import { recordLiveStepEnd, recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const roots: string[] = [];
const ID = "019a0000-eeee-7000-8000-000000000005";
const START = 1_800_000_000_000;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function session(): { env: NodeJS.ProcessEnv; cwd: string } {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-loop-")));
	roots.push(home);
	const env = { HOME: home, CODEX_HOME: join(home, ".codex") };
	const cwd = join(home, "work", "beta");
	mkdirSync(cwd, { recursive: true });
	writeThreadPointer(env, ID, cwd, START);
	recordWorkflowTurn(cwd, ID, "turn-1", "lit-loop", START);
	recordTurnStart(cwd, ID, START);
	return { env, cwd };
}

function harness(env: NodeJS.ProcessEnv, tty = false) {
	const writes: string[] = [];
	const clock = { now: START };
	const loop = createHudLoop({
		env,
		wanted: null,
		out: { write: (text: string) => writes.push(text), isTTY: tty, columns: 100 },
		color: false,
		now: () => clock.now,
	});
	return { writes, clock, loop };
}

describe("hud loop", () => {
	it("writes the first frame, then nothing while the frame is unchanged", () => {
		const { env } = session();
		const { writes, loop } = harness(env);
		expect(loop.tick()).toBe(true);
		expect(loop.tick()).toBe(false);
		expect(loop.tick()).toBe(false);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain("🔥 LIT IGNITED · lit-loop");
	});

	it("writes once after a live-step change", () => {
		const { env, cwd } = session();
		const { writes, loop } = harness(env);
		loop.tick();
		recordLiveStepStart(cwd, ID, { tool: "apply_patch", toolUseId: "call-1" }, START);
		expect(loop.tick()).toBe(true);
		expect(loop.tick()).toBe(false);
		expect(writes).toHaveLength(2);
		expect(writes[1]).toContain("⠹ apply_patch · 0:00");
	});

	it("ticks the step clock once a second while a step runs", () => {
		const { env, cwd } = session();
		recordLiveStepStart(cwd, ID, { tool: "Bash", toolUseId: "call-2" }, START);
		const { writes, clock, loop } = harness(env);
		loop.tick();
		clock.now += 400;
		expect(loop.tick()).toBe(false);
		clock.now += 600;
		expect(loop.tick()).toBe(true);
		expect(writes.at(-1)).toContain("⠹ Bash · 0:01");
	});

	it("stays quiet second to second once the session has been idle a while", () => {
		const { env, cwd } = session();
		recordLiveStepStart(cwd, ID, { tool: "Bash", toolUseId: "call-3" }, START);
		recordLiveStepEnd(cwd, ID, { tool: "Bash", toolUseId: "call-3" }, START);
		const { writes, clock, loop } = harness(env);
		clock.now = START + 2 * 60_000;
		loop.tick();
		clock.now += 1_000;
		expect(loop.tick()).toBe(false);
		clock.now += 1_000;
		expect(loop.tick()).toBe(false);
		expect(writes).toHaveLength(1);
	});

	it("redraws in place on a terminal, clearing what the last frame left", () => {
		const { env } = session();
		const { writes, loop } = harness(env, true);
		loop.tick();
		expect(writes[0]?.startsWith("\u001b[H")).toBe(true);
		expect(writes[0]?.endsWith("\u001b[J")).toBe(true);
	});

	it("leaves the last terminal column free", () => {
		const { env } = session();
		const long = join(env["HOME"] as string, "work", "p".repeat(150));
		mkdirSync(long, { recursive: true });
		writeThreadPointer(env, "019a0000-eeee-7000-8000-0000000000ff", long, START + 1);
		const { writes, loop } = harness(env, true);
		loop.tick();
		const text = (writes[0] ?? "").replace(/\u001b\[[0-9;]*[A-Za-z]/gu, "");
		for (const line of text.split("\n")) expect(displayWidth(line)).toBeLessThanOrEqual(99);
	});

	it("redraws after the terminal is resized, even when the text is the same", () => {
		const { env } = session();
		const out = { write: (_text: string) => true, isTTY: true, columns: 100 };
		const loop = createHudLoop({ env, wanted: null, out, color: false, now: () => START });
		expect(loop.tick()).toBe(true);
		expect(loop.tick()).toBe(false);
		out.columns = 120;
		expect(loop.tick()).toBe(true);
	});
});
