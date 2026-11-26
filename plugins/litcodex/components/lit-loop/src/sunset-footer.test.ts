// The sunset footer as Codex reads it: its size, its words, and the limits Codex sets.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleCardMessage } from "./card-mcp.js";
import type { CardStatus } from "./card-status.js";
import { displayWidth } from "./hud.js";
import { endLiveStep, recordTurnStart, writeThreadPointer } from "./live-step.js";
import {
	countNodes,
	FOOTER_STATE_KEY,
	FOOTER_TOOL,
	FOOTER_URI,
	footerTree,
	readFooter,
	type UiNode,
} from "./sunset-footer.js";
import { readSunsetRecord, SUNSET_HINT, takeSunsetHint, writeSunsetRecord } from "./sunset-settings.js";
import { recordWorkflowTurn, type WorkflowSignals, workflowMapCells } from "./workflow-map.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function dir(): string {
	const root = mkdtempSync(join(tmpdir(), "litcodex-sunset-"));
	roots.push(root);
	return root;
}

const snapshot = (
	agent = "working",
	items: readonly string[] = ["model-with-reasoning", "five-hour-limit", "weekly-limit", "context-remaining"],
) => ({
	account: {
		rate_limits: [
			{
				limit_id: "codex",
				limit_name: null,
				primary_limit: { used_percent: 22, window_minutes: 300, resets_at: null },
				secondary_limit: { used_percent: 54, window_minutes: 10080, resets_at: null },
			},
		],
	},
	app: { cli_version: "0.172.0", display_mode: "standard" },
	config: { statusline_items: items },
	thread: {
		id: "t1",
		name: null,
		agent: { state: agent },
		model: { display_name: "gpt-6", reasoning_level: "high", provider: "openai" },
		workspace: { cwd: "/work/shop" },
		usage: { context: { used_percentage: 18 } },
	},
});

const status = (over: Partial<CardStatus> = {}): CardStatus => ({
	version: 1,
	thread: "t1",
	state: "ignited",
	mode: "lit-loop",
	look: null,
	ignitedAt: 1,
	map: null,
	step: null,
	lastStepAt: null,
	lastTool: null,
	turnStartedAt: 1,
	turnEndedAt: null,
	working: true,
	usage: null,
	branch: "main",
	workspace: "shop",
	cardOpenedAt: null,
	now: 10_000,
	...over,
});

const draw = (
	state: unknown,
	size: { columns: number; rows: number } | null = { columns: 110, rows: 40 },
	card: CardStatus | null = status(),
	now = 1_000,
) => footerTree(state, { now, size, caps: false, status: card });

/** The words as a reader sees them: the joiners of an uncut line take no cell and Codex drops them. */
function text(node: UiNode): string {
	return raw(node).replaceAll("\u2060", "");
}
function raw(node: UiNode): string {
	return typeof node === "string" ? node : node.children.map(raw).join("");
}
function lines(node: UiNode): string[] {
	if (typeof node === "string" || node.type !== "row" || node.props.wrap !== "wrap") return [text(node)];
	return node.children.map(text);
}
function colors(node: UiNode): string[] {
	if (typeof node === "string") return [];
	const own = node.type === "text" ? node.props?.color : node.props.background;
	return [...(own === undefined ? [] : [own]), ...node.children.flatMap(colors)];
}

describe("the sunset footer's shape", () => {
	it("is three rows as wide as the terminal less Codex's margin, with the sun beside the words", () => {
		for (const columns of [64, 80, 100, 110, 114, 200]) {
			const rows = lines(draw(snapshot(), { columns, rows: 40 }));
			expect(rows).toHaveLength(3);
			for (const row of rows) expect(displayWidth(row)).toBe(Math.min(110, columns - 4));
			expect(rows[0]).toContain("▁▃▅▆▇████▇▆▅▃▁");
			expect(rows[2]).toMatch(/▆{18}/u);
		}
	});

	it("stays under Codex's 256 nodes at every width and moment", () => {
		for (let columns = 30; columns <= 200; columns += 7)
			for (let now = 0; now < 60_000; now += 1_700) {
				const tree = draw(snapshot(), { columns, rows: 40 }, status(), now);
				expect(countNodes(tree)).toBeLessThan(256);
				expect(JSON.stringify(tree).length).toBeLessThan(64 * 1024);
			}
	});

	it("is one line in a narrow or low terminal, and fits it", () => {
		for (const [columns, rows] of [
			[50, 40],
			[24, 40],
			[12, 10],
			[110, 20],
		] as const) {
			const drawn = lines(draw(snapshot(), { columns, rows }));
			expect(drawn).toHaveLength(1);
			expect(displayWidth(drawn[0] ?? "")).toBeLessThanOrEqual(Math.max(10, columns - 4));
		}
	});

	it("puts the sun first where no terminal says how wide it is, so any cut keeps the sun", () => {
		const drawn = lines(draw(snapshot(), null));
		expect(drawn).toHaveLength(3);
		for (const line of drawn) {
			expect(/[▁▃▅▆▇█]/u.test(line.slice(0, 24))).toBe(true);
			expect(/[▁▃▅▆▇█]/u.test(line.slice(24))).toBe(false);
			expect(line.slice(24)).not.toContain("-");
		}
		expect(drawn[0]?.slice(24)).toContain("lit-loop".replace("-", "\u2011"));
		expect(countNodes(draw(snapshot(), null))).toBeLessThan(256);
	});

	it("gives Codex no place to break a word where the line may be cut, and spells the folder as it is", () => {
		const items = ["model-with-reasoning", "project-name", "current-dir"];
		for (const folder of ["한글폴더연구자료", "👍🏽❤️🇰🇷", "a/b", "หน้า"]) {
			const state = snapshot("ready", items);
			const cwd = folder.includes("/") ? `/w/${folder}` : `/w/${folder.normalize("NFD")}`;
			const named = { ...state, thread: { ...state.thread, workspace: { cwd } } };
			const tree = draw(named, null, null);
			const name = (folder.split("/").at(-1) ?? "").normalize("NFC");
			const unbroken = Array.from(new Intl.Segmenter().segment(name), (part) => part.segment).join("\u2060");
			expect(raw(tree).split(unbroken)).toHaveLength(4);
			expect(text(tree)).toContain(name);
			expect(raw(draw(named, undefined, null))).not.toContain("\u2060");
			expect(countNodes(tree)).toBeLessThan(256);
		}
		const path = draw({ ...snapshot(), thread: { ...snapshot().thread, workspace: { cwd: "/w/a/b" } } }, null, null);
		expect(raw(path)).not.toMatch(/[^\u2060]\/[^\u2060]/u);
	});

	it("starts the path at the stage at work where the line may be cut", () => {
		const stage = (word: string, state: "done" | "current" | "pending") => ({
			key: word,
			icon: "",
			word,
			state,
			label: state === "current" ? word.toUpperCase() : null,
			progress: null,
		});
		const map = {
			family: "main" as const,
			next: null,
			cells: [
				stage("interview", "done"),
				stage("plan", "done"),
				stage("work", "current"),
				stage("review", "pending"),
			],
		};
		expect(lines(draw(snapshot(), null, status({ map })))[1]?.slice(22)).toMatch(/^●\swork\s──\s○\sreview/u);
		expect(lines(draw(snapshot(), { columns: 110, rows: 40 }, status({ map })))[1]).toMatch(/^✓\sinterview/u);
	});

	it("uses no plain space, which Codex drops at an element's edge, and only colours Codex knows", () => {
		const tree = draw(snapshot());
		expect(text(tree)).not.toContain(" ");
		for (const color of colors(tree))
			expect(color).toMatch(/^(?:#[0-9A-F]{6}|primary|accent|yellow|green|status-[a-z]+)$/u);
	});
});

const tasks = (done: number, total: number, state: "active" | "paused" | "completed" = "active") => {
	const signals: WorkflowSignals = {
		work: { done, total, next: null, status: state },
		goals: null,
		plan: "published",
		research: null,
	};
	return workflowMapCells("start-work", signals);
};
const at = (columns: number, rows = 40) => ({ columns, rows });
const sky = /[▁▃▅▆▇█]/u;

describe("a path wider than its line", () => {
	const second = (columns: number, card: Partial<CardStatus>) =>
		(lines(draw(snapshot(), at(columns), status(card)))[1] ?? "").replaceAll("\u00a0", " ");

	it("starts at the stage at work, with its whole count", () => {
		for (let columns = 64; columns <= 80; columns++) {
			expect(second(columns, { map: tasks(118, 240) }), String(columns)).toMatch(/^● work 118\/240 ── ○ rev/u);
			expect(second(columns, { map: tasks(118, 240, "paused") })).toMatch(/^● work paused 118\/240 /u);
			expect(
				second(columns, {
					map: workflowMapCells("review-work", {
						work: { done: 5, total: 5, next: null, status: "completed" },
						goals: null,
						plan: "published",
						research: null,
					}),
				}),
			).toMatch(/^● review/u);
		}
		expect(second(110, { map: tasks(118, 240) })).toMatch(
			/^✓ interview ── ✓ plan ── ● work 118\/240 ── ○ review ── ○ done/u,
		);
	});

	it("ticks no stage over one left open once the work is done", () => {
		const card = { map: tasks(5, 5, "completed"), state: "complete", look: "done", working: false } as const;
		expect(second(110, card)).toMatch(/^✓ interview ── ✓ plan ── ✓ work ── ✓ done /u);
	});
});

describe("the items of a thread before its first turn", () => {
	const items = ["git-branch", "context-remaining", "context-used", "thread-title", "approval-mode"];
	const fresh = () => {
		const state = snapshot("ready", items);
		return { ...state, thread: { ...state.thread, usage: {}, approval: { policy: "on-request" } } };
	};
	const said = (branch: string | null, size: { columns: number; rows: number } | null = at(114)) =>
		lines(footerTree(fresh(), { now: 1_000, size, caps: false, status: null, branch })).map((line) =>
			line.replaceAll("\u00a0", " "),
		);

	it("are the ones Codex itself would show", () => {
		const rows = said("기능/한글-#12");
		expect(rows[1]).toMatch(/^shop · 기능\/한글-#12 /u);
		expect(rows.join("\n").replaceAll("\u2060", "")).toContain(
			"기능/한글-#12  ctx 100%  context 0% used  t1  Ask for approval",
		);
		const named = { ...fresh(), thread: { ...fresh().thread, name: "한글 이름" } };
		expect(text(draw(named, at(114), null))).toContain("한글\u00a0이름");
	});

	it("read the branch from the thread's folder", () => {
		const cwd = dir();
		mkdirSync(join(cwd, ".git"));
		writeFileSync(join(cwd, ".git/HEAD"), "ref: refs/heads/fix/#42\n");
		const state = { ...fresh(), thread: { ...fresh().thread, workspace: { cwd } } };
		const tree = readFooter({ _meta: { [FOOTER_STATE_KEY]: state } }, { HOME: dir(), CODEX_HOME: dir() }, 4_000);
		expect(text(tree)).toContain("fix/#42");
	});

	it("come second where no terminal says how low it is, so a low one keeps them", () => {
		const rows = said("main", null).map((line) => line.slice(22));
		expect(rows[1]).toContain("ctx 100%");
		expect(rows[2]).toMatch(/^shop · main/u);
		const lit = lines(draw(snapshot(), null, status({ map: tasks(2, 5) })));
		expect(lit[1]?.slice(22)).toMatch(/^●\swork/u);
		expect(lit[2]).toContain("gpt");
	});
});

describe("what gives way on a short line", () => {
	const plain = (...args: Parameters<typeof draw>) =>
		lines(draw(...args)).map((line) => line.replaceAll("\u00a0", " "));
	const step = { tool: "my-gateway · search_documents_with_filters", startedAt: -633_000 };

	it("ends a line of unknown width at its last word or sky cell", () => {
		for (const card of [null, status(), status({ map: tasks(2, 5) })])
			for (let now = 0; now < 20_000; now += 1_300)
				for (const line of plain(snapshot(), null, card, now)) expect(line).toBe(line.trimEnd());
	});

	it("cuts the tool's name and keeps its whole clock, or leaves the step out", () => {
		for (let columns = 24; columns <= 120; columns++) {
			const first = plain(snapshot(), at(columns), status({ step }))[0] ?? "";
			const words = first.split(sky)[0] ?? "";
			if (words.includes(" · ")) expect(words, String(columns)).toMatch(/working · \S.* 10:43(?: |$)/u);
			else expect(words).not.toContain("10:");
		}
		expect(plain(snapshot(), at(110), status({ step }))[0]).toMatch(/working · my-gateway · search\S*… 10:43/u);
		expect(plain(snapshot(), at(64), status({ step: { tool: "Bash", startedAt: 4_000 } }))[0]).not.toMatch(
			/Bash 0(?!:06)/u,
		);
		expect(plain(snapshot(), null, status({ step }))[0]?.trimEnd()).toMatch(/… 10:43/u);
	});

	it("keeps the context figure of a one-line footer while a tool runs", () => {
		const state = snapshot("working", ["model-with-reasoning", "context-remaining", "project-name"]);
		for (const tool of ["Bash", step.tool])
			for (let columns = 40; columns <= 63; columns++) {
				const idle = plain(state, at(columns), status())[0] ?? "";
				const busy = plain(state, at(columns), status({ step: { tool, startedAt: 4_000 } }))[0] ?? "";
				if (idle.includes("ctx 82%")) expect(busy, String(columns)).toContain("ctx 82%");
				expect(displayWidth(busy)).toBeLessThanOrEqual(columns - 4);
			}
	});

	it("shows the context before the model while work runs and only one of them fits", () => {
		const state = snapshot("working", ["model", "context-remaining", "project-name"]);
		for (let columns = 39; columns <= 63; columns++) {
			const busy = plain(state, at(columns), status())[0] ?? "";
			if (/gpt-6|shop/u.test(busy)) expect(busy, String(columns)).toMatch(/ctx 82%|context 82% left/u);
		}
		expect(plain(state, at(40), status())[0]).toContain("ctx 82%");
	});

	it("cuts a first item that is too long to half the room, and keeps the next one", () => {
		const state = snapshot("ready", ["model", "project-name"]);
		const long = { ...state, thread: { ...state.thread, model: { display_name: "local-lab-".repeat(6) } } };
		expect(plain(long, at(80))[2]).toMatch(/^local-lab-local-lab\S*… {2}shop /u);
	});

	it("keeps the sun in line beside a name of flags and skin tones", () => {
		const state = snapshot("ready");
		const named = { ...state, thread: { ...state.thread, workspace: { cwd: "/w/🇰🇷-👍🏽-app" } } };
		for (const line of lines(draw(named, at(100), null))) expect(displayWidth(line)).toBe(96);
	});

	it("stays at 256 nodes with every long thing at once", () => {
		const state = snapshot("working", [
			"model",
			"git-branch",
			"project-name",
			"thread-title",
			"context-remaining",
			"approval-mode",
		]);
		const full = {
			...state,
			thread: { ...state.thread, name: "한글 ".repeat(40), workspace: { cwd: `/w/${"긴이름".repeat(30)}` } },
		};
		for (const size of [null, ...[30, 52, 64, 80, 110, 200].map((columns) => at(columns))])
			for (let now = 0; now < 30_000; now += 1_100)
				for (const card of [
					status({ step, map: tasks(118, 240), branch: "기능/한글-#12@a+b" }),
					status({ state: "ready", mode: null, branch: "기능/한글-#12@a+b" }),
				])
					expect(countNodes(draw(full, size, card, now))).toBeLessThanOrEqual(256);
	});
});

describe("what the footer says", () => {
	const said = (...args: Parameters<typeof draw>) => text(draw(...args)).replaceAll(" ", " ");

	it("names the LIT skill and what Codex does", () => {
		expect(said(snapshot("working"))).toContain("LIT  lit-loop working");
		expect(said(snapshot("waiting"))).toContain("lit-loop your turn");
		expect(said(snapshot("ready"), undefined, status({ look: "turn" }))).toContain("lit-loop your turn");
		expect(said(snapshot("ready"), undefined, status({ state: "complete" }))).toContain("lit-loop done ✓");
		expect(said(snapshot("working"), undefined, status({ step: { tool: "Bash", startedAt: 4_000 } }))).toContain(
			"working · Bash 0:06",
		);
	});

	it("shows the folder and branch while no LIT skill runs", () => {
		expect(said(snapshot("ready"), undefined, status({ state: "ready", mode: null }))).toMatch(
			/LIT {2}ready .*shop · main/u,
		);
		expect(said(snapshot("ready"), undefined, null)).toContain("shop");
	});

	it("keeps the user's own status line items, in short words when the full ones do not fit", () => {
		expect(said(snapshot())).toContain("gpt-6 high · 5h 78% left · 1w 46% left · context 82% left");
		expect(said(snapshot(), { columns: 80, rows: 40 })).toContain("gpt-6 high  5h 78%  1w 46%  ctx 82%");
		expect(said(snapshot("ready", ["context-used", "model"]))).toContain("context 18% used · gpt-6");
	});

	it("moves only while Codex works", () => {
		const at = (agent: string, now: number) => JSON.stringify(draw(snapshot(agent), undefined, status(), now));
		expect(at("working", 1_000)).not.toBe(at("working", 2_000));
		expect(at("ready", 1_000)).toBe(at("ready", 2_000));
	});

	it("keeps terminal controls out of the words", () => {
		const state = snapshot();
		const tree = draw(
			{ ...state, thread: { ...state.thread, workspace: { cwd: "/w/\u001b[31mred\u0007" } } },
			undefined,
			null,
		);
		expect(text(tree)).not.toMatch(/[\u0000-\u001f\u007f]/u);
	});

	it.each([
		[undefined],
		[null],
		[7],
		[{}],
		[{ thread: [] }],
		[{ account: { rate_limits: [null] }, config: { statusline_items: ["five-hour-limit", 4] } }],
	])("draws something for the snapshot %o", (state) => {
		expect(text(draw(state, undefined, null))).toContain("LIT");
	});
});

describe("the card server's footer", () => {
	const call = (method: string, params: unknown = {}) =>
		(
			handleCardMessage(
				{ jsonrpc: "2.0", id: 1, method, params },
				{ env: { CODEX_HOME: dir() }, now: () => 5_000 },
			) as {
				result: Record<string, never>;
			}
		).result as never as Record<string, unknown[]>;

	it("offers the footer tool to the status line and not to the model", () => {
		const tool = (call("tools/list")["tools"] as Record<string, unknown>[]).find(
			(one) => one["name"] === FOOTER_TOOL,
		);
		expect(tool?.["_meta"]).toEqual({
			ui: { visibility: ["app"] },
			"openai/ui": { entrypoints: [{ type: "statusline", resourceUri: FOOTER_URI }] },
		});
	});

	it("answers a read with one JSON tree", () => {
		const read = call("resources/read", { uri: FOOTER_URI, _meta: { [FOOTER_STATE_KEY]: snapshot() } });
		const [content] = read["contents"] as { uri: string; mimeType: string; text: string }[];
		expect(content).toMatchObject({ uri: FOOTER_URI, mimeType: "application/json" });
		expect(text(JSON.parse(content?.text ?? "") as UiNode)).toContain("working");
	});
});

describe("a Codex home outside the user's home", () => {
	it("gives the footer its LIT records", () => {
		const [home, codexHome, cwd] = [dir(), dir(), dir()];
		const env = { HOME: home, CODEX_HOME: codexHome };
		writeThreadPointer(env, "t1", cwd, 1_000);
		recordWorkflowTurn(cwd, "t1", "turn-1", "lit-loop", 1_000);
		recordTurnStart(cwd, "t1", 1_000);
		endLiveStep(cwd, "t1", 3_000);
		const params = { _meta: { [FOOTER_STATE_KEY]: snapshot("ready") } };
		expect(text(readFooter(params, env, 4_000))).toMatch(/lit.loop/u);
		expect(text(readFooter(params, { HOME: home }, 4_000))).not.toMatch(/lit.loop/u);
	});
});

describe("the one hint about it", () => {
	it("comes once, in a Codex home that is set up", () => {
		const home = dir();
		const env = { CODEX_HOME: home };
		expect(takeSunsetHint(env)).toBeNull();
		expect(existsSync(join(home, "litcodex"))).toBe(false);
		writeFileSync(join(home, "config.toml"), "");
		expect(takeSunsetHint(env)).toBe(SUNSET_HINT);
		expect(takeSunsetHint(env)).toBeNull();
		expect(readSunsetRecord(home)?.choice).toBeNull();
	});

	it("stays away after an answer, and when it cannot be remembered", () => {
		const home = dir();
		writeFileSync(join(home, "config.toml"), "");
		writeSunsetRecord(home, { choice: "off", featureBefore: null, added: [] });
		expect(takeSunsetHint({ CODEX_HOME: home })).toBeNull();
		const linked = dir();
		const elsewhere = dir();
		writeFileSync(join(linked, "config.toml"), "");
		mkdirSync(join(elsewhere, "x"));
		symlinkSync(join(elsewhere, "x"), join(linked, "litcodex"));
		expect(takeSunsetHint({ CODEX_HOME: linked })).toBeNull();
	});

	it("reads a broken record as no answer", () => {
		const home = dir();
		mkdirSync(join(home, "litcodex"));
		writeFileSync(join(home, "litcodex/sunset.json"), "{bad");
		expect(readSunsetRecord(home)).toBeNull();
		expect(readFileSync(join(home, "litcodex/sunset.json"), "utf8")).toBe("{bad");
	});
});
