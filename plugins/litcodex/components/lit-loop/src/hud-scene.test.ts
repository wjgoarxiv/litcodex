// The HUD's card: a frame that holds its columns whatever the records say, a sunset in free cells only, motion
// while work runs, stillness otherwise, and no card where the terminal is not a dark truecolor window.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEW_LANE_IDS } from "./card-looks.js";
import { type CardStatus, createUsageReader } from "./card-status.js";
import { clean, displayWidth, fit, type HudView, hudLines } from "./hud.js";
import { type CardOptions, composeCard } from "./hud-card.js";
import { createHudLoop, hudCommand } from "./hud-cli.js";
import { drawsRoundCaps } from "./hud-glyphs.js";
import { type Cell, changedRuns, cut, rowText, words } from "./hud-paint.js";
import { lightBackground, narrowLines, sceneMood } from "./hud-scene.js";
import { endLiveStep, recordLiveStepStart, recordTurnStart, writeThreadPointer } from "./live-step.js";
import type { ThreadRow, ThreadView } from "./threads.js";
import { recordWorkflowTurn, workflowMapCells } from "./workflow-map.js";

const NOW = 1_800_000_000_000;
const ID = "019a0000-aaaa-7000-8000-000000000009";
const SGR = /\u001b\[[0-9;]*m/gu;
const SCENE_GLYPHS = /[▁▂▃▄▅▆▇█]/u;
const SUN = "▆".repeat(18);
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

function row(overrides: Partial<ThreadRow> = {}): ThreadRow {
	return {
		key: "lane-1",
		kind: "lane",
		name: "Aquinas",
		stage: null,
		gauge: "[▉▉░░░] 2/5",
		note: "",
		state: "running",
		active: true,
		...overrides,
	} as ThreadRow;
}

function threads(...lanes: ThreadRow[]): ThreadView {
	return {
		chain: [row({ key: "frame-0", kind: "frame", name: "lit-loop", stage: "GREEN" })],
		lanes,
		others: [],
		laneCount: lanes.length,
		more: 0,
		back: null,
	} as unknown as ThreadView;
}

const LANES = view(
	status({
		threads: threads(
			row(),
			row({ name: "Lagrange", gauge: "[▉░░░░░░░] 1/8" }),
			row({ name: "Hume", gauge: null, note: "4 steps" }),
		),
	}),
);
const PAUSED = workflowMapCells("start-work", {
	work: { done: 2, total: 5, next: "Write the parser tests", status: "paused" },
	goals: null,
	plan: "published",
	research: null,
});
const STILL: readonly [string, HudView][] = [
	["waiting", WAITING],
	["ready", view(status({ state: "ready", mode: null, map: null, step: null, working: false }))],
	["idle", view(status({ step: null, working: false }))],
	["your turn", view(status({ step: null, working: false, look: "turn" }))],
	["complete", view(status({ state: "complete", step: null, working: false }))],
	["done", view(status({ look: "done", step: null, working: false }))],
	["rewind", view(status({ look: "rewind", mode: "lit-adhd" }))],
	["paused", view(status({ step: null, working: false, map: PAUSED }))],
	["blocked", view(status({ step: null, working: false, map: PAUSED, look: "turn" }))],
];
const REVIEW = view(
	status({ look: "review", mode: "review-work", reviewLanes: ["pass", "running", "fail", "dim", "dim"] }),
);
const HOSTILE = [
	"\u001b[31m\u001b]0;pwn\u0007red\r\n\u009b2J",
	"x".repeat(200),
	"한국어 입력 경로 ".repeat(12),
	"a\u0301\u0302\u0303e\u20dd".repeat(30),
	"שלום مرحبا \u202e\u2066rtl\u2069",
	"\u200b\u200d\ufeff\u2028\u00ad",
	"👩‍👩‍👧‍👦🏳️‍🌈👍🏽⚡️🔥".repeat(10),
	"\ue0b6\ue0b4\uf8ff\ud800",
	"한글 폴더 ".normalize("NFD").repeat(12),
	"🇰🇷🇯🇵".repeat(20),
	"हिन्दी क्ष्त्र ภาษาไทย ".repeat(8),
	"",
];

function hostile(text: string): HudView {
	return view(
		status({
			mode: text,
			branch: text,
			workspace: text,
			restart: text,
			step: { tool: text, startedAt: NOW - 3_000 },
			lastTool: text,
			usage: { ctx: 24, fiveHour: 71, week: 95 },
			map: { cells: status().map?.cells ?? [], next: text } as CardStatus["map"],
			stack: {
				breadcrumb: text,
				row: text,
				paused: [{ name: text, stage: text, gauge: text, note: text }],
				running: { name: text, stage: text, gauge: null, note: text },
			} as unknown as NonNullable<CardStatus["stack"]>,
			threads: {
				...threads(row({ name: text, note: text, gauge: null }), row({ stage: text, gauge: text })),
				others: [row({ kind: "session", name: text, session: text })],
				more: 3,
			},
		}),
		{ session: { id: text, folder: text, lastSeen: NOW - 5_000 }, unreadable: [text] },
	);
}

function compose(of: HudView, options: Partial<CardOptions> = {}) {
	return composeCard(of, { width: 110, rows: 30, caps: false, now: NOW, ...options });
}

const plain = (cells: readonly (readonly Cell[])[]): string[] =>
	cells.map((line) => line.map((cell) => cell.text).join(""));
const drawn = (of: HudView, options: Partial<CardOptions> = {}, seconds = 1): string[] =>
	plain(compose(of, options).paint(seconds));
const widthOf = (line: readonly Cell[]): number => displayWidth(line.map((cell) => cell.text).join(""));

describe("hud card frame", () => {
	it("frames title, stage map, detail, skills and figures, with the sun inside", () => {
		const rows = drawn(view(status({ branch: "main", usage: { ctx: 24, fiveHour: 22, week: 54 } })));
		expect(rows[0]).toMatch(/^╭─ {2}🔥 LIT {2}· start-work ─+ WORK ● ─╮$/u);
		expect(rows[1]).toMatch(/^│ interview ✓ ━━ plan ✓ ━━ {2}work 2\/5 {2}/u);
		expect(rows[2]).toContain("└ task 2/5 ▰▰▱▱▱ · next ▸ Write the parser tests");
		expect(rows[2]).toContain("Bash · 0:12 │");
		expect(rows[3]).toContain("skills  start-work");
		expect(rows.at(-2)).toContain(SUN);
		expect(rows.at(-1)).toMatch(/^╰─ ctx 24% ▰▱▱▱▱ · 5h 22% · 1w 54% · git main · ~\/work\/beta ─+ 5s ago .*─╯$/u);
	});

	it("keeps both edges in their column at every width for any record text", () => {
		const cards = [WORKING, LANES, REVIEW, ...STILL.map(([, card]) => card), ...HOSTILE.map(hostile)];
		for (const card of cards) {
			for (let width = 39; width <= 160; width++) {
				for (const caps of [false, true]) {
					for (const line of compose(card, { width, caps }).paint(1.3)) {
						expect(line).toHaveLength(Math.min(width, 120));
						expect(widthOf(line)).toBe(line.length);
						expect(line[0]?.text).toMatch(/^[╭│╰]$/u);
						expect(line.at(-1)?.text).toMatch(/^[╮│╯]$/u);
					}
				}
			}
		}
	}, 60_000);

	it("lets no control, format or private character of a record reach the terminal", () => {
		for (const text of HOSTILE) {
			const out = compose(hostile(text))
				.paint(1)
				.map((line) => strip(rowText(line, true)))
				.join("");
			expect(out).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}]/u);
		}
	});

	it("never draws more rows than the window has, and keeps the title and the newest rows", () => {
		for (const card of [WORKING, LANES, REVIEW, WAITING, hostile("x")]) {
			for (let rows = 1; rows <= 30; rows++)
				expect(compose(card, { rows }).paint(1).length).toBeLessThanOrEqual(rows);
		}
		const low = drawn(LANES, { rows: 4 });
		expect(low[0]).toContain("LIT");
		expect(low.join("\n")).toContain("task 2/5");
		expect(low.at(-1)).toContain("╰");
	});

	it("drops the figures of the bottom rule from the right", () => {
		const card = view(status({ branch: "main", usage: { ctx: 24, fiveHour: 22, week: 54 } }));
		const shown = [39, 50, 60, 80, 110].map((width) => drawn(card, { width }).at(-1) ?? "");
		expect(shown.every((line) => line.includes("ctx 24%"))).toBe(true);
		expect(shown[0]).not.toContain("main");
		expect(shown[0]).not.toContain("ago");
		expect(shown[4]).toContain("~/work/beta");
	});

	it("leaves out what no record tells", () => {
		const bare = drawn(view(status({ mode: null, map: null, step: null, branch: null, usage: null }))).join("\n");
		for (const word of ["skills", "ctx", "5h", "1w", "git ", "task", "next", "lanes", "└"])
			expect(bare).not.toContain(word);
	});

	it.each([
		["READY", STILL[1]?.[1] as HudView, "type lit <task>"],
		["WAITING", WAITING, "type lit <task>"],
		["IDLE", STILL[2]?.[1] as HudView, "start-work"],
		["YOUR TURN", STILL[3]?.[1] as HudView, "start-work"],
		["DONE ✓", STILL[5]?.[1] as HudView, "start-work"],
		["REWIND <<", STILL[6]?.[1] as HudView, "lit-adhd"],
		["REVIEW 2/5", REVIEW, "goal ✓ quality ● security ✗ qa · context ·"],
	])("says %s at the right end of the title", (word, card, also) => {
		const rows = drawn(card);
		expect(rows[0]).toContain(` ${word} ─╮`);
		expect(rows.join("\n")).toContain(also);
	});

	it("puts the cut mark right behind the last whole character, and keeps the cells", () => {
		const said = (width: number): string =>
			cut(words("ab한국", 0), width)
				.map((cell) => cell.text)
				.join("");
		expect([6, 5, 4, 3, 2, 1].map(said)).toEqual(["ab한국", "ab한…", "ab… ", "ab…", "a…", "…"]);
		expect(cut(words("ab한국", 0), 4)).toHaveLength(4);
	});

	it("lights the review lane that the stack names", () => {
		const lanes = REVIEW_LANE_IDS.map((id) => (id === "security" ? "running" : "dim"));
		const card = view(status({ look: "review", mode: "review-work", reviewLanes: lanes }));
		expect(drawn(card).join("\n")).toContain("goal · quality · security ● qa · context ·");
	});

	it("never lets the title and the stage row say different things", () => {
		const modes = ["deep-interview", "lit-plan", "start-work", "review-work", "litresearch", "lit-adhd"];
		const looks = [null, "review", "turn", "done", "rewind"];
		const works = [null, { done: 2, total: 5 }, { done: 5, total: 5 }];
		const pillOf = (line: readonly Cell[]): string =>
			line
				.filter((cell) => cell.bg !== undefined)
				.map((cell) => cell.text)
				.join("")
				.trim();
		for (const mode of modes) {
			for (const look of looks) {
				for (const work of works) {
					for (const working of [false, true]) {
						const map = workflowMapCells(mode, {
							work:
								work === null
									? null
									: { ...work, next: null, status: work.done === 5 ? "completed" : "active" },
							goals: null,
							plan: work === null ? null : "published",
							research: null,
						} as Parameters<typeof workflowMapCells>[1]);
						if (map === null) continue;
						const review = look === "review" ? (["pass", "running", "dim", "dim", "dim"] as const) : null;
						const card = view(
							status({
								mode,
								look,
								map,
								working,
								reviewLanes: review,
								state: look === "done" ? "complete" : "ignited",
							}),
						);
						const rows = compose(card, { width: 120 }).paint(0);
						const [title, stages] = [plain(rows)[0] ?? "", plain(rows)[1] ?? ""];
						const pill = pillOf(rows[1] ?? []);
						if (look === "done") {
							expect(title).toContain(" DONE ✓ ");
							expect(pill).toBe("");
							if (map.family === "main") expect(stages).toContain("done ✓");
							expect(stages).not.toContain("·");
							for (const cell of map.cells)
								if (cell.state === "pending" && cell.key !== "done") expect(stages).toContain(`${cell.word} -`);
							continue;
						}
						expect(stages).not.toContain("done ✓");
						const word = / ([A-Z]+) ● ─╮$/u.exec(title)?.[1];
						if (word !== undefined) expect(pill.toUpperCase().startsWith(word)).toBe(true);
						if (/ REVIEW \d\/5 ─╮$/u.test(title)) expect(pill).toBe("review");
					}
				}
			}
		}
	});

	it("shows work under a paused job in the title, the tree and the skills", () => {
		const stack = {
			breadcrumb: "lit-loop ‖ > lit-brainstorm",
			row: "",
			paused: [{ name: "lit-loop", stage: "GREEN", gauge: "[▉▉░░░] 2/5", note: "" }],
			running: { name: "lit-brainstorm", stage: "interview", gauge: null, note: "" },
		} as unknown as NonNullable<CardStatus["stack"]>;
		const rows = drawn(view(status({ mode: "lit-brainstorm", stack })));
		expect(rows[0]).toContain("· lit-loop || > lit-brainstorm ─");
		expect(rows[2]).toContain("lit-brainstorm · back: lit continue");
		expect(rows[3]).toMatch(/^│ \| lit-loop {5,}GREEN {5}▰▰▱▱▱ 2\/5 paused/u);
		expect(rows[4]).toMatch(/^│ └─ ● lit-brainstorm interview ━━━━━ {5}running/u);
		expect(rows[5]).toContain("skills  lit-brainstorm   lit-loop  ");
	});

	it("shows whole stage names: the current and the next one when all of them do not fit", () => {
		expect(drawn(WORKING, { width: 44 })[1]).toMatch(/^│ {2}work 2\/5 {2}› review +│$/u);
		expect(drawn(STILL[5]?.[1] as HudView, { width: 44 })[1]).toMatch(/^│ done ✓ +│$/u);
		for (let width = 39; width <= 120; width++)
			expect(drawn(LANES, { width })[1]).not.toMatch(/(?:^|[^a-z])(?:int|pla|wor|rev|don)(?:[^a-z]|$)/u);
	});

	it("draws only characters every terminal font has beside the record's own words", () => {
		for (const card of [WORKING, LANES, REVIEW, hostile("x"), ...STILL.map(([, still]) => still)])
			expect(drawn(card).join("")).not.toMatch(/[⎇↳↻⚡‖⠀-⣿]/u);
	});

	it("gives the skill's pill the stage pill's colours and a paused one a dark ground", () => {
		const stack = {
			breadcrumb: "lit-loop > lit-plan",
			row: "",
			paused: [{ name: "lit-loop", stage: "GREEN", gauge: null, note: "" }],
			running: { name: "lit-plan", stage: null, gauge: null, note: "" },
		} as unknown as NonNullable<CardStatus["stack"]>;
		const rows = compose(view(status({ stack }))).paint(0);
		const line = rows.find((cells) => plain([cells])[0]?.includes("skills")) ?? [];
		const grounds = line.map((cell) => cell.bg).filter((bg) => bg !== undefined);
		expect(grounds).toEqual(expect.arrayContaining([0xb48cff, 0x7cf5b0]));
		expect(new Set(grounds).size).toBeGreaterThan(5);
		expect(grounds.at(-1)).toBeLessThan(0x444444);
	});

	it("rounds every corner, in one colour with the rules beside it", () => {
		for (const card of [WORKING, LANES, REVIEW, ...STILL.map(([, still]) => still)]) {
			for (let width = 39; width <= 160; width++) {
				const rows = compose(card, { width }).paint(2.2);
				const [top, bottom] = [rows[0] ?? [], rows.at(-1) ?? []];
				expect([top[0]?.text, top.at(-1)?.text, bottom[0]?.text, bottom.at(-1)?.text].join("")).toBe("╭╮╰╯");
				for (const [line, under] of [
					[top, rows[1] ?? []],
					[bottom, rows.at(-2) ?? []],
				] as const) {
					expect(line[1]?.text).toBe("─");
					expect(line.at(-2)?.text).toBe("─");
					expect(new Set([line[0]?.fg, line[1]?.fg, under[0]?.fg]).size).toBe(1);
					expect(new Set([line.at(-1)?.fg, line.at(-2)?.fg, under.at(-1)?.fg]).size).toBe(1);
				}
			}
		}
	});

	it("keeps the rule under the sun clear of words", () => {
		const usage = { ctx: 24, fiveHour: 22, week: 54 };
		for (let width = 59; width <= 120; width++) {
			const rows = drawn(view(status({ branch: "main", usage })), { width });
			const at = (rows.at(-2) ?? "").indexOf(SUN);
			expect(at).toBeGreaterThan(0);
			expect((rows.at(-1) ?? "").slice(at, at + 18)).toBe("─".repeat(18));
			expect(rows.at(-1)).toContain("1w 54%");
		}
	});

	it("drops the id, then the age, then the folder as the window narrows", () => {
		const card = view(status({ branch: "main", usage: { ctx: 24, fiveHour: 22, week: 54 } }));
		const order = ["019a0000", "5s ago", "beta", "git main"];
		let gone = 0;
		for (let width = 120; width >= 39; width--) {
			const sunny = drawn(card, { width }).at(-1) ?? "";
			const lost = order.filter((part) => !sunny.includes(part));
			// Beside the sun a folder that has no room of its own leaves its place to the age.
			const aged = lost.includes("beta") && !lost.includes("5s ago");
			expect(lost).toEqual((aged ? order.filter((part) => part !== "5s ago") : order).slice(0, lost.length));
			const line = drawn(card, { width, rows: 4 }).at(-1) ?? "";
			const missing = order.filter((part) => !line.includes(part));
			expect(missing).toEqual(order.slice(0, missing.length));
			expect(missing.length).toBeGreaterThanOrEqual(gone);
			gone = missing.length;
		}
		expect(gone).toBe(4);
	});

	it("gives notices a row of their own", () => {
		const rows = drawn(view(status({ restart: "restart to 9.9.9" }), { unreadable: ["live step"] }));
		expect(rows.some((line) => line.includes("✗ cannot read live step"))).toBe(true);
		expect(rows.some((line) => line.includes("! restart to 9.9.9"))).toBe(true);
	});

	it("asks for more of an ambiguous session id", () => {
		expect(drawn(view(null, { wanted: "019a", matches: 2 })).join("\n")).toContain(
			"--session 019a matches 2 sessions",
		);
	});

	it("aligns thread rows in columns and drops the state word before a name", () => {
		const rows = drawn(LANES).filter((line) => /Aquinas|Lagrange|Hume|lit-loop .*GREEN/u.test(line));
		expect(new Set(rows.map((line) => line.indexOf("running"))).size).toBe(1);
		expect(drawn(LANES)[1]).toContain("●●● 3 lanes │");
		const narrow = drawn(LANES, { width: 39 }).join("\n");
		for (const word of ["Aquinas", "Lagrange", "Hume", "2/5", "1/8"]) expect(narrow).toContain(word);
	});

	it("shortens the figures beside a folder that has no room, and keeps the age", () => {
		const usage = { ctx: 24, fiveHour: 22, week: 54 };
		const long = { id: ID, folder: "/Users/me/work/some-long-project-name", lastSeen: NOW - 42_000 };
		for (const branch of [null, "main", "feature/a-long-branch-name"]) {
			for (let width = 76; width <= 120; width++) {
				const line = drawn(view(status({ branch, usage }), { session: long }), { width }).at(-1) ?? "";
				expect(line, `${width} ${branch}`).toContain("42s ago");
			}
		}
		const short = { ...long, folder: "~/work/my-app" };
		expect(drawn(view(status({ usage }), { session: short }), { width: 79 }).at(-1)).toContain("42s ago");
		// A branch with no room leaves its place to the folder.
		const both = drawn(view(status({ branch: "a-branch/name-24-cells-x", usage }), { session: short }), {
			width: 89,
		});
		expect(both.at(-1)).toMatch(/1w 54% · ~\/work\/my-app ─+ 42s ago ─╯$/u);
	});

	it("cuts a long tool's name, and keeps its spinner, its clock and the next task", () => {
		const step = { tool: "my-gateway · search_documents_with_filters_and_facets", startedAt: NOW - 74_000 };
		for (let width = 45; width <= 120; width++) {
			const line = drawn(view(status({ step })), { width })[2] ?? "";
			expect(line, String(width)).toMatch(/[-\\|/] [a-z][^│]* · 1:14 │$/u);
		}
		for (const width of [79, 99]) {
			const line = drawn(view(status({ step })), { width })[2] ?? "";
			expect(line).toContain("next ▸ Write");
			expect(line).toMatch(/- my-gateway · search[^ ]*… · 1:14/u);
		}
		const last = status({
			step: null,
			working: false,
			lastTool: step.tool,
			turnStartedAt: NOW - 9_000,
			turnEndedAt: NOW,
		});
		expect(drawn(view(last), { width: 79 })[2]).toMatch(/last my-gateway · [^│]*… · turn 0:09 │$/u);
	});

	it("ends a tree the window cuts with the last branch and the number left out", () => {
		const ten = Array.from({ length: 10 }, (_, index) => row({ key: `l${index}`, name: `helper ${index + 1}` }));
		const card = view(
			status({ threads: { ...threads(...ten.slice(0, 4)), laneCount: 10, more: 6 } as unknown as ThreadView }),
		);
		let least = 10;
		for (let rows = 30; rows >= 5; rows--) {
			for (const docked of [false, true]) {
				const lines = drawn(card, { rows, docked, width: 79 });
				const tree = lines.filter((line) => /helper \d/u.test(line));
				if (tree.length === 0) continue;
				least = Math.min(least, tree.length);
				expect(tree.at(-1), String(rows)).toContain("└─");
				expect(tree.slice(0, -1).join("")).not.toContain("└─ ●");
				expect(tree.at(-1)).toContain(`+${10 - tree.length} more`);
			}
		}
		expect(least).toBeLessThan(4);
	});

	it("keeps every word at 4.5:1 or better on its ground", () => {
		const light = (color: number): number =>
			[16, 8, 0]
				.map((shift) => ((color >> shift) & 255) / 255)
				.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
				.reduce((sum, c, index) => sum + c * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
		const ratio = (a: number, b: number): number => {
			const [hi, lo] = [Math.max(light(a), light(b)), Math.min(light(a), light(b))];
			return (hi + 0.05) / (lo + 0.05);
		};
		for (const [, card] of [["", WORKING], ["", LANES], ["", REVIEW], ["", hostile("word")], ...STILL] as [
			string,
			HudView,
		][]) {
			for (const caps of [false, true]) {
				for (const line of compose(card, { caps }).paint(0.7)) {
					for (const cell of line) {
						if (!/[\p{L}\p{N}✓✗]/u.test(cell.text) || cell.fg === undefined) continue;
						expect(
							ratio(cell.fg, cell.bg ?? 0x0d1117),
							`${cell.text} ${cell.fg.toString(16)}`,
						).toBeGreaterThanOrEqual(4.5);
					}
				}
			}
		}
	});
});

describe("hud card sunset", () => {
	it("stands in free cells only: words are the same with and without it", () => {
		for (const card of [WORKING, LANES, REVIEW, ...STILL.map(([, still]) => still), ...HOSTILE.map(hostile)]) {
			for (const width of [60, 80, 111, 120]) {
				for (const seconds of [0, 1.7, 9.5]) {
					const said = (rows: number): string =>
						drawn(card, { width, rows }, seconds)
							.map((line) => line.replace(/[^\p{L}\p{N}]/gu, ""))
							.join("");
					expect(said(40)).toBe(said(compose(card, { width, rows: 40 }).paint(0).length));
				}
			}
		}
	});

	it("grows the card for the sun only when the window has the rows", () => {
		const long = view(status({ step: { tool: "x".repeat(60), startedAt: NOW } }));
		const tall = drawn(long, { rows: 30 });
		const low = drawn(long, { rows: tall.length - 1 });
		expect(tall.join("\n")).toContain(SUN);
		expect(low.join("\n")).not.toContain(SUN);
		expect(low.length).toBeLessThan(tall.length);
	});

	it("needs a 60-column window", () => {
		expect(drawn(LANES, { width: 59 }).join("\n")).toContain(SUN);
		expect(drawn(LANES, { width: 58 }).join("\n")).not.toMatch(SCENE_GLYPHS);
	});

	it("keeps the card's height while the tool changes", () => {
		const heights = ["Bash", "x".repeat(60), "한국어".repeat(20)].map(
			(tool) => drawn(view(status({ step: { tool, startedAt: NOW } }))).length,
		);
		expect(new Set(heights).size).toBe(1);
	});
});

describe("hud card motion", () => {
	it("moves by colour and ASCII alone: other glyphs never change", () => {
		for (const card of [WORKING, LANES]) {
			const scene = compose(card);
			expect(scene.moving).toBe(true);
			const frames = Array.from({ length: 120 }, (_, index) => scene.paint(index / 10));
			expect(new Set(frames.map((rows) => rows.map((line) => rowText(line, true)).join("\n"))).size).toBeGreaterThan(
				100,
			);
			const solid = (rows: Cell[][]): string =>
				plain(rows)
					.join("\n")
					.replace(/[~.*+\\|/ -]/gu, " ");
			expect(new Set(frames.map(solid)).size).toBe(1);
		}
	});

	it("sends a shooting star across the sky every nine seconds", () => {
		const sky = drawn(WORKING).length - 4;
		expect(drawn(WORKING, {}, 9.5)[sky]).toContain("*--.");
		expect(drawn(WORKING, {}, 13)[sky]).not.toContain("*--.");
	});

	it.each(STILL)("stands still, with the sun up, while %s", (_name, card) => {
		const scene = compose(card);
		expect(scene.moving).toBe(false);
		expect(plain(scene.paint(0)).join("\n")).toContain(SUN);
		expect(plain(scene.paint(9.5)).join("\n")).not.toContain("*--.");
	});

	it("celebrates completion over the frame and the sky, never over a word", () => {
		const scene = compose(STILL[5]?.[1] as HudView);
		const rest = plain(scene.paint(0))
			.join("")
			.replace(/[~.*+ -]/gu, "");
		for (const burst of [0, 0.2, 0.5, 0.9]) {
			expect(
				plain(scene.paint(0, burst))
					.join("")
					.replace(/[~.*+ -]/gu, ""),
			).toBe(rest);
			expect(scene.paint(0, burst)).not.toEqual(scene.paint(0));
		}
	});

	it("rewrites only the cells that changed, and the right edge by itself", () => {
		const before = [...words("ab", 0x111111), ...words("cdefghij|", 0x222222)];
		const after = [...words("ab", 0x111111), ...words("Xdefghiz!", 0x222222)];
		const out = changedRuns(before, after, 3);
		expect(out).toContain("\u001b[4;3H");
		expect(out).toContain("\u001b[4;11H");
		expect(strip(out.replace(/\u001b\[\d+;\d+H/gu, " "))).toBe(" X z !");
		expect(changedRuns(after, after, 3)).toBe("");
	});
});

describe("hud card pills and gauges", () => {
	const ground = (line: readonly Cell[]): (number | undefined)[] => line.map((cell) => cell.bg);

	it("grades the brand pill from orange to pink and the current stage from violet to mint", () => {
		const rows = compose(WORKING).paint(0);
		expect(ground(rows[0] ?? [])).toEqual(expect.arrayContaining([0xffa033, 0xff3388]));
		expect(ground(rows[1] ?? [])).toEqual(expect.arrayContaining([0xb48cff, 0x7cf5b0]));
	});

	it("ends pills and gauges in caps only where the terminal draws them, at the same width", () => {
		expect(drawn(LANES).join("")).not.toMatch(CAPS);
		expect(drawn(LANES, { caps: true }).join("")).toMatch(CAPS);
		expect(drawn(LANES, { caps: true }).map((line) => displayWidth(line))).toEqual(
			drawn(LANES).map((line) => displayWidth(line)),
		);
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

describe("hud lines in a window too narrow for the card", () => {
	it("keeps every word of every line where it is", () => {
		const words = (text: string): string => text.replace(/[▰▱]|\[[▉░]+\]?/gu, (gauge) => "=".repeat(gauge.length));
		for (const card of [WORKING, WIDE, LANES, WAITING]) {
			for (let width = 10; width < 39; width++) {
				const lines = hudLines(card, NOW);
				const rows = narrowLines(lines, sceneMood(card), { width, caps: false }).map(strip);
				expect(rows).toHaveLength(lines.length);
				lines.forEach((line, index) => {
					// A line may have shorter forms of itself; the first that fits stands whole.
					const form = [line.text, ...(line.short ?? [])].find((text) => displayWidth(text) <= width);
					const said = form ?? line.short?.at(-1) ?? line.text;
					if (index > 0) expect(words(rows[index] ?? "")).toBe(words(fit(clean(said), width)));
					expect(displayWidth(rows[index] ?? "")).toBeLessThanOrEqual(width);
				});
			}
		}
	});
});

describe("what a narrow window says", () => {
	const narrow = (of: HudView, width: number): string[] =>
		narrowLines(hudLines(of, NOW), sceneMood(of), { width, caps: false }).map(strip);

	it("says what to type, whole, while nothing runs", () => {
		for (const card of [WAITING, STILL[1]?.[1] as HudView]) {
			for (const width of [30, 35, 38]) {
				const rows = narrow(card, width);
				expect(rows.join("\n")).toContain("`lit <task>`");
				expect(rows.slice(1).join("")).not.toContain("…");
			}
		}
	});

	it("ticks the last stage of finished work, and leaves out the ones it skipped", () => {
		const finished = workflowMapCells("start-work", {
			work: { done: 5, total: 5, next: null, status: "completed" },
			goals: null,
			plan: "published",
			research: null,
		});
		const card = view(status({ state: "complete", look: "done", step: null, working: false, map: finished }));
		expect(narrow(card, 60)[2]).toBe("✓ interview ── ✓ plan ── ✓ work ── ✓ done");
		// Work with a task left keeps its place, whatever the turn says.
		const open = STILL[5]?.[1] as HudView;
		expect(narrow(open, 60)[2]).toContain("● work 2/5 ── ○ review");
	});
});

describe("one form at a time in a window too narrow for the card", () => {
	for (const caps of [false, true]) {
		it(`draws every gauge and pill ${caps ? "round" : "square"}`, () => {
			for (const card of [WORKING, WIDE, LANES, WAITING]) {
				for (let width = 10; width < 39; width++) {
					const text = narrowLines(hudLines(card, NOW), sceneMood(card), { width, caps }).join("\n");
					expect(strip(text)).not.toMatch(/\[[▉░]/u);
					if (caps) {
						expect(strip(text)).not.toMatch(/[▰▱▉░]/u);
						expect((strip(text).match(/\ue0b6/gu) ?? []).length).toBe(
							(strip(text).match(/\ue0b4/gu) ?? []).length,
						);
					} else expect(text).not.toMatch(CAPS);
				}
			}
		});
	}

	it("follows the same answer as the card", () => {
		const { env } = session();
		const narrow = (glyphs: object): string => {
			const { writes, out, loop } = harness({ ...env, ...glyphs });
			out.columns = 39;
			loop.tick();
			return writes.join("");
		};
		expect(narrow({ LITCODEX_HUD_GLYPHS: "auto", TERM_PROGRAM: "ghostty" })).toMatch(CAPS);
		expect(narrow({ LITCODEX_HUD_GLYPHS: "auto", TERM_PROGRAM: "WezTerm" })).toMatch(CAPS);
		expect(narrow({ LITCODEX_HUD_GLYPHS: "basic", WT_SESSION: "1" })).not.toMatch(CAPS);
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

function harness(env: NodeJS.ProcessEnv) {
	const writes: string[] = [];
	const clock = { now: NOW };
	const out = { write: (text: string) => writes.push(text), isTTY: true, columns: 111, rows: 30 };
	const loop = createHudLoop({
		env: { LITCODEX_HUD_GLYPHS: "basic", ...env },
		wanted: null,
		out,
		color: true,
		truecolor: true,
		scene: true,
		now: () => clock.now,
	});
	return { writes, clock, out, loop };
}

describe("hud scene loop", () => {
	it("clears what an earlier frame left between a row's words and its right edge", () => {
		const { env } = session();
		const { writes, loop } = harness(env);
		loop.tick();
		const rows = (writes[0] ?? "").split("\n");
		expect(rows.length).toBeGreaterThan(4);
		for (const line of rows) expect(line).toMatch(/\u001b\[K\u001b\[110G/u);
	});

	it("draws the card, and the plain lines in a window under 40 columns", () => {
		const { env } = session();
		const { writes, out, loop } = harness(env);
		loop.tick();
		expect(strip(writes[0] ?? "")).toContain("╭─");
		out.columns = 39;
		loop.tick();
		expect(writes[1]?.startsWith("\u001b[H")).toBe(true);
		expect(strip(writes[1] ?? "")).not.toContain("╭");
		expect(strip(writes[1] ?? "")).toContain("working");
	});

	it("keeps the first lines in a window lower than they are, and rewrites only what changed", () => {
		const { env } = session();
		const { writes, clock, out, loop } = harness(env);
		out.columns = 39;
		out.rows = 3;
		loop.tick();
		expect((writes[0] ?? "").split("\n")).toHaveLength(3);
		expect(strip(writes[0] ?? "")).toContain("LIT");
		clock.now += 1_000;
		loop.tick();
		expect(writes.slice(1).join("")).not.toContain("\n");
		out.rows = 30;
		loop.tick();
		expect(strip(writes.at(-1) ?? "")).toContain("Running: Bash, 0:01");
	});

	it("draws round caps where they are asked for", () => {
		const { env } = session();
		const square = harness(env);
		square.loop.tick();
		expect(square.writes.join("")).not.toMatch(CAPS);
		const round = harness({ ...env, LITCODEX_HUD_GLYPHS: "nerd" });
		round.loop.tick();
		expect(round.writes.join("")).toMatch(CAPS);
	});

	it("places the right edge of every row by column", () => {
		const { env } = session();
		const { writes, loop } = harness(env);
		loop.tick();
		for (const line of (writes[0] ?? "").split("\n")) expect(line).toContain("\u001b[110G");
	});

	function rollout(env: NodeJS.ProcessEnv, used: number): void {
		const day = new Date(NOW);
		const folder = join(
			env["CODEX_HOME"] as string,
			"sessions",
			String(day.getFullYear()),
			String(day.getMonth() + 1).padStart(2, "0"),
			String(day.getDate()).padStart(2, "0"),
		);
		mkdirSync(folder, { recursive: true });
		const info = { last_token_usage: { input_tokens: used * 1_000 }, model_context_window: 100_000 };
		writeFileSync(
			join(folder, `rollout-x-${ID}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { id: ID, cwd: "/work/beta" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info } })}\n`,
		);
	}

	it("reads the usage figures at most once in five seconds", () => {
		const { env } = session();
		rollout(env, 24);
		const { writes, clock, loop } = harness(env);
		loop.tick();
		expect(strip(writes.join(""))).toContain("ctx 24%");
		rollout(env, 375);
		rollout(env, 37);
		for (let index = 0; index < 4; index++) {
			clock.now += 1_000;
			loop.tick();
		}
		const text = (): string => strip(writes.join("").replace(/\u001b\[\d+;\d+H/gu, " "));
		expect(text()).not.toContain("37");
		clock.now += 1_100;
		loop.tick();
		expect(text()).toContain("37");
	});

	it("reads a rollout again only when its lstat changed", () => {
		const { env } = session();
		rollout(env, 24);
		let reads = 0;
		const usage = createUsageReader(env, () => {
			reads++;
			return { ctx: reads, fiveHour: null, week: null };
		});
		expect(usage(ID, NOW)?.ctx).toBe(1);
		expect(usage(ID, NOW + 6_000)?.ctx).toBe(1);
		rollout(env, 375);
		expect(usage(ID, NOW + 7_000)?.ctx).toBe(1);
		expect(usage(ID, NOW + 12_000)?.ctx).toBe(2);
		expect(usage("019a0000-aaaa-7000-8000-00000000000b", NOW + 12_000)?.ctx).toBe(3);
	});

	it("writes no file", () => {
		const { env } = session();
		rollout(env, 24);
		const tree = (): string[] =>
			readdirSync(env["HOME"] as string, { recursive: true })
				.map(String)
				.sort()
				.map((name) => `${name} ${statSync(join(env["HOME"] as string, name)).mtimeMs}`);
		const before = tree();
		const { clock, loop } = harness(env);
		for (let index = 0; index < 12; index++) {
			clock.now += 1_000;
			loop.tick();
			loop.frame();
		}
		expect(tree()).toEqual(before);
	});

	it("redraws between ticks only the cells that changed, and reads no record for it", () => {
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
		expect(writes[1]).not.toContain("working");
		expect((writes[1] ?? "").length).toBeLessThan((writes[0] ?? "").length / 2);
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

	it.each([
		["says so", undefined, "DONE"],
		["asks something", "question", "YOUR TURN"],
	])("celebrates a completion that %s for two seconds, then stands still", (_name, reason, label) => {
		const { env, cwd } = session();
		const planDir = join(cwd, ".litcodex", "plans");
		mkdirSync(planDir, { recursive: true });
		mkdirSync(join(cwd, ".litcodex", "start-work"), { recursive: true });
		const plan = join(planDir, "form.md");
		const state = (done: boolean): void => {
			writeFileSync(plan, `# Plan\n\n## TODOs\n- [x] 1. Model\n- [${done ? "x" : " "}] 2. Parser\n`);
			writeFileSync(
				join(cwd, ".litcodex", "start-work", "state.json"),
				JSON.stringify({
					schema_version: 2,
					active_work_id: done ? null : "w",
					works: {
						w: {
							work_id: "w",
							status: done ? "completed" : "active",
							active_plan: plan,
							session_ids: [`codex:${ID}`],
						},
					},
				}),
			);
		};
		recordWorkflowTurn(cwd, ID, "turn-2", "start-work", NOW);
		state(false);
		const { writes, clock, loop } = harness(env);
		loop.tick();
		clock.now += 1_000;
		state(true);
		endLiveStep(cwd, ID, clock.now, true, reason);
		loop.tick();
		expect(strip(writes.join("").replace(/\u001b\[\d+;\d+H/gu, " "))).toContain(label);
		expect(loop.moving()).toBe(true);
		let last = 0;
		for (let index = 1; index <= 40; index++) {
			clock.now += 100;
			if (loop.frame()) last = index;
		}
		expect(last).toBeGreaterThan(10);
		expect(last).toBeLessThanOrEqual(21);
		expect(loop.moving()).toBe(false);
		// The turn after it is no second completion.
		recordTurnStart(cwd, ID, clock.now);
		clock.now += 1_000;
		endLiveStep(cwd, ID, clock.now, true);
		loop.tick();
		expect(loop.moving()).toBe(false);
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
		expect(writes.join("")).not.toMatch(/[╭╰]/u);
	});
});
