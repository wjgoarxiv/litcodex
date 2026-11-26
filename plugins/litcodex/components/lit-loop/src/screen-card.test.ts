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
	look: null,
	map: MAP,
	checklist: [
		{ state: "done", label: "Wire the store" },
		{ state: "current", label: "Run the tests" },
		{ state: "pending", label: "Write the docs" },
	],
};

const ESC = "\u001b";

describe("renderScreenCard", () => {
	it("draws plain rows of words and round marks when colour is off", () => {
		expect(renderScreenCard(INPUT, { color: false, width: 100 })).toBe(
			[
				"🔥 LIT · lit-loop · turn started",
				"✓ interview ── ● work 3/7 ── ○ review",
				"✓ Wire the store",
				"▸ Run the tests",
				"· Write the docs",
			].join("\n"),
		);
	});

	it("wears the sunset in colour: the same words, graded, over a horizon with a low sun", () => {
		const rows = renderScreenCard(INPUT, { color: true, width: 100 }).split("\n");
		expect(rows).toHaveLength(6);
		const bare = rows.map((row) => row.replace(/\u001b\[[0-9;]*m/gu, ""));
		const said = (row: string): string => row.replace(/[ ·]+/gu, " ").trim();
		expect(bare.slice(0, 5).map(said)).toEqual(
			renderScreenCard(INPUT, { color: false, width: 100 }).split("\n").map(said),
		);
		expect(bare[5]).toMatch(/^▁+▂▄▅▆▇▇▆▅▄▂▁+$/u);
		// More than a few colours: a gradient along the horizon, a filled pill for the brand and the stage at work.
		expect(new Set(rows[5]?.match(/38;2;[0-9;]+/gu)).size).toBeGreaterThan(8);
		expect(rows[0]).toContain(`${ESC}[1;38;2;11;14;20;48;2;`);
		expect(rows[1]).toContain("48;2;");
	});

	it("turns amber when the turn waits on the user", () => {
		const turn = renderScreenCard({ ...INPUT, look: "turn", note: "your turn" }, { color: true, width: 100 });
		expect(turn).toContain("38;2;255;175;60");
		expect(turn).not.toContain("38;2;255;45;149");
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

	it.each([false, true])(
		"keeps what a wrap would break inside a phone's pane when no width is given (colour %s)",
		(color) => {
			const stage = (word: string, state: "done" | "current" | "pending") => ({
				key: word,
				icon: "",
				word,
				state,
				label: state === "current" ? word.toUpperCase() : null,
				progress: null,
			});
			const map: WorkflowMap = {
				...MAP,
				cells: [
					stage("interview", "done"),
					stage("plan", "done"),
					stage("work", "current"),
					stage("review", "pending"),
					stage("done", "pending"),
				],
			};
			const checklist = [
				{ state: "current" as const, label: "Establish fixtures, capability decisions and families" },
			];
			const rows = renderScreenCard({ ...INPUT, map, checklist }, { color })
				.replace(/\u001b\[[0-9;]*m/gu, "")
				.split("\n");
			for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(44);
			const said = rows.join(" ");
			for (const word of ["interview", "plan", "work", "review", "done"]) expect(said).toContain(word);
		},
	);

	const bare = (card: string): string[] => card.replace(/\u001b\[[0-9;]*m/gu, "").split("\n");

	it("keeps the sun's line to a phone's 32 cells at every width", () => {
		for (const options of [{ color: true }, { color: true, width: 100 }]) {
			const horizon = bare(renderScreenCard(INPUT, options)).at(-1) ?? "";
			expect(horizon).toMatch(/^▁+▂▄▅▆▇▇▆▅▄▂▁+$/u);
			expect(displayWidth(horizon)).toBeLessThanOrEqual(32);
		}
	});

	it("ends a pill that ends a row in a no-break space, which Codex keeps; a pill inside a row stays as it was", () => {
		const map: WorkflowMap = { ...MAP, cells: MAP.cells.slice(0, 2) };
		const ends = renderScreenCard({ ...INPUT, map }, { color: true }).split("\n")[1] ?? "";
		expect(ends.replace(/\u001b\[[0-9;]*m/gu, "")).toBe("✓ interview ──  ● work 3/7\xa0");
		const inside = renderScreenCard(INPUT, { color: true });
		expect(inside.replace(/\u001b\[[0-9;]*m/gu, "")).not.toContain("\xa0");
	});

	it.each([false, true])(
		"breaks long words inside the card between words, and keeps every one (colour %s)",
		(color) => {
			const note =
				"your turn · answer the question above · next: Write the parser tests for 한국어 입력 and the reader";
			const stack =
				"Now: litresearch (wave 2) · paused: start-work (work, 3/7), lit-hijack (plan) · type `lit continue` to go back";
			const rows = bare(renderScreenCard({ ...INPUT, note, stack }, { color }));
			for (const row of rows) expect(displayWidth(row), row).toBeLessThanOrEqual(72);
			expect(rows).toContain("type `lit continue` to go back");
			const said = rows.join(" ").replace(/[\s·]+/gu, " ");
			for (const part of [note, stack]) expect(said).toContain(part.replace(/[\s·]+/gu, " "));
		},
	);

	it.each([false, true])("gives the way back its own row when the paused row is too long (colour %s)", (color) => {
		const way = "type `lit continue` to go back";
		const long = `Now: lit-hijack · paused: start-work (work, 3/7), lit-loop (w, 1/5) · ${way}`;
		expect(bare(renderScreenCard({ ...INPUT, stack: long }, { color }))).toContain(way);
		const short = `Now: lit-hijack · paused: lit-loop (work) · ${way}`;
		expect(bare(renderScreenCard({ ...INPUT, stack: short }, { color, width: 96 }))).toContain(short);
	});

	it("strips control characters and escapes from record-derived text", () => {
		const card = renderScreenCard(
			{
				mode: `lit-loop${ESC}[31m`,
				note: `done\u0007‮`,
				look: null,
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
		expect(card.split("\n")).toEqual(["🔥 LIT · lit-loop · turn started", "· a", "· b", "· c"]);
	});
});
