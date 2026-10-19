import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CardStatus } from "./card-status.js";
import { displayWidth } from "./hud.js";
import { recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { PANEL_ROWS, panelClear, panelFrame, type RunPanelView, readRunPanel, renderRunPanel } from "./run-panel.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const ESC = "\u001b";
const SGR = /\u001b\[[0-9;]*m/gu;

const STATUS: CardStatus = {
	version: 1,
	thread: "019a0000-bbbb-7000-8000-000000000002",
	state: "ignited",
	mode: "lit-loop",
	ignitedAt: 10_000,
	map: {
		family: "main",
		next: null,
		cells: [
			{ key: "interview", icon: "🧭", word: "interview", state: "done", label: null, progress: null },
			{ key: "work", icon: "🔨", word: "work", state: "current", label: "WORK", progress: { done: 3, total: 7 } },
			{ key: "review", icon: "🔍", word: "review", state: "pending", label: null, progress: null },
		],
	},
	step: { tool: "Bash", startedAt: 70_000 },
	lastStepAt: 70_000,
	lastTool: null,
	turnStartedAt: 10_000,
	turnEndedAt: null,
	working: true,
	usage: null,
	branch: null,
	workspace: "beta",
	cardOpenedAt: null,
	now: 82_000,
};

const VIEW: RunPanelView = { status: STATUS, checklist: { state: "current", label: "Run the tests (테스트 실행)" } };

describe("renderRunPanel", () => {
	it("draws four plain rows: route with the turn clock, stage map, current step, checklist", () => {
		expect(renderRunPanel(VIEW, { width: 100, color: false, now: 82_000 })).toEqual([
			"┃ 🔥 LIT · lit-loop  1:12",
			"┃ ✓ INTERVIEW  ›  🔨 WORK ▰▰▰▱▱▱▱ 3/7  ›  🔍 REVIEW",
			"┃ ⠹ Bash · 0:12",
			"┃ ▸ Run the tests (테스트 실행)",
		]);
	});

	it("waits, dimmed, until a LIT turn starts", () => {
		const rows = renderRunPanel({ status: null, checklist: null }, { width: 80, color: true, now: 0 });
		expect(rows).toHaveLength(PANEL_ROWS);
		expect(rows[0]).toContain("waiting for a LIT turn");
		expect(rows[0]?.startsWith(`${ESC}[2m`)).toBe(true);
	});

	it("is the plain panel once the colours are taken out", () => {
		const plain = renderRunPanel(VIEW, { width: 100, color: false, now: 82_000 });
		const coloured = renderRunPanel(VIEW, { width: 100, color: true, now: 82_000 });
		expect(coloured.join("\n")).toContain(ESC);
		expect(coloured.map((row) => row.replace(SGR, ""))).toEqual(plain);
	});

	it.each([40, 60, 120])("keeps every row within %i cells", (width) => {
		const long: RunPanelView = {
			status: { ...STATUS, step: { tool: `mcp server · ${"long tool name ".repeat(10)}`, startedAt: 70_000 } },
			checklist: { state: "pending", label: "한국어 체크리스트 항목이 아주 길게 이어지는 경우 ".repeat(4) },
		};
		for (const color of [false, true]) {
			const rows = renderRunPanel(long, { width, color, now: 82_000 });
			expect(rows).toHaveLength(PANEL_ROWS);
			for (const row of rows) expect(displayWidth(row.replace(SGR, ""))).toBeLessThanOrEqual(width);
		}
	});

	it("strips control characters from record text", () => {
		const hostile: RunPanelView = {
			status: { ...STATUS, mode: `lit${ESC}[2J`, step: { tool: `Ba${ESC}]0;x\u0007sh`, startedAt: 70_000 } },
			checklist: { state: "current", label: `do${ESC}[31m it` },
		};
		const rows = renderRunPanel(hostile, { width: 100, color: false, now: 82_000 });
		expect(rows.join("")).not.toContain(ESC);
		expect(rows.join("")).not.toContain("\u0007");
	});

	it("keeps the four rows when there is no map, no step and no checklist", () => {
		const rows = renderRunPanel(
			{ status: { ...STATUS, map: null, step: null, working: false }, checklist: null },
			{ width: 80, color: false, now: 82_000 },
		);
		expect(rows).toHaveLength(PANEL_ROWS);
		expect(rows[0]).toContain("🔥 LIT · lit-loop");
	});
});

describe("panelFrame and panelClear", () => {
	it("draws below the child's rows inside a cursor save and restore", () => {
		const frame = panelFrame(["a", "b", "c", "d"], { childRows: 36, cursorVisible: true });
		expect(frame.startsWith(`${ESC}7${ESC}[?25l`)).toBe(true);
		for (let index = 0; index < PANEL_ROWS; index++) expect(frame).toContain(`${ESC}[${37 + index};1H`);
		expect(frame.endsWith(`${ESC}8${ESC}[?25h`)).toBe(true);
	});

	it("leaves the cursor hidden when the child hid it", () => {
		const frame = panelFrame(["a", "b", "c", "d"], { childRows: 36, cursorVisible: false });
		expect(frame.endsWith(`${ESC}8`)).toBe(true);
	});

	it("clears the panel rows, resets the scroll region and puts the cursor below the child", () => {
		const clear = panelClear(36);
		expect(clear.startsWith(`${ESC}[r`)).toBe(true);
		for (let index = 0; index < PANEL_ROWS; index++) expect(clear).toContain(`${ESC}[${37 + index};1H${ESC}[2K`);
		expect(clear.endsWith(`${ESC}[37;1H${ESC}[?25h`)).toBe(true);
	});
});

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const OLD = "019a0000-aaaa-7000-8000-000000000001";
const NEW = "019a0000-bbbb-7000-8000-000000000002";

describe("readRunPanel", () => {
	function setup(): { env: NodeJS.ProcessEnv; cwd: string; other: string } {
		const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-run-panel-")));
		roots.push(home);
		const cwd = join(home, "work", "beta");
		const other = join(home, "work", "alpha");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(other, { recursive: true });
		return { env: { HOME: home, CODEX_HOME: join(home, ".codex") }, cwd, other };
	}

	it("waits while no LIT session in the run folder was active after the run started", () => {
		const { env, cwd, other } = setup();
		writeThreadPointer(env, OLD, cwd, 1_000);
		recordWorkflowTurn(cwd, OLD, "turn-old", "lit-loop", 1_000);
		writeThreadPointer(env, NEW, other, 9_000);
		recordWorkflowTurn(other, NEW, "turn-new", "lit-loop", 9_000);
		expect(readRunPanel(env, cwd, 5_000, 10_000).status).toBeNull();
	});

	it("follows the newest session in the run folder once it is active", () => {
		const { env, cwd } = setup();
		writeThreadPointer(env, OLD, cwd, 1_000);
		writeThreadPointer(env, NEW, cwd, 6_000);
		recordWorkflowTurn(cwd, NEW, "turn-new", "lit-loop", 6_000);
		recordTurnStart(cwd, NEW, 6_000);
		recordLiveStepStart(cwd, NEW, { tool: "Bash", toolUseId: "t1" }, 7_000);
		const view = readRunPanel(env, cwd, 5_000, 8_000);
		expect(view.status?.thread).toBe(NEW);
		expect(view.status?.step?.tool).toBe("Bash");
		expect(renderRunPanel(view, { width: 80, color: false, now: 8_000 })[2]).toBe("┃ ⠹ Bash · 0:01");
	});

	it("picks up an older session the user resumed in the run folder", () => {
		const { env, cwd } = setup();
		writeThreadPointer(env, OLD, cwd, 1_000);
		recordWorkflowTurn(cwd, OLD, "turn-2", "lit-plan", 6_000);
		expect(readRunPanel(env, cwd, 5_000, 8_000).status?.mode).toBe("lit-plan");
	});
});
