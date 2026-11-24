// The HUD's sunset: free cells only, exact widths, motion while work runs, stillness otherwise, and no scene
// where the terminal is not a dark truecolor window.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardStatus } from "./card-status.js";
import { clean, displayWidth, fit, type HudView, hudLines, renderHud } from "./hud.js";
import { createHudLoop, hudCommand } from "./hud-cli.js";
import { composeScene, drawsRoundCaps, lightBackground, type SceneOptions, sceneMood } from "./hud-scene.js";
import { endLiveStep, recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { recordWorkflowTurn, workflowMapCells } from "./workflow-map.js";

const NOW = 1_800_000_000_000;
const ID = "019a0000-aaaa-7000-8000-000000000009";
const SGR = /\u001b\[[0-9;]*m/gu;
const SCENE_GLYPHS = /[▁▂▃▄▅▆▇█]/u;
const CAPS = /[]/u;
const strip = (row: string): string => row.replace(SGR, "");

function status(overrides: Partial<CardStatus> = {}): CardStatus {
	return {
		version: 1,
		thread: ID,
		state: "ignited",
		mode: "start-work",
		look: null,
		ignitedAt: NOW - 60_000,
		map: workflowMapCells("start-work", {
			work: { done: 2, total: 5, next: "Write the parser tests", status: "active" },
			goals: null,
			plan: "published",
			research: null,
		}),
		step: { tool: "Bash", startedAt: NOW - 12_000 },
		lastStepAt: null,
		lastTool: null,
		turnStartedAt: null,
		turnEndedAt: null,
		working: true,
		usage: null,
		branch: null,
		workspace: "beta",
		cardOpenedAt: null,
		now: NOW,
		...overrides,
	};
}

function view(card: CardStatus | null, extra: Partial<HudView> = {}): HudView {
	return {
		wanted: null,
		session: card === null ? null : { id: ID, folder: "~/work/beta", lastSeen: NOW - 5_000 },
		status: card,
		unreadable: [],
		...extra,
	};
}

const WAITING = view(null);
const WORKING = view(status());
const WIDE = view(status(), {
	session: { id: ID, folder: `~/작업/${"동기화-서비스-저장소".repeat(12)}`, lastSeen: NOW },
});

function compose(of: HudView, options: Partial<SceneOptions> = {}) {
	return composeScene(hudLines(of, NOW), sceneMood(of), { width: 110, rows: 30, caps: false, ...options });
}

describe("hud scene placement", () => {
	it("draws the sun, the sea and the rule under the card", () => {
		const rows = compose(WORKING).paint(1).map(strip);
		const text = hudLines(WORKING, NOW).length;
		expect(rows).toHaveLength(text + 5);
		expect(rows[text]).not.toMatch(SCENE_GLYPHS);
		expect(rows[text + 1]).toMatch(/[▁▂▃▄▅▆▇]/u);
		expect(rows[text + 3]).toContain("▆".repeat(18));
		expect(rows[text + 3]).toMatch(/[~.-]{3}/u);
		expect(rows[text + 4]).toBe("─".repeat(110));
	});

	it("keeps every word of every line where it is, at every width and height", () => {
		for (const card of [WORKING, WIDE, WAITING, view(status({ look: "rewind", mode: "lit-adhd" }))]) {
			for (let width = 10; width <= 160; width += 3) {
				for (const rows of [1, 3, 4, 5, 6, 7, 8, 9, 10, 24]) {
					for (const t of [0, 0.4, 3.3]) {
						const drawn = compose(card, { width, rows }).paint(t).map(strip);
						hudLines(card, NOW).forEach((line, index) => {
							const row = drawn[index] ?? "";
							const expected = fit(clean(line.text), width);
							if (index > 0) expect(row.startsWith(expected)).toBe(true);
							else if (width > 12) expect(row.startsWith(" 🔥 LIT ")).toBe(true);
							expect(displayWidth(row)).toBeLessThanOrEqual(width);
						});
						for (const row of drawn) expect(displayWidth(row)).toBeLessThanOrEqual(width);
					}
				}
			}
		}
	});

	it("keeps the first line's words and order behind the pill", () => {
		for (const width of [20, 60, 100, 160]) {
			const before = renderHud(WORKING, { width, color: true, truecolor: true, now: NOW }).split("\n")[0] ?? "";
			expect(strip(compose(WORKING, { width }).paint(0)[0] ?? "").startsWith(strip(before))).toBe(true);
		}
	});

	it("never draws more rows than the window has, and none when the card alone overflows", () => {
		const text = hudLines(WORKING, NOW).length;
		for (let rows = 1; rows <= 40; rows++) {
			expect(compose(WORKING, { rows }).paint(1).length).toBeLessThanOrEqual(Math.max(text, rows));
		}
		const tight = compose(WORKING, { rows: text - 1 });
		expect(tight.paint(1)).toHaveLength(text);
		expect(tight.moving).toBe(false);
		expect(tight.paint(1).join("")).not.toMatch(SCENE_GLYPHS);
	});

	it("moves beside short lines when the window is low, and hides the sun when a line needs its cells", () => {
		const text = hudLines(WORKING, NOW).length;
		const beside = compose(WORKING, { rows: text, width: 140 }).paint(1).map(strip);
		expect(beside).toHaveLength(text);
		expect(beside.join("\n")).toContain("▆".repeat(18));
		const long = view(status({ step: { tool: "x".repeat(130), startedAt: NOW } }));
		const taken = compose(long, { rows: hudLines(long, NOW).length, width: 140 })
			.paint(1)
			.map(strip);
		expect(taken.join("\n")).not.toContain("▆".repeat(18));
	});

	it("follows the card when it gains or loses a row", () => {
		const short = view(status({ step: null }));
		expect(compose(WORKING).paint(0).length - compose(short).paint(0).length).toBe(1);
	});

	it("hides in a narrow window and beside a notice", () => {
		for (const scene of [
			compose(WORKING, { width: 59 }),
			compose(view(status(), { unreadable: ["live step"] })),
			compose(view(null, { wanted: "019a", matches: 2 })),
			compose(view(status({ state: "complete", look: "done" }))),
		]) {
			const rows = scene.paint(1).map(strip);
			expect(rows.join("\n")).not.toMatch(SCENE_GLYPHS);
			expect(rows.join("\n")).not.toContain("───");
			expect(scene.moving).toBe(false);
		}
	});
});

describe("hud scene motion", () => {
	it("moves by colour and ASCII alone: other glyphs never change", () => {
		const scene = compose(WORKING);
		expect(scene.moving).toBe(true);
		const frames = Array.from({ length: 120 }, (_, index) => scene.paint(index / 10));
		expect(new Set(frames.map((rows) => rows.join("\n"))).size).toBeGreaterThan(100);
		const solid = (rows: string[]): string =>
			rows
				.map((row) =>
					strip(row)
						.replace(/[~.*+ -]/gu, " ")
						.trimEnd(),
				)
				.join("\n");
		expect(new Set(frames.map(solid)).size).toBe(1);
	});

	it("leaves the card's own rows alone between frames", () => {
		const scene = compose(WORKING);
		const text = hudLines(WORKING, NOW).length;
		expect(scene.paint(0.1).slice(0, text)).toEqual(scene.paint(4.7).slice(0, text));
	});

	it("sends a shooting star across the sky every nine seconds", () => {
		const scene = compose(WORKING);
		const sky = hudLines(WORKING, NOW).length + 1;
		expect(strip(scene.paint(9.5)[sky] ?? "")).toContain("*--.");
		expect(strip(scene.paint(13)[sky] ?? "")).not.toContain("*--.");
	});

	it.each([
		["waiting", WAITING],
		["ready", view(status({ state: "ready", mode: null, map: null, step: null, working: false }))],
		["idle", view(status({ step: null, working: false }))],
		["your turn", view(status({ step: null, working: false, look: "turn" }))],
		["complete", view(status({ state: "complete", step: null, working: false }))],
		["rewind", view(status({ look: "rewind", mode: "lit-adhd" }))],
	])("stands still, with the sun up, while %s", (_name, card) => {
		const scene = compose(card);
		expect(scene.moving).toBe(false);
		expect(strip(scene.paint(0.2).join("\n"))).toContain("▆".repeat(18));
		expect(strip(scene.paint(9.5).join("\n"))).not.toContain("*--.");
	});

	it("leaves the rewind line's rainbow as it is and still", () => {
		const scene = compose(view(status({ look: "rewind", mode: "lit-adhd" })));
		expect(scene.paint(0)[1]).toBe(scene.paint(5)[1]);
		expect(scene.paint(0)[1]?.match(/38;5;\d+/gu)?.length ?? 0).toBeGreaterThan(8);
	});
});

describe("hud scene pills and gauges", () => {
	it("grades the brand pill from orange to pink and the current stage from violet to mint", () => {
		const rows = compose(WORKING).paint(0);
		expect(rows[0]).toContain("48;2;255;160;51");
		expect(rows[0]).toContain("48;2;255;51;136");
		expect(rows[2]).toContain("48;2;180;140;255");
		expect(rows[2]).toContain("48;2;124;245;176");
	});

	it("keeps today's gauge unless the terminal draws the caps itself", () => {
		expect(strip(compose(WORKING).paint(0)[2] ?? "")).toContain("▰▰▱▱▱ 2/5");
		expect(compose(WORKING).paint(0).join("")).not.toMatch(CAPS);
		const round = strip(compose(WORKING, { caps: true }).paint(0)[2] ?? "");
		expect(round).toContain("    2/5");
	});

	it("draws rounded rows exactly as wide as today's", () => {
		const lanes = view(status(), {});
		const lines = [...hudLines(lanes, NOW), { text: "├─ ● Aquinas [▉▉░░░] 2/5 running", style: "" }];
		for (let width = 10; width <= 160; width++) {
			const square = composeScene(lines, sceneMood(lanes), { width, rows: 40, caps: false }).paint(1);
			const round = composeScene(lines, sceneMood(lanes), { width, rows: 40, caps: true }).paint(1);
			expect(round.map((row) => displayWidth(strip(row)))).toEqual(square.map((row) => displayWidth(strip(row))));
		}
	});

	it("only trusts terminals known to draw the caps", () => {
		expect(drawsRoundCaps({ WT_SESSION: "1" })).toBe(true);
		expect(drawsRoundCaps({ TERM_PROGRAM: "vscode" })).toBe(true);
		expect(drawsRoundCaps({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
		expect(drawsRoundCaps({})).toBe(false);
	});

	it("reads a light background from COLORFGBG", () => {
		expect(lightBackground({ COLORFGBG: "0;15" })).toBe(true);
		expect(lightBackground({ COLORFGBG: "0;default;7" })).toBe(true);
		expect(lightBackground({ COLORFGBG: "15;0" })).toBe(false);
		expect(lightBackground({})).toBe(false);
	});
});

const roots: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function session(): { env: NodeJS.ProcessEnv; cwd: string } {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-hud-scene-")));
	roots.push(home);
	const env = { HOME: home, CODEX_HOME: join(home, ".codex") };
	const cwd = join(home, "work", "beta");
	mkdirSync(cwd, { recursive: true });
	writeThreadPointer(env, ID, cwd, NOW);
	recordWorkflowTurn(cwd, ID, "turn-1", "lit-loop", NOW);
	recordTurnStart(cwd, ID, NOW);
	recordLiveStepStart(cwd, ID, { tool: "Bash", toolUseId: "call-1" }, NOW);
	return { env, cwd };
}

describe("hud scene loop", () => {
	function harness(env: NodeJS.ProcessEnv) {
		const writes: string[] = [];
		const clock = { now: NOW };
		const out = { write: (text: string) => writes.push(text), isTTY: true, columns: 111, rows: 30 };
		const loop = createHudLoop({
			env,
			wanted: null,
			out,
			color: true,
			truecolor: true,
			scene: true,
			now: () => clock.now,
		});
		return { writes, clock, out, loop };
	}

	it("redraws between ticks only the rows that changed, and reads no record for it", () => {
		const { env, cwd } = session();
		const { writes, clock, loop } = harness(env);
		expect(loop.tick()).toBe(true);
		expect(writes[0]?.startsWith("\u001b[H")).toBe(true);
		expect(writes[0]?.endsWith("\u001b[J")).toBe(true);
		expect(loop.moving()).toBe(true);
		rmSync(cwd, { recursive: true, force: true });
		rmSync(env["CODEX_HOME"] as string, { recursive: true, force: true });
		clock.now += 100;
		expect(loop.frame()).toBe(true);
		expect(writes[1]).not.toContain("\u001b[J");
		expect(writes[1]).not.toContain("IGNITED");
		expect(strip(writes[1] ?? "")).toContain("▆".repeat(18));
	});

	it("stands still and writes nothing once the turn is over", () => {
		const { env, cwd } = session();
		const { writes, clock, loop } = harness(env);
		clock.now += 200_000;
		loop.tick();
		endLiveStep(cwd, ID, clock.now);
		clock.now += 1_000;
		loop.tick();
		expect(loop.moving()).toBe(false);
		clock.now += 120_000;
		loop.tick();
		const count = writes.length;
		for (let index = 0; index < 5; index++) {
			clock.now += 100;
			expect(loop.frame()).toBe(false);
		}
		expect(loop.tick()).toBe(false);
		expect(writes).toHaveLength(count);
	});

	it("draws a resized window whole on the next frame", () => {
		const { env } = session();
		const { writes, clock, out, loop } = harness(env);
		loop.tick();
		out.rows = 6;
		out.columns = 90;
		clock.now += 100;
		expect(loop.frame()).toBe(true);
		expect(writes.at(-1)?.startsWith("\u001b[H")).toBe(true);
		const rows = strip(writes.at(-1) ?? "").split("\n");
		expect(rows.length).toBeLessThanOrEqual(6);
	});

	async function run(extra: NodeJS.ProcessEnv, ms: number): Promise<string[]> {
		const { env } = session();
		const writes: string[] = [];
		vi.useFakeTimers({ now: NOW });
		const signals = new EventEmitter();
		const done = hudCommand([], {
			stdout: { write: (text: string) => writes.push(text), isTTY: true, columns: 111, rows: 30 },
			stderr: { write: () => true },
			env: { ...env, ...extra },
			signals,
		});
		await vi.advanceTimersByTimeAsync(ms);
		const before = vi.getTimerCount();
		signals.emit("SIGINT");
		expect(await done).toBe(0);
		expect(before).toBeGreaterThan(0);
		expect(vi.getTimerCount()).toBe(0);
		return writes;
	}

	it("animates about ten times a second on a dark truecolor terminal and stops its timers on exit", async () => {
		const writes = await run({ COLORTERM: "truecolor" }, 2_000);
		expect(writes.length).toBeGreaterThan(15);
		expect(writes.length).toBeLessThan(30);
	});

	it.each([
		["NO_COLOR", { COLORTERM: "truecolor", NO_COLOR: "1" }],
		["256 colours", {}],
		["a light background", { COLORTERM: "truecolor", COLORFGBG: "0;15" }],
	])("keeps today's frame and one write a second under %s", async (_name, extra) => {
		const writes = await run(extra, 2_050);
		// Alternate screen on, three one-second frames, alternate screen off.
		expect(writes.length).toBeLessThanOrEqual(5);
		expect(writes.join("")).not.toMatch(SCENE_GLYPHS);
		expect(writes.join("")).not.toContain("───");
	});
});
