// The sunset footer as Codex reads it: its size, its words, and the limits Codex sets.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleCardMessage } from "./card-mcp.js";
import type { CardStatus } from "./card-status.js";
import { displayWidth } from "./hud.js";
import { countNodes, FOOTER_STATE_KEY, FOOTER_TOOL, FOOTER_URI, footerTree, type UiNode } from "./sunset-footer.js";
import { readSunsetRecord, SUNSET_HINT, takeSunsetHint, writeSunsetRecord } from "./sunset-settings.js";

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

function text(node: UiNode): string {
	return typeof node === "string" ? node : node.children.map(text).join("");
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

	it("uses no plain space, which Codex drops at an element's edge, and only colours Codex knows", () => {
		const tree = draw(snapshot());
		expect(text(tree)).not.toContain(" ");
		for (const color of colors(tree))
			expect(color).toMatch(/^(?:#[0-9A-F]{6}|primary|accent|yellow|green|status-[a-z]+)$/u);
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
