import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CardStatus, cardStatusText, limitLabel, readCardStatus } from "./card-status.js";
import { loopObjective, stopNote } from "./hook-cli.js";
import { listSessions, readHud } from "./hud.js";
import { composeCard } from "./hud-card.js";
import { endLiveStep, recordTurnStart, writeThreadPointer } from "./live-step.js";
import { recordLiveness } from "./session-liveness.js";
import { type ThreadRow, type ThreadView, threadLines } from "./threads.js";
import { recordWorkflowTurn, type WorkflowMap, workflowMapText } from "./workflow-map.js";
import { recordStackEvent } from "./workflow-stack.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function temp(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-plain-")));
	roots.push(root);
	return root;
}

const ID = "019a0000-bbbb-7000-8000-000000000002";
const MAP: WorkflowMap = {
	family: "main",
	next: "Write the docs",
	cells: [
		{ key: "interview", icon: "🧭", word: "interview", state: "done", label: null, progress: null },
		{ key: "work", icon: "🔨", word: "work", state: "current", label: "WORK", progress: { done: 3, total: 7 } },
		{ key: "review", icon: "🔍", word: "review", state: "pending", label: null, progress: null },
	],
};

describe("the stage path in words", () => {
	it("names every stage and marks done, now and later", () => {
		expect(workflowMapText(MAP)).toBe("✓ interview ── ● work 3/7 ── ○ review");
	});

	it("says paused, half-done and counted stages in words", () => {
		const cells = [
			{ key: "plan", icon: "📋", word: "plan", state: "partial", label: null, progress: { done: 1, total: 4 } },
			{ key: "wave", icon: "🌊", word: "wave", state: "done", label: "2 waves", progress: null },
			{ key: "work", icon: "🔨", word: "work", state: "current", label: "PAUSED", progress: { done: 3, total: 7 } },
		] as const;
		expect(workflowMapText({ family: "main", next: null, cells })).toBe(
			"◐ plan 1/4 ── ✓ 2 waves ── ● work paused 3/7",
		);
	});
});

function frame(name: string, over: Partial<ThreadRow> = {}): ThreadRow {
	return {
		key: name,
		kind: "frame",
		name,
		stage: "work",
		gauge: null,
		note: "",
		state: "running",
		active: false,
		...over,
	};
}
const VIEW: ThreadView = { chain: [], lanes: [], others: [], laneCount: 0, more: 0, back: false };

describe("threads as sentences", () => {
	it("says nothing about the one running skill, which the map already names", () => {
		expect(threadLines({ ...VIEW, chain: [frame("lit-loop", { active: true })] })).toEqual([]);
	});

	it("names another session without a pane or session id", () => {
		const other = frame("lit-loop", { kind: "session", state: "idle", session: "01a2114d" });
		expect(threadLines({ ...VIEW, others: [other] })).toEqual([
			"Also open in this project: lit-loop (work), waiting for you",
		]);
	});

	it("says what is paused, how to go back, and who helps", () => {
		const view: ThreadView = {
			...VIEW,
			chain: [
				frame("lit-loop", { state: "paused", gauge: "[▉▉░░] 2/4" }),
				frame("lit-brainstorm", { stage: "interview", note: "step 2", active: true }),
			],
			lanes: [
				frame("Aquinas", { kind: "lane", stage: null, gauge: "[▉▉░░░] 2/5" }),
				frame("Hume", { kind: "lane", stage: null, note: "starting" }),
				frame("Kant", { kind: "lane", stage: null, note: "3 steps", state: "idle" }),
			],
			laneCount: 5,
			more: 2,
			back: true,
		};
		expect(threadLines(view)).toEqual([
			"Now: lit-brainstorm (interview, step 2)",
			"Paused: lit-loop (work, 2/4) · type `lit continue` to go back",
			"5 helpers: Aquinas 2/5, Hume starting, Kant 3 steps (quiet), 2 more",
		]);
	});
});

describe("the card text", () => {
	const status = (over: Partial<CardStatus>): CardStatus => ({
		version: 1,
		thread: ID,
		state: "ignited",
		mode: "lit-loop",
		look: null,
		ignitedAt: 1,
		map: MAP,
		step: null,
		lastStepAt: null,
		lastTool: null,
		turnStartedAt: 1,
		turnEndedAt: null,
		working: true,
		usage: null,
		stack: null,
		threads: null,
		reviewLanes: null,
		branch: null,
		workspace: null,
		cardOpenedAt: null,
		restart: null,
		now: 60_000,
		...over,
	});

	it("says the state in plain words", () => {
		expect(cardStatusText(status({ step: { tool: "Bash", startedAt: 46_000 } })).split("\n")).toEqual([
			"🔥 LIT · lit-loop · working",
			"✓ interview ── ● work 3/7 ── ○ review",
			"Next: Write the docs",
			"Running: Bash, 0:14",
		]);
		expect(cardStatusText(status({ working: false, look: "turn" }))).toContain("lit-loop · your turn");
		expect(cardStatusText(status({ working: false, state: "complete" }))).toContain("lit-loop · done ✓");
		expect(cardStatusText(status({ working: false }))).toContain("lit-loop · waiting for your next message");
	});
});

describe("a turn that ends with a question", () => {
	it("is the user's turn, not done, and nothing reads as running", () => {
		const root = temp();
		const env = { HOME: root, CODEX_HOME: join(root, ".codex") };
		const cwd = join(root, "p");
		mkdirSync(cwd);
		const now = 1_000_000;
		writeThreadPointer(env, ID, cwd, now);
		recordWorkflowTurn(cwd, ID, "t1", "lit-loop", now);
		recordTurnStart(cwd, ID, now);
		recordStackEvent(cwd, ID, { type: "start", skill: "lit-loop" }, new Date(now));
		recordStackEvent(
			cwd,
			"019a0000-cccc-7000-8000-000000000003",
			{ type: "start", skill: "lit-loop" },
			new Date(now),
		);
		recordLiveness(cwd, "019a0000-cccc-7000-8000-000000000003", "idle", now);
		endLiveStep(cwd, ID, now + 1_000, true, "question");
		const status = readCardStatus(ID, env, now + 2_000, { rollout: false });
		expect(status).toMatchObject({ state: "ignited", look: "turn", working: false });
		expect(status.threads?.chain.some((row) => row.state === "running")).toBe(false);
	});
});

describe("a Codex home whose litcodex folder is a link", () => {
	it("is read and written when the link leads to a folder of the same user", () => {
		const root = temp();
		mkdirSync(join(root, ".codex", "litcodex"), { recursive: true });
		mkdirSync(join(root, ".codex2"));
		symlinkSync(join(root, ".codex", "litcodex"), join(root, ".codex2", "litcodex"), "dir");
		const env = { HOME: root, CODEX_HOME: join(root, ".codex2") };
		writeThreadPointer(env, ID, root, 5);
		expect(listSessions(env).map((session) => session.id)).toEqual([ID]);
		expect(readHud(env, null, 6).unreadable).toEqual([]);
	});

	it("still refuses a link to a file, and a link further down", () => {
		const root = temp();
		mkdirSync(join(root, "a"));
		writeFileSync(join(root, "file"), "x");
		symlinkSync(join(root, "file"), join(root, "a", "litcodex"));
		writeThreadPointer({ CODEX_HOME: join(root, "a") }, ID, root, 5);
		expect(listSessions({ CODEX_HOME: join(root, "a") })).toEqual([]);
		mkdirSync(join(root, "b", "litcodex"), { recursive: true });
		mkdirSync(join(root, "elsewhere"));
		symlinkSync(join(root, "elsewhere"), join(root, "b", "litcodex", "lit-loop"), "dir");
		writeThreadPointer({ CODEX_HOME: join(root, "b") }, ID, root, 5);
		expect(listSessions({ CODEX_HOME: join(root, "b") })).toEqual([]);
	});
});

describe("usage limits", () => {
	it("are named by their own window", () => {
		expect(limitLabel(300)).toBe("5h");
		expect(limitLabel(10_080)).toBe("1w");
		expect(limitLabel(43_200)).toBe("1mo");
		expect(limitLabel(4_320)).toBe("3d");
	});
});

describe("the goal question", () => {
	it("is not asked for a greeting", () => {
		for (const prompt of ["Hi lit", "hi lit!", "hello, lit", "안녕 lit", "lit hey", "thanks lit", "lit 안녕하세요~"])
			expect(loopObjective(prompt), prompt).toBe("");
		expect(loopObjective("lit fix the retry bug")).toBe("fix the retry bug");
		expect(loopObjective("hi, fix the login button lit")).toBe("hi, fix the login button");
	});
});

describe("the Stop note", () => {
	it("tells the user it is their turn", () => {
		expect(stopNote("✨ turn done", "question")).toBe("your turn · answer the question above");
		expect(stopNote("✨ turn done · 2 tasks ✓", "question")).toBe(
			"your turn · answer the question above · 2 tasks done",
		);
		expect(stopNote("✨ turn done", "blocked")).toBe("blocked · needs your help above");
		expect(stopNote("✨ turn done · 2 tasks ✓ · next ▸ Docs", null)).toBe("turn done · 2 tasks done · next: Docs");
	});
});

describe("a card told to fill its rows", () => {
	it("is exactly that tall and keeps its sun", () => {
		const view = { wanted: null, session: { id: ID, folder: "~/p", lastSeen: 0 }, status: null, unreadable: [] };
		const card = composeCard(view, { width: 100, rows: 7, caps: false, now: 1, docked: true });
		expect(card.paint(0)).toHaveLength(7);
		expect(
			card
				.paint(0)
				.flat()
				.some((cell) => cell.text === "▆" || cell.text === "▇"),
		).toBe(true);
	});
});
