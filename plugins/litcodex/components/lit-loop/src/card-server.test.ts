import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { CARD_HTML } from "./card-html.js";
import { CARD_MIME, CARD_STATUS_TOOL, CARD_TOOL, cardResourceUri, handleCardMessage } from "./card-mcp.js";
import { cardStatusText, readCardStatus, resolveThreadCwd } from "./card-status.js";
import {
	endLiveStep,
	recordLiveStepEnd,
	recordLiveStepStart,
	recordTurnStart,
	writeThreadPointer,
} from "./live-step.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const SERVER = fileURLToPath(new URL("../dist/card-server.js", import.meta.url));
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dir(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(root);
	return root;
}

/** A workspace mid start-work (3 of 7 tasks) with a LIT turn and a running Bash step for thread `t1`. */
function workspace(): { home: string; root: string; env: NodeJS.ProcessEnv } {
	const home = dir("litcodex-card-home-");
	const root = dir("litcodex-card-ws-");
	const env = { CODEX_HOME: home };
	mkdirSync(join(root, ".litcodex/plans"), { recursive: true });
	writeFileSync(
		join(root, ".litcodex/plans/boost.md"),
		[
			"## Todos",
			"- [x] 1. One",
			"- [x] 2. Two",
			"- [x] 3. Three",
			"- [ ] 4. Write the README demo",
			"- [ ] 5. Five",
			"- [ ] 6. Six",
			"- [ ] 7. Seven",
			"",
		].join("\n"),
	);
	mkdirSync(join(root, ".litcodex/start-work"), { recursive: true });
	writeFileSync(
		join(root, ".litcodex/start-work/state.json"),
		JSON.stringify({
			active_work_id: "w1",
			works: {
				w1: { work_id: "w1", active_plan: ".litcodex/plans/boost.md", session_ids: ["codex:t1"], status: "active" },
			},
		}),
	);
	recordWorkflowTurn(root, "t1", "turn-1", "start-work", 100_000);
	recordLiveStepStart(root, "t1", { tool: "Bash", toolUseId: "c1" }, 108_000);
	writeThreadPointer(env, "t1", root, 100_000);
	return { home, root, env };
}

function call(message: unknown, env: NodeJS.ProcessEnv, now = 120_000): unknown {
	return handleCardMessage(message, { env, now: () => now });
}

describe("card status", () => {
	it("reads activation, the map stages and the live step for a thread through its pointer", () => {
		const { root, env } = workspace();
		const status = readCardStatus("t1", env, 120_000);
		expect(status).toMatchObject({
			version: 1,
			thread: "t1",
			state: "ignited",
			mode: "start-work",
			ignitedAt: 100_000,
			step: { tool: "Bash", startedAt: 108_000 },
			working: true,
			workspace: root.split("/").at(-1),
			now: 120_000,
		});
		expect(status.map?.family).toBe("main");
		expect(status.map?.cells.map((cell) => [cell.word, cell.state])).toEqual([
			["interview", "done"],
			["plan", "done"],
			["work", "current"],
			["review", "pending"],
			["done", "pending"],
		]);
		expect(status.map?.cells[2]?.progress).toEqual({ done: 3, total: 7 });
		expect(status.map?.next).toBe("Write the README demo");
	});

	it("stops saying working as soon as the turn ends, and keeps working while a turn thinks with no tool", () => {
		const { root, env } = workspace();
		recordTurnStart(root, "t1", 100_000);
		recordLiveStepStart(root, "t1", { tool: "Bash", toolUseId: "c1" }, 108_000);
		recordLiveStepEnd(root, "t1", { tool: "Bash", toolUseId: "c1" }, 110_000);
		expect(readCardStatus("t1", env, 170_000).working).toBe(true);
		endLiveStep(root, "t1", 111_000);
		expect(readCardStatus("t1", env, 112_000)).toMatchObject({ step: null, working: false });
	});

	it("says complete once a LIT turn ends with nothing left open, and keeps WORK while tasks remain", () => {
		const home = dir("litcodex-card-home-");
		const root = dir("litcodex-card-ws-");
		const env = { CODEX_HOME: home };
		recordWorkflowTurn(root, "t2", "turn-1", "lit-loop", 100_000);
		writeThreadPointer(env, "t2", root, 100_000);
		recordTurnStart(root, "t2", 100_000);
		expect(readCardStatus("t2", env, 101_000)).toMatchObject({
			state: "ignited",
			working: true,
			turnStartedAt: 100_000,
		});
		endLiveStep(root, "t2", 130_000);
		const done = readCardStatus("t2", env, 131_000);
		expect(done).toMatchObject({ state: "complete", working: false, turnStartedAt: 100_000, turnEndedAt: 130_000 });
		expect(done.map?.cells.map((c) => [c.word, c.state])).toEqual([
			["work", "done"],
			["review", "pending"],
			["done", "done"],
		]);
		expect(cardStatusText(done)).toContain("COMPLETE");

		const busy = workspace();
		recordTurnStart(busy.root, "t1", 100_000);
		endLiveStep(busy.root, "t1", 130_000);
		expect(readCardStatus("t1", busy.env, 131_000)).toMatchObject({ state: "ignited", working: false });
	});

	it("does not take the end of an earlier turn for the end of a newer LIT turn", () => {
		const home = dir("litcodex-card-home-");
		const root = dir("litcodex-card-ws-");
		const env = { CODEX_HOME: home };
		recordTurnStart(root, "t3", 80_000);
		endLiveStep(root, "t3", 90_000);
		recordWorkflowTurn(root, "t3", "turn-2", "lit-loop", 100_000);
		writeThreadPointer(env, "t3", root, 100_000);
		expect(readCardStatus("t3", env, 101_000)).toMatchObject({ state: "ignited", turnEndedAt: null });
	});

	it("does not call a plan or interview turn done when it stops", () => {
		const home = dir("litcodex-card-home-");
		const root = dir("litcodex-card-ws-");
		const env = { CODEX_HOME: home };
		for (const [thread, mode] of [
			["p1", "lit-plan"],
			["i1", "deep-interview"],
		] as const) {
			recordWorkflowTurn(root, thread, "turn-1", mode, 100_000);
			writeThreadPointer(env, thread, root, 100_000);
			recordTurnStart(root, thread, 100_000);
			endLiveStep(root, thread, 130_000);
			expect(readCardStatus(thread, env, 131_000)).toMatchObject({ state: "ignited", working: false });
		}
	});

	it("reads the branch of a git worktree through its gitdir file", () => {
		const { root, env } = workspace();
		const gitdir = dir("litcodex-card-gitdir-");
		writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/feat/tree\n");
		writeFileSync(join(root, ".git"), `gitdir: ${gitdir}\n`);
		expect(readCardStatus("t1", env, 120_000).branch).toBe("feat/tree");
	});

	it("reads context and quota use from the thread's rollout tail and the branch from the workspace", () => {
		const { home, root, env } = workspace();
		const day = join(home, "sessions/2026/10/14");
		mkdirSync(day, { recursive: true });
		const usage = (input: number, week: number): string =>
			JSON.stringify({
				type: "event_msg",
				payload: {
					type: "token_count",
					info: { last_token_usage: { input_tokens: input }, model_context_window: 475_000 },
					rate_limits: {
						primary: { used_percent: week, window_minutes: 10_080 },
						secondary: null,
					},
				},
			});
		writeFileSync(
			join(day, "rollout-2026-10-14T11-00-58-t1.jsonl"),
			[
				JSON.stringify({ type: "session_meta", payload: { id: "t1", cwd: root } }),
				usage(10_000, 2),
				JSON.stringify({ type: "response_item", payload: { type: "message" } }),
				usage(66_500, 4),
				"",
			].join("\n"),
		);
		mkdirSync(join(root, ".git"));
		writeFileSync(join(root, ".git/HEAD"), "ref: refs/heads/feat/card\n");
		expect(readCardStatus("t1", env, 120_000)).toMatchObject({
			usage: { ctx: 14, fiveHour: null, week: 4 },
			branch: "feat/card",
		});
	});

	it("names an MCP tool by its server and tool, not the joined id", () => {
		const { root, env } = workspace();
		recordLiveStepStart(root, "t1", { tool: "mcp__github__search_issues", toolUseId: "c2" }, 115_000);
		expect(readCardStatus("t1", env, 120_000).step).toEqual({ tool: "github · search_issues", startedAt: 115_000 });
	});

	it("keeps the tool that just finished, so a quick step still shows between polls", () => {
		const { root, env } = workspace();
		recordLiveStepEnd(root, "t1", { tool: "Bash", toolUseId: "c1" }, 109_000);
		recordLiveStepStart(root, "t1", { tool: "mcp__github__search_issues", toolUseId: "c2" }, 110_000);
		recordLiveStepEnd(root, "t1", { tool: "mcp__github__search_issues", toolUseId: "c2" }, 110_400);
		expect(readCardStatus("t1", env, 111_000)).toMatchObject({ step: null, lastTool: "github · search_issues" });
		recordTurnStart(root, "t1", 112_000);
		expect(readCardStatus("t1", env, 113_000).lastTool).toBeNull();
	});

	it("shows the ready state for an unknown, empty or hostile thread id", () => {
		const { env } = workspace();
		for (const id of ["nope", "", "../../t1", null]) {
			const status = readCardStatus(id, env, 1);
			expect(status.state).toBe("ready");
			expect(status.map).toBeNull();
			expect(status.step).toBeNull();
		}
	});

	it("says complete when the thread's plan finished", () => {
		const { root, env } = workspace();
		writeFileSync(
			join(root, ".litcodex/start-work/state.json"),
			JSON.stringify({
				active_work_id: null,
				works: {
					w1: {
						work_id: "w1",
						active_plan: ".litcodex/plans/boost.md",
						session_ids: ["codex:t1"],
						status: "completed",
						last_transition: { at: "2026-10-14T00:00:00.000Z" },
					},
				},
			}),
		);
		expect(readCardStatus("t1", env, 120_000).state).toBe("complete");
	});

	it("falls back to the rollout session record only when the pointer is missing", () => {
		const home = dir("litcodex-card-home-");
		const root = dir("litcodex-card-ws-");
		const day = join(home, "sessions/2026/10/14");
		mkdirSync(day, { recursive: true });
		const id = "01a139c9-843a-7af1-9296-a187888d0116";
		writeFileSync(
			join(day, `rollout-2026-10-14T02-41-10-${id}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, base_instructions: "x".repeat(30_000) } })}\n{"type":"turn"}\n`,
		);
		expect(resolveThreadCwd(id, { CODEX_HOME: home })).toBe(root);
		writeThreadPointer({ CODEX_HOME: home }, id, "/elsewhere", 1);
		expect(resolveThreadCwd(id, { CODEX_HOME: home })).toBe("/elsewhere");
	});

	it("refuses symlinked, oversized or mismatched rollout records", () => {
		const home = dir("litcodex-card-home-");
		const root = dir("litcodex-card-ws-");
		const day = join(home, "sessions/2026/10/14");
		mkdirSync(day, { recursive: true });
		writeFileSync(
			join(root, "meta.jsonl"),
			`${JSON.stringify({ type: "session_meta", payload: { id: "a1", cwd: root } })}\n`,
		);
		symlinkSync(join(root, "meta.jsonl"), join(day, "rollout-2026-10-14T00-00-00-a1.jsonl"));
		expect(resolveThreadCwd("a1", { CODEX_HOME: home })).toBeNull();
		writeFileSync(
			join(day, "rollout-2026-10-14T00-00-00-b2.jsonl"),
			`{"type":"session_meta","payload":{"id":"b2","cwd":"${root}","pad":"${"x".repeat(300_000)}"}}\n`,
		);
		expect(resolveThreadCwd("b2", { CODEX_HOME: home })).toBeNull();
		writeFileSync(
			join(day, "rollout-2026-10-14T00-00-00-c3.jsonl"),
			`${JSON.stringify({ type: "session_meta", payload: { id: "other", cwd: root } })}\n`,
		);
		expect(resolveThreadCwd("c3", { CODEX_HOME: home })).toBeNull();
	});

	it("ignores a symlinked live-step folder", () => {
		const { root, env } = workspace();
		const elsewhere = dir("litcodex-card-elsewhere-");
		rmSync(join(root, ".litcodex/live-step"), { recursive: true });
		writeFileSync(join(elsewhere, "t1.json"), JSON.stringify({ version: 1, tool: "Stolen", startedAt: 1 }));
		symlinkSync(elsewhere, join(root, ".litcodex/live-step"));
		expect(readCardStatus("t1", env, 120_000).step).toBeNull();
	});
});

describe("card status subfolder guard", () => {
	/** Move one state subfolder outside the workspace and leave a symlink in its place. */
	function relink(root: string, rel: string): void {
		const outside = join(dir("litcodex-card-outside-"), "moved");
		renameSync(join(root, rel), outside);
		symlinkSync(outside, join(root, rel));
	}

	it("never shows a plan title read through a symlinked plans folder, in the card or the text", () => {
		const { root, env } = workspace();
		relink(root, ".litcodex/plans");
		const status = readCardStatus("t1", env, 120_000);
		expect(status.map?.next ?? null).toBeNull();
		expect(JSON.stringify(status)).not.toContain("README demo");
		const reply = call(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: CARD_TOOL, arguments: {}, _meta: { thread_id: "t1" } },
			},
			env,
		);
		expect(JSON.stringify(reply)).not.toContain("README demo");
	});

	it("ignores symlinked start-work, workflow-map and lit-loop session folders", () => {
		for (const rel of [".litcodex/start-work", ".litcodex/workflow-map"]) {
			const { root, env } = workspace();
			relink(root, rel);
			const status = readCardStatus("t1", env, 120_000);
			expect(status.map?.cells.find((cell) => cell.key === "work")?.progress ?? null).toBeNull();
		}
		const { root, env } = workspace();
		rmSync(join(root, ".litcodex/start-work"), { recursive: true });
		mkdirSync(join(root, ".litcodex/lit-loop/t1"), { recursive: true });
		writeFileSync(
			join(root, ".litcodex/lit-loop/t1/goals.json"),
			JSON.stringify({ goals: [{ title: "Outside goal", status: "pending" }] }),
		);
		relink(root, ".litcodex/lit-loop/t1");
		expect(JSON.stringify(readCardStatus("t1", env, 120_000))).not.toContain("Outside goal");
	});
});

describe("card status workspace guard", () => {
	it("shows ready when the workspace state folder is a symlink", () => {
		const { root, env } = workspace();
		const elsewhere = dir("litcodex-card-elsewhere-");
		rmSync(join(elsewhere), { recursive: true, force: true });
		mkdirSync(elsewhere);
		const real = join(root, ".litcodex");
		const moved = join(elsewhere, "state");
		renameSync(real, moved);
		symlinkSync(moved, real);
		expect(readCardStatus("t1", env, 120_000).state).toBe("ready");
	});
});

describe("card MCP server", () => {
	it("answers initialize with tools and resources", () => {
		const reply = call(
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
			{},
		);
		expect(reply).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: "2025-06-18",
				capabilities: { tools: {}, resources: {} },
				serverInfo: { name: "litcodex" },
			},
		});
	});

	it("lists a read-only model tool that opens the card and an app-only read-only status tool", () => {
		const reply = call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {}) as {
			result: { tools: { name: string; annotations: unknown; _meta: Record<string, unknown> }[] };
		};
		const [card, status] = reply.result.tools;
		expect(reply.result.tools.map((tool) => tool.name)).toEqual([CARD_TOOL, CARD_STATUS_TOOL]);
		expect(card?.annotations).toMatchObject({ readOnlyHint: true });
		expect(card?._meta).toEqual({
			ui: { resourceUri: cardResourceUri(), visibility: ["model", "app"] },
			"openai/outputTemplate": cardResourceUri(),
		});
		expect(status?.annotations).toMatchObject({ readOnlyHint: true });
		expect(status?._meta).toEqual({ ui: { visibility: ["app"] } });
	});

	it("serves the card as one self-contained mcp-app HTML resource whose URI follows its content", () => {
		const reply = call(
			{ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: cardResourceUri() } },
			{},
		) as {
			result: { contents: { uri: string; mimeType: string; text: string }[] };
		};
		expect(CARD_MIME).toBe("text/html;profile=mcp-app");
		expect(reply.result.contents).toHaveLength(1);
		expect(reply.result.contents[0]).toMatchObject({ uri: cardResourceUri(), mimeType: CARD_MIME, text: CARD_HTML });
		expect(cardResourceUri()).toMatch(/^ui:\/\/litcodex\/lit-card-[0-9a-f]{12}\.html$/u);
		const digest = createHash("sha256").update(CARD_HTML).digest("hex").slice(0, 12);
		expect(cardResourceUri()).toBe(`ui://litcodex/lit-card-${digest}.html`);
		expect(CARD_HTML).not.toMatch(/<(?:script|link|img|iframe)[^>]+(?:src|href)=/iu);
		expect(CARD_HTML).toContain("🔥 LIT");
		// The host draws inline cards in a frame sized by the card and reports the side pane as fullscreen;
		// its sandbox page also sets its own font, so the card pins its monospace face.
		expect(CARD_HTML).toContain("notifyIntrinsicHeight");
		expect(CARD_HTML).toMatch(/displayMode/u);
		expect(CARD_HTML).toMatch(/font-family:var\(--mono\)!important/u);
		// The host sizes an inline frame as max(reported height, min frame height ?? 200): a low floor lets the
		// frame follow the card (and its one-line folded form), and the hint keeps the first paint near the card.
		const meta = (reply.result.contents[0] as unknown as { _meta: Record<string, unknown> })._meta;
		expect(meta["openai/widgetMinFrameHeight"]).toEqual(expect.any(Number));
		expect(meta["openai/widgetMinFrameHeight"]).toBeGreaterThanOrEqual(0);
		expect(meta["openai/widgetMinFrameHeight"]).toBeLessThanOrEqual(40);
		expect(meta["openai/widgetHeightHint"]).toBeGreaterThanOrEqual(100);
		expect(meta["openai/widgetHeightHint"]).toBeLessThanOrEqual(180);
		const unknown = call(
			{ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ui://litcodex/../x" } },
			{},
		);
		expect(unknown).toMatchObject({ id: 4, error: { code: -32602 } });
	});

	it("says how long a turn took down to the second", () => {
		const source = CARD_HTML.match(/function span\(ms\)\{.*?\n/u)?.[0];
		expect(source).toBeDefined();
		const span = runInNewContext(`${source}; span`) as (ms: number) => string;
		expect(span(49_000)).toBe("49s");
		expect(span(60_000)).toBe("1m");
		expect(span(77_000)).toBe("1m 17s");
		expect(span(3_599_000)).toBe("59m 59s");
		expect(span(3_900_000)).toBe("1h 5m");
	});

	it("opens the card for the calling thread and returns the text map too", () => {
		const { env } = workspace();
		const reply = call(
			{
				jsonrpc: "2.0",
				id: 5,
				method: "tools/call",
				params: {
					name: CARD_TOOL,
					arguments: {},
					_meta: { "x-codex-turn-metadata": { session_id: "t1", thread_id: "t1" } },
				},
			},
			env,
		) as { result: { content: { type: string; text: string }[]; structuredContent: { state: string } } };
		expect(reply.result.structuredContent.state).toBe("ignited");
		expect(reply.result.content[0]?.text).toContain("🔥 LIT IGNITED · start-work");
		expect(reply.result.content[0]?.text).toContain("🔨 WORK ▰▰▰▱▱▱▱ 3/7");
		expect(reply.result.content[0]?.text).toContain("Bash");
	});

	it("records when each card opens, so every poll names the newest card of the thread", () => {
		const { env, root } = workspace();
		const open = (id: number, now: number) =>
			call(
				{
					jsonrpc: "2.0",
					id,
					method: "tools/call",
					params: { name: CARD_TOOL, arguments: {}, _meta: { "x-codex-turn-metadata": { thread_id: "t1" } } },
				},
				env,
				now,
			) as { result: { structuredContent: { card: { openedAt: number }; cardOpenedAt: number } } };
		const poll = (now: number) =>
			(
				call(
					{
						jsonrpc: "2.0",
						id: 9,
						method: "tools/call",
						params: { name: CARD_STATUS_TOOL, arguments: {}, _meta: { thread_id: "t1" } },
					},
					env,
					now,
				) as { result: { structuredContent: { cardOpenedAt: number | null; card?: unknown } } }
			).result.structuredContent;
		expect(poll(119_000).cardOpenedAt).toBeNull();
		const first = open(10, 120_000).result.structuredContent;
		expect(first.card).toEqual({ openedAt: 120_000 });
		expect(first.cardOpenedAt).toBe(120_000);
		expect(poll(121_000).cardOpenedAt).toBe(120_000);
		// A tool step in between rewrites the pointer; the opening time survives it.
		writeThreadPointer(env, "t1", root, 125_000);
		expect(poll(126_000).cardOpenedAt).toBe(120_000);
		const second = open(11, 130_000).result.structuredContent;
		expect(second.card).toEqual({ openedAt: 130_000 });
		const latest = poll(131_000);
		expect(latest.cardOpenedAt).toBe(130_000);
		// A poll never claims to be a card of its own.
		expect(latest.card).toBeUndefined();
	});

	it("records nothing for a thread without a LIT pointer, and still opens the card", () => {
		const home = dir("litcodex-card-home-");
		const env = { CODEX_HOME: home };
		const reply = call(
			{ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: CARD_TOOL, arguments: { thread_id: "zz" } } },
			env,
		) as { result: { structuredContent: { state: string; card: { openedAt: number } } } };
		expect(reply.result.structuredContent.state).toBe("ready");
		expect(reply.result.structuredContent.card).toEqual({ openedAt: 120_000 });
		expect(readdirSync(home)).toEqual([]);
	});

	it("serves the status poll by the thread id the host sends", () => {
		const { env } = workspace();
		const reply = call(
			{
				jsonrpc: "2.0",
				id: 6,
				method: "tools/call",
				params: { name: CARD_STATUS_TOOL, arguments: {}, _meta: { thread_id: "t1" } },
			},
			env,
		) as { result: { structuredContent: { state: string; step: { tool: string } } } };
		expect(reply.result.structuredContent.state).toBe("ignited");
		expect(reply.result.structuredContent.step.tool).toBe("Bash");
		const fallback = call(
			{
				jsonrpc: "2.0",
				id: 7,
				method: "tools/call",
				params: { name: CARD_STATUS_TOOL, arguments: { thread_id: "t1" } },
			},
			env,
		) as { result: { structuredContent: { state: string } } };
		expect(fallback.result.structuredContent.state).toBe("ignited");
	});

	it("keeps the text neutral when the host names no thread", () => {
		const reply = call(
			{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: CARD_TOOL, arguments: {} } },
			{},
		) as {
			result: { content: { text: string }[] };
		};
		expect(reply.result.content[0]?.text).not.toContain("no LIT skill");
		expect(reply.result.content[0]?.text).toContain("did not name the thread");
	});

	it("answers unknown methods and tools with errors and ignores notifications", () => {
		expect(call({ jsonrpc: "2.0", id: 8, method: "nope" }, {})).toMatchObject({ error: { code: -32601 } });
		expect(call({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "rm" } }, {})).toMatchObject({
			error: { code: -32602 },
		});
		expect(call({ jsonrpc: "2.0", method: "notifications/initialized" }, {})).toBeNull();
		expect(call("not an object", {})).toMatchObject({ id: null, error: { code: -32600 } });
	});
});

describe("card server process", () => {
	it("does nothing at start: no files, no output, and it exits as soon as stdin closes", () => {
		const home = dir("litcodex-card-proc-");
		const result = spawnSync(process.execPath, [SERVER], {
			input: "",
			env: { PATH: process.env["PATH"] ?? "", HOME: home, CODEX_HOME: join(home, ".codex") },
			cwd: home,
			timeout: 5_000,
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
		expect(readdirSync(home)).toEqual([]);
	});

	it("speaks newline-delimited JSON-RPC over stdio", () => {
		const home = dir("litcodex-card-proc-");
		const lines = [
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: cardResourceUri() } },
			{
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: CARD_STATUS_TOOL, arguments: {}, _meta: { thread_id: "x" } },
			},
		];
		const result = spawnSync(process.execPath, [SERVER], {
			input: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n{broken\n`,
			env: { PATH: process.env["PATH"] ?? "", HOME: home },
			cwd: home,
			timeout: 5_000,
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		const replies = result.stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { id: unknown });
		expect(replies.map((reply) => reply.id)).toEqual([1, 2, 3, 4, null]);
		expect(readdirSync(home)).toEqual([]);
	});

	it("starts twenty times in parallel without leaving files, locks or errors", async () => {
		const home = dir("litcodex-card-proc-");
		const runs = Array.from(
			{ length: 20 },
			() =>
				new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
					const child = spawn(process.execPath, [SERVER], {
						env: { PATH: process.env["PATH"] ?? "", HOME: home },
						cwd: home,
					});
					let stdout = "";
					let stderr = "";
					child.stdout.on("data", (chunk) => {
						stdout += chunk.toString();
					});
					child.stderr.on("data", (chunk) => {
						stderr += chunk.toString();
					});
					child.on("close", (code) => resolve({ code, stdout, stderr }));
					child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
				}),
		);
		const results = await Promise.all(runs);
		for (const result of results) {
			expect(result.code).toBe(0);
			expect(result.stderr).toBe("");
			expect((JSON.parse(result.stdout) as { id: number }).id).toBe(1);
		}
		expect(readdirSync(home)).toEqual([]);
	}, 30_000);
});
