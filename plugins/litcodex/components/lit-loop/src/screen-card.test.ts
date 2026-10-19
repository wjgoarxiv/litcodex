import { describe, expect, it } from "vitest";
import { displayWidth } from "./hud.js";
import { renderScreenCard, type ScreenCardInput } from "./screen-card.js";
import type { WorkflowMap } from "./workflow-map.js";

const MAP: WorkflowMap = {
	family: "main",
	next: null,
	cells: [
		{ key: "interview", icon: "🧭", word: "interview", state: "done", label: null, progress: null },
		{ key: "work", icon: "🔨", word: "work", state: "current", label: "WORK", progress: { done: 3, total: 7 } },
		{ key: "review", icon: "🔍", word: "review", state: "pending", label: null, progress: null },
	],
};

const INPUT: ScreenCardInput = {
	mode: "lit-loop",
	note: "turn started",
	map: MAP,
	checklist: [
		{ state: "done", label: "Wire the store" },
		{ state: "current", label: "Run the tests" },
		{ state: "pending", label: "Write the docs" },
	],
};

const ESC = "\u001b";

describe("renderScreenCard", () => {
	it("draws plain rows with emoji and bars only when colour is off", () => {
		expect(renderScreenCard(INPUT, { color: false, width: 100 })).toBe(
			[
				"┃ 🔥 LIT · lit-loop  turn started",
				"┃ ✓ INTERVIEW  ›  🔨 WORK ▰▰▰▱▱▱▱ 3/7  ›  🔍 REVIEW",
				"┃ ✓ Wire the store",
				"┃ ▸ Run the tests",
				"┃ · Write the docs",
			].join("\n"),
		);
	});

	it("colours done green, the current stage bold accent and later stages dim when colour is on", () => {
		const card = renderScreenCard(INPUT, { color: true, width: 100 });
		const rows = card.split("\n");
		expect(rows).toHaveLength(5);
		expect(rows[0]).toContain(`${ESC}[1m${ESC}[38;2;255;155;94m🔥 LIT · lit-loop${ESC}[0m`);
		expect(rows[0]).toContain(`${ESC}[2m  turn started${ESC}[0m`);
		expect(rows[1]).toContain(`${ESC}[38;2;107;196;109m✓ INTERVIEW${ESC}[0m`);
		expect(rows[1]).toContain(`${ESC}[1m${ESC}[38;2;255;155;94m🔨 WORK ▰▰▰▱▱▱▱ 3/7${ESC}[0m`);
		expect(rows[1]).toContain(`${ESC}[2m🔍 REVIEW${ESC}[0m`);
		expect(rows[3]).toContain(`${ESC}[38;2;255;155;94m▸${ESC}[0m Run the tests`);
		// Without the escapes the coloured card is the plain card.
		expect(card.replace(/\u001b\[[0-9;]*m/gu, "")).toBe(renderScreenCard(INPUT, { color: false, width: 100 }));
	});

	it.each([60, 100])("keeps every row within %i cells", (width) => {
		const long: ScreenCardInput = {
			...INPUT,
			note: "✨ turn done · 3 tasks ✓ · next ▸ a very long next task title that keeps going and going",
			checklist: [
				{ state: "current", label: "작업 제목이 아주 길어서 한 줄에 다 들어가지 않는 경우를 확인한다 ".repeat(3) },
			],
		};
		const rows = renderScreenCard(long, { color: false, width }).split("\n");
		for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(width);
		expect(rows.some((row) => row.endsWith("…"))).toBe(true);
		const colored = renderScreenCard(long, { color: true, width }).split("\n");
		for (const row of colored) expect(displayWidth(row.replace(/\u001b\[[0-9;]*m/gu, ""))).toBeLessThanOrEqual(width);
	});

	it("strips control characters and escapes from record-derived text", () => {
		const card = renderScreenCard(
			{
				mode: `lit-loop${ESC}[31m`,
				note: `done\u0007‮`,
				map: null,
				checklist: [{ state: "current", label: `Run ${ESC}]0;evil${ESC}\\ tests\r\nnow` }],
			},
			{ color: false },
		);
		expect(card).not.toContain(ESC);
		expect(card).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‮]/u);
		expect(card.split("\n")).toHaveLength(2);
	});

	it("shows at most three checklist rows and leaves the map row out when there is no map", () => {
		const card = renderScreenCard(
			{
				...INPUT,
				map: null,
				checklist: ["a", "b", "c", "d", "e"].map((label) => ({ state: "pending" as const, label })),
			},
			{ color: false },
		);
		expect(card.split("\n")).toEqual(["┃ 🔥 LIT · lit-loop  turn started", "┃ · a", "┃ · b", "┃ · c"]);
	});
});
